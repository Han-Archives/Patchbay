import type { SensitivityLevel } from "../sensitivity/sensitivity.js";
import {
  KNOWLEDGE_SECRET_LEVEL,
  type KnowledgeNodeView,
  type KnowledgeRelation,
  type KnowledgeSnapshot,
} from "./contract.js";
import { filePathFromPort } from "./ingest.js";

/**
 * 4단계 문서 호출 -- 앵커를 찾고(4.1), 관계로 1~2홉 펼치고(4.2), **그 이웃
 * 안에서만** 순위를 매기고(4.3), 민감도로 거르고(4.4), 근거 경로를 함께
 * 돌려준다(4.5).
 *
 * No embeddings. 기획서 §5: a vector index goes in only when 4.3's recall
 * measurably fails, and a ranking nobody can read cannot be measured.
 */

/** 기획서 4.2 fixes the radius at one or two hops. */
export const RETRIEVE_HOP_CHOICES = [1, 2] as const;
export type RetrieveHops = (typeof RETRIEVE_HOP_CHOICES)[number];
export const DEFAULT_RETRIEVE_HOPS: RetrieveHops = 2;

export interface RetrieveOptions {
  /** What the caller typed: a path, a PortId, or a design row's id. */
  anchor: string;
  /** The input being routed. Its words are what 4.3 ranks on. */
  query?: string;
  maxHops?: number;
  /** Withhold at or above this grade. Defaults to L4 (기획서 4.4). */
  secretLevel?: SensitivityLevel;
  limit?: number;
}

/**
 * One document the anchor can reach. The field names are the ones
 * `runRecord.documentCalls[]` uses (명세 §5.2) so a run can record what a
 * retrieval answered without a second shape in between.
 */
export interface DocumentHit {
  /** `documents[].id` -- D1. */
  documentId: string;
  /** The node that consults it. Null when nothing in the graph does. */
  nodeId: string | null;
  path: string;
  level: SensitivityLevel;
  /** `documents[].when` -- 어떤 입력일 때 이 문서인가. */
  when: string;
  hops: number;
  /** How many of the query's words this row's sentence carries. */
  matched: number;
  /** 4.5 -- 앵커에서 이 문서까지. */
  via: string;
}

export interface RetrieveResult {
  anchor: KnowledgeNodeView | null;
  maxHops: RetrieveHops;
  /** The words 4.3 ranked on, after splitting. */
  terms: string[];
  /** Every document inside the radius, best first. */
  hits: DocumentHit[];
  /** How many hits carry at least one of the query's words. */
  matchedCount: number;
  /** Rows the radius reached but the grade withheld (4.4). Counted, never named. */
  withheld: number;
  /** When the anchor is ambiguous or unknown -- names, not a guess. */
  candidates: string[];
  error: string | null;
}

export function retrieveDocuments(snapshot: KnowledgeSnapshot, options: RetrieveOptions): RetrieveResult {
  const secretLevel = options.secretLevel ?? KNOWLEDGE_SECRET_LEVEL;
  const maxHops = clampHops(options.maxHops);
  const terms = splitTerms(options.query ?? "");
  const byPath = new Map(snapshot.nodes.map((node) => [node.path, node]));

  const found = resolveAnchor(snapshot, options.anchor);
  if (!found.node) {
    return {
      anchor: null,
      maxHops,
      terms,
      hits: [],
      matchedCount: 0,
      withheld: 0,
      candidates: found.candidates,
      error: found.error,
    };
  }
  const anchor = found.node;
  if (anchor.level >= secretLevel) {
    return {
      anchor: null,
      maxHops,
      terms,
      hits: [],
      matchedCount: 0,
      withheld: 1,
      candidates: [],
      error: `앵커 "${options.anchor}" 는 비밀 등급이다 — 조회하지 않는다.`,
    };
  }

  const walk = expand(snapshot, anchor, maxHops, secretLevel, byPath);
  const consultedBy = new Map<string, string>();
  for (const edge of snapshot.edges) {
    if (edge.kind !== "CONSULTS") continue;
    const node = byPath.get(edge.from);
    if (node) consultedBy.set(edge.to, node.name);
  }

  const hits: DocumentHit[] = [];
  for (const [path, reached] of walk.reached) {
    const node = byPath.get(path);
    if (!node || node.label !== "Document") continue;
    const filePath = node.port ? filePathFromPort(node.port) : null;
    const when = node.text ?? "";
    hits.push({
      documentId: node.name,
      nodeId: consultedBy.get(node.path) ?? null,
      path: filePath ?? node.path,
      level: node.level,
      when,
      hops: reached.hops,
      matched: countMatches(terms, [when, node.name, filePath ?? ""]),
      via: reached.via,
    });
  }

  /**
   * 4.3 -- the order. Words the caller actually typed come first, distance
   * breaks that tie, and the path breaks the last one so the same input never
   * answers in two orders. Nothing here looks outside `walk.reached`: a
   * document the anchor cannot reach does not enter the list at all, however
   * well its sentence matches.
   */
  hits.sort(
    (a, b) => b.matched - a.matched || a.hops - b.hops || a.path.localeCompare(b.path) || a.documentId.localeCompare(b.documentId),
  );

  const limited = typeof options.limit === "number" && options.limit >= 0 ? hits.slice(0, options.limit) : hits;
  return {
    anchor,
    maxHops,
    terms,
    hits: limited,
    matchedCount: limited.filter((hit) => hit.matched > 0).length,
    withheld: walk.withheld,
    candidates: [],
    error: null,
  };
}

function clampHops(raw: number | undefined): RetrieveHops {
  if (raw === 1) return 1;
  if (raw === 2) return 2;
  return DEFAULT_RETRIEVE_HOPS;
}

interface Reached {
  hops: number;
  via: string;
}

interface Walk {
  reached: Map<string, Reached>;
  withheld: number;
}

/**
 * 4.2 -- breadth first to `maxHops`, carrying the path that got here.
 *
 * Relations are walked in **both** directions: `AT` points from a design row
 * to a file, so starting at a file and asking "which document dependency names
 * me" is a walk against the arrow. The arrow is kept in the printed path so
 * the direction is never lost, only traversable.
 *
 * A withheld row is not stepped through. Filtering results alone would still
 * let a secret file appear inside somebody else's 근거 경로 (4.4).
 */
function expand(
  snapshot: KnowledgeSnapshot,
  anchor: KnowledgeNodeView,
  maxHops: RetrieveHops,
  secretLevel: SensitivityLevel,
  byPath: Map<string, KnowledgeNodeView>,
): Walk {
  const adjacency = new Map<string, Array<{ to: string; kind: KnowledgeRelation; forward: boolean }>>();
  const push = (from: string, to: string, kind: KnowledgeRelation, forward: boolean) => {
    const list = adjacency.get(from);
    if (list) list.push({ to, kind, forward });
    else adjacency.set(from, [{ to, kind, forward }]);
  };
  for (const edge of snapshot.edges) {
    push(edge.from, edge.to, edge.kind, true);
    push(edge.to, edge.from, edge.kind, false);
  }

  const reached = new Map<string, Reached>([[anchor.path, { hops: 0, via: anchor.name }]]);
  let withheld = 0;
  let frontier = [anchor.path];
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next: string[] = [];
    for (const from of frontier) {
      const here = reached.get(from);
      if (!here) continue;
      for (const step of adjacency.get(from) ?? []) {
        if (reached.has(step.to)) continue;
        const node = byPath.get(step.to);
        if (!node) continue;
        if (node.level >= secretLevel) {
          withheld += 1;
          continue;
        }
        reached.set(step.to, { hops: hop, via: `${here.via} ${arrow(step.kind, step.forward)} ${node.name}` });
        next.push(step.to);
      }
    }
    frontier = next;
  }
  return { reached, withheld };
}

function arrow(kind: KnowledgeRelation, forward: boolean): string {
  return forward ? `-[${kind}]->` : `<-[${kind}]-`;
}

interface AnchorMatch {
  node: KnowledgeNodeView | null;
  candidates: string[];
  error: string | null;
}

/**
 * 4.1 -- 앵커를 찾는다: 경로 · 이름 · 항목 주소.
 *
 * Exact wins over partial, and an ambiguous partial answers with the names it
 * found rather than picking one -- a retrieval that silently chose an anchor
 * would make every 근거 경로 below it unreadable.
 */
export function resolveAnchor(snapshot: KnowledgeSnapshot, raw: string): AnchorMatch {
  const wanted = raw.trim();
  if (!wanted) return { node: null, candidates: [], error: "앵커가 비었다 — 경로·이름·항목 주소 중 하나를 준다." };

  const exactPath = snapshot.nodes.find((node) => node.path === wanted);
  if (exactPath) return { node: exactPath, candidates: [], error: null };

  const exactPort = snapshot.nodes.find((node) => node.port === wanted);
  if (exactPort) return { node: exactPort, candidates: [], error: null };

  const byName = snapshot.nodes.filter((node) => node.name === wanted);
  if (byName.length === 1) return { node: byName[0]!, candidates: [], error: null };
  if (byName.length > 1) {
    return { node: null, candidates: byName.map((node) => node.path), error: ambiguous(wanted, byName.length) };
  }

  /**
   * `port` is in here because of 4.1's third word, 항목 주소. A guide file is
   * not necessarily a discovered port -- the scanner indexes signal and source
   * files, not every markdown a design happens to name -- so in a real project the
   * only row carrying `guides/bug.md` is the `Document` that names it, and it
   * carries it as `source:guides/bug.md`. Without this, anchoring on the path a
   * person actually has in hand finds nothing.
   */
  const lower = wanted.toLowerCase();
  const partial = snapshot.nodes.filter(
    (node) =>
      node.path.toLowerCase().includes(lower) ||
      node.name.toLowerCase().includes(lower) ||
      (node.port !== null && node.port.toLowerCase().includes(lower)) ||
      (node.text !== null && node.text.toLowerCase().includes(lower)),
  );
  if (partial.length === 1) return { node: partial[0]!, candidates: [], error: null };
  if (partial.length > 1) {
    return {
      node: null,
      candidates: partial.slice(0, 10).map((node) => node.path),
      error: ambiguous(wanted, partial.length),
    };
  }
  return { node: null, candidates: [], error: `앵커 "${wanted}" 에 맞는 항목이 없다.` };
}

function ambiguous(wanted: string, count: number): string {
  return `앵커 "${wanted}" 가 ${count}개에 맞는다 — 하나로 좁혀 준다.`;
}

/**
 * Splits an input into the words 4.3 ranks on.
 *
 * Korean is not whitespace-tokenized into stems, so a word is kept whole and
 * matching is containment in either direction (below). Two characters is the
 * floor: a one-character particle matches nearly every sentence.
 */
export function splitTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.split(/[^\p{L}\p{N}]+/u)) {
    const term = raw.trim().toLowerCase();
    if (term.length >= 2) seen.add(term);
  }
  return [...seen];
}

/**
 * How many of the query's words this row carries.
 *
 * Containment runs both ways: the input word `버그다` has to match the
 * condition `갈래가 버그`, and no stemmer is going to tell us that in Korean.
 * The direction that shortens is bounded at two characters so `다` alone
 * cannot match everything.
 */
export function countMatches(terms: readonly string[], fields: readonly string[]): number {
  if (terms.length === 0) return 0;
  const text = fields.join(" ").toLowerCase();
  const words = text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2);
  let hits = 0;
  for (const term of terms) {
    if (text.includes(term) || words.some((word) => term.includes(word))) hits += 1;
  }
  return hits;
}
