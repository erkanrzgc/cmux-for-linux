import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({
  closePane: vi.fn().mockResolvedValue(undefined),
  closeWorkspace: vi.fn().mockResolvedValue(undefined),
  copyScreen: vi.fn().mockResolvedValue({ text: "copied terminal screen" }),
  createWorkspace: vi.fn().mockResolvedValue(undefined),
  focusPane: vi.fn().mockResolvedValue(undefined),
  focusScreen: vi.fn().mockResolvedValue(undefined),
  focusTab: vi.fn().mockResolvedValue(undefined),
  focusWorkspace: vi.fn().mockResolvedValue(undefined),
  handlers: new Map<string, () => void | Promise<void>>(),
  hookOperation: vi.fn(),
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
  hookOperation: mocks.hookOperation,
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
    mocks.hookOperation.mockImplementation(async (provider: string, action: string) => ({
      provider,
      action,
      success: true,
      stdout: `${provider}:${action}`,
      stderr: "",
    }));
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
    const paneClose = within(panes[1]!).getByRole("button", { name: "Close pane" });
    fireEvent.pointerDown(paneClose);
    fireEvent.click(paneClose);

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
    expect(mocks.closePane).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:secondary");
    expect(mocks.split).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", "right");
    expect(mocks.split).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", "down");
    expect(mocks.zoomPane).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary", true);
    expect(mocks.closePane).toHaveBeenCalledWith("workspace:active", "screen:primary", "pane:primary");
    expect(mocks.closePane).toHaveBeenCalledTimes(2);
    expect(mocks.jumpToNotification).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.copyScreen).toHaveBeenCalledWith("screen"));
    await waitFor(() => expect(mocks.writeClipboard).toHaveBeenCalledWith("copied terminal screen"));
  });

  it("does not offer an invalid close action for the final pane", () => {
    const connection = connected();
    connection.tree[0]!.screens[0]!.panes = connection.tree[0]!.screens[0]!.panes.slice(0, 1);
    mocks.connection = connection;
    render(<App />);

    const closeButtons = screen.getAllByRole("button", { name: "Close pane" });
    expect(closeButtons).toHaveLength(2);
    for (const button of closeButtons) {
      expect(button).toBeDisabled();
    }
  });

  it("drives every hook settings button for every provider", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Agent hooks" }));
    const dialog = screen.getByRole("dialog", { name: "Agent hooks" });
    await waitFor(() => expect(mocks.hookOperation).toHaveBeenCalledTimes(3));
    mocks.hookOperation.mockClear();

    for (const provider of ["codex", "claude", "gemini"]) {
      const article = within(dialog).getByText(provider).closest("article")!;
      for (const action of ["Status", "Install", "Uninstall"]) {
        await waitFor(() => expect(within(article).getByRole("button", { name: action })).toBeEnabled());
        fireEvent.click(within(article).getByRole("button", { name: action }));
        await waitFor(() => expect(mocks.hookOperation).toHaveBeenCalledWith(provider, action.toLowerCase()));
      }
    }

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Agent hooks" })).not.toBeInTheDocument();
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
