import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PROJECT_DOCS } from "@patchbay/core";
import { artifactFromTalk, type ProcedureArtifact } from "./processArtifact.js";
import {
  completedPlanBeatIds,
  PLAN_BEATS,
  planBeatById,
  type PlanHostKind,
  type PlanHostStatus,
  type PlanHostView,
  type ProcessOutputView,
} from "./projectContract.js";

export type { PlanHostKind, PlanHostStatus, PlanHostView as PlanHostState };

/**
 * 기획 파일의 자리 — 레포 뿌리 기준 상대 경로. 문서 폴더는 프로젝트마다 다를 수 있다
 * (등록부 `docs`, 기본 `docs`. Patchbay 자신은 `knowledge/patchbay` — 저장구조.md).
 */
export function planPaths(docs: string = DEFAULT_PROJECT_DOCS) {
  const dir = `${docs}/기획`;
  return {
    dir,
    memory: `${dir}/기억.md`,
    thread: `${dir}/대화.md`,
    brief: `${dir}/브리핑.md`,
    host: `${dir}/host.json`,
    beats: {
      "plan-goal": `${dir}/목표.md`,
      "plan-direction": `${dir}/방향.md`,
      "plan-proceed": `${dir}/실행.md`,
    } as Record<string, string>,
  };
}
export type PlanPaths = ReturnType<typeof planPaths>;

export interface PlanMemoryFiles {
  memory: string;
  thread: string;
  goal: string;
  direction: string;
  proceed: string;
  host: PlanHostView | null;
}

function beatTask(beatId: string, p: PlanPaths): string {
  if (beatId === "plan-goal") {
    return `이 프로젝트가 끝나는 상태를 표로 정리하세요. 결정이 나면 ${p.beats["plan-goal"]} 와 ${p.memory} 의 목표 절을 고치세요.`;
  }
  if (beatId === "plan-direction") {
    return `목표를 달성할 로드맵을 정하세요. 마일스톤마다 기간·세부 작업·완료 기준을 표로 정리하고, 결정이 나면 ${p.beats["plan-direction"]} 와 ${p.memory} 의 방향 절을 고치세요.`;
  }
  if (beatId === "plan-proceed") {
    return `방향에서 정한 로드맵을 실행 순서로 두세요. 위에 번호 목록 또는 A → B 다이어그램, 아래에 단계·상태·작업·파일 표를 남기세요. 결정이 나면 ${p.beats["plan-proceed"]} 와 ${p.memory} 의 실행 절을 고치세요. 이 순서가 콘솔의 실행 순서가 됩니다.`;
  }
  return "";
}

export function planBeatFileRel(beatId: string, docs: string = DEFAULT_PROJECT_DOCS): string | null {
  const beat = planBeatById(beatId);
  if (!beat) return null;
  return planPaths(docs).beats[beat.id] ?? null;
}

export function memoryFileFilled(text: string): boolean {
  const stripped = text
    .replace(/^#.+$/gm, "")
    .replace(/\(아직 없음\)/g, "")
    .replace(/기획 대화의 이어서 쓸 기록입니다[^\n]*/g, "")
    .trim();
  return stripped.length >= 8;
}

export function planBeatFilled(projectPath: string | undefined, beatId: string, docs: string = DEFAULT_PROJECT_DOCS): boolean {
  if (!projectPath) return false;
  const rel = planBeatFileRel(beatId, docs);
  if (!rel) return false;
  const abs = path.join(projectPath, rel);
  if (!existsSync(abs)) return false;
  try {
    return memoryFileFilled(readFileSync(abs, "utf8"));
  } catch {
    return false;
  }
}

export async function readPlanMemory(root: string, docs: string = DEFAULT_PROJECT_DOCS): Promise<PlanMemoryFiles> {
  const p = planPaths(docs);
  const [memory, thread, goal, direction, proceed, hostRaw] = await Promise.all([
    readOptional(path.join(root, p.memory)),
    readOptional(path.join(root, p.thread)),
    readOptional(path.join(root, p.beats["plan-goal"]!)),
    readOptional(path.join(root, p.beats["plan-direction"]!)),
    readOptional(path.join(root, p.beats["plan-proceed"]!)),
    readOptional(path.join(root, p.host)),
  ]);
  return {
    memory,
    thread,
    goal,
    direction,
    proceed,
    host: parseHostState(hostRaw),
  };
}

export function beatBody(files: PlanMemoryFiles, beatId: string): string {
  if (beatId === "plan-goal") return files.goal;
  if (beatId === "plan-direction") return files.direction;
  if (beatId === "plan-proceed") return files.proceed;
  return "";
}

export function hydratePlanArtifact(
  title: string,
  output: ProcessOutputView,
  previous: ProcedureArtifact,
  files: PlanMemoryFiles,
  beatId: string,
): ProcedureArtifact {
  const body = beatBody(files, beatId);
  const summary = files.memory.trim();
  if (!memoryFileFilled(body) && !memoryFileFilled(summary)) {
    return previous;
  }
  const source = memoryFileFilled(body) ? body : summary;
  return artifactFromTalk({
    output,
    title,
    original: source,
    summary: "",
    previous,
    constitution: true,
  });
}

export function buildPlanBrief(input: {
  beatId: string;
  files: PlanMemoryFiles;
  note: string;
  resume: boolean;
  docs?: string;
}): string {
  const p = planPaths(input.docs);
  const beat = planBeatById(input.beatId) ?? PLAN_BEATS[0]!;
  const index = PLAN_BEATS.findIndex((item) => item.id === beat.id) + 1;
  const prior = priorBeatSnippets(input.files, beat.id);
  const lines = [
    `# 기획 브리핑 · ${index}. ${beat.label}`,
    "",
    input.resume
      ? `이 대화는 도중에 끊겼거나 다음 항목으로 넘어온 상태입니다. ${p.memory} 와 ${p.thread} 를 먼저 읽고, 거기서부터 이어서 하세요. 처음부터 다시 묻지 마세요.`
      : "이 프로젝트의 기획 대화를 시작합니다. 결정은 채팅에만 두지 말고 아래 파일에 남기세요.",
    "",
    beatTask(beat.id, p),
    "",
    "## 남길 파일",
    "",
    `- 이어서 쓸 기억: \`${p.memory}\``,
    `- 대화 원문: \`${p.thread}\``,
    `- 이 항목: \`${p.beats[beat.id]}\``,
    `- 진행 상태: \`${p.host}\``,
    "",
    `말한 내용은 대화.md 끝에 붙이세요. 초안만 쓴 동안에는 host.json의 status를 running으로 유지하세요. 사용자가 이 항목을 끝냈을 때만 기억.md와 이 항목 파일을 확정하고, host.json의 completed에 "${beat.id}"를 넣은 뒤 status를 done으로 바꾸세요.`,
  ];
  if (input.note.trim()) {
    lines.push("", "## 이번에 보탠 말", "", input.note.trim());
  }
  if (memoryFileFilled(input.files.memory)) {
    lines.push("", "## 지금까지의 기억", "", input.files.memory.trim());
  }
  if (prior.trim()) {
    lines.push("", "## 앞에서 남긴 항목", "", prior.trim());
  }
  const own = beatBody(input.files, beat.id);
  if (memoryFileFilled(own)) {
    lines.push("", `## 이 항목에 이미 있는 내용`, "", own.trim());
  }
  lines.push("");
  return lines.join("\n");
}

export async function preparePlanHostSession(
  root: string,
  beatId: string,
  host: PlanHostKind,
  note: string,
  docs: string = DEFAULT_PROJECT_DOCS,
): Promise<{ briefRel: string; resumed: boolean; files: PlanMemoryFiles }> {
  const beat = planBeatById(beatId);
  if (!beat) throw new Error(`unknown beat: ${beatId}`);
  const p = planPaths(docs);
  await fs.mkdir(path.join(root, p.dir), { recursive: true });

  const files = await readPlanMemory(root, docs);
  const resumed = Boolean(files.host) || memoryFileFilled(files.memory) || memoryFileFilled(files.thread);
  if (!files.memory.trim()) {
    await writeText(path.join(root, p.memory), seedMemory());
  }
  const stamp = new Date().toISOString();
  const threadBlock = [
    "",
    `## 열림 · ${beat.label} · ${stamp} · ${host}`,
    "",
    note.trim() ? note.trim() : "이전에 남긴 파일을 읽고 이어서 진행합니다.",
    "",
  ].join("\n");
  const thread = clipTail(`${files.thread.trimEnd()}\n${threadBlock}`);
  await writeText(path.join(root, p.thread), thread);

  const nextFiles: PlanMemoryFiles = {
    ...(await readPlanMemory(root, docs)),
    thread,
  };
  const brief = buildPlanBrief({ beatId: beat.id, files: nextFiles, note, resume: resumed, docs });
  await writeText(path.join(root, p.brief), brief);
  const completed = completedPlanBeatIds(files.host).filter((id) => id !== beat.id);
  const state: PlanHostView = { host, beatId: beat.id, openedAt: stamp, status: "running", completed };
  await writeText(path.join(root, p.host), `${JSON.stringify(state, null, 2)}\n`);
  return { briefRel: p.brief, resumed, files: await readPlanMemory(root, docs) };
}

function priorBeatSnippets(files: PlanMemoryFiles, beatId: string): string {
  const chunks: string[] = [];
  if (beatId !== "plan-goal" && memoryFileFilled(files.goal)) {
    chunks.push(`### 목표\n\n${files.goal.trim()}`);
  }
  if (beatId === "plan-proceed" && memoryFileFilled(files.direction)) {
    chunks.push(`### 방향\n\n${files.direction.trim()}`);
  }
  return chunks.join("\n\n");
}

function seedMemory(): string {
  return [
    "# 기억",
    "",
    "기획 대화의 이어서 쓸 기록입니다. 호스트가 결정이 날 때마다 이 파일을 고칩니다.",
    "",
    "## 목표",
    "",
    "(아직 없음)",
    "",
    "## 방향",
    "",
    "(아직 없음)",
    "",
    "## 실행",
    "",
    "(아직 없음)",
    "",
  ].join("\n");
}

function parseHostState(raw: string): PlanHostView | null {
  if (!raw.trim()) return null;
  try {
    const rec = JSON.parse(raw) as Record<string, unknown>;
    const host = rec.host === "claude" || rec.host === "cursor" ? rec.host : null;
    const beatId = typeof rec.beatId === "string" ? rec.beatId : "";
    const openedAt = typeof rec.openedAt === "string" ? rec.openedAt : "";
    const status: PlanHostStatus = rec.status === "done" ? "done" : "running";
    const doneAt = typeof rec.doneAt === "string" ? rec.doneAt : undefined;
    const allowed = new Set(PLAN_BEATS.map((beat) => beat.id));
    const completed = Array.isArray(rec.completed)
      ? rec.completed.filter((id): id is string => typeof id === "string" && allowed.has(id))
      : [];
    if (!host || !beatId) return null;
    const state: PlanHostView = { host, beatId, openedAt, status };
    if (doneAt) state.doneAt = doneAt;
    if (completed.length > 0) state.completed = completed;
    return state;
  } catch {
    return null;
  }
}

export function readPlanHostSync(projectPath: string | undefined, docs: string = DEFAULT_PROJECT_DOCS): PlanHostView | null {
  if (!projectPath) return null;
  const abs = path.join(projectPath, planPaths(docs).host);
  if (!existsSync(abs)) return null;
  try {
    return parseHostState(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

export async function settlePlanHost(root: string, files: PlanMemoryFiles): Promise<PlanMemoryFiles> {
  void root;
  return files;
}

async function readOptional(abs: string): Promise<string> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function writeText(abs: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function clipTail(text: string, maxBytes = 200_000): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const sliced = text.slice(-Math.floor(maxBytes * 0.9));
  const cut = sliced.indexOf("\n## ");
  return cut > 0 ? sliced.slice(cut) : sliced;
}
