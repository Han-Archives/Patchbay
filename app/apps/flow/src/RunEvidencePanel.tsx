import { useEffect, useState } from "react";
import type { RunEvidence } from "@patchbay/core";

/**
 * 4 지식 그래프 맨 위 — 실행에서 이은 근거 경로 (기획 20261008a: 지식 그래프는 테스트 뒤).
 * 실행 → 일한 노드 → 맡은 요구사항 → 보는 평가 → 찾는 문서. 3 테스트의 실행 기록(test/activity.json)에서 계산한다.
 */
export function RunEvidencePanel({ project, revision }: { project: string; revision: number }) {
  const [runs, setRuns] = useState<RunEvidence[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/knowledge/runs?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ runs: RunEvidence[] }>)
      .then((body) => {
        if (cancelled) return;
        setRuns(body.runs);
        setOpen((prev) => prev ?? body.runs[0]?.run.path ?? null);
      })
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [project, revision]);

  if (!runs) return null;
  return (
    <section className="kg-runs" aria-label="실행에서 이은 근거 경로">
      <h3 className="kg-section">
        실행에서 이은 근거 경로 <small>실행 → 일한 노드 → 요구사항 → 평가 → 문서</small>
      </h3>
      {runs.length === 0 ? (
        <p className="test-note">아직 노드가 일한 실행이 없다 — 3 테스트에서 쓰고 「실행 기록」을 열면 쌓인다.</p>
      ) : (
        <ol className="kg-run-list">
          {runs.map((r) => (
            <li key={r.run.path} className={open === r.run.path ? "is-open" : ""}>
              <button type="button" onClick={() => setOpen(open === r.run.path ? null : r.run.path)} aria-expanded={open === r.run.path}>
                <time>{localName(r.run.name)}</time>
                <span>{r.run.text}</span>
              </button>
              {open === r.run.path ? (
                <div className="kg-run-steps">
                  {r.steps.map((s) => (
                    <div key={s.node} className="kg-run-step">
                      <code className="is-node">{s.node}</code>
                      <span className="kg-run-col">
                        {s.requirements.length ? (
                          s.requirements.map((q) => (
                            <span key={q.id} className="kg-chip is-req" title={q.text ?? ""}>
                              {q.id}
                            </span>
                          ))
                        ) : (
                          <small>맡은 요구사항 없음</small>
                        )}
                      </span>
                      <span className="kg-run-col">
                        {s.evals.length ? s.evals.map((e) => <span key={e} className="kg-chip is-eval">{e}</span>) : <small>평가 없음</small>}
                      </span>
                      <span className="kg-run-col">
                        {s.documents.length ? (
                          s.documents.map((d) => (
                            <span key={d.id} className="kg-chip is-doc" title={d.port ?? ""}>
                              {d.id}
                            </span>
                          ))
                        ) : (
                          <small>찾는 문서 없음</small>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** 「2026-10-08T14:43:51.185Z · success」 → 이 기기의 시각 「10/8 23:43 · success」. */
function localName(name: string): string {
  const [iso, ...rest] = name.split(" · ");
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return name;
  const t = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return [t, ...rest].join(" · ");
}
