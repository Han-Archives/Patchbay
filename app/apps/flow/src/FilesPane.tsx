import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Markdown } from "./ProjectLogPane.js";

/**
 * 왼쪽 바 「폴더 · 문서」 — 편집기형 (사용자 결정 2026-10-16, 시안 `절차/폴더문서-편집기형-시안_20261016_v1`).
 * 루트는 그 프로젝트의 기록 폴더(`workspace/projects/<alias>`)이고 다른 프로젝트는 보이지 않는다.
 * 트리 · 파일 탭 · 편집할 때 「원문 | 미리보기」. 고칠 수 있는지는 서버의 편집 등급이 정한다.
 */
type Grade = "edit" | "auto" | "live";

interface Entry {
  name: string;
  path: string;
  dir: boolean;
  bytes: number;
  mtimeMs: number;
  count?: number;
  grade?: Grade;
  secret?: boolean;
  note: string;
}

interface DirView {
  dir: string;
  note: string;
  entries: Entry[];
  summary: { folders: number; files: number; total: number; latestMs: number; grades: Record<Grade, number> };
}

interface FileView {
  path: string;
  content: string;
  bytes: number;
  mtimeMs: number;
  hash: string;
  grade: Grade;
  note: string;
}

interface OpenFile {
  file?: FileView;
  error?: string;
  draft?: string;
  conflictHash?: string;
}

const GRADE_TAG: Record<Grade, string> = { edit: "", auto: "자동", live: "쓰는 중" };
const GRADE_NOTE: Record<Grade, string> = {
  edit: "편집 가능 — 저장할 때 형식 검사",
  auto: "자동 생성 — 다시 만들면 덮어써서 읽기 전용",
  live: "지금도 쓰이는 파일 — 읽기 전용",
};

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; status: number; error: string; hash?: string }> {
  // 서버가 이 기능 전 빌드면 JSON 이 아닌 404 가 온다 — 던지지 않고 이유를 보여 준다(안 그러면 「불러오는 중」에 멈춘다).
  let res: Response;
  let body: T & { error?: string; hash?: string };
  try {
    res = await fetch(url, init);
    body = (await res.json()) as T & { error?: string; hash?: string };
  } catch {
    return { ok: false, status: 0, error: "서버가 응답하지 않거나 이 기능이 없는 옛 빌드입니다. 콘솔 서버를 새 빌드로 다시 켜 주세요." };
  }
  if (!res.ok) return { ok: false, status: res.status, error: body.error ?? `HTTP ${res.status}`, ...(body.hash ? { hash: body.hash } : {}) };
  return { ok: true, body };
}

function ago(ms: number): string {
  if (!ms) return "—";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function icon(entry: { name: string; dir?: boolean }): string {
  if (entry.dir) return "";
  if (entry.name.endsWith(".md")) return "¶";
  if (entry.name.endsWith(".jsonl")) return "≡";
  return /\.(json|ya?ml)$/.test(entry.name) ? "{}" : "·";
}

function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

function GradeTag({ grade }: { grade?: Grade }) {
  if (!grade || !GRADE_TAG[grade]) return null;
  return <span className={grade === "live" ? "fd-grade is-live" : "fd-grade"} title={GRADE_NOTE[grade]}>{GRADE_TAG[grade]}</span>;
}

/** 편집 중 오른쪽 칸 — 마크다운은 렌더, JSON 은 형식 검사, YAML 은 서버가 저장 때 본다. */
function EditPreview({ name, text }: { name: string; text: string }) {
  if (name.endsWith(".md")) return <><div className="fd-label">미리보기</div><Markdown text={text} /></>;
  if (name.endsWith(".json")) {
    try {
      const value = JSON.parse(text) as { todos?: { title?: string; done?: boolean }[] };
      const todos = Array.isArray(value?.todos) ? value.todos : null;
      return (
        <>
          <div className="fd-label">형식 검사</div>
          <div className="fd-check is-ok">
            <span>✓ JSON 형식이 맞습니다{todos ? ` · 할 일 ${todos.length}건` : ""}</span>
            {todos ? <ul>{todos.map((todo, i) => <li key={i}>{todo.done ? "☑" : "☐"} {todo.title}</li>)}</ul> : null}
          </div>
        </>
      );
    } catch (error) {
      return (
        <>
          <div className="fd-label">형식 검사</div>
          <div className="fd-check is-bad">✗ JSON 형식이 틀렸습니다 — 저장할 수 없습니다<small>{error instanceof Error ? error.message : String(error)}</small></div>
        </>
      );
    }
  }
  if (/\.ya?ml$/.test(name)) return <><div className="fd-label">형식 검사</div><div className="fd-check">YAML은 저장할 때 서버가 검사합니다. 틀리면 저장하지 않고 이유를 알려 줍니다.</div></>;
  return null;
}

function jsonBroken(name: string, text: string): boolean {
  if (!name.endsWith(".json")) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

export function FilesPane({ project, revision, readOnly }: { project: string; revision: number; readOnly: boolean }) {
  const [dirs, setDirs] = useState<Record<string, DirView>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selected, setSelected] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, OpenFile>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async (dir: string) => {
    const result = await getJson<DirView>(`/api/workspace-files?alias=${encodeURIComponent(project)}&dir=${encodeURIComponent(dir)}`);
    if (!result.ok) {
      if (dir === "") setError(result.error);
      return;
    }
    setDirs((prev) => ({ ...prev, [dir]: result.body }));
  }, [project]);

  const loadFile = useCallback(async (rel: string) => {
    const result = await getJson<FileView>(`/api/workspace-file?alias=${encodeURIComponent(project)}&path=${encodeURIComponent(rel)}`);
    setFiles((prev) => ({ ...prev, [rel]: result.ok ? { file: result.body } : { error: result.error } }));
  }, [project]);

  // 프로젝트가 바뀌면 처음부터.
  useEffect(() => {
    setDirs({});
    setExpanded(new Set([""]));
    setSelected("");
    setTabs([]);
    setFiles({});
    setEditing(null);
    setNotice(null);
    setError(null);
  }, [project]);

  // 작업 공간이 바뀌면(에이전트가 할 일을 고치는 등) 펼친 폴더를 다시 읽는다. 열어 둔 파일은 고치는 중이 아니면 다시 읽는다.
  useEffect(() => {
    for (const dir of expanded) void loadDir(dir);
    if (selected && !dirs[selected] && files[selected]?.draft === undefined && files[selected]?.file) void loadFile(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, revision, expanded, loadDir]);

  const root = dirs[""];
  const current = files[selected];
  const selectedIsDir = selected === "" || Boolean(dirs[selected]) || findEntry(selected)?.dir === true;

  function findEntry(rel: string): Entry | undefined {
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    return dirs[parent]?.entries.find((entry) => entry.path === rel);
  }

  function dirty(rel: string): boolean {
    const open = files[rel];
    return open?.draft !== undefined && open.draft !== open.file?.content;
  }

  function pick(entry: Entry) {
    setNotice(null);
    if (entry.dir) {
      setSelected(entry.path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (selected === entry.path && next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      return;
    }
    setSelected(entry.path);
    setEditing(files[entry.path]?.draft !== undefined ? entry.path : null);
    if (!tabs.includes(entry.path)) setTabs((prev) => [...prev, entry.path]);
    if (!entry.secret && !files[entry.path]) void loadFile(entry.path);
  }

  function closeTab(rel: string) {
    if (dirty(rel) && !window.confirm(`${baseName(rel)}에 저장하지 않은 변경이 있습니다. 닫을까요?`)) return;
    const rest = tabs.filter((tab) => tab !== rel);
    setTabs(rest);
    setFiles((prev) => {
      const { [rel]: _drop, ...others } = prev;
      return others;
    });
    if (editing === rel) setEditing(null);
    if (selected === rel) setSelected(rest[rest.length - 1] ?? "");
  }

  function setDraft(rel: string, draft: string | undefined) {
    setFiles((prev) => ({ ...prev, [rel]: { ...prev[rel], draft } }));
  }

  async function save(rel: string, expectedHash: string | undefined) {
    const open = files[rel];
    if (!open?.file || open.draft === undefined) return;
    setBusy(true);
    setNotice(null);
    const result = await getJson<{ hash: string; bytes: number; mtimeMs: number }>("/api/workspace-file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, path: rel, content: open.draft, ...(expectedHash ? { expectedHash } : {}) }),
    });
    setBusy(false);
    if (!result.ok) {
      if (result.status === 409) setFiles((prev) => ({ ...prev, [rel]: { ...prev[rel], conflictHash: result.hash } }));
      else setNotice(`저장하지 못했습니다: ${result.error}`);
      return;
    }
    const saved = open.draft;
    setFiles((prev) => ({ ...prev, [rel]: { file: { ...open.file!, content: saved, hash: result.body.hash, bytes: result.body.bytes, mtimeMs: result.body.mtimeMs } } }));
    setEditing(null);
    setNotice("저장했습니다 — 디스크의 파일이 바뀌었습니다.");
    void loadDir(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
  }

  function renderTree(dir: string, depth: number): ReactElement[] {
    const view = dirs[dir];
    if (!view) return [];
    return view.entries.flatMap((entry) => {
      const open = entry.dir && expanded.has(entry.path);
      const row = (
        <button
          key={entry.path}
          type="button"
          role="treeitem"
          aria-selected={selected === entry.path}
          aria-expanded={entry.dir ? open : undefined}
          className="fd-row"
          style={{ paddingLeft: 10 + depth * 14 }}
          title={entry.note || entry.name}
          onClick={() => pick(entry)}
        >
          <span className={open ? "fd-caret is-open" : "fd-caret"}>{entry.dir ? "▶" : ""}</span>
          <span className="fd-icon">{entry.secret ? "🔒" : icon(entry)}</span>
          <span className="fd-name">{entry.name}{entry.dir ? "/" : ""}</span>
          {dirty(entry.path) ? <span className="fd-dirty" title="저장하지 않은 변경" /> : null}
          {entry.dir ? <span className="fd-meta">{entry.count}</span> : <GradeTag grade={entry.grade} />}
        </button>
      );
      return open ? [row, ...renderTree(entry.path, depth + 1)] : [row];
    });
  }

  function crumb(rel: string, note: string) {
    const parts = [project, ...(rel ? rel.split("/") : [])];
    return (
      <div className="fd-crumb">
        <span>{parts.map((part, i) => (i === parts.length - 1 ? <b key={i}>{part}</b> : <span key={i}>{part} / </span>))}</span>
        {note ? <em>{note}</em> : null}
      </div>
    );
  }

  function folderBody(view: DirView) {
    const { summary } = view;
    return (
      <>
        <div className="fd-card">
          <span className="fd-label">이 폴더는</span>
          <div className="fd-desc">{view.note || "설명 없음"}</div>
          <div className="fd-stats">
            <span><b>{summary.folders}</b>폴더</span><span><b>{summary.files}</b>파일</span>
            <span><b>{summary.total}</b>아래 전체</span><span><b>{ago(summary.latestMs)}</b>최근 수정</span>
          </div>
          <div className="fd-stats">
            <span><b>{summary.grades.edit}</b>편집 가능</span><span><b>{summary.grades.auto}</b>자동 생성</span><span><b>{summary.grades.live}</b>쓰는 중</span>
          </div>
        </div>
        <div className="fd-kids">
          {view.entries.map((entry) => (
            <button key={entry.path} type="button" className="fd-row" onClick={() => pick(entry)}>
              <span className="fd-icon">{entry.dir ? "▸" : entry.secret ? "🔒" : icon(entry)}</span>
              <span className="fd-name">{entry.name}{entry.dir ? "/" : ""}</span>
              <span className="fd-meta">{entry.dir ? `${entry.count}개` : kb(entry.bytes)} · {ago(entry.mtimeMs)}</span>
              <GradeTag grade={entry.grade} />
            </button>
          ))}
        </div>
      </>
    );
  }

  function fileHead(rel: string) {
    const entry = findEntry(rel);
    const file = current?.file;
    const grade = file?.grade ?? entry?.grade;
    let actions: ReactElement | null = null;
    if (readOnly) actions = <span className="fd-grade">조회 전용</span>;
    else if (!file) actions = null;
    else if (grade !== "edit") actions = <span className={grade === "live" ? "fd-grade is-live" : "fd-grade"}>읽기 전용</span>;
    else if (editing === rel) {
      actions = (
        <>
          <button type="button" className="flow-btn" disabled={busy} onClick={() => { setDraft(rel, undefined); setEditing(null); setFiles((prev) => ({ ...prev, [rel]: { ...prev[rel], conflictHash: undefined } })); }}>취소</button>
          <button type="button" className="flow-btn primary" data-action="save-workspace-file" disabled={busy || !dirty(rel) || jsonBroken(rel, current?.draft ?? "")} onClick={() => void save(rel, file.hash)}>저장</button>
        </>
      );
    } else {
      actions = (
        <span className="fd-seg">
          <button type="button" aria-pressed="true">보기</button>
          <button type="button" aria-pressed="false" onClick={() => { setDraft(rel, current?.draft ?? file.content); setEditing(rel); setNotice(null); }}>편집</button>
        </span>
      );
    }
    return (
      <>
        {crumb(rel, file?.note ?? entry?.note ?? "")}
        <span className="fd-spacer" />
        {file ? <small className="fd-muted">{kb(file.bytes)} · {ago(file.mtimeMs)}</small> : null}
        {actions}
      </>
    );
  }

  function fileBody(rel: string) {
    const entry = findEntry(rel);
    if (entry?.secret) return <div className="fd-empty">🔒 비밀 파일이라 열지 않습니다.</div>;
    if (!current) return <div className="fd-empty">불러오는 중</div>;
    if (current.error) return <div className="fd-empty">미리보기 없음 — {current.error}</div>;
    const file = current.file!;
    const text = current.draft ?? file.content;
    const notes = (
      <>
        {file.grade !== "edit" ? (
          <div className="fd-note">
            {file.grade === "live"
              ? "≡ 이 파일은 지금도 쓰이고 있어서 읽기 전용입니다. 고치려면 대화방 · Log 화면에서 합니다."
              : "⟳ 자동으로 만들어지는 파일이라 읽기 전용입니다. 고쳐도 다음에 다시 만들 때 덮어씁니다."}
          </div>
        ) : null}
        {current.conflictHash ? (
          <div className="fd-note is-warn">
            ⚠ 연 뒤에 이 파일이 화면 밖에서 바뀌었습니다 (에이전트가 차례 끝에 고쳤을 수 있습니다). 저장하면 그 변경을 덮어씁니다.
            <span className="fd-spacer" />
            <button type="button" className="flow-btn" onClick={() => { setEditing(null); void loadFile(rel); }}>바뀐 내용 다시 읽기</button>
            <button type="button" className="flow-btn" disabled={busy} onClick={() => void save(rel, current.conflictHash)}>내 것으로 저장</button>
          </div>
        ) : null}
        {notice ? <div className="fd-note is-ok">{notice}</div> : null}
      </>
    );
    if (editing === rel && !readOnly && file.grade === "edit") {
      return (
        <>
          {notes}
          <div className="fd-split">
            <div>
              <div className="fd-label">원문 · 편집</div>
              <textarea className="fd-editor" value={text} spellCheck={false} aria-label={`${baseName(rel)} 편집`} onChange={(event) => setDraft(rel, event.target.value)} />
            </div>
            <div><EditPreview name={rel} text={text} /></div>
          </div>
        </>
      );
    }
    return <>{notes}{rel.endsWith(".md") ? <Markdown text={text} /> : <pre className="fd-code">{text}</pre>}</>;
  }

  if (error) return <p className="flow-error">{error}</p>;
  if (!root) return <p>불러오는 중</p>;
  const folder = selectedIsDir ? dirs[selected] : undefined;

  return (
    <section className="fd-pane" aria-label="폴더 · 문서">
      <nav className="fd-side" aria-label="기록 폴더">
        <div className="fd-root">
          <b>{project}</b>
          <small>workspace/projects/{project}</small>
          <small className="fd-root-count">{root.summary.total}개 파일 · 이 프로젝트만</small>
        </div>
        <div className="fd-tree" role="tree">
          {root.entries.length === 0 ? <p className="fd-muted fd-pad">아직 기록이 없습니다.</p> : renderTree("", 0)}
        </div>
        <div className="fd-legend">
          <span><span className="fd-grade is-blank">자동</span>표시 없음 — 편집 가능</span>
          <span><span className="fd-grade">자동</span>자동 생성 · 읽기 전용</span>
          <span><span className="fd-grade is-live">쓰는 중</span>지금도 쓰임 · 읽기 전용</span>
        </div>
      </nav>
      <div className="fd-main">
        <div className="fd-tabs" role="tablist">
          {tabs.map((tab) => (
            <span key={tab} className="fd-tab" role="tab" aria-selected={tab === selected}>
              <button type="button" onClick={() => { setSelected(tab); setEditing(files[tab]?.draft !== undefined ? tab : null); setNotice(null); }}>
                {baseName(tab)}
              </button>
              {dirty(tab) ? <span className="fd-dirty" /> : null}
              <button type="button" className="fd-x" aria-label={`${baseName(tab)} 닫기`} onClick={() => closeTab(tab)}>×</button>
            </span>
          ))}
        </div>
        <header className="fd-head">
          {selectedIsDir ? <>{crumb(selected, folder?.note ?? "")}<span className="fd-spacer" /><small className="fd-muted">폴더</small></> : fileHead(selected)}
        </header>
        <div className="fd-body">
          {selectedIsDir ? (folder ? folderBody(folder) : <div className="fd-empty">불러오는 중</div>) : fileBody(selected)}
        </div>
      </div>
    </section>
  );
}
