import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeProgressEntry } from "@patchbay/core";
import { EMPTY_ARTIFACT, parseArtifact, procedureArtifactRel, type ProcedureArtifact } from "./processArtifact.js";
import {
  hydratePlanArtifact,
  preparePlanHostSession,
  type PlanHostKind,
  type PlanHostState,
} from "./processMemory.js";
import { resolveRegisteredProject, syncPlanMemoryToProcess, toProcessView } from "./processView.js";
import { planBeatById, type ProcessStepView, type ProcessView } from "./projectContract.js";

export interface HostLaunchRequest {
  kind: PlanHostKind;
  cwd: string;
  briefRel: string;
  briefAbs: string;
  resume: boolean;
  note: string;
}

export type HostSpawner = (req: HostLaunchRequest) => Promise<void>;

export type LaunchPlanHostResult =
  | {
      ok: true;
      process: ProcessView;
      step: ProcessStepView;
      artifact: ProcedureArtifact;
      memory: string;
      thread: string;
      host: PlanHostState;
      briefRel: string;
      resumed: boolean;
    }
  | { ok: false; status: 400 | 404 | 503; error: string };

export async function launchPlanHost(
  studioHome: string,
  payload: { alias?: unknown; stepId?: unknown; host?: unknown; note?: unknown },
  spawnHost: HostSpawner = defaultHostSpawner,
): Promise<LaunchPlanHostResult> {
  const host = parseHostKind(payload.host);
  if (!host) {
    return { ok: false, status: 400, error: "process: Cursor 또는 Claude Code를 고르세요." };
  }
  if (typeof payload.stepId !== "string" || !payload.stepId.trim()) {
    return { ok: false, status: 400, error: "process: 단계 id가 필요합니다." };
  }
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  if (note.length > 8000) {
    return { ok: false, status: 400, error: "process: 메모가 너무 깁니다." };
  }
  const beat = planBeatById(payload.stepId.trim());
  if (!beat) {
    return { ok: false, status: 400, error: "process: 기획 항목만 호스트로 엽니다." };
  }
  const resolved = await resolveRegisteredProject(studioHome, payload.alias);
  if (!resolved.ok) return resolved;

  const prepared = await preparePlanHostSession(resolved.root, beat.id, host, note, resolved.docs);
  const briefAbs = path.join(resolved.root, prepared.briefRel);
  try {
    await spawnHost({
      kind: host,
      cwd: resolved.root,
      briefRel: prepared.briefRel,
      briefAbs,
      resume: prepared.resumed,
      note,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 503,
      error: `${hostLabel(host)}를 열지 못했습니다. ${prepared.briefRel} 를 직접 여세요. (${reason})`,
    };
  }

  const files = prepared.files;
  const processRecord = await syncPlanMemoryToProcess(studioHome, resolved.alias, resolved.root, files, resolved.docs);
  await writeProgressEntry(studioHome, resolved.alias, {
    summary: `기획: ${hostLabel(host)}로 ${beat.label}`,
    skill: "plan-stage",
    step: beat.id,
  });

  const previous = await readArtifactFile(resolved.root, beat.id, beat.label, beat.output, resolved.docs);
  const artifact = hydratePlanArtifact(beat.label, beat.output, previous, files, beat.id);
  const view = toProcessView(processRecord, resolved.root, resolved.docs);
  const stepView = view.planBeats.find((item) => item.id === beat.id) ?? {
    id: beat.id,
    label: beat.label,
    output: beat.output,
    filled: true,
  };
  return {
    ok: true,
    process: view,
    step: stepView,
    artifact,
    memory: files.memory,
    thread: files.thread,
    host: files.host ?? { host, beatId: beat.id, openedAt: new Date().toISOString(), status: "running" },
    briefRel: prepared.briefRel,
    resumed: prepared.resumed,
  };
}

export async function defaultHostSpawner(req: HostLaunchRequest): Promise<void> {
  if (req.kind === "cursor") {
    await spawnCursor(req);
    return;
  }
  await spawnClaude(req);
}

function parseHostKind(raw: unknown): PlanHostKind | null {
  return raw === "cursor" || raw === "claude" ? raw : null;
}

function hostLabel(host: PlanHostKind): string {
  return host === "claude" ? "Claude Code" : "Cursor";
}

async function spawnCursor(req: HostLaunchRequest): Promise<void> {
  const bin = resolveBin("cursor", "PATCHBAY_CURSOR_BIN", [
    path.join(os.homedir(), "Applications/Cursor.app/Contents/Resources/app/bin/cursor"),
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/usr/local/bin/cursor",
  ]);
  if (bin) {
    await spawnDetached(bin, ["-n", req.cwd, req.briefAbs], req.cwd);
    return;
  }
  if (process.platform === "darwin") {
    await spawnDetached("open", ["-na", "Cursor", "--args", req.cwd, req.briefAbs], req.cwd);
    return;
  }
  throw new Error("cursor 실행 파일을 찾지 못했습니다.");
}

async function spawnClaude(req: HostLaunchRequest): Promise<void> {
  const bin = resolveBin("claude", "PATCHBAY_CLAUDE_BIN", [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ]);
  const follow = req.resume
    ? `${req.briefRel} 를 다시 읽고 이어서 진행하세요.${req.note ? ` ${req.note}` : ""}`
    : `${req.briefRel} 를 읽고 이 기획 대화를 시작하세요.${req.note ? ` ${req.note}` : ""}`;
  const cmdline = req.resume
    ? `cd ${shQuote(req.cwd)} && ${shQuote(bin ?? "claude")} --continue ${shQuote(follow)}`
    : `cd ${shQuote(req.cwd)} && ${shQuote(bin ?? "claude")} ${shQuote(follow)}`;
  if (process.platform === "darwin") {
    await spawnDetached(
      "osascript",
      ["-e", 'tell application "Terminal" to activate', "-e", `tell application "Terminal" to do script ${appleQuote(cmdline)}`],
      req.cwd,
    );
    return;
  }
  if (bin) {
    await spawnDetached(bin, req.resume ? ["--continue", follow] : [follow], req.cwd);
    return;
  }
  throw new Error("claude 실행 파일을 찾지 못했습니다.");
}

export function resolveBin(name: string, envKey: string, fallbacks: string[]): string | null {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv && isExecutable(fromEnv)) return fromEnv;
  for (const candidate of fallbacks) {
    if (isExecutable(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const abs = path.join(dir, name);
    if (isExecutable(abs)) return abs;
  }
  return null;
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function spawnDetached(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readArtifactFile(
  root: string,
  stepId: string,
  title: string,
  output: ProcedureArtifact["type"],
  docs: string,
): Promise<ProcedureArtifact> {
  const abs = path.join(root, procedureArtifactRel(stepId, docs));
  try {
    const raw = await fs.promises.readFile(abs, "utf8");
    const parsed = parseArtifact(JSON.parse(raw) as unknown, title);
    return parsed.type ? parsed : { ...parsed, type: output, title: parsed.title || title };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return { ...EMPTY_ARTIFACT, type: output, title };
    }
    throw error;
  }
}
