#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
sidecar="$app_dir/src-tauri/binaries/cmux-tui-x86_64-unknown-linux-gnu"
session=cmux-linux-portability-smoke
smoke_root=$(mktemp -d)
server_pid=

cleanup() {
  HOME="$smoke_root/home" \
    XDG_STATE_HOME="$smoke_root/state" \
    XDG_RUNTIME_DIR="$smoke_root/runtime" \
    "$sidecar" --session "$session" --json server stop >/dev/null 2>&1 || true
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_root"
}
trap cleanup EXIT INT TERM

test -x "$sidecar"

# The distributed x86-64 sidecar must run on the architecture baseline. Zig's
# native CPU default can otherwise bake AVX instructions into Ghostty's color
# setup before the terminal host publishes its first snapshot.
palette_disassembly=$(objdump --no-show-raw-insn -d \
  --disassemble=ghostty_color_palette_generate "$sidecar")
if ! printf '%s\n' "$palette_disassembly" | grep -q '<ghostty_color_palette_generate>:'; then
  echo "cmux-linux portability smoke: Ghostty palette symbol was not found" >&2
  exit 1
fi
if printf '%s\n' "$palette_disassembly" | grep -Eq ':[[:space:]]+v[a-z0-9]+'; then
  printf '%s\n' "$palette_disassembly" >&2
  echo "cmux-linux portability smoke: Ghostty palette requires AVX on an x86-64 baseline package" >&2
  exit 1
fi

mkdir -p "$smoke_root/home" "$smoke_root/state" "$smoke_root/runtime"
chmod 0700 "$smoke_root/home" "$smoke_root/state" "$smoke_root/runtime"

HOME="$smoke_root/home" \
XDG_STATE_HOME="$smoke_root/state" \
XDG_RUNTIME_DIR="$smoke_root/runtime" \
valgrind --tool=none --trace-children=yes --error-exitcode=86 --quiet \
  "$sidecar" server start --headless --session "$session" \
  >"$smoke_root/server.log" 2>&1 &
server_pid=$!

socket="$smoke_root/runtime/cmux-tui-$(id -u)/$session.sock"
attempt=0
while [ "$attempt" -lt 60 ] && [ ! -S "$socket" ]; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$smoke_root/server.log" >&2
    echo "cmux-linux portability smoke: server exited before startup" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ ! -S "$socket" ]; then
  cat "$smoke_root/server.log" >&2
  echo "cmux-linux portability smoke: server socket was not published" >&2
  exit 1
fi

HOME="$smoke_root/home" \
XDG_STATE_HOME="$smoke_root/state" \
XDG_RUNTIME_DIR="$smoke_root/runtime" \
"$sidecar" --session "$session" --json workspace create --name "CPU portability smoke"

echo "cmux-linux sidecar CPU portability smoke passed"
