import fs from "node:fs/promises";
import path from "node:path";
import {
  computeAtlasSections,
  projectRelPathFromPort,
  readInferred,
  readOverlay,
  readStudio,
} from "@patchbay/core";

/**
 * One line saying what a port actually is, for the 구조 tab's jacks.
 *
 * A skill states its own purpose in `SKILL.md` frontmatter (`description:`),
 * which is exactly this line and is preferred wherever it exists. Everything
 * else falls back to the file's first real paragraph -- its heading only
 * restates the filename, and the paragraph under it is where a markdown file
 * says why it exists.
 */

export const PORT_SUMMARY_MAX_CHARS = 110;
/** Enough for frontmatter plus an opening paragraph; these are small files. */
const READ_LIMIT_BYTES = 8 * 1024;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const DESCRIPTION = /^description:[ \t]*(.+)$/m;

function stripQuotes(value: string): string {
  const first = value[0];
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}

/** Markdown emphasis, code ticks and link syntax read as noise on one line. */
function plainInline(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1).trimEnd()}…` : value;
}

/** A block that carries no prose: a heading, a table row, a rule, a list bullet. */
function isStructural(block: string): boolean {
  return (
    block.startsWith("#") ||
    block.startsWith("|") ||
    block.startsWith(">") ||
    /^[-*+=]{3,}$/.test(block) ||
    /^[-*+]\s/.test(block) ||
    /^\d+\.\s/.test(block)
  );
}

export function summarizeMarkdown(raw: string, maxChars: number = PORT_SUMMARY_MAX_CHARS): string {
  const front = FRONTMATTER.exec(raw);
  if (front) {
    const described = DESCRIPTION.exec(front[1] ?? "");
    if (described?.[1]) {
      const line = plainInline(stripQuotes(described[1].trim()));
      if (line) return clip(line, maxChars);
    }
  }

  const body = front ? raw.slice(front[0].length) : raw;
  for (const rawBlock of body.split(/\r?\n[ \t]*\r?\n/)) {
    const block = rawBlock.trim();
    if (!block || isStructural(block)) continue;
    const line = plainInline(block);
    if (line) return clip(line, maxChars);
  }
  return "";
}

export interface PortSummaryView {
  /** Project-relative path, or null when the port is not a file in this repo. */
  path: string | null;
  summary: string;
}

export type PortSummaryMap = Record<string, PortSummaryView>;

export type LoadPortSummariesResult =
  | { ok: true; body: { alias: string; ports: PortSummaryMap } }
  | { ok: false; status: 400 | 404; error: string };

async function readHead(absPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    return raw.length > READ_LIMIT_BYTES ? raw.slice(0, READ_LIMIT_BYTES) : raw;
  } catch {
    return null;
  }
}

/**
 * Summaries for every port the 구조 tab draws. Read from the project's own
 * working tree rather than anything cached, and loaded only when that tab
 * opens -- there is no reason to touch 50 files to render the 개발 segment.
 */
export async function loadPortSummaries(
  studioHome: string,
  alias: string | undefined,
): Promise<LoadPortSummariesResult> {
  if (!alias) {
    return { ok: false, status: 400, error: "ports: alias query parameter is required." };
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    const known = studio.projects.map((project) => project.alias);
    return {
      ok: false,
      status: 404,
      error:
        `No project registered with alias "${alias}". ` +
        (known.length > 0
          ? `Registered aliases: ${known.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    };
  }

  let inferred;
  try {
    inferred = await readInferred(studioHome, alias);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, body: { alias, ports: {} } };
    }
    throw error;
  }

  const overlay = await readOverlay(studioHome, alias);
  const sections = computeAtlasSections(inferred, overlay);
  const ports = new Set<string>([...sections.skills, ...sections.rules, ...sections.unlabeledPorts]);
  // Core's `matched` is a {patch, wire} pair; the other two are flat entries.
  const pairs = [
    ...sections.matched.map((match) => match.patch),
    ...sections.patchesWithoutWire,
    ...sections.wiresWithoutPatch,
  ];
  for (const pair of pairs) {
    ports.add(pair.from);
    ports.add(pair.to);
  }

  const result: PortSummaryMap = {};
  await Promise.all(
    [...ports].map(async (port) => {
      const rel = projectRelPathFromPort(port);
      if (!rel) {
        result[port] = { path: null, summary: "" };
        return;
      }
      const raw = await readHead(path.join(registered.path, rel));
      result[port] = { path: raw === null ? null : rel, summary: raw ? summarizeMarkdown(raw) : "" };
    }),
  );

  return { ok: true, body: { alias, ports: result } };
}
