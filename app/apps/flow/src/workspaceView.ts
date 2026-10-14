import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SCAFFOLD_DIR,
  SCAFFOLD_FILES,
  parseIr,
  readInferred,
  readOverlay,
  readProgress,
  readRunRecords,
  readStudio,
  readPassedNodes,
} from "@patchbay/core";
import { countCompleteCells } from "./irContract.js";
import { loadIrView } from "./irView.js";
import {
  attentionOf,
  currentStage,
  stagesOf,
  type DraftFact,
  type ProjectFacts,
  type WorkspaceLatest,
  type WorkspaceProject,
  type WorkspaceResponse,
} from "./workspaceContract.js";

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * 초안의 사실은 설계 화면과 같은 판정(`loadIrView`)에서 가져온다 — 레일이 「통과」라고
 * 하는데 설계 화면이 「막힘」이라고 하면 사람은 어느 쪽도 믿지 못한다.
 */
async function draftFact(studioHome: string, alias: string): Promise<DraftFact | null> {
  const view = await loadIrView(studioHome, alias, "proposed");
  if (!view.ok) return null;
  const body = view.body;
  if (body.status === "drafting") {
    return {
      readable: false,
      complete: countCompleteCells(body.progress),
      total: body.progress.total,
      error: body.error,
    };
  }
  if (body.status === "ready" && body.source === "proposed") {
    const judged = body.checks.filter((check) => check.ok !== null);
    return {
      readable: true,
      passed: judged.filter((check) => check.ok).length,
      total: judged.length,
      failedGates: body.failedGates,
    };
  }
  return null;
}

/** 구조 화면과 같은 구분 — 없음(스캔 전)과 깨짐(다시 스캔)은 다른 일이다. */
async function scanFact(studioHome: string, alias: string): Promise<ProjectFacts["scan"]> {
  try {
    const inferred = await readInferred(studioHome, alias);
    return { ports: inferred.discoveredPorts.length };
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : "broken";
  }
}

/** 생성기가 빈 노드에 남긴 표시(「노드 내부는 아직 비어 있다 (2.4)」)가 몇 개 남았나. */
async function filledFact(graphFile: string, total: number): Promise<{ total: number; empty: number } | null> {
  try {
    const text = await fs.readFile(graphFile, "utf8");
    const empty = (text.match(/노드 내부는 아직 비어 있다 \(2\.4\)/g) ?? []).length;
    return { total: Math.max(total, empty), empty };
  } catch {
    return null;
  }
}

async function projectFacts(studioHome: string, alias: string, repo: string): Promise<ProjectFacts> {
  const overlay = await readOverlay(studioHome, alias);
  const adoptedRead = overlay.ir ? parseIr(overlay.ir) : null;
  const scaffoldDir = path.join(repo, DEFAULT_SCAFFOLD_DIR);
  const scaffoldHits = await Promise.all(
    Object.values(SCAFFOLD_FILES).map((file) => exists(path.join(scaffoldDir, file))),
  );
  const { records } = await readRunRecords(studioHome, alias);
  const total = adoptedRead?.ok ? adoptedRead.ir.nodes.length : 0;
  const passed = await readPassedNodes(studioHome, alias);
  const nodeIds = adoptedRead?.ok ? new Set(adoptedRead.ir.nodes.map((n) => n.id)) : new Set<string>();
  return {
    scan: await scanFact(studioHome, alias),
    adopted: adoptedRead?.ok ? { version: adoptedRead.ir.version ?? null } : null,
    adoptedBroken: adoptedRead !== null && !adoptedRead.ok,
    draft: await draftFact(studioHome, alias),
    scaffold: scaffoldHits.some(Boolean),
    filled: await filledFact(path.join(scaffoldDir, SCAFFOLD_FILES.graph), total),
    runs: records.length,
    nodes: { total, passed: Object.keys(passed.nodes).filter((id) => nodeIds.has(id)).length },
  };
}

async function latestOf(studioHome: string, alias: string): Promise<WorkspaceLatest | null> {
  const progress = await readProgress(studioHome, alias);
  // `history` 는 최신이 앞이다 (`writeProgressEntry`).
  const entry = progress.current ?? progress.history[0] ?? null;
  if (!entry) return null;
  return { summary: entry.summary, ...(entry.step ? { step: entry.step } : {}), at: entry.timestamp };
}

/**
 * 가운데 프로젝트 레일과 왼쪽 주요 기능이 함께 읽는 한 장. 프로젝트마다 파일만 읽는다 —
 * LangGraph·Neo4j가 꺼져 있어도 같은 답이 나와야 한다 (원칙 7 — 파일이 원본).
 */
export async function loadWorkspace(studioHome: string): Promise<WorkspaceResponse> {
  const studio = await readStudio(studioHome);
  const projects: WorkspaceProject[] = await Promise.all(
    studio.projects.map(async (project) => {
      const stages = stagesOf(await projectFacts(studioHome, project.alias, project.path));
      return {
        alias: project.alias,
        ...(project.name ? { name: project.name } : {}),
        ...(project.hidden ? { hidden: true } : {}),
        path: project.path,
        stages,
        current: currentStage(stages),
        attention: attentionOf(stages),
        latest: await latestOf(studioHome, project.alias),
      };
    }),
  );
  return { projects };
}
