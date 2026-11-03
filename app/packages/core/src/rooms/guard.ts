import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectStudioDir, readStudio, requireStudioHome } from "../studio/studioStore.js";
import { findBinding, hasSessionState, recordGuardIssue, sessionBinding } from "./mirror.js";

/**
 * 묶인 세션의 쓰기 범위 (사용자 요청 2026-10-15 — 프로젝트 이름을 말하면 그 프로젝트만 건드리게).
 *
 * 폰 · 터미널의 Claude Code 세션이 `room_bind` 로 프로젝트에 묶이면, `PreToolUse` 훅
 * (`patchbay room guard`)이 파일을 쓰는 도구를 그 프로젝트 폴더 · 작업 공간의 그 프로젝트 폴더 ·
 * 임시 폴더 · Claude 기억 폴더 안으로만 허락한다. 읽기는 막지 않는다. 묶이지 않은 세션은 그대로다.
 *
 * Write · Edit · MultiEdit · NotebookEdit 는 경로로 정확히 본다. Bash 는 명령 글을 읽어 짐작한다:
 * 쓰는 명령(rm · mv · cp · 리다이렉트 · sed -i · git commit 등)이 있을 때, 지금 폴더나 명령에 적힌
 * 경로가 범위 밖이면 막는다. 셸에 감싼 짧은 스크립트의 대표 파일 쓰기 API도 같은 범위로 검사한다.
 * 삭제 명령은 범위 안이어도 PreToolUse가 사람의 승인을 묻게 한다.
 *
 * 묶음을 확인한 뒤 난 오류는 막는다. 묶음을 확인하기 전의 오류 · 이상한 경우는 허용하되
 * 세션 상태(`room-mirror/<세션>.json` `guardIssues`)에 남긴다 (사용자 결정 2026-11-03).
 */

export interface GuardInput {
  /** 훅 입력의 `session_id`. 세션 기록이 없을 때 `recordSessionBinding` 이 적은 묶음을 찾는다. */
  sessionId?: string;
  transcriptPath: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
}

export interface GuardDecision {
  alias: string;
  /** 막는 까닭. null 이면 허락. */
  deny: string | null;
  /** 삭제처럼 범위 안이지만 사람 확인이 필요한 까닭. */
  ask?: string;
}

const FILE_TOOLS: Record<string, string> = { Write: "file_path", Edit: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path" };

const SHELL_WRITE = [
  /(?:^|[\s;&|(`'"])(?:rm|rmdir|mv|cp|tee|touch|mkdir|ln|chmod|chown|truncate|dd|install|rsync|unzip|tar)\s/,
  /(?:^|[\s;&|(`'"])sed\s+(?:-[a-zA-Z]*i|--in-place)/,
  /(?:^|[\s;&|(`'"])git\s+(?:-C\s+\S+\s+)?(?:commit|push|reset|checkout|switch|merge|rebase|stash|add|rm|mv|restore|clean|apply|cherry-pick|tag|branch|init|clone)\b/,
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rename|renameSync|copyFile|copyFileSync|rm|rmSync|unlink|unlinkSync)\s*\(/,
  /\b(?:open|Path)\s*\([^)]*,\s*['"](?:w|a|x)[+b]?['"]|\.(?:write_text|write_bytes|mkdir|rename|replace|unlink|rmdir)\s*\(/,
  // 리다이렉트로 파일에 쓰기 (2>&1 · >/dev/null · 화살표 => · >= 는 뺀다)
  /(?<![0-9&<>=])>{1,2}\s*(?!&|\/dev\/)[^\s;&|=>]/,
];

const SHELL_DELETE = [
  /(?:^|[\s;&|(`'"])(?:rm|rmdir)\s/,
  /(?:^|[\s;&|(`'"])git\s+(?:-C\s+\S+\s+)?(?:rm|clean)\b/,
  /\b(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/,
  /\.(?:unlink|rmdir)\s*\(/,
];

export function requiresDeleteApproval(toolName: string, toolInput: Record<string, unknown>): boolean {
  if (toolName !== "Bash") return false;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  return SHELL_DELETE.some(pattern => pattern.test(command));
}

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

/** `/\s+/g,` 같은 JS 정규식 리터럴 — 두 빗금 사이에 정규식 기호가 있고 뒤에 플래그만 온다. `/tmp/` 같은 경로는 아니다. */
function regexLiteral(raw: string): boolean {
  const body = /^\/((?:\\.|[^/\\])+)\/[dgimsuyv]*,?$/.exec(raw)?.[1];
  return body !== undefined && /[\\{}*+?[\]^$|]/.test(body);
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
    // URL 의 `//호스트`(http://localhost:5180)와 정규식 리터럴은 경로가 아니다 (세션 9d11a206 오탐 2026-10-20~27).
    if (raw.startsWith("//") || regexLiteral(raw)) continue;
    const target = expand(raw, here);
    if (!inside(target, roots)) return target;
  }
  return null;
}

/** 세션 기록에서 묶음을 찾는다. `room_bind` 호출과 그 결과 줄만 읽는다. 기록 파일을 못 읽으면 오류를 낸다. */
function bindingOf(transcriptPath: string): { alias: string; roomId: string } | null {
  const text = fs.readFileSync(transcriptPath, "utf8");
  const lines: Record<string, unknown>[] = [];
  for (const row of text.split("\n")) {
    if (!row.includes("room_bind") && !row.includes("bound")) continue;
    try { lines.push(JSON.parse(row) as Record<string, unknown>); } catch { /* 쓰는 중인 줄 */ }
  }
  return findBinding(lines);
}

/**
 * 세션 기록 → 훅이 적은 세션 상태 순으로 묶음을 찾는다. 못 찾고 허용하는 까닭 중 남길 것 —
 * 세션 기록을 못 읽음, 기록 파일도 세션 상태도 없음 — 은 세션 상태에 적는다 (사용자 결정 2026-11-03).
 * 세션 상태를 못 읽는 오류는 위로 올린다 (훅이 허용하고 stderr 에 남긴다).
 */
async function findSessionBinding(studioHome: string, input: GuardInput): Promise<{ alias: string; roomId: string } | null> {
  let missing = false;
  let note: string | null = null;
  try {
    const found = bindingOf(input.transcriptPath);
    if (found) return found;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") missing = true;
    else note = `세션 기록을 읽지 못해 세션 상태만 봤다: ${(error as Error).message}`;
  }
  if (!input.sessionId) {
    if (note) throw new Error(note);
    return null;
  }
  // 세션 기록이 없으면(2026-11-01 eval-r9-2 — 샌드박스 안 `claude -p` 가 기록을 못 씀) 훅이 적어 둔 묶음을 본다.
  const fromState = await sessionBinding(studioHome, input.sessionId);
  if (fromState) return fromState;
  if (!note && missing && !(await hasSessionState(studioHome, input.sessionId))) note = "세션 기록 파일도 세션 상태도 없어 묶이지 않은 세션으로 보고 허용했다.";
  if (note) {
    // 작업 공간을 못 찾으면 남길 곳이 없다 — 엉뚱한 폴더에 만들지 않고 오류를 올린다.
    requireStudioHome(studioHome);
    await recordGuardIssue(studioHome, input.sessionId, { event: "PreToolUse", tool: input.toolName, message: note });
  }
  return null;
}

/** 묶이지 않은 세션이면 null. 묶였으면 프로젝트와, 막을 때는 그 까닭. */
export async function guardTool(studioHome: string, input: GuardInput, shared: readonly string[] = sharedGuardRoots()): Promise<GuardDecision | null> {
  if (!FILE_TOOLS[input.toolName] && input.toolName !== "Bash") return null;
  const binding = await findSessionBinding(studioHome, input);
  if (!binding) return null;
  // 묶인 것을 확인한 뒤의 오류는 허용하지 않는다 (사용자 결정 2026-11-03).
  try {
    const project = (await readStudio(studioHome)).projects.find((row) => row.alias === binding.alias);
    const roots = guardRoots(studioHome, binding.alias, project?.path, shared);
    const target = outsideTarget(input.toolName, input.toolInput, input.cwd || process.cwd(), roots);
    if (!target) return { alias: binding.alias, deny: null, ...(requiresDeleteApproval(input.toolName, input.toolInput) ? {
      ask: `파일 삭제는 사람의 승인이 필요합니다. 삭제 대상과 되돌리는 방법을 확인한 뒤 승인해 주세요.`,
    } : {}) };
    return {
      alias: binding.alias,
      deny: `이 세션은 Patchbay 프로젝트 「${binding.alias}」에 묶여 있어 그 폴더(${project?.path ?? projectStudioDir(studioHome, binding.alias)}) 밖에는 쓸 수 없습니다: ${target}. 다른 프로젝트의 일이면 사용자에게 먼저 묻고, 허락을 받으면 room_bind 로 그 프로젝트에 다시 묶습니다.`,
    };
  } catch (error) {
    return {
      alias: binding.alias,
      deny: `이 세션은 Patchbay 프로젝트 「${binding.alias}」에 묶여 있지만 쓰기 범위를 확인하지 못해 막았습니다: ${(error as Error).message}. 작업 공간(studio.yaml)을 사용자에게 확인해 달라고 알립니다.`,
    };
  }
}
