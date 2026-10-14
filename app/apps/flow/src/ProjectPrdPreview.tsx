import { useEffect, useState } from "react";
import type { PrdSection } from "@patchbay/core";
export function ProjectPrdPreview({ project, revision, onOpenDesign }: { project: string; revision: number; onOpenDesign: () => void }) {
  const [sections, setSections] = useState<PrdSection[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false; setSections([]); setIndex(0); setError(null); setLoading(true);
    fetch(`/api/prd?alias=${encodeURIComponent(project)}`).then(async res => { const body = await res.json(); if (!res.ok || body.error) throw new Error(body.error ?? "PRD 조회 실패"); if (!cancelled) setSections(body.sections ?? []); }).catch(e => { if (!cancelled) setError(String(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project, revision]);
  const section = sections[index];
  return <div className="hub-prd-preview">{loading ? <p role="status">PRD 불러오는 중</p> : error ? <p className="flow-error">{error}</p> : section ? <><label>PRD 절 <select aria-label="PRD 절 선택" value={index} onChange={e => setIndex(Number(e.target.value))}>{sections.map((s,i) => <option key={s.n} value={i}>{s.n}. {s.title}</option>)}</select></label><article><h4>{section.n}. {section.title}</h4>{section.lines.map((line,i) => <p key={i}>{line.detail ?? line.text}</p>)}</article></> : <p>아직 PRD가 없습니다. 설계에서 상담을 시작하세요.</p>}<footer><span>현재 설계 초안의 PRD</span><button className="flow-btn" onClick={onOpenDesign}>설계에서 검토 ↗</button></footer></div>;
}
