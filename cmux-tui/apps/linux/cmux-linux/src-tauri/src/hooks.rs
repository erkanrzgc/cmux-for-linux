use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HookProvider {
    Codex,
    Claude,
    Gemini,
}

impl HookProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HookAction {
    Status,
    Install,
    Uninstall,
}

impl HookAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Install => "install",
            Self::Uninstall => "uninstall",
        }
    }
}

fn hook_arguments(provider: HookProvider, action: HookAction) -> [&'static str; 5] {
    ["--json", "agent", "hook", action.as_str(), provider.as_str()]
}

fn stop_arguments() -> [&'static str; 5] {
    ["--json", "server", "stop", "--session", "cmux-linux"]
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookResult {
    provider: HookProvider,
    action: HookAction,
    success: bool,
    stdout: String,
    stderr: String,
}

pub async fn run(
    app: &AppHandle,
    provider: HookProvider,
    action: HookAction,
) -> Result<HookResult, String> {
    let output = app
        .shell()
        .sidecar("cmux-tui")
        .map_err(|error| format!("bundled cmux-tui sidecar is unavailable: {error}"))?
        .args(hook_arguments(provider, action))
        .output()
        .await
        .map_err(|error| format!("cannot run agent hook manager: {error}"))?;
    Ok(HookResult {
        provider,
        action,
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
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

    #[test]
    fn only_supported_hook_providers_have_command_names() {
        assert_eq!(HookProvider::Codex.as_str(), "codex");
        assert_eq!(HookProvider::Claude.as_str(), "claude");
        assert_eq!(HookProvider::Gemini.as_str(), "gemini");
    }

    #[test]
    fn hook_operations_use_the_upstream_json_cli_contract() {
        assert_eq!(
            hook_arguments(HookProvider::Codex, HookAction::Status),
            ["--json", "agent", "hook", "status", "codex"],
        );
        assert_eq!(
            hook_arguments(HookProvider::Claude, HookAction::Install),
            ["--json", "agent", "hook", "install", "claude"],
        );
        assert_eq!(
            hook_arguments(HookProvider::Gemini, HookAction::Uninstall),
            ["--json", "agent", "hook", "uninstall", "gemini"],
        );
    }

    #[test]
    fn managed_shutdown_targets_only_the_cmux_linux_session() {
        assert_eq!(
            stop_arguments(),
            ["--json", "server", "stop", "--session", "cmux-linux"],
        );
    }
}
