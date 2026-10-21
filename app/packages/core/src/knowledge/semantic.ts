import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { readStudio, projectStudioDir } from "../studio/studioStore.js";
import { withFileLock } from "../rooms/store.js";
import { classifyPath, isSecret } from "../sensitivity/sensitivity.js";
import type { SemanticCandidate, SemanticChunk, SemanticState, SemanticVersion, SemanticEvidenceRow, SemanticProjection, SemanticWorkspace, EvidenceDecision } from "./semanticContract.js";

export class SemanticError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 | 413 | 422 = 400) { super(message); }
}
const seq = z.number().int().nonnegative();
const id = z.string().min(1).max(200);
export const semanticCandidateSchema = z.object({
  chunkId: id, subject: z.string().trim().min(1).max(160), predicate: z.enum(["USES", "DEPENDS_ON", "PART_OF"]),
  object: z.string().trim().min(1).max(160), quote: z.string().min(1).max(4000),
});
const chunkSchema = z.object({ id, heading: z.string(), text: z.string(), line: z.number().int().positive() });
const usageSchema = z.object({ retrieval: z.boolean(), graph: z.boolean() });
const stateSchema = z.object({
  format: z.literal(1), seq,
  sources: z.array(z.object({ id, path: z.string(), usage: usageSchema.optional(), remoteTransfer: z.boolean().optional() })),
  versions: z.array(z.object({ id, sourceId: id, hash: id, content: z.string(), seq, chunks: z.array(chunkSchema) })),
  entities: z.array(z.object({ id, name: z.string(), sourceId: id, seq })),
  claims: z.array(z.object({ id, from: id, to: id, predicate: z.enum(["USES", "DEPENDS_ON", "PART_OF"]), seq })),
  evidence: z.array(z.object({ id, claimId: id, versionId: id, chunkId: id, quote: z.string(), seq, model: z.string() })),
  events: z.array(z.object({ seq, id, at: z.string(), kind: z.enum(["import", "review", "source"]), evidenceId: id.optional(),
    decision: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(), note: z.string(), sourceId: id.optional(), usage: usageSchema.optional(), remoteTransfer: z.boolean().optional() })),
});
export const semanticDigest = (text: string) => createHash("sha256").update(text).digest("hex");
const key = (prefix: string, ...parts: string[]) => prefix + "-" + semanticDigest(JSON.stringify(parts)).slice(0, 32);
export const semanticPaths = (home: string, alias: string) => ({ dir: path.join(projectStudioDir(home, alias), "knowledge"),
  state: path.join(projectStudioDir(home, alias), "knowledge", "semantic.json") });
const empty = (): SemanticState => ({ format: 1, seq: 0, sources: [], versions: [], entities: [], claims: [], evidence: [], events: [] });

async function registered(home: string, alias: string) {
  const project = (await readStudio(home)).projects.find(p => p.alias === alias);
  if (!project) throw new SemanticError("등록된 프로젝트가 아닙니다.", 404);
  return project;
}
const inside = (root: string, file: string) => file.startsWith(root + path.sep);
/** Every read rechecks both spelling and real path before content enters the index/model/browser. */
export async function readSemanticSource(home: string, alias: string, raw: string): Promise<{ path: string; content: string; hash: string; sourceId: string; chunks: SemanticChunk[] }> {
  const project = await registered(home, alias);
  const rel = raw.replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || rel.includes("\0") || rel.split("/").some(p => p === ".." || p === "." || !p)) throw new SemanticError("프로젝트 안의 문서 상대 경로를 입력해주세요.");
  if (!/\.(md|txt)$/i.test(rel)) throw new SemanticError("첫 버전은 마크다운(.md)과 텍스트(.txt) 자료를 지원합니다.");
  if (isSecret(classifyPath(rel).level)) throw new SemanticError("열람할 수 없는 자료입니다.", 403);
  const root = await fs.realpath(project.path);
  let file: string;
  try { file = await fs.realpath(path.join(root, rel)); }
  catch { throw new SemanticError("자료를 찾지 못했습니다.", 404); }
  if (!inside(root, file) || isSecret(classifyPath(path.relative(root, file)).level)) throw new SemanticError("열람할 수 없는 자료입니다.", 403);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new SemanticError("문서 파일을 선택해주세요.");
  if (stat.size > 256 * 1024) throw new SemanticError("자료를 256KB 이하로 나눠주세요.", 413);
  const bytes = await fs.readFile(file);
  if (bytes.includes(0) || bytes.length > 256 * 1024) throw new SemanticError("텍스트 자료를 256KB 이하로 선택해주세요.", 413);
  const content = bytes.toString("utf8");
  const sourceId = key("source", rel);
  return { path: rel, content, hash: semanticDigest(content), sourceId, chunks: semanticChunks(sourceId, content) };
}

/** Exact paragraphs + heading context, independent of line shifts. Changed context requires review. */
export function semanticChunks(sourceId: string, content: string): SemanticChunk[] {
  const lines = content.split("\n"), chunks: SemanticChunk[] = [], headings: string[] = [];
  const occurrences = new Map<string, number>();
  let pending: string[] = [], start = 1;
  const flush = () => {
    const text = pending.join("\n");
    if (text.trim()) {
      const heading = headings.join(" / "), base = key("chunk", sourceId, heading, text), n = occurrences.get(base) ?? 0;
      occurrences.set(base, n + 1);
      chunks.push({ id: key("chunk", base, String(n)), heading, text, line: start });
    }
    pending = [];
  };
  lines.forEach((line, index) => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) { flush(); headings.length = heading[1]!.length - 1; headings.push(heading[2]!); }
    else if (!line.trim()) flush();
    else { if (!pending.length) start = index + 1; pending.push(line); if (pending.join("\n").length >= 6000) flush(); }
  });
  flush();
  return chunks.map((chunk, index) => ({ ...chunk, id: key("chunk", chunk.id,
    chunks[index - 1] ? semanticDigest(chunks[index - 1]!.heading + "\n" + chunks[index - 1]!.text) : "start",
    chunks[index + 1] ? semanticDigest(chunks[index + 1]!.heading + "\n" + chunks[index + 1]!.text) : "end") }));
}
export async function readSemanticState(home: string, alias: string): Promise<SemanticState> {
  await registered(home, alias);
  try {
    const state = stateSchema.parse(JSON.parse(await fs.readFile(semanticPaths(home, alias).state, "utf8")));
    if (state.seq !== state.events.length || state.events.some((e, i) => e.seq !== i + 1)) throw new SemanticError("지식 검토 기록의 순서가 올바르지 않습니다.", 409);
    return state;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw e; }
}
async function writeState(home: string, alias: string, state: SemanticState) {
  const file = semanticPaths(home, alias).state, tmp = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(stateSchema.parse(state), null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, file);
}
const latestVersions = (state: SemanticState, before = state.seq) => {
  const versions = new Map<string, SemanticVersion>();
  for (const v of state.versions) if (v.seq <= before) versions.set(v.sourceId, v);
  return versions;
};

export async function importSemanticCandidates(home: string, alias: string, input: {
  path: string; hash: string; revision: number; candidates: SemanticCandidate[]; model?: string;
  usage?: { retrieval: boolean; graph: boolean };
}): Promise<void> {
  await registered(home, alias);
  const candidates = z.array(semanticCandidateSchema).max(100).parse(input.candidates);
  await fs.mkdir(semanticPaths(home, alias).dir, { recursive: true });
  await withFileLock(semanticPaths(home, alias).state, async () => {
    const state = await readSemanticState(home, alias);
    if (state.seq !== input.revision) throw new SemanticError("다른 화면에서 검토가 변경되었습니다. 새로고침해주세요.", 409);
    const source = await readSemanticSource(home, alias, input.path);
    if (source.hash !== input.hash) throw new SemanticError("자료가 변경되었습니다. 다시 불러와 후보를 검토해주세요.", 409);
    if (!state.sources.some(s => s.id === source.sourceId) && state.sources.length >= 10) throw new SemanticError("첫 버전은 선택한 자료 10개까지 지원합니다.");
    for (const c of candidates) {
      const chunk = source.chunks.find(ch => ch.id === c.chunkId);
      if (!chunk || !c.quote.trim() || !chunk.text.includes(c.quote)) throw new SemanticError("후보의 인용문이 선택한 원문 문단에 없습니다.", 422);
      if (c.subject === c.object) throw new SemanticError("주어와 대상이 같은 후보는 추가하지 않습니다.", 422);
    }
    const nextSeq = state.seq + 1;
    let stored = state.sources.find(s => s.id === source.sourceId);
    if (!stored) { stored = { id: source.sourceId, path: source.path, usage: input.usage ?? { retrieval: false, graph: true }, remoteTransfer: false }; state.sources.push(stored); }
    const usage = input.usage ? usageSchema.parse(input.usage) : { ...sourceUsage(stored), graph: true };
    const usageChanged = JSON.stringify(sourceUsage(stored)) !== JSON.stringify(usage);
    stored.usage = usage;
    let version = latestVersions(state).get(source.sourceId);
    let changed = usageChanged;
    if (!version || version.hash !== source.hash) {
      version = { id: key("version", source.sourceId, source.hash, String(nextSeq)), sourceId: source.sourceId, hash: source.hash, content: source.content, seq: nextSeq, chunks: source.chunks };
      state.versions.push(version); changed = true;
    }
    for (const c of candidates) {
      // Names only identify within one selected document. Cross-document homonyms stay separate.
      const entity = (name: string) => {
        const entityId = key("entity", source.sourceId, name);
        if (!state.entities.some(e => e.id === entityId)) state.entities.push({ id: entityId, name, sourceId: source.sourceId, seq: nextSeq });
        return entityId;
      };
      const from = entity(c.subject), to = entity(c.object), claimId = key("claim", from, c.predicate, to);
      if (!state.claims.some(cl => cl.id === claimId)) state.claims.push({ id: claimId, from, to, predicate: c.predicate, seq: nextSeq });
      const evidenceId = key("evidence", claimId, c.chunkId, c.quote);
      // A rejected/withdrawn candidate cannot reappear just because extraction is rerun.
      if (!state.evidence.some(e => e.id === evidenceId)) {
        state.evidence.push({ id: evidenceId, claimId, versionId: version.id, chunkId: c.chunkId, quote: c.quote, seq: nextSeq, model: input.model ?? "직접 입력" });
        changed = true;
      }
    }
    if (!changed) return;
    state.seq = nextSeq;
    state.events.push({ seq: nextSeq, id: randomUUID(), at: new Date().toISOString(), kind: "import", note: source.path,
      sourceId: stored.id, usage: stored.usage, remoteTransfer: stored.remoteTransfer ?? false });
    await writeState(home, alias, state);
  });
}

export const sourceUsage = (source: { usage?: { retrieval: boolean; graph: boolean } }) => source.usage ?? { retrieval: false, graph: true };
function graphEnabledAt(state: SemanticState, sourceId: string, atSeq: number) {
  const event = state.events.filter(e => e.sourceId === sourceId && e.seq <= atSeq && e.usage).at(-1);
  return event?.usage?.graph ?? true;
}
/** One source/version catalogue, independent consumers. Turning RAG off never deletes graph evidence. */
export async function updateSemanticSourceUsage(home: string, alias: string, input: {
  sourceId: string; revision: number; retrieval: boolean; remoteTransfer: boolean;
}): Promise<void> {
  await registered(home, alias);
  await withFileLock(semanticPaths(home, alias).state, async () => {
    const state = await readSemanticState(home, alias);
    if (state.seq !== input.revision) throw new SemanticError("자료 설정이 변경되었습니다. 다시 불러와주세요.", 409);
    const source = state.sources.find(s => s.id === input.sourceId);
    if (!source) throw new SemanticError("자료를 찾지 못했습니다.", 404);
    await readSemanticSource(home, alias, source.path);
    const usage = { ...sourceUsage(source), retrieval: input.retrieval };
    if (JSON.stringify(usage) === JSON.stringify(sourceUsage(source)) && (source.remoteTransfer ?? false) === input.remoteTransfer) return;
    source.usage = usage; source.remoteTransfer = input.remoteTransfer; state.seq++;
    state.events.push({ seq: state.seq, id: randomUUID(), at: new Date().toISOString(), kind: "source", note: "자료 사용 설정 변경",
      sourceId: source.id, usage, remoteTransfer: source.remoteTransfer });
    await writeState(home, alias, state);
  });
}
export function semanticEvidenceRows(state: SemanticState, atSeq = state.seq): SemanticEvidenceRow[] {
  const versions = latestVersions(state, atSeq);
  return state.evidence.filter(e => e.seq <= atSeq && graphEnabledAt(state, state.versions.find(v => v.id === e.versionId)!.sourceId, atSeq)).map(e => {
    const claim = state.claims.find(c => c.id === e.claimId)!, original = state.versions.find(v => v.id === e.versionId)!;
    const source = state.sources.find(s => s.id === original.sourceId)!;
    const latest = versions.get(source.id)!;
    const originalChunk = original.chunks.find(c => c.id === e.chunkId)!;
    const chunk = latest.chunks.find(c => c.id === e.chunkId) ?? originalChunk;
    const history = state.events.filter(h => h.seq <= atSeq && h.evidenceId === e.id);
    const offset = chunk.text.indexOf(e.quote);
    return { id: e.id, claimId: claim.id, from: claim.from, to: claim.to,
      subject: state.entities.find(n => n.id === claim.from)!.name, predicate: claim.predicate,
      object: state.entities.find(n => n.id === claim.to)!.name,
      sourceId: source.id, path: source.path, versionId: original.id, versionHash: original.hash, chunkId: e.chunkId,
      quote: e.quote, context: chunk.text, line: chunk.line + chunk.text.slice(0, Math.max(0, offset)).split("\n").length - 1,
      originalLine: originalChunk.line + originalChunk.text.slice(0, originalChunk.text.indexOf(e.quote)).split("\n").length - 1,
      decision: history.at(-1)?.decision ?? "pending", current: latest.chunks.some(c => c.id === e.chunkId), unavailable: false,
      model: e.model, history };
  });
}
export function semanticProjection(state: SemanticState, atSeq = state.seq): SemanticProjection {
  const sources = state.sources.filter(s => graphEnabledAt(state, s.id, atSeq) && state.versions.some(v => v.sourceId === s.id && v.seq <= atSeq));
  const evidence = semanticEvidenceRows(state, atSeq);
  return { seq: atSeq, sources: sources.map(s => ({ id: s.id, path: s.path })), versions: state.versions.filter(v => v.seq <= atSeq && sources.some(s => s.id === v.sourceId)),
    entities: state.entities.filter(e => e.seq <= atSeq && sources.some(s => s.id === e.sourceId)),
    claims: state.claims.filter(c => c.seq <= atSeq && evidence.some(e => e.claimId === c.id)), evidence };
}

export async function loadSemanticWorkspace(home: string, alias: string): Promise<SemanticWorkspace> {
  const state = await readSemanticState(home, alias), rows = semanticEvidenceRows(state), versions = latestVersions(state);
  const sources = await Promise.all(state.sources.filter(s => sourceUsage(s).graph).map(async s => {
    const v = versions.get(s.id)!;
    try {
      const live = await readSemanticSource(home, alias, s.path);
      for (const row of rows.filter(r => r.sourceId === s.id)) {
        const chunk = live.chunks.find(c => c.id === row.chunkId);
        row.current = !!chunk;
        if (chunk) row.line = chunk.line + chunk.text.slice(0, chunk.text.indexOf(row.quote)).split("\n").length - 1;
      }
      return { ...s, versionId: v.id, hash: v.hash, status: live.hash === v.hash ? "current" as const : "changed" as const,
        versions: state.versions.filter(v => v.sourceId === s.id).length, chunks: v.chunks };
    } catch (e) {
      if (!(e instanceof SemanticError)) throw e;
      // Do not expose cached names, quotations, versions or paths of an inaccessible source.
      for (const row of rows.filter(r => r.sourceId === s.id)) { row.current = false; row.unavailable = true; }
      return { id: s.id, path: "열람할 수 없는 자료", versionId: "", hash: "", status: "unavailable" as const, versions: 0, chunks: [] };
    }
  }));
  const visible = rows.filter(r => !r.unavailable);
  return { revision: state.seq, sources, rows: visible, counts: {
    pending: visible.filter(r => r.current && r.decision === "pending").length,
    approved: visible.filter(r => r.current && r.decision === "approved").length,
    rejected: visible.filter(r => r.decision === "rejected").length,
    withdrawn: visible.filter(r => r.decision === "withdrawn").length,
    stale: visible.filter(r => !r.current).length,
  } };
}
export async function reviewSemanticEvidence(home: string, alias: string, input: {
  revision: number; id: string; decision: EvidenceDecision; note?: string;
}): Promise<void> {
  if (!["pending", "approved", "rejected", "withdrawn"].includes(input.decision) || (input.note?.length ?? 0) > 4000) throw new SemanticError("검토 상태와 메모를 확인해주세요.");
  await registered(home, alias);
  await fs.mkdir(semanticPaths(home, alias).dir, { recursive: true });
  await withFileLock(semanticPaths(home, alias).state, async () => {
    const state = await readSemanticState(home, alias);
    if (input.revision !== state.seq) throw new SemanticError("검토 기록이 변경되었습니다. 새로고침 후 다시 검토해주세요.", 409);
    const row = (await loadSemanticWorkspace(home, alias)).rows.find(r => r.id === input.id);
    if (!row) throw new SemanticError("열람할 수 있는 근거가 없습니다.", 404);
    if (input.decision === "approved" && !row.current) throw new SemanticError("원문이 변경되었습니다. 최신 문단의 근거를 다시 추가해주세요.", 409);
    if (input.decision === row.decision) return;
    state.seq++;
    state.events.push({ seq: state.seq, id: randomUUID(), at: new Date().toISOString(), kind: "review", evidenceId: input.id, decision: input.decision, note: input.note?.trim() ?? "" });
    await writeState(home, alias, state);
  });
}
