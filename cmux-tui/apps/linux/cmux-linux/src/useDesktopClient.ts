import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Client,
  WebSocketTransport,
  selectCurrent,
  type NotificationSnapshot,
  type PaneId,
  type ResourceSnapshot,
  type ScreenId,
  type TabId,
  type WorkspaceId,
} from "cmux-sdk/browser";
import { ensureBackend, notifyWhenUnfocused, recoverBackend } from "./backend";
import { projectSnapshot } from "./model";

type Status = "starting" | "connected" | "reconnecting" | "error";

export function useDesktopClient() {
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);
  const [generation, setGeneration] = useState(0);
  const clientRef = useRef<Client | null>(null);
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let refreshPending = false;

    const connect = async () => {
      if (cancelled) return;
      try {
        const backend = await ensureBackend();
        const client = new Client({
          transport: new WebSocketTransport(backend.wsUrl, { authToken: backend.token }),
        });
        clientRef.current?.close();
        clientRef.current = client;
        const session = client.session(selectCurrent());
        const next = await session.fullSnapshot();
        if (cancelled) {
          client.close();
          return;
        }
        setSnapshot(next);
        setStatus("connected");
        setError(null);
        const events = await session.events({ cursor: next.cursor });
        void (async () => {
          try {
            for await (const _event of events) {
              if (cancelled || refreshPending) continue;
              refreshPending = true;
              queueMicrotask(async () => {
                try {
                  const refreshed = await session.fullSnapshot();
                  if (!cancelled) setSnapshot(refreshed);
                } catch {
                  if (!cancelled) setGeneration((value) => value + 1);
                } finally {
                  refreshPending = false;
                }
              });
            }
            if (!cancelled) setGeneration((value) => value + 1);
          } catch {
            if (!cancelled) setGeneration((value) => value + 1);
          }
        })();
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus(snapshot === null ? "error" : "reconnecting");
        retry = setTimeout(() => setGeneration((value) => value + 1), 1500);
      }
    };
    void connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clientRef.current?.close();
      clientRef.current = null;
    };
  // Snapshot is deliberately excluded: reconnect ownership is generation-based.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  useEffect(() => {
    if (!snapshot) return;
    for (const notification of snapshot.notifications) {
      if (!notification.unread || notifiedRef.current.has(notification.id)) continue;
      notifiedRef.current.add(notification.id);
      void notifyWhenUnfocused(notification.title, notification.body);
    }
  }, [snapshot]);

  const mutate = useCallback(async (operation: (client: Client) => Promise<unknown>) => {
    const client = clientRef.current;
    if (!client) return;
    await operation(client);
    const next = await client.session(selectCurrent()).fullSnapshot();
    setSnapshot(next);
  }, []);

  const session = useCallback((client: Client) => client.session(selectCurrent()), []);
  const actions = useMemo(() => ({
    createWorkspace: (name?: string) => mutate((client) =>
      session(client).createWorkspace({ name, initialContent: "terminal" })),
    focusWorkspace: (id: WorkspaceId) => mutate((client) => session(client).workspace(id).focus()),
    renameWorkspace: (id: WorkspaceId, name: string) => mutate((client) =>
      session(client).workspace(id).rename(name)),
    closeWorkspace: (id: WorkspaceId) => mutate((client) => session(client).workspace(id).close()),
    focusScreen: (workspace: WorkspaceId, screen: ScreenId) => mutate((client) =>
      session(client).workspace(workspace).screen(screen).focus()),
    focusPane: (workspace: WorkspaceId, screen: ScreenId, pane: PaneId) => mutate((client) =>
      session(client).workspace(workspace).screen(screen).pane(pane).focus()),
    focusTab: (workspace: WorkspaceId, screen: ScreenId, pane: PaneId, tab: TabId) => mutate((client) =>
      session(client).workspace(workspace).screen(screen).pane(pane).tab(tab).focus()),
    newTab: (workspace: WorkspaceId, screen: ScreenId, pane: PaneId) => mutate((client) =>
      session(client).workspace(workspace).screen(screen).pane(pane).createTerminalTab({})),
    split: (
      workspace: WorkspaceId,
      screen: ScreenId,
      pane: PaneId,
      direction: "right" | "down",
    ) => mutate((client) => session(client).workspace(workspace).screen(screen).pane(pane).split({ direction })),
    zoomPane: (workspace: WorkspaceId, screen: ScreenId, pane: PaneId, enabled: boolean) =>
      mutate((client) => session(client).workspace(workspace).screen(screen).pane(pane).zoom(enabled)),
    closePane: (workspace: WorkspaceId, screen: ScreenId, pane: PaneId) => mutate((client) =>
      session(client).workspace(workspace).screen(screen).pane(pane).close()),
    jumpToNotification: (notification: NotificationSnapshot) => {
      if (!snapshot || !notification.terminalId) return Promise.resolve();
      const tab = snapshot.tabs.find((item) => item.contentId === notification.terminalId);
      const pane = tab && snapshot.panes.find((item) => item.id === tab.paneId);
      const screen = pane && snapshot.screens.find((item) => item.id === pane.screenId);
      if (!tab || !pane || !screen) return Promise.resolve();
      return mutate(async (client) => {
        const workspace = session(client).workspace(screen.workspaceId);
        await workspace.focus();
        await workspace.screen(screen.id).focus();
        await workspace.screen(screen.id).pane(pane.id).focus();
        await workspace.screen(screen.id).pane(pane.id).tab(tab.id).focus();
      });
    },
  }), [mutate, session, snapshot]);

  const recover = useCallback(async () => {
    setStatus("starting");
    setError(null);
    try {
      await recoverBackend();
      setGeneration((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus(snapshot === null ? "error" : "reconnecting");
    }
  }, [snapshot]);

  return {
    status,
    error,
    snapshot,
    tree: snapshot ? projectSnapshot(snapshot) : [],
    client: clientRef.current,
    actions,
    retry: () => setGeneration((value) => value + 1),
    recover,
  };
}
