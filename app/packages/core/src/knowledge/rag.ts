import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "../rooms/store.js";
import { readSemanticSource, readSemanticState, semanticDigest, SemanticError, sourceUsage } from "./semantic.js";
import { semanticPaths } from "./semantic.js";
import type { SemanticSource, SemanticVersion } from "./semanticContract.js";

export interface RagSource extends SemanticSource {
  versionId: string; hash: string; versions: number; status: "current" | "changed";
}
export interface RagCitation {
  id: string; sourceId: string; versionId: string; sourceHash: string; path: string; heading: string;
  start: number; end: number; rangeHash: string; text: string; line: number;
}
export interface RagHit extends RagCitation { score: number; channel: "lexical"; remoteTransfer: boolean }
export interface RagSearch {
  project: string; query: string; revision: number; corpus: string; activeSources: number;
  hits: RagHit[]; changed: { id: string; path: string }[]; ms: number;
}
export interface RagAnswer {
  status: "supported" | "insufficient" | "ambiguous" | "conflicting";
  claims: { text: string; citations: { id: string; quote: string }[] }[];
}

export async function loadRagSources(home: string, alias: string): Promise<{ revision: number; sources: RagSource[] }> {
  const state = await readSemanticState(home, alias), sources: RagSource[] = [];
  for (const source of state.sources) {
    const version = state.versions.filter(v => v.sourceId === source.id).at(-1);
    if (!version) continue;
    try {
      const live = await readSemanticSource(home, alias, source.path);
      sources.push({ ...source, usage: sourceUsage(source), remoteTransfer: source.remoteTransfer ?? false,
        versionId: version.id, hash: version.hash, versions: state.versions.filter(v => v.sourceId === source.id).length,
        status: live.hash === version.hash ? "current" : "changed" });
    } catch (e) { if (!(e instanceof SemanticError)) throw e; /* No names, counts or cached text of inaccessible files. */ }
  }
  if ((await readSemanticState(home, alias)).seq !== state.seq) throw new SemanticError("자료 설정이 변경되었습니다. 다시 불러와주세요.", 409);
  return { revision: state.seq, sources };
}

/** NFC is for scoring only; stored paths and citation offsets always refer to the unmodified original. */
const normalized = (text: string) => text.normalize("NFC").toLowerCase();
export function ragTerms(text: string): string[] {
  const tokens: string[] = [];
  for (const part of text.normalize("NFC").match(/[가-힣]+|[A-Za-z0-9_./-]+/g) ?? []) {
    if (/^[가-힣]+$/.test(part)) {
      if (part.length === 1) tokens.push(part);
      for (let i = 0; i < part.length - 1; i++) tokens.push(part.slice(i, i + 2));
    } else {
      tokens.push(part.toLowerCase());
      tokens.push(...part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    }
  }
  return tokens;
}
function passages(source: SemanticSource, version: SemanticVersion): RagCitation[] {
  const starts = [0];
  for (let i = 0; i < version.content.length; i++) if (version.content[i] === "\n") starts.push(i + 1);
  const out: RagCitation[] = [];
  for (const chunk of version.chunks) {
    const base = starts[chunk.line - 1]!;
    for (let offset = 0; offset < chunk.text.length; offset += 1000) {
      const start = base + offset, end = Math.min(base + chunk.text.length, start + 1200);
      const text = version.content.slice(start, end);
      if (!text.trim()) continue;
      out.push({ id: "", sourceId: source.id, versionId: version.id, sourceHash: version.hash, path: source.path,
        heading: chunk.heading.slice(0, 300), start, end, rangeHash: semanticDigest(text), text,
        line: chunk.line + chunk.text.slice(0, offset).split("\n").length - 1 });
    }
  }
  return out;
}

/** A bounded on-demand lexical index: no disk cache or second copy of the source catalogue. */
export async function searchRag(home: string, alias: string, rawQuery: string, sourceIds?: string[]): Promise<RagSearch> {
  const began = Date.now(), query = rawQuery.trim();
  if (!query || query.length > 2000) throw new SemanticError("질문을 2,000자 이내로 입력해주세요.");
  if (sourceIds && (sourceIds.length > 10 || sourceIds.some(id => typeof id !== "string"))) throw new SemanticError("검색 자료를 확인해주세요.");
  const state = await readSemanticState(home, alias), candidates: { citation: RagCitation; remoteTransfer: boolean }[] = [];
  const changed: { id: string; path: string }[] = [], corpusParts: string[] = [];
  let activeSources = 0;
  for (const source of state.sources) {
    if (!sourceUsage(source).retrieval || (sourceIds && !sourceIds.includes(source.id))) continue;
    const version = state.versions.filter(v => v.sourceId === source.id).at(-1);
    if (!version) continue;
    try {
      const live = await readSemanticSource(home, alias, source.path);
      if (live.hash !== version.hash) { changed.push({ id: source.id, path: source.path }); continue; }
      activeSources++; corpusParts.push(source.id + ":" + version.hash);
      candidates.push(...passages(source, version).map(citation => ({ citation, remoteTransfer: source.remoteTransfer ?? false })));
    } catch (e) { if (!(e instanceof SemanticError)) throw e; }
  }
  const queryTerms = [...new Set(ragTerms(query))];
  const documents = candidates.map(c => {
    const ctn = c.citation;
    const terms = ragTerms(ctn.text + " " + ctn.heading + " " + ctn.heading + " " + ctn.path);
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    return { ...c, frequencies, length: terms.length };
  });
  const average = documents.reduce((n, d) => n + d.length, 0) / Math.max(1, documents.length);
  const df = new Map(queryTerms.map(t => [t, documents.filter(d => d.frequencies.has(t)).length]));
  const ranked = documents.map(d => {
    let score = 0;
    for (const term of queryTerms) {
      const tf = d.frequencies.get(term) ?? 0;
      if (!tf) continue;
      const frequency = df.get(term)!;
      const idf = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
      score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * d.length / Math.max(1, average)));
    }
    if (normalized(d.citation.text).includes(normalized(query))) score += 3;
    return { ...d.citation, remoteTransfer: d.remoteTransfer, score, channel: "lexical" as const };
  }).filter(d => d.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.start - b.start);
  const unique: RagHit[] = [];
  let contextCharacters = 0;
  for (const hit of ranked) {
    // Overlapping windows from the same paragraph must not fill the whole model context.
    if (unique.some(h => h.versionId === hit.versionId && h.start < hit.end && h.end > hit.start)) continue;
    if (contextCharacters + hit.text.length + hit.heading.length > 6000) continue;
    unique.push({ ...hit, id: String(unique.length + 1) });
    contextCharacters += hit.text.length + hit.heading.length;
    if (unique.length >= 8) break;
  }
  if ((await readSemanticState(home, alias)).seq !== state.seq) throw new SemanticError("자료 설정이 변경되었습니다. 다시 검색해주세요.", 409);
  return { project: alias, query, revision: state.seq, corpus: semanticDigest(JSON.stringify([state.seq, corpusParts])), activeSources,
    hits: unique, changed, ms: Date.now() - began };
}

/** Recheck membership, immutable range, live file and transfer policy at every delivery boundary. */
export async function validateRagContext(home: string, alias: string, search: RagSearch, remote = false): Promise<void> {
  const state = await readSemanticState(home, alias);
  if (search.project !== alias || state.seq !== search.revision) throw new SemanticError("자료 사용 설정이 바뀌었습니다. 다시 검색해주세요.", 409);
  for (const hit of search.hits) {
    const source = state.sources.find(s => s.id === hit.sourceId);
    const version = state.versions.filter(v => v.sourceId === hit.sourceId).at(-1);
    if (!source || !sourceUsage(source).retrieval || !version || version.id !== hit.versionId) throw new SemanticError("근거 자료를 다시 확인해주세요.", 409);
    if (remote && !source.remoteTransfer) throw new SemanticError("외부 모델에 전달하도록 허용하지 않은 자료가 있습니다. 자료 설정에서 허용하거나 로컬 모델을 선택해주세요.", 403);
    const live = await readSemanticSource(home, alias, source.path);
    if (live.hash !== hit.sourceHash || version.hash !== hit.sourceHash || version.content.slice(hit.start, hit.end) !== hit.text || semanticDigest(hit.text) !== hit.rangeHash) throw new SemanticError("원문이 변경되었습니다. 다시 불러온 뒤 검색해주세요.", 409);
  }
  if ((await readSemanticState(home, alias)).seq !== state.seq) throw new SemanticError("자료 설정이 변경되었습니다. 다시 검색해주세요.", 409);
}

/** Transmission audit has identifiers only: no question, excerpt, answer or process output. */
export async function recordRagDelivery(home: string, alias: string, input: {
  requestId: string; model: string; status: "requested" | "complete" | "stopped" | "failed"; context: RagSearch;
}): Promise<void> {
  await readSemanticState(home, alias);
  const dir = semanticPaths(home, alias).dir, file = path.join(dir, "rag-deliveries.jsonl");
  await fs.mkdir(dir, { recursive: true });
  const event = { at: new Date().toISOString(), requestId: input.requestId, model: input.model, status: input.status,
    revision: input.context.revision, sources: input.context.hits.map(h => ({ sourceId: h.sourceId, versionId: h.versionId, hash: h.sourceHash })) };
  await withFileLock(file, () => fs.appendFile(file, JSON.stringify(event) + "\n", { mode: 0o600 }));
}

const answerSchema = z.object({
  status: z.enum(["supported", "insufficient", "ambiguous", "conflicting"]),
  claims: z.array(z.object({ text: z.string().trim().min(1).max(1600), citations: z.array(z.object({ id: z.string(), quote: z.string().min(1).max(1200) })).max(8) })).max(12),
});
export function validateRagAnswer(raw: string, context: RagSearch): RagAnswer {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
  catch { throw new SemanticError("모델 응답의 형식을 확인하지 못했습니다. 원문 검색 결과는 유지됩니다.", 422); }
  const answer = answerSchema.safeParse(parsed);
  if (!answer.success) throw new SemanticError("모델 응답의 필수 항목을 확인하지 못했습니다.", 422);
  const value = answer.data;
  if (value.status === "insufficient" || value.status === "ambiguous") {
    if (value.claims.length) throw new SemanticError("근거 부족·질문 확인 상태에 검증되지 않은 답변이 포함되었습니다.", 422);
    return value;
  }
  if (!value.claims.length) throw new SemanticError("답변에 근거가 없습니다.", 422);
  for (const claim of value.claims) {
    if (!claim.citations.length) throw new SemanticError("출처 없는 답변 문장이 있어 답변을 확정하지 않았습니다.", 422);
    for (const citation of claim.citations) {
      const hit = context.hits.find(h => h.id === citation.id);
      // Exact original substring, with original offsets preserved. No fuzzy quotation repair.
      if (!hit || !hit.text.includes(citation.quote)) throw new SemanticError("인용이 원문과 일치하지 않아 답변을 확정하지 않았습니다.", 422);
    }
  }
  if (value.status === "conflicting" && new Set(value.claims.flatMap(c => c.citations.map(q => q.id + ":" + q.quote))).size < 2) {
    throw new SemanticError("상충하는 양쪽 인용을 확인하지 못해 답변을 확정하지 않았습니다.", 422);
  }
  return value;
}

export async function openRagCitation(home: string, alias: string, citation: RagCitation) {
  const state = await readSemanticState(home, alias);
  const source = state.sources.find(s => s.id === citation.sourceId);
  const version = state.versions.filter(v => v.sourceId === citation.sourceId).at(-1);
  if (!source || !sourceUsage(source).retrieval || !version || version.id !== citation.versionId) throw new SemanticError("현재 검색에 사용하는 근거가 아닙니다.", 409);
  const live = await readSemanticSource(home, alias, source.path);
  if (live.hash !== version.hash || version.hash !== citation.sourceHash || version.content.slice(citation.start, citation.end) !== citation.text || semanticDigest(citation.text) !== citation.rangeHash) throw new SemanticError("원문이나 자료 설정이 변경되었습니다. 다시 검색해주세요.", 409);
  if ((await readSemanticState(home, alias)).seq !== state.seq) throw new SemanticError("자료 설정이 변경되었습니다.", 409);
  return { content: version.content, path: source.path, versionId: version.id, start: citation.start, end: citation.end, line: citation.line };
}
