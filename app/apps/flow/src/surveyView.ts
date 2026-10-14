import fs from "node:fs/promises";
import path from "node:path";
import {
  buildSurveyView,
  classifyPath,
  listRefs,
  readStudio,
  readSurveyAnswers,
  saveSurveyAnswer,
  surveyDraftBase,
  type SurveyContext,
  type SurveyView,
} from "@patchbay/core";

/**
 * 1 설계의 설문 (사용자 결정 2026-10-05 — 설계는 묻고 고르며 구체화한다).
 * 문항 · 분기 · 답 → 설계도는 전부 커널이 한다. 여기서는 스캔 결과로 선택지를 채워 건넬 뿐이다.
 */

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "__pycache__", ".next", "coverage"]);

/**
 * 「어느 폴더를 읽나」 「어느 문서를 주나」의 선택지 — 등록된 레포를 얕게(3단) 읽는다.
 * 스캔 결과(`discoveredPorts`)는 신호 파일만 담아서 폴더 · 문서 목록으로 모자라다.
 * 숨은 폴더 · 의존성 폴더는 건너뛰고, 경로 등급이 비밀(L4)이면 뺀다.
 */
export async function surveyContext(studioHome: string, alias: string): Promise<SurveyContext> {
  const studio = await readStudio(studioHome);
  const root = studio.projects.find((p) => p.alias === alias)?.path;
  if (!root) return { folders: [], markdown: [], references: await listRefs(studioHome, alias) };
  const folders: string[] = [];
  const markdown: string[] = [];
  async function walk(rel: string, depth: number): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(root!, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        if (classifyPath(`${child}/x`).level >= 4) continue;
        if (depth < 2) folders.push(child);
        if (depth < 3) await walk(child, depth + 1);
      } else if (entry.name.endsWith(".md") && classifyPath(child).level < 4 && markdown.length < 200) {
        markdown.push(child);
      }
    }
  }
  await walk("", 0);
  return { folders, markdown, references: await listRefs(studioHome, alias) };
}

export type SurveyResponse = { ok: true; body: SurveyView & { alias: string } } | { ok: false; status: 400 | 404 | 409; error: string; conflict?: boolean };

export async function loadSurveyView(studioHome: string, alias: string | undefined): Promise<SurveyResponse> {
  if (!alias) return { ok: false, status: 400, error: "alias is required." };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === alias)) return { ok: false, status: 404, error: `등록된 프로젝트가 아니다: ${alias}` };
  const [{ answers }, ctx] = await Promise.all([readSurveyAnswers(studioHome, alias), surveyContext(studioHome, alias)]);
  return { ok: true, body: { alias, ...buildSurveyView(answers, ctx) } };
}

export async function answerSurvey(
  studioHome: string,
  input: { alias?: unknown; item?: unknown; value?: unknown; force?: unknown },
): Promise<SurveyResponse> {
  const alias = typeof input.alias === "string" ? input.alias : "";
  const item = typeof input.item === "string" ? input.item : "";
  if (!alias || !item) return { ok: false, status: 400, error: "alias and item are required." };
  const studio = await readStudio(studioHome);
  if (!studio.projects.some((p) => p.alias === alias)) return { ok: false, status: 404, error: `등록된 프로젝트가 아니다: ${alias}` };
  const ctx = await surveyContext(studioHome, alias);
  const saved = await saveSurveyAnswer(
    studioHome,
    alias,
    { item, value: input.value ?? null, force: input.force === true },
    ctx,
    await surveyDraftBase(studioHome, alias),
  );
  if (!saved.ok) return { ok: false, status: saved.status, error: saved.error, ...(saved.conflict ? { conflict: true } : {}) };
  return loadSurveyView(studioHome, alias);
}
