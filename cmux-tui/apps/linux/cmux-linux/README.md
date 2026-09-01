# cmux-linux

`cmux-linux` is an unofficial, GPL-3.0-or-later Linux desktop fork of cmux. It
targets Debian 12 and Kali Linux on x86_64 and embeds the upstream `cmux-tui`
backend. The desktop frontend consumes only the public `cmux-sdk/browser`
resource API (`cmux.protocol/2`); it does not extend the wire protocol.

## Development

Prerequisites are Node.js 22, the Rust and Zig toolchains pinned by the
repository (Rust 1.95 at this revision), WebKitGTK 4.1 development headers,
GTK 3 development headers, and Ayatana AppIndicator development headers. On
Debian 12:

```sh
sudo apt-get install build-essential curl file libayatana-appindicator3-dev \
  libgtk-3-dev librsvg2-dev libssl-dev libwebkit2gtk-4.1-dev wget
```

Build the TypeScript SDK, frontend, and matching sidecars before starting
Tauri:

```sh
cd cmux-tui/bindings/typescript
npm ci && npm run build
cd ../../apps/linux/cmux-linux
npm ci
./scripts/prepare-sidecars.sh
npm run tauri dev
```

The application starts `cmux-tui server start --headless --session cmux-linux
--ws 127.0.0.1:0` with a random static WebSocket credential. Metadata is
written atomically with mode `0600` under `$XDG_STATE_HOME`; the token is stored
with mode `0600` under `$XDG_RUNTIME_DIR` when available. Existing backends are
adopted only after a `cmux.protocol/2` session identity request succeeds.

Closing the window hides it. The tray can reopen the UI, exit while preserving
the backend, or request explicit confirmation before stopping the session.
Coding-agent hooks are never installed automatically.

## Packages and CLI

`npm run tauri build` produces `.deb` and AppImage bundles. The Debian package
installs `cmux-linux` and `cmux-linux-cli`; the AppImage exposes the same bundled
CLI as `cmux-linux.AppImage --cli ...`. Neither package replaces `cmux`.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for attribution and
license boundaries.
