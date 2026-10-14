import { useState } from "react";

export function AddProjectDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (alias: string) => void;
}) {
  const [dir, setDir] = useState("");
  const [alias, setAlias] = useState("");
  const [forceAdd, setForceAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: dir,
          ...(alias.trim() ? { alias: alias.trim() } : {}),
          forceAdd,
        }),
      });
      const body = (await res.json()) as { alias?: string; error?: string };
      if (!res.ok) {
        setNote(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.alias) onAdded(body.alias);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-modal" role="dialog" aria-labelledby="add-project-title">
      <div className="ws-modal-card">
        <header className="ws-modal-head">
          <h2 id="add-project-title">신규 프로젝트</h2>
          <button type="button" className="flow-btn phase-close" aria-label="닫기" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="muted">
          이 컴퓨터의 폴더를 작업 공간에 등록한다. CLI <code>patchbay project add --path</code> 와 같은 일이다.
        </p>
        <label className="ws-field">
          폴더 경로
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="/Users/…/my-notes"
            autoFocus
          />
        </label>
        <label className="ws-field">
          이름 <span className="muted">(비우면 폴더 이름)</span>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="practice" />
        </label>
        <label className="ws-check">
          <input type="checkbox" checked={forceAdd} onChange={(e) => setForceAdd(e.target.checked)} />
          명확도 문턱을 넘지 않아도 등록
        </label>
        {note ? <p className="flow-error">{note}</p> : null}
        <div className="ws-modal-actions">
          <button type="button" className="flow-btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="flow-btn primary" disabled={busy || !dir.trim()} onClick={() => void submit()}>
            {busy ? "등록 중" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
