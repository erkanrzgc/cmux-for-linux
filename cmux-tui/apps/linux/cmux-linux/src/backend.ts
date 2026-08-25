import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export type BackendState = "started" | "adopted" | "healthy";

export interface BackendConnection {
  readonly wsUrl: string;
  readonly token: string;
  readonly session: string;
  readonly protocol: "cmux.protocol/2";
  readonly state: BackendState;
}

export interface HookResult {
  readonly provider: "codex" | "claude" | "gemini";
  readonly action: "status" | "install" | "uninstall";
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export const ensureBackend = (): Promise<BackendConnection> =>
  invoke("ensure_backend");

export const recoverBackend = (): Promise<BackendConnection> =>
  invoke("recover_backend");

export const hookOperation = (
  provider: HookResult["provider"],
  action: HookResult["action"],
): Promise<HookResult> => invoke("agent_hook", { provider, action });

export const notifyWhenUnfocused = (title: string, body: string): Promise<void> =>
  invoke("notify_if_unfocused", { title, body });

export const stopSessionsAndExit = (): Promise<void> => invoke("stop_sessions_and_exit");

export const writeClipboard = (text: string): Promise<void> => writeText(text);
