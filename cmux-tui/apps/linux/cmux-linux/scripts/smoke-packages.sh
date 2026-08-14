#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
deb=$(find "$app_dir/src-tauri/target/release/bundle/deb" -maxdepth 1 -name '*.deb' -print -quit)
appimage=$(find "$app_dir/src-tauri/target/release/bundle/appimage" -maxdepth 1 -name '*.AppImage' -print -quit)

if [ -z "$deb" ] || [ -z "$appimage" ]; then
  echo "cmux-linux smoke: expected both a Debian package and an AppImage" >&2
  exit 1
fi

apt-get install -y "$deb"
cmux-linux-cli --version
chmod 0755 "$appimage"
APPIMAGE_EXTRACT_AND_RUN=1 "$appimage" --cli --version

smoke_root=$(mktemp -d)
desktop_pid=
cleanup() {
  if [ -n "$desktop_pid" ]; then
    kill "$desktop_pid" 2>/dev/null || true
    wait "$desktop_pid" 2>/dev/null || true
  fi
  HOME="$smoke_root/home" \
    XDG_STATE_HOME="$smoke_root/state" \
    XDG_RUNTIME_DIR="$smoke_root/runtime" \
    cmux-linux-cli server stop --session cmux-linux >/dev/null 2>&1 || true
  rm -rf "$smoke_root"
}
trap cleanup EXIT INT TERM

mkdir -p "$smoke_root/home" "$smoke_root/state" "$smoke_root/runtime"
chmod 0700 "$smoke_root/home" "$smoke_root/state" "$smoke_root/runtime"

HOME="$smoke_root/home" \
XDG_STATE_HOME="$smoke_root/state" \
XDG_RUNTIME_DIR="$smoke_root/runtime" \
dbus-run-session -- xvfb-run -a cmux-linux >"$smoke_root/desktop.log" 2>&1 &
desktop_pid=$!

metadata="$smoke_root/state/cmux-linux/backend.json"
token="$smoke_root/runtime/cmux-linux/access-token"
attempt=0
while [ "$attempt" -lt 30 ] && { [ ! -s "$metadata" ] || [ ! -s "$token" ]; }; do
  if ! kill -0 "$desktop_pid" 2>/dev/null; then
    cat "$smoke_root/desktop.log" >&2
    echo "cmux-linux smoke: desktop exited before backend startup" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ ! -s "$metadata" ] || [ ! -s "$token" ]; then
  cat "$smoke_root/desktop.log" >&2
  echo "cmux-linux smoke: desktop did not publish managed backend credentials" >&2
  exit 1
fi

test "$(stat -c '%a' "$metadata")" = "600"
test "$(stat -c '%a' "$token")" = "600"
node -e '
  const fs = require("node:fs");
  const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (metadata.session !== "cmux-linux") throw new Error(`unexpected session: ${metadata.session}`);
  if (metadata.protocol !== "cmux.protocol/2") throw new Error(`unexpected protocol: ${metadata.protocol}`);
  if (!/^ws:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(metadata.wsUrl)) {
    throw new Error(`backend is not loopback-only: ${metadata.wsUrl}`);
  }
' "$metadata"

echo "cmux-linux package and GUI smoke passed"
