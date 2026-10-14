import { useEffect, useRef, useState } from "react";
import { FilePeek } from "./FilePeek.js";
import { IrPane } from "./IrPane.js";
import { ProcessBar } from "./ProcessBar.js";
import { StructurePane } from "./StructurePane.js";
import { EMPTY_PROCESS_VIEW, isProjectViewOk, type ProjectViewResponse } from "./projectContract.js";

type Section = "dev" | "structure" | "ir";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "dev", label: "개발" },
  { id: "structure", label: "구조" },
  { id: "ir", label: "설계" },
];

export function ProjectPane({
  project,
  label,
  revision = 0,
}: {
  project: string;
  label?: string;
  revision?: number;
}) {
  const [view, setView] = useState<ProjectViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localTick, setLocalTick] = useState(0);
  const [section, setSection] = useState<Section | null>(null);
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (loadedFor.current !== project) {
      setView(null);
      setError(null);
    }
    fetch(`/api/project?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as ProjectViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in body) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        loadedFor.current = project;
        setView(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, revision, localTick]);

  /** A new project starts on its default segment, not the one left over. */
  useEffect(() => {
    setSection(null);
  }, [project]);

  const heading = label ?? project;

  if (error) {
    return (
      <>
        <h2>{heading}</h2>
        <div className="empty">
          <p>{error}</p>
        </div>
      </>
    );
  }
  if (!view) {
    return (
      <>
        <h2>{heading}</h2>
        <p>불러오는 중</p>
      </>
    );
  }

  const ok = isProjectViewOk(view);
  const current: Section = section ?? "dev";

  return (
    <>
      <h2>{heading}</h2>
      <div className="seg" role="tablist" aria-label="프로젝트 화면">
        {SECTIONS.filter((item) => available(item.id, ok)).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={current === item.id}
            className={`seg-btn${current === item.id ? " is-on" : ""}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {current === "structure" && isProjectViewOk(view) ? <StructurePane view={view} /> : null}
      {current === "ir" ? <IrPane project={project} revision={revision} onOpenFile={setPeekPath} /> : null}
      {current === "dev" ? (
        <ProcessBar
          project={project}
          process={view.process ?? EMPTY_PROCESS_VIEW}
          onChanged={() => setLocalTick((n) => n + 1)}
          onOpenFile={setPeekPath}
        />
      ) : null}
      <p className="path pane-foot">
        {view.path}
        {ok && view.git.branch ? ` · ${view.git.branch}` : ""}
      </p>
      {peekPath ? <FilePeek alias={project} path={peekPath} onClose={() => setPeekPath(null)} /> : null}
    </>
  );
}

/**
 * 구조 needs a scan. 개발 and 설계 are always there -- 설계 answers "is there a
 * design yet?" itself, and hiding the segment when there is none would make
 * 1단계 미착수 look like a missing feature.
 */
function available(section: Section, scanned: boolean): boolean {
  if (section === "structure") return scanned;
  return true;
}
