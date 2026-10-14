import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { projectStudioDir } from "../../studio/studioStore.js";
import type { PrdSection } from "./prd.js";

/**
 * PRD 검토 — 절마다 「맞아요 / 고쳐 주세요」 (명세 20261006a §14.2).
 *
 * 무효 전파를 따로 계산하지 않는다. 절의 지문(그린 줄들의 해시)을 같이 적어 두고, 내용이 바뀌어
 * 지문이 달라지면 그 절은 「확인 전」으로 돌아간다 — 흔들린 절만 다시 묻는다.
 */

export const REVIEW_FILE_NAME = "ir.review.yaml";
export const REVIEW_STATES = ["ok", "fix"] as const;

const reviewEntrySchema = z.object({
  state: z.enum(REVIEW_STATES),
  at: z.string(),
  digest: z.string(),
  note: z.string().optional(),
});
export const reviewSchema = z.object({ sections: z.record(z.string(), reviewEntrySchema).default({}) });
export type PrdReview = z.infer<typeof reviewSchema>;
export type PrdReviewEntry = z.infer<typeof reviewEntrySchema>;

/** 화면이 보는 절의 지금 — `pending` 은 확인 전이거나, 확인했는데 내용이 바뀌었다. */
export type PrdSectionReviewState = "ok" | "fix" | "pending";

export interface PrdReviewStatus {
  sections: { n: number; state: PrdSectionReviewState; note?: string; stale: boolean }[];
  /** 11절 모두 `ok` — 콘솔 채택 버튼의 조건 하나 (다른 하나는 검사 통과). */
  allOk: boolean;
}

function file(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), REVIEW_FILE_NAME);
}

export async function readPrdReview(studioHome: string, alias: string): Promise<PrdReview> {
  try {
    const parsed = reviewSchema.safeParse(YAML.parse(await fs.readFile(file(studioHome, alias), "utf8")) ?? {});
    return parsed.success ? parsed.data : { sections: {} };
  } catch {
    return { sections: {} };
  }
}

export function prdReviewStatus(sections: readonly PrdSection[], review: PrdReview): PrdReviewStatus {
  const out = sections.map((section) => {
    const entry = review.sections[String(section.n)];
    if (!entry) return { n: section.n, state: "pending" as const, stale: false };
    if (entry.digest !== section.digest) return { n: section.n, state: "pending" as const, stale: true };
    return { n: section.n, state: entry.state, stale: false, ...(entry.note ? { note: entry.note } : {}) };
  });
  return { sections: out, allOk: out.length > 0 && out.every((s) => s.state === "ok") };
}

export type MarkPrdSectionResult = { ok: true; review: PrdReview } | { ok: false; error: string };

/** 한 절을 표시한다. 지금 그린 지문을 같이 적는다 — 사람이 본 내용에 대한 판정이라서. */
export async function markPrdSection(
  studioHome: string,
  alias: string,
  sections: readonly PrdSection[],
  input: { n: number; state: (typeof REVIEW_STATES)[number]; note?: string },
  now: () => Date = () => new Date(),
): Promise<MarkPrdSectionResult> {
  const section = sections.find((s) => s.n === input.n);
  if (!section) return { ok: false, error: `PRD에 ${input.n}절이 없다 (1~${sections.length}).` };
  if (input.state === "fix" && !input.note?.trim()) {
    return { ok: false, error: "무엇을 고칠지 한 줄을 적어 주세요 — 그 말이 상담으로 간다." };
  }
  const review = await readPrdReview(studioHome, alias);
  review.sections[String(input.n)] = {
    state: input.state,
    at: now().toISOString(),
    digest: section.digest,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  const target = file(studioHome, alias);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, YAML.stringify(review), "utf8");
  return { ok: true, review };
}
