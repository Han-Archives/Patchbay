import fs from "node:fs/promises";
import path from "node:path";
import { projectStudioDir } from "../studio/studioStore.js";
import { parseRunRecord, type RunRecord } from "./types.js";

/**
 * Where run records live (명세 §5.3): `~/.patchbay/projects/<alias>/runs/<runId>.json`
 * -- **one run, one file.**
 *
 * 원칙 7: the file is the original and Neo4j is an index a re-ingest rebuilds.
 * Traces and token logs do not go into Neo4j at all (기획서 §6) -- a time series
 * belongs to an external observability tool, and putting it in the replica
 * would make the replica impossible to rebuild.
 */

export const RUNS_DIR_NAME = "runs";

export function projectRunsDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), RUNS_DIR_NAME);
}

export function runRecordPath(studioHome: string, alias: string, runId: string): string {
  return path.join(projectRunsDir(studioHome, alias), `${safeRunId(runId)}.json`);
}

/**
 * A provider's run id becomes a filename, so it cannot carry a separator or a
 * parent reference. Rejected rather than sanitized: a silently renamed id
 * stops matching the record's own `runId` field and the pair becomes unjoinable.
 */
export function safeRunId(runId: string): string {
  if (!runId || runId.includes("/") || runId.includes("\\") || runId === "." || runId === "..") {
    throw new Error(`실행 기록: runId "${runId}" 는 파일 이름이 될 수 없다.`);
  }
  return runId;
}

/** Writes one record. Refuses a record whose id and filename would disagree. */
export async function writeRunRecord(studioHome: string, alias: string, record: RunRecord): Promise<string> {
  const file = runRecordPath(studioHome, alias, record.runId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return file;
}

export type ReadRunRecordResult = { ok: true; record: RunRecord } | { ok: false; error: string; file: string };

export async function readRunRecord(
  studioHome: string,
  alias: string,
  runId: string,
): Promise<ReadRunRecordResult> {
  const file = runRecordPath(studioHome, alias, runId);
  return readRunRecordFile(file);
}

export async function readRunRecordFile(file: string): Promise<ReadRunRecordResult> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      file,
      error: code === "ENOENT" ? `${file} 가 없다.` : `${file} 를 읽지 못했다 — ${(error as Error).message}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, file, error: `${file} 의 JSON이 깨졌다 — ${(error as Error).message}` };
  }
  const parsed = parseRunRecord(raw);
  return parsed.ok ? { ok: true, record: parsed.record } : { ok: false, file, error: parsed.error };
}

export interface RunRecordsRead {
  records: RunRecord[];
  /** Files that are there but unreadable. Counted and named, never silently dropped. */
  rejected: Array<{ file: string; error: string }>;
}

/**
 * Every run record for a project, oldest first.
 *
 * A broken file is reported, not skipped: an operating view that quietly showed
 * "3 runs" when the directory held four would be worse than one that says the
 * fourth could not be read.
 */
export async function readRunRecords(studioHome: string, alias: string): Promise<RunRecordsRead> {
  const dir = projectRunsDir(studioHome, alias);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], rejected: [] };
    throw error;
  }

  const records: RunRecord[] = [];
  const rejected: Array<{ file: string; error: string }> = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    const read = await readRunRecordFile(path.join(dir, name));
    if (read.ok) records.push(read.record);
    else rejected.push({ file: read.file, error: read.error });
  }
  records.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));
  return { records, rejected };
}
