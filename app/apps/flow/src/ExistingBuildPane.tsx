import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  existingTone,
  type BuildViewExisting,
  type ExistingActionRequest,
  type ExistingActionResponse,
  type ExistingLink,
  type BuildViewResponse,
} from "./buildContract.js";

/**
 * 「이미 구현됨」 길의 2 구현 · 3 테스트 화면 (사용자 결정 2026-10-20, 절차 `이미구현-길-설계안_20261020_v1`).
 * 위는 설계의 노드 순서와 노드마다의 통과 수, 아래는 요구사항마다 이은 테스트다. 노드를 누르면 그 노드의
 * 요구사항만 남는다. 판정에는 사람이 확인한 연결만 쓴다 — 에이전트 제안은 「확인」을 눌러야 센다.
 */

type Filter = "all" | "proposed" | "unlinked" | "fail";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "proposed", label: "확인 대기" },
  { id: "unlinked", label: "테스트 없음" },
  { id: "fail", label: "실패" },
];

const RESULT_LABEL: Record<NonNullable<ExistingLink["result"]>["state"], string> = { pass: "통과", fail: "실패", missing: "못 찾음" };

export async function postExisting(request: ExistingActionRequest): Promise<ExistingActionResponse> {
  const res = await fetch("/api/build/existing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return (await res.json()) as ExistingActionResponse;
}

export function ExistingBuildPane({
  view,
  onView,
  onOpenFile,
}: {
  view: BuildViewExisting;
  onView: (view: BuildViewExisting) => void;
  onOpenFile?: (path: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [node, setNode] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const { summary } = view;

  async function act(request: ExistingActionRequest, label: string) {
    setBusy(label);
    setError(null);
    try {
      const body = await postExisting(request);
      if (body.ok) onView(body.view);
      else setError(body.error);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  const rows = useMemo(
    () =>
      summary.requirements.filter((req) => {
        if (node && !req.nodes.includes(node)) return false;
        if (filter === "proposed") return req.links.some((link) => link.state === "proposed");
        if (filter === "unlinked") return req.state === "unlinked";
        if (filter === "fail") return req.state === "fail";
        return true;
      }),
    [summary.requirements, node, filter],
  );

  return (
    <section className="card bd-card ex-card">
      <header className="bd-head">
        <span className="sec-title">이미 구현됨 — 요구사항마다 그것을 지키는 기존 테스트를 잇는다</span>
        <span className="tag is-done">{view.version === null ? "승인본" : `승인본 v${view.version}`}</span>
      </header>

      <div className="ex-meter">
        <Meter label="요구사항 이음" value={summary.linked} total={summary.total} hint="2 구현 — 확인된 연결이 있는 요구사항" />
        <Meter label="요구사항 통과" value={summary.passed} total={summary.total} hint="3 테스트 — 확인된 연결이 모두 통과" />
        <div className="ex-meter-side">
          {summary.proposed ? <b>확인 대기 {summary.proposed}건</b> : null}
          <small>{view.ranAt ? `마지막 실행 ${new Date(view.ranAt).toLocaleString()}` : "아직 돌리지 않았다"}</small>
        </div>
      </div>

      <div className="bd-act">
        <button type="button" className="flow-btn primary" disabled={Boolean(busy) || summary.linked === 0} onClick={() => void act({ alias: view.alias, action: "run" }, "run")}>
          {busy === "run" ? "테스트 도는 중" : "▶ 이은 테스트 실행"}
        </button>
        <small>확인된 연결의 테스트만 그 프로젝트의 vitest로 돌린다. 4 지식 그래프 · 5 문서 호출은 이 길에서 열지 않는다.</small>
      </div>
      {error ? <p className="flow-error">{error}</p> : null}

      <ol className="ex-nodes" aria-label="설계 노드 — 누르면 그 노드의 요구사항만">
        {view.ir.nodes.map((item) => {
          const count = summary.nodes[item.id] ?? { total: 0, passed: 0 };
          const tone = count.total > 0 && count.passed === count.total ? "pass" : count.passed > 0 ? "some" : "none";
          return (
            <li key={item.id}>
              <button type="button" className={`ex-node is-${tone}${node === item.id ? " is-on" : ""}`} aria-pressed={node === item.id} onClick={() => setNode(node === item.id ? null : item.id)}>
                <b>{item.label || item.id}</b>
                <small>통과 {count.passed}/{count.total}</small>
                <i style={{ width: `${count.total ? (count.passed / count.total) * 100 : 0}%` }} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>

      <div className="ex-filter" role="group" aria-label="요구사항 거르기">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className={filter === item.id ? "is-on" : undefined} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
        <small>{rows.length}개</small>
      </div>

      <ul className="ex-reqs">
        {rows.map((req) => (
          <li key={req.id} className={`ex-req is-${existingTone(req).tone}`}>
            <button type="button" className="ex-req-head" aria-expanded={open === req.id} onClick={() => setOpen(open === req.id ? null : req.id)}>
              <b>{req.id}</b>
              <span>{req.text}</span>
              <em>{existingTone(req).label}</em>
              <small>연결 {req.links.length}</small>
            </button>
            {open === req.id ? (
              <div className="ex-links">
                {req.links.map((link) => (
                  <div key={link.id} className={`ex-link${link.state === "proposed" ? " is-proposed" : ""}`}>
                    <div className="ex-link-path">
                      <FileRef path={link.file} onOpenFile={onOpenFile} />
                      <span>› {link.test || "파일 전체"}</span>
                      {link.code ? <small>코드 <FileRef path={link.code} onOpenFile={onOpenFile} /></small> : null}
                    </div>
                    <div className="ex-link-st">
                      {link.state === "proposed" ? <em className="is-proposed">제안 · 확인 전</em> : null}
                      {link.result ? <em className={`is-${link.result.state}`}>{RESULT_LABEL[link.result.state]}</em> : link.state === "confirmed" ? <em>미실행</em> : null}
                      {link.result?.note ? <small>{link.result.note}</small> : null}
                    </div>
                    <div className="ex-link-act">
                      {link.state === "proposed" ? (
                        <button type="button" className="flow-btn" disabled={Boolean(busy)} onClick={() => void act({ alias: view.alias, action: "confirm", id: link.id }, link.id)}>확인</button>
                      ) : null}
                      <button type="button" className="flow-btn" disabled={Boolean(busy)} onClick={() => void act({ alias: view.alias, action: "remove", id: link.id }, link.id)}>버리기</button>
                    </div>
                  </div>
                ))}
                <AddLink disabled={Boolean(busy)} onAdd={(values) => act({ alias: view.alias, action: "link", requirement: req.id, ...values }, `add:${req.id}`)} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meter({ label, value, total, hint }: { label: string; value: number; total: number; hint: string }) {
  return (
    <div className="ex-meter-item" title={hint}>
      <small>{label}</small>
      <b>{value}<span>/{total}</span></b>
      <i aria-hidden="true"><span style={{ width: `${total ? (value / total) * 100 : 0}%` }} /></i>
    </div>
  );
}

function FileRef({ path, onOpenFile }: { path: string; onOpenFile?: (path: string) => void }) {
  return onOpenFile ? (
    <button type="button" className="bd-file-open" onClick={() => onOpenFile(path)}><code>{path}</code></button>
  ) : (
    <code>{path}</code>
  );
}

function AddLink({ disabled, onAdd }: { disabled: boolean; onAdd: (values: { file: string; test: string; code: string }) => Promise<void> }) {
  const [file, setFile] = useState("");
  const [test, setTest] = useState("");
  const [code, setCode] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file.trim()) return;
    await onAdd({ file, test, code });
    setFile("");
    setTest("");
    setCode("");
  }
  return (
    <form className="ex-add" onSubmit={(event) => void submit(event)}>
      <input id="ex-add-file" value={file} onChange={(event) => setFile(event.target.value)} placeholder="테스트 파일 (프로젝트 기준)" aria-label="테스트 파일" />
      <input id="ex-add-test" value={test} onChange={(event) => setTest(event.target.value)} placeholder="describe > it — 비우면 파일 전체" aria-label="테스트 이름" />
      <input id="ex-add-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="코드 파일 (선택)" aria-label="코드 파일" />
      <button type="submit" className="flow-btn" disabled={disabled || !file.trim()}>잇기</button>
    </form>
  );
}

/**
 * 3 테스트 자리. 「이미 구현됨」 길이면 같은 화면(이은 테스트 실행 · 결과)을, 아니면 원래 사용 창을 낸다.
 * 이 길에는 사용할 LangGraph 에이전트가 없다.
 */
export function ExistingTestStage({
  project,
  revision,
  onOpenFile,
  children,
}: {
  project: string;
  revision: number;
  onOpenFile?: (path: string) => void;
  children: ReactNode;
}) {
  const [view, setView] = useState<BuildViewResponse | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/build?alias=${encodeURIComponent(project)}`)
      .then((res) => (res.ok ? (res.json() as Promise<BuildViewResponse>) : null))
      .then((body) => { if (!cancelled) setView(body); })
      .catch(() => { if (!cancelled) setView(null); });
    return () => { cancelled = true; };
  }, [project, revision]);
  if (view === undefined) return null;
  if (view?.status !== "existing") return <>{children}</>;
  return (
    <>
      <h2>테스트</h2>
      <ExistingBuildPane view={view} onView={setView} onOpenFile={onOpenFile} />
    </>
  );
}
