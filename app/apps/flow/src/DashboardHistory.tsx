import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openLogDate } from "./ProjectLogPane.js";
import { historyMonthCells, historyRowDate, localHistoryDate, shiftHistoryMonth, type HistoryRow } from "./historyContract.js";

export function DashboardHistory({ project, revision }: { project: string; revision: number }) {
  const today = localHistoryDate(new Date());
  const [entries, setEntries] = useState<HistoryRow[]>([]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const tableScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(`/api/dashboard/history?alias=${encodeURIComponent(project)}`, { signal: controller.signal });
        const body = await res.json() as { entries?: HistoryRow[]; error?: string };
        if (!res.ok || !body.entries) throw new Error(body.error ?? "History를 불러오지 못했습니다.");
        if (!controller.signal.aborted) { setEntries(body.entries); setError(""); setLoading(false); }
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setLoading(false); } }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [project, revision]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) { const day = historyRowDate(entry); if (day) map.set(day, (map.get(day) ?? 0) + 1); }
    return map;
  }, [entries]);
  const monthly = useMemo(() => entries.filter(e => historyRowDate(e).startsWith(month + "-")).sort((a, b) => historyRowDate(b).localeCompare(historyRowDate(a)) || b.timestamp.localeCompare(a.timestamp)), [entries, month]);
  const shown = selected ? monthly.filter(e => historyRowDate(e) === selected) : monthly;
  useLayoutEffect(() => {
    const scroll = tableScroll.current;
    const table = scroll?.querySelector("table");
    if (!scroll || !table) return;
    const resize = () => {
      const rows = [...table.querySelectorAll("tbody tr")];
      const height = (table.tHead?.getBoundingClientRect().height ?? 0) + rows.slice(0, 5).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0);
      scroll.style.maxHeight = rows.length > 5 ? `${Math.ceil(height)}px` : "none";
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(table);
    return () => observer.disconnect();
  }, [shown]);
  useEffect(() => { if (tableScroll.current) tableScroll.current.scrollTop = 0; }, [selected, month]);
  const cells = historyMonthCells(month);
  function changeMonth(next: string) { if (historyMonthCells(next).length) { setMonth(next); setSelected(null); } }
  return <><section className="main-card history-card" aria-label="History">
    <header className="history-heading"><h3>History <span className="history-count">{shown.length}건</span></h3><div className="history-heading-actions">{selected ? <><button type="button" onClick={() => openLogDate(selected)}>Log에서 보기</button><button type="button" onClick={() => setSelected(null)}>월 전체</button></> : null}</div></header>
    {error ? <p className="flow-error" role="alert">{error}</p> : null}
      <div className="history-records" aria-live="polite"><div ref={tableScroll} className="history-table-scroll" tabIndex={shown.length ? 0 : undefined} aria-label="History 기록 목록"><table><thead><tr><th scope="col">날짜</th><th scope="col">태그</th><th scope="col">내용</th></tr></thead><tbody>{shown.map(entry => <tr key={entry.id}><td><time dateTime={historyRowDate(entry)}>{historyRowDate(entry).replaceAll("-", ".")}</time></td><td><div className="history-tags" title={entry.tags.join(" · ")}>{entry.tags.map(tag => <span key={tag} title={tag}>{tag}</span>)}</div></td><td><p title={entry.content}>{entry.content}</p></td></tr>)}</tbody></table></div>{loading ? <p className="main-empty" role="status">기록을 불러오는 중…</p> : !shown.length ? <p className="main-empty">{selected ? "선택한 날짜의 기록이 없습니다." : "이번 달의 기록이 없습니다."}</p> : null}</div>
  </section>
      <aside className="main-card history-calendar history-calendar-card" aria-label="월별 변경 기록 캘린더"><div className="history-calendar-month"><header><button type="button" aria-label="이전 달" onClick={() => changeMonth(shiftHistoryMonth(month, -1))}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="m13 4-6 6 6 6" /></svg></button><input aria-label="기록 월 선택" type="month" value={month} onChange={e => changeMonth(e.target.value)} /><button type="button" aria-label="다음 달" onClick={() => changeMonth(shiftHistoryMonth(month, 1))}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="m7 4 6 6-6 6" /></svg></button></header><div className="history-weekdays" aria-hidden="true">{"일월화수목금토".split("").map(day => <span key={day}>{day}</span>)}</div><div className="history-days">{cells.map((day, i) => day ? <button key={day} type="button" data-date={day} className={`history-day level-${Math.min(counts.get(day) ?? 0, 4)}${day === today ? " is-today" : ""}`} aria-label={`${day} · ${counts.get(day) ?? 0}건`} aria-pressed={selected === day} title={`${day} · ${counts.get(day) ?? 0}건`} onClick={() => setSelected(old => old === day ? null : day)}>{Number(day.slice(-2))}</button> : <span key={`empty-${i}`} />)}</div><div className="history-legend"><span>적음</span>{[0,1,2,3,4].map(level => <i key={level} className={`level-${level}`} aria-hidden="true" />)}<span>많음</span></div><p className="history-calendar-help">날짜를 누르면 그날의 변경 사항을 볼 수 있습니다.</p></div></aside></>;
}
