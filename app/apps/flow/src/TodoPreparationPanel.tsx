import { useEffect, useRef, useState } from "react";
import { PREPARATION_LABELS, type RoomMember, type TodoItem, type TodoPreparation } from "@patchbay/core";

type State = { items: TodoPreparation[]; running: boolean };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error ?? "준비 작업 요청에 실패했습니다.");
  return result as T;
}
function usePreparations(project: string, roomId?: string) {
  const suffix = roomId ? `&roomId=${encodeURIComponent(roomId)}` : "&summary=1";
  const [state, setState] = useState<State>({ items: [], running: false });
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setState({ items: [], running: false }); setError("");
    async function load() {
      try { const result = await request<State>(`/api/todo-preparations?alias=${encodeURIComponent(project)}${suffix}`); if (token === generation.current) { setState(result); setError(""); } }
      catch (e) { if (token === generation.current) setError((e as Error).message); }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 2500);
    return () => { ++generation.current; clearInterval(timer); };
  }, [project, roomId]);
  return { state, error, setError, refresh: async () => { const token = generation.current; const result = await request<State>(`/api/todo-preparations?alias=${encodeURIComponent(project)}${suffix}`); if (token === generation.current) setState(result); } };
}
export function TodoPreparationControls({ project, todos, canWrite }: { project: string; todos: TodoItem[]; canWrite: boolean }) {
  const { state, error, setError, refresh } = usePreparations(project);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [memberId, setMemberId] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  async function choose() {
    setError(""); setOpen(true); setBusy(true);
    try {
      const body = await request<{ agents: RoomMember[] }>(`/api/agents?alias=${encodeURIComponent(project)}`);
      const choices = body.agents.filter(m => m.id && m.enabled !== false && ["claude-code", "codex"].includes(m.speaker));
      setMembers(choices); setMemberId(choices[0]?.id ?? "");
      setSelected(state.running ? items.map(v => v.todoId) : todos.filter(t => !t.done && !t.inactive).slice(0, 5).map(t => t.id)); setOpen(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function start() {
    setBusy(true); setError("");
    try { await request("/api/todo-preparations/start", { alias: project, ids: selected, memberId }); setOpen(false); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const batch = state.items.at(-1)?.batchId;
  const items = state.items.filter(v => v.batchId === batch);
  const count = items.filter(v => ["ready", "waiting", "held", "done", "stale"].includes(v.status)).length;
  return <div className="todo-auto-control">
    <button type="button" className={`todo-auto-icon${state.running ? " is-running" : ""}`} aria-label="자동 업무 수행" aria-haspopup="dialog" aria-expanded={open} title={state.running ? `자동 업무 수행 중 · ${count}/${items.length}` : "자동 업무 수행"} disabled={!canWrite || busy || (!state.running && !todos.some(t => !t.done && !t.inactive))} onClick={() => void choose()}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.8 6.7a6.2 6.2 0 0 0-10.4-1L3.5 8M3.5 4.7V8h3.3M4.2 13.3a6.2 6.2 0 0 0 10.4 1l1.9-2.3m0 3.3V12h-3.3"/><path d="m10.8 6.8-3 3.8h2.7l-1.3 2.6 3.2-3.8H9.8z"/></svg>
    </button>
    {open ? <dialog ref={dialog} className="todo-modal prep-selection" aria-label="미리 준비할 할일" onCancel={e => { e.preventDefault(); setOpen(false); }}><header><h3>미리 준비할 할일</h3><button type="button" onClick={() => setOpen(false)} aria-label="닫기">×</button></header><p>진행할 할일을 선택하고 아래 실행을 누르세요. 최대 5개를 목록 순서대로 준비합니다.</p>{items.length ? <div className="prep-dialog-status"><div className="prep-heading"><span>{state.running ? "자동 준비 중" : "최근 준비"} · {count}/{items.length}</span>{state.running && canWrite ? <button type="button" onClick={() => { void request("/api/todo-preparations/action", { alias: project, action: "stop" }).then(refresh).catch(e => setError(e.message)); }}>중지</button> : null}</div><div className="prep-batch-items">{items.map(v => <a key={v.id} href={`#room/${encodeURIComponent(project)}/${encodeURIComponent(v.roomId)}`} onClick={() => setOpen(false)}><span>{v.title}</span><small>{PREPARATION_LABELS[v.status]}</small></a>)}</div></div> : null}<div className="prep-select-list">{todos.filter(t => !t.done && !t.inactive).map((t, i) => <label key={t.id}><input type="checkbox" checked={selected.includes(t.id)} disabled={busy || state.running || (!selected.includes(t.id) && selected.length === 5)} onChange={e => setSelected(old => e.target.checked ? [...old, t.id] : old.filter(id => id !== t.id))} /><span>{String(i + 1).padStart(2, "0")} · {t.title}</span></label>)}</div><label>주 담당 LLM<select aria-label="주 담당 LLM" disabled={busy || state.running} value={memberId} onChange={e => setMemberId(e.target.value)}>{members.map(m => <option key={m.id} value={m.id}>{m.name || m.speaker} {m.model}</option>)}</select></label>{!members.length ? <p>LLM 설정에서 Claude 또는 Codex 담당을 먼저 등록해주세요.</p> : null}<p className="thread-note">준비 중에는 원본 파일을 바꾸지 않습니다. 완료한 산출물은 해당 할일 대화에서 검토합니다.</p>{error ? <p role="alert" className="flow-error">{error}</p> : null}<div className="todo-form-actions"><span>{selected.length}/5개 선택</span><button type="button" disabled={busy || state.running || !selected.length || !memberId} onClick={() => void start()}>{busy ? "시작 중…" : "실행"}</button></div></dialog> : null}
  </div>;
}
export function TodoPreparationReview({ project, roomId, readOnly }: { project: string; roomId: string; readOnly: boolean }) {
  const { state, error, setError, refresh } = usePreparations(project, roomId);
  const v = state.items.find(v => v.roomId === roomId);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setEditing(false); setConfirming(false); setNote(""); }, [roomId, v?.id]);
  if (!v) return error ? <p className="thread-err">{error}</p> : null;
  const version = v;
  async function act(action: string) {
    setBusy(true); setError("");
    try { await request("/api/todo-preparations/action", { alias: project, id: version.id, action, note }); setConfirming(false); setEditing(false); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function download(index: number) {
    const a = version.artifacts[index]!;
    const blob = new Blob([a.content], { type: a.format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = a.name.replace(/[\\/]/g, "-") + ({ html: ".html", markdown: ".md", text: ".txt", diff: ".patch" })[a.format]; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const blocked = busy || readOnly || state.running;
  return <section className="prep-review" aria-label="미리 준비한 결과">
    <header className="prep-heading"><div><small>미리 준비한 대화</small><h3>{v.mode?.name ?? "업무 판단 중"}</h3></div><span className={`prep-status is-${v.status}`}>{PREPARATION_LABELS[v.status]}</span></header>
    <small>{v.member.name || v.member.speaker} · {new Date(v.at).toLocaleString()} · 준비본 {v.id.slice(0, 8)}</small>
    {v.reason ? <p>{v.reason}</p> : null}
    {v.dependencies.length ? <div className="prep-dependencies" aria-label="앞선 할일과의 연결">{v.dependencies.map(d => { const source = state.items.find(item => item.todoId === d.todoId); return <div className="prep-dependency" key={d.todoId}><span>↘ {d.kind === "required" ? "필수 선행" : "참고"} · {source ? <a href={`#room/${encodeURIComponent(project)}/${encodeURIComponent(source.roomId)}`}>{source.title}</a> : d.todoId}</span><small>{d.reason}</small>{source && source.status !== "done" ? <small>미승인 결과를 참고했습니다.</small> : null}</div>; })}<div className="prep-current">↓ 현재 할일 · {v.title}</div></div> : null}
    {v.plan.length ? <details open><summary>수행 계획</summary><ol>{v.plan.map((step, i) => <li key={i}>{step}</li>)}</ol></details> : null}
    <div className="prep-artifacts">{v.artifacts.map((a, i) => <details key={i} open={i === 0}><summary>산출물 · {a.name} <span>{a.format}</span></summary>{a.format === "html" ? <iframe title={`${a.name} 미리보기`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${a.content}`} /> : <pre>{a.content}</pre>}<button type="button" onClick={() => download(i)}>산출물 내려받기</button></details>)}</div>
    {v.completion.length ? <details><summary>완료 조건 {v.completion.length}개</summary><ul>{v.completion.map((c, i) => <li key={i}>{c}</li>)}</ul></details> : null}
    {v.remaining ? <p className="prep-remaining"><b>승인 후 남은 작업</b><br />{v.remaining}</p> : null}
    {v.error ? <p className="prep-warning" role="status">{v.error}</p> : null}
    {v.result ? <p className="prep-result">{v.result}</p> : null}
    {error ? <p className="thread-err" role="alert">{error}</p> : null}
    {!readOnly && !["done", "queued", "preparing", "applying"].includes(v.status) ? <div className="prep-actions">
      {["ready", "held"].includes(v.status) && v.artifacts.length ? <button type="button" className="prep-primary" disabled={blocked} onClick={() => setConfirming(true)}>그대로 진행</button> : null}
      <button type="button" disabled={blocked} onClick={() => setEditing(open => !open)}>수정 요청</button><button type="button" disabled={blocked} onClick={() => void act("reprepare")}>다시 준비</button>{v.status !== "held" ? <button type="button" disabled={blocked} onClick={() => void act("hold")}>보류</button> : null}
    </div> : null}
    {confirming ? <div className="prep-confirm" role="group" aria-label="준비본 실행 확인"><p>이 준비본의 산출물로 실제 작업을 진행할까요? 원본과 선행 결과를 확인한 뒤 실행합니다.</p><button type="button" disabled={blocked} onClick={() => void act("approve")}>확인한 준비본 실행</button><button type="button" onClick={() => setConfirming(false)}>취소</button></div> : null}
    {editing ? <form onSubmit={e => { e.preventDefault(); void act("revise"); }}><textarea aria-label="준비본 수정 요청" maxLength={4000} value={note} onChange={e => setNote(e.target.value)} placeholder="수정할 내용을 적어주세요" /><button type="submit" disabled={blocked || !note.trim()}>수정해서 다시 준비</button></form> : null}
  </section>;
}
