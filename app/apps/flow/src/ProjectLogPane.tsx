import { useEffect, useMemo, useRef, useState } from "react";
import { InlineText } from "./InlineText.js";
import {
  LOG_KINDS, LOG_KIND_LABEL, LOG_SOURCE_LABEL, isoWeekKey, mondayCells, parseMiniMarkdown, shiftMonth, tagColor, weekDates, weekdayLabel,
  type LogDayStat, type LogDayView, type LogEvent, type LogIndexEntry, type LogKind, type LogMonthView, type MdBlock,
} from "./logContract.js";
import type { WorkspaceProject } from "./workspaceContract.js";

/**
 * 프로젝트 도구 줄 「Log」 (사용자 결정 2026-10-15 — 1안 화면 + 층별 폴더).
 * 왼쪽 달력 · 태그 · 수집, 가운데 그날 기록(기록 · 요약), 아래 색인. 주 · 월 보기에서는 태그 막대 자리에 태그 지도.
 * 일일 기록 파일은 작업 공간 `projects/<alias>/log/` — 커널이 정리하고, 이 화면은 읽고 버튼으로 부른다.
 */
type View = "day" | "week" | "month";

const fmt = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const SOURCE_KIND: Record<string, LogKind> = { "진행 보고": "진행", "대화방": "대화", "할일": "할일", "흐름도 항목": "흐름도", "History 메모": "메모", "git 커밋": "커밋" };

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json() as T & { error?: string; errors?: string[] };
  if (!res.ok) throw new Error([body.error ?? "요청이 실패했습니다.", ...(body.errors ?? [])].join(" · "));
  return body;
}
const post = <T,>(url: string, body: unknown) => getJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function TagChip({ tag, from }: { tag: string; from?: string }) {
  const color = tagColor(tag);
  return <span className="log-chip" style={{ color, borderColor: color }} title={from ? `${tag} · ${from}` : tag}>{tag}</span>;
}

function Markdown({ text }: { text: string }) {
  const blocks = parseMiniMarkdown(text);
  return <div className="log-md">{blocks.map((b: MdBlock, i) => b.kind === "h" ? <h4 key={i} className={`is-h${b.level}`}><InlineText text={b.text} /></h4>
    : b.kind === "li" ? <p key={i} className="is-li"><InlineText text={b.text} /></p>
    : b.kind === "quote" ? <p key={i} className="is-quote"><InlineText text={b.text} /></p>
    : b.kind === "table" ? <div key={i} className="log-table-scroll"><table><tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => j === 0 ? <th key={k}>{c}</th> : <td key={k}><InlineText text={c} /></td>)}</tr>)}</tbody></table></div>
    : <p key={i}><InlineText text={b.text} /></p>)}</div>;
}

function Calendar({ month, days, selected, range, onPick, onMonth }: { month: string; days: Record<string, LogDayStat>; selected: string; range: string[]; onPick: (d: string) => void; onMonth: (m: string) => void }) {
  const level = (n: number) => !n ? 0 : n < 4 ? 1 : n < 7 ? 2 : n < 10 ? 3 : 4;
  return <section className="log-card log-calendar" aria-label="달력">
    <header><button type="button" aria-label="이전 달" onClick={() => onMonth(shiftMonth(month, -1))}>‹</button><h3>{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</h3><button type="button" aria-label="다음 달" onClick={() => onMonth(shiftMonth(month, 1))}>›</button></header>
    <div className="log-cal-grid">
      {"월화수목금토일".split("").map((d) => <span key={d} className="log-dow">{d}</span>)}
      {mondayCells(month).map((d, i) => {
        if (!d) return <span key={`e${i}`} />;
        const stat = days[d];
        const top = stat ? Object.entries(stat.tags).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined;
        return <button key={d} type="button" disabled={!stat} aria-pressed={d === selected} aria-label={`${d} · ${stat ? `${stat.events}건 · ${stat.state}` : "기록 없음"}`}
          className={`log-cell level-${level(stat?.events ?? 0)}${stat?.state === "확정" ? " is-confirmed" : ""}${range.includes(d) && d !== selected ? " in-range" : ""}`} onClick={() => onPick(d)}>
          {Number(d.slice(8))}{top ? <i style={{ background: tagColor(top) }} aria-hidden="true" /> : null}
        </button>;
      })}
    </div>
    <p className="log-help">색 = 사건 수 · 점 = 가장 많은 태그 · 오른쪽 위 점 = 확정</p>
  </section>;
}

function TagBars({ title, counts, tags }: { title: string; counts: Record<string, number>; tags: string[] }) {
  const names = [...tags, ...Object.keys(counts).filter((t) => !tags.includes(t))];
  const max = Math.max(1, ...Object.values(counts));
  return <section className="log-card" aria-label="태그">
    <header className="log-card-head"><h3>{title}</h3><small>사건 수</small></header>
    {names.map((t) => <div key={t} className="log-bar"><span>{t}</span><i style={{ width: `${((counts[t] ?? 0) / max) * 100}%`, background: tagColor(t), opacity: counts[t] ? 1 : 0.25 }} /><small>{counts[t] ?? 0}</small></div>)}
  </section>;
}

function TagMap({ dates, days, tags, filter, onCell }: { dates: string[]; days: Record<string, LogDayStat>; tags: string[]; filter: { tag: string | null; date: string | null }; onCell: (tag: string, date: string) => void }) {
  const [unit, setUnit] = useState<"events" | "files">("events");
  const names = [...tags, ...[...new Set(dates.flatMap((d) => Object.keys(days[d]?.tags ?? {})))].filter((t) => !tags.includes(t))];
  const value = (t: string, d: string) => (unit === "events" ? days[d]?.tags[t] : days[d]?.fileTags[t]) ?? 0;
  return <section className="log-card log-tagmap" aria-label="태그 지도">
    <header className="log-card-head"><h3>태그 지도</h3><small>칸을 누르면 아래 색인이 그 날 · 태그로 걸러집니다</small><span className="log-grow" /><button type="button" aria-pressed={unit === "events"} onClick={() => setUnit("events")}>사건 수</button><button type="button" aria-pressed={unit === "files"} onClick={() => setUnit("files")}>고유 파일 수</button></header>
    <div className="log-table-scroll">
      <div className="log-map" style={{ gridTemplateColumns: `80px repeat(${dates.length}, minmax(34px, 1fr)) 44px` }}>
        <span />{dates.map((d) => <span key={d} className="log-map-head">{fmt(d)}{days[d]?.state === "잠정" ? " ·잠정" : ""}</span>)}<span className="log-map-head">합</span>
        {names.map((t) => <div key={t} className="log-map-row">
          <span className="log-map-tag"><i style={{ background: tagColor(t) }} />{t}</span>
          {dates.map((d) => { const n = value(t, d); return <button key={d} type="button" disabled={!n} aria-label={`${d} ${t} ${n}`} aria-pressed={filter.tag === t && filter.date === d} onClick={() => onCell(t, d)} style={n ? { background: tagColor(t), opacity: Math.min(1, 0.35 + n / 7) } : undefined}>{n || ""}</button>; })}
          <span className="log-map-sum">{dates.reduce((s, d) => s + value(t, d), 0)}</span>
        </div>)}
      </div>
    </div>
  </section>;
}

function EventRow({ e }: { e: LogEvent }) {
  return <li className="log-event">
    <div className="log-event-line"><span className="log-time">{e.time}</span><b>{e.title}</b><span className="log-kind">{e.change}</span>{e.tags.map((t) => <TagChip key={t} tag={t} from={e.tagFrom[t]} />)}<code className="log-id">{e.id}</code></div>
    {e.detail?.map((d, i) => <p key={`d${i}`} className="log-sub">{d}</p>)}
    {e.excerpt?.map((x, i) => <p key={`x${i}`} className="log-sub">발췌 · {x}</p>)}
    {e.omitted ? <p className="log-sub">발췌 {e.omitted}개 더 · LLM 답은 넣지 않음</p> : null}
    {e.files?.length ? <p className="log-sub">파일 {e.files.length} · {e.files.slice(0, 6).join(" · ")}{e.files.length > 6 ? ` 외 ${e.files.length - 6}` : ""}</p> : null}
  </li>;
}

export function ProjectLogPane({ project, revision, initialDate }: { project: string; revision: number; workspace?: WorkspaceProject; initialDate?: string | null }) {
  const [view, setView] = useState<View>("day");
  const [month, setMonth] = useState<string | null>(initialDate ? initialDate.slice(0, 7) : null);
  const [data, setData] = useState<LogMonthView | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDate ?? null);
  const [day, setDay] = useState<LogDayView | null>(null);
  const [tab, setTab] = useState<"rec" | "sum">("rec");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<LogKind | null>(null);
  const [cellDate, setCellDate] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [canWrite, setCanWrite] = useState(true);
  const [models, setModels] = useState<{ available: boolean; reason?: string; models: { id: string; name: string }[] } | null>(null);
  const [report, setReport] = useState<{ name: string; file: string; created: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (initialDate) { setSelected(initialDate); setMonth(initialDate.slice(0, 7)); setView("day"); } }, [initialDate]);
  useEffect(() => { setData(null); setDay(null); setTagFilter(null); setKindFilter(null); setCellDate(null); setReport(null); if (!initialDate) { setSelected(null); setMonth(null); } }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/session", { signal: controller.signal }).then((r) => r.json()).then((b: { role?: string }) => { if (!controller.signal.aborted && b.role) setCanWrite(b.role === "write"); }).catch(() => undefined);
    return () => controller.abort();
  }, [project]);

  // 한 달 — 화면을 열 때 정리한다.
  useEffect(() => {
    let cancelled = false;
    setError("");
    getJson<LogMonthView>(`/api/log?alias=${encodeURIComponent(project)}${month ? `&month=${month}` : ""}`).then((body) => {
      if (cancelled) return;
      setData(body);
      if (!month) setMonth(body.month);
      setSelected((old) => {
        if (old && body.index?.days[old]) return old;
        const dates = Object.keys(body.index?.days ?? {}).sort();
        return body.index?.days[body.today] ? body.today : dates[dates.length - 1] ?? null;
      });
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [project, month, revision, tick]);

  useEffect(() => {
    if (!selected || !data?.index?.days[selected]) { setDay(null); return; }
    let cancelled = false;
    getJson<LogDayView>(`/api/log/day?alias=${encodeURIComponent(project)}&date=${selected}`).then((body) => { if (!cancelled) setDay(body); }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [project, selected, data]);

  const days = data?.index?.days ?? {};
  const tags = data?.tags ?? [];
  const range = useMemo(() => {
    if (!selected) return [];
    if (view === "day") return [selected];
    if (view === "week") return weekDates(selected);
    return Object.keys(days).filter((d) => d.startsWith(month ?? "")).sort();
  }, [view, selected, days, month]);
  const rangeCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of range) for (const [t, n] of Object.entries(days[d]?.tags ?? {})) out[t] = (out[t] ?? 0) + n;
    return out;
  }, [range, days]);
  const rows: LogIndexEntry[] = useMemo(() => (data?.index?.entries ?? []).filter((e) => (cellDate ? e.date === cellDate : range.includes(e.date)) && (!tagFilter || e.tags.includes(tagFilter)) && (!kindFilter || e.kind === kindFilter)).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)), [data, range, tagFilter, kindFilter, cellDate]);
  const stat = selected ? days[selected] : undefined;

  async function act(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError("");
    try { await fn(); } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(null); }
  }
  const refresh = () => setTick((n) => n + 1);
  const confirmDay = () => act("confirm", async () => { await post("/api/log/confirm", { alias: project, date: selected }); refresh(); });
  const reopenDay = () => act("reopen", async () => { if (!window.confirm("확정을 풀면 보존한 사건을 보관하고 다시 원문에서 정리합니다. 풀까요?")) return; await post("/api/log/reopen", { alias: project, date: selected }); refresh(); });
  const rebuild = () => act("build", async () => { await post("/api/log/build", { alias: project, date: selected }); refresh(); });
  const summarize = () => act("summary", async () => { const next = await post<LogDayView>("/api/log/summary", { alias: project, date: selected }); setDay(next); setTab("sum"); refresh(); });
  const stopSummary = () => { void post("/api/log/summary/stop", { alias: project }).catch(() => undefined); };
  const chooseModel = (model: string) => act("model", async () => { await post("/api/log/model", { alias: project, model }); refresh(); });
  useEffect(() => {
    if (!data || data.model || models) return;
    void getJson<NonNullable<typeof models>>("/api/log/models").then((m) => { if (alive.current) setModels(m); }).catch((e: Error) => { if (alive.current) setError(e.message); });
  }, [data, models]);
  const makeReport = (period: "day" | "week" | "month") => act("report", async () => {
    const base = selected ?? data?.today ?? "";
    const key = period === "day" ? base : period === "week" ? isoWeekKey(base) : base.slice(0, 7);
    setReport(await post("/api/log/report", { alias: project, period, key }));
  });
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.text], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = report.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pickCell = (tag: string, date: string) => {
    const same = tagFilter === tag && cellDate === date;
    setTagFilter(same ? null : tag); setCellDate(same ? null : date);
  };
  const viewLabel = view === "day" ? "이 날" : view === "week" ? `${selected ? isoWeekKey(selected) : "이번 주"}` : `${month ?? ""}`;

  return <section className="log-pane" aria-label="Log">
    <header className="log-head">
      <h2>Log</h2><span className="log-muted">{project} · 하루마다 무엇이 바뀌었는지</span>
      <span className="log-grow" />
      <div role="group" aria-label="보기" className="log-seg">{(["day", "week", "month"] as View[]).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); setCellDate(null); }}>{v === "day" ? "일" : v === "week" ? "주" : "월"}</button>)}</div>
      <span className="log-divider" aria-hidden="true" />
      <span className="log-muted">보고서 바탕</span>
      <div className="log-seg"><button type="button" disabled={!selected || !!busy} onClick={() => makeReport("day")}>이 날</button><button type="button" disabled={!selected || !!busy} onClick={() => makeReport("week")}>이 주</button><button type="button" disabled={!selected || !!busy} onClick={() => makeReport("month")}>이 달</button></div>
    </header>
    {error ? <p className="flow-error" role="alert">{error}</p> : null}

    {view !== "day" && month ? <TagMap dates={view === "week" && selected ? weekDates(selected) : range} days={days} tags={tags} filter={{ tag: tagFilter, date: cellDate }} onCell={pickCell} /> : null}

    <div className="log-split">
      <div className="log-side">
        {month ? <Calendar month={month} days={days} selected={selected ?? ""} range={view === "day" ? [] : range} onPick={(d) => { setSelected(d); setCellDate(null); }} onMonth={(m) => { setMonth(m); setSelected(null); }} /> : null}
        {view === "day" ? <TagBars title={`태그 · ${selected ? fmt(selected) : ""}`} counts={rangeCounts} tags={tags} /> : null}
        <section className="log-card" aria-label="수집">
          <header className="log-card-head"><h3>수집</h3></header>
          {(data?.index?.sources ?? []).map((s) => { const n = stat?.kinds[SOURCE_KIND[s.name] ?? ""] ?? 0; return <div key={s.name} className="log-source"><span>{LOG_SOURCE_LABEL[s.name] ?? s.name}</span><span className={s.state === "unavailable" || s.state === "error" ? "is-off" : n ? "is-on" : ""} title={s.note}>{s.state === "unavailable" ? "수집 불가" : s.state === "error" ? "실패" : n ? `${n}건` : "없음"}</span></div>; })}
          <p className="log-help">묶이지 않은 Claude Code 대화는 들어오지 않습니다.</p>
        </section>
      </div>

      <section className="log-card log-day" aria-label="그날 기록">
        {!data ? <p className="log-muted" role="status">기록 정리 중…</p> : !selected || !stat ? <p className="log-muted">이 달에는 기록된 날이 없습니다.</p> : <>
          <header className="log-day-head">
            <h3>{selected} ({weekdayLabel(selected)})</h3>
            <span className={`log-state ${stat.state === "확정" ? "is-done" : "is-temp"}`}>{stat.state}</span>
            <span className="log-muted">사건 {stat.events} · 고유 파일 {stat.files}</span>
            <span className="log-grow" />
            <div role="tablist" className="log-seg"><button type="button" role="tab" aria-selected={tab === "rec"} aria-pressed={tab === "rec"} onClick={() => setTab("rec")}>기록</button><button type="button" role="tab" aria-selected={tab === "sum"} aria-pressed={tab === "sum"} onClick={() => setTab("sum")}>요약{stat.summary === "stale" ? " · 낡음" : ""}</button></div>
          </header>
          <div className="log-actions">
            {stat.state === "잠정"
              ? <button type="button" className="log-primary" disabled={!canWrite || !!busy || selected > (data.today ?? "")} onClick={confirmDay}>{busy === "confirm" ? "확정 중…" : "이 날 확정"}</button>
              : <button type="button" disabled={!canWrite || !!busy} onClick={reopenDay}>확정 풀기</button>}
            <button type="button" disabled={!canWrite || !!busy} onClick={rebuild}>{busy === "build" ? "정리 중…" : "다시 정리"}</button>
            {data.model
              ? busy === "summary" ? <button type="button" onClick={stopSummary}>요약 멈추기</button> : <button type="button" disabled={!canWrite || !!busy} onClick={summarize}>요약 만들기 · {data.model}</button>
              : <label className="log-model">요약 모델<select aria-label="요약 모델 고르기" disabled={!canWrite || !!busy} value="" onChange={(e) => e.target.value && chooseModel(e.target.value)}><option value="">{models ? models.available ? "고르세요" : models.reason : "불러오는 중"}</option>{models?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
            {stat.state === "잠정" ? <small className="log-muted">대화는 늦게 옮겨질 수 있어 확정 전 다시 정리를 권합니다</small> : null}
          </div>
          {tab === "rec"
            ? <article className="log-doc"><code className="log-path">log/records/{selected}.md</code>
                {!day ? <p className="log-muted" role="status">불러오는 중…</p> : LOG_KINDS.map((k) => { const list = day.events.filter((e) => e.kind === k); return list.length ? <div key={k}><h4>{k === "흐름도" ? "Workflow 항목" : k === "메모" ? "History 메모" : LOG_KIND_LABEL[k]}</h4><ul>{list.map((e) => <EventRow key={e.id} e={e} />)}</ul></div> : null; })}
              </article>
            : <article className="log-doc">
                {day?.summary.state === "stale" ? <p className="log-warn">일일 기록이 요약 뒤에 바뀌었습니다 — 이 요약은 보고서 바탕에 들어가지 않습니다. 「요약 만들기」로 다시 요약하세요.</p> : null}
                {day?.summary.text ? <><code className="log-path">log/summaries/{selected}.md · 로컬 LLM</code><Markdown text={day.summary.text} /></> : <p className="log-muted">아직 요약이 없습니다. 「요약 만들기」를 누르면 로컬 모델이 이 날 기록만 읽고 요약합니다 (클라우드로 보내지 않음).</p>}
              </article>}
        </>}
      </section>
    </div>

    <section className="log-card log-index" aria-label="색인">
      <header className="log-card-head"><h3>색인</h3><small>{rows.length}건 · {cellDate ? fmt(cellDate) : viewLabel}{tagFilter ? ` · ${tagFilter}` : ""}{kindFilter ? ` · ${LOG_KIND_LABEL[kindFilter]}` : ""}</small><span className="log-grow" />
        <div className="log-filters">{tags.map((t) => <button key={t} type="button" aria-pressed={tagFilter === t} onClick={() => { setTagFilter(tagFilter === t ? null : t); setCellDate(null); }}><i style={{ background: tagColor(t) }} aria-hidden="true" />{t}</button>)}<span className="log-divider" aria-hidden="true" />{LOG_KINDS.map((k) => <button key={k} type="button" aria-pressed={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? null : k)}>{LOG_KIND_LABEL[k]}</button>)}</div>
      </header>
      <div className="log-table-scroll"><table>
        <thead><tr><th>날짜</th><th>시각</th><th>종류</th><th>변경</th><th>제목</th><th>태그</th><th>출처</th></tr></thead>
        <tbody>{rows.map((e) => <tr key={e.id} className={view !== "day" && e.date === selected ? "is-selected" : ""} onClick={() => { setSelected(e.date); }}>
          <td>{fmt(e.date)}</td><td>{e.time}</td><td><span className="log-kind">{LOG_KIND_LABEL[e.kind]}</span></td><td>{e.change}</td><td>{e.title}</td><td>{e.tags.length ? e.tags.map((t) => <TagChip key={t} tag={t} />) : <span className="log-muted">미분류</span>}</td>
          <td className="log-nowrap"><code className="log-id">{e.ref.type === "room" ? `방 ${e.ref.id} #${e.ref.fromSeq}–${e.ref.toSeq}` : e.ref.type === "commit" ? `git ${e.ref.id.slice(0, 7)}` : e.ref.type === "progress" ? "진행 보고" : e.ref.type === "memo" ? "History" : `${e.ref.type === "todo" ? "할일" : "흐름도"} ${e.ref.id.slice(0, 8)}`}</code></td>
        </tr>)}</tbody>
      </table>{!rows.length ? <p className="log-muted">걸러진 기록이 없습니다.</p> : null}</div>
    </section>

    {report ? <div className="log-modal" role="dialog" aria-modal="true" aria-label="보고서 바탕" onClick={(e) => { if (e.target === e.currentTarget) setReport(null); }}>
      <div className="log-modal-box">
        <header className="log-card-head"><h3>{report.name}</h3><small>{report.created ? "처음 만든 바탕 — 이제부터 사람이 고칩니다" : "이미 있는 파일 — 덮지 않고 열었습니다"}</small><span className="log-grow" /><button type="button" onClick={() => void navigator.clipboard?.writeText(report.file)}>파일 위치 복사</button><button type="button" onClick={download}>내려받기</button><button type="button" aria-label="닫기" onClick={() => setReport(null)}>닫기</button></header>
        <code className="log-path">{report.file}</code>
        <Markdown text={report.text} />
      </div>
    </div> : null}
  </section>;
}

export const LOG_OPEN_EVENT = "patchbay:open-log";
/** History 등 다른 칸에서 Log 의 그날을 연다. App 이 듣는다. */
export function openLogDate(date: string) {
  window.dispatchEvent(new CustomEvent(LOG_OPEN_EVENT, { detail: { date } }));
}
