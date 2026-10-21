import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectStudioDir, readStudio } from "./studioStore.js";
import { readOverlay } from "./projectFiles.js";
import { withFileLock } from "../rooms/store.js";
import { parseIr, type Ir } from "../types/ir.js";

/**
 * 「이미 구현됨」 길 (사용자 결정 2026-10-20, 절차 `이미구현-길-설계안_20261020_v1`).
 *
 * 이미 코드가 있는 프로젝트는 2 구현을 뼈대 생성 대신 「요구사항 ↔ 기존 테스트」 연결로 지난다.
 * 연결은 IR 밖에 둔다 — IR은 사람이 채택한 설계이고 이것은 구현 쪽 사실이라, 섞으면 테스트 이름 하나
 * 바꿀 때마다 설계 판이 오른다. 이 파일이 있으면 그 프로젝트는 이 길이다.
 *
 * 판정에는 사람이 확인한 연결만 쓴다. 3 테스트 결과는 연결마다 여기 남긴다 — `passed-nodes.json` 에는
 * 쓰지 않는다. 쓰면 4 · 5가 열리는데, 이 길에서는 열지 않기로 했다(같은 결정).
 */
export const EXISTING_BUILD_FILE_NAME = "existing-build.json";

export const existingLinkResultSchema = z.object({
  state: z.enum(["pass", "fail", "missing"]),
  at: z.string(),
  note: z.string().optional(),
});
export type ExistingLinkResult = z.infer<typeof existingLinkResultSchema>;

export const existingLinkSchema = z.object({
  id: z.string().min(1),
  requirement: z.string().min(1),
  /** 프로젝트 폴더 기준 테스트 파일. */
  file: z.string().min(1),
  /** describe · it 이름을 ` > ` 로 이은 것. 비면 그 파일 전체. */
  test: z.string().default(""),
  /** 그 요구사항을 구현한 코드 파일 (선택). */
  code: z.string().optional(),
  state: z.enum(["proposed", "confirmed"]),
  by: z.enum(["agent", "person"]),
  at: z.string(),
  result: existingLinkResultSchema.optional(),
});
export type ExistingLink = z.infer<typeof existingLinkSchema>;

const fileSchema = z.object({
  mode: z.literal("existing"),
  chosenAt: z.string(),
  links: z.array(existingLinkSchema).default([]),
  ranAt: z.string().nullable().default(null),
});
export type ExistingBuild = z.infer<typeof fileSchema>;

export function existingBuildPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), EXISTING_BUILD_FILE_NAME);
}

export function existingLinkId(requirement: string, file: string, test: string): string {
  return `${requirement}::${file}::${test}`;
}

/** 없으면 null — 그 프로젝트는 뼈대 길이다. */
export async function readExistingBuild(studioHome: string, alias: string): Promise<ExistingBuild | null> {
  let text: string;
  try {
    text = await fs.readFile(existingBuildPath(studioHome, alias), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return fileSchema.parse(JSON.parse(text));
}

async function update(
  studioHome: string,
  alias: string,
  change: (fresh: ExistingBuild | null) => ExistingBuild | Promise<ExistingBuild>,
): Promise<ExistingBuild> {
  const file = existingBuildPath(studioHome, alias);
  await fs.mkdir(path.dirname(file), { recursive: true });
  return withFileLock(file, async () => {
    const fresh = await readExistingBuild(studioHome, alias);
    const next = fileSchema.parse(await change(fresh));
    if (JSON.stringify(fresh) !== JSON.stringify(next)) {
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await fs.rename(tmp, file);
    }
    return next;
  });
}

function requireChosen(build: ExistingBuild | null, alias: string): ExistingBuild {
  if (!build) throw new Error(`"${alias}" 는 「이미 구현됨」 길을 고르지 않았다 — 2 구현에서 먼저 고른다.`);
  return build;
}

/** 2 구현에서 이 길을 고른다. 이미 골랐으면 그대로 둔다. */
export function chooseExistingBuild(studioHome: string, alias: string, now = new Date()): Promise<ExistingBuild> {
  return update(studioHome, alias, (fresh) => fresh ?? { mode: "existing", chosenAt: now.toISOString(), links: [], ranAt: null });
}

async function adoptedIr(studioHome: string, alias: string): Promise<Ir> {
  const overlay = await readOverlay(studioHome, alias);
  if (!overlay.ir) throw new Error(`"${alias}" 의 설계가 채택되지 않았다.`);
  const parsed = parseIr(overlay.ir);
  if (!parsed.ok) throw new Error(`승인본이 IR로 읽히지 않는다 — ${parsed.error}`);
  return parsed.ir;
}

function relativeInside(file: string, what: string): string {
  const clean = file.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean || path.isAbsolute(clean) || clean.split("/").includes("..")) {
    throw new Error(`${what} "${file}" — 프로젝트 폴더 기준 상대 경로여야 한다.`);
  }
  return clean;
}

export interface ExistingLinkInput {
  requirement: string;
  file: string;
  test?: string;
  code?: string;
  by: "agent" | "person";
}

/**
 * 연결 한 줄을 넣는다. 사람이 넣으면 확인된 연결, 에이전트가 넣으면 제안이다.
 * 같은 요구사항 · 파일 · 테스트가 이미 있으면 덮되, 확인된 연결을 제안으로 내리지 않는다.
 * 요구사항은 승인본에 있어야 하고 파일은 실제로 있어야 한다 — 없는 것을 이으면 판정이 거짓이 된다.
 */
export async function writeExistingLink(studioHome: string, alias: string, input: ExistingLinkInput, now = new Date()): Promise<ExistingLink> {
  const ir = await adoptedIr(studioHome, alias);
  const requirement = input.requirement.trim();
  if (!ir.requirements.some((req) => req.id === requirement)) throw new Error(`요구사항 "${requirement}" 는 승인본에 없다.`);
  const file = relativeInside(input.file, "테스트 파일");
  const code = input.code?.trim() ? relativeInside(input.code, "코드 파일") : undefined;
  const project = (await readStudio(studioHome)).projects.find((entry) => entry.alias === alias);
  if (!project) throw new Error(`"${alias}" 는 등록된 프로젝트가 아니다.`);
  for (const rel of [file, ...(code ? [code] : [])]) {
    try {
      await fs.access(path.join(project.path, rel));
    } catch {
      throw new Error(`"${rel}" 가 프로젝트에 없다.`);
    }
  }
  const test = (input.test ?? "").trim();
  const id = existingLinkId(requirement, file, test);
  let written: ExistingLink | null = null;
  await update(studioHome, alias, (fresh) => {
    const build = requireChosen(fresh, alias);
    const before = build.links.find((link) => link.id === id);
    const state = before?.state === "confirmed" || input.by === "person" ? "confirmed" : "proposed";
    written = { id, requirement, file, test, ...(code ? { code } : {}), state, by: before?.by ?? input.by, at: now.toISOString(), ...(before?.result ? { result: before.result } : {}) };
    return { ...build, links: [...build.links.filter((link) => link.id !== id), written] };
  });
  return written!;
}

/** 화면의 확인 · 버리기. 버린 연결은 남기지 않는다 — 제안은 다시 만들 수 있다. */
export function setExistingLink(studioHome: string, alias: string, id: string, action: "confirm" | "remove", now = new Date()): Promise<ExistingBuild> {
  return update(studioHome, alias, (fresh) => {
    const build = requireChosen(fresh, alias);
    if (!build.links.some((link) => link.id === id)) throw new Error(`연결 "${id}" 가 없다.`);
    const links = action === "remove"
      ? build.links.filter((link) => link.id !== id)
      : build.links.map((link) => (link.id === id ? { ...link, state: "confirmed" as const, by: "person" as const, at: now.toISOString() } : link));
    return { ...build, links };
  });
}

/** 3 테스트 결과. 이번에 돌리지 않은 연결의 지난 결과는 그대로 둔다. */
export function recordExistingResults(
  studioHome: string,
  alias: string,
  results: ReadonlyArray<{ id: string; state: ExistingLinkResult["state"]; note?: string }>,
  now = new Date(),
): Promise<ExistingBuild> {
  const at = now.toISOString();
  const byId = new Map(results.map((row) => [row.id, row]));
  return update(studioHome, alias, (fresh) => {
    const build = requireChosen(fresh, alias);
    const links = build.links.map((link) => {
      const row = byId.get(link.id);
      return row ? { ...link, result: { state: row.state, at, ...(row.note ? { note: row.note } : {}) } } : link;
    });
    return { ...build, links, ranAt: at };
  });
}

export type ExistingRequirementState = "unlinked" | "untested" | "fail" | "pass";

export interface ExistingRequirementSummary {
  id: string;
  text: string;
  nodes: string[];
  links: ExistingLink[];
  state: ExistingRequirementState;
}

export interface ExistingBuildSummary {
  requirements: ExistingRequirementSummary[];
  /** 노드 id → 그 노드에 이은 요구사항 수와 통과 수. */
  nodes: Record<string, { total: number; passed: number }>;
  total: number;
  /** 확인된 연결이 하나라도 있는 요구사항. */
  linked: number;
  passed: number;
  /** 확인 기다리는 제안 수. */
  proposed: number;
}

/**
 * 요구사항은 확인된 연결이 있고 그 연결이 모두 통과했을 때 통과다. 제안은 세지 않는다.
 * 하나라도 실패 · 못 찾음이면 실패, 아직 안 돌린 연결이 있으면 미실행.
 */
export function summarizeExistingBuild(ir: Ir, build: ExistingBuild): ExistingBuildSummary {
  const requirements = ir.requirements.map((req): ExistingRequirementSummary => {
    const links = build.links.filter((link) => link.requirement === req.id);
    const confirmed = links.filter((link) => link.state === "confirmed");
    const state: ExistingRequirementState = confirmed.length === 0
      ? "unlinked"
      : confirmed.some((link) => link.result && link.result.state !== "pass")
        ? "fail"
        : confirmed.every((link) => link.result?.state === "pass")
          ? "pass"
          : "untested";
    const nodes = [...new Set(ir.requirementLinks.filter((row) => row.requirement === req.id).map((row) => row.node))];
    return { id: req.id, text: req.summary ?? req.text, nodes, links, state };
  });
  const nodes: ExistingBuildSummary["nodes"] = {};
  for (const node of ir.nodes) {
    const mine = requirements.filter((req) => req.nodes.includes(node.id));
    nodes[node.id] = { total: mine.length, passed: mine.filter((req) => req.state === "pass").length };
  }
  return {
    requirements,
    nodes,
    total: requirements.length,
    linked: requirements.filter((req) => req.state !== "unlinked").length,
    passed: requirements.filter((req) => req.state === "pass").length,
    proposed: build.links.filter((link) => link.state === "proposed").length,
  };
}
