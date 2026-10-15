import { SidebarIcon } from "./SidebarIcon.js";
import { LOG_OPEN_EVENT, ProjectLogPane } from "./ProjectLogPane.js";
import { ProjectTools } from "./ProjectTools.js";
import { SystemArchitecturePanel } from "./SystemArchitecturePanel.js";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AddProjectDialog } from "./AddProjectDialog.js";
import { BoardPane } from "./BoardPane.js";
import { BuildPane } from "./BuildPane.js";
import { ROOM_EVENT_NAME, STUDIO_EVENT_NAMES } from "./eventsContract.js";
import { FilePeek } from "./FilePeek.js";
import { IrPane } from "./IrPane.js";
import { KnowledgePane } from "./KnowledgePane.js";
import { DashboardPane } from "./DashboardPane.js";
import { UsePane } from "./UsePane.js";
import { ProcessBar } from "./ProcessBar.js";
import { ScanButton } from "./ScanButton.js";
import { EMPTY_PROCESS_VIEW, isProjectViewOk, type ProjectViewResponse } from "./projectContract.js";
import { StructurePane } from "./StructurePane.js";
import { ConsultPane } from "./ConsultPane.js";
import { PrdPane } from "./PrdPane.js";
import { RoomPanel } from "./RoomPanel.js";
import { LlmHealthRail } from "./LlmHealthRail.js";
import {
  adapterLabel,
  projectLabel,
  type AdapterStatus,
  type ShellResponse,
} from "./shellContract.js";
import {
  projectInitials,
  projectIconColor,
  stageMeta,
  type StageId,
  type WorkspaceProject,
  type WorkspaceResponse,
} from "./workspaceContract.js";

type Place = "home" | StageId | "board" | "plan" | "architecture" | "files" | "log";

export default function App() {
  const [session, setSession] = useState<{ role: "read" | "write" | null } | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/session").then(r => r.json()).then(setSession).catch(() => setError("서버 연결을 확인한다.")); }, []);
  if (!session || !session.role) return <div className="flow-login"><h1>Patchbay 연결</h1>
    <p>이 기기의 연결 토큰으로 대화와 실행 기록을 확인합니다.</p>
    <form onSubmit={async e => { e.preventDefault(); const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }); const body = await res.json(); if (res.ok) { setSession(body); setToken(""); } else setError(body.error); }}>
      <input type="password" aria-label="연결 토큰" value={token} onChange={e => setToken(e.target.value)} autoComplete="current-password" />
      <button type="submit" className="flow-btn primary" disabled={!token || !session}>연결</button>
    </form>{error ? <p role="alert">{error}</p> : null}</div>;
  return <WorkspaceApp readOnly={session.role === "read"} />;
}

function WorkspaceApp({ readOnly }: { readOnly: boolean }) {
  const [shell, setShell] = useState<ShellResponse | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState<Place>("dashboard");
  // History 칸에서 날짜를 고르면 Log 의 그날을 연다 (사용자 결정 2026-10-15 — History 는 Log 의 입력 · 요약창).
  const [logDate, setLogDate] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => { setLogDate((event as CustomEvent<{ date: string }>).detail.date); setPlace("log"); };
    window.addEventListener(LOG_OPEN_EVENT, open);
    return () => window.removeEventListener(LOG_OPEN_EVENT, open);
  }, []);
  const [project, setProject] = useState<string>("");
  const [revision, setRevision] = useState(0);
  // 대화방 파일만 바뀌면 대화 칸만 다시 읽는다 — 폰 세션의 말이 훅으로 들어올 때 (ROOM_EVENT_NAME).
  const [roomRevision, setRoomRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  // 진행과 대화를 같은 오른쪽 작업 패널에 둔다 (사용자 결정 2026-10-10).
  const [chatOpen, setChatOpen] = useState(true);
  const [chatAside, setChatAside] = useState(false);
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [linkedRoom, setLinkedRoom] = useState<{ alias: string; id: string } | null>(null);
  const [draftRequest, setDraftRequest] = useState<{ text: string; nonce: number }>();
  const [consultRequest, setConsultRequest] = useState<{ project: string; note: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/shell").then(async (res) => {
        const body = (await res.json()) as ShellResponse | { error: string };
        if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        return body;
      }),
      fetch("/api/workspace").then(async (res) => {
        const body = (await res.json()) as WorkspaceResponse | { error: string };
        if (!res.ok || !("projects" in body)) throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        return body;
      }),
    ])
      .then(([nextShell, nextWorkspace]) => {
        if (cancelled) return;
        setShell(nextShell);
        setWorkspace(nextWorkspace);
        setProject((prev) => prev || nextShell.selected || nextWorkspace.projects[0]?.alias || "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const shellProjects = shell?.projects ?? [];
  const aliases = shellProjects.map((item) => item.alias);
  const hasProjects = aliases.length > 0;
  const selected = hasProjects ? project || aliases[0]! : "";
  const label = projectLabel(shellProjects, selected);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const current = workspace?.projects.find((item) => item.alias === selected);

  useEffect(() => {
    const source = new EventSource("/api/events");
    const onStudioEvent = (ev: Event) => {
      const message = ev as MessageEvent<string>;
      try {
        const payload = JSON.parse(message.data) as { alias?: string };
        if (payload.alias && payload.alias === selectedRef.current) {
          setRevision((n) => n + 1);
        }
      } catch {
        // Malformed payloads are ignored; the next file event retries the refetch.
      }
    };
    const onRoomEvent = (ev: Event) => {
      try {
        const payload = JSON.parse((ev as MessageEvent<string>).data) as { alias?: string };
        if (payload.alias && payload.alias === selectedRef.current) setRoomRevision((n) => n + 1);
      } catch {
        // 다음 이벤트가 다시 읽는다.
      }
    };
    for (const name of STUDIO_EVENT_NAMES) {
      source.addEventListener(name, onStudioEvent);
    }
    source.addEventListener(ROOM_EVENT_NAME, onRoomEvent);
    return () => {
      source.removeEventListener(ROOM_EVENT_NAME, onRoomEvent);
      for (const name of STUDIO_EVENT_NAMES) {
        source.removeEventListener(name, onStudioEvent);
      }
      source.close();
    };
  }, []);

  useEffect(() => {
    const read = () => {
      const match = /^#room\/([^/]+)\/([^/]+)$/.exec(window.location.hash);
      if (!match) {
        setLinkedRoom(null);
        return;
      }
      setLinkedRoom({ alias: decodeURIComponent(match[1]), id: decodeURIComponent(match[2]) });
      setProject(decodeURIComponent(match[1]));
      setChatOpen(true);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  function pickProject(alias: string) {
    setProject(alias);
    setPlace("dashboard");
    if (window.location.hash.startsWith("#room/")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setLinkedRoom(null);
    }
  }

  // 레일 불빛 — LLM이 일하는 중인 프로젝트. 서버 메모리만 읽는 가벼운 요청이라 짧게 물어본다.
  const [runningAliases, setRunningAliases] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      fetch("/api/running", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ aliases?: string[] }>)
        .then((body) => setRunningAliases(body.aliases ?? []))
        .catch(() => setRunningAliases([]));
    };
    read();
    const timer = window.setInterval(read, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleProjects = (workspace?.projects ?? []).filter((item) => !item.hidden);
  const hiddenProjects = (workspace?.projects ?? []).filter((item) => item.hidden);

  // 숨긴 프로젝트가 골라져 있으면 보이는 첫 프로젝트로 옮긴다 — 레일에 없는 것을 띄워 두지 않는다.
  useEffect(() => {
    if (!current?.hidden) return;
    const first = visibleProjects[0];
    if (first) setProject(first.alias);
  }, [current?.alias, current?.hidden, visibleProjects[0]?.alias]);

  async function setHidden(alias: string, hidden: boolean) {
    await fetch("/api/project/hidden", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias, hidden }),
    });
    if (!hidden) setProject(alias);
    setShowHidden(false);
    setRevision((n) => n + 1);
  }

  return (
    <div className={`shell is-unified${chatOpen ? "" : " is-chat-off"}${chatOpen && chatAside ? " is-chat-aside" : ""}`}>
      {/* 레일 — 셸 시안 나 (사용자 결정 2026-10-05). 프로젝트를 한 번에 바꾸고, 기획 · 배치도로 간다. */}
      <nav className="rail" aria-label="프로젝트와 도구">
        <PatchbayMark />
        <div className="rail-projects">
          {visibleProjects.map((item) => {
            const name = item.name ?? item.alias;
            const stage = item.stages.find((s) => s.id === item.current);
            const meta = stageMeta(item.current);
            const running = runningAliases.includes(item.alias);
            const said = `${stage ? `${name} — ${meta.num} ${meta.label} · ${stage.status}` : name}${running ? " · LLM 실행 중" : item.attention === "blocked" ? " · 막힌 칸 있음" : ""}`;
            return (
              <div key={item.alias} className="rail-pj-wrap">
                <button
                  type="button"
                  className="rail-pj is-project"
                  style={{ "--project-color": projectIconColor(item.alias) } as CSSProperties}
                  aria-current={item.alias === selected ? "true" : undefined}
                  aria-label={said}
                  title={said}
                  onClick={() => pickProject(item.alias)}
                >
                  {projectInitials(name)}
                  {running ? <i className="rail-dot is-running" aria-hidden="true" /> : item.attention ? <i className={`rail-dot is-${item.attention}`} aria-hidden="true" /> : null}
                </button>
                {/* 레일에서만 뺀다 — 등록과 파일은 그대로다. 아래 「숨김」에서 다시 보인다. */}
                <button
                  type="button"
                  className="rail-pj-hide"
                  aria-label={`${name} 레일에서 숨기기`}
                  title="레일에서 숨기기"
                  onClick={() => void setHidden(item.alias, true)}
                >
                  ×
                </button>
              </div>
            );
          })}
          <button type="button" className="rail-pj is-add" aria-label="새 프로젝트" title="새 프로젝트" onClick={() => setAdding(true)}>
            <SidebarIcon name="add" />
          </button>
          {hiddenProjects.length > 0 ? (
            <button
              type="button"
              className="rail-hidden-btn"
              aria-expanded={showHidden}
              title="숨긴 프로젝트"
              onClick={() => setShowHidden((open) => !open)}
            >
              숨김 {hiddenProjects.length}
            </button>
          ) : null}
        </div>
        {showHidden ? (
          <div className="rail-hidden" role="dialog" aria-label="숨긴 프로젝트">
            <b>숨긴 프로젝트</b>
            <small>레일에서만 뺐다. 등록과 기록은 그대로다.</small>
            {hiddenProjects.map((item) => (
              <div key={item.alias} className="rail-hidden-row">
                <span>{item.name ?? item.alias}</span>
                <button type="button" className="flow-btn" onClick={() => void setHidden(item.alias, false)}>
                  다시 보이기
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {hasProjects ? (
          <><div className="rail-divider" aria-hidden="true" /><ProjectTools place={place} onNavigate={setPlace} /></>
        ) : null}
        <div className="rail-foot">
          <LlmHealthRail revision={revision + roomRevision} readOnly={readOnly} />
          <SidecarDot
            name="LangGraph"
            status={shell?.adapters.langgraph ?? "disconnected"}
            onClick={() => setPlace("build")}
          />
          <SidecarDot name="Neo4j" status={shell?.adapters.neo4j ?? "disconnected"} onClick={() => setPlace("graph")} />
        </div>
      </nav>

      <div className="main-col">

        <main className="pane" data-pane={place}>
          {error ? <p>{error}</p> : null}
          {!error && !shell ? <p>불러오는 중</p> : null}
          {shell && !hasProjects ? (
            <div className="empty">
              <h2>등록된 프로젝트가 없습니다</h2>
              <p>왼쪽 「+」로 이 컴퓨터의 폴더를 등록한다.</p>
              <button type="button" className="flow-btn primary" onClick={() => setAdding(true)}>
                + 새 프로젝트
              </button>
            </div>
          ) : null}
          {shell && hasProjects && workspace ? (
            <PlaceBody
              place={place}
              readOnly={readOnly}
              logDate={logDate}
              project={selected}
              label={label}
              revision={revision}
              projects={workspace.projects}
              onOpenStage={(id) => setPlace(id)}
              onOpenFile={setPeekPath}
              onWorkspaceChanged={() => setRevision((n) => n + 1)}
              onAsk={(text) => {
                setChatOpen(true);
                setChatAside(false);
                setDraftRequest((current) => ({ text, nonce: (current?.nonce ?? 0) + 1 }));
              }}
              consultRequest={consultRequest?.project === selected ? consultRequest.note : undefined}
              onConsultSent={() => setConsultRequest(null)}
              onLangGraphStatus={(status) => {
                setShell((prev) =>
                  prev ? { ...prev, adapters: { ...prev.adapters, langgraph: status } } : prev,
                );
              }}
              onNeo4jStatus={(status) => {
                setShell((prev) =>
                  prev ? { ...prev, adapters: { ...prev.adapters, neo4j: status } } : prev,
                );
              }}
            />
          ) : null}
          {peekPath && selected ? <FilePeek alias={selected} path={peekPath} onClose={() => setPeekPath(null)} /> : null}
        </main>
        <aside className="workspace-side" aria-label="진행과 대화">
      {chatOpen ? (
        <aside className={`ws-chat workspace-chat-panel${chatAside ? " is-aside" : ""}`} aria-label="대화">
          {chatAside ? <button
            type="button"
            className="chat-nudge"
            aria-label={chatAside ? "대화 펼치기" : "대화 최소화"}
            aria-pressed={chatAside}
            onClick={() => setChatAside((aside) => !aside)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d={chatAside ? "M10 3.5 5.5 8 10 12.5" : "M6 3.5 10.5 8 6 12.5"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button> : null}
          {selected ? (
            <RoomPanel
              project={selected}
              revision={revision + roomRevision}
              openRoom={linkedRoom?.alias === selected ? linkedRoom.id : ""}
              onClose={() => setChatAside(true)}
              readOnly={readOnly}
              draftRequest={draftRequest}
              onConsult={(note) => {
                setPlace("design");
                setChatOpen(false);
                setConsultRequest(note ? { project: selected, note } : null);
              }}
              onOpenRoom={(id) => {
                if (!id) {
                  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
                  setLinkedRoom(null);
                  return;
                }
                const hash = `#room/${encodeURIComponent(selected)}/${encodeURIComponent(id)}`;
                if (window.location.hash !== hash) window.location.hash = hash;
              }}
            />
          ) : null}
        </aside>
      ) : <section className="workspace-chat-closed"><span className="sec-title">프로젝트 대화</span><p>구조를 보며 대화와 작업을 이어갑니다.</p><button type="button" className="flow-btn" onClick={() => { setChatAside(false); setChatOpen(true); }}>대화 열기 ↗</button></section>}
        </aside>
      </div>

      {adding ? (
        <AddProjectDialog
          onClose={() => setAdding(false)}
          onAdded={(alias) => {
            setAdding(false);
            setProject(alias);
            setPlace("dashboard");
            setRevision((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function PlaceBody({
  place,
  readOnly,
  logDate,
  project,
  label,
  revision,
  projects,
  onOpenStage,
  onOpenFile,
  onLangGraphStatus,
  onNeo4jStatus,
  onWorkspaceChanged,
  onAsk,
  consultRequest,
  onConsultSent,
}: {
  place: Place;
  readOnly: boolean;
  logDate: string | null;
  project: string;
  label: string;
  revision: number;
  projects: WorkspaceProject[];
  onOpenStage: (id: Place) => void;
  onOpenFile: (path: string) => void;
  onLangGraphStatus: (status: AdapterStatus) => void;
  onNeo4jStatus: (status: AdapterStatus) => void;
  /** 단계 띠를 다시 읽는다 — 테스트에서 지난 노드가 늘었을 때. */
  onWorkspaceChanged: () => void;
  onAsk: (text: string) => void;
  consultRequest?: string;
  onConsultSent: () => void;
}) {
  if (place === "design") {
    return (
      <DesignPane
        project={project}
        revision={revision}
        onOpenFile={onOpenFile}
        onGoBuild={() => onOpenStage("build")}
        consultRequest={consultRequest}
        onConsultSent={onConsultSent}
      />
    );
  }
  if (place === "build") {
    return (
      <BuildPane
        project={project}
        revision={revision}
        onOpenStage={onOpenStage}
        onOpenFile={onOpenFile}
        onLangGraphStatus={onLangGraphStatus}
      />
    );
  }
  if (place === "graph" || place === "docs") {
    return (
      <KnowledgePane project={project} revision={revision} stage={place} onNeo4jStatus={onNeo4jStatus} />
    );
  }
  if (place === "test") {
    return <UsePane project={project} revision={revision} onOpenStage={onOpenStage} onPassedChange={onWorkspaceChanged} />;
  }
  if (place === "log") return <ProjectLogPane project={project} revision={revision} workspace={projects.find(p => p.alias === project)} initialDate={logDate} />;
  if (place === "architecture") {
    return <section className="project-architecture-page"><h2>아키텍처</h2><SystemArchitecturePanel /></section>;
  }
  if (place === "files") {
    return <StructureHost project={project} label={label} revision={revision} />;
  }
  if (place === "board") {
    return <BoardPane project={project} revision={revision} />;
  }
  if (place === "plan") {
    return <PlanPane project={project} revision={revision} onOpenFile={onOpenFile} />;
  }
  if (place === "dashboard" || place === "home") {
    return (
      <DashboardPane
        project={project}
        readOnly={readOnly}
        onProjectRenamed={onWorkspaceChanged}
        revision={revision}
        onOpenStage={onOpenStage}
        onOpenFile={onOpenFile}
        workspace={projects.find((item) => item.alias === project)}
        onAsk={onAsk}
        repo={<StructureHost project={project} label={label} revision={revision} />}
      />
    );
  }
  return null;
}

/**
 * 1 설계 — 기본 입구는 상담(채팅 + 요약 패널), 다 차면 PRD 검토에서 절마다 확인하고 채택한다
 * (명세 20261006a §12~§14, 사용자 결정 2026-10-06). 설계도와 검사는 칸을 직접 보고 고치는 곳.
 * 「자세히 묻기」(설문) 탭은 뺐다 — 자료는 상담의 「+」로 붙인다 (사용자 요청 2026-10-07).
 */
function DesignPane({
  project,
  revision,
  onOpenFile,
  onGoBuild,
  consultRequest,
  onConsultSent,
}: {
  project: string;
  revision: number;
  onOpenFile: (path: string) => void;
  onGoBuild: () => void;
  consultRequest?: string;
  onConsultSent: () => void;
}) {
  const [tab, setTab] = useState<"consult" | "prd" | "ir">("consult");
  const [pendingFix, setPendingFix] = useState<{ n: number; note: string; raw?: boolean } | null>(null);
  useEffect(() => {
    if (consultRequest) { setPendingFix({ n: 0, note: consultRequest, raw: true }); setTab("consult"); }
  }, [consultRequest]);
  const tabs: { id: typeof tab; label: string; hint: string }[] = [
    { id: "consult", label: "상담", hint: "말하면 설계가 자란다" },
    { id: "prd", label: "PRD 검토", hint: "절마다 확인 · 채택" },
    { id: "ir", label: "설계도와 검사", hint: "칸 보기 · 직접 고치기" },
  ];
  return (
    <>
      <div className="design-tabs" role="tablist" aria-label="설계">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            <small>{t.hint}</small>
          </button>
        ))}
      </div>
      {tab === "consult" ? (
        <ConsultPane
          project={project}
          revision={revision}
          onOpenPrd={() => setTab("prd")}
          pending={pendingFix}
          onPendingSent={() => { setPendingFix(null); onConsultSent(); }}
        />
      ) : tab === "prd" ? (
        <PrdPane
          project={project}
          revision={revision}
          onFix={(n, note, raw) => {
            setPendingFix({ n, note, ...(raw ? { raw } : {}) });
            setTab("consult");
          }}
          onGoBuild={onGoBuild}
        />
      ) : (
        <IrPane project={project} revision={revision} onOpenFile={onOpenFile} onGoBuild={onGoBuild} />
      )}
    </>
  );
}

function PlanPane({
  project,
  revision,
  onOpenFile,
}: {
  project: string;
  revision: number;
  onOpenFile: (path: string) => void;
}) {
  const [view, setView] = useState<ProjectViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/project?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as ProjectViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in body) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setView(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  if (error) return <p className="flow-error">{error}</p>;
  if (!view) return <p>불러오는 중</p>;
  return (
    <>
      <h2>기획</h2>
      <ProcessBar
        project={project}
        process={view.process ?? EMPTY_PROCESS_VIEW}
        onChanged={() => setTick((n) => n + 1)}
        onOpenFile={onOpenFile}
      />
    </>
  );
}

function StructureHost({ project, label, revision }: { project: string; label: string; revision: number }) {
  const [view, setView] = useState<ProjectViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // 결정을 남긴 뒤 다시 읽기. 스캔 횟수(`tick`)와 따로 둔다 — 항목 설명까지 다시 읽을 일이 아니다.
  const [reload, setReload] = useState(0);

  useEffect(() => setScanNote(null), [project]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/project?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as ProjectViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in body) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setView(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick, reload]);

  if (error) return <p className="flow-error">{error}</p>;
  if (!view) return <p>불러오는 중</p>;
  const rescan = () => setTick((n) => n + 1);
  if (!isProjectViewOk(view)) {
    return (
      <div className="empty">
        <h2>{label}</h2>
        {view.broken ? (
          <>
            <p>스캔 결과 파일이 깨져서 읽지 못했다. 다시 스캔하면 새로 쓴다.</p>
            <p className="ir-note">{view.broken}</p>
          </>
        ) : (
          <p>스캔이 아직 없다. 폴더를 읽어 항목과 연결을 찾으면 구조가 열린다.</p>
        )}
        <ScanButton project={project} first={!view.broken} onScanned={rescan} note={scanNote} onNote={setScanNote} />
      </div>
    );
  }
  return (
    <StructurePane
      view={view}
      scans={tick}
      onChanged={() => setReload((n) => n + 1)}
      action={<ScanButton project={project} first={false} onScanned={rescan} note={scanNote} onNote={setScanNote} />}
    />
  );
}

/** 잭 세 개 중 하나가 케이블로 패치된 모양. `public/favicon.svg`와 같은 마크다. */
function PatchbayMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="Patchbay">
      <rect width="32" height="32" rx="9.6" fill="currentColor" />
      <g fill="none" stroke="var(--bg)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M11.9 10.4C19.7 10.4 22.7 14.4 22.7 18.6" />
        <circle cx="9.3" cy="10.4" r="2.6" />
        <circle cx="9.3" cy="21.6" r="2.6" />
        <circle cx="22.7" cy="21.6" r="2.6" />
      </g>
    </svg>
  );
}

/** 사이드카는 점 하나다 — 켜졌는지만 보이면 되고, 이름과 포트는 마우스를 올리면 나온다. */
function SidecarDot({
  name,
  status,
  onClick,
}: {
  name: "LangGraph" | "Neo4j";
  status: AdapterStatus;
  onClick: () => void;
}) {
  const connected = status === "connected";
  const said = adapterLabel(name, status);
  return (
    <button type="button" className={connected ? "rail-side is-on" : "rail-side"} aria-label={said} title={said} onClick={onClick}>
      <i aria-hidden="true" />
      {name === "LangGraph" ? "LG" : "N4"}
    </button>
  );
}
