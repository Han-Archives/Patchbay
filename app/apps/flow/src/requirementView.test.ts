import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyConsultPatch, appendRoomMessage, registerProject, type RequirementWorkspace } from "@patchbay/core";
import { createFlowApp, type FlowApp } from "./server.js";
import { adoptIrView } from "./irView.js";
let home: string, app: FlowApp;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-requirement-api-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: home });
  await applyConsultPatch(home, "demo", { patch: {
    goal: "요청을 안전하게 처리한다",
    nodes: [{ id: "step", label: "요청", reads: [], writes: [], models: [], tools: [], documents: [] }],
    evals: [{ id: "T1", node: "step", kind: "deterministic", input: "요청 1건", expect: "응답 1건" }],
    requirements: [{ id: "R1", pattern: "event", text: "요청하면 응답한다", exceptions: [], acceptance: "응답 1건", openQuestions: [] }],
    requirementLinks: [{ requirement: "R1", node: "step", eval: "T1" }],
  } });
  app = createFlowApp({ studioHome: home });
});
afterEach(async () => { await app.close(); });
const post = (url: string, body: unknown) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const read = async () => (await (await app.request("/api/requirements?alias=demo")).json()) as RequirementWorkspace;
describe("요구사항 HTTP", () => {
  it("조회 전용 연결은 읽을 수 있지만 편집·검토 쓰기는 거절한다", async () => {
    await app.close();
    app = createFlowApp({ studioHome: home, access: { token: "write", readToken: "read" } });
    expect((await app.request("/api/requirements?alias=demo", { headers: { authorization: "Bearer read" } })).status).toBe(200);
    expect((await app.request("/api/requirements/review", { method: "POST", headers: { authorization: "Bearer read", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await app.request("/api/requirements/edit", { method: "POST", headers: { authorization: "Bearer read", "content-type": "application/json" }, body: "{}" })).status).toBe(403);
  });
  it("누락·잘못된 프로젝트와 잘못된 요청을 거절한다", async () => {
    expect((await app.request("/api/requirements")).status).toBe(400);
    expect((await app.request("/api/requirements?alias=missing")).status).toBe(404);
    expect((await post("/api/requirements/review", { alias: "demo", action: "approved", items: [] })).status).toBe(400);
    expect((await post("/api/requirements/edit", { alias: "demo" })).status).toBe(400);
  });
  it("실제 검토 기록을 저장하고 새 조회에서 복원한다", async () => {
    const v = await read(), r = v.rows[0]!;
    expect((await post("/api/requirements/review", { alias: "demo", action: "approved", items: [{ id: r.id, digest: r.digest }] })).status).toBe(200);
    expect((await read()).rows[0]?.decision).toBe("approved");
    expect((await post("/api/requirements/review", { alias: "demo", action: "held", items: [{ id: r.id, digest: "old" }] })).status).toBe(409);
  });
  it("변경 요청을 초안에 반영하면 Review 차이와 의견 이력을 남긴 뒤 확정한다", async () => {
    const before = await read(), row = before.rows[0]!;
    const response = await post("/api/requirements/edit", { alias: "demo", id: row.id, documentDigest: before.documentDigest,
      values: { ...row.after?.requirement, text: "요청하면 검토한 응답을 한다", changeReason: "검토 의견을 반영" } });
    expect(response.status).toBe(200);
    const changed = await read(), next = changed.rows[0]!;
    expect(next.change).not.toBe("same"); expect(next.changedFields).toContain("text");
    expect(next.events.at(-1)).toMatchObject({ action: "edited", note: "검토 의견을 반영" });
    expect((await post("/api/requirements/review", { alias: "demo", action: "approved", items: [{ id: next.id, digest: next.digest }], note: "차이 확인" })).status).toBe(200);
    expect((await read()).rows[0]).toMatchObject({ decision: "approved", events: expect.arrayContaining([expect.objectContaining({ note: "차이 확인" })]) });
  });
  it("미결 답변 편집은 초안만 바꾸고 ID 중복과 오래된 화면의 저장을 거절한다", async () => {
    const v = await read(), r = v.rows[0]!;
    expect((await post("/api/requirements/edit", { alias: "demo", id: r.id, documentDigest: v.documentDigest, create: true, values: r.after?.requirement })).status).toBe(409);
    const edit = await post("/api/requirements/edit", { alias: "demo", id: r.id, documentDigest: v.documentDigest, values: { ...r.after?.requirement, openQuestions: ["무응답이면?"] } });
    expect(edit.status).toBe(200);
    const next = await read();
    expect(next.rows[0]?.blockers).toContain("미결 질문에 답해주세요.");
    expect((await post("/api/requirements/edit", { alias: "demo", id: r.id, documentDigest: v.documentDigest, values: r.after?.requirement })).status).toBe(409);
  });
  it("프로젝트 대화 원문을 연결하고 존재하지 않는 발언을 추정하지 않는다", async () => {
    await appendRoomMessage(home, "demo", "r1", { role: "user", text: "12시간 안에 답이 없으면 취소해주세요." });
    let v = await read();
    await post("/api/requirements/edit", { alias: "demo", id: "R1", documentDigest: v.documentDigest, values: { ...v.rows[0]!.after!.requirement, changeReason: "응답 대기 단축", sourceRef: { kind: "room", id: "r1", turn: 0 } } });
    let evidence = await (await app.request("/api/requirements/evidence?alias=demo&id=R1")).json() as { messages: { text: string }[]; note: string };
    expect(evidence.messages[0]?.text).toContain("12시간");
    v = await read();
    await post("/api/requirements/edit", { alias: "demo", id: "R1", documentDigest: v.documentDigest, values: { ...v.rows[0]!.after!.requirement, sourceRef: { kind: "room", id: "r1", turn: 100 } } });
    evidence = await (await app.request("/api/requirements/evidence?alias=demo&id=R1")).json() as typeof evidence;
    expect(evidence.messages).toHaveLength(0);
    expect(evidence.note).toContain("찾지 못했습니다");
  });
  it("보류·미확정 항목이 있는 동안 기존 판 채택으로 우회할 수 없다", async () => {
    const r = (await read()).rows[0]!;
    await post("/api/requirements/review", { alias: "demo", action: "held", items: [{ id: r.id, digest: r.digest }] });
    expect(await adoptIrView(home, { alias: "demo" })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("요구사항 검토") });
  });
});
