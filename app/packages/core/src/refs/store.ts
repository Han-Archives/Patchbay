import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { projectStudioDir } from "../studio/studioStore.js";
import { irReferenceSchema, type IrReference } from "../types/ir.js";

/**
 * 참고 자료 — 설계가 기대는 링크 · 파일 · 이미지 (SRS의 References · Volere의 Relevant facts,
 * 사용자 요청 2026-10-05). `~/.patchbay/projects/<alias>/refs/` 에 파일, `refs.yaml` 에 목록.
 * 지우면 `refs/archive/` 로 옮긴다 — 삭제 대신 보관 (원칙 16).
 */

export const REFS_DIR_NAME = "refs";
export const REFS_INDEX_NAME = "refs.yaml";
/** 한 파일 상한. 설계 자료는 스크린샷 · 문서 한두 개다 — 동영상이나 데이터셋을 담는 곳이 아니다. */
export const REF_MAX_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

export function refsDir(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), REFS_DIR_NAME);
}

export async function listRefs(studioHome: string, alias: string): Promise<IrReference[]> {
  try {
    const raw = YAML.parse(await fs.readFile(path.join(projectStudioDir(studioHome, alias), REFS_INDEX_NAME), "utf8"));
    const list = Array.isArray(raw?.refs) ? raw.refs : [];
    return list.map((r: unknown) => irReferenceSchema.safeParse(r)).filter((r: { success: boolean }) => r.success).map((r: { data?: IrReference }) => r.data!);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeIndex(studioHome: string, alias: string, refs: IrReference[]): Promise<void> {
  const dir = projectStudioDir(studioHome, alias);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, REFS_INDEX_NAME), `# 설계 참고 자료 — 설문 0층에서 붙인다.\n${YAML.stringify({ refs })}`, "utf8");
}

function nextId(refs: IrReference[]): string {
  const used = new Set(refs.map((r) => r.id));
  for (let n = refs.length + 1; ; n += 1) if (!used.has(`F${n}`)) return `F${n}`;
}

export type AddRefResult = { ok: true; ref: IrReference } | { ok: false; error: string };

export async function addLinkRef(
  studioHome: string,
  alias: string,
  input: { url: string; title?: string; note?: string },
): Promise<AddRefResult> {
  const url = input.url.trim();
  if (!/^https?:\/\//.test(url)) return { ok: false, error: "링크는 http:// 나 https:// 로 시작해야 한다." };
  const refs = await listRefs(studioHome, alias);
  const ref: IrReference = { id: nextId(refs), title: input.title?.trim() || url, kind: "link", uri: url, ...(input.note?.trim() ? { note: input.note.trim() } : {}) };
  await writeIndex(studioHome, alias, [...refs, ref]);
  return { ok: true, ref };
}

/** 이름에서 경로 · 이상한 글자를 걷어 낸다. 확장자는 지킨다 — 이미지 여부가 거기서 나온다. */
export function safeRefName(name: string): string {
  const base = path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return base || "file";
}

export async function addFileRef(
  studioHome: string,
  alias: string,
  input: { name: string; data: Buffer; title?: string; note?: string },
): Promise<AddRefResult> {
  if (input.data.length === 0) return { ok: false, error: "빈 파일이다." };
  if (input.data.length > REF_MAX_BYTES) return { ok: false, error: `파일이 너무 크다 — ${REF_MAX_BYTES / 1024 / 1024}MB까지.` };
  const refs = await listRefs(studioHome, alias);
  const id = nextId(refs);
  const fileName = `${id}-${safeRefName(input.name)}`;
  const dir = refsDir(studioHome, alias);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), input.data);
  const kind = IMAGE_EXT.has(path.extname(fileName).toLowerCase()) ? "image" : "file";
  const ref: IrReference = { id, title: input.title?.trim() || input.name, kind, uri: fileName, ...(input.note?.trim() ? { note: input.note.trim() } : {}) };
  await writeIndex(studioHome, alias, [...refs, ref]);
  return { ok: true, ref };
}

/** 목록에서 빼고 파일은 `refs/archive/` 로 옮긴다. */
export async function archiveRef(studioHome: string, alias: string, id: string): Promise<boolean> {
  const refs = await listRefs(studioHome, alias);
  const ref = refs.find((r) => r.id === id);
  if (!ref) return false;
  if (ref.kind !== "link") {
    const dir = refsDir(studioHome, alias);
    await fs.mkdir(path.join(dir, "archive"), { recursive: true });
    await fs.rename(path.join(dir, ref.uri), path.join(dir, "archive", ref.uri)).catch(() => undefined);
  }
  await writeIndex(studioHome, alias, refs.filter((r) => r.id !== id));
  return true;
}

/** 파일 · 이미지의 실제 경로. 목록에 있는 것만 — 아무 경로나 읽게 하지 않는다. */
export async function refFilePath(studioHome: string, alias: string, id: string): Promise<string | null> {
  const ref = (await listRefs(studioHome, alias)).find((r) => r.id === id);
  if (!ref || ref.kind === "link") return null;
  return path.join(refsDir(studioHome, alias), path.basename(ref.uri));
}
