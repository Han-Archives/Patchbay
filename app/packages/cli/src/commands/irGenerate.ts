import path from "node:path";
import {
  DEFAULT_SCAFFOLD_DIR,
  parseIr,
  readIrFile,
  readOverlay,
  readProposedIr,
  readStudio,
  resolveProjectAlias,
  resolveStudioHome,
  writeScaffold,
} from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface IrGenerateCommandOptions {
  project?: string;
  file?: string;
  docs?: string;
  proposed?: boolean;
  out?: string;
  json?: boolean;
}

/**
 * `patchbay ir generate [--project <alias>] [--out <dir>] [--json]`
 *
 * 2.1–2.3: emit `state.ts`, `graph.ts`, `evals.test.ts` once. There is no
 * `--force`. A file that already exists is left alone; a second run that
 * overwrote it would be the bidirectional sync 원칙 3 forbids.
 *
 * The gate still applies: a design that fails 1.9 is refused, because 2단계는
 * 1단계의 산출물만 먹는다. After a write (or a skip), the node set in
 * `graph.ts` is compared to `ir.nodes[]` — that is 2.6.
 */
export async function runIrGenerate(
  options: IrGenerateCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  const alias = resolution.alias;
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) {
    printError(json, `ir generate: "${alias}" 는 등록된 프로젝트가 아니다.`);
    return 1;
  }

  let raw: unknown;
  let docRoot = project.path;
  if (options.file) {
    const read = await readIrFile(options.file);
    if (!read.ok) {
      printError(json, `ir generate: ${read.error}`);
      return 1;
    }
    raw = read.raw;
    docRoot = path.dirname(path.resolve(options.file));
  } else if (options.proposed) {
    const read = await readProposedIr(studioHome, alias);
    if (!read.ok) {
      printError(json, `ir generate: ${read.error}`);
      return 1;
    }
    raw = read.raw;
  } else {
    const overlay = await readOverlay(studioHome, alias);
    if (!overlay.ir) {
      printError(
        json,
        `ir generate: "${alias}" 의 overlay.yaml 에 ir 절이 없다 — 1단계를 통과한 뒤에 생성한다.\n` +
          `  초안으로 생성하려면: patchbay ir generate --project ${alias} --proposed`,
      );
      return 1;
    }
    raw = overlay.ir;
  }

  const parsed = parseIr(raw);
  if (!parsed.ok) {
    printError(json, parsed.error);
    return 1;
  }

  if (options.docs) docRoot = path.resolve(options.docs);
  const outDir = options.out
    ? path.resolve(options.out)
    : path.join(project.path, DEFAULT_SCAFFOLD_DIR);

  const result = await writeScaffold(parsed.ir, outDir, { docRoot });
  if (!result.ok) {
    printError(json, `ir generate: ${result.error}`, {
      ok: false,
      error: result.error,
      failedGates: result.checks?.failedGates ?? [],
      nodes: result.nodes ?? null,
      written: result.written ?? [],
      skipped: result.skipped ?? [],
    });
    return 1;
  }

  printResult(
    json,
    {
      ok: true,
      project: alias,
      outDir: result.outDir,
      written: result.written,
      skipped: result.skipped,
      nodes: result.nodes,
    },
    [
      result.written.length
        ? `생성했다 — ${result.written.join(", ")}`
        : "이미 있는 파일은 그대로 두었다.",
      `위치: ${result.outDir}`,
      ...(result.skipped.length
        ? [`건너뜀: ${result.skipped.map((row: { file: string }) => row.file).join(", ")}`]
        : []),
      `노드 집합: IR ${result.nodes.ir.length} = 코드 ${result.nodes.graph.length}`,
    ],
  );
  return 0;
}
