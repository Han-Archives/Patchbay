import fs from "node:fs/promises";
import path from "node:path";
import { projectDocs, readStudio } from "@patchbay/core";
import { modelIssues, structureModelSchema, structureRel, type StructureModel } from "./structureModel.js";

export type StructureResponse =
  | { status: "ready"; rel: string; model: StructureModel; issues: string[] }
  | { status: "missing"; rel: string }
  | { status: "broken"; rel: string; error: string };

/** 프로젝트 문서 폴더의 `기획/구조도.json`을 읽고 균형 검사 결과를 붙인다. 검사가 실패해도 그림은 보인다 — 어긋난 곳을 옆에 적는다. */
export async function loadStructureModel(studioHome: string, alias: string): Promise<{ ok: true; body: StructureResponse } | { ok: false; status: 404; error: string }> {
  const project = (await readStudio(studioHome)).projects.find(row => row.alias === alias);
  if (!project) return { ok: false, status: 404, error: "등록된 프로젝트가 아닙니다." };
  const rel = structureRel(projectDocs(project));
  const root = path.resolve(project.path), abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: true, body: { status: "broken", rel, error: "문서 폴더가 프로젝트 밖을 가리킵니다." } };
  let raw: string;
  try { raw = await fs.readFile(abs, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, body: { status: "missing", rel } };
    throw error;
  }
  let parsed: ReturnType<typeof structureModelSchema.safeParse>;
  try { parsed = structureModelSchema.safeParse(JSON.parse(raw)); }
  catch { return { ok: true, body: { status: "broken", rel, error: "JSON 형식이 아닙니다." } }; }
  if (!parsed.success) return { ok: true, body: { status: "broken", rel, error: parsed.error.issues.map(issue => `${issue.path.join(".")} ${issue.message}`).join("; ") } };
  return { ok: true, body: { status: "ready", rel, model: parsed.data, issues: modelIssues(parsed.data) } };
}
