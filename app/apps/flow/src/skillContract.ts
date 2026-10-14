/** Client-safe skill harvest types (spec 3.1e / P8). */

export function defaultConsoleSkillSlug(alias: string): string {
  const s = alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s ? `from-${s}` : "from-board";
}

export interface SkillDraftResponse {
  alias: string;
  slug: string;
  path: string;
  overwritten: boolean;
}

export interface SkillAcceptResponse {
  slug: string;
  path: string;
}
