import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SurveyItemView, SurveyView } from "@patchbay/core";

/**
 * 1 설계 — 설문 (사용자 결정 2026-10-05).
 *
 * 설계는 추상적인 아이디어를 구체화하는 과정이라, 빈칸에 서술하게 하지 않고 하나씩 묻고 고르게 한다
 * (사회조사 · 구조화 면접 · 세무 인터뷰 · 점검표의 방식). 한 화면에 질문 하나, 앞 답에 따라 문항이
 * 바뀌고, 오른쪽에서 답할 때마다 설계가 자란다. 문항 · 분기 · 답 → 설계도는 전부 커널이 한다 —
 * 이 화면은 그리기와 답 보내기만 한다 (원칙 8).
 */

type View = SurveyView & { alias: string };

const UNSURE = "__unsure__";

const KIND_LABEL: Record<string, string> = { input: "받는 것", output: "내놓는 것", enum: "정해진 값", resource: "미리 있는 자료", internal: "안쪽" };
const CARD_LABEL: Record<string, string> = { one: "정확히 하나", optional: "없거나 하나", many: "여럿" };
const RISK_LABEL: Record<string, string> = { low: "조금 불편", medium: "시간 · 돈 손해", high: "사람에게 피해" };
const AUTONOMY_LABEL: Record<string, string> = { suggest: "제안만", approve: "확인 뒤 실행", notify: "실행 뒤 알림", full: "끝까지 알아서" };

export function SurveyPane({ project, revision, onDone }: { project: string; revision: number; onDone: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/survey?alias=${encodeURIComponent(project)}`)
      .then(async (res) => {
        const body = (await res.json()) as View | { error: string };
        if (cancelled) return;
        if ("error" in body) setError(body.error);
        else {
          setView(body);
          setCurrentId((prev) => prev ?? firstOpen(body));
        }
      })
      .catch((err: unknown) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [project, revision]);

  useEffect(() => {
    setCurrentId(null);
    setFinished(false);
  }, [project]);

  const items = useMemo(() => (view ? view.sections.flatMap((s) => s.items) : []), [view]);
  const index = Math.max(0, items.findIndex((i) => i.id === currentId));
  const item = items[index];

  async function save(value: unknown, force = false): Promise<View | null> {
    if (!item) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/survey/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, item: item.id, value, force }),
      });
      const body = (await res.json()) as View | { error: string; conflict?: boolean };
      if ("error" in body) {
        setError(body.error);
        setConflict(Boolean(body.conflict));
        return null;
      }
      setConflict(false);
      setView(body);
      return body;
    } finally {
      setBusy(false);
    }
  }

  async function answerAndNext(value: unknown, force = false) {
    const next = await save(value, force);
    if (!next || !item) return;
    const list = next.sections.flatMap((s) => s.items);
    const at = list.findIndex((i) => i.id === item.id);
    const following = list[at + 1];
    if (following) setCurrentId(following.id);
    else setFinished(true);
  }

  if (error && !view) return <p className="flow-error">{error}</p>;
  if (!view) return <p>불러오는 중</p>;

  const sectionOf = (cell: string) => view.sections.find((s) => s.cell === cell)!;

  return (
    <div className="survey">
      <SurveyProgress
        view={view}
        currentCell={finished ? null : item?.cell ?? null}
        onJump={(cell) => {
          const first = sectionOf(cell).items[0];
          if (first) {
            setCurrentId(first.id);
            setFinished(false);
          }
        }}
      />
      <div className="survey-body">
        <div className="survey-main">
          {conflict ? (
            <div className="survey-conflict">
              <b>초안이 설문 밖에서 고쳐졌습니다.</b>
              <p>설문은 사람이 고친 초안을 덮지 않습니다. 옛 초안을 보관하고 설문 답으로 다시 만들 수 있습니다.</p>
              <button type="button" className="flow-btn" disabled={busy} onClick={() => item && void answerAndNext(item.value ?? item.suggested, true)}>
                옛 초안을 보관하고 설문으로 다시 만들기
              </button>
            </div>
          ) : null}
          {finished || !item ? (
            <SurveyDone view={view} onReview={onDone} onBack={() => {
              setFinished(false);
              setCurrentId(items.at(-1)?.id ?? null);
            }} />
          ) : (
            <QuestionCard
              key={item.id}
              project={project}
              item={item}
              section={sectionOf(item.cell)}
              position={sectionOf(item.cell).items.findIndex((i) => i.id === item.id) + 1}
              busy={busy}
              error={conflict ? null : error}
              canBack={index > 0}
              onBack={() => setCurrentId(items[index - 1]?.id ?? null)}
              onAnswer={(value) => void answerAndNext(value)}
              onUnsure={() => void answerAndNext(UNSURE)}
            />
          )}
        </div>
        <SurveyPreviewPanel view={view} project={project} />
      </div>
    </div>
  );
}

function firstOpen(view: SurveyView): string | null {
  const all = view.sections.flatMap((s) => s.items);
  return (all.find((i) => !i.answered) ?? all[0])?.id ?? null;
}

function SurveyProgress({ view, currentCell, onJump }: { view: SurveyView; currentCell: string | null; onJump: (cell: string) => void }) {
  return (
    <div className="survey-progress">
      <div className="survey-steps">
        {view.sections.map((s) => {
          const done = s.items.length > 0 && s.items.every((i) => i.answered);
          const num = s.cell === "0.0" ? "0" : String(Number(s.cell.split(".")[1]) + 1);
          return (
            <button
              key={s.cell}
              type="button"
              className={`survey-step${done ? " is-done" : ""}${currentCell === s.cell ? " is-on" : ""}${s.items.length === 0 ? " is-auto" : ""}`}
              disabled={s.items.length === 0}
              title={s.items.length === 0 ? `${s.label} — 앞 답에서 자동으로 만든다` : s.label}
              onClick={() => onJump(s.cell)}
            >
              <i>{num}</i>
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
      <span className="survey-count">
        {view.answered} / {view.total} 답함
      </span>
    </div>
  );
}

function QuestionCard({
  project,
  item,
  section,
  position,
  busy,
  error,
  canBack,
  onBack,
  onAnswer,
  onUnsure,
}: {
  project: string;
  item: SurveyItemView;
  section: { cell: string; label: string; items: SurveyItemView[] };
  position: number;
  busy: boolean;
  error: string | null;
  canBack: boolean;
  onBack: () => void;
  onAnswer: (value: unknown) => void;
  onUnsure: () => void;
}) {
  const [value, setValue] = useState<unknown>(() => initial(item));
  const ready = isReady(item, value);
  return (
    <section className="q-card">
      <span className="q-where">
        {section.cell === "0.0" ? "0" : Number(section.cell.split(".")[1]) + 1} · {section.label} · 질문 {position}/{section.items.length}
      </span>
      <h3 className="q-ask">{item.ask}</h3>
      {item.help ? <p className="q-help">{item.help}</p> : null}
      {item.unsure ? <p className="q-unsure">지난번에 「잘 모르겠어요」로 넘겼습니다 — 기본값으로 설계했습니다.</p> : null}
      <div className="q-input">
        <Input item={item} value={value} onChange={setValue} project={project} />
      </div>
      {error ? <p className="flow-error">{error}</p> : null}
      <div className="q-nav">
        <button type="button" className="flow-btn ghost" disabled={!canBack || busy} onClick={onBack}>
          ← 이전
        </button>
        <span className="ir-grow" />
        <button type="button" className="flow-btn ghost" disabled={busy} title={`기본값으로 넘어갑니다: ${describe(item.suggested)}`} onClick={onUnsure}>
          잘 모르겠어요
        </button>
        <button type="button" className="flow-btn primary" disabled={!ready || busy} onClick={() => onAnswer(value)}>
          {busy ? "저장 중" : "다음 →"}
        </button>
      </div>
    </section>
  );
}

function initial(item: SurveyItemView): unknown {
  if (item.value !== null && item.value !== undefined) return item.value;
  // 확인 문항은 만든 후보를 다 남긴 채로 연다 — 뺄 것만 끄면 된다.
  if (item.kind === "confirm") return (item.candidates ?? []).map((c) => c.key);
  // 자료는 지금 붙어 있는 것을 다 쓰는 것으로 연다.
  if (item.kind === "refs") return Array.isArray(item.suggested) ? item.suggested : [];
  // 우선순위 표는 후보의 기본 우선순위로 채워 연다 — 바꿀 줄만 고치면 된다.
  if (item.id === "r.reqs") return item.suggested ?? {};
  if (item.kind === "multi" || item.kind === "pick" || item.kind === "chips") return [];
  if (item.kind === "matrix" || item.kind === "slots") return {};
  return "";
}

function isReady(item: SurveyItemView, value: unknown): boolean {
  if (item.kind === "text" || item.kind === "single") return typeof value === "string" && value.trim() !== "";
  if (item.kind === "multi" || item.kind === "pick") return Array.isArray(value) && value.length > 0;
  if (item.kind === "chips") return Array.isArray(value) && value.length >= 2;
  if (item.kind === "confirm" || item.kind === "refs") return Array.isArray(value);
  if (item.kind === "matrix") {
    const rec = (value ?? {}) as Record<string, string>;
    return (item.rows ?? []).every((row) => Boolean(rec[row.key]));
  }
  if (item.kind === "slots") {
    const rec = (value ?? {}) as Record<string, string>;
    return (item.rows ?? []).every((row) => Boolean(rec[row.key]?.trim()));
  }
  return true;
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return Object.values(value).join(", ");
  return String(value ?? "");
}

function Input({
  item,
  value,
  onChange,
  project,
}: {
  item: SurveyItemView;
  value: unknown;
  onChange: (v: unknown) => void;
  project: string;
}) {
  const arr = Array.isArray(value) ? (value as string[]) : [];
  const rec = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
  const toggle = (v: string) => onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  switch (item.kind) {
    case "text":
      return (
        <input
          className="q-text"
          autoFocus
          value={typeof value === "string" ? value : ""}
          placeholder={item.placeholder ?? describe(item.suggested)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "single":
      return (
        <div className="q-choices">
          {(item.options ?? []).map((o) => (
            <Choice key={o.value} on={value === o.value} round onClick={() => onChange(o.value)} label={o.label} hint={o.hint} />
          ))}
        </div>
      );
    case "multi":
    case "pick":
      return (
        <div className={`q-choices${item.kind === "pick" ? " is-grid" : ""}`}>
          {(item.options ?? []).map((o) => (
            <Choice key={o.value} on={arr.includes(o.value)} onClick={() => toggle(o.value)} label={o.label} hint={o.hint} />
          ))}
        </div>
      );
    case "confirm":
      return (
        <div className="q-choices">
          {(item.candidates ?? []).map((c) => (
            <Choice key={c.key} on={arr.includes(c.key)} onClick={() => toggle(c.key)} label={c.label} hint={c.pattern === "unwanted" ? "실패 약속" : undefined} />
          ))}
        </div>
      );
    case "chips":
      return <Chips values={arr} placeholder={item.placeholder} onChange={onChange} />;
    case "refs":
      return <RefsInput project={project} picked={arr} onChange={onChange} />;
    case "matrix": {
      const cols = item.columns ?? [];
      if (item.id === "d.docs" || cols.length > 4) {
        // 파일 목록은 줄마다 고르기 상자 — 동그라미 표로 그리면 파일 이름이 열 머리로 밀려 읽히지 않는다.
        return (
          <div className="q-rows">
            {(item.rows ?? []).map((row) => (
              <label key={row.key} className="q-row">
                <span>{row.label}</span>
                <select value={rec[row.key] ?? ""} onChange={(e) => onChange({ ...rec, [row.key]: e.target.value })}>
                  <option value="">고르세요</option>
                  {cols.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        );
      }
      return (
        <table className="q-matrix">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.value}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(item.rows ?? []).map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {cols.map((c) => (
                  <td key={c.value}>
                    <button
                      type="button"
                      className={`q-dot${rec[row.key] === c.value ? " is-on" : ""}`}
                      aria-label={`${row.label} — ${c.label}`}
                      aria-pressed={rec[row.key] === c.value}
                      onClick={() => onChange({ ...rec, [row.key]: c.value })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "slots": {
      const sug = (item.suggested ?? {}) as Record<string, string>;
      return (
        <div className="q-rows">
          {(item.rows ?? []).map((row) => (
            <label key={row.key} className="q-row">
              <span>{row.label}</span>
              <input value={rec[row.key] ?? ""} placeholder={sug[row.key] ?? ""} onChange={(e) => onChange({ ...rec, [row.key]: e.target.value })} />
            </label>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

function Choice({ on, round, onClick, label, hint }: { on: boolean; round?: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button type="button" className={`q-choice${on ? " is-on" : ""}${round ? " is-round" : ""}`} aria-pressed={on} onClick={onClick}>
      <i aria-hidden="true" />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </button>
  );
}

function Chips({ values, placeholder, onChange }: { values: string[]; placeholder?: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="q-chips">
      {values.map((v) => (
        <span key={v} className="q-chip">
          {v}
          <button type="button" aria-label={`${v} 빼기`} onClick={() => onChange(values.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

interface RefView {
  id: string;
  title: string;
  kind: "link" | "file" | "image";
  uri: string;
}

const refRaw = (project: string, id: string) => `/api/refs/raw?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`;

/**
 * 참고 자료 붙이기 — 링크 · 파일 · 이미지. 이미지는 붙여넣기(⌘V)와 끌어 놓기도 된다.
 * 파일은 프로젝트 자료 폴더에 들어가고, 체크한 것만 설계도의 참고 자료가 된다.
 */
function RefsInput({ project, picked, onChange }: { project: string; picked: string[]; onChange: (v: string[]) => void }) {
  const [refs, setRefs] = useState<RefView[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch(`/api/refs?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ refs?: RefView[] }>)
      .then((body) => setRefs(body.refs ?? []))
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, [project]);

  const added = (id: string) => {
    onChange([...picked.filter((x) => x !== id), id]);
    void load();
  };

  async function post(url: string, body: unknown): Promise<{ ok?: boolean; ref?: RefView; error?: string }> {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as { ok?: boolean; ref?: RefView; error?: string };
  }

  async function addLink() {
    if (!url.trim()) return;
    setBusy(true);
    const body = await post("/api/refs/link", { alias: project, url, title });
    setBusy(false);
    if (body.ref) {
      setUrl("");
      setTitle("");
      setNote(null);
      added(body.ref.id);
    } else setNote(body.error ?? "붙이지 못했다");
  }

  async function addFiles(files: FileList | File[]) {
    setBusy(true);
    for (const file of Array.from(files)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const name = file.name || `붙여넣은-이미지-${Date.now()}.png`;
      const body = await post("/api/refs/file", { alias: project, name, dataBase64: btoa(bin) });
      if (body.ref) added(body.ref.id);
      else setNote(body.error ?? "붙이지 못했다");
    }
    setBusy(false);
  }

  async function archive(id: string) {
    await post("/api/refs/archive", { alias: project, id });
    onChange(picked.filter((x) => x !== id));
    void load();
  }

  return (
    <div
      className="refs"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length) {
          e.preventDefault();
          void addFiles(files);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {refs.length ? (
        <div className="refs-list">
          {refs.map((ref) => (
            <div key={ref.id} className={`ref-card${picked.includes(ref.id) ? " is-on" : ""}`}>
              <button
                type="button"
                className="ref-pick"
                aria-pressed={picked.includes(ref.id)}
                onClick={() => onChange(picked.includes(ref.id) ? picked.filter((x) => x !== ref.id) : [...picked, ref.id])}
              >
                {ref.kind === "image" ? <img src={refRaw(project, ref.id)} alt={ref.title} /> : <span className="ref-kind">{ref.kind === "link" ? "링크" : "파일"}</span>}
                <b>{ref.title}</b>
                <small>{ref.kind === "link" ? ref.uri : ref.id}</small>
              </button>
              <div className="ref-acts">
                {ref.kind === "link" ? (
                  <a href={ref.uri} target="_blank" rel="noreferrer">
                    열기
                  </a>
                ) : (
                  <a href={refRaw(project, ref.id)} target="_blank" rel="noreferrer">
                    열기
                  </a>
                )}
                <button type="button" onClick={() => void archive(ref.id)}>
                  빼기
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="refs-empty">아직 붙인 자료가 없습니다. 없으면 그대로 「다음」을 누르면 됩니다.</p>
      )}
      <div className="refs-add">
        <input value={url} placeholder="https:// 링크" onChange={(e) => setUrl(e.target.value)} />
        <input value={title} placeholder="이름 (선택)" onChange={(e) => setTitle(e.target.value)} />
        <button type="button" className="flow-btn" disabled={busy || !url.trim()} onClick={() => void addLink()}>
          링크 붙이기
        </button>
        <label className="flow-btn refs-file">
          파일 · 이미지
          <input type="file" multiple onChange={(e) => e.target.files && void addFiles(e.target.files)} />
        </label>
      </div>
      <p className="refs-hint">이미지는 여기에 붙여넣기(⌘V)나 끌어 놓기로도 붙습니다. 한 파일 10MB까지.</p>
      {note ? <p className="flow-error">{note}</p> : null}
    </div>
  );
}

/** 오른쪽 — 답할 때마다 자라는 설계. 0층이 맨 위, 단계 흐름이 그 아래. */
function SurveyPreviewPanel({ view, project }: { view: SurveyView; project: string }) {
  const p = view.preview;
  const label = (id: string) => p.concepts.find((c) => c.id === id)?.label ?? id;
  const main = p.edges.filter((e) => !e.when);
  const order: string[] = [];
  let at = "__start__";
  for (let guard = 0; guard < 20; guard += 1) {
    const next = main.find((e) => e.from === at)?.to;
    if (!next || next === "__end__") break;
    order.push(next);
    at = next;
  }
  const branches = p.edges.filter((e) => e.when);
  return (
    <aside className="survey-preview" aria-label="지금까지의 설계">
      {p.references.length ? (
        <PreviewBlock title={`참고 자료 ${p.references.length}`}>
          <div className="pv-refs">
            {p.references.map((ref) =>
              ref.kind === "image" ? (
                <img key={ref.id} src={refRaw(project, ref.id)} alt={ref.title} title={ref.title} />
              ) : (
                <span key={ref.id} className="pv-ref" title={ref.uri}>
                  {ref.kind === "link" ? "링크" : "파일"} · {ref.title}
                </span>
              ),
            )}
          </div>
        </PreviewBlock>
      ) : null}
      <PreviewBlock title="0 · 다루는 것들">
        <div className="pv-concepts">
          {p.concepts.map((c) => (
            <span key={c.id} className={`pv-concept is-${c.kind}`}>
              <b>{c.label}</b>
              <small>{KIND_LABEL[c.kind] ?? c.kind}</small>
              {c.values.length ? <em>{c.values.join(" · ")}</em> : null}
            </span>
          ))}
        </div>
        {p.relations.length ? (
          <ul className="pv-rel">
            {p.relations.map((r) => (
              <li key={`${r.from}>${r.to}`}>
                {label(r.from)} → {label(r.to)} <small>{CARD_LABEL[r.cardinality] ?? r.cardinality}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </PreviewBlock>
      <PreviewBlock title="단계 흐름">
        <ol className="pv-flow">
          {order.map((id) => {
            const node = p.nodes.find((n) => n.id === id);
            return (
              <li key={id} className={node?.model ? "is-model" : ""}>
                {node?.label ?? id}
                {node?.model ? <small>모델</small> : null}
              </li>
            );
          })}
        </ol>
        {branches.length ? <p className="pv-note">갈래 {branches.length}개 — 비었을 때 · 거절 · 시간 초과</p> : null}
      </PreviewBlock>
      <PreviewBlock title="누가 · 무엇이 좋아지면">
        <p className="pv-job">{p.jobStory}</p>
        <p className="pv-note">쓰는 사람: {p.stakeholders.join(" · ")}</p>
        <p className="pv-note">
          틀리면 피해: {RISK_LABEL[p.riskLevel] ?? p.riskLevel} · 자율: {AUTONOMY_LABEL[p.autonomy] ?? p.autonomy}
        </p>
        <ul className="pv-rel">
          {p.metrics.map((m) => (
            <li key={m.what}>
              {m.what} <small>{m.target}</small>
            </li>
          ))}
        </ul>
        <p className="pv-note">
          하지 않는 것 {p.nonGoals}개 · 역량 질문 {p.competencyQuestions}개
        </p>
        {p.openQuestions ? <p className="pv-open">아직 정하지 않은 것 {p.openQuestions}개 — 「잘 모르겠어요」로 넘김</p> : null}
      </PreviewBlock>
      <PreviewBlock title="약속과 시험">
        <p className="pv-note">
          요구사항 {p.requirements}개 — 꼭 {p.priorities.must ?? 0} · 있으면 좋음 {p.priorities.should ?? 0} · 나중에 {p.priorities.could ?? 0}
        </p>
        <p className="pv-note">
          시험 {p.evals}개 {view.needsModel ? "· 모델 필요" : "· 모델 없음"}
        </p>
      </PreviewBlock>
      {view.risks.length ? (
        <PreviewBlock title="위험">
          <ul className="pv-risks">
            {view.risks.map((r) => (
              <li key={r.text} className={`is-${r.level}`}>
                {r.level === "high" ? "높음" : "중간"} · {r.text}
              </li>
            ))}
          </ul>
        </PreviewBlock>
      ) : null}
    </aside>
  );
}

function PreviewBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pv-block">
      <span className="sec-title">{title}</span>
      {children}
    </section>
  );
}

function SurveyDone({ view, onReview, onBack }: { view: SurveyView; onReview: () => void; onBack: () => void }) {
  const unsure = view.sections.flatMap((s) => s.items).filter((i) => i.unsure);
  return (
    <section className="q-card q-done">
      <h3 className="q-ask">설문을 마쳤습니다</h3>
      <p className="q-help">
        {view.answered}개 문항에 답했고, 답으로 설계도 초안을 만들었습니다. 이제 검사가 칸끼리 맞물리는지 봅니다.
      </p>
      {unsure.length ? (
        <p className="q-unsure">「잘 모르겠어요」로 넘긴 문항 {unsure.length}개는 기본값으로 설계했습니다 — 검사 화면에서 다시 볼 수 있습니다.</p>
      ) : null}
      <div className="q-nav">
        <button type="button" className="flow-btn ghost" onClick={onBack}>
          ← 마지막 문항으로
        </button>
        <span className="ir-grow" />
        <button type="button" className="flow-btn primary" onClick={onReview}>
          설계도와 검사 보기
        </button>
      </div>
    </section>
  );
}
