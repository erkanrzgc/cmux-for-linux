import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({
  closeTab: vi.fn().mockResolvedValue(undefined),
  closePane: vi.fn().mockResolvedValue(undefined),
  closeWorkspace: vi.fn().mockResolvedValue(undefined),
  copyScreen: vi.fn().mockResolvedValue({ text: "copied terminal screen" }),
  createWorkspace: vi.fn().mockResolvedValue(undefined),
  focusPane: vi.fn().mockResolvedValue(undefined),
  focusScreen: vi.fn().mockResolvedValue(undefined),
  focusTab: vi.fn().mockResolvedValue(undefined),
  focusWorkspace: vi.fn().mockResolvedValue(undefined),
  handlers: new Map<string, () => void | Promise<void>>(),
  detectAgents: vi.fn(),
  jumpToNotification: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
  newTab: vi.fn().mockResolvedValue(undefined),
  recover: vi.fn().mockResolvedValue(undefined),
  renameWorkspace: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn(),
  split: vi.fn().mockResolvedValue(undefined),
  stopSessionsAndExit: vi.fn().mockResolvedValue(undefined),
  writeClipboard: vi.fn().mockResolvedValue(undefined),
  zoomPane: vi.fn().mockResolvedValue(undefined),
  connection: {} as Record<string, unknown>,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));
vi.mock("../src/backend", () => ({
  detectAgents: mocks.detectAgents,
  stopSessionsAndExit: mocks.stopSessionsAndExit,
  writeClipboard: mocks.writeClipboard,
}));
vi.mock("../src/ResourceTerminal", () => ({
  ResourceTerminal: () => <div>attached terminal</div>,
}));
vi.mock("../src/useDesktopClient", () => ({
  useDesktopClient: () => mocks.connection,
}));

function pane(id: string, focused: boolean, names: string[]) {
  const tabs = names.map((name, index) => ({
    id: `tab:${id}:${index + 1}`,
    name,
    focused: index === 0,
    contentKind: "terminal" as const,
    contentId: `terminal:${id}:${index + 1}`,
  }));
  return {
    id: `pane:${id}`,
    focused,
    zoomed: false,
    tabs,
    activeTab: tabs[0],
    terminal: { id: tabs[0]!.contentId, title: names[0] },
  };
}

function connected() {
  const primaryPane = pane("primary", true, ["main", "logs"]);
  const secondaryPane = pane("secondary", false, ["aux"]);
  const primaryScreen = {
    id: "screen:primary",
    focused: true,
    name: null,
    panes: [primaryPane, secondaryPane],
  };
  const reviewScreen = {
    id: "screen:review",
    focused: false,
    name: "Review",
    panes: [pane("review", true, ["review-shell"])],
  };
  const activeWorkspace = {
    id: "workspace:active",
    focused: true,
    name: "work",
    screens: [primaryScreen, reviewScreen],
  };
  const idleWorkspace = {
    id: "workspace:idle",
    focused: false,
    name: "idle",
    screens: [{ id: "screen:idle", focused: true, name: null, panes: [pane("idle", true, ["idle-shell"])] }],
  };
  return {
    status: "connected",
    error: null,
    tree: [activeWorkspace, idleWorkspace],
    snapshot: {
      notifications: [{
        id: "notification:build",
        title: "Build finished",
        body: "ready",
        unread: true,
        terminalId: primaryPane.terminal.id,
      }],
    },
    client: {
      session: () => ({ terminal: () => ({ copy: mocks.copyScreen }) }),
    },
    actions: {
      closePane: mocks.closePane,
      closeTab: mocks.closeTab,
      closeWorkspace: mocks.closeWorkspace,
      createWorkspace: mocks.createWorkspace,
      focusPane: mocks.focusPane,
      focusScreen: mocks.focusScreen,
      focusTab: mocks.focusTab,
      focusWorkspace: mocks.focusWorkspace,
      jumpToNotification: mocks.jumpToNotification,
      newTab: mocks.newTab,
      renameWorkspace: mocks.renameWorkspace,
      split: mocks.split,
      zoomPane: mocks.zoomPane,
    },
    retry: mocks.retry,
    recover: mocks.recover,
  };
}

describe("Limux desktop button drive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.listen.mockImplementation(async (event: string, handler: () => void | Promise<void>) => {
      mocks.handlers.set(event, handler);
      return vi.fn();
    });
    mocks.detectAgents.mockResolvedValue([
      { provider: "codex", detected: true, path: "/usr/bin/codex" },
      { provider: "claude", detected: true, path: "/usr/bin/claude" },
      { provider: "gemini", detected: false, path: null },
    ]);
    mocks.connection = connected();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("drives every workspace button through its shared action", () => {
    vi.spyOn(window, "prompt")
      .mockReturnValueOnce("created workspace")
      .mockReturnValueOnce("renamed workspace");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^idle/ }));
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Close workspace" }));

    expect(mocks.focusWorkspace).toHaveBeenCalledWith("workspace:idle");
    expect(mocks.createWorkspace).toHaveBeenCalledWith("created workspace");
    expect(mocks.renameWorkspace).toHaveBeenCalledWith("workspace:active", "renamed workspace");
    expect(mocks.closeWorkspace).toHaveBeenCalledWith("workspace:active");
  });

  it("drives every screen, tab, pane, notification, and pane-toolbar button", async () => {
    const view = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "logs" }));
    const panes = [...view.container.querySelectorAll<HTMLElement>(".pane")];
    fireEvent.pointerDown(panes[1]!);
    fireEvent.click(within(panes[0]!).getByRole("button", { name: "New tab" }));
    fireEvent.click(within(panes[1]!).getByRole("button", { name: "New tab" }));
    const logsTab = within(panes[0]!).getByText("logs").closest(".tab-item")!;
    fireEvent.click(within(logsTab as HTMLElement).getByRole("button", { name: "Close tab" }));

    const toolbar = screen.getByRole("toolbar", { name: "Pane actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "New tab" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Split right" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Split down" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Zoom" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Copy screen" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Close pane" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to latest unread" }));
    fireEvent.click(screen.getByRole("button", { name: /Build finished/ }));

    expect(mocks.focusScreen).toHaveBeenCalledWith("workspace:active", "screen:review");
    expect(mocks.focusTab).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", "tab:primary:2");
    expect(mocks.focusPane).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:secondary");
    expect(mocks.focusPane).toHaveBeenCalledTimes(1);
    expect(mocks.newTab).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary");
    expect(mocks.newTab).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:secondary");
    expect(mocks.closeTab).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", "tab:primary:2");
    expect(mocks.split).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", "right");
    expect(mocks.split).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", "down");
    expect(mocks.zoomPane).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", true);
    expect(mocks.closePane).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary");
    expect(mocks.closePane).toHaveBeenCalledTimes(1);
    expect(mocks.jumpToNotification).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.copyScreen).toHaveBeenCalledWith("screen"));
    await waitFor(() => expect(mocks.writeClipboard).toHaveBeenCalledWith("copied terminal screen"));
    expect(await screen.findByText("Screen copied.")).toBeInTheDocument();
  });

  it("closes a terminal tab while protecting the final pane", () => {
    const connection = connected();
    connection.tree[0]!.screens[0]!.panes = connection.tree[0]!.screens[0]!.panes.slice(0, 1);
    mocks.connection = connection;
    render(<App />);

    expect(screen.getByRole("button", { name: "Close pane" })).toBeDisabled();
    const logsTab = screen.getByText("logs").closest(".tab-item")!;
    fireEvent.click(within(logsTab as HTMLElement).getByRole("button", { name: "Close tab" }));

    expect(mocks.closeTab).toHaveBeenCalledWith(
      "workspace:active", "screen:primary", "pane:primary", "tab:primary:2",
    );
  });

  it("renders only the active pane while zoomed and disables no-op single-pane zoom", () => {
    const connection = connected();
    connection.tree[0]!.screens[0]!.panes[0]!.zoomed = true;
    mocks.connection = connection;
    const view = render(<App />);

    expect(view.container.querySelectorAll(".pane")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();

    connection.tree[0]!.screens[0]!.panes = connection.tree[0]!.screens[0]!.panes.slice(0, 1);
    connection.tree[0]!.screens[0]!.panes[0]!.zoomed = false;
    view.rerender(<App />);
    expect(screen.getByRole("button", { name: "Zoom" })).toBeDisabled();
  });

  it("detects installed agents without offering hook mutations", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Detected agents" }));
    const dialog = screen.getByRole("dialog", { name: "Detected agents" });
    await waitFor(() => expect(mocks.detectAgents).toHaveBeenCalledOnce());

    expect(within(dialog).getAllByText("Detected")).toHaveLength(2);
    expect(within(dialog).getByText("Not detected")).toBeInTheDocument();
    expect(within(dialog).getByText("/usr/bin/codex")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Uninstall" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Detected agents" })).not.toBeInTheDocument();
  });

  it("drives retry and recovery from the reconnect banner", () => {
    mocks.connection = { ...connected(), status: "reconnecting", error: "connection dropped" };
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Start a new managed backend" }));

    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.recover).toHaveBeenCalledOnce();
  });

  it("drives the tray stop request only after confirmation", async () => {
    render(<App />);
    await waitFor(() => expect(mocks.handlers.has("request-stop-sessions")).toBe(true));

    await act(async () => { await mocks.handlers.get("request-stop-sessions")?.(); });

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Stop all cmux-linux sessions"));
    expect(mocks.stopSessionsAndExit).toHaveBeenCalledOnce();
  });
});
