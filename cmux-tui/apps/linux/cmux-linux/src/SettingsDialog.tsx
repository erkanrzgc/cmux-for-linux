import { useEffect, useState } from "react";
import type { AppearancePreferences, TerminalFontFamily, TerminalFontWeight } from "./appearance";
import { detectAgents, type AgentDetection } from "./backend";
import { t } from "./i18n";

interface SettingsDialogProps {
  readonly appearance: AppearancePreferences;
  readonly onAppearanceChange: (appearance: AppearancePreferences) => void;
  readonly onClose: () => void;
}

export function SettingsDialog({ appearance, onAppearanceChange, onClose }: SettingsDialogProps) {
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

  const update = (next: Partial<AppearancePreferences>) => {
    onAppearanceChange({ ...appearance, ...next });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal settings-dialog" role="dialog" aria-modal="true" aria-label={t("settings")}>
        <header><div><h2>{t("settings")}</h2><p>{t("settingsIntro")}</p></div><button onClick={onClose}>{t("close")}</button></header>
        <section className="settings-section" aria-labelledby="appearance-heading">
          <div className="section-heading"><h3 id="appearance-heading">{t("appearance")}</h3><span>{t("livePreview")}</span></div>
          <label className="setting-row">
            <span><strong>{t("terminalFont")}</strong><small>{t("terminalFontDescription")}</small></span>
            <select value={appearance.terminalFontFamily} onChange={(event) => update({ terminalFontFamily: event.target.value as TerminalFontFamily })}>
              <option value="jetbrains">{t("jetbrainsNerdFont")}</option>
              <option value="system">{t("systemMonospace")}</option>
            </select>
          </label>
          <label className="setting-row">
            <span><strong>{t("fontWeight")}</strong><small>{t("fontWeightDescription")}</small></span>
            <select value={appearance.terminalFontWeight} onChange={(event) => update({ terminalFontWeight: Number(event.target.value) as TerminalFontWeight })}>
              <option value="400">{t("regular")}</option>
              <option value="500">{t("medium")}</option>
              <option value="600">{t("semibold")}</option>
            </select>
          </label>
          <label className="setting-row toggle-row">
            <span><strong>{t("glassChrome")}</strong><small>{t("glassChromeDescription")}</small></span>
            <input type="checkbox" checked={appearance.glassChrome} onChange={(event) => update({ glassChrome: event.target.checked })} />
          </label>
          <label className="setting-row toggle-row">
            <span><strong>{t("animatedWaves")}</strong><small>{t("animatedWavesDescription")}</small></span>
            <input type="checkbox" checked={appearance.animatedWaves} disabled={!appearance.glassChrome} onChange={(event) => update({ animatedWaves: event.target.checked })} />
          </label>
        </section>
        <section className="settings-section" aria-labelledby="agents-heading">
          <div className="section-heading"><h3 id="agents-heading">{t("detectedAgents")}</h3></div>
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
      </section>
    </div>
  );
}
