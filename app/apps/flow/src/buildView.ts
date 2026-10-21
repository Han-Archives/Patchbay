import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SCAFFOLD_DIR,
  SCAFFOLD_FILES,
  chooseExistingBuild,
  compareNodeSets,
  parseIr,
  readExistingBuild,
  readOverlay,
  readStudio,
  recordExistingResults,
  setExistingLink,
  summarizeExistingBuild,
  writeExistingLink,
  writeScaffold,
  type ExistingBuild,
  type Ir,
} from "@patchbay/core";
import type {
  BuildGenerateResponse,
  BuildViewExisting,
  BuildViewResponse,
  ExistingActionResponse,
  NodeSetComparison,
  ScaffoldFileView,
} from "./buildContract.js";
import { runExistingTests } from "./existingRunner.js";

/**
 * 세 파일이 무엇인지 화면에 한 줄로 같이 둔다 (visual-first 3 — 용어 옆에 뜻).
 * 이름은 커널이 정하므로 (`SCAFFOLD_FILES`) 설명도 그 이름에 걸어 여기 둔다.
 */
const SCAFFOLD_FILE_ROLE: Record<string, string> = {
  [SCAFFOLD_FILES.state]: "State — IR의 state 칸이 타입과 reducer가 된다",
  [SCAFFOLD_FILES.graph]: "Graph — 노드와 엣지. 사람 승인 자리는 주석으로 남는다",
  [SCAFFOLD_FILES.evals]: "평가 테스트 — IR의 평가가 빈 테스트로 선다",
};

/**
 * 2단계(구현) 화면의 서버 쪽. **입구를 화면에 내는 것이 이 파일의 이유다** — 채택까지는
 * 화면에서 닫히는데 뼈대 생성만 터미널(`patchbay ir generate`)에 남아 있었다.
 *
 * 쓰기 경로는 Core `writeScaffold` 하나다 (원칙 8). 화면이 자기 생성기를 갖지 않으므로
 * CLI로 하든 여기서 하든 같은 바이트가 나오고, 「있는 파일을 덮지 않는다」(원칙 3)도
 * 화면에서 다시 구현되지 않는다. `--force` 가 없는 것도 그대로다.
 */

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

export type LoadBuildResult =
  | { ok: true; body: BuildViewResponse }
  | { ok: false; status: 400 | 404; error: string };

/**
 * 승인본이 없으면 `locked` 를 돌려준다 — 오류가 아니다. 1단계를 아직 지나지 않은 것은
 * 정상 상태이고, 그 자리에서 1 설계로 돌려보내는 것이 화면이 할 일이다.
 */
export async function loadBuildView(studioHome: string, aliasInput?: unknown): Promise<LoadBuildResult> {
  const alias = typeof aliasInput === "string" ? aliasInput.trim() : "";
  if (!alias) return { ok: false, status: 400, error: "build: alias 가 필요하다." };

  const studio = await readStudio(studioHome);
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) return { ok: false, status: 404, error: `build: "${alias}" 는 등록된 프로젝트가 아니다.` };

  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) {
    return {
      ok: true,
      body: {
        status: "locked",
        alias,
        reason: "설계(IR)가 아직 채택되지 않았다.",
        next: "1 설계에서 초안을 채택하면 여기서 뼈대를 생성한다 — 2단계는 1단계의 산출물만 먹는다.",
      },
    };
  }

  const parsed = parseIr(overlay.ir);
  if (!parsed.ok) {
    return {
      ok: true,
      body: {
        status: "locked",
        alias,
        reason: `승인본이 IR로 읽히지 않는다 — ${parsed.error}`,
        next: "1 설계에서 overlay.ir 을 고치거나 초안을 다시 채택한다.",
      },
    };
  }

  const existing = await readExistingBuild(studioHome, alias);
  if (existing) return { ok: true, body: existingView(alias, parsed.ir, existing) };

  const outDir = path.join(project.path, DEFAULT_SCAFFOLD_DIR);
  const files: ScaffoldFileView[] = await Promise.all(
    Object.values(SCAFFOLD_FILES).map(async (file) => ({
      file,
      role: SCAFFOLD_FILE_ROLE[file] ?? "",
      exists: await exists(path.join(outDir, file)),
      path: `${DEFAULT_SCAFFOLD_DIR}/${file}`,
    })),
  );

  // 생성 전에는 `graph.ts` 가 없다 — 빈 원본을 넘기면 IR 노드가 전부 `missing` 으로 온다.
  const graphSource = await readIfExists(path.join(outDir, SCAFFOLD_FILES.graph));
  return {
    ok: true,
    body: {
      status: "ready",
      alias,
      version: parsed.ir.version ?? null,
      outDir: DEFAULT_SCAFFOLD_DIR,
      files,
      generated: files.every((file) => file.exists),
      nodes: compareNodeSets(parsed.ir, graphSource ?? ""),
      ir: parsed.ir,
    },
  };
}

export type GenerateScaffoldResult =
  | { ok: true; body: BuildGenerateResponse }
  | { ok: false; status: 400 | 404 | 409; error: string; failedGates?: string[]; nodes?: NodeSetComparison };

/**
 * 「뼈대 생성」 버튼. 승인본(`overlay.ir`)만 먹는다 — 초안으로 생성하는 길(CLI `--proposed`)은
 * 화면에 내지 않는다. 화면에서 그것까지 열면 사람이 채택을 건너뛰고 코드를 만들게 된다.
 */
export async function generateScaffoldView(
  studioHome: string,
  payload: Record<string, unknown>,
): Promise<GenerateScaffoldResult> {
  const alias = typeof payload.alias === "string" ? payload.alias.trim() : "";
  if (!alias) return { ok: false, status: 400, error: "ir generate: alias 가 필요하다." };

  const studio = await readStudio(studioHome);
  const project = studio.projects.find((entry) => entry.alias === alias);
  if (!project) return { ok: false, status: 404, error: `ir generate: "${alias}" 는 등록된 프로젝트가 아니다.` };

  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) {
    return {
      ok: false,
      status: 409,
      error: `ir generate: "${alias}" 의 설계가 채택되지 않았다 — 1 설계에서 채택한 뒤에 생성한다.`,
    };
  }

  const parsed = parseIr(overlay.ir);
  if (!parsed.ok) return { ok: false, status: 409, error: `ir generate: ${parsed.error}` };

  const result = await writeScaffold(parsed.ir, path.join(project.path, DEFAULT_SCAFFOLD_DIR), {
    docRoot: project.path,
  });
  if (!result.ok) {
    return {
      ok: false,
      status: 409,
      error: result.error,
      failedGates: result.checks?.failedGates ?? [],
      ...(result.nodes ? { nodes: result.nodes } : {}),
    };
  }

  return {
    ok: true,
    body: {
      ok: true,
      written: result.written,
      skipped: result.skipped.map((row) => row.file),
      outDir: DEFAULT_SCAFFOLD_DIR,
      nodes: result.nodes,
    },
  };
}

function existingView(alias: string, ir: Ir, build: ExistingBuild): BuildViewExisting {
  return {
    status: "existing",
    alias,
    version: ir.version ?? null,
    chosenAt: build.chosenAt,
    ranAt: build.ranAt,
    summary: summarizeExistingBuild(ir, build),
    ir,
  };
}

/** 같은 프로젝트의 테스트를 겹쳐 돌리지 않는다 — 결과가 서로를 덮는다. */
const running = new Set<string>();

/**
 * 「이미 구현됨」 길의 동작 (사용자 결정 2026-10-20). 쓰기는 모두 커널 저장 함수로 간다 —
 * 화면에서 넣은 연결은 사람이 넣은 것이라 바로 확인된 연결이다. 에이전트 제안은 CLI `build link` 로 들어온다.
 */
export async function existingBuildAction(
  studioHome: string,
  payload: Record<string, unknown>,
): Promise<{ status: 200 | 400 | 404 | 409; body: ExistingActionResponse }> {
  const alias = typeof payload.alias === "string" ? payload.alias.trim() : "";
  const text = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : "");
  if (!alias) return { status: 400, body: { ok: false, error: "alias 가 필요하다." } };
  const project = (await readStudio(studioHome)).projects.find((entry) => entry.alias === alias);
  if (!project) return { status: 404, body: { ok: false, error: `"${alias}" 는 등록된 프로젝트가 아니다.` } };
  const overlay = await readOverlay(studioHome, alias);
  const parsed = overlay.ir ? parseIr(overlay.ir) : null;
  if (!parsed?.ok) return { status: 409, body: { ok: false, error: "설계가 채택되지 않았다 — 1 설계에서 채택한 뒤에 고른다." } };

  try {
    const action = text("action");
    if (action === "choose") {
      await chooseExistingBuild(studioHome, alias);
    } else if (action === "link") {
      await writeExistingLink(studioHome, alias, { requirement: text("requirement"), file: text("file"), test: text("test"), code: text("code"), by: "person" });
    } else if (action === "confirm" || action === "remove") {
      await setExistingLink(studioHome, alias, text("id"), action);
    } else if (action === "run") {
      if (running.has(alias)) return { status: 409, body: { ok: false, error: "이 프로젝트의 테스트가 이미 돌고 있다." } };
      running.add(alias);
      try {
        const build = await readExistingBuild(studioHome, alias);
        if (!build) throw new Error("「이미 구현됨」 길을 고르지 않았다.");
        await recordExistingResults(studioHome, alias, await runExistingTests(project.path, build.links));
      } finally {
        running.delete(alias);
      }
    } else {
      return { status: 400, body: { ok: false, error: `모르는 동작 "${action}".` } };
    }
  } catch (error) {
    return { status: 400, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  }
  const build = await readExistingBuild(studioHome, alias);
  return { status: 200, body: { ok: true, view: existingView(alias, parsed.ir, build!) } };
}
