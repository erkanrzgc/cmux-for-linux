import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";

export type BackendState = "started" | "adopted" | "healthy";

export interface BackendConnection {
  readonly wsUrl: string;
  readonly token: string;
  readonly session: string;
  readonly protocol: "cmux.protocol/2";
  readonly state: BackendState;
}

export interface AgentDetection {
  readonly provider: "codex" | "claude" | "gemini";
  readonly detected: boolean;
  readonly path: string | null;
}

export const ensureBackend = (): Promise<BackendConnection> =>
  invoke("ensure_backend");

export const recoverBackend = (): Promise<BackendConnection> =>
  invoke("recover_backend");

export const detectAgents = (): Promise<AgentDetection[]> => invoke("detect_agents");

export const pickWorkspaceDirectory = async (defaultPath?: string, title?: string): Promise<string | null> => {
  const selected = await open({
    canCreateDirectories: true,
    defaultPath,
    directory: true,
    multiple: false,
    title,
  });
  return Array.isArray(selected) ? selected[0] ?? null : selected;
};

export const notifyWhenUnfocused = (title: string, body: string): Promise<void> =>
  invoke("notify_if_unfocused", { title, body });

export const stopSessionsAndExit = (): Promise<void> => invoke("stop_sessions_and_exit");

export const writeClipboard = (text: string): Promise<void> => writeText(text);
