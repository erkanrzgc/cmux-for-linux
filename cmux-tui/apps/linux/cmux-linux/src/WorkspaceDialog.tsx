import { useState, type FormEvent } from "react";
import { pickWorkspaceDirectory } from "./backend";
import { t } from "./i18n";

interface WorkspaceDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (name: string | undefined, cwd: string | undefined) => Promise<void>;
}

export function WorkspaceDialog({ onClose, onCreate }: WorkspaceDialogProps) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseDirectory = async () => {
    try {
      const selected = await pickWorkspaceDirectory(cwd || undefined, t("selectWorkspaceDirectory"));
      if (!selected) return;
      setCwd(selected);
      if (!name.trim()) setName(selected.split("/").filter(Boolean).at(-1) ?? "");
    } catch (reason) {
      setError(t("commandFailed", { error: reason instanceof Error ? reason.message : String(reason) }));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim() || undefined, cwd || undefined);
    } catch (reason) {
      setError(t("commandFailed", { error: reason instanceof Error ? reason.message : String(reason) }));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal workspace-dialog" role="dialog" aria-modal="true" aria-label={t("newWorkspace")} onSubmit={submit}>
        <header><div><h2>{t("newWorkspace")}</h2><p>{t("workspaceDialogIntro")}</p></div><button type="button" onClick={onClose}>{t("close")}</button></header>
        <label className="field-row">
          <span>{t("workspaceName")}</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("workspaceNamePlaceholder")} />
        </label>
        <label className="field-row">
          <span>{t("workspaceDirectory")}</span>
          <div className="directory-picker">
            <input readOnly value={cwd} placeholder={t("homeDirectory")} />
            <button type="button" onClick={() => void chooseDirectory()}>{t("chooseDirectory")}</button>
          </div>
          <small>{t("directoryPickerHint")}</small>
        </label>
        {error && <p className="form-error">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>{t("cancel")}</button>
          <button className="primary-action" disabled={busy} type="submit">{busy ? t("creatingWorkspace") : t("createWorkspace")}</button>
        </footer>
      </form>
    </div>
  );
}
