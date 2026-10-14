import { useEffect, useState } from "react";
import {
  IMPACT_HOP_CHOICES,
  isImpactViewOk,
  type ImpactPortView,
  type ImpactViewOk,
  type ImpactViewResponse,
} from "./neo4jContract.js";

const PORT_KIND = /^(source|skill|artifact|agent|signal):/;

/** A bare path is the common case when typing; treat it as a `source:` port. */
export function toPortId(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  return PORT_KIND.test(text) ? text : `source:${text}`;
}

const LABEL_TEXT: Record<string, string> = {
  Skill: "SKILL",
  File: "FILE",
  Folder: "DIR",
  Artifact: "OUT",
};

/**
 * Impact radius over the patch/wire graph. Deliberately independent of the
 * Neo4j panes below it: Core computes this from inferred + overlay, so it
 * answers with the sidecar down, and `get_impact` gives a host model the
 * same numbers over MCP.
 */
export function ImpactPanel({
  project,
  seed,
  revision = 0,
  onOpenFile,
}: {
  project: string;
  seed?: string;
  revision?: number;
  onOpenFile?: (path: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [origin, setOrigin] = useState("");
  const [hops, setHops] = useState(3);
  const [view, setView] = useState<ImpactViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seed) return;
    setDraft(seed);
    setOrigin(toPortId(seed));
  }, [seed]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ alias: project, hops: String(hops) });
    if (origin) params.set("port", origin);
    fetch(`/api/knowledge/impact?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as ImpactViewResponse | { error: string };
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
  }, [project, origin, hops, revision]);

  if (view && !isImpactViewOk(view)) return null;

  return (
    <section className="impact">
      <p className="doc-lead">
        <b>영향 반경</b> — 이 파일을 바꾸면 연결을 따라 어디까지 닿는가.
      </p>
      <div className="impact-bar">
        <input
          className="impact-input"
          value={draft}
          placeholder="파일 경로 (예: docs/자료/유형.md)"
          aria-label="영향 반경을 볼 파일"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") setOrigin(toPortId(draft));
          }}
        />
        <button type="button" className="flow-btn" onClick={() => setOrigin(toPortId(draft))}>
          영향 반경
        </button>
        <div className="impact-hops" role="group" aria-label="홉 거리">
          {IMPACT_HOP_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`impact-hop${hops === choice ? " is-on" : ""}`}
              aria-pressed={hops === choice}
              onClick={() => setHops(choice)}
            >
              {choice}홉
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="flow-error">{error}</p> : null}
      {view ? <ImpactBody view={view} onOpenFile={onOpenFile} onPick={(port) => {
        setDraft(port);
        setOrigin(port);
      }} /> : null}
    </section>
  );
}

function ImpactBody({
  view,
  onOpenFile,
  onPick,
}: {
  view: ImpactViewOk;
  onOpenFile?: (path: string) => void;
  onPick: (port: string) => void;
}) {
  const rings = view.rings;
  return (
    <div className="impact-split">
      <div className="impact-main">
        {view.origin ? (
          <header className="impact-head">
            <span className="impact-tag">{LABEL_TEXT[originLabel(view)] ?? "FILE"}</span>
            <b className="impact-origin">{view.origin.replace(PORT_KIND, "")}</b>
            {view.known ? null : <span className="impact-chip is-warn">연결 기록에 없음</span>}
            <span className="impact-grow" />
            <span className="impact-chip">영향받는 노드 {view.total}</span>
          </header>
        ) : (
          <header className="impact-head">
            <b className="impact-origin muted">파일을 넣으면 홉마다 닿는 노드가 여기 놓인다</b>
          </header>
        )}

        {view.origin && rings.length > 0 ? (
          <div className="impact-rings">
            {rings.map((ring) => (
              <div className="impact-ring" key={ring.hop}>
                <div className="impact-ring-h">
                  <b>{ring.hop}홉</b>
                  <span className="impact-n">{ring.count}</span>
                </div>
                {ring.ports.map((hit) => (
                  <ImpactRow key={hit.port} hit={hit} onOpenFile={onOpenFile} />
                ))}
                {ring.count === 0 ? <span className="impact-none">없음</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <aside className="impact-rail">
        <div className="impact-card">
          <h4>부채</h4>
          <div className="impact-kv">
            <span>고아 · 참조 0</span>
            <b>{view.debt.orphans}</b>
          </div>
          <div className="impact-kv">
            <span>허브 · 연결 4+</span>
            <b>{view.debt.hubs.length}</b>
          </div>
        </div>
        {view.debt.hubs.length > 0 ? (
          <div className="impact-card">
            <h4>허브</h4>
            {view.debt.hubs.map((hub) => (
              <button type="button" key={hub.port} className="impact-hub" onClick={() => onPick(hub.port)}>
                <span className="impact-hub-name">{hub.name}</span>
                <span className="impact-n">{hub.degree}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ImpactRow({ hit, onOpenFile }: { hit: ImpactPortView; onOpenFile?: (path: string) => void }) {
  return (
    <button type="button" className="impact-row" onClick={() => onOpenFile?.(hit.path)} title={hit.path}>
      <span className={`impact-tag${hit.label === "Skill" ? " is-skill" : ""}`}>
        {LABEL_TEXT[hit.label] ?? "FILE"}
      </span>
      <span className="impact-path">{hit.path}</span>
      <span className="impact-kind">{hit.kind}</span>
    </button>
  );
}

function originLabel(view: ImpactViewOk): string {
  if (view.origin?.startsWith("skill:")) return "Skill";
  if (view.origin?.startsWith("artifact:")) return "Artifact";
  return "File";
}
