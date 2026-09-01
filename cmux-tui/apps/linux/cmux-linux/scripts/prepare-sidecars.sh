#!/bin/sh
set -eu

app_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tui_dir=$(CDPATH= cd -- "$app_dir/../../.." && pwd)
target=${CARGO_BUILD_TARGET:-x86_64-unknown-linux-gnu}

case "$target" in
  x86_64-unknown-linux-gnu) ;;
  *)
    echo "cmux-linux: unsupported sidecar target: $target" >&2
    exit 1
    ;;
esac

cd "$tui_dir"
cargo build --locked --release -p cmux-tui --bin cmux-tui --bin cmux-tui-hook --target "$target"
install -m 0755 "target/$target/release/cmux-tui" \
  "$app_dir/src-tauri/binaries/cmux-tui-$target"
install -m 0755 "target/$target/release/cmux-tui-hook" \
  "$app_dir/src-tauri/binaries/cmux-tui-hook-$target"
