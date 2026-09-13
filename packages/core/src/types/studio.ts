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
});
export type StudioRegisteredProject = z.infer<typeof studioRegisteredProjectSchema>;

export const studioSchema = z.object({
  name: z.string(), // studio-level identity
  projects: z.array(studioRegisteredProjectSchema).default([]),
});
export type Studio = z.infer<typeof studioSchema>;
