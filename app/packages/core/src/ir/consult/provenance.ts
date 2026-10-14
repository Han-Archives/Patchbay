import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { projectStudioDir } from "../../studio/studioStore.js";

/**
 * 출처 — 초안의 한 칸이 어디서 왔나 (명세 20261006a §12.6).
 *
 * IR에 적지 않는다. 출처는 설계가 아니라 설계의 **이력**이다 — §3.1 「검사 결과를 IR에 적지 않는다」와
 * 같은 이유다. PRD(§14)가 줄마다 이걸 읽어 사람이 「해석 · 기본값」 줄을 먼저 보게 한다.
 */

export const PROVENANCE_FILE_NAME = "ir.provenance.yaml";
export const APPROVED_PROVENANCE_FILE_NAME = "ir.approved-provenance.json";
export const PROVENANCE_SOURCES = ["said", "inferred", "default", "manual"] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];
export const DRAFT_ORIGINS = ["consult", "survey", "manual"] as const;

export const provenanceEntrySchema = z.object({
  /** IR 경로 — `goal` · `requirements[2]` · `environment.language`. */
  path: z.string().min(1),
  source: z.enum(PROVENANCE_SOURCES),
  /** 상담 기록의 seq. 설문이면 문항 id, 직접 고치기면 없음. */
  turn: z.union([z.number().int().nonnegative(), z.string()]).optional(),
  /** 그 턴이 있는 상담 id — 끝낸 대화는 `consult/archive/` 에서 찾는다. 2026-10-08 전 기록에는 없다. */
  consult: z.string().optional(),
});
export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;

export const provenanceSchema = z.object({
  origin: z.enum(DRAFT_ORIGINS).optional(),
  entries: z.array(provenanceEntrySchema).default([]),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const EMPTY_PROVENANCE: Provenance = { entries: [] };

function file(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), PROVENANCE_FILE_NAME);
}

/** 없거나 깨졌으면 빈 출처 — 출처가 없으면 「해석」으로 보고 확인을 받는 쪽으로 기운다. */
export async function readProvenance(studioHome: string, alias: string): Promise<Provenance> {
  try {
    const parsed = provenanceSchema.safeParse(YAML.parse(await fs.readFile(file(studioHome, alias), "utf8")) ?? {});
    return parsed.success ? parsed.data : EMPTY_PROVENANCE;
  } catch {
    return EMPTY_PROVENANCE;
  }
}

/** 상담 초안이 바뀌어도 채택본의 출처는 바뀌지 않는다. 과거 채택에 스냅샷이 없으면 추정하지 않는다. */
export async function readApprovedProvenance(studioHome: string, alias: string, version: number): Promise<Provenance> {
  try {
    const snapshot = JSON.parse(await fs.readFile(path.join(projectStudioDir(studioHome, alias), APPROVED_PROVENANCE_FILE_NAME), "utf8"));
    return snapshot.version === version ? provenanceSchema.parse(snapshot.provenance) : EMPTY_PROVENANCE;
  } catch { return EMPTY_PROVENANCE; }
}

/** 같은 경로의 출처는 새것으로 바꾼다. 처음 만든 길(`origin`)은 처음 한 번만 정한다. */
export function mergeProvenance(
  current: Provenance,
  entries: readonly ProvenanceEntry[],
  origin?: Provenance["origin"],
): Provenance {
  const byPath = new Map(current.entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) byPath.set(entry.path, entry);
  return { origin: current.origin ?? origin, entries: [...byPath.values()] };
}

export async function writeProvenance(studioHome: string, alias: string, provenance: Provenance): Promise<void> {
  const target = file(studioHome, alias);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, YAML.stringify(provenance), "utf8");
}

/**
 * 한 경로의 출처. 정확히 같은 경로가 없으면 가장 긴 앞부분(`requirements[2].text` → `requirements[2]` →
 * `requirements`)을 쓴다. 아무것도 없으면 `inferred` — 확인받지 않은 것은 해석이다.
 */
export function sourceFor(provenance: Provenance, target: string): ProvenanceEntry {
  let best: ProvenanceEntry | undefined;
  for (const entry of provenance.entries) {
    const hit =
      entry.path === target || target.startsWith(`${entry.path}.`) || target.startsWith(`${entry.path}[`);
    if (hit && (!best || entry.path.length > best.path.length)) best = entry;
  }
  return best ?? { path: target, source: "inferred" };
}

/** 한 상담이 고친 칸 — 대화를 보관할 때 색인에 남긴다. 최상위 칸으로 묶는다: `requirements[3].text` → `requirements`. */
export function pathsTouchedBy(provenance: Provenance, consultId: string): string[] {
  return [...new Set(provenance.entries.filter((e) => e.consult === consultId).map((e) => e.path.split(/[.[]/)[0]!))].sort();
}
