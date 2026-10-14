import fs from "node:fs/promises";
import path from "node:path";
import { readOverlay, writeOverlayProcess, writeProgressEntry } from "@patchbay/core";
import type { LangGraphPort } from "./langgraphAdapter.js";
import {
  ORIGINAL_STATE_KEYS,
  pickStateText,
  SUMMARY_STATE_KEYS,
  valuesFromState,
} from "./langgraphContract.js";
import {
  appendTalk,
  artifactFromTalk,
  artifactToMarkdown,
  EMPTY_ARTIFACT,
  parseArtifact,
  procedureArtifactRel,
  procedureMarkdownRel,
  type ProcedureArtifact,
} from "./processArtifact.js";
import {
  hydratePlanArtifact,
  readPlanMemory,
  type PlanHostState,
} from "./processMemory.js";
import { applyConstitutionToProcess, resolveRegisteredProject, syncPlanMemoryToProcess, toProcessView } from "./processView.js";
import {
  isPlanBeatId,
  planBeatById,
  type ProcessStepView,
  type ProcessView,
} from "./projectContract.js";
import { SOURCE_FILE_MAX_BYTES } from "./sourceFileView.js";

export type LoadProcessStepResult =
  | {
      ok: true;
      step: ProcessStepView;
      artifact: ProcedureArtifact;
      memory?: string;
      thread?: string;
      host?: PlanHostState | null;
    }
  | { ok: false; status: 400 | 404; error: string };

export type TalkProcessResult =
  | { ok: true; process: ProcessView; step: ProcessStepView; artifact: ProcedureArtifact }
  | { ok: false; status: 400 | 404 | 503; error: string };

const MAX_MESSAGE = 8000;

export async function loadProcessStep(
  studioHome: string,
  aliasRaw: unknown,
  stepIdRaw: unknown,
): Promise<LoadProcessStepResult> {
  if (typeof stepIdRaw !== "string" || !stepIdRaw.trim()) {
    return { ok: false, status: 400, error: "process: 단계 id가 필요합니다." };
  }
  const resolved = await resolveRegisteredProject(studioHome, aliasRaw);
  if (!resolved.ok) return resolved;

  const overlay = await readOverlay(studioHome, resolved.alias);
  const stepId = stepIdRaw.trim();
  const beat = planBeatById(stepId);
  if (beat) {
    const files = await readPlanMemory(resolved.root, resolved.docs);
    await syncPlanMemoryToProcess(studioHome, resolved.alias, resolved.root, files, resolved.docs);
    const settled = await readPlanMemory(resolved.root, resolved.docs);
    const processRecord = (await readOverlay(studioHome, resolved.alias)).process;
    const previous = await readArtifactFile(resolved.root, beat.id, beat.label, beat.output, resolved.docs);
    const artifact = hydratePlanArtifact(beat.label, beat.output, previous, settled, beat.id);
    const view = toProcessView(processRecord, resolved.root, resolved.docs);
    const filled = view.planBeats.find((item) => item.id === beat.id)?.filled ?? false;
    return {
      ok: true,
      step: { id: beat.id, label: beat.label, output: beat.output, filled },
      artifact,
      memory: settled.memory,
      thread: settled.thread,
      host: settled.host,
    };
  }
  const step = overlay.process.steps.find((item) => item.id === stepId);
  if (!step) {
    return { ok: false, status: 404, error: `process: 단계가 없습니다: ${stepIdRaw}` };
  }

  const view = toProcessView(overlay.process, resolved.root, resolved.docs);
  const stepView = view.steps.find((item) => item.id === step.id)!;
  const artifact = await readArtifactFile(resolved.root, step.id, step.label, step.output, resolved.docs);
  return { ok: true, step: stepView, artifact };
}

export async function talkProcessStep(
  studioHome: string,
  port: LangGraphPort | undefined,
  payload: { alias?: unknown; stepId?: unknown; message?: unknown },
): Promise<TalkProcessResult> {
  if (typeof payload.message !== "string" || !payload.message.trim()) {
    return { ok: false, status: 400, error: "process: 메시지를 적으세요." };
  }
  const message = payload.message.trim();
  if (message.length > MAX_MESSAGE) {
    return { ok: false, status: 400, error: "process: 메시지가 너무 깁니다." };
  }
  if (typeof payload.stepId !== "string" || !payload.stepId.trim()) {
    return { ok: false, status: 400, error: "process: 단계 id가 필요합니다." };
  }
  const stepId = payload.stepId.trim();

  const resolved = await resolveRegisteredProject(studioHome, payload.alias);
  if (!resolved.ok) return resolved;

  if (!port) {
    return { ok: false, status: 503, error: "LangGraph가 꺼져 있으면 이 단계에서 대화할 수 없습니다." };
  }

  const overlay = await readOverlay(studioHome, resolved.alias);
  const beat = planBeatById(stepId);
  const isConstitution = Boolean(beat) || isPlanBeatId(stepId);
  const step = beat
    ? { id: beat.id, label: beat.label, output: beat.output }
    : overlay.process.steps.find((item) => item.id === stepId);
  if (!step) {
    return { ok: false, status: 404, error: `process: 단계가 없습니다: ${stepId}` };
  }

  const previous = await readArtifactFile(resolved.root, step.id, step.label, step.output, resolved.docs);
  const assistants = await port.listAssistants();
  const assistant = assistants?.[0];
  if (!assistant) {
    return { ok: false, status: 503, error: "LangGraph에서 그래프를 찾지 못했습니다." };
  }

  let threadId = previous.threadId;
  if (!threadId) {
    const created = await port.createThread(assistant.graphId);
    if (!created) {
      return { ok: false, status: 503, error: "LangGraph 대화를 시작하지 못했습니다." };
    }
    threadId = created;
  }

  const original = isConstitution
    ? planTalkPrompt(step.id, overlay.process.goal, message)
    : [
        `단계: ${step.label}`,
        `결과 형태: ${step.output === "diagram" ? "diagram" : "table"}`,
        overlay.process.goal ? `목표: ${overlay.process.goal}` : "",
        '가능하면 JSON으로 답하세요. 표: {"type":"table","columns":["항목","내용"],"rows":[["",""]]} 도식: {"type":"diagram","nodes":[{"id":"a","label":"A"}],"edges":[{"from":"a","to":"b"}]}',
        "",
        message,
      ]
        .filter((line) => line !== "")
        .join("\n");

  const waited = await port.waitRun({
    threadId,
    assistantId: assistant.id,
    input: { original },
  });
  if (waited.status === "timeout") {
    return { ok: false, status: 503, error: "실행이 시간 제한을 넘었습니다. LangGraph에서 이어서 확인하세요." };
  }
  if (waited.status === "error") {
    return { ok: false, status: 503, error: waited.error };
  }

  const state = (await port.getState(threadId)) ?? waited.body;
  const values = valuesFromState(state) ?? state;
  const summary = pickStateText(values, SUMMARY_STATE_KEYS) ?? "";
  const returnedOriginal = pickStateText(values, ORIGINAL_STATE_KEYS) ?? message;

  let artifact = artifactFromTalk({
    output: step.output,
    title: step.label,
    original: returnedOriginal,
    summary,
    previous: { ...previous, threadId },
    constitution: isConstitution,
  });
  artifact = appendTalk(artifact, message, summary || returnedOriginal);
  artifact = { ...artifact, threadId };

  const written = await writeArtifactFiles(resolved.root, step.id, artifact, resolved.docs);
  if (!written.ok) return written;

  let processRecord = overlay.process;
  if (isConstitution) {
    processRecord = applyConstitutionToProcess(overlay.process, artifact, `${summary}\n${message}`, step.id, resolved.docs);
    await writeOverlayProcess(studioHome, resolved.alias, processRecord);
  }

  await writeProgressEntry(studioHome, resolved.alias, {
    summary: isConstitution ? `기획: ${step.label}` : `과정 대화: ${step.label}`,
    skill: "plan-stage",
    step: step.id,
  });

  const view = toProcessView(processRecord, resolved.root, resolved.docs);
  const stepView = isConstitution
    ? view.planBeats.find((item) => item.id === step.id) ?? { id: step.id, label: step.label, output: step.output, filled: true }
    : view.steps.find((item) => item.id === step.id) ?? {
        id: step.id,
        label: step.label,
        output: step.output,
        filled: true,
      };
  return {
    ok: true,
    process: isConstitution
      ? {
          ...view,
          planBeats: view.planBeats.map((item) => (item.id === step.id ? { ...item, filled: true } : item)),
        }
      : { ...view, steps: view.steps.map((item) => (item.id === step.id ? { ...item, filled: true } : item)) },
    step: { ...stepView, filled: true },
    artifact,
  };
}

function planTalkPrompt(beatId: string, goal: string, message: string): string {
  const intro =
    beatId === "plan-goal"
      ? "이 대화는 프로젝트의 목표를 정하는 자리입니다. 끝나는 상태를 표로 정리하세요."
      : beatId === "plan-direction"
        ? "이 대화는 목표를 달성할 로드맵을 정하는 자리입니다. 마일스톤별 기간·세부 작업·완료 기준을 표로 정리하세요."
        : "이 대화는 실행 순서를 정하는 자리입니다. 번호 목록이나 A → B 화살표로 답하세요.";
  return [
    intro,
    goal ? `지금까지의 목표: ${goal}` : "",
    '가능하면 JSON으로 답하세요. 표: {"type":"table","columns":["항목","내용"],"rows":[["",""]]} 도식: {"type":"diagram","nodes":[{"id":"a","label":"A"}],"edges":[{"from":"a","to":"b"}]}',
    "",
    message,
  ]
    .filter((line) => line !== "")
    .join("\n");
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
    const raw = await fs.readFile(abs, "utf8");
    const parsed = parseArtifact(JSON.parse(raw) as unknown, title);
    return parsed.type ? parsed : { ...parsed, type: output, title: parsed.title || title };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...EMPTY_ARTIFACT, type: output, title };
    }
    if (error instanceof SyntaxError) {
      return { ...EMPTY_ARTIFACT, type: output, title };
    }
    throw error;
  }
}

async function writeArtifactFiles(
  root: string,
  stepId: string,
  artifact: ProcedureArtifact,
  docs: string,
): Promise<{ ok: true } | { ok: false; status: 400; error: string }> {
  const jsonRel = procedureArtifactRel(stepId, docs);
  const mdRel = procedureMarkdownRel(stepId, docs);
  const jsonAbs = path.join(root, jsonRel);
  const mdAbs = path.join(root, mdRel);
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  const md = artifactToMarkdown(artifact);
  if (Buffer.byteLength(json, "utf8") > SOURCE_FILE_MAX_BYTES) {
    return { ok: false, status: 400, error: "process: 결과가 너무 큽니다." };
  }
  await fs.mkdir(path.dirname(jsonAbs), { recursive: true });
  await fs.writeFile(jsonAbs, json, "utf8");
  await fs.writeFile(mdAbs, md, "utf8");
  return { ok: true };
}
