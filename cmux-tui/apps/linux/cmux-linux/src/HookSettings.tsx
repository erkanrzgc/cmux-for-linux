import { useEffect, useState } from "react";
import { hookOperation, type HookResult } from "./backend";
import { t } from "./i18n";

const providers = ["codex", "claude", "gemini"] as const;

export function HookSettings({ onClose }: { readonly onClose: () => void }) {
  const [results, setResults] = useState<Partial<Record<(typeof providers)[number], HookResult>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (provider: (typeof providers)[number], action: HookResult["action"]) => {
    if (action !== "status") {
      const key = action === "install" ? "confirmInstall" : "confirmUninstall";
      if (!window.confirm(t(key, { provider }))) return;
    }
    setBusy(`${provider}:${action}`);
    try {
      const result = await hookOperation(provider, action);
      setResults((current) => ({ ...current, [provider]: result }));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    for (const provider of providers) void run(provider, "status");
  // One explicit status pass when the user opens settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label={t("settings")}>
        <header><h2>{t("settings")}</h2><button onClick={onClose}>{t("close")}</button></header>
        <p>{t("hookIntro")}</p>
        {providers.map((provider) => {
          const result = results[provider];
          return (
            <article className="hook-provider" key={provider}>
              <div>
                <strong>{provider}</strong>
                <pre>{result?.stdout || result?.stderr || t("status")}</pre>
              </div>
              <div className="hook-actions">
                <button disabled={busy !== null} onClick={() => void run(provider, "status")}>{t("status")}</button>
                <button disabled={busy !== null} onClick={() => void run(provider, "install")}>{t("install")}</button>
                <button disabled={busy !== null} onClick={() => void run(provider, "uninstall")}>{t("uninstall")}</button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
