import { z } from "zod";

/**
 * `studio.yaml` shape — the studio-wide registry of adopted projects.
 * v1 only supports one registered-project kind: "local_repo".
 */

export const STUDIO_PROJECT_KINDS = ["local_repo"] as const;
export type StudioProjectKind = (typeof STUDIO_PROJECT_KINDS)[number];
export const studioProjectKindSchema = z.enum(STUDIO_PROJECT_KINDS);

export const studioRegisteredProjectSchema = z.object({
  alias: z.string(),
  kind: studioProjectKindSchema,
  path: z.string(), // absolute local filesystem path to the project's repo root
  name: z.string().optional(), // what the console calls it; the alias stays the id
  // 콘솔 레일에서 숨긴다 (사용자 요청 2026-10-05). 등록은 그대로 — 지우지 않고 보관한다 (원칙 16).
  hidden: z.boolean().optional(),
  // 레포 안 문서 폴더 — 기획 · 절차 · 아키텍처가 여기 아래에 산다. 없으면 `docs`.
  // Patchbay 자신은 `knowledge/patchbay` (저장구조.md, 사용자 결정 2026-10-14).
  docs: z.string().optional(),
});
export type StudioRegisteredProject = z.infer<typeof studioRegisteredProjectSchema>;

export const DEFAULT_PROJECT_DOCS = "docs";

/** 등록 프로젝트의 문서 폴더 — 레포 뿌리 기준 상대 경로. */
export function projectDocs(project: { docs?: string | undefined }): string {
  const docs = project.docs?.trim().replace(/^\.?\/+|\/+$/g, "");
  return docs || DEFAULT_PROJECT_DOCS;
}

export const studioSchema = z.object({
  name: z.string(), // studio-level identity
  projects: z.array(studioRegisteredProjectSchema).default([]),
});
export type Studio = z.infer<typeof studioSchema>;
