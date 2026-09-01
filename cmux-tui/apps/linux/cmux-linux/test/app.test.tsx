import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  retry: vi.fn(),
  recover: vi.fn().mockResolvedValue(undefined),
  newTab: vi.fn().mockResolvedValue(undefined),
  split: vi.fn().mockResolvedValue(undefined),
  jumpToNotification: vi.fn().mockResolvedValue(undefined),
  connection: {} as Record<string, unknown>,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../src/backend", () => ({
  detectAgents: vi.fn().mockResolvedValue([]),
  pickWorkspaceDirectory: vi.fn().mockResolvedValue(null),
  stopSessionsAndExit: vi.fn(),
  writeClipboard: vi.fn(),
}));
vi.mock("../src/ResourceTerminal", () => ({
  ResourceTerminal: () => <div>attached terminal</div>,
}));
vi.mock("../src/useDesktopClient", () => ({
  useDesktopClient: () => mocks.connection,
}));

function connected(contentKind: "terminal" | "browser" = "terminal") {
  const terminal = { id: "terminal:1", title: "shell" };
  const tab = {
    id: "tab:1",
    name: "main",
    contentKind,
    contentId: contentKind === "terminal" ? terminal.id : "browser:1",
  };
  const pane = {
    id: "pane:1",
    focused: true,
    zoomed: false,
    tabs: [tab],
    activeTab: tab,
    terminal: contentKind === "terminal" ? terminal : undefined,
  };
  const screenModel = { id: "screen:1", focused: true, name: null, panes: [pane] };
  const workspace = { id: "workspace:1", focused: true, name: "work", screens: [screenModel] };
  return {
    status: "connected",
    error: null,
    tree: [workspace],
    snapshot: {
      notifications: [{
        id: "notification:1",
        title: "Build finished",
        body: "ready",
        unread: true,
        terminalId: "terminal:1",
      }],
    },
    client: {
      session: () => ({ terminal: () => ({}) }),
    },
    actions: {
      createWorkspace: vi.fn(),
      focusWorkspace: vi.fn(),
      renameWorkspace: vi.fn(),
      closeWorkspace: vi.fn(),
      focusScreen: vi.fn(),
      focusPane: vi.fn(),
      focusTab: vi.fn(),
      newTab: mocks.newTab,
      split: mocks.split,
      zoomPane: vi.fn(),
      closePane: vi.fn(),
      jumpToNotification: mocks.jumpToNotification,
    },
    retry: mocks.retry,
    recover: mocks.recover,
  };
}

describe("cmux-linux desktop shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection = connected();
  });

  it("routes tab, split, and unread-notification controls through the shared SDK actions", () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole("button", { name: "New tab" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to latest unread" }));

    expect(mocks.newTab).toHaveBeenCalledWith("workspace:1", "screen:1", "pane:1");
    expect(mocks.split).toHaveBeenCalledWith("workspace:1", "screen:1", "pane:1", "right");
    expect(mocks.jumpToNotification).toHaveBeenCalledWith(expect.objectContaining({
      id: "notification:1",
      terminalId: "terminal:1",
    }));
  });

  it("presents Limux branding with compact pane actions", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Limux" })).toBeInTheDocument();
    const paneActions = screen.getByRole("toolbar", { name: "Pane actions" });
    expect(paneActions).toHaveClass("pane-actions");
    expect(screen.getByRole("button", { name: "Split right" })).toHaveClass("icon-button");
    expect(within(paneActions).getByRole("button", { name: "Close pane" })).toHaveClass("icon-button");
  });

  it("shows an explicit unsupported panel for browser surfaces", () => {
    mocks.connection = connected("browser");
    render(<App />);

    expect(screen.getByText("The built-in browser is not supported in this version.")).toBeInTheDocument();
  });

  it("offers retry and managed recovery when the backend cannot be adopted safely", () => {
    mocks.connection = {
      status: "error",
      error: "stale metadata",
      snapshot: null,
      tree: [],
      retry: mocks.retry,
      recover: mocks.recover,
    };
    render(<App />);

    expect(screen.getByText("stale metadata")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Start a new managed backend" }));

    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(mocks.recover).toHaveBeenCalledOnce();
  });
});
