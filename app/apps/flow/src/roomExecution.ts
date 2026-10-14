import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendRoomMessage, appendThreadMessage, parseIr, readOverlay, readApprovedProvenance, readRoom,
  readRoomMeta, readStudio, roomExecutionSchema, roomConnectedMemberSchema,
  roomExecutionStartSchema, roomWorkflowRequestSchema, roomReviewSchema,
  validateRoomAllocation, writeRoomMeta, ROOM_WORKFLOW_GRAPH,
  type RoomExecution, type RoomMember, type RoomPlan, type RoomWorkflowRequest,
} from "@patchbay/core";
import type { LangGraphPort } from "./langgraphAdapter.js";
import { findInterrupt } from "./threadView.js";
import { defaultRoomRunner, resolveRoomBin, isRoomRunning, type RoomRunner } from "./roomHost.js";
import { ROOM_WORKFLOW_SOURCE } from "./roomWorkflowTemplate.js";

type Pending = RoomWorkflowRequest;
type ActionResult = { ok: true; roomId: string; done?: Promise<void> } | { ok: false; status: 400 | 404 | 409 | 503; error: string };
export interface CommandResult { passed: boolean; code: number | null; text: string; ms: number }
export type CommandRunner = (argv: string[], cwd: string) => Promise<CommandResult>;

/** 직접 고른 argv만 실행한다. 리더 응답·요구사항 텍스트를 셸 명령으로 해석하지 않는다. */
export const runRoomCommand: CommandRunner = (argv, cwd) => new Promise(resolve => {
  const start = Date.now();
  const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = ""; let settled = false;
  const append = (b: Buffer) => { output = (output + b.toString()).slice(-16000); };
  const finish = (code: number | null, error = "") => {
    if (settled) return; settled = true; clearTimeout(timer);
    resolve({ passed: code === 0, code, text: (error || output).trim(), ms: Date.now() - start });
  };
  const timer = setTimeout(() => {
    try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    setTimeout(() => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, 2000).unref();
    finish(null, "명령이 3분 안에 끝나지 않았다. 실제 상태를 확인한 뒤 다시 진행한다.");
  }, 180000);
  child.stdout.on("data", append); child.stderr.on("data", append);
  child.on("error", e => finish(null, e.message)); child.on("close", code => finish(code));
});

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function jsonAnswer(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  return JSON.parse(clean);
}

export function createRoomExecutionHost(studioHome: string, deps: {
  port?: LangGraphPort; runner?: RoomRunner; bin?: string | null; command?: CommandRunner;
  notify?: (alias: string, roomId: string, execution: RoomExecution) => Promise<unknown>;
}) {
  const busy = new Set<string>();
  const key = (alias: string, roomId: string) => `${alias}/${roomId}`;
  const isBusy = (alias: string, roomId: string) => busy.has(key(alias, roomId));

  async function project(alias: string) {
    const found = (await readStudio(studioHome)).projects.find(p => p.alias === alias);
    if (!found) throw new Error("등록된 프로젝트를 찾지 못했다.");
    return found;
  }
  async function approved(alias: string): Promise<RoomPlan> {
    await project(alias);
    const overlay = await readOverlay(studioHome, alias);
    const parsed = overlay.ir ? parseIr(overlay.ir) : null;
    if (!parsed?.ok || !parsed.ir.version) throw new Error("채택된 설계가 없다. 상담에서 PRD를 검토하고 채택한다.");
    const ir = parsed.ir;
    const provenance = await readApprovedProvenance(studioHome, alias, ir.version!);
    return { version: ir.version!, digest: digest(ir), goal: ir.goal,
      requirements: ir.requirements.map(r => ({ id: r.id, text: r.text, ...(r.fit ? { fit: r.fit } : {}) })),
      evals: ir.evals.map(e => ({ id: e.id, expect: e.expect })),
      consultIds: [...new Set(provenance.entries.map(e => e.consult).filter((id): id is string => !!id))] };
  }
  async function save(alias: string, roomId: string, execution: RoomExecution) {
    const meta = await readRoomMeta(studioHome, alias, roomId);
    await writeRoomMeta(studioHome, alias, roomId, { ...meta, execution: roomExecutionSchema.parse(execution) });
  }
  async function record(alias: string, roomId: string, ex: RoomExecution, p: Pending, status: "started" | "completed" | "failed" | "waiting", text: string, result?: unknown) {
    await appendRoomMessage(studioHome, alias, roomId, { role: "operation", executionId: ex.id,
      operationId: p.operationId, stage: p.stage, status, text, threadId: ex.threadId,
      ...(p.memberId ? { memberId: p.memberId } : {}), ...(result !== undefined ? { result } : {}) });
  }
  async function observe(alias: string, roomId: string, ex: RoomExecution): Promise<{ execution: RoomExecution; values: Record<string, unknown>; pending?: Pending }> {
    if (!deps.port) throw new Error("LangGraph 연결이 필요하다.");
    const state = await deps.port.getState(ex.threadId);
    if (!state || typeof state !== "object") throw new Error("LangGraph 상태를 확인할 수 없다. 실행을 자동 반복하지 않는다.");
    const rec = state as { values?: Record<string, unknown>; next?: string[] };
    const values = rec.values ?? {};
    const found = findInterrupt(state);
    const parsed = found ? roomWorkflowRequestSchema.safeParse(found.value) : null;
    if (found && (!parsed?.success || parsed.data.executionId !== ex.id)) throw new Error("이 실행의 작업 요청이 아니다.");
    const pending = parsed?.success ? parsed.data : undefined;
    const phase = pending
      ? pending.kind === "approval" ? "approval" : pending.kind === "check_failed" ? "check_failed" : pending.kind === "deploy_approval" ? "deploy_approval" : pending.stage
      : values.phase;
    const projection = roomExecutionSchema.parse({ ...ex, phase, allocation: values.allocation ?? ex.allocation,
      pending: pending ?? null, error: typeof values.error === "string" && values.error ? values.error : undefined });
    await save(alias, roomId, projection);
    return { execution: projection, values, ...(pending ? { pending } : {}) };
  }
  async function wait(alias: string, ex: RoomExecution, input: unknown, resume?: unknown) {
    const result = await deps.port!.waitRun({ threadId: ex.threadId, assistantId: ex.assistantId, input,
      ...(resume ? { command: { resume } } : {}) });
    // A timed-out wait may still be running remotely. Never submit it a second time here.
    if (result.status !== "ok") throw new Error(result.status === "timeout" ? "LangGraph 응답 대기 시간이 지났다. 실제 상태를 확인한 뒤 이어간다." : result.error);
    await appendThreadMessage(studioHome, alias, ex.threadId, { role: "graph", assistantId: ex.assistantId,
      status: "success", text: "운영 그래프 응답을 받았다. 다음 단계는 실제 체크포인트에서 확인한다." });
  }
  async function call(ex: RoomExecution, member: RoomMember, prompt: string, cwd: string, stage: Pending["stage"]) {
    const bin = deps.bin !== undefined ? deps.bin : resolveRoomBin(member.speaker);
    if (!bin) throw new Error(`${member.speaker} 실행 파일이 없다.`);
    if (stage === "act" && ex.allowEdits && !["claude-code", "codex"].includes(member.speaker)) throw new Error("편집 수행은 권한을 제한할 수 있는 Claude 또는 Codex에 배정한다.");
    if (member.effort && !["claude-code", "codex"].includes(member.speaker)) throw new Error("이 공급자는 강도 전달을 지원하지 않는다. 강도를 모델 기본으로 설정한다.");
    return (deps.runner ?? defaultRoomRunner)({ speaker: member.speaker, model: member.model, role: member.role,
      ...(member.effort ? { effort: member.effort } : {}), execution: stage === "act" && ex.allowEdits ? "edit" : "read",
      bin, prompt, cwd, timeoutMs: 180000 });
  }
  async function perform(alias: string, roomId: string, ex: RoomExecution, p: Pending, values: Record<string, unknown>) {
    const messages = (await readRoom(studioHome, alias, roomId))?.messages ?? [];
    const previous = messages.filter(m => m.role === "operation" && m.operationId === p.operationId);
    const completed = previous.find(m => m.role === "operation" && m.status === "completed");
    if (completed?.role === "operation") return completed.result;
    if (previous.some(m => m.role === "operation" && m.status === "started")) {
      throw new Error("이 작업은 시작 기록만 있다. 중복 실행을 막기 위해 실제 결과를 확인해야 한다. 새 실행을 자동으로 만들지 않는다.");
    }
    await record(alias, roomId, ex, p, "started", `${p.stage} 작업 시작`);
    const cwd = (await project(alias)).path;
    let result: unknown;
    if (p.kind === "command") {
      if (p.stage !== "deploy" || !ex.deployCommand) throw new Error("허용된 배포 명령이 없다.");
      if (!messages.some(m => m.role === "operation" && m.executionId === ex.id && m.stage === "deploy"
        && m.status === "completed" && (m.result as { action?: string; target?: string } | undefined)?.action === "deploy"
        && (m.result as { target?: string }).target === ex.deployTarget)) throw new Error("이 실행 대상의 사용자 적용 확인이 없다.");
      result = { ok: true, executionId: ex.id, result: await (deps.command ?? runRoomCommand)(ex.deployCommand, cwd) };
    } else {
      const member = ex.members.find(m => m.id === p.memberId);
      if (!member) throw new Error("배정한 담당을 찾지 못했다.");
      const task = ex.allocation?.assignments.find(t => t.id === (p.task as { id?: string } | undefined)?.id);
      if (p.stage === "prepare" && member.id !== ex.leaderId) throw new Error("배정 요청의 리더가 다르다.");
      if (p.stage === "check" && (member.id !== ex.reviewerId || !task || task.memberId === member.id)) throw new Error("별도 검토자가 승인된 작업을 확인해야 한다.");
      const selected = p.stage === "act" && task?.effort ? { ...member, effort: task.effort } : member;
      const context = `상담에서 채택한 설계 v${ex.plan.version}만 수행한다. 요구 판단·Plan·초안 변경은 상담 전용이다. 새 요구는 outcome=consult로 표시한다.\n${JSON.stringify(ex.plan)}\n너의 역할: ${member.role}\n`;
      let prompt = context;
      let tests: CommandResult | undefined;
      if (p.stage === "prepare") {
        prompt += `너는 운영 리더다. 연결된 담당만 배정하고 요구사항 id를 모두 포함한다. 검토자는 수행에 배정하지 않는다. 사용자 모델 선택은 유지한다. 복잡도별 추론 강도를 추천하고 이유를 밝힌다. 지원 강도가 없는 공급자는 effort를 생략한다.\n담당: ${JSON.stringify(ex.members)}\n검토자: ${ex.reviewerId}\nJSON만 답한다: {"assignments":[{"id":"T-01","memberId":"연결된 id","requirementIds":["채택본 id"],"instruction":"승인 범위의 수행 지시","complexity":"low|medium|high","reason":"추천 이유","effort":"low|medium|high"}]}`;
      } else if (p.stage === "act") {
        if (!task || task.memberId !== member.id) throw new Error("승인된 배정과 다른 작업이다.");
        prompt += `수행할 작업: ${JSON.stringify(task)}\n앞선 산출물: ${JSON.stringify(values.outputs ?? [])}\n직전 검증: ${JSON.stringify(values.verification ?? null)}\n배포와 상담 초안 변경을 하지 않는다. 산출물과 검증 가능한 변경 내용을 답한다.`;
      } else if (p.stage === "check") {
        tests = await (deps.command ?? runRoomCommand)(ex.testCommand, cwd);
        prompt += `독립 검토자다. 승인본과 작업 산출물, 자동 시험을 대조한다.\n작업: ${JSON.stringify(task)}\n산출물: ${JSON.stringify(values.outputs ?? [])}\n자동 시험: ${JSON.stringify(tests)}\nJSON만 답한다: {"outcome":"passed|failed|consult","reason":"완료 근거 또는 오류·요구 해석 문제","evidence":["실제로 확인한 근거"]}. 요구·완료 기준을 새로 정하지 않는다.`;
      } else throw new Error("허용되지 않은 모델 단계다.");
      const answer = await call(ex, selected, prompt, cwd, p.stage);
      if (!answer.ok) result = { ok: false, executionId: ex.id, error: answer.text };
      else {
        await appendRoomMessage(studioHome, alias, roomId, { role: "speaker", speaker: selected.speaker,
          model: selected.model, memberId: selected.id, operationId: p.operationId, text: answer.text, ms: answer.ms,
          ...(selected.effort ? { effort: selected.effort } : {}), ...(answer.usage ? { usage: answer.usage } : {}) });
        try {
          const body = p.stage === "prepare" ? validateRoomAllocation(jsonAnswer(answer.text), ex)
            : p.stage === "check" ? { ...roomReviewSchema.parse(jsonAnswer(answer.text)), tests }
            : answer.text;
          result = { ok: true, executionId: ex.id, result: body };
        } catch (error) { result = { ok: false, executionId: ex.id, error: `모델 결과 형식을 확인하지 못했다: ${(error as Error).message}` }; }
      }
    }
    await record(alias, roomId, ex, p, "completed", `${p.stage} 결과 기록`, result);
    return result;
  }
  async function drain(alias: string, roomId: string, initial: RoomExecution) {
    let ex = initial;
    for (let i = 0; i < 24; i++) {
      const observed = await observe(alias, roomId, ex); ex = observed.execution;
      const p = observed.pending;
      if (!p || !["model", "command"].includes(p.kind)) {
        if (ex.notifications && deps.notify) {
          const operationId = `${ex.id}:notification:${p?.operationId ?? ex.phase}:${ex.phase}`;
          const messages = (await readRoom(studioHome, alias, roomId))?.messages ?? [];
          if (!messages.some(m => m.role === "operation" && m.operationId === operationId)) {
            await appendRoomMessage(studioHome, alias, roomId, { role: "operation", executionId: ex.id, operationId,
              stage: p?.stage ?? "check", status: "started", text: "선택한 채널로 상태 알림 전송" });
            try {
              const result = await deps.notify(alias, roomId, ex);
              await appendRoomMessage(studioHome, alias, roomId, { role: "operation", executionId: ex.id, operationId,
                stage: p?.stage ?? "check", status: "completed", text: "알림 전송 결과", result });
            } catch {
              await appendRoomMessage(studioHome, alias, roomId, { role: "operation", executionId: ex.id, operationId,
                stage: p?.stage ?? "check", status: "failed", text: "알림 설정을 확인하지 못했다. 실행 결과는 유지된다." });
            }
          }
        }
        return;
      }
      const current = await approved(alias);
      if (current.digest !== ex.plan.digest) {
        await save(alias, roomId, { ...ex, phase: "consult", error: "채택본이 바뀌었다. 영향 범위를 확인하고 새 승인본으로 실행한다." });
        return;
      }
      const result = await perform(alias, roomId, ex, p, observed.values);
      await wait(alias, ex, null, result);
    }
    throw new Error("한 번의 실행 처리 한도를 넘겼다. 실제 상태를 확인한다.");
  }
  function background(alias: string, roomId: string, ex: RoomExecution, operation: () => Promise<void>): Promise<void> {
    return operation().catch(async error => {
      const current = (await readRoomMeta(studioHome, alias, roomId)).execution ?? ex;
      await save(alias, roomId, { ...current, phase: "uncertain", error: (error as Error).message });
    }).finally(() => busy.delete(key(alias, roomId)));
  }

  async function start(value: unknown): Promise<ActionResult> {
    const parsed = roomExecutionStartSchema.safeParse(value);
    if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "실행 설정이 올바르지 않다." };
    const input = parsed.data; const lock = key(input.alias, input.roomId);
    if (busy.has(lock) || isRoomRunning(input.alias, input.roomId)) return { ok: false, status: 409, error: "이 방은 실행 중이다." };
    busy.add(lock);
    let launched = false;
    try {
      const meta = await readRoomMeta(studioHome, input.alias, input.roomId);
      if (!(await readRoom(studioHome, input.alias, input.roomId))) return { ok: false, status: 404, error: "대화방이 없다." };
      if (meta.kept) throw new Error("읽기 전용 방이다.");
      if (meta.execution && !["done", "failed", "consult"].includes(meta.execution.phase)) throw new Error("이전 실행을 먼저 확인한다.");
      const plan = await approved(input.alias);
      if (meta.execution?.phase === "consult" && plan.digest === meta.execution.plan.digest) throw new Error("상담 재검토 후 새 승인본을 채택해야 실행을 다시 시작할 수 있다.");
      const members = meta.members.filter(m => m.enabled !== false).map(m => roomConnectedMemberSchema.parse(m));
      const leader = members.find(m => m.id === input.leaderId);
      if (!leader || !members.some(m => m.id === input.reviewerId) || input.leaderId === input.reviewerId) throw new Error("리더와 별도 검토자를 선택한다.");
      if (input.deployCommand && !input.deployTarget.trim()) throw new Error("배포 명령에는 대상을 명시한다.");
      if (!deps.port || !(await deps.port.probe())) return { ok: false, status: 503, error: "프로젝트의 LangGraph 서버를 켠다." };
      const assistants = await deps.port.listAssistants();
      const assistant = assistants?.find(a => a.graphId === ROOM_WORKFLOW_GRAPH);
      if (!assistant) return { ok: false, status: 503, error: "운영 그래프를 연결해야 한다. 실행 설정에서 ‘LangGraph 연결 준비’를 누르고 프로젝트의 그래프 서버를 다시 켠다." };
      const threadId = await deps.port.createThread(ROOM_WORKFLOW_GRAPH);
      if (!threadId) throw new Error("LangGraph 실행 스레드를 만들지 못했다.");
      const ex: RoomExecution = { ...input, id: randomUUID(), threadId, assistantId: assistant.id, plan, members, phase: "prepare" };
      await save(input.alias, input.roomId, ex);
      await appendThreadMessage(studioHome, input.alias, threadId, { role: "user", text: `대화방 ${input.roomId} · 채택본 v${plan.version} 실행` });
      const done = background(input.alias, input.roomId, ex, async () => { await wait(input.alias, ex, { execution: ex, phase: "prepare" }); await drain(input.alias, input.roomId, ex); });
      launched = true;
      return { ok: true, roomId: input.roomId, done };
    } catch (error) { return { ok: false, status: 409, error: (error as Error).message }; }
    finally { if (!launched) busy.delete(lock); }
  }
  async function action(input: { alias: string; roomId: string; action: string; target?: string; note?: string; executionId?: string; useRecommendedEffort?: boolean }): Promise<ActionResult> {
    const lock = key(input.alias, input.roomId);
    if (busy.has(lock)) return { ok: false, status: 409, error: "실행을 처리하고 있다." };
    busy.add(lock); let launched = false;
    try {
      const meta = await readRoomMeta(studioHome, input.alias, input.roomId);
      const ex = meta.execution;
      if (!ex || ex.id !== input.executionId) throw new Error("현재 실행 id를 확인한다.");
      if (meta.kept) throw new Error("읽기 전용 방이다.");
      if (input.action === "consult") {
        if (!input.note?.trim()) throw new Error("상담으로 보낼 변경 내용을 입력한다.");
        await appendRoomMessage(studioHome, input.alias, input.roomId, { role: "operation", executionId: ex.id,
          operationId: `${ex.id}:consult:${randomUUID()}`, stage: "consult", status: "waiting", threadId: ex.threadId,
          text: input.note.trim(), result: { version: ex.plan.version, consultIds: ex.plan.consultIds } });
        await save(input.alias, input.roomId, { ...ex, phase: "consult", error: "요구 변경을 상담에서 재검토한다. 관련 실행은 대기한다." });
        return { ok: true, roomId: input.roomId };
      }
      if (["consult", "done", "failed"].includes(ex.phase)) throw new Error("종료·상담 대기 실행은 재개하지 않는다.");
      const current = await approved(input.alias);
      if (current.digest !== ex.plan.digest) throw new Error("채택본이 바뀌었다. 상담에서 영향을 확인하고 새 실행을 시작한다.");
      if (input.action === "sync") {
        const done = background(input.alias, input.roomId, ex, () => drain(input.alias, input.roomId, ex));
        launched = true; return { ok: true, roomId: input.roomId, done };
      }
      const observed = await observe(input.alias, input.roomId, ex); const p = observed.pending;
      if (!p) throw new Error("재개할 요청이 없다.");
      let reply: Record<string, unknown> = { executionId: ex.id, action: input.action };
      if (input.action === "approve" && p.kind === "approval") {
        const allocation = validateRoomAllocation(observed.execution.allocation, ex);
        const applied = { assignments: allocation.assignments.map(t => {
          const member = ex.members.find(m => m.id === t.memberId)!;
          return { ...t, effort: input.useRecommendedEffort ? t.effort ?? member.effort : member.effort };
        }) };
        reply.allocation = applied;
      } else if (input.action === "retry" && p.kind === "check_failed") {
        if (Number(observed.values.attempt) >= ex.maxAttempts) throw new Error("수정 재시도 한도를 넘겼다. 상담에서 재검토한다.");
      } else if (input.action === "deploy" && p.kind === "deploy_approval") {
        if (!ex.deployCommand || input.target !== ex.deployTarget) throw new Error("배포 대상을 정확히 확인한다.");
        reply.target = input.target;
      } else if (!(input.action === "finish" && p.kind === "deploy_approval" && !ex.deployCommand)) throw new Error("현재 단계에서 허용되지 않는 동작이다.");
      await record(input.alias, input.roomId, ex, { ...p, operationId: `${p.operationId}:${input.action}` }, "completed", `사용자 ${input.action}`, reply);
      const done = background(input.alias, input.roomId, ex, async () => { await wait(input.alias, ex, null, reply); await drain(input.alias, input.roomId, ex); });
      launched = true; return { ok: true, roomId: input.roomId, done };
    } catch (error) { return { ok: false, status: 409, error: (error as Error).message }; }
    finally { if (!launched) busy.delete(lock); }
  }
  async function install(alias: string) {
    const repo = (await project(alias)).path;
    const filename = "patchbay-operations.ts";
    const configFile = path.join(repo, "langgraph.json");
    let config: Record<string, unknown>;
    try { config = JSON.parse(await fs.readFile(configFile, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; config = { node_version: "20", dependencies: ["."], graphs: {} }; }
    if (config.python_version && !config.node_version) throw new Error("현재 프로젝트는 Python LangGraph 설정이다. 운영 그래프는 기존 TypeScript 런타임에 연결해야 한다. Python 설정은 바꾸지 않는다.");
    const graphs = config.graphs && typeof config.graphs === "object" && !Array.isArray(config.graphs) ? config.graphs as Record<string, unknown> : {};
    if (graphs[ROOM_WORKFLOW_GRAPH] && graphs[ROOM_WORKFLOW_GRAPH] !== `./${filename}:graph`) throw new Error("같은 이름의 운영 그래프가 이미 있다. 기존 설정은 덮지 않는다.");
    try { await fs.writeFile(path.join(repo, filename), ROOM_WORKFLOW_SOURCE, { flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await fs.readFile(path.join(repo, filename), "utf8")) !== ROOM_WORKFLOW_SOURCE) throw new Error("기존 운영 그래프 파일은 덮지 않는다.");
    }
    await fs.writeFile(configFile, JSON.stringify({ ...config, graphs: { ...graphs, [ROOM_WORKFLOW_GRAPH]: `./${filename}:graph` } }, null, 2) + "\n");
    return { file: filename, graphId: ROOM_WORKFLOW_GRAPH, next: "프로젝트의 기존 @langchain/langgraph 환경에서 그래프 서버를 다시 켠다. 체크포인트 저장소는 기존 서버 설정을 따른다." };
  }
  const busyAliases = () => [...busy].map((k) => k.slice(0, k.lastIndexOf("/")));
  return { start, action, approved, install, isBusy, busyAliases };
}
