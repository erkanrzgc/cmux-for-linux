use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tokio::sync::{Mutex, oneshot};
use tokio::time::{Duration, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

const SESSION: &str = "cmux-linux";
const PROTOCOL: &str = "cmux.protocol/2";
const SCHEMA: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendConnection {
    pub ws_url: String,
    pub token: String,
    pub session: String,
    pub protocol: String,
    pub state: BackendState,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendState {
    Started,
    Adopted,
    Healthy,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct BackendMetadata {
    schema: u32,
    session: String,
    protocol: String,
    ws_url: String,
    token_path: PathBuf,
}

#[derive(Default)]
pub struct BackendManager {
    current: Mutex<Option<BackendConnection>>,
}

#[derive(Clone, Debug)]
struct ManagedPaths {
    state_directory: PathBuf,
    runtime_directory: PathBuf,
    metadata: PathBuf,
    token: PathBuf,
}

impl ManagedPaths {
    fn discover() -> Result<Self, String> {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is required to manage the cmux-linux backend".to_string())?;
        let state_root = std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/state"));
        let state_directory = state_root.join("cmux-linux");
        let runtime_directory = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| state_directory.join("runtime"))
            .join("cmux-linux");
        Ok(Self {
            metadata: state_directory.join("backend.json"),
            token: runtime_directory.join("access-token"),
            state_directory,
            runtime_directory,
        })
    }

    fn prepare(&self) -> Result<(), String> {
        secure_directory(&self.state_directory)?;
        secure_directory(&self.runtime_directory)
    }
}

impl BackendManager {
    pub async fn ensure(&self, app: &AppHandle) -> Result<BackendConnection, String> {
        let mut guard = self.current.lock().await;
        if let Some(connection) = guard.as_ref() {
            health_check(connection).await?;
            let mut healthy = connection.clone();
            healthy.state = BackendState::Healthy;
            return Ok(healthy);
        }
        let paths = ManagedPaths::discover()?;
        paths.prepare()?;
        if paths.metadata.exists() {
            let adopted = adopt(&paths).await?;
            *guard = Some(adopted.clone());
            return Ok(adopted);
        }
        let started = start(app, &paths).await?;
        *guard = Some(started.clone());
        Ok(started)
    }

    pub async fn recover(&self, app: &AppHandle) -> Result<BackendConnection, String> {
        let mut guard = self.current.lock().await;
        let paths = ManagedPaths::discover()?;
        paths.prepare()?;
        quarantine(&paths.metadata)?;
        quarantine(&paths.token)?;
        let started = start(app, &paths).await?;
        *guard = Some(started.clone());
        Ok(started)
    }
}

async fn adopt(paths: &ManagedPaths) -> Result<BackendConnection, String> {
    let connection = load_connection(paths)?;
    health_check(&connection).await.map_err(|error| {
        format!("stale or incompatible backend metadata: {error}; no process was stopped")
    })?;
    Ok(connection)
}

fn load_connection(paths: &ManagedPaths) -> Result<BackendConnection, String> {
    require_private_file(&paths.metadata)?;
    let metadata: BackendMetadata = serde_json::from_slice(
        &fs::read(&paths.metadata)
            .map_err(|error| format!("cannot read backend metadata: {error}"))?,
    )
    .map_err(|error| format!("backend metadata is invalid: {error}"))?;
    if metadata.schema != SCHEMA || metadata.session != SESSION || metadata.protocol != PROTOCOL {
        return Err("backend metadata is incompatible; no process was stopped".into());
    }
    if metadata.token_path != paths.token {
        return Err("backend metadata points outside the managed runtime directory".into());
    }
    require_private_file(&metadata.token_path)?;
    let token = fs::read_to_string(&metadata.token_path)
        .map_err(|error| format!("cannot read backend access token: {error}"))?;
    Ok(BackendConnection {
        ws_url: metadata.ws_url,
        token: token.trim().to_string(),
        session: metadata.session,
        protocol: metadata.protocol,
        state: BackendState::Adopted,
    })
}

async fn start(app: &AppHandle, paths: &ManagedPaths) -> Result<BackendConnection, String> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    atomic_private_write(&paths.token, token.as_bytes())?;
    let state_path = paths.state_directory.join("session");
    secure_directory(&state_path)?;
    let arguments = vec![
        "server".to_string(),
        "start".to_string(),
        "--headless".to_string(),
        "--session".to_string(),
        SESSION.to_string(),
        "--state".to_string(),
        state_path.to_string_lossy().into_owned(),
        "--ws".to_string(),
        "127.0.0.1:0".to_string(),
        "--ws-token".to_string(),
        token.clone(),
    ];
    let command = app
        .shell()
        .sidecar("cmux-tui")
        .map_err(|error| format!("bundled cmux-tui sidecar is unavailable: {error}"))?
        .args(arguments);
    let (mut events, _child) = command
        .spawn()
        .map_err(|error| format!("cannot start bundled cmux-tui sidecar: {error}"))?;
    let (address_sender, address_receiver) = oneshot::channel::<Result<String, String>>();
    tauri::async_runtime::spawn(async move {
        let mut sender = Some(address_sender);
        let mut startup_output = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(bytes) | CommandEvent::Stdout(bytes) => {
                    startup_output.push_str(&String::from_utf8_lossy(&bytes));
                    if startup_output.len() > 32 * 1024 {
                        let mut cutoff = startup_output.len() - 16 * 1024;
                        while !startup_output.is_char_boundary(cutoff) {
                            cutoff += 1;
                        }
                        startup_output.drain(..cutoff);
                    }
                    if let Some(address) = websocket_address(&startup_output)
                        && let Some(sender) = sender.take()
                    {
                        let _ = sender.send(Ok(address));
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Err(format!(
                            "cmux-tui exited before becoming ready (code {:?})",
                            payload.code,
                        )));
                    }
                }
                CommandEvent::Error(error) => {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Err(format!("cmux-tui sidecar failed: {error}")));
                    }
                }
                _ => {}
            }
        }
    });
    let ws_url = timeout(Duration::from_secs(15), address_receiver)
        .await
        .map_err(|_| {
            "cmux-tui did not publish its WebSocket address within 15 seconds".to_string()
        })?
        .map_err(|_| "cmux-tui output ended before startup completed".to_string())??;
    let connection = BackendConnection {
        ws_url,
        token,
        session: SESSION.into(),
        protocol: PROTOCOL.into(),
        state: BackendState::Started,
    };
    health_check(&connection).await?;
    let metadata = BackendMetadata {
        schema: SCHEMA,
        session: SESSION.into(),
        protocol: PROTOCOL.into(),
        ws_url: connection.ws_url.clone(),
        token_path: paths.token.clone(),
    };
    atomic_private_write(
        &paths.metadata,
        &serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("cannot encode backend metadata: {error}"))?,
    )?;
    Ok(connection)
}

fn websocket_address(output: &str) -> Option<String> {
    let marker = "WebSocket control at ";
    output.lines().find_map(|line| {
        let address = line.split_once(marker)?.1.trim();
        is_loopback_websocket(address).then(|| address.to_string())
    })
}

fn is_loopback_websocket(address: &str) -> bool {
    address
        .strip_prefix("ws://")
        .and_then(|value| value.parse::<SocketAddrV4>().ok())
        .is_some_and(|socket| socket.ip() == &Ipv4Addr::LOCALHOST && socket.port() != 0)
}

async fn health_check(connection: &BackendConnection) -> Result<(), String> {
    if connection.protocol != PROTOCOL || connection.session != SESSION {
        return Err("backend identity does not match cmux-linux".into());
    }
    if !is_loopback_websocket(&connection.ws_url) {
        return Err("backend metadata does not contain an IPv4 loopback WebSocket".into());
    }
    let (mut socket, _) = timeout(Duration::from_secs(3), connect_async(&connection.ws_url))
        .await
        .map_err(|_| "backend WebSocket connection timed out".to_string())?
        .map_err(|error| format!("backend WebSocket is unavailable: {error}"))?;
    socket
        .send(Message::Text(json!({ "auth": { "token": connection.token } }).to_string().into()))
        .await
        .map_err(|error| format!("backend authentication failed: {error}"))?;
    socket
        .send(Message::Text(
            json!({
                "protocol": PROTOCOL,
                "type": "request",
                "id": "cmux-linux-health",
                "operation": "session.get",
                "params": { "machine": "current", "session": "current" }
            })
            .to_string()
            .into(),
        ))
        .await
        .map_err(|error| format!("backend health request failed: {error}"))?;
    let response = timeout(Duration::from_secs(3), socket.next())
        .await
        .map_err(|_| "backend protocol response timed out".to_string())?
        .ok_or_else(|| "backend closed during protocol validation".to_string())?
        .map_err(|error| format!("backend protocol response failed: {error}"))?;
    let Message::Text(text) = response else {
        return Err("backend returned a non-text protocol response".into());
    };
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("backend returned invalid protocol JSON: {error}"))?;
    if value["protocol"] != PROTOCOL
        || value["type"] != "response"
        || value["id"] != "cmux-linux-health"
        || value["ok"] != true
        || value["result"]["name"] != SESSION
    {
        return Err("backend failed cmux.protocol/2 session identity validation".into());
    }
    let _ = socket.close(None).await;
    Ok(())
}

fn secure_directory(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path)
        && (!metadata.file_type().is_dir() || metadata.file_type().is_symlink())
    {
        return Err(format!("{} is not a private directory", path.display()));
    }
    fs::create_dir_all(path)
        .map_err(|error| format!("cannot create {}: {error}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("cannot protect {}: {error}", path.display()))
}

fn atomic_private_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "managed path has no parent".to_string())?;
    secure_directory(parent)?;
    let file_name = path.file_name().ok_or_else(|| "managed path has no file name".to_string())?;
    let temporary = parent.join(format!(".{}.{}.tmp", file_name.to_string_lossy(), Uuid::new_v4()));
    let result = (|| -> io::Result<()> {
        let mut file =
            OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| format!("cannot atomically write {}: {error}", path.display()))
}

fn require_private_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err(format!("{} is not a regular private file", path.display()));
    }
    // SAFETY: `geteuid` has no preconditions and only reads the process credentials.
    if metadata.mode() & 0o077 != 0 || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(format!("{} must be owned by the current user with mode 0600", path.display()));
    }
    Ok(())
}

fn quarantine(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock is invalid: {error}"))?
        .as_secs();
    let destination = path.with_extension(format!("stale-{timestamp}-{}", Uuid::new_v4()));
    fs::rename(path, destination)
        .map_err(|error| format!("cannot quarantine stale {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_paths() -> ManagedPaths {
        let root = std::env::temp_dir().join(format!("cmux-linux-test-{}", Uuid::new_v4()));
        let state_directory = root.join("state");
        let runtime_directory = root.join("runtime");
        ManagedPaths {
            metadata: state_directory.join("backend.json"),
            token: runtime_directory.join("access-token"),
            state_directory,
            runtime_directory,
        }
    }

    fn write_metadata(paths: &ManagedPaths, metadata: &BackendMetadata, token: &str) {
        paths.prepare().unwrap();
        atomic_private_write(&paths.token, token.as_bytes()).unwrap();
        atomic_private_write(&paths.metadata, &serde_json::to_vec(metadata).unwrap()).unwrap();
    }

    fn valid_metadata(paths: &ManagedPaths) -> BackendMetadata {
        BackendMetadata {
            schema: SCHEMA,
            session: SESSION.into(),
            protocol: PROTOCOL.into(),
            ws_url: "ws://127.0.0.1:43111".into(),
            token_path: paths.token.clone(),
        }
    }

    #[test]
    fn extracts_only_loopback_websocket_addresses() {
        assert_eq!(
            websocket_address("cmux-tui: WebSocket control at ws://127.0.0.1:43111\n"),
            Some("ws://127.0.0.1:43111".into()),
        );
        assert_eq!(websocket_address("cmux-tui: WebSocket control at ws://0.0.0.0:43111\n"), None,);
        assert_eq!(websocket_address("cmux-tui: WebSocket control at ws://127.0.0.1:0\n"), None,);
        assert_eq!(
            websocket_address("cmux-tui: WebSocket control at ws://127.0.0.1:43111/path\n"),
            None,
        );
    }

    #[test]
    fn private_file_validation_rejects_group_readable_tokens() {
        let directory = std::env::temp_dir().join(format!("cmux-linux-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let token = directory.join("token");
        fs::write(&token, "secret").unwrap();
        fs::set_permissions(&token, fs::Permissions::from_mode(0o640)).unwrap();
        assert!(require_private_file(&token).is_err());
        fs::set_permissions(&token, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(require_private_file(&token).is_ok());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn loads_only_compatible_metadata_from_the_managed_token_path() {
        let paths = temporary_paths();
        write_metadata(&paths, &valid_metadata(&paths), " secret\n");

        let connection = load_connection(&paths).unwrap();
        assert_eq!(connection.ws_url, "ws://127.0.0.1:43111");
        assert_eq!(connection.token, "secret");
        assert_eq!(connection.session, SESSION);
        assert_eq!(connection.protocol, PROTOCOL);

        let mut incompatible = valid_metadata(&paths);
        incompatible.protocol = "cmux.protocol/999".into();
        atomic_private_write(&paths.metadata, &serde_json::to_vec(&incompatible).unwrap()).unwrap();
        assert!(load_connection(&paths).unwrap_err().contains("incompatible"));

        let _ = fs::remove_dir_all(paths.state_directory.parent().unwrap());
    }

    #[test]
    fn rejects_metadata_that_points_at_an_unmanaged_token() {
        let paths = temporary_paths();
        let mut metadata = valid_metadata(&paths);
        metadata.token_path = paths.state_directory.join("outside-token");
        write_metadata(&paths, &metadata, "secret");

        assert!(load_connection(&paths).unwrap_err().contains("outside"));

        let _ = fs::remove_dir_all(paths.state_directory.parent().unwrap());
    }

    #[test]
    fn atomic_private_write_replaces_contents_and_preserves_private_mode() {
        let paths = temporary_paths();
        paths.prepare().unwrap();

        atomic_private_write(&paths.token, b"first").unwrap();
        atomic_private_write(&paths.token, b"second").unwrap();

        assert_eq!(fs::read(&paths.token).unwrap(), b"second");
        assert_eq!(fs::metadata(&paths.token).unwrap().mode() & 0o777, 0o600);
        assert!(fs::read_dir(&paths.runtime_directory)
            .unwrap()
            .all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".tmp")));

        let _ = fs::remove_dir_all(paths.state_directory.parent().unwrap());
    }

    #[test]
    fn secure_directory_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let paths = temporary_paths();
        let root = paths.state_directory.parent().unwrap();
        fs::create_dir_all(root).unwrap();
        let destination = root.join("destination");
        fs::create_dir(&destination).unwrap();
        symlink(&destination, &paths.state_directory).unwrap();

        assert!(secure_directory(&paths.state_directory).unwrap_err().contains("private directory"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn quarantine_moves_stale_files_without_deleting_them() {
        let paths = temporary_paths();
        paths.prepare().unwrap();
        atomic_private_write(&paths.metadata, b"stale").unwrap();

        quarantine(&paths.metadata).unwrap();

        assert!(!paths.metadata.exists());
        let quarantined = fs::read_dir(&paths.state_directory)
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| entry.file_name().to_string_lossy().contains("stale-"))
            .expect("quarantined metadata");
        assert_eq!(fs::read(quarantined.path()).unwrap(), b"stale");

        let _ = fs::remove_dir_all(paths.state_directory.parent().unwrap());
    }
}
