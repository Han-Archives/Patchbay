import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { RagAnswer, RagHit, RagSearch, RagSource } from "@patchbay/core";
import { DocumentCallPanel } from "./DocumentCallPanel.js";
import "./rag.css";

interface SourceView { revision: number; sources: RagSource[] }
interface Member { id: string; name: string; model: string; speaker: string; available: boolean; reason: string }
interface Original { content: string; path: string; versionId: string; start: number; end: number; line: number }
interface AnswerView { search: RagSearch; answer: RagAnswer; model: string; ms: number }
const labels = { supported: "근거가 달린 답변", insufficient: "답할 근거가 부족합니다", ambiguous: "질문 범위를 더 구체적으로 알려주세요", conflicting: "자료가 상충합니다 · 양쪽 근거 확인 필요" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "요청을 처리하지 못했습니다.");
  return body as T;
}
export function RagPane({ project, revision = 0, readOnly = false }: { project: string; revision?: number; readOnly?: boolean }) {
  const [tab, setTab] = useState<"question" | "sources" | "diagnostics">("question");
  const [sources, setSources] = useState<SourceView>({ revision: 0, sources: [] });
  const [members, setMembers] = useState<Member[]>([]), [locals, setLocals] = useState<{ id: string; name: string }[]>([]);
  const [files, setFiles] = useState<string[]>([]), [path, setPath] = useState(""), [query, setQuery] = useState("");
  const [model, setModel] = useState(""), [search, setSearch] = useState<RagSearch | null>(null), [answer, setAnswer] = useState<AnswerView | null>(null);
  const [original, setOriginal] = useState<Original | null>(null), [quote, setQuote] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "source" | "models" | "files" | "search" | "answer">("");
  const active = useRef<{ id: string; controller: AbortController } | null>(null), epoch = useRef(0), fingerprint = useRef("");
  const mutating = useRef(false), mutationEpoch = useRef(0);
  const originalPane = useRef<HTMLPreElement>(null);
  useEffect(() => { originalPane.current?.querySelector("mark")?.scrollIntoView({ block: "nearest" }); }, [original, quote]);
  const sourcesRef = useRef(sources); sourcesRef.current = sources;
  const post = useCallback(<T,>(action: string, body: object, signal?: AbortSignal) => json<T>("/api/rag/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, ...body }), signal }), [project]);
  const clear = useCallback(() => { epoch.current++; setSearch(null); setAnswer(null); setOriginal(null); setQuote(""); }, []);
  const stop = useCallback(() => {
    const running = active.current;
    if (running) {
      void post("stop", { requestId: running.id }).catch(() => undefined);
      running.controller.abort(); active.current = null;
    }
    epoch.current++; setBusy("");
  }, [post]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (mutating.current) return;
    const mutation = mutationEpoch.current;
    const view = await json<SourceView>("/api/rag/sources?" + new URLSearchParams({ alias: project }), { signal });
    if (signal?.aborted || mutating.current || mutation !== mutationEpoch.current) return;
    const key = JSON.stringify(view);
    if (fingerprint.current && fingerprint.current !== key) { stop(); clear(); setNotice("자료나 사용 설정이 바뀌었습니다. 최신 자료로 다시 검색해주세요."); }
    fingerprint.current = key; setSources(view); setLoading(false);
  }, [project, clear, stop]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((e: Error) => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    const timer = setInterval(() => { void refresh(controller.signal).catch(() => undefined); }, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [refresh, revision]);
  useEffect(() => {
    const controller = new AbortController();
    void json<{ members: Member[] }>("/api/rag/models?" + new URLSearchParams({ alias: project }), { signal: controller.signal }).then(v => setMembers(v.members)).catch(() => undefined);
    return () => { controller.abort(); const r = active.current; if (r) { void fetch("/api/rag/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, requestId: r.id }), keepalive: true }); r.controller.abort(); } epoch.current++; };
  }, [project]);
  async function mutate(action: "source" | "usage", input: object) {
    mutating.current = true; mutationEpoch.current++;
    setError(""); setNotice(""); stop(); clear(); setBusy("source");
    try {
      const view = await post<SourceView>(action, { ...input, revision: sourcesRef.current.revision });
      fingerprint.current = JSON.stringify(view); setSources(view); setPath("");
      setNotice(action === "source" ? "원문을 검색 자료로 등록했습니다. 관계 후보와 승인은 별도로 관리합니다." : "자료 사용 설정을 저장했습니다.");
    } catch (e) { setError((e as Error).message); mutating.current = false; await refresh().catch(() => undefined); }
    finally { mutating.current = false; setBusy(""); }
  }
  function usage(source: RagSource, retrieval: boolean, remoteTransfer: boolean) {
    setSources(v => ({ ...v, sources: v.sources.map(s => s.id === source.id ? { ...s, usage: { graph: s.usage?.graph ?? true, retrieval }, remoteTransfer } : s) }));
    void mutate("usage", { sourceId: source.id, retrieval, remoteTransfer });
  }
  async function find(event: FormEvent) {
    event.preventDefault(); clear(); setError(""); setNotice(""); setBusy("search");
    const token = epoch.current;
    try { const value = await post<RagSearch>("search", { query }); if (token === epoch.current) setSearch(value); }
    catch (e) { if (token === epoch.current) setError((e as Error).message); }
    finally { if (token === epoch.current) setBusy(""); }
  }
  async function generate() {
    if (!search || !model) return;
    const controller = new AbortController(), requestId = crypto.randomUUID(), token = ++epoch.current;
    active.current = { id: requestId, controller }; setBusy("answer"); setAnswer(null); setError("");
    try {
      const value = await post<AnswerView>("answer", { query: search.query, revision: search.revision, corpus: search.corpus, requestId,
        ...(model.startsWith("local:") ? { localModel: model.slice(6) } : { memberId: model.slice(7) }) }, controller.signal);
      if (token === epoch.current && !controller.signal.aborted) { setSearch(value.search); setAnswer(value); }
    } catch (e) { if (token === epoch.current && !controller.signal.aborted) setError((e as Error).message); }
    finally { if (active.current?.id === requestId) active.current = null; if (token === epoch.current) setBusy(""); }
  }
  async function open(hit: RagHit, exact = hit.text) {
    const token = epoch.current; setError("");
    try {
      const view = await post<Original>("citation", { citation: hit });
      if (token === epoch.current) { setOriginal(view); setQuote(exact); }
    } catch (e) { if (token === epoch.current) { setOriginal(null); setError((e as Error).message); } }
  }
  async function localModels() {
    setBusy("models"); setError("");
    try {
      const value = await json<{ models: { id: string; name: string }[] }>("/api/knowledge/semantic/local-models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project }) });
      setLocals(value.models); if (!value.models.length) setNotice("다운로드한 대화 모델이 없습니다.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function listFiles() {
    setBusy("files"); setError("");
    try {
      const view = await json<{ files: string[] }>("/api/room/files?" + new URLSearchParams({ alias: project }));
      setFiles(view.files.filter(p => /\.(md|txt)$/i.test(p)));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  const enabled = sources.sources.filter(s => s.usage?.retrieval), current = enabled.filter(s => s.status === "current");
  const changed = enabled.filter(s => s.status === "changed");
  const selected = model.startsWith("member:") ? members.find(m => "member:" + m.id === model) : undefined;
  const remote = selected && selected.speaker !== "local";
  const permitted = !remote || !search?.hits.some(h => !h.remoteTransfer);
  const quoteStart = original ? original.content.indexOf(quote, original.start) : -1;
  return <section className="rag-pane" aria-label="RAG 근거 검색과 답변">
    <header className="rag-heading"><div><h2>RAG <small>근거로 찾고 답하기</small></h2><p>선택한 원문을 찾고, 원하는 모델로 출처가 달린 답변을 만듭니다.</p></div><span className="rag-pill">검색 자료 {current.length}개</span></header>
    <nav className="rag-tabs" aria-label="RAG 보기">{([ ["question", "질문"], ["sources", "자료"], ["diagnostics", "검색 점검"] ] as const).map(([id, label]) => <button key={id} className={tab === id ? "is-active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <p role="alert" className="rag-alert">{error}</p>}{notice && <p role="status" className="rag-notice">{notice}</p>}
    {changed.length > 0 && <div className="rag-alert">자료 {changed.length}개의 개정을 확인했습니다. 이전 본문은 검색에서 제외했습니다. <button onClick={() => setTab("sources")}>자료에서 다시 불러오기</button></div>}
    {loading ? <p className="rag-empty">자료를 확인하는 중…</p> : tab === "question" ? <>
      {!current.length && <div className="rag-empty"><div className="rag-flow"><span>자료 선택</span><i>→</i><span>질문</span><i>→</i><span>원문과 답변</span></div><h3>먼저 검색에 사용할 자료를 선택해주세요.</h3><p>A+B 자료를 함께 사용할 수 있습니다. 문서 검색 사용과 관계 승인은 별개입니다.</p><button className="flow-btn" onClick={() => setTab("sources")}>자료 선택</button></div>}
      <div className="rag-layout"><div className="rag-main"><form onSubmit={e => void find(e)} className="rag-question">
        <div className="rag-scope"><span>현재 프로젝트</span><span>선택한 최신 원문</span><span>본문 단어 검색</span></div>
        <label>어떤 내용을 찾고 싶나요?<textarea aria-label="RAG 질문" value={query} maxLength={2000} onChange={e => { if (busy === "answer") stop(); setQuery(e.target.value); clear(); }} placeholder="예: 이 서비스는 왜 Neo4j를 사용하나요?" disabled={busy === "search"} /></label>
        <div className="rag-actions"><button className="flow-btn is-primary" disabled={readOnly || !!busy || !query.trim() || !current.length}>{busy === "search" ? "원문 찾는 중…" : "원문 찾기"}</button><small>답변 모델 실행 없이 문서 본문을 검색합니다.</small></div>
      </form>
      {search && <div aria-label="원문 검색 결과"><div className="rag-section-title"><h3>{search.hits.length ? `원문 근거 ${search.hits.length}개` : "답할 근거를 찾지 못했습니다"}</h3><small>{search.ms}ms · 단어 검색</small></div>
        {!search.hits.length && <p className="rag-empty">선택 자료에 답이 없을 수 있습니다. 질문을 구체화하거나 자료를 추가해주세요.</p>}
        {search.hits.map(hit => <article className="rag-hit" key={hit.id}><strong>{hit.path.split("/").at(-1)} · {hit.heading || "본문"}</strong><small>{hit.line}줄부터 · 원문 {hit.sourceHash.slice(0, 8)} · 단어 일치</small><p>{hit.text}</p><button onClick={() => void open(hit)}>원문 보기 [{hit.id}] ↗</button></article>)}
        {search.hits.length > 0 && <div className="rag-generation"><label>답변 모델<select aria-label="RAG 답변 모델" value={model} onChange={e => { setModel(e.target.value); setAnswer(null); }} disabled={!!busy || readOnly}><option value="">모델을 직접 선택해주세요</option>{members.map(m => <option key={m.id} value={"member:" + m.id} disabled={!m.available}>{m.speaker === "local" ? "LM Studio · " : ""}{m.name} · {m.model}{!m.available ? " (준비 중)" : ""}</option>)}{locals.length > 0 && <optgroup label="LM Studio 대화 모델">{locals.map(m => <option key={m.id} value={"local:" + m.id}>{m.name}</option>)}</optgroup>}</select></label>
          <div className="rag-actions"><button className="flow-btn" disabled={!!busy || readOnly} onClick={() => void localModels()}>LM Studio 모델 불러오기</button><button className="flow-btn is-primary" disabled={!!busy || readOnly || !model || !permitted} onClick={() => void generate()}>{busy === "answer" ? "답변 생성 중…" : "근거로 답변 만들기"}</button>{busy === "answer" && <button className="flow-btn" onClick={() => { stop(); setNotice("답변 생성을 중지했습니다. 원문 검색 결과는 유지됩니다."); }}>답변 중지</button>}</div>
          <p>{remote ? "선택한 원문 발췌를 외부 모델에 전달합니다." : "답변 버튼을 누르면 선택한 원문 발췌만 모델에 전달합니다."} 도구를 실행하거나 프로젝트 파일을 읽지 않습니다.</p>
          {!permitted && <p className="rag-alert">외부 전달을 허용하지 않은 자료가 있습니다. 자료 보기에서 허용하거나 LM Studio 모델을 선택해주세요.</p>}
          {members.some(m => !m.available) && <details><summary>사용할 수 없는 모델 안내</summary>{members.filter(m => !m.available).map(m => <p key={m.id}>{m.name}: {m.reason}</p>)}</details>}
        </div>}
      </div>}
      {answer && <article className={"rag-answer " + answer.answer.status} aria-live="polite"><h3>{labels[answer.answer.status]}</h3>{answer.answer.claims.map((claim, i) => <p key={i}>{claim.text} {claim.citations.map((citation, j) => { const hit = answer.search.hits.find(h => h.id === citation.id)!; return <button className="rag-citation" key={j} aria-label={`인용 ${citation.id} 원문`} onClick={() => void open(hit, citation.quote)}>[{citation.id}]</button>; })}</p>)}{answer.answer.status === "insufficient" && <p>전달한 자료만으로 답할 수 없습니다. 자료를 추가하거나 질문을 바꿔주세요.</p>}{answer.answer.status === "ambiguous" && <p>어떤 대상·시점·범위를 묻는지 구체적으로 적어주세요.</p>}<small>{answer.model} · {(answer.ms / 1000).toFixed(1)}초 · 원문 인용 일치 확인</small></article>}
      </div><aside className="rag-original" aria-label="인용 원문"><div className="rag-section-title"><h3>원문 확인</h3>{original && <button aria-label="원문 닫기" onClick={() => setOriginal(null)}>닫기</button>}</div>{original ? <><strong>{original.path}</strong><small>버전 {original.versionId.slice(-12)} · {original.line}줄부터</small><pre ref={originalPane}>{quoteStart >= 0 ? <>{original.content.slice(0, quoteStart)}<mark>{original.content.slice(quoteStart, quoteStart + quote.length)}</mark>{original.content.slice(quoteStart + quote.length)}</> : original.content}</pre></> : <p>검색 결과의 원문 보기나 답변의 인용 번호를 누르세요.</p>}</aside></div>
      <details className="rag-legacy"><summary>설계 연결로 문서 찾기</summary><p>설계 출발점에서 연결된 문서를 찾는 기존 기능입니다.</p><DocumentCallPanel project={project} revision={revision} /></details>
    </> : tab === "sources" ? <section className="rag-source-section"><div className="rag-section-title"><h3>검색 자료</h3><small>A+B와 같은 원문 목록 · 최대 10개</small></div>
      <form className="rag-add-source" onSubmit={e => { e.preventDefault(); void mutate("source", { path }); }}><label>프로젝트 안 MD/TXT 경로<input aria-label="RAG 자료 경로" list="rag-files" value={path} onChange={e => setPath(e.target.value)} placeholder="knowledge/…/자료.md" disabled={!!busy || readOnly} /></label><datalist id="rag-files">{files.map(f => <option key={f} value={f} />)}</datalist><button type="button" className="flow-btn" disabled={!!busy} onClick={() => void listFiles()}>문서 목록 불러오기</button><button className="flow-btn" disabled={!!busy || readOnly || !path.trim()}>자료 추가</button></form>
      {!sources.sources.length && <p className="rag-empty">선택한 자료가 없습니다. 사용할 문서를 직접 추가해주세요.</p>}
      {sources.sources.map(source => <article className="rag-source" key={source.id}><div><strong>{source.path}</strong><small>{source.versions}판 · {source.status === "changed" ? "개정 감지 · 다시 불러오기 필요" : "원문 확인됨"} · {source.usage?.graph ? "그래프에서도 사용" : "관계 후보 추출 없음"}</small></div><div className="rag-source-options"><label><input type="checkbox" checked={source.usage?.retrieval ?? false} disabled={!!busy || readOnly} onChange={e => usage(source, e.target.checked, source.remoteTransfer ?? false)} />검색에 사용</label><label><input type="checkbox" checked={source.remoteTransfer ?? false} disabled={!!busy || readOnly} onChange={e => usage(source, source.usage?.retrieval ?? false, e.target.checked)} />외부 모델에 발췌 전달 허용</label>{source.status === "changed" && <button className="flow-btn" disabled={!!busy || readOnly} onClick={() => void mutate("source", { path: source.path })}>다시 불러오기</button>}</div></article>)}
      <p className="rag-note">검색 사용을 꺼도 원문 버전과 A+B의 승인 관계는 보존됩니다. 외부 모델 전달은 기본으로 허용하지 않습니다.</p>
    </section> : <section className="rag-diagnostics"><h3>검색 점검</h3><div className="rag-flow"><span>접근·원문 확인</span><i>→</i><span>본문 검색</span><i>→</i><span>선택 모델</span><i>→</i><span>인용·현재성 검사</span></div>{search ? <><p>현재 자료 판 {search.revision} · 검색에 사용한 자료 {search.activeSources}개 · 선택 발췌 {search.hits.length}개 · 검색 {search.ms}ms</p><ul>{search.hits.map(h => <li key={h.id}>[{h.id}] {h.path} · {h.heading || "본문"} · {h.line}줄 · 단어 검색</li>)}</ul></> : <p>질문 보기에서 검색하면 실제 사용한 원문과 단계를 확인할 수 있습니다.</p>}<p className="rag-note">현재는 본문 단어 검색과 출처 답변을 제공합니다. 의미 검색과 승인 관계를 통한 보강은 별도 비교 검증 후 확장합니다. 검색 순위는 정답 확률이 아닙니다.</p></section>}
  </section>;
}
