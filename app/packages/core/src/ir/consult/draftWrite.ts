import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { irValueDigest } from "../valueDigest.js";
import { withFileLock } from "../../rooms/store.js";
import { readOverlay } from "../../studio/projectFiles.js";
import { projectStudioDir } from "../../studio/studioStore.js";
import { PROPOSED_IR_FILE_NAME } from "../../studio/irStore.js";
import {
  IR_SCHEMA_VERSION,
  irEnvironmentSchema,
  irInterfaceSchema,
  irSchema,
  irWhySchema,
} from "../../types/ir.js";
import type { z } from "zod";
import { mergeProvenance, readProvenance, writeProvenance, type ProvenanceEntry, type ProvenanceSource } from "./provenance.js";

/**
 * 상담이 초안을 쓰는 유일한 길 — MCP `consult_update` (명세 20261006a §13.4).
 *
 * - `ir.proposed.yaml` 과 `ir.provenance.yaml` 만 쓴다. `overlay.ir` 는 쓰지 않는다 (§2.3 유일 경로).
 * - **모르는 키는 거절한다.** 받아 두면 파싱 때 zod가 조용히 버린다 (§3.9) — 호스트는 썼다고 믿고
 *   사람은 PRD에서 그 내용을 영영 못 본다.
 * - 형식 검사(DRC)는 하지 않는다. 초안은 미완성이 정상이다 — 검사는 채택 때다.
 *
 * 합치는 법: 최상위 키 단위. 객체 칸(`why` · `environment` · `interface`)은 안쪽 키를 합치고, 배열과
 * 글은 통째로 바꾼다 — 배열의 일부만 고치는 문법을 두면 호스트마다 다르게 쓴다.
 */

const OBJECT_KEYS: Record<string, readonly string[]> = {
  why: Object.keys(irWhySchema.shape),
  environment: Object.keys(irEnvironmentSchema.shape),
  interface: Object.keys(irInterfaceSchema.shape),
};
const TOP_KEYS = Object.keys(irSchema.shape);
/** 상담이 바꾸지 않는 키 — 형식 버전과 설계 반복 번호는 Patchbay가 정한다. */
const LOCKED_KEYS = new Set(["schemaVersion", "version"]);

export interface ConsultPatchInput {
  /** 편집기가 본 초안과 같은 내용에만 적용한다. */
  expectedDraftDigest?: string;
  patch: Record<string, unknown>;
  /** 칸마다 출처. 경로를 빼면 patch의 최상위 키가 `inferred` 로 남는다. */
  provenance?: { path: string; source: ProvenanceSource }[];
  /** 상담 기록의 seq — 출처의 근거 턴. */
  turn?: number;
  /** 어느 상담인가 — 대화를 끝내 보관하면 seq 만으로는 어느 대화의 턴인지 모른다. */
  consult?: string;
}

export type ConsultPatchResult =
  | { ok: true; written: string[]; file: string; warnings: string[] }
  | { ok: false; error: string; unknown: string[] };

function closest(key: string, candidates: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  return candidates.find((c) => c.toLowerCase() === lower || c.toLowerCase().startsWith(lower.slice(0, 4)));
}

export function validateConsultPatch(patch: Record<string, unknown>): string[] {
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!TOP_KEYS.includes(key) || LOCKED_KEYS.has(key)) {
      const near = closest(key, TOP_KEYS);
      unknown.push(LOCKED_KEYS.has(key) ? `${key} (Patchbay가 정하는 키)` : near ? `${key} (혹시 ${near}?)` : key);
      continue;
    }
    const inner = OBJECT_KEYS[key];
    if (inner && value && typeof value === "object" && !Array.isArray(value)) {
      for (const sub of Object.keys(value as Record<string, unknown>)) {
        if (!inner.includes(sub)) {
          const near = closest(sub, inner);
          unknown.push(near ? `${key}.${sub} (혹시 ${key}.${near}?)` : `${key}.${sub}`);
        }
      }
    }
  }
  return unknown;
}

/**
 * 호스트가 한국어 표시명으로 쓴 정해진 값을 계약 값으로 바꾼다 (2026-10-07, 실제 상담에서 「항상」「꼭」이 들어왔다).
 * 화면이 쓰는 표시명과 같은 낱말만 받는다 — 짐작으로 넓히지 않는다. 바꾸지 못한 값은 검사가 거절한다.
 */
const ALIASES: Record<string, Record<string, string>> = {
  pattern: { 항상: "ubiquitous", "~하면": "event", 하면: "event", "~인 동안": "state", "인 동안": "state", 동안: "state", 잘못되면: "unwanted", 있으면: "optional" },
  priority: { 꼭: "must", 필수: "must", "있으면 좋음": "should", 나중에: "could" },
  reqKind: { 기능: "functional", 품질: "quality", 제약: "constraint" },
  riskLevel: { 낮음: "low", 작음: "low", 중간: "medium", 높음: "high", 큼: "high" },
  autonomy: { 제안만: "suggest", "확인 뒤 실행": "approve", "실행하고 알림": "notify", "끝까지 스스로": "full" },
  memory: { "기억하지 않음": "none", "이번 대화 안에서만": "thread", "계속 기억": "long" },
  evalKind: { 결정적: "deterministic", 모델: "model" },
  cardinality: { "정확히 하나": "one", "없거나 하나": "optional", 여럿: "many" },
};
const TERMINALS: Record<string, string> = { 시작: "__start__", start: "__start__", START: "__start__", 끝: "__end__", 종료: "__end__", end: "__end__", END: "__end__" };
const terminal = (value: unknown): unknown => (typeof value === "string" ? (TERMINALS[value.trim()] ?? value) : value);

const alias = (table: string, value: unknown): unknown =>
  typeof value === "string" ? (ALIASES[table]?.[value.trim()] ?? value) : value;

export function normalizeConsultPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch };
  const mapItems = (key: string, fn: (item: Record<string, unknown>) => Record<string, unknown>) => {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map((item) => (item && typeof item === "object" ? fn({ ...(item as Record<string, unknown>) }) : item));
  };
  mapItems("requirements", (r) => ({ ...r, pattern: alias("pattern", r.pattern), ...(r.priority !== undefined ? { priority: alias("priority", r.priority) } : {}), ...(r.kind !== undefined ? { kind: alias("reqKind", r.kind) } : {}) }));
  mapItems("evals", (e) => ({ ...e, kind: alias("evalKind", e.kind ?? "deterministic") }));
  mapItems("relations", (r) => ({ ...r, cardinality: alias("cardinality", r.cardinality) }));
  for (const key of ["riskLevel", "autonomy", "memory"] as const) if (key in out) out[key] = alias(key, out[key]);
  // 시작 · 끝은 예약 id다 — 「시작」 「끝」 「start」라고 써도 같은 뜻으로 받는다 (2026-10-07, 실제 상담에서 걸렸다).
  mapItems("edges", (e) => ({ ...e, from: terminal(e.from), to: terminal(e.to) }));
  return out;
}

const ALLOWED_HINT: Record<string, string> = {
  pattern: "ubiquitous · event · state · unwanted · optional",
  priority: "must · should · could",
  entry: "chat · cli · web · console · api · schedule",
  kind: "칸마다 정해진 값 — 명세 20261006a §3",
};

/** 칸 단위 형식 검사. 객체 칸은 일부만 와도 된다(합치니까). 배열 · 글은 통째로 맞아야 한다. */
export function validateConsultValues(patch: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const shape = irSchema.shape as Record<string, z.ZodTypeAny>;
  const partials: Record<string, z.ZodTypeAny> = {
    why: irWhySchema.partial(),
    environment: irEnvironmentSchema.partial(),
    interface: irInterfaceSchema.partial(),
  };
  for (const [key, value] of Object.entries(patch)) {
    const schema = partials[key] ?? shape[key];
    if (!schema) continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues.slice(0, 4)) {
      const where = [key, ...issue.path.map(String)].join(".");
      const last = String(issue.path.at(-1) ?? key);
      const hint = ALLOWED_HINT[last] ? ` — 쓸 수 있는 값: ${ALLOWED_HINT[last]}` : "";
      problems.push(`${where}: ${issue.message}${hint}`);
    }
  }
  return problems;
}

/** 형식은 맞지만 사람이 PRD에서 헷갈릴 것 — 쓰기는 하고 호스트에게 알린다. */
export function consultPatchWarnings(patch: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const goal = patch.goal;
  if (typeof goal === "string" && (goal.length > 140 || /(^|\s)(\d+[.)]|[①-⑩])\s/.test(goal) || (goal.match(/,|·/g)?.length ?? 0) >= 4)) {
    warnings.push("goal 은 목적 한 문장이다. 사람이 말한 기능 · 요구 목록은 requirements 에 한 줄씩 나눠 써라 (지금 goal 이 목록처럼 길다).");
  }
  if (Array.isArray(patch.requirements)) {
    const reqs = patch.requirements as { id?: string; summary?: unknown }[];
    const missing = reqs.filter((r) => typeof r.summary !== "string" || !r.summary.trim()).map((r) => r.id ?? "?");
    const long = reqs.filter((r) => typeof r.summary === "string" && r.summary.length > 25).map((r) => r.id ?? "?");
    if (missing.length) warnings.push(`requirements 의 summary(화면에 보이는 25자 안쪽 한 줄, 「시스템은」 없이)가 없다: ${missing.join(", ")}. 붙여서 다시 써라.`);
    if (long.length) warnings.push(`summary 가 25자를 넘는다: ${long.join(", ")}. 더 짧게.`);
  }
  return warnings;
}

export async function applyConsultPatch(
  studioHome: string,
  alias: string,
  input: ConsultPatchInput,
): Promise<ConsultPatchResult> {
  await fs.mkdir(projectStudioDir(studioHome, alias), { recursive: true });
  return withFileLock(path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME), () => applyConsultPatchLocked(studioHome, alias, input));
}

async function applyConsultPatchLocked(
  studioHome: string,
  alias: string,
  input: ConsultPatchInput,
): Promise<ConsultPatchResult> {
  const unknown = validateConsultPatch(input.patch);
  if (unknown.length) {
    return {
      ok: false,
      unknown,
      error: `모르는 칸이라 쓰지 않았다: ${unknown.join(", ")}. IR 칸 이름은 명세 20261006a §3을 따른다.`,
    };
  }
  const patch = normalizeConsultPatch(input.patch);
  const invalid = validateConsultValues(patch);
  if (invalid.length) {
    return {
      ok: false,
      unknown: invalid,
      error: `형식이 맞지 않아 쓰지 않았다 — ${invalid.join(" / ")}. 고쳐서 다시 부른다.`,
    };
  }
  const file = path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME);
  let draft: Record<string, unknown>;
  try {
    const parsed = YAML.parse(await fs.readFile(file, "utf8"));
    draft = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, error: "초안을 읽지 못했습니다. 기존 내용을 복구한 뒤 다시 저장해주세요.", unknown: [] };
    draft = { ...((await readOverlay(studioHome, alias)).ir ?? {}) };
  }
  if (input.expectedDraftDigest && input.expectedDraftDigest !== irValueDigest(draft)) return { ok: false, error: "설계가 변경되었습니다. 새로고침 후 다시 저장해주세요.", unknown: [] };
  draft.schemaVersion ??= IR_SCHEMA_VERSION;
  draft.version ??= 1;
  draft.project ??= alias;

  // 배열 순서가 바뀌어도 근거는 ID에 남는다. 수정된 요구사항만 이번 대화의 턴에 연결한다.
  if (Array.isArray(patch.requirements) && input.consult) {
    const prior = new Map((Array.isArray(draft.requirements) ? draft.requirements : []).map((r: Record<string, unknown>) => [r.id, r]));
    patch.requirements = patch.requirements.map((value: unknown) => {
      if (!value || typeof value !== "object") return value;
      const r = value as Record<string, unknown>, old = prior.get(r.id);
      if (JSON.stringify(old) === JSON.stringify(r)) return r;
      return { ...r, sourceRef: { kind: "consult", id: input.consult, ...(input.turn !== undefined ? { turn: input.turn } : {}) } };
    });
  }

  for (const [key, value] of Object.entries(patch)) {
    const current = draft[key];
    if (OBJECT_KEYS[key] && value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object") {
      draft[key] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      draft[key] = value;
    }
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, YAML.stringify(draft), "utf8");

  const given = new Map((input.provenance ?? []).map((entry) => [entry.path, entry.source]));
  const entries: ProvenanceEntry[] = [];
  for (const key of Object.keys(input.patch)) if (![...given.keys()].some((p) => p === key || p.startsWith(`${key}.`) || p.startsWith(`${key}[`))) given.set(key, "inferred");
  for (const [entryPath, source] of given) {
    entries.push({
      path: entryPath,
      source,
      ...(input.turn !== undefined ? { turn: input.turn } : {}),
      ...(input.consult ? { consult: input.consult } : {}),
    });
  }
  await writeProvenance(studioHome, alias, mergeProvenance(await readProvenance(studioHome, alias), entries, "consult"));
  return { ok: true, written: Object.keys(patch), file, warnings: consultPatchWarnings(patch) };
}
