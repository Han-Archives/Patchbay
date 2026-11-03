import { useEffect, useRef, useState, type CSSProperties } from "react";
import { monthKey, projectCycle, type HomeOutput, type HomeProject, type HomeResponse, type HomeStatus } from "./homeContract.js";
import { projectIconColor, projectInitials } from "./workspaceContract.js";
import { SidebarIcon } from "./SidebarIcon.js";
import { HomeOutputViewer } from "./HomeOutputViewer.js";
import "./workspaceHome.css";

const STATUS: Record<HomeStatus, string> = { turn: "할 일 있음", running: "실행 중", problem: "문제 있음", normal: "작성 중" };
const CYCLE = [["design", "설계"], ["build", "구현"], ["test", "테스트"], ["review", "Review"], ["result", "결과"]] as const;
function saved(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } }
function save(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep session preferences. */ } }
function dateText(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "날짜 미기록" : date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); }
function ProjectIcon({ project }: { project: Pick<HomeProject, "alias" | "name"> }) {
  return <span className="wh-project-icon" style={{ "--project-color": projectIconColor(project.alias) } as CSSProperties} aria-hidden="true">{projectInitials(project.name ?? project.alias)}</span>;
}
function LaunchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4m-3-9 6-6m-5 0h5v5" /></svg>; }
function ProjectCard({ project: p, favorite, onFavorite, onOpen, onOutputs }: {
  project: HomeProject; favorite: boolean; onFavorite: () => void; onOpen: () => void; onOutputs: () => void;
}) {
  const current = CYCLE.findIndex(([id]) => id === projectCycle(p));
  const name = p.name ?? p.alias;
  return <article className="wh-project-card" data-project={p.alias} style={{ "--cover-color": projectIconColor(p.alias) } as CSSProperties}>
    <button type="button" className="wh-project-open" aria-label={`${name} 프로젝트 열기`} onClick={onOpen} />
    <div className="wh-cover"><svg viewBox="0 0 300 98" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M96 49h40m27 0h39" /><rect x="62" y="31" width="35" height="36" rx="9" /><rect x="135" y="24" width="35" height="50" rx="9" /><rect x="202" y="31" width="35" height="36" rx="9" /><circle cx={current === 0 ? 79 : current === 1 ? 152 : 219} cy="49" r="6" fill="currentColor" /></g></svg><small>{p.alias}</small><button type="button" className="wh-star" aria-label={`${name} 즐겨찾기 ${favorite ? "해제" : "추가"}`} aria-pressed={favorite} onClick={onFavorite}>{favorite ? "★" : "☆"}</button></div>
    <div className="wh-card-body"><div className="wh-card-heading"><ProjectIcon project={p} /><div><h3>{name}</h3><p title={p.description}>{p.description || "프로젝트 개요를 작성해 보세요."}</p></div>{p.appUrl ? <a className="wh-launch" href={p.appUrl} target="_blank" rel="noopener noreferrer" aria-label={`${name} 실행 화면 열기 · 새 탭`} title="실행 화면 열기 · 새 탭"><LaunchIcon /></a> : <button type="button" className="wh-launch" disabled aria-label={`${name} 실행 주소 미연결`} title="실행 주소를 프로젝트 테스트 화면에서 연결해 주세요"><LaunchIcon /></button>}</div>
      <div className="wh-card-status"><span className={`wh-status is-${p.status}`}>{STATUS[p.status]}</span><span>{p.version ? `v${p.version} · ` : ""}{CYCLE[current]![1]}</span></div><p className="wh-card-summary">{p.latest?.summary || p.stages.find(s => s.id === p.current)?.next || "첫 작업을 시작해 보세요."}</p>
      <div className="wh-mini-flow" role="img" aria-label={`현재 단계 ${CYCLE[current]![1]}`}>{CYCLE.map(([id, label], index) => <span key={id} className={index < current ? "is-done" : index === current ? `is-current stage-${id}` : "is-next"}>{index < current ? "✓ " : ""}{label}</span>)}</div>
      <div className="wh-card-foot"><time>{p.latest ? dateText(p.latest.at) : "기록 없음"}</time><div><button type="button" className="wh-output-button" disabled={!p.outputCount} onClick={onOutputs}><SidebarIcon name="plan" />결과물 보기 <b>{p.outputCount}{p.outputLimited ? "+" : ""}</b> ↗</button><small>{p.outputCount ? "문서·화면·이미지" : "아직 생성된 결과물이 없습니다"}</small></div></div>{p.issues.length ? <p className="wh-issue">{p.issues.join(" ")}</p> : null}
    </div>
  </article>;
}
function OutputCard({ output, project, recent, onOpen }: { output: HomeOutput; project: HomeProject; recent?: boolean; onOpen: () => void }) {
  return <button type="button" className={`wh-output-card${recent ? " is-recent" : ""}`} onClick={onOpen}><div className={`wh-output-preview is-${output.kind === "화면" ? "screen" : output.kind === "이미지" ? "image" : "document"}`}><span>{output.kind}</span><b>{output.title}</b><i /><i /><small>{output.excerpt.slice(0, 90) || "클릭해서 결과물 열기"}</small></div><span className="wh-output-copy"><b>{output.title}</b><small>{project.name ?? project.alias}<time>{dateText(output.at)}</time></small></span></button>;
}
function ExecutionCalendar({ view, month, onMonth, onOpenProject, onOpenTest }: { view: HomeResponse; month: string; onMonth: (month: string) => void; onOpenProject: (alias: string) => void; onOpenTest: (alias: string) => void }) {
  const [selected, setSelected] = useState(view.today);
  const current = view.month === month;
  const execution = { ...view.execution, groups: view.execution.groups ?? [], unavailable: view.execution.unavailable ?? [], commandsConnected: view.execution.commandsConnected ?? false };
  const date = selected.startsWith(month) ? selected : `${month}-01`;
  const groups = current ? execution.groups.filter(g => g.date === date) : [];
  function shift(delta: number) {
    const next = new Date(`${month}-01T12:00:00`); next.setMonth(next.getMonth() + delta);
    const key = monthKey(next); setSelected(key === view.today.slice(0, 7) ? view.today : `${key}-01`); onMonth(key);
  }
  const count = (source: string) => execution.groups.filter(g => g.source === source).reduce((sum, g) => sum + g.count, 0);
  return <section className="wh-calendar" aria-label="코드 실행 캘린더" aria-busy={!current}>
    <div className="wh-section-title"><h2>코드 실행</h2><small>실제 기록</small></div>
    <div className="wh-execution-summary"><strong>{current ? execution.total : "…"}<small>회</small></strong><span>{Number(month.slice(5))}월 · {current ? execution.activeDays : "…"}일 활동</span></div>
    <div className="wh-execution-sources" aria-label="실행 종류별 합계">{(["Claude", "Codex", "테스트"] as const).map(source => <span key={source}>{source} <b>{current ? count(source) : "…"}</b></span>)}</div>
    <div className="wh-calendar-month"><button type="button" aria-label="이전 달" onClick={() => shift(-1)}>‹</button><b>{month.replace("-", "년 ")}월</b><button type="button" aria-label="다음 달" disabled={month >= view.today.slice(0, 7)} onClick={() => shift(1)}>›</button></div>
    <div className="wh-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map(d => <span key={d}>{d}</span>)}</div>
    <div className="wh-calendar-grid">{Array.from({ length: new Date(`${month}-01T12:00:00`).getDay() }, (_, i) => <span key={`pad-${i}`} />)}{Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() }, (_, i) => {
      const day = `${month}-${String(i + 1).padStart(2, "0")}`, n = current ? execution.days[day] ?? 0 : 0;
      return <button type="button" key={day} className={`wh-day level-${n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4}`} disabled={day > view.today || !current} aria-pressed={day === date} aria-label={`${day} · ${day > view.today ? "집계 전" : `실행 ${n}회`}`} title={`${day} · 실행 ${n}회`} onClick={() => setSelected(day)}>{i + 1}</button>;
    })}</div>
    <div className="wh-calendar-legend"><span>적음</span>{[0, 1, 2, 3, 4].map(n => <i key={n} className={`level-${n}`} />)}<span>많음</span></div>
    <div className="wh-calendar-selected" aria-live="polite"><span>{dateText(date)}</span><b>실행 {current ? execution.days[date] ?? 0 : "…"}회</b></div>
    <div className="wh-execution-details" aria-label="선택한 날짜의 실행 내역">{!current ? <p role="status">실행 기록을 불러오는 중…</p> : groups.length ? groups.map(g => {
      const project = view.projects.find(p => p.alias === g.alias);
      return <button type="button" key={`${g.alias}:${g.source}`} onClick={() => g.source === "테스트" ? onOpenTest(g.alias) : onOpenProject(g.alias)} aria-label={`${project?.name ?? g.alias} ${g.source} 실행 ${g.count}회 · ${g.source === "테스트" ? "테스트" : "프로젝트"} 화면 열기`}><span><b>{project?.name ?? g.alias}</b><small>{g.source}{g.failed ? ` · 실패 ${g.failed}건` : ""}</small></span><strong>{g.count}<small>회 ↗</small></strong></button>;
    }) : <p>이 날짜에 수집된 실행 기록이 없습니다.</p>}</div>
    <p className="wh-footnote">완료된 명령 1건·수집된 테스트 실행 1건 = 각 1회<br />대화·파일 편집·커밋은 세지 않습니다.</p>
    {!execution.commandsConnected ? <p className="wh-footnote">Claude·Codex 실행 기록이 연결되지 않았습니다.</p> : null}
    {current && !execution.total ? <p className="wh-footnote">이 달에 수집된 실행 기록이 없습니다.</p> : null}
    {execution.rejected ? <p className="wh-issue">읽지 못한 실행 기록 {execution.rejected}건은 집계에서 제외했습니다.</p> : null}
    {execution.unavailable.length ? <p className="wh-issue" role="status">{execution.unavailable.join(" · ")} 기록 일부를 읽지 못해 집계가 불완전합니다.</p> : null}
  </section>;
}

export function WorkspaceHome({ revision, onOpenProject, onOpenTodo, onOpenTest, onAdd, readOnly }: {
  revision: number; onOpenProject: (alias: string) => void; onOpenTodo: (alias: string, id: string) => void; onOpenTest: (alias: string) => void; onAdd: () => void; readOnly: boolean;
}) {
  const [view, setView] = useState<HomeResponse | null>(null), [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<HomeStatus | "all">("all");
  const [tab, setTab] = useState<"projects" | "favorites" | "outputs">("projects");
  const [layout, setLayout] = useState<"gallery" | "list">(() => saved("patchbay.home.layout") === "list" ? "list" : "gallery");
  const [favorites, setFavorites] = useState<string[]>(() => { const value = saved("patchbay.home.favorites"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; });
  const [hidden, setHidden] = useState(false), [sort, setSort] = useState("recent"), [tick, setTick] = useState(0);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [collection, setCollection] = useState<{ alias: string; path?: string } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setTick(n => n + 1); }, 15000);
    const visible = () => { if (!document.hidden) setTick(n => n + 1); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), month, hidden: hidden ? "1" : "0" });
      void fetch(`/api/home?${params}`, { signal: controller.signal, cache: "no-store" }).then(async res => {
        const body = await res.json() as HomeResponse & { error?: string };
        if (!res.ok || body.error) throw new Error(body.error ?? "메인 화면을 불러오지 못했습니다.");
        if (!controller.signal.aborted) { setView(body); setError(null); }
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    }, query ? 220 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, hidden, month, revision, tick]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName))) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  const projects = view?.projects ?? [];
  const visible = projects.filter(p => (filter === "all" || p.status === filter) && (tab !== "favorites" || query.trim() || favorites.includes(p.alias)));
  const sorted = [...visible].sort(sort === "name" ? (a, b) => (a.name ?? a.alias).localeCompare(b.name ?? b.alias, "ko") : (a, b) => (b.latest?.at ?? "").localeCompare(a.latest?.at ?? ""));
  const cards = sorted.filter(p => p.matches);
  const outputs = visible.flatMap(p => p.outputs).filter(o => o.matches).sort(sort === "name" ? (a, b) => a.title.localeCompare(b.title, "ko") : (a, b) => b.at.localeCompare(a.at));
  const allOutputs = projects.flatMap(p => p.outputs).sort((a, b) => b.at.localeCompare(a.at));
  // Keep each project's order without allowing one long backlog to hide all other projects.
  const todos = Array.from({ length: Math.max(0, ...projects.map(p => p.todos.length)) }, (_, index) => projects.flatMap(p => p.todos[index] ? [p.todos[index]!] : [])).flat().slice(0, 6);
  const totalTodos = projects.reduce((sum, p) => sum + p.todos.length, 0);
  const selectedProject = collection ? projects.find(p => p.alias === collection.alias) : null;
  function favorite(alias: string) { setFavorites(prev => { const next = prev.includes(alias) ? prev.filter(p => p !== alias) : [...prev, alias]; save("patchbay.home.favorites", next); return next; }); }
  function outputCard(output: HomeOutput, recent = false) { return <OutputCard key={`${output.alias}:${output.path}`} output={output} project={projects.find(p => p.alias === output.alias)!} recent={recent} onOpen={() => setCollection({ alias: output.alias, path: output.path })} />; }
  const noResults = tab === "outputs" ? !outputs.length : !cards.length && (!query.trim() || !outputs.length);

  return <div className="workspace-home">
    <header className="wh-topbar"><span className="wh-breadcrumb">작업 공간 <i>/</i> <b>홈</b></span><label className="wh-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input ref={search} type="search" maxLength={200} aria-label="프로젝트와 결과물 검색" placeholder="프로젝트·결과물 검색" value={query} onChange={event => setQuery(event.target.value)} /><kbd>/</kbd></label><button type="button" className="wh-primary" onClick={onAdd} disabled={readOnly}>＋ 새 프로젝트</button></header>
    <div className="wh-body"><header className="wh-welcome"><div><small>YOUR WORKSPACE</small><h1>Patchbay</h1><p>하던 일을 이어가고, 새로 쌓인 결과를 만나보세요.</p></div><div className="wh-date">{new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}<span>할 일 <b>{totalTodos}</b><i>·</i>실행 중 <b>{projects.filter(p => p.status === "running").length}</b></span></div></header>
      {error ? <p className="wh-error" role="alert">{error} <button type="button" onClick={() => setTick(n => n + 1)}>다시 조회</button></p> : null}
      {!view ? <p role="status">프로젝트와 결과물을 불러오는 중…</p> : <div className="wh-columns"><div className="wh-main">
        {!query.trim() && tab === "projects" ? <section className="wh-recent"><div className="wh-section-title"><h2>최근 결과물</h2><button type="button" onClick={() => setTab("outputs")}>모두 보기 →</button></div>{allOutputs.length ? <div className="wh-recent-strip">{allOutputs.slice(0, 3).map(o => outputCard(o, true))}</div> : <div className="wh-empty"><h3>아직 생성된 결과물이 없습니다</h3><p>프로젝트 문서와 화면이 만들어지면 이곳에 표시됩니다.</p></div>}</section> : null}
        <section className="wh-library" aria-label="프로젝트와 결과물"><div className="wh-section-title wh-library-title"><div><h2>{query.trim() ? "검색 결과" : tab === "outputs" ? "결과물 모아보기" : "내 프로젝트"}</h2><p>{query.trim() ? `‘${query.trim()}’ · 프로젝트와 문서 내용에서 찾습니다.` : "프로젝트를 열거나, 지금까지 만든 결과물을 살펴보세요."}</p></div><button type="button" className="wh-secondary" onClick={onAdd} disabled={readOnly}>＋ 프로젝트 연결</button></div>
          <nav className="wh-tabs" aria-label="프로젝트와 결과물 보기">{([["projects", "모든 프로젝트", projects.length], ["favorites", "즐겨찾기", projects.filter(p => favorites.includes(p.alias)).length], ["outputs", "결과물", allOutputs.length]] as const).map(([id, label, count]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label} <span>{count}</span></button>)}</nav>
          <div className="wh-toolbar"><nav className="wh-filters" aria-label="프로젝트 상태 필터">{(["all", "turn", "running", "problem"] as const).map(id => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{id === "all" ? "전체" : STATUS[id]} <span>{projects.filter(p => id === "all" || p.status === id).length}</span></button>)}</nav><div className="wh-library-tools"><label><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />숨김 포함</label><select aria-label="프로젝트와 결과물 정렬" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">최근 기록순</option><option value="name">이름순</option></select>{tab !== "outputs" ? <div className="wh-layout-switch">{(["gallery", "list"] as const).map(id => <button type="button" key={id} aria-label={id === "gallery" ? "갤러리 보기" : "목록 보기"} aria-pressed={layout === id} onClick={() => { setLayout(id); save("patchbay.home.layout", id); }}>{id === "gallery" ? "▦" : "☷"}</button>)}</div> : null}</div></div>
          {tab !== "outputs" && cards.length ? <div className={`wh-project-grid${layout === "list" ? " is-list" : ""}`}>{cards.map(p => <ProjectCard key={p.alias} project={p} favorite={favorites.includes(p.alias)} onFavorite={() => favorite(p.alias)} onOpen={() => onOpenProject(p.alias)} onOutputs={() => setCollection({ alias: p.alias })} />)}</div> : null}
          {(tab === "outputs" || query.trim()) && outputs.length ? <><h3 className="wh-output-group-title">결과물 <span>{outputs.length}</span></h3><div className="wh-output-grid">{outputs.map(o => outputCard(o))}</div></> : null}
          {noResults ? <div className="wh-empty"><h3>{query.trim() ? "일치하는 프로젝트나 결과물이 없습니다" : tab === "favorites" ? "즐겨찾기한 프로젝트가 없습니다" : projects.length ? "해당하는 항목이 없습니다" : "등록된 프로젝트가 없습니다"}</h3><p>{tab === "favorites" ? "카드의 별표를 눌러 자주 찾는 프로젝트를 모아 보세요." : "검색어·필터를 바꾸거나 새 프로젝트를 연결해 보세요."}</p><button type="button" className="wh-secondary" onClick={() => { setQuery(""); setFilter("all"); setTab("projects"); }}>전체 프로젝트 보기</button></div> : null}
          {projects.some(p => p.outputLimited) ? <p className="wh-footnote">결과물이 많은 프로젝트는 목록 일부를 표시합니다. 전체 파일은 프로젝트의 폴더 · 문서에서 확인해 주세요.</p> : null}
        </section>
      </div><aside className="wh-aside" aria-label="해야 할 일과 코드 실행"><section className="wh-todos"><div className="wh-section-title"><h2>☑ 해야 할 일 <span>{totalTodos}</span></h2><small>프로젝트별</small></div><p>할 일을 누르면 해당 프로젝트로 이동합니다.</p>{todos.map(t => { const p = projects.find(p => p.alias === t.alias)!; return <button type="button" className="wh-todo" key={`${t.alias}:${t.id}`} onClick={() => onOpenTodo(t.alias, t.id)}><ProjectIcon project={p} /><span><small>{p.name ?? p.alias}</small><b>{t.title}</b><span>할 일 #{t.order}</span></span><i>↗</i></button>; })}{!totalTodos ? <p className="wh-no-todos">남은 할 일이 없습니다.</p> : totalTodos > todos.length ? <small className="wh-footnote">각 프로젝트의 앞선 할 일부터 {todos.length}건을 표시합니다.</small> : null}</section>
        {projects.some(p => p.status === "running") ? <section className="wh-running"><h2><i /> Agent가 작업 중이에요</h2>{projects.filter(p => p.status === "running").map(p => <button type="button" key={p.alias} onClick={() => onOpenProject(p.alias)}><ProjectIcon project={p} /><span><b>{p.name ?? p.alias}</b><small>작업 화면 열기 →</small></span></button>)}</section> : null}
        <ExecutionCalendar view={view} month={month} onMonth={setMonth} onOpenProject={onOpenProject} onOpenTest={onOpenTest} />
      </aside></div>}
    </div>{selectedProject && collection ? <HomeOutputViewer project={selectedProject} initialPath={collection.path} onClose={() => setCollection(null)} /> : null}
  </div>;
}
