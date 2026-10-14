import { SidebarIcon } from "./SidebarIcon.js";
import { useEffect, useRef, useState } from "react";
import type { StageId } from "./workspaceContract.js";
export type ProjectDestination = StageId | "plan" | "board" | "architecture" | "files" | "log";
/** 레일 도구. 지식 그래프 · 문서 호출은 단계가 아니라 도구라 「…」 밖에 바로 둔다 (2026-10-12). */
export function ProjectTools({ place, onNavigate }: { place: string; onNavigate: (id: ProjectDestination) => void }) {
  const [more, setMore] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!more) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setMore(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [more]);
  function go(id: ProjectDestination) { setMore(false); onNavigate(id); }
  return <aside className="project-tools" ref={root}><nav aria-label="프로젝트 전체 도구">{([['dashboard','메인 화면'],['architecture','아키텍처'],['files','폴더 · 문서'],['plan','기획'],['graph','지식 그래프'],['docs','문서 호출'],['log','Log · 진행 기록']] as const).map(([id, label]) => <button key={id} type="button" title={label} aria-label={label} aria-pressed={place === id} onClick={() => go(id)}><SidebarIcon name={id} /></button>)}<button type="button" title="추가 기능" aria-label="추가 기능" aria-expanded={more} aria-controls="project-more-tools" onClick={() => setMore(!more)}><SidebarIcon name="more" /></button></nav>{more ? <div id="project-more-tools" className="project-more-tools" role="dialog" aria-label="추가 프로젝트 기능"><header><b>추가 기능</b><button aria-label="추가 기능 닫기" onClick={() => setMore(false)}>×</button></header>{([['run','운영'],['design','설계'],['build','구현'],['board','배치도']] as const).map(([id,label]) => <button key={id} onClick={() => go(id)}>{label}<span>↗</span></button>)}</div> : null}</aside>;
}
