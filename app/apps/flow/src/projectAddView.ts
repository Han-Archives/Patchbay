import fs from "node:fs";
import path from "node:path";
import {
  ProjectAliasAlreadyRegisteredError,
  computeClarityScore,
  hasReadmePort,
  readInferred,
  readStudio,
  registerProject,
  scan,
  walk,
  writeOverlayIfAbsent,
  writeScanOutputs,
} from "@patchbay/core";
import { isBrokenScanError } from "./projectContract.js";

/** CLI `CLARITY_GATE_THRESHOLD` 와 같은 값 — 콘솔이 CLI를 부르지 않으므로 여기에 둔다. */
export const CLARITY_GATE_THRESHOLD = 40;

export interface AddProjectBody {
  path?: string;
  alias?: string;
  forceAdd?: boolean;
}

export type AddProjectResult =
  | { ok: true; status: 200; body: { alias: string; path: string; score: number } }
  | { ok: false; status: 400 | 409 | 422; error: string; score?: number; threshold?: number };

/**
 * `patchbay project add` 와 같은 일. 콘솔 「+ 신규 프로젝트」가 부른다.
 * 쓰기 경로는 Core `registerProject` 하나다 — 화면이 자기 studio.yaml 을 쓰지 않는다.
 */
export async function addProjectView(studioHome: string, payload: AddProjectBody): Promise<AddProjectResult> {
  const raw = payload.path?.trim() ?? "";
  if (!raw) return { ok: false, status: 400, error: "폴더 경로가 없다." };

  const absolutePath = path.resolve(raw);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    return { ok: false, status: 400, error: `폴더가 아니다: ${absolutePath}` };
  }

  const alias = (payload.alias?.trim() || path.basename(absolutePath)).trim();
  if (!alias) return { ok: false, status: 400, error: "이름이 없다." };

  const inferred = await scan(absolutePath);
  const allRelativePaths = walk(absolutePath).map((file) => file.relativePath);
  const score = computeClarityScore({
    hasReadme: hasReadmePort(inferred),
    commitSubjects: inferred.git.recentCommitSubjects,
    allRelativePaths,
  });

  if (score < CLARITY_GATE_THRESHOLD && !payload.forceAdd) {
    return {
      ok: false,
      status: 422,
      error: `명확도 ${score} 이 문턱 ${CLARITY_GATE_THRESHOLD} 보다 낮다. 그래도 등록하려면 「문턱을 넘지 않아도 등록」을 켠다.`,
      score,
      threshold: CLARITY_GATE_THRESHOLD,
    };
  }

  try {
    await registerProject(studioHome, { alias, kind: "local_repo", path: absolutePath });
  } catch (error) {
    if (error instanceof ProjectAliasAlreadyRegisteredError) {
      return { ok: false, status: 409, error: error.message };
    }
    throw error;
  }

  await writeOverlayIfAbsent(studioHome, alias);
  await writeScanOutputs(studioHome, alias, inferred);

  return { ok: true, status: 200, body: { alias, path: absolutePath, score } };
}

export type RescanProjectResult =
  | {
      ok: true;
      status: 200;
      body: { alias: string; path: string; ports: number; portsBefore: number | null; previousBroken: boolean; head: string };
    }
  | { ok: false; status: 400 | 404; error: string };

/**
 * `patchbay scan --project <alias>` 와 같은 일. 구조 화면의 「스캔」이 부른다.
 * 쓰기는 Core `writeScanOutputs` 하나 — overlay 는 건드리지 않는다.
 * `portsBefore` 는 앞 스캔이 없으면 `null` 이다(「0개였다」와 「없었다」를 합치지 않는다).
 */
export async function rescanProjectView(studioHome: string, alias: string | undefined): Promise<RescanProjectResult> {
  const name = alias?.trim() ?? "";
  if (!name) return { ok: false, status: 400, error: "이름이 없다." };

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === name);
  if (!registered) return { ok: false, status: 404, error: `등록된 프로젝트가 아니다: ${name}` };
  if (!fs.existsSync(registered.path) || !fs.statSync(registered.path).isDirectory()) {
    return { ok: false, status: 400, error: `폴더가 없다: ${registered.path}` };
  }

  let portsBefore: number | null = null;
  let previousBroken = false;
  try {
    portsBefore = (await readInferred(studioHome, name)).discoveredPorts.length;
  } catch (error) {
    // 깨진 앞 결과는 이번 스캔이 새로 쓴다 — 그래서 재스캔이 그 파일을 고치는 길이다.
    if (isBrokenScanError(error)) previousBroken = true;
    else if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const inferred = await scan(registered.path);
  await writeScanOutputs(studioHome, name, inferred);
  return {
    ok: true,
    status: 200,
    body: {
      alias: name,
      path: registered.path,
      ports: inferred.discoveredPorts.length,
      portsBefore,
      previousBroken,
      head: inferred.git.head,
    },
  };
}
