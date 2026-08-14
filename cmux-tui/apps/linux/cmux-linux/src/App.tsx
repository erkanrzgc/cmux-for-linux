import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { selectCurrent, selectId } from "cmux-sdk/browser";
import { stopSessionsAndExit } from "./backend";
import { HookSettings } from "./HookSettings";
import { t } from "./i18n";
import { ResourceTerminal } from "./ResourceTerminal";
import { useDesktopClient } from "./useDesktopClient";

export default function App() {
  const connection = useDesktopClient();
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activeWorkspace = connection.tree.find((workspace) => workspace.focused) ?? connection.tree[0];
  const activeScreen = activeWorkspace?.screens.find((screen) => screen.focused) ?? activeWorkspace?.screens[0];
  const activePane = activeScreen?.panes.find((pane) => pane.focused) ?? activeScreen?.panes[0];
  const unreadNotifications = connection.snapshot?.notifications.filter((notification) => notification.unread) ?? [];
  const latestUnread = unreadNotifications.at(-1);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("request-stop-sessions", async () => {
      if (window.confirm(t("stopConfirm"))) await stopSessionsAndExit();
    }).then((next) => { unlisten = next; });
    return () => unlisten?.();
  }, []);

  const run = async (operation: () => Promise<unknown>) => {
    try {
      setMessage(null);
      await operation();
    } catch (reason) {
      setMessage(t("commandFailed", { error: reason instanceof Error ? reason.message : String(reason) }));
    }
  };

  const ids = useMemo(() => activeWorkspace && activeScreen && activePane ? {
    workspace: activeWorkspace.id,
    screen: activeScreen.id,
    pane: activePane.id,
  } : null, [activeWorkspace, activeScreen, activePane]);

  if (connection.status === "starting" && !connection.snapshot) {
    return <main className="state-screen"><div className="spinner" /><p>{t("starting")}</p></main>;
  }

  if (connection.status === "error" && !connection.snapshot) {
    return (
      <main className="state-screen error-screen">
        <h1>{t("backendError")}</h1>
        <pre>{connection.error}</pre>
        <div><button onClick={connection.retry}>{t("retry")}</button><button onClick={() => void connection.recover()}>{t("recover")}</button></div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header>
          <div><strong>cmux-linux</strong><small>{t("unofficial")}</small></div>
          <button aria-label={t("settings")} onClick={() => setSettings(true)}>⚙</button>
        </header>
        <h2>{t("workspaces")}</h2>
        <div className="workspace-list">
          {connection.tree.map((workspace) => (
            <button
              className={workspace.id === activeWorkspace?.id ? "active" : ""}
              key={workspace.id}
              onClick={() => void run(() => connection.actions.focusWorkspace(workspace.id))}
            >
              <span>{workspace.name}</span><small>{workspace.screens.length}</small>
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => {
          const name = window.prompt(t("workspaceName"));
          if (name !== null) void run(() => connection.actions.createWorkspace(name || undefined));
        }}>＋ {t("newWorkspace")}</button>
        {activeWorkspace && (
          <div className="sidebar-actions">
            <button onClick={() => {
              const name = window.prompt(t("renamePrompt"), activeWorkspace.name);
              if (name) void run(() => connection.actions.renameWorkspace(activeWorkspace.id, name));
            }}>{t("renameWorkspace")}</button>
            <button className="danger" onClick={() => {
              if (window.confirm(t("closeWorkspaceConfirm"))) {
                void run(() => connection.actions.closeWorkspace(activeWorkspace.id));
              }
            }}>{t("closeWorkspace")}</button>
          </div>
        )}
        <section className="notifications">
          <h2>{t("notifications")}<span className="badge">{unreadNotifications.length}</span></h2>
          {latestUnread && (
            <button className="latest-unread" onClick={() => void run(() => connection.actions.jumpToNotification(latestUnread))}>
              {t("latestUnread")}
            </button>
          )}
          {connection.snapshot?.notifications.slice(-6).reverse().map((notification) => (
            <button key={notification.id} onClick={() => void run(() => connection.actions.jumpToNotification(notification))}>
              <span>{notification.title}</span>
              {notification.unread && <small>{t("unread")}</small>}
            </button>
          ))}
        </section>
      </aside>
      <section className="workspace">
        {connection.status === "reconnecting" && (
          <div className="banner reconnect-banner">
            <span>{t("reconnecting")}{connection.error ? ` ${connection.error}` : ""}</span>
            <span>
              <button onClick={connection.retry}>{t("retry")}</button>
              <button onClick={() => void connection.recover()}>{t("recover")}</button>
            </span>
          </div>
        )}
        {message && <div className="banner error">{message}</div>}
        {activeWorkspace && activeScreen ? (
          <>
            <nav className="screen-tabs">
              {activeWorkspace.screens.map((screen, index) => (
                <button
                  className={screen.id === activeScreen.id ? "active" : ""}
                  key={screen.id}
                  onClick={() => void run(() => connection.actions.focusScreen(activeWorkspace.id, screen.id))}
                >{screen.name || `#${index + 1}`}</button>
              ))}
            </nav>
            <section className="pane-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(Math.sqrt(activeScreen.panes.length)))}, minmax(0, 1fr))` }}>
              {activeScreen.panes.map((pane) => (
                <article
                  className={`pane ${pane.id === activePane?.id ? "active" : ""}`}
                  key={pane.id}
                  onPointerDown={() => void connection.actions.focusPane(activeWorkspace.id, activeScreen.id, pane.id)}
                >
                  <header>
                    <div className="tab-list">
                      {pane.tabs.map((tab, index) => (
                        <button
                          className={tab.id === pane.activeTab?.id ? "active" : ""}
                          key={tab.id}
                          onClick={() => void run(() => connection.actions.focusTab(activeWorkspace.id, activeScreen.id, pane.id, tab.id))}
                        >{tab.name || pane.terminal?.title || `#${index + 1}`}</button>
                      ))}
                    </div>
                    <button title={t("newTab")} onClick={() => void run(() => connection.actions.newTab(activeWorkspace.id, activeScreen.id, pane.id))}>＋</button>
                  </header>
                  {pane.activeTab?.contentKind === "browser" ? (
                    <div className="unsupported">{t("browserUnsupported")}</div>
                  ) : pane.terminal && connection.client ? (
                    <ResourceTerminal terminal={connection.client.session(selectCurrent()).terminal(selectId(pane.terminal.id))} />
                  ) : (
                    <div className="unsupported">{t("noTerminal")}</div>
                  )}
                </article>
              ))}
            </section>
            {ids && (
              <footer className="actionbar">
                <button onClick={() => void run(() => connection.actions.newTab(ids.workspace, ids.screen, ids.pane))}>{t("newTab")}</button>
                <button onClick={() => void run(() => connection.actions.split(ids.workspace, ids.screen, ids.pane, "right"))}>{t("splitRight")}</button>
                <button onClick={() => void run(() => connection.actions.split(ids.workspace, ids.screen, ids.pane, "down"))}>{t("splitDown")}</button>
                <button onClick={() => void run(() => connection.actions.zoomPane(ids.workspace, ids.screen, ids.pane, !activePane?.zoomed))}>{activePane?.zoomed ? t("restore") : t("zoom")}</button>
                <button onClick={() => {
                  const terminal = activePane?.terminal;
                  if (!terminal || !connection.client) return;
                  void run(async () => {
                    const copy = await connection.client!.session(selectCurrent()).terminal(selectId(terminal.id)).copy("screen");
                    await navigator.clipboard.writeText(copy.text);
                  });
                }}>{t("copyScreen")}</button>
                <button className="danger" onClick={() => {
                  if (window.confirm(t("closePaneConfirm"))) {
                    void run(() => connection.actions.closePane(ids.workspace, ids.screen, ids.pane));
                  }
                }}>{t("closePane")}</button>
              </footer>
            )}
          </>
        ) : <div className="empty">{t("noWorkspace")}</div>}
      </section>
      {settings && <HookSettings onClose={() => setSettings(false)} />}
    </main>
  );
}
