import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addLinkRef,
  applyConsultPatch,
  listArchivedConsults,
  listConsults,
  readConsult,
  readConsultRange,
  readProposedIr,
  readProvenance,
  registerProject,
  searchArchivedConsults,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import {
  claudeArgs,
  closeConsultConversation,
  codexArgs,
  defaultHostRunner,
  explainHostFailure,
  parseClaudeOutput,
  readStreamLine,
  parseCodexOutput,
  sendConsultTurn,
  type HostRunner,
  type HostTurnRequest,
} from "./consultHost.js";
import { createFlowApp } from "./server.js";

/**
 * 상담 호스트 — 명세 20261006a §13. CI는 실제 호스트를 부르지 않는다 (§15): 가짜 실행기와 가짜 실행 파일로
 * 성공 · 실패 · 시간 초과 · 세션 이어 가기 · 호스트 전환을 재현한다.
 */

async function setup() {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-consult-"));
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-consult-repo-"));
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
  return { studioHome, projectPath };
}

const baseReq = (over: Partial<HostTurnRequest> = {}): HostTurnRequest => ({
  host: "claude-code",
  bin: "claude",
  model: "sonnet",
  sessionId: "11111111-1111-1111-1111-111111111111",
  resume: false,
  brief: "안내",
  prompt: "메모를 나누고 싶어",
  mcpConfigPath: "/tmp/mcp.json",
  mcpServer: { command: "node", args: ["/x/mcp.js"], env: { PATCHBAY_HOME: "/h" } },
  cwd: "/tmp",
  timeoutMs: 1000,
  ...over,
});

function recorder(reply: (req: HostTurnRequest) => Awaited<ReturnType<HostRunner>>) {
  const calls: HostTurnRequest[] = [];
  const runner: HostRunner = async (req) => {
    calls.push(req);
    return reply(req);
  };
  return { calls, runner };
}

describe("호스트 인자", () => {
  it("Claude — 첫 턴은 --session-id, 다음은 --resume. 읽기 도구와 Patchbay 도구만", () => {
    const first = claudeArgs(baseReq());
    expect(first.slice(0, 2)).toEqual(["-p", "메모를 나누고 싶어"]);
    expect(first).toContain("--session-id");
    expect(first).not.toContain("--resume");
    expect(first).toContain("--strict-mcp-config");
    const tools = first[first.indexOf("--allowedTools") + 1]!;
    expect(tools).toContain("mcp__patchbay__consult_update");
    expect(tools).toContain("mcp__patchbay__consult_history");
    expect(tools).not.toMatch(/Edit|Write|Bash/);
    const next = claudeArgs(baseReq({ resume: true }));
    expect(next).toContain("--resume");
    expect(next).not.toContain("--session-id");
  });

  it("Codex — 읽기 전용 샌드박스, MCP는 -c 로, 안내는 말머리에, 다음 턴은 exec resume <id>", () => {
    const first = codexArgs(baseReq({ host: "codex", sessionId: undefined }));
    expect(first.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(first).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(first).toContain('mcp_servers.patchbay.command="node"');
    expect(first.at(-1)).toContain("[상담 안내]");
    const next = codexArgs(baseReq({ host: "codex", sessionId: "th_9", resume: true }));
    expect(next.slice(0, 3)).toEqual(["exec", "resume", "th_9"]);
  });
});

describe("호스트 출력 읽기", () => {
  it("Claude JSON", () => {
    expect(parseClaudeOutput('{"result":"좋아요","session_id":"s1","total_cost_usd":0.01,"is_error":false}')).toEqual({
      text: "좋아요",
      sessionId: "s1",
      costUsd: 0.01,
      isError: false,
    });
  });
  it("Codex JSONL — thread_id 와 마지막 agent_message", () => {
    const out = [
      '{"type":"thread.started","thread_id":"th_1"}',
      '{"type":"item.completed","item":{"type":"reasoning","text":"…"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"누가 쓰나요?"}}',
      '{"type":"turn.completed"}',
    ].join("\n");
    expect(parseCodexOutput(out)).toEqual({ text: "누가 쓰나요?", sessionId: "th_1", isError: false });
    expect(parseCodexOutput('{"type":"turn.failed","error":{"message":"로그인 필요"}}')).toMatchObject({ isError: true, error: "로그인 필요" });
  });
});

describe("가짜 실행 파일로 실제 spawn 길", () => {
  it("Claude처럼 JSON을 내는 실행 파일 — 답과 세션을 읽는다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-fakebin-"));
    const bin = path.join(dir, "claude");
    fs.writeFileSync(bin, `#!/bin/sh\necho '{"result":"받았어요","session_id":"s-9","total_cost_usd":0,"is_error":false}'\n`, { mode: 0o755 });
    const result = await defaultHostRunner(baseReq({ bin, cwd: dir }));
    expect(result).toMatchObject({ ok: true, text: "받았어요", sessionId: "s-9" });
  });

  it("한도를 넘기면 끝내고 시간 초과로 말한다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-fakebin-"));
    const bin = path.join(dir, "claude");
    fs.writeFileSync(bin, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
    const result = await defaultHostRunner(baseReq({ bin, cwd: dir, timeoutMs: 300 }));
    expect(result).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("0이 아닌 종료는 오류 — stderr를 그대로 보인다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-fakebin-"));
    const bin = path.join(dir, "claude");
    fs.writeFileSync(bin, "#!/bin/sh\necho 'Not logged in' 1>&2\nexit 1\n", { mode: 0o755 });
    const result = await defaultHostRunner(baseReq({ bin, cwd: dir }));
    expect(result).toMatchObject({ ok: false, kind: "error" });
    if (!result.ok) expect(result.text).toContain("Not logged in");
  });
});

describe("sendConsultTurn — 한 턴의 길 (§13.5)", () => {
  it("첫 턴: meta · user · host 가 붙고, 둘째 턴은 같은 세션을 이어 간다", async () => {
    const { studioHome, projectPath } = await setup();
    const { calls, runner } = recorder(() => ({ ok: true, text: "누가 쓰나요?", ms: 12, costUsd: 0.02 }));
    const first = await sendConsultTurn(studioHome, { alias: "demo", text: "메모를 나누고 싶어", host: "claude-code", model: "sonnet" }, { runner, bin: "claude" });
    if (!first.ok) throw new Error(first.error);
    await first.done;
    const second = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "나 혼자", host: "claude-code", model: "sonnet" }, { runner, bin: "claude" });
    if (!second.ok) throw new Error(second.error);
    await second.done;

    expect(calls).toHaveLength(2);
    expect(calls[0]!.resume).toBe(false);
    expect(calls[1]!.resume).toBe(true);
    expect(calls[1]!.sessionId).toBe(calls[0]!.sessionId);
    expect(calls[0]!.cwd).toBe(projectPath);
    expect(calls[0]!.brief).toContain("지금 주제: 목표와 요구사항");
    expect(calls[0]!.prompt).toContain("[이 말의 상담 기록 번호(turn): 1]");
    const read = (await readConsult(studioHome, "demo", first.consultId))!;
    expect(read.messages.map((m) => m.role)).toEqual(["meta", "user", "host", "user", "host"]);
    expect(read.messages[2]).toMatchObject({ role: "host", text: "누가 쓰나요?", costUsd: 0.02 });
  });

  it("안내는 매 턴 지금 초안으로 다시 만든다 — 주제가 차면 다음 주제로", async () => {
    const { studioHome } = await setup();
    const { calls, runner } = recorder(() => ({ ok: true, text: "네", ms: 1 }));
    const first = await sendConsultTurn(studioHome, { alias: "demo", text: "시작", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!first.ok) throw new Error(first.error);
    await first.done;
    await applyConsultPatch(studioHome, "demo", {
      patch: {
        goal: "g", concepts: [{ id: "memo", label: "메모", kind: "input" }], why: { alternative: "손", modelNeed: "이유", verdict: "v" },
        alternatives: [], metrics: [{ id: "M1", what: "시간", target: "5분" }], nonGoals: [], assumptions: [], references: [],
      },
    });
    const second = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "다음", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!second.ok) throw new Error(second.error);
    await second.done;
    expect(calls[1]!.brief).toContain("지금 주제: 사용 시나리오");
  });

  it("실패와 시간 초과는 system 줄 — 상담은 그대로, 다시 보내면 된다", async () => {
    const { studioHome } = await setup();
    const { runner } = recorder(() => ({ ok: false, kind: "timeout", text: "300초 안에 답이 없어 멈췄다.", ms: 300000 }));
    const turn = await sendConsultTurn(studioHome, { alias: "demo", text: "안녕", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!turn.ok) throw new Error(turn.error);
    await turn.done;
    const read = (await readConsult(studioHome, "demo", turn.consultId))!;
    expect(read.messages.at(-1)).toMatchObject({ role: "system", kind: "timeout" });
  });

  it("도는 중에 또 보내면 409", async () => {
    const { studioHome } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runner: HostRunner = async () => {
      await gate;
      return { ok: true, text: "네", ms: 1 };
    };
    const first = await sendConsultTurn(studioHome, { alias: "demo", text: "하나", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!first.ok) throw new Error(first.error);
    const app = createFlowApp({ studioHome });
    expect((await (await app.request("/api/running")).json()).aliases).toEqual(["demo"]);
    const again = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "둘", host: "claude-code", model: "" }, { runner, bin: "claude" });
    expect(again).toMatchObject({ ok: false, status: 409 });
    release();
    await first.done;
    expect((await (await app.request("/api/running")).json()).aliases).toEqual([]);
  });

  it("호스트를 바꾸면 새 세션 + 지난 대화를 넘기고, Codex 세션 id는 첫 턴 뒤에 붙는다", async () => {
    const { studioHome } = await setup();
    const { calls, runner } = recorder((req) =>
      req.host === "codex" ? { ok: true, text: "이어서 볼게요", ms: 1, sessionId: "th_7" } : { ok: true, text: "누가 쓰나요?", ms: 1 },
    );
    const first = await sendConsultTurn(studioHome, { alias: "demo", text: "메모 분류", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!first.ok) throw new Error(first.error);
    await first.done;
    const second = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "나 혼자 써", host: "codex", model: "" }, { runner, bin: "codex" });
    if (!second.ok) throw new Error(second.error);
    await second.done;
    expect(calls[1]!.resume).toBe(false);
    expect(calls[1]!.prompt).toContain("사람: 메모 분류");
    expect(calls[1]!.prompt).toContain("상담자: 누가 쓰나요?");
    const third = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "아침에", host: "codex", model: "" }, { runner, bin: "codex" });
    if (!third.ok) throw new Error(third.error);
    await third.done;
    expect(calls[2]).toMatchObject({ resume: true, sessionId: "th_7" });
    const roles = (await readConsult(studioHome, "demo", first.consultId))!.messages.map((m) => (m.role === "system" ? `system:${m.kind}` : m.role));
    expect(roles).toEqual(["meta", "user", "host", "system:host-switch", "meta", "user", "meta", "host", "user", "host"]);
  });

  it("실행 파일이 없으면 보내기 전에 막는다", async () => {
    const { studioHome } = await setup();
    const result = await sendConsultTurn(studioHome, { alias: "demo", text: "안녕", host: "codex", model: "" }, { bin: null });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });
});

describe("상담 · PRD 라우트", () => {
  it("보내면 202, 끝나면 읽히고, PRD 절을 표시할 수 있다", async () => {
    const { studioHome } = await setup();
    const runner: HostRunner = async () => {
      await applyConsultPatch(studioHome, "demo", { patch: { goal: "메모 갈래" }, provenance: [{ path: "goal", source: "said" }], turn: 1 });
      return { ok: true, text: "누가 쓰나요?", ms: 1 };
    };
    const app = createFlowApp({ studioHome, consultRunner: runner, consultBin: "claude" });
    try {
      const sent = await app.request("/api/consult/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: "demo", text: "메모를 나누고 싶어", host: "claude-code", model: "" }),
      });
      expect(sent.status).toBe(202);
      const { consultId } = (await sent.json()) as { consultId: string };
      let body: { status: string; running: boolean } = { status: "", running: true };
      for (let i = 0; i < 50 && body.status !== "idle"; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
        body = (await (await app.request(`/api/consult?alias=demo&id=${consultId}`)).json()) as typeof body;
      }
      expect(body).toMatchObject({ status: "idle", running: false });

      const prd = (await (await app.request("/api/prd?alias=demo")).json()) as { status: string; sections: Array<{ lines: Array<{ text: string; source: string }> }> };
      expect(prd.status).toBe("ready");
      expect(prd.sections[0]!.lines[0]).toMatchObject({ text: "메모 갈래", source: "said" });

      const fix = await app.request("/api/prd/mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: "demo", n: 1, state: "fix" }),
      });
      expect(fix.status).toBe(400);
      const ok = await app.request("/api/prd/mark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: "demo", n: 1, state: "ok" }),
      });
      const marked = (await ok.json()) as { review: { sections: Array<{ n: number; state: string }> } };
      expect(marked.review.sections[0]).toMatchObject({ n: 1, state: "ok" });
    } finally {
      await app.close();
    }
  });
});

describe("진행 신호와 멈춘 이유 (사용자 요청 2026-10-07)", () => {
  it("stream-json 줄에서 지금 하는 일을 읽는다 — Claude · Codex", () => {
    expect(readStreamLine('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__patchbay__consult_update"}]}}')).toEqual({ activity: "초안에 쓰는 중" });
    expect(readStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"좋아요"}]}}')).toEqual({ activity: "답을 쓰는 중", text: "좋아요" });
    expect(readStreamLine('{"type":"item.started","item":{"type":"reasoning"}}')).toEqual({ activity: "생각하는 중" });
  });

  it("실패를 사람이 알아듣는 말로 — 한도 · 토큰 · 모델 이름", () => {
    expect(explainHostFailure("Claude AI usage limit reached", "opus")).toContain("사용량 한도");
    expect(explainHostFailure("You've hit your session limit · resets 12:10am (Asia/Seoul)", "opus")).toContain("12:10am");
    expect(explainHostFailure("prompt is too long: 210000 tokens", "opus")).toContain("토큰");
    expect(explainHostFailure("There's an issue with the selected model (opus 5.5). It may not exist", "opus 5.5")).toContain("「opus 5.5」");
  });

  it("Claude 인자 — stream-json · 첨부 폴더 · 링크 보기", () => {
    const args = claudeArgs(baseReq({ addDirs: ["/h/refs"] }));
    expect(args).toEqual(expect.arrayContaining(["stream-json", "--verbose", "--add-dir", "/h/refs"]));
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("WebFetch");
  });

  it("시간 초과 — 마지막으로 하던 일과 그때까지 쓴 답을 말한다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-fakebin-"));
    const bin = path.join(dir, "claude");
    fs.writeFileSync(
      bin,
      `#!/bin/sh
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"목표는 적었어요"}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__patchbay__consult_update"}]}}'
sleep 5
`,
      { mode: 0o755 },
    );
    const seen: string[] = [];
    const result = await defaultHostRunner(baseReq({ bin, cwd: dir, timeoutMs: 600, onActivity: (a) => seen.push(a) }));
    expect(seen).toEqual(["답을 쓰는 중", "초안에 쓰는 중"]);
    expect(result).toMatchObject({ ok: false, kind: "timeout", partial: "목표는 적었어요" });
    if (!result.ok) {
      expect(result.text).toContain("마지막으로 하던 일: 초안에 쓰는 중");
      expect(result.text).toContain("이어서");
    }
  });
});

describe("「+」 첨부와 이어서", () => {
  it("붙인 자료는 초안의 참고 자료에 바로 들어가고, 호스트에게 경로 · 링크로 넘어간다", async () => {
    const { studioHome } = await setup();
    const link = await addLinkRef(studioHome, "demo", { url: "https://www.youtube.com/watch?v=abc", title: "학습 팁 영상" });
    if (!link.ok) throw new Error(link.error);
    const { calls, runner } = recorder(() => ({ ok: true, text: "봤어요", ms: 1 }));
    const turn = await sendConsultTurn(studioHome, { alias: "demo", text: "이 영상 참고해", host: "claude-code", model: "", attachments: [link.ref.id] }, { runner, bin: "claude" });
    if (!turn.ok) throw new Error(turn.error);
    await turn.done;
    expect(calls[0]!.prompt).toContain("https://www.youtube.com/watch?v=abc");
    expect(calls[0]!.addDirs?.[0]).toContain("refs");
    const draft = await readProposedIr(studioHome, "demo");
    expect(draft.ok && (draft.raw as { references: { uri: string }[] }).references[0]!.uri).toBe("https://www.youtube.com/watch?v=abc");
    const read = (await readConsult(studioHome, "demo", turn.consultId))!;
    expect(read.messages.find((m) => m.role === "user")).toMatchObject({ attachments: [{ id: link.ref.id, kind: "link" }] });
  });

  it("시간 초과 뒤 「이어서」는 같은 세션을 이어 간다 — 같은 id로 새로 열지 않는다", async () => {
    const { studioHome } = await setup();
    let n = 0;
    const { calls, runner } = recorder(() => (++n === 1 ? { ok: false, kind: "timeout", text: "멈춤", ms: 1, partial: "반쯤" } : { ok: true, text: "이어서 했어요", ms: 1 }));
    const first = await sendConsultTurn(studioHome, { alias: "demo", text: "길게 해 줘", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!first.ok) throw new Error(first.error);
    await first.done;
    const again = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "이어서 해 줘", host: "claude-code", model: "" }, { runner, bin: "claude" });
    if (!again.ok) throw new Error(again.error);
    await again.done;
    expect(calls[1]!.resume).toBe(true);
    const roles = (await readConsult(studioHome, "demo", first.consultId))!.messages.map((m) => (m.role === "system" ? `system:${m.kind}` : m.role));
    expect(roles).toEqual(["meta", "user", "host", "system:timeout", "user", "host"]);
  });
});

describe("대화 끝내기 — 보관하고 필요할 때만 찾는다 (사용자 요청 2026-10-08)", () => {
  async function twoTurns(studioHome: string, runner: HostRunner) {
    const first = await sendConsultTurn(studioHome, { alias: "demo", text: "메모를 버그와 요청으로 나누고 싶어", host: "claude-code", model: "sonnet" }, { runner, bin: "claude" });
    if (!first.ok) throw new Error(first.error);
    await first.done;
    // 호스트가 MCP로 초안을 쓴 것처럼 — 콘솔이 넘긴 상담 id가 출처에 남는다.
    await applyConsultPatch(studioHome, "demo", { patch: { goal: "메모를 나눈다" }, provenance: [{ path: "goal", source: "said" }], turn: 1, consult: first.consultId });
    const second = await sendConsultTurn(studioHome, { alias: "demo", consultId: first.consultId, text: "아침마다 30분 걸려", host: "claude-code", model: "sonnet" }, { runner, bin: "claude" });
    if (!second.ok) throw new Error(second.error);
    await second.done;
    return first.consultId;
  }

  it("끝내면 보관으로 옮기고 색인에 고친 칸을 남긴다 — 진행 목록에서 빠지고, 읽기는 된다", async () => {
    const { studioHome } = await setup();
    const { runner } = recorder(() => ({ ok: true, text: "누가 쓰나요?", ms: 5 }));
    const id = await twoTurns(studioHome, runner);
    expect((await readProvenance(studioHome, "demo")).entries.find((e) => e.path === "goal")).toMatchObject({ consult: id, turn: 1 });

    const closed = await closeConsultConversation(studioHome, "demo", id, new Date("2026-10-08T05:00:00Z"));
    if (!closed.ok) throw new Error(closed.error);
    expect(closed.entry).toMatchObject({ id, turns: 2, touched: ["goal"], closedAt: "2026-10-08T05:00:00.000Z" });
    expect(await listConsults(studioHome, "demo")).toEqual([]);
    expect((await listArchivedConsults(studioHome, "demo")).map((a) => a.id)).toEqual([id]);
    const read = (await readConsult(studioHome, "demo", id))!;
    expect(read.archived).toBe(true);
    expect(read.messages.at(-1)).toMatchObject({ role: "system", kind: "closed" });
    // 두 번 끝내지 않는다.
    expect(await closeConsultConversation(studioHome, "demo", id)).toMatchObject({ ok: false, status: 409 });
  });

  it("끝낸 대화로는 보내지 않는다 — 새 상담은 새 세션, 지난 말 대신 색인과 찾는 길만 안내에", async () => {
    const { studioHome } = await setup();
    const { calls, runner } = recorder(() => ({ ok: true, text: "네", ms: 5 }));
    const id = await twoTurns(studioHome, runner);
    await closeConsultConversation(studioHome, "demo", id);

    const refused = await sendConsultTurn(studioHome, { alias: "demo", consultId: id, text: "하나 더", host: "claude-code", model: "sonnet" }, { runner, bin: "claude" });
    expect(refused).toMatchObject({ ok: false, status: 409 });

    const fresh = await sendConsultTurn(studioHome, { alias: "demo", text: "이어서 시험을 정하자", host: "claude-code", model: "sonnet" }, { runner, bin: "claude" });
    if (!fresh.ok) throw new Error(fresh.error);
    await fresh.done;
    const last = calls.at(-1)!;
    expect(fresh.consultId).not.toBe(id);
    expect(last.resume).toBe(false);
    expect(last.sessionId).not.toBe(calls[0]!.sessionId);
    expect(last.prompt).not.toContain("메모를 버그와 요청으로");
    expect(last.brief).toContain("지난 대화는 기억하지 않는다");
    expect(last.brief).toContain(`${id} 「메모를 버그와 요청으로 나누고 싶어」 · 턴 2`);
    expect(last.brief).toContain("고친 칸: goal");
    expect(last.mcpServer.env.PATCHBAY_CONSULT_ID).toBe(fresh.consultId);
  });

  it("찾기는 조각만, 읽기는 구간만 — 맥락을 통째로 싣지 않는다", async () => {
    const { studioHome } = await setup();
    const { runner } = recorder(() => ({ ok: true, text: `${"긴 답 ".repeat(500)}끝`, ms: 5 }));
    const id = await twoTurns(studioHome, runner);
    await closeConsultConversation(studioHome, "demo", id);

    const hits = await searchArchivedConsults(studioHome, "demo", "30분");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id, role: "user", snippet: "아침마다 30분 걸려" });

    const range = (await readConsultRange(studioHome, "demo", id, { fromSeq: 2, limit: 1 }))!;
    expect(range.total).toBe(4);
    expect(range.messages).toHaveLength(1);
    expect(range.messages[0]!.text.length).toBeLessThan(1600);
    expect(range.messages[0]!.text).toContain("자 더)");
  });

  it("라우트 — /api/consult/close 뒤 목록에 보관이 따로 나온다", async () => {
    const { studioHome } = await setup();
    const { runner } = recorder(() => ({ ok: true, text: "네", ms: 5 }));
    const id = await twoTurns(studioHome, runner);
    const app = createFlowApp({ studioHome, consultRunner: runner, consultBin: "claude" });
    const res = await app.request("/api/consult/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", consultId: id }) });
    expect(res.status).toBe(200);
    const list = (await (await app.request("/api/consult/list?alias=demo")).json()) as { consults: unknown[]; archived: { id: string }[] };
    expect(list.consults).toEqual([]);
    expect(list.archived.map((a) => a.id)).toEqual([id]);
    const one = (await (await app.request(`/api/consult?alias=demo&id=${id}`)).json()) as { status: string; archived: boolean };
    expect(one).toMatchObject({ status: "closed", archived: true });
  });
});
