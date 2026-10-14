import { useEffect, useState } from "react";
import {
  DOCUMENT_CALL_HOP_CHOICES,
  isDocumentCallOk,
  type DocumentCallResponse,
  type DocumentCallView,
  type DocumentHit,
} from "./neo4jContract.js";

/**
 * 4단계 문서 호출 -- 「이 입력에는 어느 문서인가」를 그래프에 묻는 면.
 *
 * Computed by Core from `overlay.ir` + `inferred.json`, like the impact radius
 * beside it, so it answers with Neo4j down. The point of the panel is the
 * **근거 경로**: without it a ranked list is a black box, and 기획서 4.5 exists
 * for exactly that reason.
 */
export function DocumentCallPanel({
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
  const [anchorDraft, setAnchorDraft] = useState("");
  const [queryDraft, setQueryDraft] = useState("");
  const [anchor, setAnchor] = useState("");
  const [query, setQuery] = useState("");
  const [hops, setHops] = useState<number>(2);
  const [view, setView] = useState<DocumentCallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seed) return;
    setAnchorDraft(seed);
    setAnchor(seed);
  }, [seed]);

  useEffect(() => {
    if (!anchor) {
      setView(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ alias: project, anchor, hops: String(hops) });
    if (query) params.set("q", query);
    fetch(`/api/knowledge/documents?${params.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as DocumentCallResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || ("error" in body && !("status" in body))) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setView(body as DocumentCallResponse);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, anchor, query, hops, revision]);

  const ask = () => {
    setAnchor(anchorDraft.trim());
    setQuery(queryDraft.trim());
  };

  return (
    <section className="doc">
      <p className="doc-lead">
        <b>출발점</b>에서 관계를 <b>몇 번(홉)</b> 건너 닿는 문서를 찾고, 지나온 관계를 근거로 보인다. 벡터 검색은 없다.
      </p>
      <div className="doc-bar">
        <input
          className="doc-input"
          value={anchorDraft}
          placeholder="출발점 — 노드 · 요구사항 · 파일 (예: classify · R1)"
          aria-label="출발점"
          onChange={(event) => setAnchorDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask();
          }}
        />
        <input
          className="doc-input doc-input-wide"
          value={queryDraft}
          placeholder="물어볼 문장 (선택)"
          aria-label="입력 문장"
          onChange={(event) => setQueryDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") ask();
          }}
        />
        <div className="doc-hops" role="group" aria-label="홉 거리">
          {DOCUMENT_CALL_HOP_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`doc-hop${hops === choice ? " is-on" : ""}`}
              aria-pressed={hops === choice}
              onClick={() => setHops(choice)}
            >
              {choice}홉
            </button>
          ))}
        </div>
        <button type="button" className="flow-btn" data-action="doc-call" onClick={ask}>
          문서 찾기
        </button>
      </div>
      {error ? <p className="flow-error">{error}</p> : null}
      {view && !isDocumentCallOk(view) ? (
        <p className="doc-empty">
          아직 스캔되지 않았습니다 — 아래에서 「스캔」을 누르거나 구조 화면에서 스캔합니다.
        </p>
      ) : null}
      {view && isDocumentCallOk(view) ? <DocumentCallBody view={view} onOpenFile={onOpenFile} /> : null}
    </section>
  );
}

function DocumentCallBody({
  view,
  onOpenFile,
}: {
  view: DocumentCallView;
  onOpenFile?: (path: string) => void;
}) {
  if (view.error) {
    return (
      <div className="doc-empty">
        <p>{view.error}</p>
        {view.candidates.length > 0 ? (
          <ul className="doc-cands">
            {view.candidates.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <header className="doc-head">
        <b className="doc-anchor">{view.anchorPath ?? view.anchor}</b>
        <span className="doc-chip">{view.maxHops}홉 안 문서 {view.hits.length}</span>
        <span className={`doc-chip${view.matchedCount > 0 ? " is-on" : " is-quiet"}`}>
          말 맞은 것 {view.matchedCount}
        </span>
        {view.withheld > 0 ? <span className="doc-chip is-warn">민감도로 가린 것 {view.withheld}</span> : null}
        {view.replica.designEdges === 0 ? <span className="doc-chip is-warn">설계 관계 0</span> : null}
      </header>

      {view.hits.length === 0 ? (
        <p className="doc-empty">이 출발점에서 {view.maxHops}홉 안에는 문서가 없습니다. 홉을 늘리거나 출발점을 옮기세요.</p>
      ) : (
        <ol className="doc-hits">
          {view.hits.map((hit, index) => (
            <DocumentHitRow key={hit.documentId} hit={hit} rank={index + 1} onOpenFile={onOpenFile} />
          ))}
        </ol>
      )}

      {view.hits.length > 0 && view.matchedCount === 0 ? (
        <p className="doc-note">
          입력의 말이 어느 조건에도 맞지 않았습니다. 어느 문서를 쓸지는 <b>노드가 정합니다</b> — 「갈래를 못 정했을
          때」의 분기가 그 자리입니다. 조회는 후보를 다 돌려주고 고르지 않습니다.
        </p>
      ) : null}
    </>
  );
}

function DocumentHitRow({
  hit,
  rank,
  onOpenFile,
}: {
  hit: DocumentHit;
  rank: number;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <li className="doc-hit">
      <div className="doc-hit-top">
        <span className="doc-rank">{rank}</span>
        <b className="doc-id">{hit.documentId}</b>
        <button type="button" className="doc-path" onClick={() => onOpenFile?.(hit.path)} title={hit.path}>
          {hit.path}
        </button>
        <span className="doc-grow" />
        <span className="doc-chip">{hit.hops}홉</span>
        <span className={`doc-chip${hit.matched > 0 ? " is-on" : " is-quiet"}`}>맞은 말 {hit.matched}</span>
        <span className="doc-chip">L{hit.level}</span>
      </div>
      {hit.when ? <p className="doc-when">{hit.when}</p> : null}
      <ViaChain via={hit.via} />
    </li>
  );
}

/** `pick -[CONSULTS]-> D1` split into chips and the relations between them. */
const VIA_STEP = /\s(<-\[[A-Z_]+\]-|-\[[A-Z_]+\]->)\s/;

export function splitVia(via: string): Array<{ node: string; relation: string | null; back: boolean }> {
  const parts = via.split(VIA_STEP);
  const steps: Array<{ node: string; relation: string | null; back: boolean }> = [];
  for (let i = 0; i < parts.length; i += 2) {
    const relationRaw = parts[i - 1] ?? null;
    steps.push({
      node: parts[i] ?? "",
      relation: relationRaw ? (relationRaw.match(/\[([A-Z_]+)\]/)?.[1] ?? null) : null,
      back: relationRaw !== null && relationRaw.startsWith("<-"),
    });
  }
  return steps;
}

function ViaChain({ via }: { via: string }) {
  const steps = splitVia(via);
  return (
    <div className="doc-via" title={via}>
      {steps.map((step, index) => (
        <span className="doc-via-step" key={`${step.node}:${index}`}>
          {step.relation ? (
            <span className={`doc-rel${step.back ? " is-back" : ""}`}>
              {step.back ? "←" : "→"} {step.relation}
            </span>
          ) : null}
          <span className="doc-via-node">{step.node}</span>
        </span>
      ))}
    </div>
  );
}
