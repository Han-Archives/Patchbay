import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AtlasGraph } from "./AtlasGraph.js";
import type { PortInfoMap } from "./atlasGraphLayout.js";
import { FilePeek } from "./FilePeek.js";
import { structureKey, type ProjectViewOk } from "./projectContract.js";

/**
 * The 구조 segment: Atlas as a patch panel, plus the two values the project
 * response has always carried and nothing ever drew -- `clarity` and
 * `decisions`. Not a fifth tab (architecture-map forbids one); a third
 * segment inside the 프로젝트 tab.
 */
export function StructurePane({
  view,
  action,
  scans = 0,
  onChanged,
}: {
  view: ProjectViewOk;
  action?: ReactNode;
  /** 「다시 스캔」을 누른 횟수. 항목 목록이 같아도 파일 내용은 바뀌었을 수 있다. */
  scans?: number;
  /** 결정을 남긴 뒤 부른 쪽이 구조를 다시 읽는다. */
  onChanged?: () => void;
}) {
  const counts = view.counts;
  const [info, setInfo] = useState<PortInfoMap>({});
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const shownAlias = useRef(view.alias);
  const key = structureKey(view);

  // Only this segment needs the summaries, and producing them reads every
  // port's file -- so it is fetched here rather than bolted onto /api/project.
  // Re-read only when the structure itself (or a scan) changed, not on every
  // studio event; and keep the old lines on screen while the new ones load,
  // unless the project changed.
  useEffect(() => {
    let cancelled = false;
    if (shownAlias.current !== view.alias) {
      shownAlias.current = view.alias;
      setInfo({});
    }
    fetch(`/api/project/ports?alias=${encodeURIComponent(view.alias)}`)
      .then(async (res) => {
        const body = (await res.json()) as { ports?: PortInfoMap };
        if (!cancelled && res.ok && body.ports) setInfo(body.ports);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `key` carries `view.alias`; `view` itself changes on every refetch.
  }, [key, scans]);

  return (
    <section className="structure">
      <DesignCard design={view.design} />
      <div className="structure-split">
        <div className="structure-main">
          <header className="structure-head">
            <h3>구조 요약</h3>
            <span className="impact-chip">스킬 {counts.skills}</span>
            <span className="impact-chip">규칙 {counts.rules}</span>
            {counts.unlabeledPorts > 0 ? (
              <span className="impact-chip is-warn">분류 안 된 항목 {counts.unlabeledPorts}</span>
            ) : null}
            <span className="impact-grow" />
            <span className="impact-chip" title="사람이 선언했지만 실제로는 아직 없는 연결">선언만 {counts.patchesWithoutWire}</span>
            {action}
          </header>
          <div className="structure-graph">
            <AtlasGraph sections={view.sections} info={info} onOpenFile={setPeekPath} />
          </div>
        </div>

        <aside className="impact-rail">
          <div className="impact-card">
            <h4>명료도</h4>
            {view.clarity === null ? (
              <p className="impact-none">경로를 읽을 수 없어 계산하지 않았습니다.</p>
            ) : (
              <>
                <div className="clarity-row">
                  <strong className="clarity-score">{view.clarity}</strong>
                  <span className="impact-n">/ 100</span>
                </div>
                <div className="clarity-meter">
                  <span style={{ width: `${Math.max(0, Math.min(100, view.clarity))}%` }} />
                </div>
              </>
            )}
          </div>
          <div className="impact-card">
            <h4>git</h4>
            <div className="impact-kv">
              <span>브랜치</span>
              <b>{view.git.branch || "—"}</b>
            </div>
            <div className="impact-kv">
              <span>head</span>
              <b>{view.git.head ? view.git.head.slice(0, 7) : "—"}</b>
            </div>
          </div>
        </aside>
      </div>

      <RequestLog view={view} />

      <div className="structure-card">
        <header className="structure-head">
          <h3>결정</h3>
          <span className="impact-chip">직접 기록</span>
          <span className="impact-grow" />
          <span className="impact-chip">{view.decisions.length}</span>
        </header>
        <DecisionForm alias={view.alias} onAdded={onChanged} />
        {view.decisions.length === 0 ? (
          <p className="structure-empty">아직 없습니다. 위에 한 줄로 남기면 직접 기록에 들어갑니다.</p>
        ) : (
          <ol className="decisions">
            {view.decisions.map((decision) => (
              <li className="decision" key={decision.id}>
                <span className="decision-id">{decision.id}</span>
                <span className="impact-chip">{decision.concept}</span>
                <span className="decision-body">
                  {decision.summary}
                  {decision.rationale ? <em className="decision-why">{decision.rationale}</em> : null}
                </span>
                <span className="decision-date">{shortDate(decision.date)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {peekPath ? (
        <FilePeek alias={view.alias} path={peekPath} onClose={() => setPeekPath(null)} />
      ) : null}
    </section>
  );
}

/**
 * 요구 → 구현 기록. `progress.yaml`의 `asked`/`did`를 그대로 보여 준다 --
 * 커널이 대화를 수집한 게 아니라, 대화를 가진 호스트 모델이 MCP·CLI로 남긴
 * 것이다. 짝이 없는 엔트리(스킬이 중간에 남긴 것)는 건너뛴다.
 */
function RequestLog({ view }: { view: ProjectViewOk }) {
  const entries = [view.progress.current, ...view.progress.history]
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.asked || entry.did);

  return (
    <div className="structure-card">
      <header className="structure-head">
        <h3>요구 · 구현</h3>
        <span className="impact-chip" title="progress.yaml 의 asked · did">요구한 것과 실제로 한 것</span>
        <span className="impact-grow" />
        <span className="impact-chip">{entries.length}</span>
      </header>
      {entries.length === 0 ? (
        <p className="structure-empty">
          아직 없습니다. Cursor나 Claude Code에서 일을 끝내며 진행을 남기면(요구한 것 · 한 것) 여기에 쌓입니다.
        </p>
      ) : (
        <ol className="asks">
          {entries.map((entry) => (
            <li className="ask" key={`${entry.timestamp}-${entry.summary}`}>
              <span className="ask-date">{shortDate(entry.timestamp)}</span>
              <span className="ask-body">
                {entry.asked ? (
                  <span className="ask-line">
                    <b className="ask-tag is-asked">요구</b>
                    {entry.asked}
                  </span>
                ) : null}
                {entry.did ? (
                  <span className="ask-line">
                    <b className="ask-tag is-did">구현</b>
                    {entry.did}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function shortDate(raw: string | undefined): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

/**
 * 「결정 남기기」 — `patchbay decision add` 를 화면에서. 무엇을 정했는지 한 줄이 필수이고 이유는
 * 고를 수 있다. 쓰기는 서버가 Core `appendDecision` 으로 한다.
 */
function DecisionForm({ alias, onAdded }: { alias: string; onAdded?: () => void }) {
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias, summary, rationale }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setSummary("");
      setRationale("");
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="decision-form" onSubmit={(event) => void submit(event)}>
      <label className="ws-field">
        정한 것
        <input
          id="decision-summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="예: 스캔 결과는 화면에서 다시 쓴다"
        />
      </label>
      <label className="ws-field">
        이유 <span className="muted">(골라서)</span>
        <input id="decision-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} />
      </label>
      <button type="submit" className="flow-btn primary" disabled={busy || !summary.trim()}>
        {busy ? "남기는 중" : "결정 남기기"}
      </button>
      {error ? <p className="flow-error">{error}</p> : null}
    </form>
  );
}

/** 상담에서 적은 설계 — 목표 · 요구사항 · 장면 · 환경 (사용자 요청 2026-10-07). 원본은 1 설계의 초안이다. */
function DesignCard({ design }: { design: ProjectViewOk["design"] }) {
  if (!design) {
    return (
      <div className="structure-card design-card">
        <header className="structure-head">
          <h3>설계</h3>
          <span className="impact-chip">상담에서 적은 것</span>
        </header>
        <p className="structure-empty">아직 없습니다. 1 설계의 상담에서 말하면 여기에 목표와 요구사항이 정리됩니다.</p>
      </div>
    );
  }
  return (
    <div className="structure-card design-card">
      <header className="structure-head">
        <h3>설계</h3>
        <span className="impact-chip">상담에서 적은 것</span>
        <span className="impact-grow" />
        <span className="impact-chip">요구사항 {design.requirements.length}</span>
        {design.openQuestions ? <span className="impact-chip is-warn">아직 정하지 않은 것 {design.openQuestions}</span> : null}
      </header>
      <dl className="design-dl">
        <dt>목표</dt>
        <dd>{design.goal || <span className="structure-empty">아직</span>}</dd>
        {design.users.length || design.scene ? (
          <>
            <dt>쓰는 장면</dt>
            <dd>
              {design.users.length ? <b>{design.users.join(" · ")}</b> : null}
              {design.users.length && design.scene ? " — " : null}
              {design.scene}
            </dd>
          </>
        ) : null}
        {design.screen ? (
          <>
            <dt>화면</dt>
            <dd>{design.screen}</dd>
          </>
        ) : null}
        {design.environment ? (
          <>
            <dt>환경</dt>
            <dd>{design.environment}</dd>
          </>
        ) : null}
        <dt>요구사항</dt>
        <dd>
          {design.requirements.length ? (
            <ol className="design-reqs">
              {design.requirements.map((r) => (
                <li key={r.id}>
                  <span className="design-req-id">{r.id}</span>
                  {r.priority ? <span className={`design-pri is-${r.priority === "꼭" ? "must" : "other"}`}>{r.priority}</span> : null}
                  <span>{r.text}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="structure-empty">아직</span>
          )}
        </dd>
      </dl>
    </div>
  );
}
