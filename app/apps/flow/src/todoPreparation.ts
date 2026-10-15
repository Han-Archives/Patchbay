import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appendRoomMessage, latestPreparations, preparationDraftSchema, readAgents, readModes, readRoom, readRoomMeta,
  readStudio, readTodoPreparations, readTodos, todoInputDigest, updateTodoPreparations, updateTodos,
  type TodoPreparation,
} from "@patchbay/core";
import { applyTodoAction } from "./todoActions.js";
import { canApply, claimPreparationRoom, defaultRoomRunner, resolveRoomBin, type RoomRunner } from "./roomHost.js";

const exec = promisify(execFile);
const ignored = new Set([".git", "node_modules", "workspace", "dist", "dist-client", "dist-server", ".index", ".trash", "archive"]);
/** 입력 변경을 보수적으로 감지한다. git에서는 추적/미추적 파일, 일반 폴더에서는 생성물 제외 원문을 해시한다. */
export async function preparationFingerprint(cwd: string): Promise<string> {
  let files: string[];
  try { files = (await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, maxBuffer: 8_000_000 })).stdout.split("\0").filter(Boolean); }
  catch {
    files = [];
    async function walk(dir: string) {
      for (const e of await fs.readdir(path.join(cwd, dir), { withFileTypes: true })) {
        if (ignored.has(e.name)) continue;
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) await walk(rel); else files.push(rel);
        if (files.length > 20_000) throw new Error("입력 파일이 너무 많습니다. 프로젝트 대상 범위를 좁혀주세요.");
      }
    }
    await walk("");
  }
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].filter(f => !f.split(/[\\/]/).some(p => ignored.has(p))).sort()) {
    hash.update(file + "\0");
    try { const stat = await fs.lstat(path.join(cwd, file)); if (stat.isSymbolicLink()) hash.update(await fs.readlink(path.join(cwd, file))); else if (stat.isFile()) { const stream = (await fs.open(path.join(cwd, file))).createReadStream(); for await (const chunk of stream) hash.update(chunk); } }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; hash.update("deleted"); }
  }
  return hash.digest("hex");
}
export class PreparationError extends Error { constructor(message: string, public status: 400 | 404 | 409 = 409) { super(message); } }
function parseJson(text: string): unknown { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
function recordText(text: string): string {
  try {
    const value = parseJson(text) as Record<string, unknown>;
    if (Array.isArray(value.plan)) return `업무 판단: ${value.reason}\n\n수행 계획\n${value.plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n산출물은 이 대화의 ‘미리 준비한 결과’에서 확인합니다.\n승인 후 남은 작업: ${value.remaining}`;
    if (typeof value.summary === "string") return `${value.summary}\n검증 결과: ${value.outcome}\n${JSON.stringify(value.checks ?? [])}`;
    if (typeof value.reason === "string") return `모드 선택: ${value.modeId}\n${value.reason}`;
  } catch { /* 형식 오류의 원문도 검토에 남긴다. */ }
  return text.slice(0, 12_000);
}
function fail(message: string): never { throw new PreparationError(message); }
export interface PreparationDeps { runner?: RoomRunner; bin?: string | null; fingerprint?: (cwd: string) => Promise<string>; isBusy?: (alias: string, roomId?: string) => boolean; }

export function createTodoPreparationHost(home: string, deps: PreparationDeps = {}) {
  const active = new Map<string, { controller: AbortController; done?: Promise<void> }>();
  const fingerprint = deps.fingerprint ?? preparationFingerprint;
  async function project(alias: string) {
    const found = (await readStudio(home)).projects.find(p => p.alias === alias);
    if (!found) throw new PreparationError("등록된 프로젝트가 아닙니다.", 404);
    return found;
  }
  function reserve(alias: string) {
    if (active.has(alias) || deps.isBusy?.(alias)) fail("프로젝트에서 다른 작업을 처리하고 있습니다.");
    const item = { controller: new AbortController(), done: undefined as Promise<void> | undefined }; active.set(alias, item); return item;
  }
  async function patch(alias: string, id: string, fields: Partial<TodoPreparation>) {
    await updateTodoPreparations(home, alias, rows => rows.map(v => v.id === id ? { ...v, ...fields, updatedAt: new Date().toISOString() } : v));
  }
  async function log(alias: string, v: TodoPreparation, stage: "prepare" | "act" | "check", status: "started" | "completed" | "failed" | "waiting", text: string) {
    await appendRoomMessage(home, alias, v.roomId, { role: "operation", executionId: v.batchId, operationId: v.id, stage, status, text });
  }
  async function call(alias: string, v: TodoPreparation, cwd: string, prompt: string, execution: "read" | "edit" | "apply", signal: AbortSignal) {
    const bin = deps.bin !== undefined ? deps.bin : resolveRoomBin(v.member.speaker);
    if (!bin) fail("주 담당 LLM 실행 파일을 찾을 수 없습니다.");
    if (signal.aborted) fail("준비를 중지했습니다.");
    const result = await (deps.runner ?? defaultRoomRunner)({ speaker: v.member.speaker, model: v.member.model, role: v.member.role,
      effort: v.member.effort, bin, prompt, cwd, execution, signal, timeoutMs: execution === "read" ? 600_000 : 1_200_000 });
    if (signal.aborted) fail("작업이 중지되었습니다. 실행 중이었다면 변경 내용을 확인해주세요.");
    if (!result.ok) fail(result.text);
    await appendRoomMessage(home, alias, v.roomId, { role: "speaker", speaker: v.member.speaker, model: v.member.model, memberId: v.member.id,
      operationId: v.id, text: recordText(result.text), ms: result.ms, ...(result.usage ? { usage: result.usage } : {}) });
    return result.text;
  }
  async function list(alias: string) {
    await project(alias);
    const todos = await readTodos(home, alias);
    const versions = await updateTodoPreparations(home, alias, rows => {
      const latest = new Map(latestPreparations(rows).map(v => [v.todoId, v]));
      return rows.map(v => {
        if (latest.get(v.todoId)?.id !== v.id) return v;
        if (!active.has(alias) && ["queued", "preparing", "applying"].includes(v.status)) return { ...v, status: v.status === "applying" ? "failed" as const : "stopped" as const, error: "서버 종료로 작업이 중단되었습니다. 실행 중이었다면 실제 변경을 확인한 후 다시 준비해주세요." };
        if (!["ready", "waiting", "held"].includes(v.status)) return v;
        const todo = todos.find(t => t.id === v.todoId);
        const changed = !todo || todo.inactive || todoInputDigest(todo) !== v.inputDigest || v.dependencies.some(d => {
          const t = todos.find(t => t.id === d.todoId);
          return !t || (d.inputDigest && todoInputDigest(t) !== d.inputDigest) || latest.get(d.todoId)?.id !== d.versionId || latest.get(d.todoId)?.status === "stale";
        });
        return changed ? { ...v, status: "stale" as const, error: "할일 요구사항 또는 연결된 준비본이 변경되었습니다. 다시 준비해주세요." } : v;
      });
    });
    return { versions, items: latestPreparations(versions), running: active.has(alias) };
  }
  async function prepare(alias: string, v: TodoPreparation, signal: AbortSignal) {
    const p = await project(alias);
    const lease = claimPreparationRoom(alias, v.roomId);
    const joined = AbortSignal.any([signal, lease.signal]);
    try {
      const todo = (await readTodos(home, alias)).find(t => t.id === v.todoId);
      if (!todo || todo.done || todo.inactive || todoInputDigest(todo) !== v.inputDigest) fail("할일 내용이 바뀌었습니다. 다시 준비해주세요.");
      const meta = await readRoomMeta(home, alias, v.roomId);
      if (meta.kept || meta.execution) fail("읽기 전용 또는 테스트 실행 대화에서는 사전 준비할 수 없습니다.");
      await patch(alias, v.id, { status: "preparing", error: undefined });
      await log(alias, v, "prepare", "started", "미리 준비 시작 · 유형 판단 → 모드 선택 → 연계 분석 → 계획과 산출물 작성");
      const modes = await readModes(home, alias);
      const before = await fingerprint(p.path);
      const messages = (await readRoom(home, alias, v.roomId))?.messages.filter(m => m.role !== "operation" && !("operationId" in m && m.operationId)).slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 4000) }));
      const input = JSON.stringify({ todo, revisionRequest: v.revisionNote, conversation: messages });
      const choice = parseJson(await call(alias, v, p.path,
        `할일 업무 유형에 맞는 모드를 하나 선택한다. 파일을 수정하거나 명령을 실행하지 않는다. JSON만 출력: {"modeId":"목록의 id","reason":"선택 이유"}.\n모드: ${JSON.stringify(modes)}\n입력: ${input}`, "read", joined)) as { modeId?: string; reason?: string };
      const mode = modes.find(m => m.id === choice.modeId);
      if (!mode || typeof choice.reason !== "string") fail("LLM이 유효한 모드를 선택하지 못했습니다.");
      await patch(alias, v.id, { modeId: mode.id, mode, reason: choice.reason });
      await log(alias, v, "prepare", "waiting", `업무 모드: ${mode.name}\n선택 이유: ${choice.reason}`);
      const todos = await readTodos(home, alias);
      const index = todos.findIndex(t => t.id === v.todoId);
      const latest = latestPreparations(await readTodoPreparations(home, alias));
      const preceding = todos.slice(0, index).filter(t => !t.inactive).slice(-20).map(t => {
        const source = latest.find(r => r.todoId === t.id);
        return { todoId: t.id, title: t.title, detail: t.detail, done: t.done, status: source?.status, versionId: source?.id,
          artifacts: source?.artifacts.map(a => ({ name: a.name, content: a.content.slice(0, 12_000) })) };
      });
      const draft = preparationDraftSchema.parse(parseJson(await call(alias, v, p.path, [
        `미리 준비 작업이다. 모드: ${mode.name}. 규약: ${mode.prompt}`,
        "이번 실행은 읽기 전용이다. 파일 수정·명령 실행·외부 반영은 하지 않는다. 필요한 원문을 읽고 실제 검토 가능한 산출물 내용을 응답 JSON에 담는다. 호스트가 별도 준비본으로 저장한다.",
        "문서는 본문, 디자인은 완전한 HTML, 코드는 적용 가능한 unified diff 등 실제 산출물을 작성한다. 단순 계획으로 산출물을 대신하지 않는다. 필수 선행 입력이 없으면 artifacts=[]와 남은 단계를 명시한다.",
        "앞 할일 중 관련된 것만 dependencies로 추천한다. reference는 참고, required는 반드시 확정돼야 하는 선행 작업이다. 미승인 결과 사용 여부와 근거를 명시한다. 없으면 빈 배열이다.",
        'JSON만 출력한다: {"modeId":"선택한 id","reason":"업무 판단","plan":["수행 단계"],"completion":["객관적인 완료 조건"],"dependencies":[{"todoId":"앞 할일 id","kind":"reference 또는 required","reason":"사용할 내용과 이유"}],"artifacts":[{"name":"산출물명","format":"markdown 또는 html 또는 text 또는 diff","content":"실제 초안 전체"}],"remaining":"사용자 확인 후 남은 실행·검증 단계"}',
        `선택된 modeId: ${mode.id}\n사용자 입력: ${input}\n앞선 할일과 결과: ${JSON.stringify(preceding)}`,
      ].join("\n"), "read", joined)));
      if (draft.modeId !== mode.id) fail("선택한 모드와 산출물 모드가 다릅니다.");
      const ids = new Set<string>();
      const dependencies = draft.dependencies.map(d => {
        const t = todos.slice(0, index).find(t => t.id === d.todoId && !t.inactive);
        if (!t || ids.has(d.todoId)) fail("연계 추천은 중복 없이 앞선 할일만 가리켜야 합니다.");
        ids.add(d.todoId); const source = latest.find(r => r.todoId === t.id);
        return { todoId: d.todoId, kind: d.kind, reason: d.reason, versionId: source?.id, inputDigest: todoInputDigest(t) };
      });
      const waiting = dependencies.some(d => d.kind === "required" && !todos.find(t => t.id === d.todoId)?.done);
      if (!waiting && !draft.artifacts.length) fail("검토할 산출물이 없습니다. 다시 준비해주세요.");
      const changed = before !== await fingerprint(p.path);
      await patch(alias, v.id, { ...draft, dependencies, mode, baseline: before, status: changed ? "stale" : waiting ? "waiting" : "ready", error: changed ? "준비 중 프로젝트 원문이 변경되었습니다. 다시 준비해주세요." : undefined });
      await log(alias, v, "prepare", "completed", `${mode.name} · ${waiting ? "선행 결과 대기" : "검토 대기"}\n\n계획\n${draft.plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n연계 추천\n${dependencies.map(d => `${todos.find(t => t.id === d.todoId)?.title}: ${d.reason}`).join("\n") || "없음"}\n\n산출물: ${draft.artifacts.map(a => a.name).join(", ") || "필수 입력 확정 후 작성"}\n\n승인 후: ${draft.remaining}`);
    } catch (e) {
      const error = (e as Error).message;
      await patch(alias, v.id, { status: joined.aborted ? "stopped" : "failed", error });
      await log(alias, v, "prepare", "failed", error);
      throw e;
    } finally { lease.release(); }
  }
  async function start(alias: string, ids: string[], memberId: string, revisionNote?: string) {
    const reservation = reserve(alias);
    try {
      await project(alias);
      if (!ids.length || ids.length > 5 || new Set(ids).size !== ids.length) throw new PreparationError("할일을 중복 없이 1~5개 선택해주세요.", 400);
      const members = await readAgents(home, alias);
      const member = members.find(m => m.id === memberId && m.enabled !== false);
      if (!member || !canApply(member)) throw new PreparationError("주 담당은 사용 가능한 Claude 또는 Codex에서 선택해주세요.", 400);
      const todos = await readTodos(home, alias);
      const chosen = todos.filter(t => ids.includes(t.id) && !t.done && !t.inactive);
      if (chosen.length !== ids.length) fail("할일 목록이 바뀌었습니다. 다시 선택해주세요.");
      const batchId = randomUUID(); const at = new Date().toISOString(); const versions: TodoPreparation[] = [];
      for (const t of chosen) {
        const result = await applyTodoAction(home, alias, { action: "room", id: t.id }, room => !!deps.isBusy?.(alias, room));
        const meta = await readRoomMeta(home, alias, result.roomId!);
        if (meta.kept || meta.execution) fail("읽기 전용 또는 테스트 실행 대화는 대상에서 제외해주세요.");
        versions.push({ id: randomUUID(), batchId, todoId: t.id, title: t.title, roomId: result.roomId!, inputDigest: todoInputDigest(t), baseline: "", member,
          modeId: "pending", reason: "업무 판단 대기", plan: [], completion: [], dependencies: [], artifacts: [], remaining: "계획 수립 후 결정", at, updatedAt: at, status: "queued", revisionNote });
      }
      await updateTodoPreparations(home, alias, rows => [...rows, ...versions]);
      reservation.done = (async () => {
        try {
          for (const v of versions) { if (reservation.controller.signal.aborted) break; await prepare(alias, v, reservation.controller.signal); }
        } catch { /* 항목 오류는 prepare에서 저장한다. 묶음은 중지한다. */ }
        finally {
          await updateTodoPreparations(home, alias, rows => rows.map(v => v.batchId === batchId && v.status === "queued" ? { ...v, status: "stopped", error: "묶음이 중지되었습니다. 다시 선택해 준비할 수 있습니다." } : v));
          active.delete(alias);
        }
      })();
      void reservation.done.catch(() => active.delete(alias));
      return { batchId, ids: versions.map(v => v.id) };
    } catch (e) { active.delete(alias); throw e; }
  }
  async function action(alias: string, id: string, action: string, note?: string) {
    await project(alias);
    if (action === "stop") { const run = active.get(alias); if (!run) fail("진행 중인 준비 작업이 없습니다."); run.controller.abort(); return; }
    if (active.has(alias)) fail("진행 중인 작업이 끝난 뒤 확인해주세요.");
    const state = await list(alias); const v = state.items.find(v => v.id === id);
    if (!v) throw new PreparationError("최신 준비본을 찾을 수 없습니다.", 404);
    if (["applying", "done"].includes(v.status)) fail("실행 중이거나 완료된 준비본은 변경할 수 없습니다.");
    if (action === "hold") {
      if (!["ready", "waiting"].includes(v.status)) fail("검토 대기 중인 준비본만 보류할 수 있습니다.");
      reserve(alias);
      try { await patch(alias, id, { status: "held" }); await log(alias, v, "prepare", "waiting", "사용자가 준비 결과를 보류했습니다."); }
      finally { active.delete(alias); }
      return;
    }
    if (action === "revise") {
      if (!note?.trim() || note.length > 4000) throw new PreparationError("수정할 내용을 4,000자 이내로 입력해주세요.", 400);
      await appendRoomMessage(home, alias, v.roomId, { role: "user", text: `준비본 수정 요청\n${note}` });
      return start(alias, [v.todoId], v.member.id ?? "", note);
    }
    if (action === "reprepare") return start(alias, [v.todoId], v.member.id ?? "");
    if (action !== "approve") throw new PreparationError("지원하지 않는 준비 작업입니다.", 400);
    if (!["ready", "held"].includes(v.status) || !v.artifacts.length || !v.completion.length) fail("실행 가능한 산출물을 다시 준비해주세요.");
    const run = reserve(alias);
    let lease: ReturnType<typeof claimPreparationRoom> | undefined;
    try {
      const p = await project(alias); lease = claimPreparationRoom(alias, v.roomId);
      const todos = await readTodos(home, alias); const todo = todos.find(t => t.id === v.todoId);
      if (!todo || todo.done || todo.inactive || todoInputDigest(todo) !== v.inputDigest) fail("할일 내용이 변경되었습니다.");
      const queue = todos.filter(t => !t.done && !t.inactive);
      if (queue[0]?.id !== todo.id) fail(`먼저 위의 할일 「${queue[0]?.title}」을 완료해주세요.`);
      if (v.dependencies.some(d => d.kind === "required" && !todos.find(t => t.id === d.todoId)?.done)) fail("필수 선행 할일을 먼저 완료해주세요.");
      if (v.baseline !== await fingerprint(p.path)) { await patch(alias, id, { status: "stale", error: "프로젝트 원문이 준비 당시와 다릅니다. 다시 준비해주세요." }); fail("프로젝트가 변경되어 재검토가 필요합니다."); }
      const meta = await readRoomMeta(home, alias, v.roomId);
      if (meta.kept || meta.execution) fail("이 대화는 실제 반영에 사용할 수 없습니다.");
      await patch(alias, id, { status: "applying", approvedAt: new Date().toISOString(), error: undefined });
      await appendRoomMessage(home, alias, v.roomId, { role: "user", text: `준비본 ${v.id}을 확인했습니다. 이 산출물로 그대로 진행하세요.` });
      const heldLease = lease;
      run.done = (async () => {
        try {
          await log(alias, v, "act", "started", `사용자가 승인한 준비본 ${v.id} 실행`);
          const prompt = [
            "사용자가 아래 준비본을 승인했다. 승인한 계획과 산출물을 재생성하지 말고 그대로 사용해 남은 작업만 수행한다.",
            `모드: ${v.mode?.name}\n규약: ${v.mode?.prompt}\n권한: ${v.mode?.execution ?? "read"}`,
            "프로젝트 규칙을 따른다. 커밋·푸시·삭제·배포·서버 재시작은 하지 않는다. 할일 및 준비 상태 파일을 직접 수정하지 않는다. 추가 사용자 판단이 필요하면 실패로 보고한다.",
            "각 완료 조건을 실제로 확인한다. 검증하지 못한 내용을 통과로 보고하지 않는다. JSON만 출력: {\"outcome\":\"passed 또는 failed\",\"summary\":\"실제 수행 결과\",\"checks\":[{\"condition\":\"아래 완료 조건 원문\",\"passed\":true,\"evidence\":\"검증 근거\"}]}",
            JSON.stringify({ title: v.title, plan: v.plan, artifacts: v.artifacts, remaining: v.remaining, completion: v.completion }),
          ].join("\n");
          const result = parseJson(await call(alias, v, p.path, prompt, v.mode?.execution ?? "read", AbortSignal.any([run.controller.signal, heldLease.signal]))) as { outcome?: string; summary?: string; checks?: { condition: string; passed: boolean; evidence: string }[] };
          if (result.outcome !== "passed" || typeof result.summary !== "string" || !result.summary.trim() || !Array.isArray(result.checks) || !v.completion.every(c => result.checks!.some(check => check.condition === c && check.passed === true && typeof check.evidence === "string" && check.evidence.trim()))) fail(result.summary || "완료 조건의 검증 근거가 부족합니다.");
          await log(alias, v, "check", "completed", `${result.summary}\n${result.checks.map(c => `${c.condition}: ${c.evidence}`).join("\n")}`);
          const freshTodo = (await readTodos(home, alias)).find(t => t.id === v.todoId);
          if (!freshTodo || todoInputDigest(freshTodo) !== v.inputDigest || run.controller.signal.aborted || heldLease.signal.aborted) fail("실행 중 요청이 변경되거나 중지되었습니다. 실제 결과를 확인해주세요.");
          await patch(alias, id, { status: "done", result: result.summary });
          await updateTodos(home, alias, rows => rows.map(t => t.id === v.todoId ? { ...t, done: true } : t));
        } catch (e) { await patch(alias, id, { status: "failed", error: (e as Error).message }); await log(alias, v, "act", "failed", (e as Error).message); }
        finally { heldLease.release(); active.delete(alias); }
      })();
      void run.done.catch(() => { heldLease.release(); active.delete(alias); });
    } catch (e) { lease?.release(); active.delete(alias); throw e; }
    return undefined;
  }
  return { list, start, action, isBusy: (alias: string) => active.has(alias), wait: async (alias: string) => { await active.get(alias)?.done; }, stopAll: () => { for (const run of active.values()) run.controller.abort(); } };
}
