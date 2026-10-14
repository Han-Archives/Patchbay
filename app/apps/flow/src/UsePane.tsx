import { useEffect, useRef, useState } from "react";
import { OpsPanel } from "./OpsPanel.js";
import type { OpsActivity } from "./opsContract.js";

/**
 * 3 운영 — 만든 에이전트를 여기서 쓴다 (사용자 결정 2026-10-08).
 * 위: 사용 창(프로젝트가 만든 화면을 그대로). 아래: 「실행 기록」 버튼을 누르면 로그와 설계 견주기가 열린다.
 * 실행 기록은 열려 있지 않아도 읽는다 — 일한 노드를 쌓아 4 · 5 를 여는 사실이 되기 때문이다.
 */
export function UsePane({
  project,
  revision,
  onOpenStage,
  onPassedChange,
}: {
  project: string;
  revision: number;
  onOpenStage: (id: "design") => void;
  /** 지난 노드 수가 바뀌면 단계 띠를 다시 읽게 한다. */
  onPassedChange: () => void;
}) {
  const [app, setApp] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [activity, setActivity] = useState<OpsActivity | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPassed = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ app?: string | null }>)
      .then((body) => {
        if (cancelled) return;
        setApp(body.app ?? null);
        setDraft(body.app ?? "http://localhost:5180");
      })
      .catch(() => !cancelled && setApp(null));
    return () => {
      cancelled = true;
    };
  }, [project, revision]);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      fetch(`/api/ops/activity?alias=${encodeURIComponent(project)}`)
        .then((res) => res.json() as Promise<OpsActivity>)
        .then((body) => {
          if (cancelled) return;
          setActivity(body);
          if (lastPassed.current !== null && lastPassed.current !== body.passed.length) onPassedChange();
          lastPassed.current = body.passed.length;
        })
        .catch(() => undefined);
    void read();
    const timer = setInterval(read, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  async function save(url: string) {
    setError(null);
    const res = await fetch("/api/ops/app", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, url }),
    });
    const body = (await res.json()) as { app?: { url: string } | null; error?: string };
    if (!res.ok) {
      setError(body.error ?? "저장하지 못했다");
      return;
    }
    setApp(body.app?.url ?? null);
    setEditing(false);
  }

  const entries = activity?.entries ?? [];
  return (
    <div className="use">
      <div className="use-head">
        <b>사용 창</b>
        {app && !editing ? (
          <>
            <span className="use-url">{app}</span>
            <a className="flow-btn" href={app} target="_blank" rel="noreferrer">
              새 창
            </a>
            <button type="button" className="flow-btn" onClick={() => setEditing(true)}>
              주소 바꾸기
            </button>
          </>
        ) : null}
        <span className={`use-server ${activity?.reachable ? "is-on" : ""}`}>
          {activity?.reachable ? `● 그래프 서버 ${activity.url}` : `○ 그래프 서버 꺼짐 ${activity?.url ?? ""}`}
        </span>
      </div>

      {app === undefined ? (
        <p>불러오는 중</p>
      ) : !app || editing ? (
        <form
          className="use-setup"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          <h3>이 프로젝트의 화면 주소</h3>
          <p className="ops-note">에이전트를 쓰는 화면은 프로젝트가 만든다. Patchbay는 그 화면을 여기에 띄우고, 아래에 실행 기록을 둔다.</p>
          <div className="use-setup-row">
            <input aria-label="화면 주소" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="http://localhost:5180" />
            <button type="submit" className="flow-btn primary">
              띄우기
            </button>
            {editing ? (
              <button type="button" className="flow-btn" onClick={() => setEditing(false)}>
                그대로
              </button>
            ) : null}
          </div>
          {error ? <p className="flow-error">{error}</p> : null}
        </form>
      ) : (
        <iframe className="use-frame" title="사용 창" src={app} />
      )}

      <div className={`use-drawer ${open ? "is-open" : ""}`}>
        <button type="button" className="use-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          실행 기록 <span>{entries.length}</span>
          {activity ? (
            <small>
              노드 {activity.passed.length}/{activity.total.length} 지남
            </small>
          ) : null}
          <i aria-hidden>{open ? "▾" : "▴"}</i>
        </button>
        {open ? (
          <div className="use-log">
            {activity?.error ? <p className="ops-warn">{activity.error}</p> : null}
            {entries.length ? (
              <ol>
                {entries.map((e) => (
                  <li key={`${e.threadId}/${e.runId}`}>
                    <time>{clock(e.startedAt)}</time>
                    <span className={`use-status is-${e.status}`}>{e.status}</span>
                    <span className="use-what">
                      {e.input.length ? <em>들어옴: {e.input.join(", ")}</em> : null}
                      {e.worked.length ? (
                        e.worked.map((n) => <code key={n}>{n}</code>)
                      ) : (
                        <small>할 일 없이 지나감</small>
                      )}
                    </span>
                    <small className="use-ms">{span(e.startedAt, e.endedAt)}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ops-note">아직 실행이 없다 — 위 화면에서 써 보면 여기에 쌓인다.</p>
            )}
            <details className="use-compare">
              <summary>설계와 견주기 · 비용 · 버전</summary>
              <OpsPanel project={project} revision={revision} onOpenStage={onOpenStage} />
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function clock(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function span(a: string | null, b: string | null): string {
  if (!a || !b) return "";
  const ms = Date.parse(b) - Date.parse(a);
  return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.round(ms / 60_000)}분`;
}
