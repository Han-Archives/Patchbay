import { useEffect, useRef, useState } from "react";

export function ProjectNameEditor({ project, name, folder, readOnly, onRenamed }: {
  project: string; name: string; folder?: string; readOnly: boolean; onRenamed: () => void;
}) {
  const [displayName, setDisplayName] = useState(name);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  useEffect(() => { setDisplayName(name); }, [name]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  function edit() {
    if (readOnly) return;
    setDraft(displayName); setError(""); setOpen(true);
  }
  async function save() {
    if (pending.current || !draft.trim()) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/project/name", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, name: draft.trim() }),
      });
      const body = await response.json() as { name?: string; error?: string };
      if (!response.ok || !body.name) throw new Error(body.error ?? "프로젝트 이름을 변경하지 못했습니다.");
      setDisplayName(body.name); setOpen(false); onRenamed();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(/failed to fetch|load failed|networkerror/i.test(message) ? "연결을 확인한 뒤 다시 시도해 주세요." : message);
    } finally { pending.current = false; setBusy(false); }
  }
  return <>
    <h2>{readOnly ? displayName : <span className="project-name-edit" role="button" tabIndex={0} aria-label="프로젝트 이름 수정" title="두 번 클릭하여 프로젝트 이름 수정" onDoubleClick={edit} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); edit(); } }}>{displayName}</span>}</h2>
    {open ? <dialog ref={dialog} className="todo-modal project-name-dialog" aria-label="프로젝트 이름 수정" onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <header><h3>프로젝트 이름 수정</h3><button type="button" aria-label="닫기" disabled={busy} onClick={() => setOpen(false)}>×</button></header>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label>프로젝트 이름<input autoFocus required maxLength={100} value={draft} disabled={busy} onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)} /></label>
        <p>프로젝트 폴더 이름도 함께 변경됩니다.</p>
        {folder ? <p className="project-name-folder">현재 폴더: {folder}</p> : null}
        {error ? <p className="flow-error" role="alert">{error}</p> : null}
        <div className="todo-form-actions"><button type="button" disabled={busy} onClick={() => setOpen(false)}>취소</button><button type="submit" disabled={busy || !draft.trim()}>{busy ? "저장 중…" : "저장"}</button></div>
      </form>
    </dialog> : null}
  </>;
}
