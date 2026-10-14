import { DEFAULT_PROJECT_DOCS } from "@patchbay/core";
import type { ProcessOutputView } from "./projectContract.js";

/** 절차 산출물 폴더 — 프로젝트 문서 폴더(등록부 `docs`, 기본 `docs`) 아래 `절차`. */
export function procedureDir(docs: string = DEFAULT_PROJECT_DOCS): string {
  return `${docs}/절차`;
}
export const CONSTITUTION_ID = "plan";
export const CONSTITUTION_LABEL = "기획";
export const ARTIFACT_MAX_ROWS = 80;
export const ARTIFACT_MAX_COLUMNS = 12;
export const ARTIFACT_MAX_NODES = 40;
export const ARTIFACT_MAX_BODY = 8_000;

export interface TalkMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ArtifactNode {
  id: string;
  label: string;
}

export interface ArtifactEdge {
  from: string;
  to: string;
}

export interface ProcedureArtifact {
  type: ProcessOutputView;
  title: string;
  columns: string[];
  rows: string[][];
  nodes: ArtifactNode[];
  edges: ArtifactEdge[];
  /** 첫 표 앞에 있던 도입 문장. 표가 있으면 body 대신 여기로 온다. */
  lead: string;
  body: string;
  messages: TalkMessage[];
  threadId: string;
}

type ArtifactVisual = Pick<
  ProcedureArtifact,
  "type" | "title" | "columns" | "rows" | "nodes" | "edges" | "body" | "lead"
>;

export const EMPTY_ARTIFACT: ProcedureArtifact = {
  type: "table",
  title: "",
  columns: [],
  rows: [],
  nodes: [],
  edges: [],
  body: "",
    lead: "",
  messages: [],
  threadId: "",
};

export function procedureArtifactRel(stepId: string, docs: string = DEFAULT_PROJECT_DOCS): string {
  return `${procedureDir(docs)}/${stepId}.artifact.json`;
}

export function procedureMarkdownRel(stepId: string, docs: string = DEFAULT_PROJECT_DOCS): string {
  return `${procedureDir(docs)}/${stepId}.md`;
}

export function parseArtifact(raw: unknown, fallbackTitle = ""): ProcedureArtifact {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_ARTIFACT, title: fallbackTitle };
  }
  const rec = raw as Record<string, unknown>;
  const type = rec.type === "diagram" || rec.type === "text" || rec.type === "table" ? rec.type : "table";
  return {
    type,
    title: clip(asString(rec.title) || fallbackTitle, 120),
    columns: asStringList(rec.columns, ARTIFACT_MAX_COLUMNS),
    rows: asRows(rec.rows),
    nodes: asNodes(rec.nodes),
    edges: asEdges(rec.edges),
    lead: clip(asString(rec.lead), ARTIFACT_MAX_BODY),
    body: clip(asString(rec.body), ARTIFACT_MAX_BODY),
    messages: asMessages(rec.messages),
    threadId: clip(asString(rec.threadId), 200),
  };
}

export function artifactFromTalk(input: {
  output: ProcessOutputView;
  title: string;
  original: string;
  summary: string;
  previous?: ProcedureArtifact;
  constitution?: boolean;
}): ProcedureArtifact {
  const visual = visualFromText(input.output, input.title, input.summary, input.original);
  const previous = input.previous ?? EMPTY_ARTIFACT;
  let merged: ArtifactVisual = {
    ...visual,
    title: visual.title || input.title,
  };
  if (input.constitution) {
    merged = enrichConstitutionVisual(merged, input.title, input.summary, input.original, previous);
  }
  return {
    ...EMPTY_ARTIFACT,
    ...merged,
    messages: previous.messages,
    threadId: previous.threadId,
  };
}

export function goalFromArtifact(artifact: ProcedureArtifact): string | null {
  for (const row of artifact.rows) {
    const key = (row[0] ?? "").trim();
    const value = (row[1] ?? "").trim();
    if (value && /^(목표|goal|총점)$/i.test(key)) return value;
  }
  return null;
}

export function orderLabelsFromArtifact(artifact: ProcedureArtifact, extraText = ""): string[] {
  const fromNodes = orderedNodeLabels(artifact.nodes, artifact.edges);
  if (fromNodes.length >= 1) return fromNodes.filter(isOrderLabel);
  const fromColumn = orderColumnLabels(artifact);
  if (fromColumn.length >= 1) return fromColumn.filter(isOrderLabel);
  return parseNumberedSteps(`${extraText}\n${artifact.body}`).filter(isOrderLabel);
}

export type WorkLogPhase = "idle" | "running" | "done";

export function parseWorkLogPhase(raw: string): WorkLogPhase {
  const text = raw.trim();
  if (/완료|done/i.test(text)) return "done";
  if (/진행|running/i.test(text)) return "running";
  return "idle";
}

/** 실행 작업 표의 단계 이름 → 완료/진행 중/예정. */
export function phasesFromWorkLog(artifact: ProcedureArtifact): Map<string, WorkLogPhase> {
  const stepCol = artifact.columns.findIndex((column) => /^(단계|주차)$/.test(column.trim()));
  const statusCol = artifact.columns.findIndex((column) => /^상태$/.test(column.trim()));
  const out = new Map<string, WorkLogPhase>();
  if (stepCol < 0 || statusCol < 0) return out;
  for (const row of artifact.rows) {
    const label = (row[stepCol] ?? "").trim();
    if (!label) continue;
    out.set(label, parseWorkLogPhase(row[statusCol] ?? ""));
  }
  return out;
}

export function markdownFileRefs(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /`([^`]+\.md)`|(?:^|[\s,;])((?:docs|lectures|drills|skills|prompts)\/[^\s,;`]+?\.md)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const rel = (match[1] ?? match[2] ?? "").trim();
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    found.push(rel);
  }
  return found;
}

function isOrderLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (/^(목표|방향|진행|실행|기획|과정|plan|process)$/i.test(trimmed)) return false;
  if (/^(목표|goal|채택|보류|보완)\s*[:：]/.test(trimmed)) return false;
  return trimmed.length <= 80;
}

function enrichConstitutionVisual(
  visual: ArtifactVisual,
  title: string,
  summary: string,
  original: string,
  previous: ProcedureArtifact,
): ArtifactVisual {
  let next = { ...visual };
  const blob = `${summary}\n${original}`;
  const pairs = parseKeyValues(blob);
  if (looksLikeWorkDiagnosis(next.rows) && previous.rows.length > 0) {
    next = {
      ...next,
      columns: previous.columns,
      rows: previous.rows,
      nodes: next.nodes.length > 0 ? next.nodes : previous.nodes,
      edges: next.edges.length > 0 ? next.edges : previous.edges,
    };
  } else if (next.rows.length === 0 && pairs.length >= 1 && !looksLikeWorkDiagnosis(pairs)) {
    next = { ...next, columns: ["항목", "내용"], rows: pairs.slice(0, ARTIFACT_MAX_ROWS) };
  }
  if (nodesLookLikeKeyValuePairs(next.nodes)) {
    next = { ...next, nodes: [], edges: [] };
  }
  if (next.nodes.length === 0) {
    const sources = [summary, original].filter((text) => text.trim());
    for (const source of sources) {
      const diagram = parseArrowDiagram(source, title);
      if (diagram) {
        next = { ...next, nodes: diagram.nodes, edges: diagram.edges };
        break;
      }
    }
  }
  if (next.nodes.length === 0) {
    const labels = parseNumberedSteps(blob);
    if (labels.length >= 2) {
      const nodes = labels.map((label, index) => ({ id: `step-${index + 1}`, label }));
      const edges = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1]!.id }));
      next = { ...next, nodes, edges };
    }
  }
  if (next.columns.length > 0) next = { ...next, type: "table" };
  else if (next.nodes.length > 0) next = { ...next, type: "diagram" };
  return next;
}

function nodesLookLikeKeyValuePairs(nodes: ArtifactNode[]): boolean {
  return nodes.length > 0 && nodes.every((node) => /[:：]/.test(node.label));
}

function looksLikeWorkDiagnosis(rows: string[][]): boolean {
  const keys = rows.map((row) => (row[0] ?? "").trim());
  return keys.includes("영역") && keys.includes("약점");
}

function orderedNodeLabels(nodes: ArtifactNode[], edges: ArtifactEdge[]): string[] {
  if (nodes.length === 0) return [];
  if (edges.length === 0) return nodes.map((node) => node.label);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of queue) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(byId.get(id)!.label);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  for (const node of nodes) {
    if (!seen.has(node.id)) ordered.push(node.label);
  }
  return ordered;
}

function orderColumnLabels(artifact: ProcedureArtifact): string[] {
  const index = artifact.columns.findIndex((column) => /^(단계|순서|진행)$/.test(column.trim()));
  if (index < 0) return [];
  const labels = artifact.rows.map((row) => (row[index] ?? "").trim()).filter(Boolean);
  return labels.length >= 2 ? labels : [];
}

export function parseNumberedSteps(text: string): string[] {
  const labels: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*\d+[.)]\s+(.{1,80})$/.exec(line);
    if (!match) continue;
    const label = match[1]!.trim().replace(/\*\*/g, "");
    if (!label || /[{`]/.test(label)) continue;
    labels.push(label);
    if (labels.length >= ARTIFACT_MAX_NODES) break;
  }
  return labels.length >= 2 ? labels : [];
}

export function appendTalk(artifact: ProcedureArtifact, user: string, assistant: string): ProcedureArtifact {
  const messages = [...artifact.messages];
  if (user.trim()) messages.push({ role: "user", text: clip(user.trim(), ARTIFACT_MAX_BODY) });
  if (assistant.trim()) messages.push({ role: "assistant", text: clip(assistant.trim(), ARTIFACT_MAX_BODY) });
  return { ...artifact, messages };
}

export function artifactToMarkdown(artifact: ProcedureArtifact): string {
  const title = artifact.title.trim() || "단계 결과";
  const lines = [`# ${title}`, ""];
  if (artifact.lead.trim()) lines.push(artifact.lead.trim(), "");
  if (artifact.columns.length > 0) {
    lines.push(`| ${artifact.columns.join(" | ")} |`);
    lines.push(`| ${artifact.columns.map(() => "---").join(" | ")} |`);
    for (const row of artifact.rows) {
      const cells = artifact.columns.map((_, index) => escapeCell(row[index] ?? ""));
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  }
  if (artifact.nodes.length > 0) {
    lines.push("```mermaid");
    lines.push("flowchart LR");
    for (const node of artifact.nodes) {
      lines.push(`  ${mermaidId(node.id)}["${escapeMermaid(node.label)}"]`);
    }
    for (const edge of artifact.edges) {
      lines.push(`  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
    }
    lines.push("```");
    lines.push("");
  } else if (artifact.body.trim() && artifact.columns.length === 0) {
    lines.push(artifact.body.trim(), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function visualFromText(
  preferred: ProcessOutputView,
  title: string,
  summary: string,
  original: string,
): ArtifactVisual {
  const sources = [summary, original].filter((text) => text.trim());
  for (const source of sources) {
    const json = extractJson(source);
    if (json !== null) {
      const fromJson = visualFromJson(json, title, preferred);
      if (fromJson) return fromJson;
    }
  }
  for (const source of sources) {
    const table = parseMarkdownTable(source);
    if (table) {
      return { type: "table", title, columns: table.columns, rows: table.rows, nodes: [], edges: [], body: "", lead: leadBefore(source) };
    }
  }
  if (preferred === "diagram") {
    for (const source of sources) {
      const diagram = parseArrowDiagram(source, title);
      if (diagram) return diagram;
    }
  }
  for (const source of sources) {
    const pairs = parseKeyValues(source);
    if (pairs.length >= 2) {
      if (preferred === "diagram") return tablePairsAsDiagram(title, pairs);
      return {
        type: "table",
        title,
        columns: ["항목", "내용"],
        rows: pairs.slice(0, ARTIFACT_MAX_ROWS),
        nodes: [],
        edges: [],
        body: "",
    lead: "",
      };
    }
  }
  const body = clip((summary.trim() || original.trim()), ARTIFACT_MAX_BODY);
  return { type: "text", title, columns: [], rows: [], nodes: [], edges: [], body, lead: "" };
}

function visualFromJson(
  raw: unknown,
  title: string,
  preferred: ProcessOutputView,
): ArtifactVisual | null {
  if (Array.isArray(raw)) {
    const records = raw.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<
      string,
      unknown
    >[];
    if (records.length === 0) return null;
    const columns = uniqueKeys(records).slice(0, ARTIFACT_MAX_COLUMNS);
    const rows = records.slice(0, ARTIFACT_MAX_ROWS).map((record) => columns.map((column) => stringifyCell(record[column])));
    return { type: "table", title, columns, rows, nodes: [], edges: [], body: "", lead: "" };
  }
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const parsed = parseArtifact(rec, title);
  const hasTable = parsed.columns.length > 0 || parsed.rows.length > 0;
  const hasDiagram = parsed.nodes.length > 0;
  if (hasTable || hasDiagram) {
    return {
      type: hasTable ? "table" : "diagram",
      title: parsed.title || title,
      columns: parsed.columns,
      rows: parsed.rows,
      nodes: parsed.nodes,
      edges: parsed.edges,
      body: "",
    lead: "",
    };
  }
  if (typeof rec.body === "string" && rec.body.trim()) {
    return { type: preferred === "text" ? "text" : preferred, title, columns: [], rows: [], nodes: [], edges: [], body: rec.body, lead: "" };
  }
  return null;
}

function extractJson(text: string): unknown | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1]!.trim()) as unknown;
    } catch {
      // fall through to a whole-string parse
    }
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/**
 * First contiguous pipe-table block only. Filtering every pipe line in the
 * document instead pasted a second table's rows under the first one's header
 * -- a 목표.md with a 측정 table and a 완료 기준 table rendered as one garbled
 * grid. A beat's leading table is the one it is about.
 */
function firstTableBlock(text: string): string[] {
  const block: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const isRow = line.startsWith("|") && line.endsWith("|");
    if (isRow) block.push(line);
    else if (block.length > 0) break;
  }
  return block;
}

const LEAD_MAX_CHARS = 280;

/** 목록·인용·코드 펜스. 도입 문단이 아니라 그 자체가 내용이다. */
const NOT_PROSE = /^(?:[-*+>]\s|\d+[.)]\s|```|~~~)/;

/**
 * 첫 표 바로 앞 문단. 표를 찾는 순간 그 앞 산문을 통째로 버리던 탓에 "왜 이
 * 목표인가" 같은 도입 한 줄이 콘솔에서 사라졌다. **표 직전에 붙어 있는 산문
 * 한 문단만** 남긴다 -- 제목·목록·코드가 끼면 그 위는 이 표의 도입이 아니다.
 * (실행.md의 번호 목록이 통째로 도입문으로 딸려 오던 걸 이 규칙이 막는다.)
 */
export function leadBefore(text: string): string {
  let paragraph: string[] = [];
  let previous: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("|") && line.endsWith("|")) break;
    if (line.startsWith("#") || NOT_PROSE.test(line)) {
      paragraph = [];
      previous = [];
      continue;
    }
    if (!line) {
      if (paragraph.length > 0) previous = paragraph;
      paragraph = [];
      continue;
    }
    paragraph.push(line);
  }
  const lead = (paragraph.length > 0 ? paragraph : previous).join(" ").trim();
  return lead.length > LEAD_MAX_CHARS ? `${lead.slice(0, LEAD_MAX_CHARS - 1).trimEnd()}…` : lead;
}

function parseMarkdownTable(text: string): { columns: string[]; rows: string[][] } | null {
  const lines = firstTableBlock(text);
  if (lines.length < 2) return null;
  const columns = splitRow(lines[0]!);
  if (columns.length === 0) return null;
  const rows: string[][] = [];
  for (const line of lines.slice(1)) {
    if (/^\|?\s*:?-{3,}/.test(line.replaceAll("|", " ").trim()) || isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    if (cells.length === 0) continue;
    rows.push(columns.map((_, index) => cells[index] ?? ""));
    if (rows.length >= ARTIFACT_MAX_ROWS) break;
  }
  if (rows.length === 0) return null;
  return { columns: columns.slice(0, ARTIFACT_MAX_COLUMNS), rows };
}

function parseKeyValues(text: string): string[][] {
  const pairs: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:\n]{1,40})\s*[:：]\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.trim();
    const value = match[2]!.trim();
    if (!key || !value) continue;
    if (/^https?:\/\//i.test(key)) continue;
    pairs.push([key, value]);
    if (pairs.length >= ARTIFACT_MAX_ROWS) break;
  }
  return pairs;
}

function parseArrowDiagram(
  text: string,
  title: string,
): ArtifactVisual | null {
  const nodes = new Map<string, ArtifactNode>();
  const edges: ArtifactEdge[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(.+?)\s*(?:→|->|=>)\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const fromLabel = stripQuotes(match[1]!);
    const toLabel = stripQuotes(match[2]!);
    if (!fromLabel || !toLabel) continue;
    const from = nodeFromLabel(fromLabel, nodes);
    const to = nodeFromLabel(toLabel, nodes);
    edges.push({ from: from.id, to: to.id });
    if (nodes.size >= ARTIFACT_MAX_NODES) break;
  }
  if (nodes.size < 2) return null;
  return {
    type: "diagram",
    title,
    columns: [],
    rows: [],
    nodes: [...nodes.values()].slice(0, ARTIFACT_MAX_NODES),
    edges: edges.slice(0, ARTIFACT_MAX_NODES),
    body: "",
    lead: "",
  };
}

function tablePairsAsDiagram(
  title: string,
  pairs: string[][],
): ArtifactVisual {
  const nodes: ArtifactNode[] = pairs.slice(0, ARTIFACT_MAX_NODES).map((pair, index) => ({
    id: `n${index + 1}`,
    label: `${pair[0]}: ${pair[1]}`.slice(0, 80),
  }));
  const edges: ArtifactEdge[] = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1]!.id,
  }));
  return { type: "diagram", title, columns: [], rows: [], nodes, edges, body: "", lead: "" };
}

function nodeFromLabel(label: string, nodes: Map<string, ArtifactNode>): ArtifactNode {
  const id = slugId(label);
  const existing = nodes.get(id);
  if (existing) return existing;
  const node = { id, label: label.slice(0, 80) };
  nodes.set(id, node);
  return node;
}

function slugId(label: string): string {
  const ascii = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii.slice(0, 32);
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `n${Math.abs(hash)}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => clip(item, 80))
    .slice(0, max);
}

function asRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  const rows: string[][] = [];
  for (const row of value.slice(0, ARTIFACT_MAX_ROWS)) {
    if (!Array.isArray(row)) continue;
    rows.push(row.map((cell) => clip(stringifyCell(cell), 200)).slice(0, ARTIFACT_MAX_COLUMNS));
  }
  return rows;
}

function asNodes(value: unknown): ArtifactNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: ArtifactNode[] = [];
  for (const item of value.slice(0, ARTIFACT_MAX_NODES)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = asString(rec.id).trim();
    const label = asString(rec.label).trim() || id;
    if (!id) continue;
    nodes.push({ id: clip(id, 64), label: clip(label, 80) });
  }
  return nodes;
}

function asEdges(value: unknown): ArtifactEdge[] {
  if (!Array.isArray(value)) return [];
  const edges: ArtifactEdge[] = [];
  for (const item of value.slice(0, ARTIFACT_MAX_NODES)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const from = asString(rec.from).trim();
    const to = asString(rec.to).trim();
    if (!from || !to) continue;
    edges.push({ from: clip(from, 64), to: clip(to, 64) });
  }
  return edges;
}

function asMessages(value: unknown): TalkMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: TalkMessage[] = [];
  for (const item of value.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : null;
    const text = asString(rec.text).trim();
    if (!role || !text) continue;
    messages.push({ role, text: clip(text, ARTIFACT_MAX_BODY) });
  }
  return messages;
}

function uniqueKeys(records: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string): boolean {
  return splitRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeMermaid(value: string): string {
  return value.replaceAll('"', "'").replaceAll("]", "").replaceAll("\n", " ");
}

function mermaidId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_]/g, "_");
  return cleaned || "n";
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["'`]+|["'`]+$/g, "");
}
