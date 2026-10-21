import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { resolveResume, type ResumeAction, type WorkLocation } from "./workspaceNavigation.js";
import { ROOM_SPEAKER_LABEL, type PrdSection, type RoomMember, type RoomSummary, type TodoItem } from "@patchbay/core";
import { stageMeta, type StageId, type WorkspaceProject } from "./workspaceContract.js";
import type { BuildViewExisting, BuildViewReady, BuildViewResponse } from "./buildContract.js";
import { toIrCanvas, irNodeText } from "./irCanvas.js";
import type { DashboardView } from "./testContract.js";
import { DashboardHistory } from "./DashboardHistory.js";
import { ProjectNameEditor } from "./ProjectNameEditor.js";
import { TodoPane } from "./TodoPane.js";
import { OverviewDocument } from "./OverviewDocument.js";
import { parseOverview, type OverviewDoc } from "./overviewContract.js";
import { ProjectCycleFlow, cycleCurrent, cycleState, markSteps, type CycleStep, type SubStep } from "./ProjectCycleFlow.js";
import { CycleTaskTable } from "./CycleTaskTable.js";

type MainView = "overview" | "dashboard";
type TodoKind = "판단 · 모델 미정" | "자격 증명" | "열린 질문" | "사람 판단" | "확인";

interface PrdTopic { name: string; done: boolean }
interface PrdBody { status?: "ready" | "none"; sections?: PrdSection[]; progress?: { topics?: PrdTopic[] }; review?: { allOk?: boolean }; error?: string }
interface AgentBody { agents?: RoomMember[]; error?: string }

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

function todoFrom(text: string): { kind: TodoKind; title: string; description: string; action: string; stage: StageId } {
  const split = (prefix: string) => text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
  if (text.startsWith("모델 미정 —")) return { kind: "판단 · 모델 미정", title: split("모델 미정 —"), description: "이 작업에 쓸 모델을 구현 환경에서 정한다.", action: "구현 환경 열기", stage: "build" };
  if (text.startsWith("자격 증명 없음 —")) return { kind: "자격 증명", title: split("자격 증명 없음 —"), description: "실행에 필요한 자격 증명의 저장 상태를 확인한다.", action: "구현 환경 열기", stage: "build" };
  if (text.startsWith("열린 질문 —")) return { kind: "열린 질문", title: split("열린 질문 —"), description: "설계에서 답을 정하고 PRD에 반영한다.", action: "PRD 열기", stage: "design" };
  if (text.startsWith("사람 판단 ·")) return { kind: "사람 판단", title: split("사람 판단 ·"), description: "사람이 확인해야 하는 시험 결과를 검토한다.", action: "시험 결과 보기", stage: "test" };
  return { kind: "확인", title: text, description: "설계에서 이 항목의 원인과 처리 방법을 확인한다.", action: "열기", stage: "design" };
}

function DocumentLines({ lines, open, onToggle }: { lines: string[]; open: boolean; onToggle: () => void }) {
  const visible = open ? lines : lines.slice(0, 6);
  return <>{visible.length ? <div className="main-doc-lines">{visible.map((line, index) => <p key={`${index}:${line}`}>{line}</p>)}</div> : <p className="main-empty">기록된 내용이 없다</p>}{lines.length > 6 ? <button type="button" className="main-more" onClick={onToggle}>{open ? "접기" : "더 보기"}</button> : null}</>;
}

export function DashboardPane({ project, revision, repo, onOpenStage, onOpenFile: _onOpenFile, workspace, readOnly, onProjectRenamed, lastWork, onContinue }: {
  project: string; revision: number; repo: ReactNode; readOnly: boolean; onProjectRenamed: () => void;
  onOpenStage: (id: StageId | "plan" | "board") => void;
  onOpenFile: (path: string) => void; workspace?: WorkspaceProject;
  lastWork: WorkLocation | null; onContinue: (action: ResumeAction) => void;
}) {
  const [mainView, setMainView] = useState<MainView>(readMainView);
  const [view, setView] = useState<DashboardView | null>(null);
  const [build, setBuild] = useState<BuildViewReady | null>(null);
  /** 「이미 구현됨」 길이면 구현 · 테스트 세부 단계를 노드마다의 연결 · 통과로 센다 (사용자 결정 2026-10-20). */
  const [existing, setExisting] = useState<BuildViewExisting | null>(null);
  const [prd, setPrd] = useState<PrdSection[] | null>(null);
  const [overview, setOverview] = useState<{ doc: OverviewDoc; rel: string } | null>(null);
  const [prdTopics, setPrdTopics] = useState<PrdTopic[]>([]);
  const [prdReviewed, setPrdReviewed] = useState(false);
  const [flowPick, setFlowPick] = useState<CycleStep | null>(null);
  const [agents, setAgents] = useState<RoomMember[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsReady, setRoomsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(() => new Set());
  const [repoOpen, setRepoOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { setExpandedSections(new Set()); setFlowPick(null); }, [project]);

  useEffect(() => {
    let cancelled = false;
    setView(current => current?.alias === project ? current : null); setBuild(null); setExisting(null); setPrd(null); setOverview(null); setAgents([]); setRooms([]); setRoomsReady(false); setError(null);
    fetch(`/api/dashboard?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as DashboardView & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "현황을 불러오지 못했습니다.");
      if (!cancelled) setView(body);
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    fetch(`/api/build?alias=${encodeURIComponent(project)}`).then(async res => {
      const body = await res.json() as BuildViewResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "구조를 불러오지 못했습니다.");
      if (!cancelled) { setBuild(body.status === "ready" ? body : null); setExisting(body.status === "existing" ? body : null); }
    }).catch(() => { if (!cancelled) { setBuild(null); setExisting(null); } });
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
      if (!cancelled) setRooms(nextRooms);
    }).catch(() => { if (!cancelled) setRooms([]); }).finally(() => { if (!cancelled) setRoomsReady(true); });
    return () => { cancelled = true; };
  }, [project, revision, tick]);

  const resume = resolveResume(project, lastWork, rooms.length > 0);
  const canvas = build ? toIrCanvas(build.ir) : existing ? toIrCanvas(existing.ir) : null;
  // 시작 · 끝 표시는 빼고 작업 노드만, 이름은 설명의 앞부분만 (긴 설명은 마우스를 올리면).
  const chain = canvas ? [...canvas.nodes].filter(node => !node.data.terminal).sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y) : [];
  const shortName = (label: string) => label.split(" — ")[0]?.trim() || label;
  // 단계는 설계 · 구현 · 테스트 셋이 도는 고리다. 지식 그래프 · 문서 호출은 도구라 단계로 세지 않는다.
  const cycle = cycleCurrent(workspace?.stages ?? []);
  const cycleLabel = cycle === "review" ? "테스트 지남 · Review 차례 (승인 → 결과 · 반려 → 설계)" : cycle === "result" ? "승인됨 · 결과" : `${stageMeta(cycle).label} 단계`;
  const openCycle = (step: CycleStep) => onOpenStage(step === "review" ? "design" : step === "result" ? "test" : step);
  const flowSelected = flowPick ?? cycle;
  useLayoutEffect(() => {
    const dashboard = root.current;
    const shell = dashboard?.closest<HTMLElement>(".shell");
    const divider = dashboard?.querySelector<HTMLElement>(".cycle-tasks");
    if (!dashboard || !shell || !divider || mainView !== "dashboard") return;
    const align = () => {
      const top = divider.getBoundingClientRect().top - shell.getBoundingClientRect().top;
      shell.style.setProperty("--workflow-divider-y", `${top}px`);
      const active = dashboard.querySelector<HTMLElement>(".todo-active-list");
      const completed = dashboard.querySelector<HTMLElement>(".todo-completed-head");
      const table = divider.querySelector<HTMLElement>(".cycle-item-scroll");
      const heading = divider.querySelector<HTMLElement>(".cycle-task-header");
      if (active && completed && heading) {
        dashboard.style.setProperty("--cycle-heading-height", `${heading.getBoundingClientRect().height}px`);
        // 표 등장 애니메이션의 이동량을 빼고 최종 배치 위치에 맞춘다.
        const tableTop = table
          ? table.getBoundingClientRect().top - new DOMMatrix(getComputedStyle(table).transform).m42
          : heading.getBoundingClientRect().bottom + 10;
        const height = active.getBoundingClientRect().height + tableTop - completed.getBoundingClientRect().top;
        dashboard.style.setProperty("--todo-active-height", `${Math.max(0, height)}px`);
      }
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(dashboard);
    observer.observe(divider);
    const heading = divider.querySelector(".cycle-task-header");
    if (heading) observer.observe(heading);
    // 비동기로 나타나는 표와 할일 오류 메시지에도 높이를 다시 맞춘다.
    const mutations = new MutationObserver(align);
    mutations.observe(dashboard, { childList: true, subtree: true });
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", align);
      shell.style.removeProperty("--workflow-divider-y");
      dashboard.style.removeProperty("--todo-active-height");
      dashboard.style.removeProperty("--cycle-heading-height");
    };
  }, [mainView, project, view?.alias, flowSelected]);
  const stageDone = (id: StageId) => workspace?.stages.find(stage => stage.id === id)?.tone === "done";
  const passedNodes = new Set((view?.nodes ?? []).filter(node => node.passed).map(node => node.id));
  const inGraph = new Set(build?.nodes.graph ?? []);
  const nodeName = (id: string) => { const node = chain.find(item => item.id === id); return node ? shortName(node.data.label) : id; };
  // 세부 단계 — 설계는 PRD 주제 · 검토 · 채택, 구현은 LangGraph 노드, 테스트는 노드 실행, 검토는 아직 화면이 없는 세 걸음.
  const cycleSteps: Record<CycleStep, SubStep[]> = {
    design: markSteps([...prdTopics.map(topic => ({ label: topic.name, done: topic.done })), { label: "PRD 검토", done: prdReviewed }, { label: "채택", done: stageDone("design") }], cycle === "design"),
    build: markSteps(chain.map(node => ({ label: shortName(node.data.label), title: irNodeText(node), done: existing ? existingLinked(existing, node.id) : inGraph.has(node.id) })), cycle === "build"),
    test: existing
      ? markSteps(chain.map(node => ({ label: shortName(node.data.label), title: irNodeText(node), done: existingPassed(existing, node.id) })), cycle === "test")
      : markSteps((view?.nodes ?? []).map(node => ({ label: nodeName(node.id), title: node.id, done: passedNodes.has(node.id) })), cycle === "test"),
    review: markSteps([{ label: "달라진 점 모으기", done: false }, { label: "Review", done: false }, { label: "승인 또는 반려", done: false }], cycle === "review"),
    result: markSteps([{ label: "승인된 판", done: false }], cycle === "result"),
  };
  const flowAction: Record<CycleStep, string> = { design: "설계 화면 열기", build: "구현 화면 열기", test: "테스트 화면 열기", review: "설계에 반영하기", result: "결과 보기" };
  const prdLines = (n: number) => prd?.find(section => section.n === n)?.lines.map(line => line.text) ?? [];

  function chooseMain(next: MainView) { setMainView(next); try { localStorage.setItem("pb-main-view", next); } catch { /* 화면 전환은 유지한다. */ } }
  function toggleSection(n: number) { setExpandedSections(current => { const next = new Set(current); if (next.has(n)) next.delete(n); else next.add(n); return next; }); }
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

  return <div ref={root} className={`main-shell${mainView === "dashboard" ? " is-dashboard" : ""}`}>
    <header className="main-header">
      <div className="main-heading"><ProjectNameEditor key={project} project={project} name={workspace?.name ?? project} folder={workspace?.path} readOnly={readOnly} onRenamed={onProjectRenamed} /></div>
      <div className="main-actions">
        <nav className="main-switch" aria-label="메인 화면"><button type="button" aria-pressed={mainView === "overview"} onClick={() => chooseMain("overview")}>개요</button><button type="button" aria-pressed={mainView === "dashboard"} onClick={() => chooseMain("dashboard")}>대시보드</button></nav>
        <button type="button" className="main-icon-button" aria-label="새로고침" onClick={() => setTick(value => value + 1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .2 5.4M16 3v4h-4" /></svg></button>
        <div className="main-continue"><button type="button" className="main-primary" title={resume.title} aria-label={resume.title} disabled={!lastWork && !roomsReady} onClick={() => onContinue(resume)}>{resume.label}</button></div>
      </div>
    </header>
    {error ? <p className="flow-error">{error}</p> : null}

    {mainView === "dashboard" ? <div key={`dashboard:${project}`} className="main-dashboard-grid">
        <section className={`main-card main-flow is-${cycleState(flowSelected, cycle)}`}><header className="main-flow-head"><h3>Workflow</h3></header>
          <ProjectCycleFlow stages={workspace?.stages ?? []} steps={cycleSteps} selected={flowSelected} onSelect={setFlowPick} />
          <CycleTaskTable key={`${project}:${flowSelected}`} project={project} step={flowSelected} steps={cycleSteps[flowSelected]} action={flowAction[flowSelected]} onAction={() => openCycle(flowSelected)} />
        </section>
      <TodoPane key={`tasks:${project}`} project={project} revision={revision} suggestions={todoSuggestions} />
      <DashboardHistory key={`history:${project}`} project={project} revision={revision + tick} />
    </div> : overview ? <OverviewDocument key={`overview:${project}`} doc={overview.doc} source={overview.rel} /> : <div key={`overview-fallback:${project}`} className="main-overview">
      <nav className="main-toc" aria-label="개요 목차">{["목적과 대상", "성공 기준", "범위", "구조 · LangGraph", "흐름과 결정", "산출물 · 역할 · 도구"].map((title, index) => <button type="button" key={title} onClick={() => document.getElementById(`main-section-${index + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{index + 1}</span>{title}</button>)}</nav>
      <div className="main-document">
        <section id="main-section-1"><h3><span>1</span>목적과 대상</h3>{missingPrd ? fallback : <>{purposeSummary ? <p className="main-summary">{purposeSummary}</p> : null}<DocumentLines lines={prdLines(2)} open={expandedSections.has(1)} onToggle={() => toggleSection(1)} /></>}</section>
        <section id="main-section-2"><h3><span>2</span>성공 기준</h3>{missingPrd ? fallback : <DocumentLines lines={prdLines(3)} open={expandedSections.has(2)} onToggle={() => toggleSection(2)} />}</section>
        <section id="main-section-3"><h3><span>3</span>범위</h3>{missingPrd ? fallback : <div className="main-scope"><div><h4>한다 · 가정 · 제약</h4><DocumentLines lines={inScope} open={expandedSections.has(3)} onToggle={() => toggleSection(3)} /></div><div><h4>안 한다</h4><DocumentLines lines={outScope} open={expandedSections.has(3)} onToggle={() => toggleSection(3)} /></div></div>}</section>
        <section id="main-section-4"><h3><span>4</span>구조 · LangGraph</h3>{<>{chain.length ? <div className="main-chain">{chain.map((node, index) => <span key={node.id}>{index ? <i aria-hidden="true">→</i> : null}<b title={irNodeText(node)}>{shortName(node.data.label)}</b></span>)}</div> : <p className="main-empty">구조가 아직 없다</p>}<p className="main-note">노드 = 한 단계를 맡는 작업 단위. 고리가 굳지 않도록 구현 화면에서 도중에 보고 고친다.</p><button type="button" className="flow-btn" onClick={() => onOpenStage("build")}>구현 화면에서 보고 고치기</button></>}</section>
        <section id="main-section-5"><h3><span>5</span>흐름과 결정</h3><p className="main-summary-sm">설계에서 아이디어를 구체화하고, 구현(LangGraph)에서 정밀하게 만들고, 테스트에서 써 본다. 검토에서 이전 설계와 달라진 점을 한 번에 보고, 반려하면 이유를 들고 다시 설계부터 돌고, 승인하면 그 판이 결과다.</p><DocumentLines lines={[...(workspace?.stages ?? []).filter(stage => stage.id === "design" || stage.id === "build" || stage.id === "test").map(stage => `${stageMeta(stage.id).label} — ${stage.status}`), `지금 — ${cycleLabel}`, ...(workspace?.latest?.summary ? [`최근 — ${workspace.latest.summary}`] : [])]} open={expandedSections.has(5)} onToggle={() => toggleSection(5)} /></section>
        <section id="main-section-6"><h3><span>6</span>산출물 · 역할 · 도구</h3>{agents.length ? <DocumentLines lines={agents.map(agent => `${agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker]} — ${agent.role.split("\n")[0] || "역할 기록 없음"}`)} open={expandedSections.has(6)} onToggle={() => toggleSection(6)} /> : <p className="main-empty">등록된 Agent가 없다</p>}<div className="main-tools"><span>도구 · 단계가 아니라 필요할 때 연다</span><button type="button" className="flow-btn" onClick={() => onOpenStage("graph")}>지식 그래프</button><button type="button" className="flow-btn" onClick={() => onOpenStage("docs")}>문서 호출</button><button type="button" className="flow-btn" onClick={() => setRepoOpen(true)}>폴더 · 문서</button></div></section>
      </div>
    </div>}
    {repoOpen ? <div className="main-repo" role="dialog" aria-modal="true" aria-label="폴더 · 문서"><header><h3>폴더 · 문서</h3><button type="button" className="flow-btn" onClick={() => setRepoOpen(false)}>닫기</button></header>{repo}</div> : null}
  </div>;
}

/** 그 노드의 요구사항이 모두 확인된 테스트에 이어졌다. */
function existingLinked(view: BuildViewExisting, node: string): boolean {
  const mine = view.summary.requirements.filter((req) => req.nodes.includes(node));
  return mine.length > 0 && mine.every((req) => req.state !== "unlinked");
}

/** 그 노드의 요구사항이 모두 통과했다. */
function existingPassed(view: BuildViewExisting, node: string): boolean {
  const count = view.summary.nodes[node];
  return Boolean(count && count.total > 0 && count.passed === count.total);
}
