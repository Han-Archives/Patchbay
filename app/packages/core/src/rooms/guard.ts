import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectStudioDir, readStudio } from "../studio/studioStore.js";
import { findBinding } from "./mirror.js";

/**
 * 묶인 세션의 쓰기 범위 (사용자 요청 2026-10-15 — 프로젝트 이름을 말하면 그 프로젝트만 건드리게).
 *
 * 폰 · 터미널의 Claude Code 세션이 `room_bind` 로 프로젝트에 묶이면, `PreToolUse` 훅
 * (`patchbay room guard`)이 파일을 쓰는 도구를 그 프로젝트 폴더 · 작업 공간의 그 프로젝트 폴더 ·
 * 임시 폴더 · Claude 기억 폴더 안으로만 허락한다. 읽기는 막지 않는다. 묶이지 않은 세션은 그대로다.
 *
 * Write · Edit · MultiEdit · NotebookEdit 는 경로로 정확히 본다. Bash 는 명령 글을 읽어 짐작한다:
 * 쓰는 명령(rm · mv · cp · 리다이렉트 · sed -i · git commit 등)이 있을 때, 지금 폴더나 명령에 적힌
 * 경로가 범위 밖이면 막는다. `node -e` 처럼 스크립트 안에서 쓰는 것까지는 잡지 못한다.
 */

export interface GuardInput {
  transcriptPath: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
}

export interface GuardDecision {
  alias: string;
  /** 막는 까닭. null 이면 허락. */
  deny: string | null;
}

const FILE_TOOLS: Record<string, string> = { Write: "file_path", Edit: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path" };

const SHELL_WRITE = [
  /(?:^|[\s;&|(`])(?:rm|rmdir|mv|cp|tee|touch|mkdir|ln|chmod|chown|truncate|dd|install|rsync|unzip|tar)\s/,
  /(?:^|[\s;&|(`])sed\s+(?:-[a-zA-Z]*i|--in-place)/,
  /(?:^|[\s;&|(`])git\s+(?:-C\s+\S+\s+)?(?:commit|push|reset|checkout|switch|merge|rebase|stash|add|rm|mv|restore|clean|apply|cherry-pick|tag|branch|init|clone)\b/,
  // 리다이렉트로 파일에 쓰기 (2>&1 · >/dev/null 은 뺀다)
  /(?<![0-9&<>])>{1,2}\s*(?!&|\/dev\/)[^\s;&|]/,
];

/** 아직 없는 파일도 실제 위치로 — 있는 조상까지 realpath 하고 나머지를 붙인다 (/tmp → /private/tmp). */
function realish(target: string): string {
  let current = path.resolve(target);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function expand(raw: string, cwd: string): string {
  const home = os.homedir();
  const text = raw === "~" ? home : raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw;
  return realish(path.isAbsolute(text) ? text : path.join(cwd, text));
}

function inside(target: string, roots: readonly string[]): boolean {
  return roots.some((root) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
}

/** 어느 프로젝트에서든 쓸 수 있는 곳: 임시 폴더와 Claude 기억 폴더. */
export function sharedGuardRoots(): string[] {
  return [os.tmpdir(), "/tmp", "/private/tmp", path.join(os.homedir(), ".claude", "projects")];
}

/** 묶인 프로젝트에서 쓸 수 있는 곳. */
export function guardRoots(studioHome: string, alias: string, projectPath: string | undefined, shared: readonly string[] = sharedGuardRoots()): string[] {
  const roots = [projectStudioDir(studioHome, alias), ...shared];
  if (projectPath) roots.unshift(projectPath);
  return [...new Set(roots.map(realish))];
}

/** 이 도구 호출이 쓰는 곳 중 범위 밖인 첫 경로. 쓰지 않거나 다 안이면 null. */
export function outsideTarget(toolName: string, toolInput: Record<string, unknown>, cwd: string, roots: readonly string[]): string | null {
  const field = FILE_TOOLS[toolName];
  if (field) {
    const file = toolInput[field];
    if (typeof file !== "string" || !file) return null;
    const target = expand(file, cwd);
    return inside(target, roots) ? null : target;
  }
  if (toolName !== "Bash") return null;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  if (!SHELL_WRITE.some((pattern) => pattern.test(command))) return null;
  const here = realish(cwd);
  if (!inside(here, roots)) return here;
  for (const match of command.matchAll(/(?:^|[\s='"(:])((?:~|\/|\.\.)[^\s'";|&<>()`]*)/g)) {
    const raw = match[1]!;
    if (raw === "/" || raw.startsWith("/dev/")) continue;
    const target = expand(raw, here);
    if (!inside(target, roots)) return target;
  }
  return null;
}

/** 세션 기록에서 묶음을 찾는다. `room_bind` 호출과 그 결과 줄만 읽는다. */
function bindingOf(transcriptPath: string): { alias: string; roomId: string } | null {
  let text = "";
  try {
    text = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const lines: Record<string, unknown>[] = [];
  for (const row of text.split("\n")) {
    if (!row.includes("room_bind") && !row.includes("bound")) continue;
    try { lines.push(JSON.parse(row) as Record<string, unknown>); } catch { /* 쓰는 중인 줄 */ }
  }
  return findBinding(lines);
}

/** 묶이지 않은 세션이면 null. 묶였으면 프로젝트와, 막을 때는 그 까닭. */
export async function guardTool(studioHome: string, input: GuardInput, shared: readonly string[] = sharedGuardRoots()): Promise<GuardDecision | null> {
  if (!FILE_TOOLS[input.toolName] && input.toolName !== "Bash") return null;
  const binding = bindingOf(input.transcriptPath);
  if (!binding) return null;
  const project = (await readStudio(studioHome)).projects.find((row) => row.alias === binding.alias);
  const roots = guardRoots(studioHome, binding.alias, project?.path, shared);
  const target = outsideTarget(input.toolName, input.toolInput, input.cwd || process.cwd(), roots);
  if (!target) return { alias: binding.alias, deny: null };
  return {
    alias: binding.alias,
    deny: `이 세션은 Patchbay 프로젝트 「${binding.alias}」에 묶여 있어 그 폴더(${project?.path ?? projectStudioDir(studioHome, binding.alias)}) 밖에는 쓸 수 없습니다: ${target}. 다른 프로젝트의 일이면 사용자에게 먼저 묻고, 허락을 받으면 room_bind 로 그 프로젝트에 다시 묶습니다.`,
  };
}
