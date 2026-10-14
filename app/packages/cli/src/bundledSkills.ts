import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedBundledSkills } from "@patchbay/core";

/**
 * `packages/skills` next to `packages/cli` (`src/` or `dist/` → `../../skills`).
 */
export function bundledSkillsRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
}

export async function seedStudioBay(studioHome: string): Promise<string[]> {
  if (!fs.existsSync(bundledSkillsRoot())) return [];
  return seedBundledSkills(studioHome, bundledSkillsRoot());
}
