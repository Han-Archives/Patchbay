import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { shortLabel } from "./shortLabel.js";
import { CYCLE_LABEL, type CycleStep, type SubStep } from "./ProjectCycleFlow.js";

/**
 * 흐름도 밑 트리 표 — 작업을 누르면 세부 항목이 펼쳐진다 (사용자 결정 2026-10-15, 시안 흐름도-트리표-태그색).
 * 열: 번호 · 항목명 · 상태 · 설명 · 태그 · 실행. 세부 항목은 사용자가 + 로 넣거나 LLM이 계획해 넣는다.
 * ▶ 는 할일 맨 아래에 올린다. LLM이 실제로 실행 중인 세부 항목만 번호 앞 불빛이 깜빡인다.
 */
type Tag = "UI" | "Agent" | "데이터" | "서버" | "문서";
type Status = "wait" | "run" | "done";
interface Item { id: string; step: CycleStep; task: string; name: string; desc: string; tag: Tag; source: "llm" | "user"; status: Status; queued: boolean }

const TAGS: Tag[] = ["UI", "Agent", "데이터", "서버", "문서"];
const TAG_CLASS: Record<Tag, string> = { UI: "ui", Agent: "agent", 데이터: "data", 서버: "server", 문서: "doc" };
const STATUS_LABEL: Record<Status, string> = { wait: "대기 중", run: "진행 중", done: "완료" };


function describe(step: CycleStep, item: SubStep) {
  if (step === "design") return item.label === "채택" ? "검토한 설계를 확인하고 채택합니다." : item.label === "PRD 검토" ? "요구사항의 누락과 열린 질문을 검토합니다." : "요구사항, 범위, 열린 질문을 구체화합니다.";
  if (step === "build") return item.title || "노드의 입력, 처리, 출력을 구현합니다.";
  if (step === "test") return "노드를 실행하고 결과를 확인합니다.";
  return "결과를 정리해 설계에 반영합니다.";
}

const CheckIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>;
const QueueIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h6" /><path d="M11 11.5l1.3 1.3 2.2-2.6" /></svg>;

/**
 * 작업 한 줄의 상태. LLM이 세부 항목을 실행 중이면 진행 중, 끝났으면 완료, 그 밖에 흐름도가 「지금」으로 짚은
 * 세부 단계(지금 단계의 처음 남은 것)도 진행 중이다 — 사람이 지금 하고 있는 일이다 (사용자 요청 2026-10-18).
 */
export function taskStatus(task: { done: boolean; now: boolean }, children: { status: Status }[]): Status {
  if (children.some(item => item.status === "run")) return "run";
  if (task.done || (children.length > 0 && children.every(item => item.status === "done"))) return "done";
  return task.now ? "run" : "wait";
}

function StatusPill({ status }: { status: Status }) {
  return <span className={`cycle-item-status is-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function CycleTaskTable({ project, step, steps, action, onAction }: { project: string; step: CycleStep; steps: SubStep[]; action: string; onAction: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/cycle-items?alias=${encodeURIComponent(project)}`);
        const body = await res.json() as { items?: Item[]; error?: string };
        if (!res.ok || body.error) throw new Error(body.error ?? "세부 항목을 불러오지 못했습니다.");
        if (!cancelled) { setItems(body.items ?? []); setError(null); }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); }
    }
    void load();
    // 실행 불빛은 실제 대화 실행을 따라가야 해서 할일 칸과 같이 3초마다 다시 본다.
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/cycle-items/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, ...body }) });
      const result = await res.json() as { items?: Item[]; error?: string };
      if (!res.ok || result.error) throw new Error(result.error ?? "세부 항목을 바꾸지 못했습니다.");
      setItems(result.items ?? []); setError(null);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusy(false); }
  }

  function toggle(task: string) {
    setOpen(current => { const next = new Set(current); if (next.has(task)) next.delete(task); else next.add(task); return next; });
  }

  async function submit(event: FormEvent<HTMLFormElement>, task: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    if (await act({ action: "add", step, task, name, desc: String(form.get("desc") ?? ""), tag: form.get("tag") })) setAdding(null);
  }

  const own = items.filter(item => item.step === step);
  const known = new Set(steps.map(item => item.label));
  // LLM이 흐름도에 없는 작업 이름으로 계획한 항목도 버리지 않고 맨 아래 작업으로 보인다.
  const extra = [...new Set(own.map(item => item.task))].filter(task => !known.has(task));
  const tasks = [
    ...steps.map(item => ({ label: item.label, title: item.title ?? item.label, desc: describe(step, item), done: item.state === "done", now: item.state === "now" })),
    ...extra.map(task => ({ label: task, title: task, desc: "흐름도에 없는 작업 이름으로 계획된 항목입니다.", done: false, now: false })),
  ];
  const statusOf = (task: { label: string; done: boolean; now: boolean }): Status => taskStatus(task, own.filter(item => item.task === task.label));
  const runningTask = tasks.find(task => statusOf(task) === "run")?.label ?? null;

  // 진행 중인 작업이 바뀔 때만 그 행을 표 맨 위로 올린다. 3초 새로고침마다 올리면 사용자가 내린 스크롤을 빼앗는다.
  useEffect(() => {
    if (!runningTask || scrolledTo.current === runningTask) return;
    const scroller = scrollRef.current;
    const row = scroller?.querySelector<HTMLElement>(`tr[data-task="${CSS.escape(runningTask)}"]`);
    if (!scroller || !row) return;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scrolledTo.current = runningTask;
  }, [runningTask]);

  return <section className="cycle-tasks" aria-label={`${CYCLE_LABEL[step]} 작업 사항`}>
    <header className="cycle-task-header"><div><h4>{CYCLE_LABEL[step]} <span>{tasks.length}개 작업 · 행을 누르면 세부 항목이 펼쳐집니다</span></h4></div><button type="button" className="flow-btn" onClick={onAction}>{action} ↗</button></header>
    {error ? <p className="flow-error">{error}</p> : null}
    {tasks.length ? <div className="cycle-item-scroll" ref={scrollRef}><table className="cycle-item-table">
      <colgroup><col className="c-no" /><col className="c-name" /><col className="c-status" /><col /><col className="c-tag" /><col className="c-run" /></colgroup>
      <thead><tr><th scope="col">번호</th><th scope="col">항목명</th><th scope="col">상태</th><th scope="col">설명</th><th scope="col">태그</th><th scope="col" className="is-right">실행</th></tr></thead>
      <tbody>{tasks.map((task, ti) => {
        const children = own.filter(item => item.task === task.label);
        const status = statusOf(task);
        const isOpen = open.has(task.label);
        const formId = `cycle-add-${step}-${ti}`;
        return <Fragment key={task.label}>
          <tr data-task={task.label} className={`cycle-item-task${isOpen ? " is-open" : ""}${status === "done" ? " is-done" : ""}${status === "run" ? " is-now" : ""}`} onClick={() => toggle(task.label)}>
            <td className="cycle-item-no"><span className="cycle-item-noin"><span className="cycle-item-slot">{status === "run" ? <i className="cycle-item-now" role="img" aria-label="진행 중" /> : null}</span><span>{String(ti + 1).padStart(2, "0")}</span></span></td>
            <td><button type="button" className="cycle-item-toggle" aria-expanded={isOpen} title={task.title} onClick={event => { event.stopPropagation(); toggle(task.label); }}><span className="cycle-item-name">{shortLabel(task.label)}</span></button></td>
            <td><StatusPill status={status} /></td>
            <td className="cycle-item-desc" title={task.desc}>{task.desc}</td>
            <td><span className="cycle-item-tags">{TAGS.map(tag => [tag, children.filter(item => item.tag === tag).length] as const).filter(([, count]) => count).map(([tag, count]) => <span key={tag} className={`cycle-item-tag tag-${TAG_CLASS[tag]}`}>{tag} <b>{count}</b></span>)}</span></td>
            <td />
          </tr>
          {isOpen ? <>
            {children.map((item, ci) => <tr key={item.id} className={`cycle-item-sub tag-${TAG_CLASS[item.tag]}${item.status === "done" ? " is-done" : ""}`}>
              <td className="cycle-item-no"><span className="cycle-item-noin"><span className="cycle-item-slot">{item.status === "run" ? <i className="cycle-item-live" role="img" aria-label="LLM 실행 중" /> : null}</span><span>{ti + 1}.{ci + 1}</span></span></td>
              <td><span className="cycle-item-name" title={item.name}>{shortLabel(item.name)}</span></td>
              <td><StatusPill status={item.status} /></td>
              <td className="cycle-item-desc" title={item.desc}>{item.desc}</td>
              <td><span className={`cycle-item-tag tag-${TAG_CLASS[item.tag]}`}>{item.tag}</span></td>
              <td><div className="cycle-item-run">
                {item.status === "done" ? <span className="cycle-item-icon is-done" role="img" aria-label={`${item.name} 완료`} title="완료"><CheckIcon /></span>
                  : item.status === "run" ? <span className="cycle-item-icon is-queued" role="img" aria-label={`${item.name} 실행 중`} title="실행 중"><QueueIcon /></span>
                  : <>
                    {item.queued
                      ? <button type="button" className="cycle-item-icon is-queued" disabled={busy} aria-label={`${item.name} 할일에 있음, 누르면 할일에서 빼기`} title="할일에 있음 · 누르면 빼기" onClick={() => void act({ action: "unplay", id: item.id })}><QueueIcon /></button>
                      : <button type="button" className="cycle-item-play" disabled={busy} aria-label={`${item.name} 할일로 보내기`} title="할일로 보내기" onClick={() => void act({ action: "play", id: item.id })}>▶</button>}
                    <button type="button" className="cycle-item-minus" disabled={busy} aria-label={`${item.name} 빼기`} title="빼기" onClick={() => void act({ action: "del", id: item.id })}>−</button>
                  </>}
              </div></td>
            </tr>)}
            {adding === task.label
              ? <tr className="cycle-item-sub cycle-item-add" onKeyDown={event => { if (event.key === "Escape") setAdding(null); }}>
                <td className="cycle-item-no"><span className="cycle-item-noin"><span className="cycle-item-slot" /><span>{ti + 1}.{children.length + 1}</span></span></td>
                <td><input form={formId} name="name" required maxLength={80} placeholder="항목명" aria-label="항목명" autoFocus /></td>
                <td><StatusPill status="wait" /></td>
                <td><input form={formId} name="desc" maxLength={200} placeholder="무엇을 하는지 짧게" aria-label="설명" /></td>
                <td><select form={formId} name="tag" aria-label="태그">{TAGS.map(tag => <option key={tag}>{tag}</option>)}</select></td>
                <td><div className="cycle-item-run"><form id={formId} onSubmit={event => void submit(event, task.label)}><button type="submit" className="flow-btn" disabled={busy}>추가</button></form><button type="button" className="cycle-item-minus" aria-label="취소" title="취소" onClick={() => setAdding(null)}>×</button></div></td>
              </tr>
              : <tr className="cycle-item-sub cycle-item-add"><td /><td colSpan={5}><button type="button" className="cycle-item-addbtn" onClick={() => setAdding(task.label)}>+ 세부 항목 추가</button></td></tr>}
          </> : null}
        </Fragment>;
      })}</tbody>
    </table></div> : <p className="main-empty">아직 작업 기록이 없습니다. 단계 화면에서 내용을 확인하세요.</p>}
  </section>;
}
