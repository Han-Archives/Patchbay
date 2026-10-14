import fs from "node:fs/promises";
import path from "node:path";
import { projectDocs, readStudio } from "@patchbay/core";
import { OVERVIEW_FILE } from "./overviewContract.js";

const MAX_BYTES = 256 * 1024;

/** `GET /api/overview` — 등록 프로젝트 문서 폴더의 `개요.md`. 없으면 404(화면은 PRD로 그린다). */
export async function readOverviewDoc(
  studioHome: string,
  alias: string | undefined,
): Promise<{ ok: true; rel: string; content: string } | { ok: false; status: 400 | 404; error: string }> {
  if (!alias?.trim()) return { ok: false, status: 400, error: "overview: alias is required." };
  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias.trim());
  if (!registered) return { ok: false, status: 404, error: `No project registered with alias "${alias.trim()}".` };
  const root = path.resolve(registered.path);
  const rel = `${projectDocs(registered)}/${OVERVIEW_FILE}`;
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, status: 400, error: "overview: path is outside the project." };
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_BYTES) return { ok: false, status: 400, error: "overview: 개요.md 가 너무 크다." };
    return { ok: true, rel, content: await fs.readFile(abs, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, status: 404, error: `overview: ${rel} 이 없다.` };
    throw error;
  }
}
