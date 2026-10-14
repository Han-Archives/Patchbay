import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ROOM_SPEAKER_LABEL, type PrdSection, type RoomMember, type RoomSummary, type TodoItem } from "@patchbay/core";
import { stageMeta, type StageId, type WorkspaceProject } from "./workspaceContract.js";
import type { BuildViewReady, BuildViewResponse } from "./buildContract.js";
import { toIrCanvas, irNodeText } from "./irCanvas.js";
import type { DashboardView } from "./opsContract.js";
import { TodoPane } from "./TodoPane.js";
import { OverviewDocument } from "./OverviewDocument.js";
import { parseOverview, type OverviewDoc } from "./overviewContract.js";
import { CycleSteps, ProjectCycleFlow, cycleCurrent, cycleState, markSteps, type CycleStep, type SubStep } from "./ProjectCycleFlow.js";

type MainView = "overview" | "dashboard";
type TodoKind = "판단 · 모델 미정" | "자격 증명" | "열린 질문" | "사람 판단" | "확인";

interface PrdTopic { name: string; done: boolean }
interface PrdBody { status?: "ready" | "none"; sections?: PrdSection[]; progress?: { topics?: PrdTopic[] }; review?: { allOk?: boolean }; error?: string }
interface AgentBody { agents?: RoomMember[]; error?: string }
interface RoomBody { members?: RoomMember[]; error?: string }

function readMainView(): MainView {
  try { return localStorage.getItem("pb-main-view") === "overview" ? "overview" : "dashboard"; }
  catch { return "dashboard"; }
}

function readDone(alias: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`pb-todo-done:${alias}`) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function hhmm(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function logTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${hhmm(value)}`;
}

function timeValue(value?: string | null): number {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function todoFrom(text: string): { kind: TodoKind; title: string; description: string; action: string; stage: StageId } {
  const split = (prefix: string) => text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
  if (text.startsWith("모델 미정 —")) return { kind: "판단 · 모델 미정", title: split("모델 미정 —"), description: "이 작업에 쓸 모델을 구현 환경에서 정한다.", action: "구현 환경 열기", stage: "build" };
  if (text.startsWith("자격 증명 없음 —")) return { kind: "자격 증명", title: split("자격 증명 없음 —"), description: "실행에 필요한 자격 증명의 저장 상태를 확인한다.", action: "구현 환경 열기", stage: "build" };
  if (text.startsWith("열린 질문 —")) return { kind: "열린 질문", title: split("열린 질문 —"), description: "설계에서 답을 정하고 PRD에 반영한다.", action: "PRD 열기", stage: "design" };
  if (text.startsWith("사람 판단 ·")) return { kind: "사람 판단", title: split("사람 판단 ·"), description: "사람이 확인해야 하는 시험 결과를 검토한다.", action: "시험 결과 보기", stage: "run" };
  return { kind: "확인", title: text, description: "설계에서 이 항목의 원인과 처리 방법을 확인한다.", action: "열기", stage: "design" };
}

function ProgressBar({ passed, todo, total }: { passed: number; todo?: number; total: number }) {
  const safeTotal = Math.max(0, total);
  const passWidth = safeTotal ? Math.min(100, Math.max(0, passed / safeTotal * 100)) : 0;
  const todoWidth = safeTotal ? Math.min(100 - passWidth, Math.max(0, (todo ?? 0) / safeTotal * 100)) : 0;
  return <div className="main-progress-track" aria-hidden="true"><i className="main-progress-pass" style={{ width: `${passWidth}%` }} /><i className="main-progress-todo" style={{ width: `${todoWidth}%` }} /></div>;
}

function DocumentLines({ lines, open, onToggle }: { lines: string[]; open: boolean; onToggle: () => void }) {
  const visible = open ? lines : lines.slice(0, 6);
  return <>{visible.length ? <div className="main-doc-lines">{visible.map((line, index) => <p key={`${index}:${line}`}>{line}</p>)}</div> : <p className="main-empty">기록된 내용이 없다</p>}{lines.length > 6 ? <button type="button" className="main-more" onClick={onToggle}>{open ? "접기" : "더 보기"}</button> : null}</>;
}

export function DashboardPane({ project, revision, repo, onOpenStage, onOpenFile: _onOpenFile, workspace, onAsk }: {
  project: string; revision: number; repo: ReactNode;
  onOpenStage: (id: StageId | "plan" | "board") => void;
  onOpenFile: (path: string) => void; workspace?: WorkspaceProject; onAsk?: (text: string) => void;
}) {
  const [mainView, setMainView] = useState<MainView>(readMainView);
  const [view, setView] = useState<DashboardView | null>(null);
  const [build, setBuild] = useState<BuildViewReady | null>(null);
  const [prd, setPrd] = useState<PrdSection[] | null>(null);
  const [overview, setOverview] = useState<{ doc: OverviewDoc; rel: string } | null>(null);
  const [prdTopics, setPrdTopics] = useState<PrdTopic[]>([]);
  const [prdReviewed, setPrdReviewed] = useState(false);
  const [flowPick, setFlowPick] = useState<CycleStep | null>(null);
  const [agents, setAgents] = useState<RoomMember[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [testing, setTesting] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(() => new Set());
  const [repoOpen, setRepoOpen] = useState(false);

  useEffect(() => { setExpandedSections(new Set()); setFlowPick(null); }, [project]);

  useEffect(() => {
    let cancelled = false;
    setView(current => current?.alias === project ? current : null); setBuild(null); setPrd(null); setOverview(null); setAgents([]); setRooms([]); setRoomMembers([]); setError(null);
    fetch(`/api/dashboard?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as DashboardView & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "현황을 불러오지 못했습니다.");
      if (!cancelled) setView(body);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    fetch(`/api/build?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as BuildViewResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "구조를 불러오지 못했습니다.");
      if (!cancelled) setBuild(body.status === "ready" ? body : null);
    }).catch(() => { if (!cancelled) setBuild(null); });
    // 문서 폴더에 개요.md가 있으면 개요 화면은 그 문서를 그린다 — 없으면 PRD로.
    fetch(`/api/overview?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as { content?: string; rel?: string; error?: string };
      if (!res.ok || !body.content) throw new Error(body.error ?? "개요 문서가 없습니다.");
      if (!cancelled) setOverview({ doc: parseOverview(body.content), rel: body.rel ?? "" });
    }).catch(() => { if (!cancelled) setOverview(null); });
    fetch(`/api/prd?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as PrdBody;
      if (!res.ok || body.error || body.status !== "ready" || !body.sections?.length) throw new Error(body.error ?? "PRD가 없습니다.");
      if (!cancelled) { setPrd(body.sections); setPrdTopics(body.progress?.topics ?? []); setPrdReviewed(body.review?.allOk === true); }
    }).catch(() => { if (!cancelled) setPrd([]); });
    fetch(`/api/agents?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as AgentBody;
      if (!res.ok || body.error) throw new Error(body.error ?? "Agent 조회 실패");
      if (!cancelled) setAgents(body.agents ?? []);
    }).catch(() => { if (!cancelled) setAgents([]); });
    fetch(`/api/rooms?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as { rooms?: RoomSummary[]; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "대화방 조회 실패");
      const nextRooms = body.rooms ?? [];
      if (cancelled) return;
      setRooms(nextRooms);
      const latest = [...nextRooms].sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt))[0];
      if (!latest) return;
      const detailRes = await fetch(`/api/room?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(latest.id)}`);
      const detail = await detailRes.json() as RoomBody;
      if (!cancelled && detailRes.ok && !detail.error) setRoomMembers(detail.members ?? []);
    }).catch(() => { if (!cancelled) { setRooms([]); setRoomMembers([]); } });
    return () => { cancelled = true; };
  }, [project, revision, tick]);

  const latestRoom = useMemo(() => [...rooms].sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt))[0], [rooms]);
  const progress = useMemo(() => [...(view?.progressLog ?? [])].sort((a, b) => timeValue(b.timestamp) - timeValue(a.timestamp)), [view?.progressLog]);
  const canvas = build ? toIrCanvas(build.ir) : null;
  // 시작 · 끝 표시는 빼고 작업 노드만, 이름은 설명의 앞부분만 (긴 설명은 마우스를 올리면).
  const chain = canvas ? [...canvas.nodes].filter(node => !node.data.terminal).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y) : [];
  const shortName = (label: string) => label.split(" — ")[0]?.trim() || label;
  // 단계는 설계 · 구현 · 운영 셋이 도는 고리다. 지식 그래프 · 문서 호출은 도구라 단계로 세지 않는다.
  const cycle = cycleCurrent(workspace?.stages ?? []);
  const cycleLabel = cycle === "review" ? "운영 지남 · 달라진 점 검토 차례" : `${stageMeta(cycle).label} 단계`;
  const openCycle = (step: CycleStep) => onOpenStage(step === "review" ? "design" : step);
  const flowSelected = flowPick ?? cycle;
  const stageDone = (id: StageId) => workspace?.stages.find(stage => stage.id === id)?.tone === "done";
  const passedNodes = new Set((view?.nodes ?? []).filter(node => node.passed).map(node => node.id));
  const inGraph = new Set(build?.nodes.graph ?? []);
  const nodeName = (id: string) => { const node = chain.find(item => item.id === id); return node ? shortName(node.data.label) : id; };
  // 세부 단계 — 설계는 PRD 주제 · 검토 · 채택, 구현은 LangGraph 노드, 운영은 노드 실행, 검토는 아직 화면이 없는 세 걸음.
  const cycleSteps: Record<CycleStep, SubStep[]> = {
    design: markSteps([...prdTopics.map(topic => ({ label: topic.name, done: topic.done })), { label: "PRD 검토", done: prdReviewed }, { label: "채택", done: stageDone("design") }], cycle === "design"),
    build: markSteps(chain.map(node => ({ label: shortName(node.data.label), title: irNodeText(node), done: inGraph.has(node.id) })), cycle === "build"),
    run: markSteps((view?.nodes ?? []).map(node => ({ label: nodeName(node.id), title: node.id, done: passedNodes.has(node.id) })), cycle === "run"),
    review: markSteps([{ label: "달라진 점 모으기", done: false }, { label: "검토", done: false }, { label: "설계에 반영", done: false }], cycle === "review"),
  };
  const flowAction: Record<CycleStep, string> = { design: "설계 열기", build: "보고 고치기", run: "운영 열기", review: "설계 열기" };
  const outputMetrics = (view?.agent.metrics ?? []).filter(metric => metric.output && (metric.kind === "number" || metric.kind === "count")).slice(0, 3);
  const prdLines = (n: number) => prd?.find(section => section.n === n)?.lines.map(line => line.text) ?? [];

  function chooseMain(next: MainView) { setMainView(next); try { localStorage.setItem("pb-main-view", next); } catch { /* 화면 전환은 유지한다. */ } }
  function toggleSection(n: number) { setExpandedSections(current => { const next = new Set(current); if (next.has(n)) next.delete(n); else next.add(n); return next; }); }
  async function runTests() {
    setTesting(true);
    try {
      const res = await fetch("/api/dashboard/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project }) });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "시험 실행 실패");
      setTick(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setTesting(false); }
  }
  function continueRoom() {
    if (!latestRoom) { onAsk?.(""); return; }
    const hash = `#room/${encodeURIComponent(project)}/${encodeURIComponent(latestRoom.id)}`;
    if (window.location.hash === hash) window.dispatchEvent(new Event("hashchange"));
    else window.location.hash = hash;
  }

  if (!view) return <p role="status">{error ?? "프로젝트 현황을 불러오는 중"}{error ? <button type="button" className="flow-btn" onClick={() => setTick(value => value + 1)}>다시 조회</button> : null}</p>;

  // 지금 단계에서 할 일은 단계 상태가 정한다 — 파일에 적지 않아도 늘 맨 위에 있다.
  const nowStage = workspace?.stages.find(stage => stage.tone === "now");
  const autoId = (source: string, title: string) => {
    let hash = 2166136261;
    for (const character of title) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `auto-${source}-${(hash >>> 0).toString(16)}`;
  };
  const legacyDone = readDone(project);
  const todoSuggestions: TodoItem[] = [
    ...(nowStage ? [{ id: autoId("stage", nowStage.next), title: nowStage.next.slice(0, 200), detail: `${nowStage.status}${nowStage.detail ? ` — ${nowStage.detail}` : ""}`.slice(0, 2000), source: "stage" as const, done: false, at: "" }] : []),
    ...view.attention.map(text => { const item = todoFrom(text); return { id: autoId("attention", text), title: item.title.slice(0, 200), detail: item.description, source: "attention" as const, done: legacyDone.includes(text), at: "" }; }),
  ];
  const purposeSummary = prdLines(1)[0];
  const scopeLines = prdLines(4);
  const inScope = scopeLines.filter(line => !line.startsWith("하지 않음:"));
  const outScope = scopeLines.filter(line => line.startsWith("하지 않음:")).map(line => line.slice("하지 않음:".length).trim());
  const missingPrd = !prd?.length;
  const fallback = <div className="main-empty main-doc-fallback"><p>PRD가 아직 없다 · 설계에서 채운다</p><button type="button" className="flow-btn" onClick={() => onOpenStage("design")}>설계 열기</button></div>;

  return <div className="main-shell">
    <header className="main-header">
      <div className="main-heading"><h2>{workspace?.name ?? project}</h2></div>
      <div className="main-actions">
        <nav className="main-switch" aria-label="메인 화면"><button type="button" aria-pressed={mainView === "overview"} onClick={() => chooseMain("overview")}>개요</button><button type="button" aria-pressed={mainView === "dashboard"} onClick={() => chooseMain("dashboard")}>대시보드</button></nav>
        <button type="button" className="main-icon-button" aria-label="새로고침" onClick={() => setTick(value => value + 1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .2 5.4M16 3v4h-4" /></svg></button>
        <div className="main-continue"><button type="button" className="main-primary" onClick={continueRoom}>{latestRoom ? "이어하기" : "시작하기"}</button></div>
      </div>
    </header>
    {error ? <p className="flow-error">{error}</p> : null}

    {mainView === "dashboard" ? <div className="main-dashboard-grid">
      <div className="main-dashboard-body">
        <section className={`main-card main-flow is-${cycleState(flowSelected, cycle)}`}><header className="main-flow-head"><h3>흐름도</h3><small>칸을 누르면 아래에 그 단계의 세부 단계가 나온다</small></header>
          <ProjectCycleFlow stages={workspace?.stages ?? []} steps={cycleSteps} selected={flowSelected} onSelect={setFlowPick} />
          <CycleSteps step={flowSelected} steps={cycleSteps[flowSelected]} action={flowAction[flowSelected]} onAction={() => openCycle(flowSelected)} />
        </section>
        <div className="main-evidence-grid">
          <section className="main-card"><h3>진척 근거</h3>
            {view.tests ? <div className="main-evidence-row"><div><span>요구사항 시험</span><b>{view.tests.passed}/{view.requirements.length}</b></div><ProgressBar passed={view.tests.passed} todo={view.tests.todo} total={view.requirements.length} /></div> : <div className="main-empty"><p>시험 기록 없음</p><button type="button" className="flow-btn" disabled={testing} onClick={() => void runTests()}>{testing ? "시험 실행 중…" : "시험 돌리기"}</button></div>}
            <div className="main-evidence-row"><div><span>노드 실행</span><b>{view.nodes.filter(node => node.passed).length}/{view.nodes.length}</b></div><ProgressBar passed={view.nodes.filter(node => node.passed).length} total={view.nodes.length} /></div>
          </section>
          <section className="main-card"><h3>학습 지표</h3>{outputMetrics.length ? <div className="main-metrics">{outputMetrics.map(metric => <div key={metric.field}><b>{metric.value}</b><small>{metric.label}</small></div>)}</div> : <p className="main-empty">아직 실행 지표가 없다</p>}<p className="main-trend">추이는 측정 2회부터</p></section>
        </div>
        <section className="main-card"><h3>에이전트</h3><div className="main-agent-row">{roomMembers.length ? roomMembers.map((member, index) => <span key={member.id ?? `${member.speaker}:${index}`} className={member.enabled === false ? "is-off" : "is-on"}><i aria-hidden="true" />{member.name?.trim() || ROOM_SPEAKER_LABEL[member.speaker]}<small>{member.enabled === false ? "꺼짐" : "켜짐"}</small></span>) : <p className="main-empty">최근 방에 참여한 Agent가 없다</p>}</div><div className="main-agent-connection"><span><i className={view.agent.reachable ? "is-on" : "is-off"} aria-hidden="true" />그래프 {view.agent.reachable ? "연결됨" : "연결 안 됨"}</span><small>{view.agent.updatedAt ? `갱신 ${hhmm(view.agent.updatedAt)}` : "갱신 기록 없음"}</small></div></section>
        <section className="main-card"><h3>최근 기록</h3>{progress.length ? <div className="main-log-list">{progress.slice(0, 5).map((entry, index) => <div key={`${entry.timestamp}:${index}`}><time>{logTime(entry.timestamp)}</time><span>{entry.summary}</span></div>)}</div> : <p className="main-empty">진행 기록 없음</p>}</section>
      </div>
      <TodoPane key={project} project={project} revision={revision} suggestions={todoSuggestions} />
    </div> : overview ? <OverviewDocument doc={overview.doc} source={overview.rel} /> : <div className="main-overview">
      <nav className="main-toc" aria-label="개요 목차">{["목적과 대상", "성공 기준", "범위", "구조 · LangGraph", "흐름과 결정", "산출물 · 역할 · 도구"].map((title, index) => <button type="button" key={title} onClick={() => document.getElementById(`main-section-${index + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{index + 1}</span>{title}</button>)}</nav>
      <div className="main-document">
        <section id="main-section-1"><h3><span>1</span>목적과 대상</h3>{missingPrd ? fallback : <>{purposeSummary ? <p className="main-summary">{purposeSummary}</p> : null}<DocumentLines lines={prdLines(2)} open={expandedSections.has(1)} onToggle={() => toggleSection(1)} /></>}</section>
        <section id="main-section-2"><h3><span>2</span>성공 기준</h3>{missingPrd ? fallback : <DocumentLines lines={prdLines(3)} open={expandedSections.has(2)} onToggle={() => toggleSection(2)} />}</section>
        <section id="main-section-3"><h3><span>3</span>범위</h3>{missingPrd ? fallback : <div className="main-scope"><div><h4>한다 · 가정 · 제약</h4><DocumentLines lines={inScope} open={expandedSections.has(3)} onToggle={() => toggleSection(3)} /></div><div><h4>안 한다</h4><DocumentLines lines={outScope} open={expandedSections.has(3)} onToggle={() => toggleSection(3)} /></div></div>}</section>
        <section id="main-section-4"><h3><span>4</span>구조 · LangGraph</h3>{<>{chain.length ? <div className="main-chain">{chain.map((node, index) => <span key={node.id}>{index ? <i aria-hidden="true">→</i> : null}<b title={irNodeText(node)}>{shortName(node.data.label)}</b></span>)}</div> : <p className="main-empty">구조가 아직 없다</p>}<p className="main-note">노드 = 한 단계를 맡는 작업 단위. 고리가 굳지 않도록 구현 화면에서 도중에 보고 고친다.</p><button type="button" className="flow-btn" onClick={() => onOpenStage("build")}>구현 화면에서 보고 고치기</button></>}</section>
        <section id="main-section-5"><h3><span>5</span>흐름과 결정</h3><p className="main-summary-sm">설계에서 아이디어를 구체화하고, 구현(LangGraph)에서 정밀하게 만들고, 운영에서 결과를 본다. 고칠 점이 있으면 이전 설계와 달라진 점을 한 번에 검토해 반영하고 다시 설계부터 돈다.</p><DocumentLines lines={[...(workspace?.stages ?? []).filter(stage => stage.id === "design" || stage.id === "build" || stage.id === "run").map(stage => `${stageMeta(stage.id).label} — ${stage.status}`), `지금 — ${cycleLabel}`, ...(workspace?.latest?.summary ? [`최근 — ${workspace.latest.summary}`] : [])]} open={expandedSections.has(5)} onToggle={() => toggleSection(5)} /></section>
        <section id="main-section-6"><h3><span>6</span>산출물 · 역할 · 도구</h3>{agents.length ? <DocumentLines lines={agents.map(agent => `${agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker]} — ${agent.role.split("\n")[0] || "역할 기록 없음"}`)} open={expandedSections.has(6)} onToggle={() => toggleSection(6)} /> : <p className="main-empty">등록된 Agent가 없다</p>}<div className="main-tools"><span>도구 · 단계가 아니라 필요할 때 연다</span><button type="button" className="flow-btn" onClick={() => onOpenStage("graph")}>지식 그래프</button><button type="button" className="flow-btn" onClick={() => onOpenStage("docs")}>문서 호출</button><button type="button" className="flow-btn" onClick={() => setRepoOpen(true)}>파일 · 연결</button></div></section>
      </div>
    </div>}
    {repoOpen ? <div className="main-repo" role="dialog" aria-modal="true" aria-label="파일과 연결"><header><h3>파일 · 연결</h3><button type="button" className="flow-btn" onClick={() => setRepoOpen(false)}>닫기</button></header>{repo}</div> : null}
  </div>;
}
