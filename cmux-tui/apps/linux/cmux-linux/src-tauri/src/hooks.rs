use serde::Serialize;
use std::ffi::OsStr;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum AgentProvider {
    Codex,
    Claude,
    Gemini,
}

impl AgentProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }
}

fn stop_arguments() -> [&'static str; 5] {
    ["--json", "server", "stop", "--session", "cmux-linux"]
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    provider: AgentProvider,
    detected: bool,
    path: Option<String>,
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

fn executable_on_path(provider: AgentProvider, path: Option<&OsStr>) -> Option<PathBuf> {
    let path = path?;
    std::env::split_paths(path)
        .map(|directory| directory.join(provider.as_str()))
        .find(|candidate| is_executable(candidate))
}

fn detect_agents_from_path(path: Option<&OsStr>) -> Vec<AgentDetection> {
    [AgentProvider::Codex, AgentProvider::Claude, AgentProvider::Gemini]
        .into_iter()
        .map(|provider| {
            let executable = executable_on_path(provider, path);
            AgentDetection {
                provider,
                detected: executable.is_some(),
                path: executable.map(|value| value.to_string_lossy().into_owned()),
            }
        })
        .collect()
}

pub fn detect_agents() -> Vec<AgentDetection> {
    let path = std::env::var_os("PATH");
    detect_agents_from_path(path.as_deref())
}

pub async fn stop_managed_session(app: &AppHandle) -> Result<(), String> {
    let output = app
        .shell()
        .sidecar("cmux-tui")
        .map_err(|error| format!("bundled cmux-tui sidecar is unavailable: {error}"))?
        .args(stop_arguments())
        .output()
        .await
        .map_err(|error| format!("cannot request managed backend shutdown: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn agent_detection_requires_an_executable_on_path() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let directory = std::env::temp_dir()
            .join(format!("limux-agent-detection-{}-{nonce}", std::process::id()));
        fs::create_dir(&directory).unwrap();

        let codex = directory.join("codex");
        fs::File::create(&codex).unwrap().write_all(b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&codex, fs::Permissions::from_mode(0o755)).unwrap();
        let claude = directory.join("claude");
        fs::File::create(&claude).unwrap().write_all(b"not executable\n").unwrap();
        fs::set_permissions(&claude, fs::Permissions::from_mode(0o644)).unwrap();

        let detections = detect_agents_from_path(Some(directory.as_os_str()));
        assert!(detections[0].detected);
        assert_eq!(detections[0].path.as_deref(), codex.to_str());
        assert!(!detections[1].detected);
        assert!(detections[1].path.is_none());
        assert!(!detections[2].detected);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn managed_shutdown_targets_only_the_cmux_linux_session() {
        assert_eq!(stop_arguments(), ["--json", "server", "stop", "--session", "cmux-linux"],);
    }
}
