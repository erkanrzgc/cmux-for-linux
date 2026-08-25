import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { selectCurrent, selectId, type PaneId } from "cmux-sdk/browser";
import { stopSessionsAndExit, writeClipboard } from "./backend";
import { HookSettings } from "./HookSettings";
import { t } from "./i18n";
import { ResourceTerminal } from "./ResourceTerminal";
import { useDesktopClient } from "./useDesktopClient";

type IconName = "add" | "close" | "copy" | "rename" | "settings" | "splitDown" | "splitRight" | "zoom";

function Icon({ name }: { readonly name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    add: <path d="M12 5v14M5 12h14" />,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" /></>,
    rename: <><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14 7 3 3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    splitDown: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 15v4M10 17h4" /></>,
    splitRight: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18M15 12h4M17 10v4" /></>,
    zoom: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

interface IconButtonProps {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly icon: IconName;
  readonly label: string;
  readonly onClick: () => void;
}

function IconButton({ className = "", disabled = false, icon, label, onClick }: IconButtonProps) {
  return (
    <button className={`icon-button ${className}`.trim()} aria-label={label} disabled={disabled} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

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

  const requestPaneClose = (pane: PaneId) => {
    if (!ids || !activeScreen || activeScreen.panes.length <= 1) return;
    if (window.confirm(t("closePaneConfirm"))) {
      void run(() => connection.actions.closePane(ids.workspace, ids.screen, pane));
    }
  };

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
        <header className="brand-row">
          <div className="brand"><h1>Limux</h1><small>{t("unofficial")}</small></div>
          <IconButton icon="settings" label={t("settings")} onClick={() => setSettings(true)} />
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
        <div className="sidebar-actions" role="toolbar" aria-label={t("workspaceActions")}>
          <button className="new-workspace" onClick={() => {
            const name = window.prompt(t("workspaceName"));
            if (name !== null) void run(() => connection.actions.createWorkspace(name || undefined));
          }}><Icon name="add" /><span>{t("newWorkspace")}</span></button>
          {activeWorkspace && <>
            <IconButton icon="rename" label={t("renameWorkspace")} onClick={() => {
              const name = window.prompt(t("renamePrompt"), activeWorkspace.name);
              if (name) void run(() => connection.actions.renameWorkspace(activeWorkspace.id, name));
            }} />
            <IconButton className="danger" icon="close" label={t("closeWorkspace")} onClick={() => {
              if (window.confirm(t("closeWorkspaceConfirm"))) {
                void run(() => connection.actions.closeWorkspace(activeWorkspace.id));
              }
            }} />
          </>}
        </div>
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
            <header className="workspace-toolbar">
              <nav className="screen-tabs">
                {activeWorkspace.screens.map((screen, index) => (
                  <button
                    className={screen.id === activeScreen.id ? "active" : ""}
                    key={screen.id}
                    onClick={() => void run(() => connection.actions.focusScreen(activeWorkspace.id, screen.id))}
                  >{screen.name || `#${index + 1}`}</button>
                ))}
              </nav>
              {ids && (
                <div className="pane-actions" role="toolbar" aria-label={t("paneActions")}>
                  <IconButton icon="add" label={t("newTab")} onClick={() => void run(() => connection.actions.newTab(ids.workspace, ids.screen, ids.pane))} />
                  <IconButton icon="splitRight" label={t("splitRight")} onClick={() => void run(() => connection.actions.split(ids.workspace, ids.screen, ids.pane, "right"))} />
                  <IconButton icon="splitDown" label={t("splitDown")} onClick={() => void run(() => connection.actions.split(ids.workspace, ids.screen, ids.pane, "down"))} />
                  <IconButton icon="zoom" label={activePane?.zoomed ? t("restore") : t("zoom")} onClick={() => void run(() => connection.actions.zoomPane(ids.workspace, ids.screen, ids.pane, !activePane?.zoomed))} />
                  <IconButton icon="copy" label={t("copyScreen")} onClick={() => {
                    const terminal = activePane?.terminal;
                    if (!terminal || !connection.client) return;
                    void run(async () => {
                      const copy = await connection.client!.session(selectCurrent()).terminal(selectId(terminal.id)).copy("screen");
                      await writeClipboard(copy.text);
                    });
                  }} />
                  <IconButton className="danger" disabled={activeScreen.panes.length <= 1} icon="close" label={t("closePane")} onClick={() => requestPaneClose(ids.pane)} />
                </div>
              )}
            </header>
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
                    <div className="pane-header-actions" onPointerDown={(event) => event.stopPropagation()}>
                      <IconButton icon="add" label={t("newTab")} onClick={() => void run(() => connection.actions.newTab(activeWorkspace.id, activeScreen.id, pane.id))} />
                      <IconButton className="danger" disabled={activeScreen.panes.length <= 1} icon="close" label={t("closePane")} onClick={() => requestPaneClose(pane.id)} />
                    </div>
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
          </>
        ) : <div className="empty">{t("noWorkspace")}</div>}
      </section>
      {settings && <HookSettings onClose={() => setSettings(false)} />}
    </main>
  );
}
