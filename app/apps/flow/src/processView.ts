import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PROJECT_DOCS,
  processSchema,
  projectDocs,
  readOverlay,
  readStudio,
  writeOverlayProcess,
  writeProgressEntry,
  type OverlayProcess,
  type ProcessOutput,
} from "@patchbay/core";
import { EMPTY_PROCESS_VIEW, PLAN_BEATS, type ProcessStepView, type ProcessView } from "./projectContract.js";
import {
  artifactFromTalk,
  goalFromArtifact,
  orderLabelsFromArtifact,
  procedureDir,
  procedureArtifactRel,
  type ProcedureArtifact,
} from "./processArtifact.js";
import {
  memoryFileFilled,
  planBeatFilled,
  readPlanHostSync,
  readPlanMemory,
  settlePlanHost,
  type PlanMemoryFiles,
} from "./processMemory.js";
import { normalizeProjectRelPath } from "./sourceFileView.js";

const MAX_GOAL = 2000;
const MAX_STEPS = 24;
const MAX_FOLDERS = 20;
const MAX_LABEL = 80;
const BIND_ID = /^[a-z][a-z0-9-]*$/;

export type SaveProcessResult =
  | { ok: true; process: ProcessView; createdFolders: string[] }
  | { ok: false; status: 400 | 404; error: string };

export type AddProcessStepResult =
  | { ok: true; process: ProcessView; step: ProcessStepView }
  | { ok: false; status: 400 | 404; error: string };

export interface SaveProcessInput {
  alias?: unknown;
  goal?: unknown;
  folders?: unknown;
  steps?: unknown;
}

export interface AddProcessStepInput {
  alias?: unknown;
  label?: unknown;
  output?: unknown;
  afterId?: unknown;
}

export type ResolveProjectResult =
  | { ok: true; alias: string; root: string; docs: string }
  | { ok: false; status: 400 | 404; error: string };

export function toProcessView(process: OverlayProcess | undefined, projectPath?: string, docs: string = DEFAULT_PROJECT_DOCS): ProcessView {
  if (!process) return EMPTY_PROCESS_VIEW;
  const planBeats = PLAN_BEATS.map((beat) => ({
    ...beat,
    filled: Boolean(
      projectPath &&
        (existsSync(path.join(projectPath, procedureArtifactRel(beat.id, docs))) || planBeatFilled(projectPath, beat.id, docs)),
    ),
  }));
  return {
    configured: process.configured,
    goal: process.goal,
    folders: [...process.folders],
    steps: process.steps.map((step) => ({
      id: step.id,
      label: step.label,
      output: step.output,
      filled: Boolean(projectPath && existsSync(path.join(projectPath, procedureArtifactRel(step.id, docs)))),
    })),
    edges: process.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    bind: { ...process.bind },
    briefFilled: planBeats.every((beat) => beat.filled),
    planBeats,
    host: readPlanHostSync(projectPath, docs),
  };
}

export async function resolveRegisteredProject(
  studioHome: string,
  aliasRaw: unknown,
): Promise<ResolveProjectResult> {
  if (typeof aliasRaw !== "string" || !aliasRaw.trim()) {
    return { ok: false, status: 400, error: "process: alias is required." };
  }
  const alias = aliasRaw.trim();
  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    return { ok: false, status: 404, error: `No project registered with alias "${alias}".` };
  }
  return { ok: true, alias, root: path.resolve(registered.path), docs: projectDocs(registered) };
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function parseOutput(raw: unknown): ProcessOutput | null {
  if (raw == null || raw === "") return "table";
  if (raw === "table" || raw === "diagram" || raw === "text") return raw;
  return null;
}

function parseSteps(raw: unknown): Array<{ label: string; bind?: string; output: ProcessOutput }> | null {
  if (!Array.isArray(raw)) return null;
  const steps: Array<{ label: string; bind?: string; output: ProcessOutput }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.label !== "string" || !rec.label.trim()) return null;
    const output = parseOutput(rec.output);
    if (!output) return null;
    const bind = typeof rec.bind === "string" ? rec.bind.trim() : "";
    steps.push(bind ? { label: rec.label.trim(), bind, output } : { label: rec.label.trim(), output });
  }
  return steps;
}

function sequentialEdges(steps: Array<{ id: string }>): OverlayProcess["edges"] {
  return steps.slice(0, -1).map((step, index) => ({
    from: step.id,
    to: steps[index + 1]!.id,
  }));
}

function assignStepIds(steps: Array<{ label: string; bind?: string; output: ProcessOutput }>): OverlayProcess {
  const used = new Set<string>();
  const mapped: OverlayProcess["steps"] = [];
  const bind: Record<string, string> = {};
  for (const [index, step] of steps.entries()) {
    let id = step.bind && BIND_ID.test(step.bind) && !used.has(step.bind) ? step.bind : `step-${index + 1}`;
    if (used.has(id)) id = `step-${index + 1}`;
    used.add(id);
    mapped.push({ id, label: step.label, output: step.output });
    if (step.bind && step.bind !== id) bind[id] = step.bind;
  }
  return {
    configured: true,
    goal: "",
    folders: [],
    steps: mapped,
    edges: sequentialEdges(mapped),
    bind,
  };
}

function nextStepId(existing: OverlayProcess["steps"]): string {
  const used = new Set(existing.map((step) => step.id));
  let n = existing.length + 1;
  while (used.has(`step-${n}`)) n += 1;
  return `step-${n}`;
}

function withProceduresFolder(folders: string[], docs: string): string[] {
  const dir = procedureDir(docs);
  return folders.includes(dir) ? folders : [...folders, dir];
}

async function ensureFolder(root: string, rel: string): Promise<boolean> {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return false;
  await fs.mkdir(abs, { recursive: true });
  return true;
}

async function writeProcessNotes(root: string, process: OverlayProcess): Promise<void> {
  const dir = path.join(root, "docs", "기획");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const coursePath = path.join(dir, `과정_${stamp}a.md`);
  try {
    await fs.access(coursePath);
    return;
  } catch {
    // write once for this date stamp
  }
  const lines = [
    "# 과정",
    "",
    `목표: ${process.goal}`,
    "",
    "## 단계",
    "",
    ...process.steps.map((step, index) => `${index + 1}. ${step.label} (\`${step.id}\`)`),
    "",
    "## 폴더",
    "",
    ...process.folders.map((folder) => `- \`${folder}\``),
    "",
  ];
  await fs.writeFile(coursePath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Project-tab installer. overlay.process is the live record. Folders are
 * created in the registered repo. Scan never calls this.
 */
export async function saveProjectProcess(studioHome: string, payload: SaveProcessInput): Promise<SaveProcessResult> {
  if (typeof payload.goal !== "string" || !payload.goal.trim()) {
    return { ok: false, status: 400, error: "process: 목표를 적으세요." };
  }
  const goal = payload.goal.trim();
  if (goal.length > MAX_GOAL) {
    return { ok: false, status: 400, error: "process: 목표가 너무 깁니다." };
  }
  const folderLines = asStringArray(payload.folders) ?? [];
  if (folderLines.length > MAX_FOLDERS) {
    return { ok: false, status: 400, error: "process: 폴더가 너무 많습니다." };
  }
  const parsedSteps = parseSteps(payload.steps);
  if (!parsedSteps || parsedSteps.length < 2) {
    return { ok: false, status: 400, error: "process: 실행 순서를 두 단계 이상 적으세요." };
  }
  if (parsedSteps.length > MAX_STEPS) {
    return { ok: false, status: 400, error: "process: 단계가 너무 많습니다." };
  }

  const resolved = await resolveRegisteredProject(studioHome, payload.alias);
  if (!resolved.ok) return resolved;

  const folders: string[] = [];
  for (const line of folderLines) {
    const rel = normalizeProjectRelPath(line);
    if (!rel) {
      return { ok: false, status: 400, error: `process: 폴더 경로가 올바르지 않습니다: ${line}` };
    }
    folders.push(rel);
  }

  const draft = assignStepIds(parsedSteps);
  const process = processSchema.parse({ ...draft, configured: true, goal, folders });

  const createdFolders: string[] = [];
  for (const folder of process.folders) {
    const abs = path.resolve(resolved.root, folder);
    let existed = true;
    try {
      await fs.access(abs);
    } catch {
      existed = false;
    }
    const ok = await ensureFolder(resolved.root, folder);
    if (!ok) return { ok: false, status: 400, error: `process: 폴더를 만들 수 없습니다: ${folder}` };
    if (!existed) createdFolders.push(folder);
  }

  await writeProcessNotes(resolved.root, process);
  await writeOverlayProcess(studioHome, resolved.alias, process);
  await writeProgressEntry(studioHome, resolved.alias, {
    summary: "프로세스 구성: 목표·과정·폴더",
    skill: "plan-stage",
    step: "setup",
  });

  return { ok: true, process: toProcessView(process, resolved.root, resolved.docs), createdFolders };
}

/** Append (or insert) one procedure step. One step is enough — the bar starts empty. */
export async function addProcessStep(studioHome: string, payload: AddProcessStepInput): Promise<AddProcessStepResult> {
  if (typeof payload.label !== "string" || !payload.label.trim()) {
    return { ok: false, status: 400, error: "process: 단계 이름을 적으세요." };
  }
  const label = payload.label.trim();
  if (label.length > MAX_LABEL) {
    return { ok: false, status: 400, error: "process: 단계 이름이 너무 깁니다." };
  }
  const output = parseOutput(payload.output);
  if (!output) {
    return { ok: false, status: 400, error: "process: 결과는 표 또는 도식이어야 합니다." };
  }
  const afterId = typeof payload.afterId === "string" ? payload.afterId.trim() : "";

  const resolved = await resolveRegisteredProject(studioHome, payload.alias);
  if (!resolved.ok) return resolved;

  const overlay = await readOverlay(studioHome, resolved.alias);
  const current = overlay.process;
  if (current.steps.length >= MAX_STEPS) {
    return { ok: false, status: 400, error: "process: 단계가 너무 많습니다." };
  }
  if (afterId && !current.steps.some((step) => step.id === afterId)) {
    return { ok: false, status: 400, error: `process: 기준 단계가 없습니다: ${afterId}` };
  }

  const id = nextStepId(current.steps);
  const nextStep = { id, label, output };
  const steps = [...current.steps];
  const insertAt = afterId ? steps.findIndex((step) => step.id === afterId) + 1 : steps.length;
  steps.splice(insertAt, 0, nextStep);

  const process = processSchema.parse({
    ...current,
    configured: true,
    folders: withProceduresFolder(current.folders, resolved.docs),
    steps,
    edges: sequentialEdges(steps),
  });

  const ok = await ensureFolder(resolved.root, procedureDir(resolved.docs));
  if (!ok) return { ok: false, status: 400, error: "process: 절차 폴더를 만들 수 없습니다." };

  await writeOverlayProcess(studioHome, resolved.alias, process);
  await writeProgressEntry(studioHome, resolved.alias, {
    summary: `과정 단계 추가: ${label}`,
    skill: "plan-stage",
    step: id,
  });

  const view = toProcessView(process, resolved.root, resolved.docs);
  const step = view.steps.find((item) => item.id === id)!;
  return { ok: true, process: view, step };
}

/**
 * 기획 대화에서 정해진 목표·실행 순서를 overlay.process에 반영한다.
 * 순서가 안 보이면 기존 steps는 그대로 둔다.
 */
export function applyConstitutionToProcess(
  current: OverlayProcess,
  artifact: ProcedureArtifact,
  extraText = "",
  beatId?: string,
  docs: string = DEFAULT_PROJECT_DOCS,
): OverlayProcess {
  const takeGoal = beatId !== "plan-direction";
  const takeOrder = !beatId || beatId === "plan-proceed";
  const goalText = takeGoal ? goalFromArtifact(artifact) : null;
  const goal = goalText ? goalText.slice(0, MAX_GOAL) : current.goal;
  const labels = takeOrder ? orderLabelsFromArtifact(artifact, extraText) : [];
  let steps = current.steps;
  if (labels.length > 0) {
    const byLabel = new Map<string, OverlayProcess["steps"][number]>();
    for (const step of current.steps) {
      if (!byLabel.has(step.label)) byLabel.set(step.label, step);
    }
    const used = new Set<string>();
    steps = [];
    for (const label of labels.slice(0, MAX_STEPS)) {
      const clipped = label.slice(0, MAX_LABEL);
      const existing = byLabel.get(clipped);
      if (existing && !used.has(existing.id)) {
        used.add(existing.id);
        steps.push(existing);
        continue;
      }
      let n = 1;
      while (used.has(`step-${n}`)) n += 1;
      const id = `step-${n}`;
      used.add(id);
      steps.push({ id, label: clipped, output: "table" });
    }
  }
  const remaining = new Set(steps.map((step) => step.id));
  const bind: Record<string, string> = {};
  for (const [from, to] of Object.entries(current.bind)) {
    if (remaining.has(from)) bind[from] = to;
  }
  return processSchema.parse({
    ...current,
    configured: Boolean(goal || steps.length > 0),
    goal,
    folders: withProceduresFolder(current.folders, docs),
    steps,
    edges: sequentialEdges(steps),
    bind,
  });
}

export async function syncPlanMemoryToProcess(
  studioHome: string,
  alias: string,
  root: string,
  files?: PlanMemoryFiles,
  docs: string = DEFAULT_PROJECT_DOCS,
): Promise<OverlayProcess> {
  const overlay = await readOverlay(studioHome, alias);
  const incoming = files ?? (await readPlanMemory(root, docs));
  const wasRunning = incoming.host?.status === "running";
  const memory = await settlePlanHost(root, incoming);
  const settled = wasRunning && memory.host?.status === "done";
  const next = processFromMemory(overlay.process, memory, docs);
  if (!sameProcess(overlay.process, next)) {
    await writeOverlayProcess(studioHome, alias, next);
  }
  if (settled) {
    const beat = PLAN_BEATS.find((item) => item.id === memory.host?.beatId);
    await writeProgressEntry(studioHome, alias, {
      summary: `기획: ${beat?.label ?? "항목"} 반영`,
      skill: "plan-stage",
      step: memory.host?.beatId,
    });
  }
  return sameProcess(overlay.process, next) ? overlay.process : next;
}

function processFromMemory(current: OverlayProcess, files: PlanMemoryFiles, docs: string): OverlayProcess {
  const goalSource = memoryFileFilled(files.goal) ? files.goal : files.memory;
  const goalArt = artifactFromTalk({
    output: "table",
    title: "목표",
    original: goalSource,
    summary: "",
    constitution: true,
  });
  let next = current;
  if (goalFromArtifact(goalArt)) {
    next = applyConstitutionToProcess(next, goalArt, files.goal, "plan-goal", docs);
  }
  if (!memoryFileFilled(files.proceed)) {
    const drop = new Set(next.steps.filter((step) => /→|->/.test(step.label)).map((step) => step.id));
    if (drop.size > 0) {
      next = {
        ...next,
        steps: next.steps.filter((step) => !drop.has(step.id)),
        edges: next.edges.filter((edge) => !drop.has(edge.from) && !drop.has(edge.to)),
      };
    }
    return next;
  }
  const proceedArt = artifactFromTalk({
    output: "diagram",
    title: "실행",
    original: files.proceed,
    summary: "",
    constitution: true,
  });
  if (orderLabelsFromArtifact(proceedArt, files.proceed).length > 0) {
    next = applyConstitutionToProcess(next, proceedArt, files.proceed, "plan-proceed", docs);
  }
  return next;
}

function sameProcess(a: OverlayProcess, b: OverlayProcess): boolean {
  return (
    a.goal === b.goal &&
    a.steps.length === b.steps.length &&
    a.steps.every((step, index) => step.label === b.steps[index]?.label)
  );
}
