import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { irValueDigest } from "./valueDigest.js";
import { z } from "zod";
import { irRequirementSchema, type IrRequirement } from "../types/ir.js";
import { readOverlay } from "../studio/projectFiles.js";
import { readProposedIr } from "../studio/irStore.js";
import { projectStudioDir } from "../studio/studioStore.js";
import { withFileLock } from "../rooms/store.js";
import { readApprovedProvenance, readProvenance, sourceFor } from "./consult/provenance.js";
import { applyConsultPatch } from "./consult/draftWrite.js";

export const REQUIREMENT_REVIEW_FILE_NAME = "ir.requirement-review.json";
export const requirementReviewInputSchema = z.object({
  alias: z.string().min(1), action: z.enum(["approved", "held", "pending"]),
  items: z.array(z.object({ id: z.string().min(1), digest: z.string().min(1) })).min(1).max(200),
  note: z.string().max(4000).optional(),
});
export const requirementEditInputSchema = z.object({
  alias: z.string().min(1), id: z.string().min(1), documentDigest: z.string().min(1),
  values: z.unknown().optional(), remove: z.boolean().optional(),
  create: z.boolean().optional(),
  links: z.array(z.object({ node: z.string().min(1), eval: z.string().min(1) })).optional(),
});
type Doc = Record<string, unknown>;
const object = (v: unknown): Doc => v && typeof v === "object" && !Array.isArray(v) ? v as Doc : {};
const records = (v: unknown): Doc[] => Array.isArray(v) ? v.map(object) : [];
const string = (v: unknown): string => typeof v === "string" ? v : "";
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
export const requirementDigest = irValueDigest;

export interface RequirementDetail {
  requirement: Doc;
  goal: string;
  nodes: Doc[];
  edges: Doc[];
  tests: Doc[];
  links: Doc[];
  source: IrRequirement["sourceRef"] | null;
}
export interface RequirementReviewEvent {
  id: string;
  at: string;
  action: "approved" | "held" | "pending" | "edited";
  digest: string;
  note: string;
  before?: Doc | null;
  after?: Doc | null;
}
export interface RequirementRow {
  id: string;
  title: string;
  group: string;
  before: RequirementDetail | null;
  after: RequirementDetail | null;
  change: "same" | "added" | "changed" | "removed";
  digest: string;
  changedFields: string[];
  impactBy: string[];
  slots: { name: string; filled: boolean; changed: boolean }[];
  blockers: string[];
  decision: "approved" | "held" | "pending";
  stale: boolean;
  events: RequirementReviewEvent[];
}
export interface RequirementWorkspace {
  hasCurrent: boolean;
  hasProposed: boolean;
  draftError: string | null;
  currentVersion: number | null;
  proposedVersion: number | null;
  source: "current" | "proposed";
  documentDigest: string;
  goal: string;
  rows: RequirementRow[];
  nodes: Doc[];
  tests: Doc[];
}
export class RequirementError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); }
}
const reviewSchema = z.object({ events: z.array(z.object({
  id: z.string(), at: z.string(), action: z.enum(["approved", "held", "pending", "edited"]),
  digest: z.string(), note: z.string(), before: z.record(z.string(), z.unknown()).nullable().optional(),
  after: z.record(z.string(), z.unknown()).nullable().optional(),
})).default([]) });
const reviewPath = (home: string, alias: string) => path.join(projectStudioDir(home, alias), REQUIREMENT_REVIEW_FILE_NAME);
async function readReview(home: string, alias: string): Promise<RequirementReviewEvent[]> {
  try { return reviewSchema.parse(JSON.parse(await fs.readFile(reviewPath(home, alias), "utf8"))).events; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
async function saveReview(home: string, alias: string, events: RequirementReviewEvent[]) {
  const file = reviewPath(home, alias);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temp, JSON.stringify({ events }, null, 2) + "\n");
  await fs.rename(temp, file);
}
function detail(doc: Doc, id: string, provenance: Awaited<ReturnType<typeof readProvenance>>): RequirementDetail | null {
  const reqs = records(doc.requirements), index = reqs.findIndex(r => r.id === id), requirement = reqs[index];
  if (!requirement) return null;
  const links = records(doc.requirementLinks).filter(l => l.requirement === id);
  const nodeIds = new Set(links.map(l => string(l.node)));
  const nodes = records(doc.nodes).filter(n => nodeIds.has(string(n.id)));
  const tests = records(doc.evals).filter(t => links.some(l => l.eval === t.id));
  const origin = sourceFor(provenance, "requirements[" + index + "]");
  const parsedRef = irRequirementSchema.shape.sourceRef.safeParse(requirement.sourceRef);
  const source = parsedRef.success && parsedRef.data ? parsedRef.data
    : origin.consult ? { kind: "consult" as const, id: origin.consult, ...(typeof origin.turn === "number" ? { turn: origin.turn } : {}) } : null;
  return { requirement, goal: string(requirement.goal) || string(doc.goal), nodes,
    edges: records(doc.edges).filter(e => nodeIds.has(string(e.from)) || nodeIds.has(string(e.to))),
    tests, links, source };
}
function content(d: RequirementDetail | null) {
  // 메모·출처만 바뀐 것도 변경으로 보인다. 배열 순서의 재배치는 의미 변화로 세지 않는다.
  if (!d) return null;
  const sort = (r: Doc[]) => [...r].sort((a, b) => irValueDigest(a).localeCompare(irValueDigest(b)));
  return { ...d, nodes: sort(d.nodes), edges: sort(d.edges), tests: sort(d.tests), links: sort(d.links) };
}
export async function loadRequirementWorkspace(home: string, alias: string, wanted: "current" | "proposed" = "proposed"): Promise<RequirementWorkspace> {
  const [overlay, draft, provenance, events] = await Promise.all([readOverlay(home, alias), readProposedIr(home, alias), readProvenance(home, alias), readReview(home, alias)]);
  const current = object(overlay.ir), proposed = draft.ok ? object(draft.raw) : null;
  const currentVersion = typeof current.version === "number" ? current.version : null;
  const approvedProvenance = currentVersion ? await readApprovedProvenance(home, alias, currentVersion) : { entries: [] };
  const source = wanted === "current" && overlay.ir || !proposed ? "current" : "proposed";
  const shown = source === "proposed" ? proposed! : current;
  const ids = [...new Set([...records(shown.requirements), ...(source === "proposed" ? records(current.requirements) : [])].map(r => string(r.id)).filter(Boolean))];
  const rows: RequirementRow[] = ids.map(id => {
    const before = detail(current, id, approvedProvenance), after = source === "proposed" ? detail(proposed!, id, provenance) : before;
    const a = content(before), b = content(after);
    const direct = (d: ReturnType<typeof content>) => { if (!d) return null; const { sourceRef: _ref, ...requirement } = d.requirement; return { requirement, source: d.source, goal: d.goal, links: d.links }; };
    const change = source === "current" ? "same" : !a ? "added" : !b ? "removed" : requirementDigest(direct(a)) === requirementDigest(direct(b)) ? "same" : "changed";
    const active = after ?? before!, req = active.requirement;
    const keys = [...new Set([...Object.keys(before?.requirement ?? {}), ...Object.keys(after?.requirement ?? {})])];
    const changedFields = change === "same" ? [] : keys.filter(k => JSON.stringify(before?.requirement[k]) !== JSON.stringify(after?.requirement[k]));
    for (const key of ["goal", "nodes", "edges", "tests", "links"] as const) if (requirementDigest(before?.[key] ?? null) !== requirementDigest(after?.[key] ?? null)) changedFields.push(key);
    const validLinks = active.links.filter(l => active.nodes.some(n => n.id === l.node) && active.tests.some(t => t.id === l.eval && t.node === l.node));
    const filled = [!!active.goal.trim(), !!string(req.text).trim() && !/빠르게|적절히|충분히/.test(string(req.text)),
      Array.isArray(req.exceptions) || req.pattern === "unwanted",
      !!string(req.acceptance).trim() || active.tests.some(t => !!string(t.expect).trim()),
      validLinks.length > 0 && validLinks.length === active.links.length, !strings(req.openQuestions).some(q => q.trim())];
    const names = ["왜", "무엇", "경계", "확인", "연결", "미결"];
    const fieldGroups = [["goal"], ["text", "condition", "response"], ["exceptions"], ["acceptance", "fit", "tests"], ["nodes", "edges", "links"], ["openQuestions"]];
    const blockers = change === "removed" ? [] : names.filter((_, i) => !filled[i]).map(n => n === "미결" ? "미결 질문에 답해주세요." : n + " 칸을 채워주세요.");
    if (change !== "removed" && req.kind === "quality" && !string(req.fit).trim()) blockers.push("품질 요구사항의 수치 기준이 필요합니다.");
    const digest = requirementDigest({ currentVersion, proposedVersion: shown.version, before: a, after: b });
    const history = events.filter(e => e.id === id);
    const last = history.filter(e => e.action !== "edited").at(-1);
    const stale = !!last && last.digest !== digest;
    const decision = !last || stale ? "pending" : last.action === "edited" ? "pending" : last.action;
    return { id, title: string(req.summary) || string(req.text) || id, group: string(req.group) || string(req.kind) || "미분류",
      before, after, change, digest, changedFields, slots: names.map((name, i) => ({ name, filled: filled[i]!, changed: fieldGroups[i]!.some(k => changedFields.includes(k)) })),
      blockers, decision, stale, impactBy: [], events: history };
  });
  // 동일 단계·시험을 공유하는 항목은 영향 확인 대상으로 표시한다. 내용은 자동 수정하지 않는다.
  for (const row of rows.filter(r => r.change === "same")) {
    const own = row.after ?? row.before!;
    row.impactBy = rows.filter(r => r.change !== "same" && [r.before, r.after].some(d => d && (
      d.nodes.some(n => own.nodes.some(o => o.id === n.id)) || d.tests.some(t => own.tests.some(o => o.id === t.id))
    ))).map(r => r.id);
    if (source === "proposed" && !row.impactBy.length && requirementDigest(content(row.before)) !== requirementDigest(content(row.after))) row.impactBy = ["흐름·시험 변경"];
  }
  const malformed = draft.ok && (draft.raw !== null && (typeof draft.raw !== "object" || Array.isArray(draft.raw)) || proposed?.requirements !== undefined && !Array.isArray(proposed.requirements));
  const duplicateIds = records(shown.requirements).length !== new Set(records(shown.requirements).map(r => r.id)).size;
  return { hasCurrent: !!overlay.ir, hasProposed: !!proposed, draftError: malformed ? "초안의 요구사항 형식을 확인해주세요." : duplicateIds ? "요구사항 ID가 중복되어 있습니다." : !draft.ok && !draft.error.includes(" 가 없다.") ? draft.error : null,
    currentVersion, proposedVersion: proposed ? (currentVersion ?? 0) + 1 : null, source,
    documentDigest: requirementDigest(proposed ?? current), goal: string(shown.goal), rows, nodes: records(shown.nodes), tests: records(shown.evals) };
}
export async function markRequirements(home: string, alias: string, input: {
  items: { id: string; digest: string }[]; action: "approved" | "held" | "pending"; note?: string;
}): Promise<RequirementWorkspace> {
  if (!input.items.length || input.items.length > 200 || new Set(input.items.map(i => i.id)).size !== input.items.length) throw new RequirementError("검토 대상을 중복 없이 선택해주세요.");
  await fs.mkdir(projectStudioDir(home, alias), { recursive: true });
  return withFileLock(reviewPath(home, alias), async () => {
    const view = await loadRequirementWorkspace(home, alias);
    if (view.draftError) throw new RequirementError(view.draftError, 409);
    for (const item of input.items) {
      const row = view.rows.find(r => r.id === item.id);
      if (!row || row.digest !== item.digest) throw new RequirementError("설계가 변경되었습니다. 새로고침 후 다시 검토해주세요.", 409);
      if (!view.hasProposed || row.change === "same") throw new RequirementError("변경 초안만 검토할 수 있습니다.", 409);
      if (input.action === "approved" && row.blockers.length) throw new RequirementError(item.id + ": " + row.blockers.join(" "), 409);
    }
    const events = await readReview(home, alias);
    for (const item of input.items) events.push({ ...item, action: input.action, at: new Date().toISOString(), note: input.note?.trim() ?? "" });
    await saveReview(home, alias, events);
    return loadRequirementWorkspace(home, alias);
  });
}
export async function saveRequirement(home: string, alias: string, input: {
  id: string; documentDigest: string; values?: unknown; remove?: boolean; create?: boolean;
  links?: { node: string; eval: string }[];
}): Promise<RequirementWorkspace> {
  await fs.mkdir(projectStudioDir(home, alias), { recursive: true });
  return withFileLock(reviewPath(home, alias), async () => {
    const view = await loadRequirementWorkspace(home, alias);
    if (view.draftError) throw new RequirementError(view.draftError, 409);
    if (view.documentDigest !== input.documentDigest) throw new RequirementError("다른 화면에서 설계가 변경되었습니다. 새로고침 후 다시 저장해주세요.", 409);
    const [draft, overlay] = await Promise.all([readProposedIr(home, alias), readOverlay(home, alias)]);
    const doc = object(draft.ok ? draft.raw : overlay.ir);
    const reqs = records(doc.requirements), existing = reqs.find(r => r.id === input.id);
    if (input.create && existing) throw new RequirementError("이미 사용 중인 요구사항 ID입니다. 다른 ID를 입력해주세요.", 409);
    let updated: IrRequirement | null = null;
    if (!input.remove) {
      const parsed = irRequirementSchema.safeParse({ ...object(input.values), id: input.id });
      if (!parsed.success) throw new RequirementError("요구사항 형식이 올바르지 않습니다: " + parsed.error.issues.map(i => i.path.join(".") + " " + i.message).join("; "));
      updated = parsed.data;
      if (!updated.text.trim()) throw new RequirementError("요구사항 문장을 입력해주세요.");
    } else if (!existing) throw new RequirementError("제외할 요구사항이 없습니다.", 404);
    const links = input.remove ? [] : input.links ?? records(doc.requirementLinks).filter(l => l.requirement === input.id).map(l => ({ node: string(l.node), eval: string(l.eval) }));
    if (links.some(l => !records(doc.nodes).some(n => n.id === l.node) || !records(doc.evals).some(t => t.id === l.eval && t.node === l.node))) throw new RequirementError("선택한 흐름 단계와 시험의 연결을 확인해주세요.");
    const stable = reqs.map(r => {
      const source = view.rows.find(row => row.id === r.id)?.after?.source;
      return source && !r.sourceRef ? { ...r, sourceRef: source } : r;
    });
    const nextReqs = input.remove ? stable.filter(r => r.id !== input.id) : existing ? stable.map(r => r.id === input.id ? updated! : r) : [...stable, updated!];
    const result = await applyConsultPatch(home, alias, { expectedDraftDigest: view.documentDigest, patch: {
      requirements: nextReqs, requirementLinks: [...records(doc.requirementLinks).filter(l => l.requirement !== input.id), ...links.map(l => ({ ...l, requirement: input.id }))],
    }, provenance: [{ path: input.remove ? "requirements" : "requirements[" + nextReqs.findIndex(r => r.id === input.id) + "]", source: "manual" }] });
    if (!result.ok) throw new RequirementError(result.error, 409);
    const next = await loadRequirementWorkspace(home, alias), row = next.rows.find(r => r.id === input.id);
    const events = await readReview(home, alias);
    events.push({ id: input.id, at: new Date().toISOString(), action: "edited", digest: row?.digest ?? "", note: updated?.changeReason ?? "초안에서 제외",
      before: existing ?? null, after: updated ? { ...updated } : null });
    await saveReview(home, alias, events);
    return loadRequirementWorkspace(home, alias);
  });
}
