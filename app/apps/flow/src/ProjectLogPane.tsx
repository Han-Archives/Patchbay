import { useEffect, useState } from "react";
import type { DashboardView, OpsActivity } from "./opsContract.js";
import { stageMeta, type WorkspaceProject } from "./workspaceContract.js";
export function ProjectLogPane({ project, revision, workspace }: { project: string; revision: number; workspace?: WorkspaceProject }) {
  const [entries, setEntries] = useState<{ at: string; title: string; detail: string; kind: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let cancelled = false; setEntries([]); setError(null); setLoading(true); setPage(0);
    async function read(url: string) { const res = await fetch(url); const body = await res.json(); if (!res.ok || body.error) throw new Error(body.error ?? "Log 조회 실패"); return body; }
    Promise.allSettled([read(`/api/dashboard?alias=${encodeURIComponent(project)}`), read(`/api/ops/activity?alias=${encodeURIComponent(project)}`)]).then(results => {
      if (cancelled) return;
      const rows: typeof entries = []; const errors: string[] = [];
      const progress = results[0]; const activity = results[1];
      if (progress?.status === "fulfilled") for (const e of (progress.value as DashboardView).progressLog ?? []) rows.push({ at: e.timestamp, title: e.step ?? "진행 기록", detail: [e.summary, e.asked ? `요청: ${e.asked}` : "", e.did ? `반영: ${e.did}` : ""].filter(Boolean).join("\n"), kind: "프로젝트" });
      else if (progress?.status === "rejected") errors.push(String(progress.reason));
      if (activity?.status === "fulfilled") for (const e of (activity.value as OpsActivity).entries ?? []) rows.push({ at: e.endedAt ?? e.startedAt ?? "", title: `${e.status} · ${e.runId}`, detail: `실행 노드: ${e.worked.join(" → ") || "없음"}\n건너뜀: ${e.skipped.join(", ") || "없음"}`, kind: "운영" });
      else if (activity?.status === "rejected") errors.push(String(activity.reason));
      setEntries(rows.sort((a,b) => b.at.localeCompare(a.at))); setError(errors.join("\n") || null); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [project, revision]);
  const pages = Math.max(1, Math.ceil(entries.length / 5));
  return <section className="project-log"><header><h2>Log</h2><p>프로젝트 진행과 운영 실행의 실제 기록 · 최신순</p></header><nav aria-label="프로세스 진행 현황">{workspace?.stages.filter(s => ["design","build","run"].includes(s.id)).map(s => <div key={s.id} className={`is-${s.tone}`}><b>{stageMeta(s.id).label}</b><small>{s.status}</small></div>)}</nav>{error ? <p className="flow-error">{error}</p> : null}<div className="project-log-entries">{entries.slice(page * 5, page * 5 + 5).map((e,i) => <article key={`${e.at}:${i}`}><time>{e.at ? new Date(e.at).toLocaleString("ko-KR") : "시각 미기록"}</time><small>{e.kind}</small><h3>{e.title}</h3><p>{e.detail}</p></article>)}{loading ? <p role="status">기록 불러오는 중</p> : !entries.length ? <p>아직 저장된 진행·실행 기록이 없습니다.</p> : null}</div><footer><button disabled={!page} onClick={() => setPage(page - 1)}>이전</button><span>{page + 1} / {pages} · {entries.length}건</span><button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음</button></footer></section>;
}
