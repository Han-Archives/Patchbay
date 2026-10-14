import { useEffect, useState } from "react";
import { ROOM_SPEAKER_LABEL, type RoomExecution, type RoomMember, type RoomPlan } from "@patchbay/core";

const PHASE: Record<RoomExecution["phase"], string> = {
  prepare: "실행 배정 중", approval: "배정 확인", act: "수행 중", check: "검증 중", check_failed: "검증 실패",
  deploy_approval: "적용 조건 확인", deploy: "적용 중", done: "완료", failed: "실패", consult: "상담 재검토", uncertain: "실제 상태 확인 필요",
};
export function RoomExecutionPanel({ project, roomId, members, execution, waiting, kept, revision, onChanged, onConsult, onAddMembers, showSetup = true }: {
  project: string; roomId: string; members: RoomMember[]; execution: RoomExecution | null;
  waiting: boolean; kept: boolean; revision: number; onChanged: () => void;
  onConsult: (note?: string) => void; onAddMembers: () => void; showSetup?: boolean;
}) {
  const [plan, setPlan] = useState<RoomPlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [leaderId, setLeader] = useState("");
  const [reviewerId, setReviewer] = useState("");
  const [testCommand, setTest] = useState('["pnpm", "test"]');
  const [deployCommand, setDeploy] = useState("");
  const [deployTarget, setTarget] = useState("");
  const [confirmTarget, setConfirmTarget] = useState("");
  const [edits, setEdits] = useState(false);
  const [recommended, setRecommended] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [channels, setChannels] = useState({ discord: false, telegram: false });
  const [consultNote, setConsultNote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabled = members.filter(m => m.enabled !== false && m.id);
  useEffect(() => { let cancelled = false; fetch("/api/room/channels").then(r => r.json()).then(body => { if (!cancelled) setChannels(body); }).catch(() => undefined); return () => { cancelled = true; }; }, []);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/room/approved?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as { plan?: RoomPlan; error?: string };
      if (!cancelled) { setPlan(body.plan ?? null); setPlanError(body.error ?? ""); }
    }).catch(() => { if (!cancelled) setPlanError("채택본을 읽지 못했다."); });
    return () => { cancelled = true; };
  }, [project, revision]);
  useEffect(() => {
    setLeader(id => enabled.some(m => m.id === id) ? id : enabled[0]?.id ?? "");
    setReviewer(id => enabled.some(m => m.id === id) ? id : enabled[1]?.id ?? "");
  }, [members]);
  async function post(route: string, body: Record<string, unknown>) {
    setBusy(true); setError(""); setNote("");
    try {
      const res = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, roomId, ...body }) });
      const data = await res.json() as { error?: string; next?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNote(data.next ?? ""); onChanged(); return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function start() {
    try {
      await post("/api/room/execution/start", { leaderId, reviewerId, testCommand: JSON.parse(testCommand),
        ...(deployCommand.trim() ? { deployCommand: JSON.parse(deployCommand) } : {}), deployTarget, allowEdits: edits, maxAttempts: 2, notifications });
    } catch { setError('명령은 ["pnpm", "test"]처럼 실행 파일과 인자의 JSON 배열로 입력한다.'); }
  }
  async function action(action: string, extras: Record<string, unknown> = {}) {
    return post("/api/room/execution/action", { executionId: execution?.id, action, ...extras });
  }
  const label = (member: RoomMember) => `${member.name?.trim() || ROOM_SPEAKER_LABEL[member.speaker]} · ${member.model || "모델 기본"}`;
  const locked = busy || waiting || kept;
  const active = execution && !["done", "failed", "consult"].includes(execution.phase);
  const changed = execution && plan && execution.plan.digest !== plan.digest;
  const phaseIndex = execution?.phase === "act" ? 0 : ["check", "check_failed"].includes(execution?.phase ?? "") ? 1
    : ["deploy", "deploy_approval", "done"].includes(execution?.phase ?? "") ? 2 : -1;
  return <section className="room-execution" aria-label="운영 실행">
    {execution ? <>
      <div className="room-phase-rail" aria-label="운영 실행 단계">{["Act · 수행", "Check · 검증", "Deploy · 적용"].map((s, i) =>
        <span key={s} className={i === phaseIndex ? "is-current" : i < phaseIndex ? "is-passed" : ""}>{i < phaseIndex ? "✓ " : ""}{s}</span>)}</div>
      <div className="room-execution-status"><b>{PHASE[execution.phase]}</b><small>채택본 v{execution.plan.version} · {execution.threadId.slice(0, 10)}</small></div>
      <details><summary>채택된 Plan · 읽기 전용</summary><p>{execution.plan.goal}</p><ul>{execution.plan.requirements.map(r => <li key={r.id}>{r.text}{r.fit ? <small>완료 기준: {r.fit}</small> : null}</li>)}</ul></details>
      {changed ? <p className="thread-err">채택본이 v{plan.version}로 바뀌었다. 영향 범위는 상담에서 확인한다.</p> : null}
      {execution.allocation?.assignments.map(task => <div className="room-task-card" key={task.id}>
        <div><b>{task.id}</b><span>→ {label(execution.members.find(m => m.id === task.memberId)!)}</span></div>
        <p>{task.instruction}</p><small>{task.requirementIds.join(" · ")} · 복잡도 {task.complexity}</small>
        <p className="room-recommend-reason">추천: {task.effort ?? "모델 기본"} · {task.reason}</p>
      </div>)}
      {execution.error ? <p className="thread-err">{execution.error}</p> : null}
      {!changed && execution.phase === "approval" ? <div className="room-execution-actions">
        <label><input type="checkbox" checked={recommended} disabled={locked} onChange={e => setRecommended(e.target.checked)} /> 리더가 추천한 강도 적용</label>
        <p>해제하면 사용자가 선택한 모델·강도를 유지한다.</p>
        <button type="button" className="flow-btn primary" disabled={locked} onClick={() => void action("approve", { useRecommendedEffort: recommended })}>배정 확인 · 수행 시작</button>
      </div> : null}
      {!changed && execution.phase === "check_failed" ? <button type="button" className="flow-btn" disabled={locked} onClick={() => void action("retry")}>구현 오류 수정 → Act</button> : null}
      {!changed && execution.phase === "deploy_approval" ? execution.deployCommand ? <div className="room-execution-actions">
        <p>적용 대상: <b>{execution.deployTarget}</b></p><code>{JSON.stringify(execution.deployCommand)}</code>
        <input aria-label="적용 대상 확인" value={confirmTarget} placeholder="대상 이름을 그대로 입력" onChange={e => setConfirmTarget(e.target.value)} />
        <button type="button" className="flow-btn primary" disabled={locked || confirmTarget !== execution.deployTarget} onClick={() => void action("deploy", { target: confirmTarget })}>대상 확인 · 적용</button>
      </div> : <button type="button" className="flow-btn primary" disabled={locked} onClick={() => void action("finish")}>검증 완료 · 배포 없이 종료</button> : null}
      {!changed && !["done", "failed", "consult"].includes(execution.phase) ? <button type="button" className="flow-btn" disabled={locked} onClick={() => void action("sync")}>LangGraph 상태 확인 · 이어가기</button> : null}
      <details><summary>요구 변경 · 상담 재검토</summary><textarea aria-label="상담으로 보낼 변경" value={consultNote} onChange={e => setConsultNote(e.target.value)} placeholder="요구 누락·해석 오류·범위 변경" />
        <button type="button" className="flow-btn" disabled={locked || !consultNote.trim()} onClick={async () => {
          if (await action("consult", { note: consultNote })) onConsult(`운영 대화 ${roomId} · 채택본 v${execution.plan.version}\n${consultNote}`);
        }}>관련 실행 대기 · 상담으로 보내기</button></details>
    </> : null}
    {showSetup && !active ? <details className="room-execution-setup"><summary>운영 실행 설정{execution ? " · 새 실행" : ""}</summary>
      {!plan ? <><p>{planError || "채택본 확인 중"}</p><button type="button" className="flow-btn" onClick={() => onConsult()}>상담에서 설계 채택</button></> : <>
        <p>채택본 v{plan.version} · {plan.requirements.length}개 요구사항</p>
        {!roomId || enabled.length < 2 ? <button type="button" className="flow-btn" onClick={onAddMembers}>리더와 별도 검토자 LLM 추가</button> : null}
        <label>운영 리더<select aria-label="운영 리더" value={leaderId} onChange={e => setLeader(e.target.value)}>{enabled.map(m => <option key={m.id} value={m.id}>{label(m)}</option>)}</select></label>
        <label>독립 검토자<select aria-label="독립 검토자" value={reviewerId} onChange={e => setReviewer(e.target.value)}>{enabled.map(m => <option key={m.id} value={m.id}>{label(m)}</option>)}</select></label>
        <label>자동 시험 명령<input aria-label="자동 시험 명령" value={testCommand} onChange={e => setTest(e.target.value)} /></label>
        <label>적용 명령 · 선택<input aria-label="적용 명령" value={deployCommand} onChange={e => setDeploy(e.target.value)} placeholder='["pnpm", "deploy:staging"]' /></label>
        <label>적용 대상<input aria-label="적용 대상" value={deployTarget} onChange={e => setTarget(e.target.value)} placeholder="예: 스테이징" /></label>
        <label><input type="checkbox" checked={edits} onChange={e => setEdits(e.target.checked)} /> Act에서 프로젝트 파일 편집 허용</label>
        <label><input type="checkbox" checked={notifications} disabled={!channels.discord && !channels.telegram} onChange={e => setNotifications(e.target.checked)} /> 상태 알림 · {channels.discord ? "Discord " : ""}{channels.telegram ? "Telegram" : ""}{!channels.discord && !channels.telegram ? "연결된 채널 없음" : ""}</label>
        <small>알림에는 단계 상태와 원문 링크만 포함한다. 상담·모델 답변 전문은 전송하지 않는다.</small>
        <small>시험·적용 명령은 직접 고른 배열을 실행한다. 강도가 지원되지 않는 모델은 기본 설정을 사용한다.</small>
        <div className="room-execution-actions"><button type="button" className="flow-btn" disabled={locked} onClick={() => void post("/api/room/workflow/install", {})}>LangGraph 연결 준비</button>
          <button type="button" className="flow-btn primary" disabled={locked || !roomId || !leaderId || !reviewerId || leaderId === reviewerId} onClick={() => void start()}>채택본으로 배정 요청</button></div>
      </>}
    </details> : null}
    {note ? <p className="thread-note">{note}</p> : null}{error ? <p role="alert" className="thread-err">{error}</p> : null}
  </section>;
}
