import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { projectStudioDir } from "./studioStore.js";
import { readOverlay, clearOverlayDecisions } from "./projectFiles.js";
import { readProgress, writeProgressMd } from "./progressStore.js";
import { renderProgressMd } from "../render/progressRenderer.js";
import { progressSchema } from "../types/progress.js";

/**
 * 0 구조의 옛 저작물을 보관하고 비운다 (사용자 요청 2026-10-07 — 「지금 적은 것과 너무 달라 혼란만 준다」).
 *
 * 비우는 것: 요구 · 구현 기록(`progress.yaml` · `PROGRESS.md`), 결정(`overlay.decisions`).
 * 남기는 것: 스캔 결과(레포 상태 — 다시 스캔하면 갱신된다), 설계(IR · 초안 · 상담), 배치도, 기획 단계(`overlay.process` —
 * 레포의 `docs/기획` 에서 화면을 열 때마다 다시 채워지므로 여기서 비워도 돌아온다. 레포 문서는 사람의 것이라 건드리지 않는다).
 * 지우지 않는다 (원칙 16) — `archive/structure-<시각>/` 에 원본을 그대로 옮겨 둔다.
 */
export interface ResetStructureResult {
  archiveDir: string;
  archived: { progress: number; decisions: number };
}

export async function resetAuthoredStructure(studioHome: string, alias: string, now: Date = new Date()): Promise<ResetStructureResult> {
  const dir = projectStudioDir(studioHome, alias);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(dir, "archive", `structure-${stamp}`);
  await fs.mkdir(archiveDir, { recursive: true });

  const progress = await readProgress(studioHome, alias);
  const overlay = await readOverlay(studioHome, alias);
  for (const name of ["progress.yaml", "PROGRESS.md"]) {
    await fs.copyFile(path.join(dir, name), path.join(archiveDir, name)).catch(() => undefined);
  }
  await fs.writeFile(
    path.join(archiveDir, "overlay.authored.yaml"),
    YAML.stringify({ decisions: overlay.decisions }),
    "utf8",
  );

  const empty = progressSchema.parse({ current: null, history: [] });
  await fs.writeFile(path.join(dir, "progress.yaml"), YAML.stringify(empty), "utf8");
  await writeProgressMd(studioHome, alias, renderProgressMd(empty));
  await clearOverlayDecisions(studioHome, alias);

  return {
    archiveDir,
    archived: {
      progress: (progress.current ? 1 : 0) + progress.history.length,
      decisions: overlay.decisions.length
    },
  };
}
