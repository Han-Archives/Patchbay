import fs from "node:fs/promises";
import {
  parseRunRecord,
  readRunRecords,
  resolveProjectAlias,
  resolveStudioHome,
  readStudio,
  writeRunRecord,
  type RunRecord,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface RunsCollectCommandOptions {
  project?: string;
  file?: string;
  json?: boolean;
}

/**
 * `patchbay runs collect --project <alias> --file <record.json>`
 *
 * Takes a record an adapter already normalized to §5.2 and files it at
 * `runs/<runId>.json`. Any provider's adapter can feed this — the console's
 * LangGraph adapter writes through the same Core functions, so the CLI is not a
 * second ingest path with its own rules (원칙 8).
 *
 * Validates before writing. A record that fails §5.2 is refused with the field
 * named, because a malformed record in the runs directory makes every later
 * count wrong and nothing would say why.
 */
export async function runRunsCollect(
  options: RunsCollectCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  if (!options.file) {
    printError(json, "runs collect: --file <실행 기록 JSON> 이 필요하다.");
    return 1;
  }
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  const alias = resolution.alias;

  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(options.file, "utf8"));
  } catch (error) {
    printError(json, `runs collect: ${options.file} 를 읽지 못했다 — ${(error as Error).message}`);
    return 1;
  }

  const records: unknown[] = Array.isArray(raw) ? raw : [raw];
  const written: string[] = [];
  const refused: string[] = [];
  for (const item of records) {
    const parsed = parseRunRecord(item);
    if (!parsed.ok) {
      refused.push(parsed.error);
      continue;
    }
    const record: RunRecord = parsed.record;
    await writeRunRecord(studioHome, alias, record);
    written.push(record.runId);
  }

  if (written.length === 0) {
    printError(json, `runs collect: 수집한 기록이 없다.\n${refused.join("\n")}`, {
      ok: false,
      project: alias,
      written,
      refused,
    });
    return 1;
  }

  const after = await readRunRecords(studioHome, alias);
  const byStatus: Record<string, number> = {};
  for (const record of after.records) byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;

  printResult(
    json,
    { ok: true, project: alias, written, refused, total: after.records.length, byStatus },
    [
      `실행 기록 수집 — ${alias}`,
      "",
      `  받은 것 ${written.length}건: ${written.join(" · ")}`,
      ...(refused.length ? [`  거절 ${refused.length}건:`, ...refused.map((line) => `    ${line}`)] : []),
      "",
      `  지금 보관된 기록 ${after.records.length}건 — ` +
        Object.entries(byStatus)
          .map(([status, count]) => `${status} ${count}`)
          .join(" · "),
    ],
  );
  return refused.length > 0 ? 1 : 0;
}
