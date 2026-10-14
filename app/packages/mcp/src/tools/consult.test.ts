import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendConsultMessage, closeConsult, readOverlay, readProposedIr, readProvenance, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

/** 상담 도구 — 호스트가 초안을 쓰는 유일한 길과 PRD 읽기 (명세 20261006a §13.4 · §14.3). */
async function setup() {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-consult-"));
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
  return studioHome;
}

describe("상담 도구 (in-process MCP)", () => {
  it("consult_update 가 초안과 출처만 쓰고, 승인된 설계는 그대로다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "consult_update", {
        alias: "demo",
        patch: { goal: "메모 한 줄을 넣으면 갈래 하나가 나온다", environment: { language: "typescript", location: "local" } },
        provenance: [{ path: "goal", source: "said" }],
        turn: 3,
      });
      expect(result.isError).toBeFalsy();
      const body = resultJson(result) as { written: string[]; next: string };
      expect(body.written).toEqual(["goal", "environment"]);
      expect(body.next).toBe("목표와 요구사항");

      const draft = await readProposedIr(studioHome, "demo");
      expect(draft.ok && (draft.raw as { goal: string }).goal).toBe("메모 한 줄을 넣으면 갈래 하나가 나온다");
      const prov = await readProvenance(studioHome, "demo");
      expect(prov.origin).toBe("consult");
      expect(prov.entries).toContainEqual({ path: "goal", source: "said", turn: 3 });
      expect(prov.entries).toContainEqual({ path: "environment", source: "inferred", turn: 3 });
      expect((await readOverlay(studioHome, "demo")).ir).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("객체 칸은 안쪽 키를 합친다 — 두 번째 턴이 첫 턴의 환경을 지우지 않는다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      await callTool(client, "consult_update", { alias: "demo", patch: { environment: { language: "typescript" } } });
      await callTool(client, "consult_update", { alias: "demo", patch: { environment: { hardware: "GPU 없음" } } });
      const draft = await readProposedIr(studioHome, "demo");
      expect(draft.ok && (draft.raw as { environment: unknown }).environment).toEqual({ language: "typescript", hardware: "GPU 없음" });
    } finally {
      await close();
    }
  });

  it("모르는 칸은 버리지 않고 거절한다 — 비슷한 이름을 붙여서", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "consult_update", {
        alias: "demo",
        patch: { goals: "x", environment: { lang: "typescript" }, version: 7 },
      });
      expect(result.isError).toBe(true);
      const body = resultJson(result) as { unknown: string[] };
      expect(body.unknown).toEqual(["goals (혹시 goal?)", "environment.lang (혹시 environment.language?)", "version (Patchbay가 정하는 키)"]);
      expect((await readProposedIr(studioHome, "demo")).ok).toBe(false);
    } finally {
      await close();
    }
  });

  it("형식이 틀린 값은 거절하고, 표시명은 바꿔 받고, 목록 같은 goal 에는 경고를 돌려준다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const bad = await callTool(client, "consult_update", { alias: "demo", patch: { interface: { entry: ["브라우저 화면"], output: "x" } } });
      expect(bad.isError).toBe(true);
      const ok = resultJson(
        await callTool(client, "consult_update", {
          alias: "demo",
          patch: { goal: "학습 에이전트 — 1. 수집 2. 배포 3. 해설 4. 오답", requirements: [{ id: "R1", pattern: "항상", text: "문제지를 낸다", priority: "꼭" }] },
        }),
      ) as { warnings?: string[] };
      expect(ok.warnings?.[0]).toContain("requirements");
      const draft = await readProposedIr(studioHome, "demo");
      expect(draft.ok && (draft.raw as { requirements: { pattern: string }[] }).requirements[0]!.pattern).toBe("ubiquitous");
    } finally {
      await close();
    }
  });

  it("get_prd 는 11절과 진행을 돌려주고, 초안이 없으면 그렇게 말한다", async () => {
    const studioHome = await setup();
    const { client, close } = await connectInProcess(studioHome);
    try {
      const none = resultJson(await callTool(client, "get_prd", { alias: "demo" })) as { prd: null };
      expect(none.prd).toBeNull();
      await callTool(client, "consult_update", { alias: "demo", patch: { goal: "갈래 나누기" }, provenance: [{ path: "goal", source: "said" }] });
      const body = resultJson(await callTool(client, "get_prd", { alias: "demo" })) as {
        sections: Array<{ n: number; lines: Array<{ text: string; source: string }> }>;
        review: { allOk: boolean };
      };
      expect(body.sections).toHaveLength(11);
      expect(body.sections[0]!.lines[0]).toMatchObject({ text: "갈래 나누기", source: "said" });
      expect(body.review.allOk).toBe(false);
    } finally {
      await close();
    }
  });

  it("consult_history — 색인 · 낱말 찾기 · 구간 읽기. 콘솔이 넘긴 상담 id가 출처에 남는다", async () => {
    const studioHome = await setup();
    const now = new Date("2026-10-08T01:00:00Z");
    await appendConsultMessage(studioHome, "demo", "c1", { role: "meta", host: "claude-code", model: "opus" }, now);
    await appendConsultMessage(studioHome, "demo", "c1", { role: "user", text: "스피킹은 글로 받는다" }, now);
    await appendConsultMessage(studioHome, "demo", "c1", { role: "host", text: "R11로 적었습니다", model: "opus", ms: 5 }, now);
    await closeConsult(studioHome, "demo", "c1", { touched: ["requirements"], now });
    process.env.PATCHBAY_CONSULT_ID = "c2";
    const { client, close } = await connectInProcess(studioHome);
    try {
      const index = resultJson(await callTool(client, "consult_history", { alias: "demo" })) as { archived: { id: string; touched: string[] }[] };
      expect(index.archived).toEqual([expect.objectContaining({ id: "c1", touched: ["requirements"], turns: 1 })]);
      const found = resultJson(await callTool(client, "consult_history", { alias: "demo", query: "스피킹" })) as { hits: { id: string; seq: number }[] };
      expect(found.hits).toEqual([expect.objectContaining({ id: "c1", seq: 1, role: "user" })]);
      const part = resultJson(await callTool(client, "consult_history", { alias: "demo", id: "c1", fromSeq: 2 })) as { messages: { text: string }[] };
      expect(part.messages.map((m) => m.text)).toEqual(["R11로 적었습니다"]);

      await callTool(client, "consult_update", { alias: "demo", patch: { goal: "갈래" }, provenance: [{ path: "goal", source: "said" }], turn: 1 });
      expect((await readProvenance(studioHome, "demo")).entries).toContainEqual({ path: "goal", source: "said", turn: 1, consult: "c2" });
    } finally {
      delete process.env.PATCHBAY_CONSULT_ID;
      await close();
    }
  });
});
