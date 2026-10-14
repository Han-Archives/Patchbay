import fs from "node:fs";
import path from "node:path";
import type { Ir } from "../types/ir.js";
import { CAP_IDS, EARS_PATTERNS, IR_REDUCERS, RESERVED_NODE_IDS, SCAFFOLD_LANGUAGES } from "../types/ir.js";

import { invalidatedGates } from "./invalidation.js";

/**
 * 1.9 설계 규칙 검사 (DRC) -- 명세 20261006a §7.1.
 *
 * Deterministic, no model call, no network (기획서 원칙 5). The two checks that
 * touch the filesystem are skipped rather than failed when no document root is
 * given, so the same list runs against a bare IR in a unit test and against a
 * real project on disk.
 *
 * Regression is measured by *which check failed and which cell to return to*,
 * never by a pass count -- the list changes, so "14/17" stops meaning anything
 * the moment a check is added (채택값 18).
 */

export interface IrCheckResult {
  /** Stable id, `<gate>/<name>`. This is what a regression test pins. */
  id: string;
  gate: string;
  /** `null` = not judged (skipped), and never counted as a pass. */
  ok: boolean | null;
  note: string;
}

export interface IrCheckSummary {
  passed: boolean;
  checks: IrCheckResult[];
  failed: string[];
  failedGates: string[];
  invalidated: string[];
  skipped: string[];
}

export interface IrCheckContext {
  /** Absolute path the IR's document paths are relative to. Omitted -> 1.6's two file checks skip. */
  docRoot?: string;
  /** Injectable for tests; defaults to the real filesystem. */
  fileExists?: (absolute: string) => boolean;
  /** Markdown files directly in one directory. Defaults to the real filesystem. */
  listMarkdown?: (absoluteDir: string) => string[];
}

const defaultFileExists = (absolute: string): boolean => fs.existsSync(absolute);
const defaultListMarkdown = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
};

/** Everything reachable from `seed` along `edges`, forwards or backwards. */
function closure(edges: ReadonlyArray<readonly [string, string]>, seed: string[], forward: boolean): Set<string> {
  const seen = new Set(seed);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of edges) {
      const [from, to] = forward ? [a, b] : [b, a];
      if (seen.has(from) && !seen.has(to)) {
        seen.add(to);
        grew = true;
      }
    }
  }
  return seen;
}

/** 재지 못하는 말 — 요구사항 문장에 있으면 무엇이 통과인지 정할 수 없다. */
export const VAGUE_TERMS: RegExp[] = [
  /적절(히|한)/, /빠르게/, /충분(히|한)/, /가능하면/, /가급적/, /최대한/, /대략/, /쉽게/, /사용자 친화/,
  /(^|\s)등(\s|\.|$)/, /\b(appropriate|as needed|user-friendly|etc|fast|easy)\b/i,
];

export function runIrChecks(ir: Ir, context: IrCheckContext = {}): IrCheckResult[] {
  const fileExists = context.fileExists ?? defaultFileExists;
  const listMarkdown = context.listMarkdown ?? defaultListMarkdown;
  const out: IrCheckResult[] = [];
  const check = (id: string, ok: boolean, note = ""): void => {
    out.push({ id, gate: id.split("/")[0]!, ok, note });
  };
  const skip = (id: string, note: string): void => {
    out.push({ id, gate: id.split("/")[0]!, ok: null, note });
  };

  const declaredCaps = new Set(ir.caps.map((cap) => cap.id));
  const capById = new Map(ir.caps.map((cap) => [cap.id as string, cap]));
  const nodeIds = new Set(ir.nodes.map((node) => node.id));
  const fields = new Set(ir.state.map((entry) => entry.field));
  const evalIds = new Set(ir.evals.map((entry) => entry.id));
  const requirementIds = new Set(ir.requirements.map((entry) => entry.id));
  const docIds = new Set(ir.documents.map((entry) => entry.id));

  // ── 0.0 온톨로지 — 다른 칸이 낱말을 고르는 바닥 ──────────────
  const conceptIds = ir.concepts.map((concept) => concept.id);
  const conceptSet = new Set(conceptIds);
  check(
    "0.0/input-output",
    ir.concepts.some((c) => c.kind === "input") && ir.concepts.some((c) => c.kind !== "input" && c.kind !== "internal"),
    `개념 ${ir.concepts.length}개`,
  );
  const dupConcepts = conceptIds.filter((id, i) => conceptIds.indexOf(id) !== i);
  check("0.0/concept-unique", dupConcepts.length === 0, dupConcepts.join(", "));
  const thinEnums = ir.concepts.filter((c) => c.kind === "enum" && c.values.length < 2).map((c) => c.id);
  check("0.0/enum-values", thinEnums.length === 0, thinEnums.join(", "));
  const looseRelations = ir.relations
    .filter((r) => !conceptSet.has(r.from) || !conceptSet.has(r.to))
    .map((r) => `${r.from}→${r.to}`);
  check("0.0/relation-ends", looseRelations.length === 0, looseRelations.join(", "));
  // 역량 질문은 0층의 관계로 답할 수 있어야 한다 — 답할 길이 없는 질문은 온톨로지의 구멍이다.
  const related = new Set(ir.relations.map((r) => `${r.from}>${r.to}`));
  const unanswerable = ir.competencyQuestions.filter((q) => !related.has(`${q.from}>${q.to}`)).map((q) => q.id);
  check("0.0/cq-answerable", unanswerable.length === 0, unanswerable.join(", "));

  // ── 1.0 · 1.1 ────────────────────────────────────────────
  check("1.0/verdict", ir.why.verdict.trim().length > 0);
  check("1.1/done-judgeable", ir.done.length > 0, `${ir.done.length}개`);
  // 지표는 목표치가 있어야 잰다 (Volere 적합 기준).
  const vagueMetrics = ir.metrics.filter((m) => !m.target.trim()).map((m) => m.id);
  check("1.1/metric-target", vagueMetrics.length === 0, vagueMetrics.join(", "));

  // ── 1.2 권한 ─────────────────────────────────────────────
  check(
    "1.2/tool-caps",
    ir.tools.every((tool) => tool.caps.length > 0 && tool.caps.every((cap) => declaredCaps.has(cap))),
    `툴 ${ir.tools.length}개`,
  );
  // 모델 필요성은 why.needsModel 로 판정한다. 결론 문장을 정규식으로 훑지 않는다.
  check("1.2/model-declared", !(ir.why.needsModel && ir.models.length === 0), `models ${ir.models.length}개`);
  check("1.2/model-caps", ir.models.every((model) => model.caps.every((cap) => declaredCaps.has(cap))));
  // 선언만 하고 아무 노드도 부르지 않는 모델은 2.4가 어느 노드에 어댑터를 꽂을지 모른다 (2026-10-08, 수락 시험 프로젝트 v1에서 4개 모두 빈 칸).
  const modelUsers = new Map(ir.models.map((model) => [model.id, new Set(model.usedBy)]));
  for (const node of ir.nodes) for (const id of node.models) modelUsers.get(id)?.add(node.id);
  const unusedModels = ir.models.filter((model) => modelUsers.get(model.id)!.size === 0).map((m) => m.id);
  check("1.2/model-used", unusedModels.length === 0, unusedModels.join(", "));
  check(
    "1.2/irreversible-approval",
    ir.tools.every((tool) => !tool.irreversible || tool.caps.every((cap) => capById.get(cap)?.humanApproval === true)),
  );
  check(
    "1.2/caps-known",
    ir.caps.every((cap) => (CAP_IDS as readonly string[]).includes(cap.id)),
    [...declaredCaps].join(" "),
  );

  // 틀리면 사람에게 피해가 가는 일을 사람 확인 없이 끝까지 하지 않는다 (EU AI Act 사람 감독 · NIST).
  check(
    "1.2/oversight",
    !(ir.riskLevel === "high" && ir.autonomy === "full"),
    ir.riskLevel ? `피해 ${ir.riskLevel} · 자율 ${ir.autonomy ?? "-"}` : "",
  );

  // 3판 — 실행 환경. 사람이 고칠 수 있는 것은 언어 칸이지 생성기가 아니다.
  // 「TypeScript」 「typescript」 「TS」는 같은 말이다 — 대소문자로 막지 않는다 (2026-10-07, 실제 상담에서 걸렸다).
  const rawLanguage = (ir.environment?.language ?? "typescript").trim().toLowerCase();
  const language = rawLanguage === "ts" ? "typescript" : rawLanguage;
  check(
    "1.2/env-language",
    (SCAFFOLD_LANGUAGES as readonly string[]).includes(language),
    (SCAFFOLD_LANGUAGES as readonly string[]).includes(language)
      ? language
      : `${language} — Patchbay의 2 구현 생성기는 아직 TypeScript만 낸다`,
  );
  // 원격 그래프는 콘솔 쪽 터널 주소로만 닿는다 — 콘솔의 LangGraph 주소는 하나다.
  const remote = ir.environment?.location === "remote";
  check(
    "1.2/remote-tunnel",
    !remote || Boolean(ir.environment?.remote?.host?.trim() && ir.environment.remote.tunnel?.trim()),
    remote ? `원격 ${ir.environment?.remote?.host ?? "(호스트 없음)"}` : "",
  );

  // ── 1.3 정보 경계 ────────────────────────────────────────
  const graded = [...ir.reads, ...ir.emits, ...ir.documents];
  check("1.3/read-level", graded.every((entry) => Number.isInteger(entry.level)), `${graded.length}개`);
  check("1.3/no-l4", !graded.some((entry) => entry.level >= 4));
  check("1.3/external-cap", !ir.emits.some((emit) => emit.to === "external") || declaredCaps.has("cap:external"));
  // 3판 — 프로젝트 DB에 쓰는 것은 진짜 쓰기다. 어디에 쓰는지도 적혀 있어야 한다.
  const dbEmits = ir.emits.filter((emit) => emit.to === "db");
  check(
    "1.3/db-cap",
    dbEmits.length === 0 || (declaredCaps.has("cap:pr") && dbEmits.every((emit) => Boolean(emit.where?.trim()))),
    dbEmits.length ? `DB ${dbEmits.length}건` : "",
  );
  // 3판 — 밖으로 나가는 도구는 무엇으로 열리는지(값이 아니라 자리)가 있어야 한다.
  const outbound = ir.tools.filter((tool) => tool.caps.includes("cap:external") || tool.via === "mcp").map((t) => t.id);
  check(
    "1.3/external-credential",
    outbound.length === 0 || ir.credentials.length > 0,
    outbound.length ? `밖으로 나가는 도구: ${outbound.join(", ")} · 자격 증명 ${ir.credentials.length}개` : "",
  );

  // ── 1.4 넷리스트 ─────────────────────────────────────────
  check(
    "1.4/reducer-default",
    ir.state.every((entry) => (IR_REDUCERS as readonly string[]).includes(entry.reducer) && entry.default !== undefined),
    `${ir.state.length}칸`,
  );
  check("1.4/custom-ref", ir.state.every((entry) => entry.reducer !== "custom" || Boolean(entry.reducerRef)));
  // 값이 개념을 가리키면 그 개념은 0층에 있어야 한다 — 칸끼리 다른 낱말을 쓰지 않게.
  const strayConcepts = ir.state.filter((entry) => entry.concept && !conceptSet.has(entry.concept)).map((e) => e.field);
  check("1.4/concept-known", strayConcepts.length === 0, strayConcepts.join(", "));
  // 받는 것을 담는 칸이 없으면 2.3 시험이 입력을 넣을 곳이 없다 — 시험이 주석으로만 남는다.
  const inputConcepts = new Set(ir.concepts.filter((c) => c.kind === "input").map((c) => c.id));
  const inputFields = ir.state.filter((entry) => entry.concept && inputConcepts.has(entry.concept)).map((e) => e.field);
  check("1.4/input-field", inputFields.length > 0, inputFields.join(", "));

  // ── 1.5 회로 ─────────────────────────────────────────────
  const unknownFields: string[] = [];
  for (const node of ir.nodes) {
    for (const field of [...node.reads, ...node.writes]) {
      if (!fields.has(field)) unknownFields.push(`${node.id}:${field}`);
    }
  }
  check("1.5/known-fields", unknownFields.length === 0, unknownFields.join(", "));
  // 아무것도 읽지 않는 노드는 앞 단계와 끊긴 것이다 — 첫 노드도 받는 것을 읽는다.
  const blind = ir.nodes.filter((node) => node.reads.length === 0).map((node) => node.id);
  check("1.5/node-reads", blind.length === 0, blind.join(", "));
  const touched = new Set(ir.nodes.flatMap((node) => [...node.reads, ...node.writes]));
  const orphans = [...fields].filter((field) => !touched.has(field));
  check("1.5/no-orphan-field", orphans.length === 0, orphans.join(", "));

  const edges = ir.edges.map((edge) => [edge.from, edge.to] as const);
  const [START, END] = RESERVED_NODE_IDS;
  const reachable = closure(edges, [START], true);
  const canEnd = closure(edges, [END], false);
  const unreachable = [...nodeIds].filter((id) => !reachable.has(id));
  const dead = [...nodeIds].filter((id) => !canEnd.has(id));
  check("1.5/reachable", unreachable.length === 0, unreachable.join(", "));
  check("1.5/can-end", dead.length === 0, dead.join(", "));

  // ── 1.6 문서 의존 ────────────────────────────────────────
  check("1.6/node-exists", ir.documents.every((doc) => nodeIds.has(doc.node)));
  const docRefs = ir.nodes.flatMap((node) => node.documents);
  check("1.6/doc-ref-exists", docRefs.every((ref) => docIds.has(ref)), `노드가 가리키는 문서 ${docRefs.length}개`);

  if (context.docRoot) {
    const root = context.docRoot;
    const missing = ir.documents.map((doc) => doc.path).filter((rel) => !fileExists(path.join(root, rel)));
    check(
      "1.6/doc-exists",
      missing.length === 0,
      `${ir.documents.length}개 확인${missing.length ? ` · 없음: ${missing.join(", ")}` : ""}`,
    );
    // 후보 풀은 선언된 문서들이 실제로 사는 폴더들의 합집합이다.
    const folders = [...new Set(ir.documents.map((doc) => path.dirname(doc.path)))];
    const pool = folders.reduce((total, folder) => total + listMarkdown(path.join(root, folder)).length, 0);
    const used = new Set(ir.documents.map((doc) => doc.path)).size;
    check("1.6/doc-coverage", used * 2 >= pool, `후보 ${pool}개 중 ${used}개를 쓴다`);
  } else {
    skip("1.6/doc-exists", "문서 루트가 없다");
    skip("1.6/doc-coverage", "문서 루트가 없다");
  }

  // ── 1.7 요구사항 ─────────────────────────────────────────
  const badPatterns = ir.requirements
    .filter((requirement) => !(EARS_PATTERNS as readonly string[]).includes(requirement.pattern))
    .map((requirement) => requirement.id);
  check("1.7/ears-pattern", badPatterns.length === 0, badPatterns.join(", "));
  const unwanted = ir.requirements.filter((requirement) => requirement.pattern === "unwanted").length;
  check("1.7/unwanted", unwanted >= 1, `${unwanted}개`);
  // 요구사항 냄새 (Femmer · ISO 29148 언어 기준 · Wiegers의 「모호하지 않다」) — 재지 못하는 말.
  const vague = ir.requirements.filter((q) => VAGUE_TERMS.some((t) => t.test(q.text))).map((q) => q.id);
  check("1.7/no-vague-terms", vague.length === 0, vague.join(", "));
  // 품질 요구사항은 적합 기준 없이는 모호하다 — 「빨라야 한다」는 시험할 수 없다.
  const unfit = ir.requirements.filter((q) => q.kind === "quality" && !q.fit?.trim()).map((q) => q.id);
  check("1.7/quality-fit", unfit.length === 0, unfit.join(", "));

  // ── 1.8 추적 표 ──────────────────────────────────────────
  const linked = new Set(ir.requirementLinks.map((link) => link.requirement));
  const blanks = [...requirementIds].filter((id) => !linked.has(id));
  check("1.8/rtm-complete", blanks.length === 0, blanks.length ? `빈 칸: ${blanks.join(", ")}` : "");
  check("1.8/eval-node-exists", ir.evals.every((entry) => nodeIds.has(entry.node)));
  check(
    "1.8/link-integrity",
    ir.requirementLinks.every(
      (link) => requirementIds.has(link.requirement) && nodeIds.has(link.node) && evalIds.has(link.eval),
    ),
  );
  check("1.8/eval-scoring", ir.evals.every((entry) => entry.kind !== "model" || Boolean(entry.scoring)));

  return out;
}

/** The §7.2 result shape: what failed, which cell to return to, what else went stale. */
export function summarizeIrChecks(results: readonly IrCheckResult[]): IrCheckSummary {
  const failed = results.filter((result) => result.ok === false).map((result) => result.id);
  const failedGates = [...new Set(failed.map((id) => id.split("/")[0]!))].sort();
  return {
    passed: failed.length === 0,
    checks: [...results],
    failed,
    failedGates,
    invalidated: invalidatedGates(failedGates),
    skipped: results.filter((result) => result.ok === null).map((result) => result.id),
  };
}
