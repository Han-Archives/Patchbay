import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRoom, readTodos, readTodoHistory, registerProject, updateTodos, writeAgents, writeTodos, updateTodoPreparations } from "@patchbay/core";
import { createTodoPreparationHost, preparationFingerprint } from "./todoPreparation.js";
import { sendRoomTurn, type RoomRunner } from "./roomHost.js";
import { createFlowApp } from "./server.js";
const draft = (dependencies: unknown[] = []) => ({ modeId: "report", reason: "보고서 작성 업무", plan: ["자료를 확인한다", "초안을 작성한다"], completion: ["필수 내용 포함"], dependencies, artifacts: [{ name: "보고서", format: "markdown", content: "# 실제 산출물\n검토할 본문" }], remaining: "승인한 문서를 반영하고 필수 내용을 검증" });
async function setup(count = 2) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-prep-"));
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pb-prep-repo-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: cwd });
  await writeAgents(home, "demo", [{ id: "lead", speaker: "codex", model: "", role: "업무 수행" }]);
  await writeTodos(home, "demo", Array.from({ length: count }, (_, i) => ({ id: `t${i}`, title: `업무 ${i}`, at: new Date().toISOString(), done: false })));
  return { home, cwd };
}
function runner(dependencies: unknown[] = []): RoomRunner {
  return async req => ({ ok: true, ms: 1, text: JSON.stringify(req.prompt.includes("모드를 하나 선택") ? { modeId: "report", reason: "보고서" } : req.prompt.includes("승인했다") ? { outcome: "passed", summary: "반영 및 검증 완료", checks: [{ condition: "필수 내용 포함", passed: true, evidence: "작성된 본문 확인" }] } : draft(dependencies)) });
}

describe("할일 사전 준비", () => {
  it("최대 5개를 실제 목록 순서대로 read 권한으로 준비하고 대화와 산출물을 저장하며 완료하지 않는다", async () => {
    const { home } = await setup(7); const calls: string[] = [];
    const mock = runner();
    const host = createTodoPreparationHost(home, { bin: "mock", fingerprint: async () => "same", runner: async req => { calls.push(req.execution!); return mock(req); } });
    await expect(host.start("demo", ["t0","t1","t2","t3","t4","t5"], "lead")).rejects.toThrow("1~5");
    await host.start("demo", ["t4","t2","t0","t3","t1"], "lead"); await host.wait("demo");
    const state = await host.list("demo"); expect(state.items.map(v => v.todoId)).toEqual(["t0","t1","t2","t3","t4"]);
    expect(state.items.every(v => v.status === "ready")).toBe(true); expect(calls).toEqual(Array(10).fill("read"));
    expect(state.items[0]!.artifacts[0]!.content).toContain("실제 산출물");
    expect((await readTodos(home,"demo")).every(t => !t.done)).toBe(true);
    expect((await readRoom(home,"demo",state.items[0]!.roomId))!.messages.some(m => m.text.includes("모드"))).toBe(true);
    const recreated = createTodoPreparationHost(home); expect((await recreated.list("demo")).items[0]!.artifacts).toEqual(state.items[0]!.artifacts);
  });
  it("검토 대화의 일반 보내기로 승인을 우회하지 않고 읽기 전용으로 답한다", async () => {
    const { home } = await setup(1);
    const host = createTodoPreparationHost(home, { bin: "mock", runner: runner(), fingerprint: async () => "same" });
    await host.start("demo", ["t0"], "lead"); await host.wait("demo");
    const v = (await host.list("demo")).items[0]!; const executions: string[] = [];
    const sent = await sendRoomTurn(home, { alias: "demo", roomId: v.roomId, text: "그대로 진행해", round: "talk" }, { bin: "mock", runner: async req => { executions.push(req.execution!); return { ok: true, ms: 1, text: "준비 결과에서 승인해주세요." }; } });
    if (!sent.ok) throw new Error(sent.error); await sent.done;
    expect(executions).toEqual(["read"]); expect((await readTodos(home, "demo"))[0]!.done).toBe(false);
  });
  it("뒤 할일 승인과 미래 할일 연계 추천을 거부한다", async () => {
    const { home } = await setup();
    const host = createTodoPreparationHost(home, { bin: "mock", runner: runner(), fingerprint: async () => "same" });
    await host.start("demo", ["t0", "t1"], "lead"); await host.wait("demo");
    await expect(host.action("demo", (await host.list("demo")).items[1]!.id, "approve")).rejects.toThrow("먼저 위");
    const bad = createTodoPreparationHost(home, { bin: "mock", runner: runner([{ todoId: "t1", kind: "reference", reason: "미래 결과" }]), fingerprint: async () => "same" });
    await bad.start("demo", ["t0"], "lead"); await bad.wait("demo");
    expect((await bad.list("demo")).items.find(v => v.todoId === "t0")!.status).toBe("failed");
  });
  it("서버가 관찰한 기준 입력이 바뀌면 승인을 거부하고, 수정 요청은 이전 산출물을 보존한다", async () => {
    const { home } = await setup(1); let baseline = "v1";
    const host = createTodoPreparationHost(home, { bin:"mock", runner: runner(), fingerprint: async () => baseline });
    await host.start("demo",["t0"],"lead"); await host.wait("demo"); const v = (await host.list("demo")).items[0]!;
    baseline = "v2"; await expect(host.action("demo",v.id,"approve")).rejects.toThrow("변경");
    expect((await host.list("demo")).items[0]!.status).toBe("stale");
    await host.action("demo",v.id,"revise","본문을 보완"); await host.wait("demo");
    const versions = (await host.list("demo")).versions; expect(versions).toHaveLength(2); expect(versions[0]!.artifacts).toEqual(v.artifacts); expect(versions[1]!.revisionNote).toBe("본문을 보완");
    await expect(host.action("demo",v.id,"approve")).rejects.toThrow("최신");
  });
  it("필수 선행 결과는 대기시키고, 앞 준비본을 바꾸면 뒤 결과를 재검토로 표시한다", async () => {
    const { home } = await setup(); let n = 0;
    const host = createTodoPreparationHost(home, { bin:"mock", fingerprint: async () => "same", runner: async req => {
      if(req.prompt.includes("모드를 하나 선택")) return {ok:true,ms:1,text:JSON.stringify({modeId:"report",reason:"보고서"})};
      return {ok:true,ms:1,text:JSON.stringify(draft(n++ ? [{todoId:"t0",kind:"required",reason:"앞 결과가 필요"}] : []))};
    } });
    await host.start("demo",["t0","t1"],"lead"); await host.wait("demo"); let state=await host.list("demo"); expect(state.items[1]!.status).toBe("waiting");
    await expect(host.action("demo",state.items[1]!.id,"approve")).rejects.toThrow("다시 준비");
    await updateTodos(home,"demo",rows=>rows.map(t=>t.id==="t0"?{...t,detail:"요구 변경"}:t));
    state=await host.list("demo"); expect(state.items.every(v=>v.status==="stale")).toBe(true);
  });
  it("승인한 버전과 완료 조건을 실행에 전달하고 검증 통과 시에만 완료·보관한다",async()=>{
    const {home}=await setup(1);let executionPrompt="";
    const mock=runner(); const host=createTodoPreparationHost(home,{bin:"mock",fingerprint:async()=>"same",runner:async req=>{if(req.execution==="edit")executionPrompt=req.prompt;return mock(req)}});
    await host.start("demo",["t0"],"lead");await host.wait("demo");const v=(await host.list("demo")).items[0]!;
    await host.action("demo",v.id,"approve");await host.wait("demo");
    expect(executionPrompt).toContain("# 실제 산출물");expect(executionPrompt).toContain("필수 내용 포함");
    expect((await readTodos(home,"demo"))[0]!.done).toBe(true);expect((await readTodoHistory(home,"demo"))[0]!.id).toBe("t0");expect((await host.list("demo")).items[0]!.status).toBe("done");
  });
  it("검증 근거가 없으면 완료시키지 않는다",async()=>{
    const {home}=await setup(1);const mock=runner();const host=createTodoPreparationHost(home,{bin:"mock",fingerprint:async()=>"same",runner:async req=>req.execution==="edit"?{ok:true,ms:1,text:JSON.stringify({outcome:"passed",summary:"했다",checks:[]})}:mock(req)});
    await host.start("demo",["t0"],"lead");await host.wait("demo");await host.action("demo",(await host.list("demo")).items[0]!.id,"approve");await host.wait("demo");expect((await readTodos(home,"demo"))[0]!.done).toBe(false);expect((await host.list("demo")).items[0]!.status).toBe("failed");
  });
  it("준비 중 일반 대화는 읽기만 허용하고 중복 묶음을 막으며 중지 시 남은 항목을 중단한다",async()=>{
    const {home}=await setup();let unblock!:()=>void;const gate=new Promise<void>(resolve=>{unblock=resolve});let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve});
    const host=createTodoPreparationHost(home,{bin:"mock",fingerprint:async()=>"same",runner:async()=>{began();await gate;return {ok:true,ms:1,text:"{}"}}});
    await host.start("demo",["t0","t1"],"lead");await started;
    await expect(host.start("demo",["t1"],"lead")).rejects.toThrow("다른 작업");
    const row=(await readTodos(home,"demo"))[1]!;
    const sent=await sendRoomTurn(home,{alias:"demo",roomId:row.roomId!,text:"실행",round:"talk"},{bin:"mock",runner:async req=>{expect(req.execution).toBe("read");return {ok:true,ms:1,text:"검토만 수행"}}});if(!sent.ok)throw new Error(sent.error);await sent.done;
    await host.action("demo","","stop");unblock();await host.wait("demo");expect((await host.list("demo")).items.every(v=>v.status==="stopped")).toBe(true);
  });
  it("재시작 시 진행 중이던 반영을 재실행하지 않고 확인 필요로 복원한다",async()=>{
    const {home}=await setup(1);const host=createTodoPreparationHost(home,{bin:"mock",runner:runner(),fingerprint:async()=>"same"});await host.start("demo",["t0"],"lead");await host.wait("demo");
    await updateTodoPreparations(home,"demo",rows=>rows.map(v=>({...v,status:"applying"})));
    const restarted=createTodoPreparationHost(home);expect((await restarted.list("demo")).items[0]!.status).toBe("failed");expect((await readTodos(home,"demo"))[0]!.done).toBe(false);
  });
  it("일반 폴더에서도 내용 변경을 감지하고 파생 산출물은 제외한다",async()=>{
    const {cwd}=await setup(0);await fs.writeFile(path.join(cwd,"source.txt"),"one");const a=await preparationFingerprint(cwd);await fs.mkdir(path.join(cwd,"node_modules"));await fs.writeFile(path.join(cwd,"node_modules","x"),"ignore");expect(await preparationFingerprint(cwd)).toBe(a);await fs.writeFile(path.join(cwd,"source.txt"),"two");expect(await preparationFingerprint(cwd)).not.toBe(a);
  });
  it("준비 API는 조회 권한에 쓰기를 허용하지 않고 입력과 프로젝트를 검사한다",async()=>{
    const {home}=await setup(1);const app=createFlowApp({studioHome:home,access:{token:"write",readToken:"read"}});
    try{
      expect((await app.request("/api/todo-preparations?alias=demo",{headers:{authorization:"Bearer read"}})).status).toBe(200);
      expect((await app.request("/api/todo-preparations/start",{method:"POST",headers:{authorization:"Bearer read","content-type":"application/json"},body:JSON.stringify({alias:"demo",ids:["t0"],memberId:"lead"})})).status).toBe(403);
      expect((await app.request("/api/todo-preparations/start",{method:"POST",headers:{authorization:"Bearer write","content-type":"application/json"},body:JSON.stringify({alias:"demo",ids:[],memberId:"lead"})})).status).toBe(400);
      expect((await app.request("/api/todo-preparations?alias=unknown",{headers:{authorization:"Bearer read"}})).status).toBe(404);
    }finally{await app.close()}
  });
});
