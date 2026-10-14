import { useEffect, useState } from "react";
import {
  draftEvalsAction,
  draftEvalsNote,
  isRunsViewOk,
  RUN_FINDING_MEANS,
  type DraftEvalsResponse,
  type RunsViewOk,
  type RunsViewResponse,
  type RunsVersionView,
} from "./runsContract.js";

/**
 * 5단계 운영 — 흐름 탭 위.
 *
 * 다섯 번째 탭을 만들지 않는다. 이 면이 답하는 것은 「돌린 것이 설계대로였나」이고,
 * 흐름 탭이 이미 실행을 보는 면이다.
 *
 * 쓰기는 하나뿐이다 — 「평가 초안 넣기」가 `ir.proposed.yaml` 에 실패 사례를 덧붙인다
 * (`runs draft-evals --write` 와 같은 Core 길). 이 면에서 **검토와 채택은 하지 않는다**: 넣은 뒤
 * 버튼이 「1 설계에서 검토」로 바뀌고, 승인본은 설계 화면의 채택으로만 바뀐다. (사용자 결정
 * 2026-10-04 — 전에는 검토가 두 곳으로 흩어진다며 읽기 전용이었다. 쓰기는 초안까지라 검토 자리는
 * 여전히 하나다.)
 */
export function OpsPanel({
  project,
  revision = 0,
  onOpenStage,
}: {
  project: string;
  revision?: number;
  /** 넣은 초안을 검토하러 1 설계로. 없으면 버튼 대신 글로 가리킨다. */
  onOpenStage?: (id: "design") => void;
}) {
  const [view, setView] = useState<RunsViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function writeDrafts() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/runs/draft-evals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project }),
      });
      setNote(draftEvalsNote((await res.json()) as DraftEvalsResponse));
      setTick((n) => n + 1);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as RunsViewResponse | { error: string };
        if (cancelled) return;
        if (!res.ok || ("error" in body && !("status" in body))) {
          setError("error" in body ? body.error : `HTTP ${res.status}`);
          return;
        }
        setError(null);
        setView(body as RunsViewResponse);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  if (error) return <p className="flow-error">{error}</p>;
  if (!view) return null;
  if (!isRunsViewOk(view)) {
    return (
      <section className="ops">
        <header className="ops-head">
          <b>운영</b>
          <span className="ops-sub">
            승인된 설계가 없어 대조할 기준이 없습니다. 기록 {view.collected}건을 받아 두었습니다.
          </span>
        </header>
      </section>
    );
  }
  return (
    <OpsBody
      view={view}
      drafting={{ busy, note, onWrite: () => void writeDrafts(), onReview: onOpenStage ? () => onOpenStage("design") : undefined }}
    />
  );
}

interface Drafting {
  busy: boolean;
  note: string | null;
  onWrite: () => void;
  onReview?: () => void;
}

function OpsBody({ view, drafting }: { view: RunsViewOk; drafting: Drafting }) {
  const lanes = { plan: [] as string[], both: [] as string[], actual: [] as string[] };
  for (const node of view.compare.nodes) lanes[node.lane].push(node.id);
  const hard = view.compare.findings.filter((finding) => finding.kind !== "node-never-ran");
  const cost = view.compare.usage.costUsd;

  return (
    <section className="ops">
      <header className="ops-head">
        <b>운영 · 설계 v{view.irVersion}</b>
        <span className="ops-grow" />
        {Object.entries(view.compare.byStatus)
          .filter(([, count]) => count > 0)
          .map(([status, count]) => (
            <span key={status} className={`ops-chip ops-${status}`}>
              {status} {count}
            </span>
          ))}
        {view.compare.compared === 0 ? <span className="ops-chip is-quiet">수집 0</span> : null}
      </header>

      {view.compare.skipped.length > 0 ? (
        <p className="ops-note">
          다른 설계의 기록 {view.compare.skipped.length}건은 대조하지 않았습니다 —{" "}
          {view.compare.skipped.map((row) => `${row.runId}(v${row.irVersion})`).join(" · ")}
        </p>
      ) : null}

      <div className="ops-lanes">
        <Lane label="설계에만" hint="아직 안 돈 노드" ids={lanes.plan} tone="plan" />
        <Lane label="둘 다" hint="설계대로 돈 노드" ids={lanes.both} tone="both" />
        <Lane label="실행에만" hint="설계에 없는 노드" ids={lanes.actual} tone="actual" />
      </div>

      <div className="ops-split">
        <div className="ops-card">
          <h4>설계와 어긋난 것</h4>
          {hard.length === 0 ? (
            <p className="ops-quiet">없습니다.</p>
          ) : (
            <ul className="ops-list">
              {hard.map((finding, index) => (
                <li key={`${finding.kind}:${index}`}>
                  <span className="ops-kind">{RUN_FINDING_MEANS[finding.kind] ?? finding.kind}</span>
                  <span className="ops-detail">{finding.detail}</span>
                  {finding.runId ? <code className="ops-run">{finding.runId}</code> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ops-card">
          <h4>비용</h4>
          <div className="ops-kv">
            <span>대조한 {view.compare.compared}건의 토큰</span>
            <b>
              {view.compare.usage.inputTokens} / {view.compare.usage.outputTokens}
            </b>
          </div>
          <div className="ops-kv">
            <span>비용</span>
            <b>{cost === null ? "보고 없음" : `$${cost}`}</b>
          </div>
          {!view.budget.budget ? (
            <p className="ops-quiet">비용 한도를 걸지 않았습니다.</p>
          ) : view.budget.breaches.length === 0 ? (
            <p className="ops-quiet">보관된 {view.budget.checked}건 중 한도를 넘긴 실행은 없습니다.</p>
          ) : (
            <>
              <p className="ops-warn">
                보관된 {view.budget.checked}건 중 {view.budget.breaches.length}건이 한도를 넘었습니다. Patchbay는
                막지 않고 말합니다.
              </p>
              <ul className="ops-list">
                {view.budget.breaches.map((breach, index) => (
                  <li key={`${breach.runId}:${breach.kind}:${index}`}>
                    <code className="ops-run">{breach.runId}</code>
                    <span className="ops-detail">
                      {breach.kind} {breach.actual} &gt; {breach.limit}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="ops-split">
        <div className="ops-card">
          <h4>실패 → 평가 초안</h4>
          {view.drafts.count === 0 ? (
            <p className="ops-quiet">초안으로 만들 실패 기록이 없습니다.</p>
          ) : (
            <>
              <p className="ops-detail">
                실패 기록에서 평가 {view.drafts.count}개를 만들 수 있습니다 — {view.drafts.ids.join(" · ")}
                {view.drafts.unfilled.length > 0
                  ? ` (기대값을 사람이 채워야 하는 것 ${view.drafts.unfilled.length}개)`
                  : ""}
              </p>
              <p className="ops-quiet">
                초안은 <code>ir.proposed.yaml</code> 에만 들어가고 승인된 설계는 그대로입니다. 검토와 채택은 1 설계에서
                합니다.
              </p>
              <DraftAction view={view} drafting={drafting} />
            </>
          )}
          {drafting.note ? <p className="ir-note">{drafting.note}</p> : null}
        </div>

        <div className="ops-card">
          <h4>버전</h4>
          {view.versions.length === 0 ? (
            <p className="ops-quiet">아직 채택된 설계가 없습니다.</p>
          ) : (
            <div className="ops-versions">
              {view.versions.map((entry) => (
                <VersionRow key={entry.version} entry={entry} />
              ))}
            </div>
          )}
          {view.pair === null ? (
            <p className="ops-quiet">버전이 둘이 되면 점수를 나란히 놓습니다.</p>
          ) : view.pair.ok ? (
            <p className="ops-detail">
              같은 평가 묶음입니다. 통과 {view.pair.before.score?.passed ?? 0} → {view.pair.after.score?.passed ?? 0}
              {view.pair.modelChanged ? " · 모델이 바뀌었습니다 — 점수와 비용을 함께 봅니다." : ""}
            </p>
          ) : (
            <p className="ops-warn">{view.pair.reason}</p>
          )}
        </div>
      </div>

      {view.rejected.length > 0 ? (
        <p className="ops-warn">읽지 못한 기록 파일 {view.rejected.length}개가 있습니다.</p>
      ) : null}
    </section>
  );
}

function DraftAction({ view, drafting }: { view: RunsViewOk; drafting: Drafting }) {
  const action = draftEvalsAction(view.drafts);
  if (action === "review") {
    return (
      <div className="ops-act">
        <span className="ops-chip">초안에 들어감 {view.drafts.inDraft.join(" · ")}</span>
        {drafting.onReview ? (
          <button type="button" className="flow-btn primary" onClick={drafting.onReview}>
            1 설계에서 검토
          </button>
        ) : (
          <span className="ops-quiet">1 설계에서 검토합니다.</span>
        )}
      </div>
    );
  }
  const waiting = view.drafts.ids.filter((id) => !view.drafts.inDraft.includes(id));
  return (
    <div className="ops-act">
      <button type="button" className="flow-btn primary" onClick={drafting.onWrite} disabled={drafting.busy}>
        {drafting.busy ? "넣는 중" : `평가 초안 넣기 — ${waiting.join(" · ")}`}
      </button>
    </div>
  );
}

function Lane({
  label,
  hint,
  ids,
  tone,
}: {
  label: string;
  hint: string;
  ids: string[];
  tone: "plan" | "both" | "actual";
}) {
  return (
    <div className={`ops-lane ops-lane-${tone}`}>
      <div className="ops-lane-head">
        {label} <span className="ops-lane-hint">{hint}</span>
        <span className="ops-lane-n">{ids.length}</span>
      </div>
      <div className="ops-lane-body">
        {ids.length === 0 ? (
          <span className="ops-quiet">없음</span>
        ) : (
          ids.map((id) => (
            <span className="ops-node" key={id}>
              {id}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function VersionRow({ entry }: { entry: RunsVersionView }) {
  return (
    <div className="ops-version">
      <b>v{entry.version}</b>
      <span className="ops-detail">{entry.models.join(" · ") || "모델 없음"}</span>
      <span className="ops-grow" />
      {entry.score ? (
        <span className="ops-chip">
          통과 {entry.score.passed}/{entry.score.total}
          {entry.score.meanScore === null ? "" : ` · 채점 ${entry.score.meanScore}`}
        </span>
      ) : (
        <span className="ops-chip is-quiet">평가 결과 없음</span>
      )}
    </div>
  );
}
