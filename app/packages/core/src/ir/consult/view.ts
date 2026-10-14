import { readProposedIr } from "../../studio/irStore.js";
import { consultProgress, type ConsultProgress } from "./catalog.js";
import { readProvenance, type Provenance } from "./provenance.js";
import { renderPrd, type PrdSection } from "./prd.js";
import { buildArchitecture, type Architecture } from "./architecture.js";
import { draftFormatProblems, type FormatProblem } from "./formatProblems.js";
import { prdReviewStatus, readPrdReview, type PrdReviewStatus } from "./review.js";

export type LoadPrdResult =
  | { ok: true; sections: PrdSection[]; review: PrdReviewStatus; progress: ConsultProgress; provenance: Provenance; architecture: Architecture; format: FormatProblem[] }
  | { ok: false; error: string };

/**
 * 초안 하나에서 PRD · 검토 상태 · 상담 진행을 함께 읽는다 — CLI `ir prd` · MCP `get_prd` · 콘솔이
 * 같은 함수를 부른다 (명세 20261006a §14.3, 원칙 8). 초안이 없으면 PRD도 없다.
 */
export async function loadPrd(studioHome: string, alias: string): Promise<LoadPrdResult> {
  const read = await readProposedIr(studioHome, alias);
  if (!read.ok) return { ok: false, error: read.error };
  const provenance = await readProvenance(studioHome, alias);
  const sections = renderPrd(read.raw, provenance);
  const review = prdReviewStatus(sections, await readPrdReview(studioHome, alias));
  return { ok: true, sections, review, progress: consultProgress(read.raw), provenance, architecture: buildArchitecture(read.raw), format: draftFormatProblems(read.raw) };
}

const SOURCE_MARK: Record<string, string> = { said: "말함", inferred: "해석", default: "기본값", manual: "직접" };

/** 사람이 읽는 PRD — CLI가 쓴다. 출처를 줄 앞에 둔다: 해석 · 기본값을 먼저 보라고. */
export function prdToText(sections: readonly PrdSection[], review?: PrdReviewStatus): string[] {
  const lines: string[] = [];
  for (const section of sections) {
    const state = review?.sections.find((s) => s.n === section.n);
    const mark = state ? (state.state === "ok" ? " ✅" : state.state === "fix" ? " ✏️" : state.stale ? " ↺" : "") : "";
    lines.push(`${section.n}. ${section.title}${mark}`);
    for (const line of section.lines) lines.push(`   [${SOURCE_MARK[line.source] ?? line.source}] ${line.text}`);
    lines.push("");
  }
  return lines;
}
