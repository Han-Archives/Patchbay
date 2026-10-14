import fs from "node:fs/promises";
import path from "node:path";
import type { Board, BoardItem, BoardLink } from "../types/board.js";
import { parsePortId } from "../types/portId.js";
import {
  skillBayDir,
  skillBayDraftDir,
  skillDraftExists,
  skillPackageExists,
} from "./projectFiles.js";
import { resolveProjectAlias } from "./aliasResolution.js";
import { readBoard } from "./boardStore.js";
import { readStudio } from "./studioStore.js";

const BAY_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function isBaySlug(value: string): boolean {
  return BAY_SLUG.test(value) && parsePortId(`skill:${value}`).success;
}

/** Lowercase hyphen slug, or null if nothing valid remains. */
export function sanitizeSkillSlug(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return isBaySlug(trimmed) ? trimmed : null;
}

export function defaultDraftSlug(alias: string): string {
  const fromAlias = sanitizeSkillSlug(`from-${alias}`);
  return fromAlias ?? "from-board";
}

export interface HarvestInput {
  slug: string;
  alias: string;
  items: BoardItem[];
  links: BoardLink[];
}

export function renderHarvestedSkillMarkdown(input: HarvestInput): string {
  const itemRows =
    input.items.length === 0
      ? "| (없음) | | |"
      : input.items
          .map((item) => `| ${item.kind} | \`${item.ref}\` | ${escapeTable(item.title)} |`)
          .join("\n");
  const linkLines =
    input.links.length === 0
      ? "- (없음)"
      : input.links.map((link) => `- \`${link.from}\` → \`${link.to}\``).join("\n");

  return `---
name: ${input.slug}
description: ${input.alias} 보드에서 수확한 초안. 커널이 실행하지 않는다. 확정은 사람.
---

# ${input.slug}

이 파일은 Patchbay가 **실행하지 않는** 스킬 초안이다. 호스트(Cursor/Claude Code/터미널)가 읽고 사람이 확정한다. 워커 세션을 원격으로 켜지 않는다.

## 출처

- 프로젝트: \`${input.alias}\`
- 보드 항목 ${input.items.length}개, 연결 ${input.links.length}개

## 보드 항목

| kind | ref | title |
| --- | --- | --- |
${itemRows}

## 보드 연결

보드 위 선은 실행이 아니다.

${linkLines}

## 절차

1. **시작 기록.**
   \`\`\`
   patchbay progress write --project ${input.alias} --summary "${input.slug}: 보드 구간 검토 시작" --skill ${input.slug} --step start
   \`\`\`
2. 위 항목을 사람이 검토한다. 실행은 LangGraph, 검색은 Neo4j, 배치는 캔버스. 이 스킬은 안내만 한다.
3. 초안이면 \`patchbay skill accept ${input.slug}\` 로 Skill Bay에 확정한 뒤 \`patchbay patch ${input.slug} ${input.alias}\` 로 설치한다.
4. **종료 기록.**
   \`\`\`
   patchbay progress write --project ${input.alias} --summary "${input.slug}: 검토 완료" --skill ${input.slug} --step done
   \`\`\`

## 하지 않는 것

- 워커 세션을 원격으로 켜지 않는다.
- LangGraph invoke나 Neo4j 검색을 대신 하지 않는다.
- 확정 Skill Bay 패키지(\`skills/${input.slug}/\`)를 확인 없이 덮지 않는다.
- 이 파일을 쓰는 커널 경로가 스킬을 실행하지 않는다.
`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export type WriteSkillDraftResult =
  | { ok: true; slug: string; alias: string; path: string; overwritten: boolean }
  | { ok: false; reason: "invalid_slug" | "empty_board" | "unknown_alias"; message: string };

export async function writeSkillDraft(
  studioHome: string,
  alias: string,
  options: { slug?: string; itemIds?: string[] } = {},
): Promise<WriteSkillDraftResult> {
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, alias);
  if (!resolution.ok) {
    return { ok: false, reason: "unknown_alias", message: resolution.message };
  }

  const slug = options.slug ? sanitizeSkillSlug(options.slug) : defaultDraftSlug(resolution.alias);
  if (!slug) {
    return { ok: false, reason: "invalid_slug", message: `skill: "${options.slug}" is not a valid Bay slug.` };
  }

  const board = await readBoard(studioHome, resolution.alias);
  const items = selectItems(board, options.itemIds);
  if (items.length === 0) {
    return {
      ok: false,
      reason: "empty_board",
      message: `skill: project "${resolution.alias}" has no board items to harvest.`,
    };
  }
  const ids = new Set(items.map((item) => item.id));
  const links = board.links.filter((link) => ids.has(link.from) && ids.has(link.to));

  const dir = skillBayDraftDir(studioHome, slug);
  const filePath = path.join(dir, "SKILL.md");
  const overwritten = await skillDraftExists(studioHome, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, renderHarvestedSkillMarkdown({ slug, alias: resolution.alias, items, links }), "utf8");
  return { ok: true, slug, alias: resolution.alias, path: filePath, overwritten };
}

function selectItems(board: Board, itemIds: string[] | undefined): BoardItem[] {
  if (!itemIds) return board.items;
  const wanted = new Set(itemIds);
  return board.items.filter((item) => wanted.has(item.id));
}

export type AcceptSkillDraftResult =
  | { ok: true; slug: string; path: string }
  | { ok: false; reason: "invalid_slug" | "no_draft" | "already_confirmed"; message: string };

/**
 * Promotes `skills/<slug>.proposed` to `skills/<slug>`. Does not overwrite
 * a confirmed package. Does not run the skill.
 */
export async function acceptSkillDraft(studioHome: string, slugRaw: string): Promise<AcceptSkillDraftResult> {
  const slug = sanitizeSkillSlug(slugRaw);
  if (!slug) {
    return { ok: false, reason: "invalid_slug", message: `skill: "${slugRaw}" is not a valid Bay slug.` };
  }
  if (!(await skillDraftExists(studioHome, slug))) {
    return {
      ok: false,
      reason: "no_draft",
      message: `skill: no draft at ${skillBayDraftDir(studioHome, slug)}/SKILL.md.`,
    };
  }
  if (await skillPackageExists(studioHome, slug)) {
    return {
      ok: false,
      reason: "already_confirmed",
      message: `skill: confirmed package already exists at ${skillBayDir(studioHome, slug)}. Will not overwrite.`,
    };
  }
  const dest = skillBayDir(studioHome, slug);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(skillBayDraftDir(studioHome, slug), dest);
  return { ok: true, slug, path: path.join(dest, "SKILL.md") };
}

/**
 * Copies bundled skill packages into the studio Bay when the destination
 * slug is absent. Never overwrites a confirmed or proposed package.
 * `bundledRoot` is `packages/skills` (one directory per slug with SKILL.md).
 */
export async function seedBundledSkills(studioHome: string, bundledRoot: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(bundledRoot);
  } catch {
    return [];
  }
  const seeded: string[] = [];
  for (const name of entries.sort()) {
    if (!isBaySlug(name)) continue;
    const source = path.join(bundledRoot, name);
    const skillMd = path.join(source, "SKILL.md");
    try {
      const stat = await fs.stat(source);
      if (!stat.isDirectory()) continue;
      await fs.access(skillMd);
    } catch {
      continue;
    }
    if (await skillPackageExists(studioHome, name)) continue;
    if (await skillDraftExists(studioHome, name)) continue;
    await fs.cp(source, skillBayDir(studioHome, name), { recursive: true });
    seeded.push(name);
  }
  return seeded;
}
