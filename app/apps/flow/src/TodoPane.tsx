import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TODO_VISIBLE_MS, type TodoHistoryEntry, type TodoItem } from "@patchbay/core";

import { TodoPreparationControls } from "./TodoPreparationPanel.js";
import { useTodoReorder } from "./useTodoReorder.js";

type TodoRow = TodoItem & { running?: boolean };
type HistoryDetail = { summary: string; conversation: string };

function todoError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message) ? "연결을 확인하고 있습니다. 잠시 후 다시 시도해 주세요." : message;
}

function dateText(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 미기록";
  const day = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  return withTime ? `${day} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : day;
}

function TodoDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="todo-modal" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}><header><h3>{title}</h3><button type="button" onClick={onClose} aria-label="닫기">×</button></header>{children}</dialog>;
}

export function TodoPane({ project, revision, suggestions }: { project: string; revision: number; suggestions: TodoItem[] }) {
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TodoHistoryEntry[]>([]);
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0);
  const pending = useRef(false);
  const signature = JSON.stringify(suggestions);

  useEffect(() => {
    ++generation.current;
    setTodos([]); setError(null); setMenu(null); setExpanded(null); setAddOpen(false); setHistoryOpen(false);
    return () => { ++generation.current; };
  }, [project]);

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const body = await res.json() as T & { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? "할일 요청에 실패했습니다.");
    return body;
  }
  async function load() { return json<{ todos: TodoRow[] }>(`/api/todos?alias=${encodeURIComponent(project)}`); }
  useEffect(() => {
    const token = generation.current;
    let closed = false;
    const valid = () => !closed && generation.current === token;
    async function refresh() {
      if (pending.current) return;
      try { const body = await load(); if (valid()) { setTodos(body.todos); setClock(Date.now()); setError(null); } }
      catch (reason) { if (valid()) setError(todoError(reason)); }
    }
    void (async () => {
      try {
        const session = await json<{ role: string }>("/api/session");
        if (!valid()) return;
        setCanWrite(session.role === "write");
        if (session.role === "write") await json("/api/todos/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, action: "sync", suggestions: JSON.parse(signature) }) });
        await refresh();
      } catch (reason) { if (valid()) setError(todoError(reason)); await refresh(); }
    })();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { closed = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [project, signature]);

  useEffect(() => {
    const token = generation.current;
    if (!pending.current) void load().then(body => { if (generation.current === token) { setTodos(body.todos); setClock(Date.now()); setError(null); } }).catch(() => undefined);
  }, [revision]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest(".todo-menu-wrap, .todo-menu")) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [menu]);

  async function act(action: Record<string, unknown>) {
    if (pending.current || !canWrite) return;
    const token = generation.current;
    pending.current = true; setBusy(true); setError(null); setMenu(null);
    try {
      const result = await json<{ roomId?: string }>("/api/todos/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, ...action }) });
      if (generation.current !== token) return;
      const body = await load();
      if (generation.current !== token) return;
      setTodos(body.todos); setClock(Date.now());
      if (action.action === "add") { setAddOpen(false); setTitle(""); setDetail(""); }
      if (result.roomId) {
        const hash = `#room/${encodeURIComponent(project)}/${encodeURIComponent(result.roomId)}`;
        if (window.location.hash === hash) window.dispatchEvent(new Event("hashchange"));
        else window.location.hash = hash;
      }
    } catch (reason) { if (generation.current === token) setError(todoError(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  const active = todos.filter(todo => !todo.done && !todo.inactive);
  const completed = todos.filter(todo => todo.done && todo.completedAt && clock - Date.parse(todo.completedAt) < TODO_VISIBLE_MS).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const movable = active.filter(todo => !todo.running);
  function move(todo: TodoRow, direction: -1 | 1) {
    const index = movable.findIndex(row => row.id === todo.id);
    const target = index + direction;
    if (target < 0 || target >= movable.length) return;
    void act({ action: "move", id: todo.id, beforeId: direction === -1 ? movable[target]!.id : movable[target + 1]?.id ?? null });
  }
  const reorder = useTodoReorder({ project, rows: active, enabled: canWrite && !busy, onMove: (id, beforeId) => { void act({ action: "move", id, beforeId }); } });
  async function openHistory() {
    setHistoryOpen(true); setHistory([]); setHistoryDetail(null); setHistoryError(null); setQuery("");
    const token = generation.current;
    try { const result = await json<{ entries: TodoHistoryEntry[] }>(`/api/todos/history?alias=${encodeURIComponent(project)}`); if (generation.current === token) setHistory(result.entries); }
    catch (reason) { if (generation.current === token) setHistoryError(todoError(reason)); }
  }
  async function showHistory(id: string) {
    const token = generation.current;
    setHistoryDetail(null); setHistoryError(null);
    try { const result = await json<HistoryDetail>(`/api/todos/history?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`); if (generation.current === token) setHistoryDetail(result); }
    catch (reason) { if (generation.current === token) setHistoryError(todoError(reason)); }
  }

  return <aside className="main-todos todo-pane">
    <header><h3>Tasks</h3><span className="todo-count" aria-label={`진행할 할일 총 ${active.length}건`}>{active.length}건</span><div className="todo-header-actions"><TodoPreparationControls key={project} project={project} todos={todos} canWrite={canWrite} /><button type="button" className="todo-add" aria-label="신규 할일 추가" disabled={busy || !canWrite} onClick={() => { setError(null); setAddOpen(true); }}>+</button><button type="button" className="todo-search" aria-label="할일 기록 찾기" title="할일 기록 찾기" onClick={() => void openHistory()}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg></button></div></header>
    {error ? <p className="flow-error todo-error" role="alert">{error}</p> : null}
    <div ref={reorder.list} className={`todo-active-list${reorder.drag ? " is-reordering" : ""}`} tabIndex={active.length > 6 ? 0 : undefined} aria-label="진행할 할일" onScroll={() => setMenu(null)}>{active.map(todo => {
      const index = movable.findIndex(row => row.id === todo.id);
      return <article key={todo.id} data-todo-id={todo.id} className={`todo-row${todo.running ? " is-running" : ""}${reorder.drag?.id === todo.id ? " is-dragging" : ""}${reorder.drag?.targetId === todo.id ? reorder.drag.after ? " is-drop-after" : " is-drop-before" : ""}`} style={reorder.drag?.id === todo.id ? { transform: `translateY(${reorder.drag.offset}px)` } : undefined} onPointerDown={event => reorder.start(event, todo)} onClickCapture={event => { if (reorder.suppressClick()) { event.preventDefault(); event.stopPropagation(); } }}>
        <div className="todo-row-head">
        <span className="todo-node" role={todo.running ? "img" : undefined} aria-label={todo.running ? "진행 중" : undefined} aria-hidden={todo.running ? undefined : true} />
        <button type="button" className="todo-title" title={todo.title} aria-expanded={expanded === todo.id} onKeyDown={event => { if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); if (!todo.running && !busy && canWrite) move(todo, event.key === "ArrowUp" ? -1 : 1); } }} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onClick={() => setExpanded(expanded === todo.id ? null : todo.id)}><b>{todo.title}</b></button>
        <div className="todo-menu-wrap"><button type="button" className="todo-more" aria-label={`${todo.title} 메뉴`} aria-expanded={menu === todo.id} disabled={busy} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenuPosition({ top: Math.max(8, Math.min(window.innerHeight - 202, rect.bottom)), left: Math.max(8, rect.right - 166) }); setMenu(menu === todo.id ? null : todo.id); }}>…</button>{menu === todo.id ? createPortal(<div className="todo-menu" style={menuPosition}><button type="button" disabled={!canWrite} onClick={() => void act({ action: "room", id: todo.id })}>{todo.roomId ? "대화창 열기" : "대화창 만들기"}</button><button type="button" disabled={!canWrite || todo.running || index <= 0} onClick={() => move(todo, -1)}>위로 이동</button><button type="button" disabled={!canWrite || todo.running || index < 0 || index === movable.length - 1} onClick={() => move(todo, 1)}>아래로 이동</button><button type="button" disabled={!canWrite || todo.running} onClick={() => void act({ action: "delete", id: todo.id })}>삭제</button></div>, document.body) : null}</div></div>
        {expanded === todo.id && todo.detail ? <p className="todo-detail">{todo.detail}</p> : null}
      </article>;
    })}</div>
    <div className="todo-completed-head"><b>완료된 할일 <small>{completed.length}건</small></b><small>최근 3일</small></div>
    <div className="todo-completed-list" tabIndex={completed.length > 4 ? 0 : undefined} aria-label="완료된 할일">{completed.map(todo => <div className="todo-completed-row" key={todo.id}><button type="button" title={todo.title} onClick={() => { void openHistory().then(() => showHistory(todo.id)); }}><del>{todo.title}</del></button></div>)}</div>
    {addOpen ? <TodoDialog title="신규 할일" onClose={() => setAddOpen(false)}><form onSubmit={event => { event.preventDefault(); void act({ action: "add", title: title.trim(), detail: detail.trim() }); }}><label>제목<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label><label>요구사항<textarea maxLength={2000} rows={4} value={detail} onChange={event => setDetail(event.target.value)} /></label>{error ? <p className="flow-error" role="alert">{error}</p> : null}<div className="todo-form-actions"><button type="button" disabled={busy} onClick={() => setAddOpen(false)}>취소</button><button type="submit" className="main-primary" disabled={busy || !title.trim()}>{busy ? "저장 중…" : "추가"}</button></div></form></TodoDialog> : null}
    {historyOpen ? <TodoDialog title="할일 기록" onClose={() => setHistoryOpen(false)}><label className="todo-history-search">기록 검색<input value={query} onChange={event => setQuery(event.target.value)} placeholder="제목 · 요구사항 · ID" /></label>{historyError ? <p className="flow-error" role="alert">{historyError}</p> : null}<div className="todo-history-table"><table><thead><tr><th>제목</th><th>등록일</th><th>완료 일시</th><th>대화</th><th>폴더</th></tr></thead><tbody>{history.filter(row => `${row.title} ${row.detail ?? ""} ${row.id} ${row.roomId ?? ""}`.toLowerCase().includes(query.toLowerCase())).map(row => <tr key={row.id}><td><button type="button" onClick={() => void showHistory(row.id)}>{row.title}</button><small>{row.id}</small></td><td>{dateText(row.at)}</td><td>{dateText(row.completedAt, true)}</td><td>{row.roomId ?? "—"}</td><td>{row.folder}</td></tr>)}</tbody></table></div>{!history.length ? <p className="main-empty">저장된 기록이 없습니다.</p> : null}{historyDetail ? <div className="todo-history-detail"><pre>{historyDetail.summary}</pre>{historyDetail.conversation ? <details open><summary>보관된 대화</summary><pre>{historyDetail.conversation}</pre></details> : null}</div> : null}</TodoDialog> : null}
  </aside>;
}
