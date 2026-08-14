import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderSnapshot, Terminal, TerminalAttachItem } from "cmux-sdk/browser";
import { ResourceTerminal } from "../src/ResourceTerminal";

class TestResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

function snapshot(text: string): RenderSnapshot {
  return {
    size: { cols: text.length, rows: 1 },
    cursor: { x: text.length, y: 0, visible: true, style: "block" },
    defaultFg: "#eeeeee",
    defaultBg: "#111111",
    scrollbackRows: 0,
    rows: [{ row: 0, runs: [{ text, fg: null, bg: null, attrs: 0 }] }],
  } as unknown as RenderSnapshot;
}

function terminalWithSnapshot(text: string) {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const stream = {
    attachmentLease: "lease:test",
    cancel,
    async *[Symbol.asyncIterator]() {
      yield {
        value: { kind: "snapshot", render: snapshot(text) } as TerminalAttachItem,
      };
    },
  };
  const terminal = {
    attach: vi.fn().mockResolvedValue(stream),
    write: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue(undefined),
    setFocused: vi.fn().mockResolvedValue(undefined),
    scrollViewport: vi.fn().mockResolvedValue(undefined),
    resizeViewer: vi.fn().mockResolvedValue(undefined),
  };
  return { terminal: terminal as unknown as Terminal, calls: terminal, cancel };
}

describe("ResourceTerminal", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an attached snapshot and routes keyboard, paste, focus, and scroll input", async () => {
    const { terminal, calls } = terminalWithSnapshot("hello");
    render(<ResourceTerminal terminal={terminal} />);

    expect(await screen.findByText("hello")).toBeInTheDocument();
    const input = screen.getByLabelText("Terminal input");

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "a", code: "KeyA" });
    fireEvent.keyDown(input, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.paste(input, { clipboardData: { getData: () => "pasted" } });
    fireEvent.wheel(input.closest(".terminal")!, { deltaY: 100 });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(calls.write).toHaveBeenNthCalledWith(1, "a");
      expect(calls.write).toHaveBeenNthCalledWith(2, "pasted");
      expect(calls.keys).toHaveBeenCalledWith({ keys: ["left"] });
      expect(calls.scrollViewport).toHaveBeenCalledWith(3);
      expect(calls.setFocused).toHaveBeenNthCalledWith(1, true);
      expect(calls.setFocused).toHaveBeenNthCalledWith(2, false);
    });
  });

  it("cancels the attachment when the terminal view unmounts", async () => {
    const { terminal, cancel } = terminalWithSnapshot("ready");
    const view = render(<ResourceTerminal terminal={terminal} />);
    expect(await screen.findByText("ready")).toBeInTheDocument();

    view.unmount();

    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
});
