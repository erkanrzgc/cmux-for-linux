import { describe, expect, it } from "vitest";
import type { ResourceSnapshot } from "cmux-sdk/browser";
import { projectSnapshot } from "../src/model";

describe("resource snapshot projection", () => {
  it("orders workspaces and connects focused terminal tabs without using raw protocol trees", () => {
    const snapshot = {
      workspaces: [
        { id: "workspace:2", index: 1, name: "two", focused: false, sessionId: "session:1", extra: {} },
        { id: "workspace:1", index: 0, name: "one", focused: true, sessionId: "session:1", extra: {} },
      ],
      screens: [{ id: "screen:1", index: 0, name: null, focused: true, workspaceId: "workspace:1", layout: {}, extra: {} }],
      panes: [{ id: "pane:1", name: null, focused: true, zoomed: false, screenId: "screen:1", extra: {} }],
      tabs: [{ id: "tab:1", name: null, index: 0, focused: true, paneId: "pane:1", contentKind: "terminal", contentId: "terminal:1", extra: {} }],
      terminals: [{ id: "terminal:1", tabIds: ["tab:1"], title: "shell", cols: 80, rows: 24, running: true, lifecycle: "running", extra: {} }],
      browsers: [], clients: [], notifications: [], agents: [], frontendProjections: [], sidebarViews: [],
    } as unknown as ResourceSnapshot;

    const result = projectSnapshot(snapshot);
    expect(result.map((workspace) => workspace.name)).toEqual(["one", "two"]);
    expect(result[0]?.screens[0]?.panes[0]?.terminal?.title).toBe("shell");
  });
});
