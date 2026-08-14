# Bundled sidecars

Release and development preparation must place these executable files here:

- `cmux-tui-x86_64-unknown-linux-gnu`
- `cmux-tui-hook-x86_64-unknown-linux-gnu`

They are built from the matching upstream source revision. Tauri strips the
target suffix when installing them and resolves them through `externalBin`.
No downloaded or unverified binary is committed to this directory.
