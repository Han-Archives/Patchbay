import { acceptSkillDraft, patchSkill, writeSkillDraft } from "@patchbay/core";

export type SkillMutationResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

export async function distillSkillDraft(
  studioHome: string,
  input: { alias?: unknown; slug?: unknown; itemIds?: unknown },
): Promise<SkillMutationResult> {
  if (typeof input.alias !== "string" || !input.alias.trim()) {
    return { ok: false, status: 400, error: "skill: alias is required." };
  }
  const slug = optionalString(input.slug);
  const itemIds = optionalStringArray(input.itemIds);
  if (!itemIds.ok) return itemIds;
  const result = await writeSkillDraft(studioHome, input.alias.trim(), {
    slug,
    itemIds: itemIds.value,
  });
  if (!result.ok) {
    const status = result.reason === "unknown_alias" ? 404 : 400;
    return { ok: false, status, error: result.message };
  }
  return {
    ok: true,
    status: 200,
    body: {
      alias: result.alias,
      slug: result.slug,
      path: result.path,
      overwritten: result.overwritten,
    },
  };
}

export async function acceptSkillDraftView(
  studioHome: string,
  input: { slug?: unknown },
): Promise<SkillMutationResult> {
  if (typeof input.slug !== "string" || !input.slug.trim()) {
    return { ok: false, status: 400, error: "skill: slug is required." };
  }
  const result = await acceptSkillDraft(studioHome, input.slug.trim());
  if (!result.ok) {
    const status = result.reason === "no_draft" ? 404 : 400;
    return { ok: false, status, error: result.message };
  }
  return { ok: true, status: 200, body: { slug: result.slug, path: result.path } };
}

/**
 * `patchbay patch <slug> <alias>` 와 같은 일 — 배치도의 「프로젝트에 설치」가 부른다. 확정된 스킬을
 * 프로젝트 `skills/<slug>/` 에 심볼릭 링크(안 되면 복사)로 놓고 실제 연결을 기록한다. 검사 · 설치 ·
 * 기록은 Core `patchSkill` 하나다.
 */
export async function patchSkillView(
  studioHome: string,
  input: { slug?: unknown; alias?: unknown },
): Promise<SkillMutationResult> {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const alias = typeof input.alias === "string" ? input.alias.trim() : "";
  if (!slug || !alias) return { ok: false, status: 400, error: "skill: slug 와 alias 가 필요하다." };
  const result = await patchSkill(studioHome, slug, alias);
  if (!result.ok) {
    return { ok: false, status: result.reason === "bad-slug" ? 400 : 404, error: result.error };
  }
  return { ok: true, status: 200, body: { slug, alias, install: result.install, to: result.wire.to } };
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalStringArray(
  value: unknown,
): { ok: true; value: string[] | undefined } | { ok: false; status: 400; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, status: 400, error: "skill: itemIds must be an array of strings." };
  }
  return { ok: true, value: value.map((entry) => entry.trim()).filter(Boolean) };
}
