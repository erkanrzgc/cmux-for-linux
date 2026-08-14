import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  RenderCursor,
  RenderRow,
  RenderSnapshot,
  ResourceStream,
  Terminal,
  TerminalAttachItem,
} from "cmux-sdk/browser";
import { encodeTerminalKey } from "../../../../frontends/web/src/lib/keyEncoding";
import { t } from "./i18n";

interface Props {
  readonly terminal: Terminal;
}

function applyPatch(current: RenderSnapshot | null, item: TerminalAttachItem): RenderSnapshot | null {
  if (item.kind === "snapshot" && "render" in item) return item.render;
  if (item.kind !== "patch" || !("render" in item) || current === null) return current;
  const rows = item.render.fullReset ? new Map<number, RenderRow>()
    : new Map(current.rows.map((row) => [row.row, row]));
  for (const row of item.render.rows) rows.set(row.row, row);
  return {
    size: item.render.size ?? current.size,
    cursor: item.render.cursor,
    defaultFg: item.render.defaultFg ?? current.defaultFg,
    defaultBg: item.render.defaultBg ?? current.defaultBg,
    scrollbackRows: item.render.scrollbackRows ?? current.scrollbackRows,
    rows: [...rows.values()].sort((left, right) => left.row - right.row),
  };
}

function cursorStyle(cursor: RenderCursor | undefined): CSSProperties | undefined {
  if (!cursor?.visible) return undefined;
  return {
    left: `calc(${cursor.x} * var(--cell-width))`,
    top: `calc(${cursor.y} * var(--cell-height))`,
    background: cursor.color ?? "var(--accent)",
  };
}

export function ResourceTerminal({ terminal }: Props) {
  const [render, setRender] = useState<RenderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<ResourceStream<TerminalAttachItem> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const streamPromise = terminal.attach({ columns: 100, rows: 32 });
    void (async () => {
      try {
        const stream = await streamPromise;
        streamRef.current = stream;
        for await (const entry of stream) {
          if (cancelled) break;
          setRender((current) => applyPatch(current, entry.value));
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      cancelled = true;
      void streamPromise.then((stream) => stream.cancel()).catch(() => undefined);
      streamRef.current = null;
    };
  }, [terminal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !render) return;
    const observer = new ResizeObserver(([entry]) => {
      const stream = streamRef.current;
      if (!stream?.attachmentLease || !entry) return;
      const columns = Math.max(20, Math.floor(entry.contentRect.width / 8.4));
      const rows = Math.max(5, Math.floor(entry.contentRect.height / 18));
      void terminal.resizeViewer(stream.attachmentLease, { columns, rows }).catch(() => undefined);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [render, terminal]);

  const rows = useMemo(() => render?.rows ?? [], [render]);
  const send = (value: string) => void terminal.write(value).catch((reason) => setError(String(reason)));

  return (
    <div
      className="terminal"
      ref={hostRef}
      onWheel={(event) => {
        event.preventDefault();
        void terminal.scrollViewport(event.deltaY > 0 ? 3 : -3);
      }}
    >
      {!render && !error && <div className="terminal-message">{t("loadingTerminal")}</div>}
      {error && <div className="terminal-error">{error}</div>}
      <div
        className="terminal-grid"
        style={{
          color: render?.defaultFg,
          background: render?.defaultBg,
          minWidth: `calc(${render?.size.cols ?? 0} * var(--cell-width))`,
        }}
        role="log"
      >
        {rows.map((row) => (
          <div className="terminal-row" key={row.row}>
            {row.runs.map((run, index) => (
              <span
                key={index}
                style={{
                  color: run.fg ?? undefined,
                  backgroundColor: run.bg ?? undefined,
                  fontWeight: run.attrs & 1 ? 700 : undefined,
                  textDecoration: run.attrs & 8 ? "underline" : undefined,
                }}
              >{run.text}</span>
            ))}
          </div>
        ))}
        <span className={`terminal-cursor cursor-${render?.cursor.style ?? "block"}`} style={cursorStyle(render?.cursor)} />
      </div>
      <textarea
        className="terminal-input"
        aria-label={t("terminalInput")}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => void terminal.setFocused(true)}
        onBlur={() => void terminal.setFocused(false)}
        onKeyDown={(event) => {
          const action = encodeTerminalKey(event);
          if (action === null) return;
          event.preventDefault();
          if (action.kind === "text") send(action.text);
          else void terminal.keys({ keys: [action.key] }).catch((reason) => setError(String(reason)));
        }}
        onPaste={(event) => {
          event.preventDefault();
          send(event.clipboardData.getData("text"));
        }}
      />
    </div>
  );
}
