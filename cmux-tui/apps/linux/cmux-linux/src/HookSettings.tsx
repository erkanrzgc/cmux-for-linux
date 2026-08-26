import { useEffect, useState } from "react";
import { detectAgents, type AgentDetection } from "./backend";
import { t } from "./i18n";

export function HookSettings({ onClose }: { readonly onClose: () => void }) {
  const [results, setResults] = useState<AgentDetection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detectAgents().then((next) => {
      if (!cancelled) setResults(next);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label={t("settings")}>
        <header><h2>{t("settings")}</h2><button onClick={onClose}>{t("close")}</button></header>
        <p>{t("agentDetectionIntro")}</p>
        {!results && !error && <p>{t("detectingAgents")}</p>}
        {error && <p className="agent-detection-error">{t("commandFailed", { error })}</p>}
        {results?.map((result) => (
          <article className="hook-provider" key={result.provider}>
            <div>
              <strong>{result.provider}</strong>
              {result.path && <pre>{result.path}</pre>}
            </div>
            <span className={`agent-detection ${result.detected ? "detected" : "missing"}`}>
              {t(result.detected ? "detected" : "notDetected")}
            </span>
          </article>
        ))}
      </section>
    </div>
  );
}
