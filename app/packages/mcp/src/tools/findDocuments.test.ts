import { describe, expect, it } from "vitest";
import { setupProjectWithAdoptedIr, setupScannedProject } from "../testFixtures.js";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

interface DocumentsPayload {
  alias: string;
  anchorPath: string | null;
  irVersion: number | null;
  maxHops: number;
  matchedCount: number;
  withheld: number;
  designEdges: number;
  replicaWarning: string | null;
  candidates: string[];
  error: string | null;
  hits: Array<{ documentId: string; path: string; when: string; hops: number; matched: number; via: string }>;
}

describe("find_documents (in-process MCP)", () => {
  it("routes three different inputs to three different documents, each with its evidence path", async () => {
    const { studioHome, alias } = await setupProjectWithAdoptedIr();
    const mcp = await connectInProcess(studioHome);
    try {
      for (const [input, expected] of [
        ["저장 버튼이 두 번 눌린다 — 버그다", "guides/bug.md"],
        ["이런 기능을 요청합니다", "guides/request.md"],
        ["이게 왜 이렇게 되는지 질문이 있습니다", "guides/question.md"],
      ] as const) {
        const payload = resultJson(
          await callTool(mcp.client, "find_documents", { alias, anchor: "pick", input }),
        ) as DocumentsPayload;
        expect(payload.error).toBeNull();
        expect(payload.hits[0]?.path).toBe(expected);
        expect(payload.hits[0]?.matched).toBeGreaterThan(0);
        // 4.5 -- 근거 경로 없는 결과는 블랙박스다.
        for (const hit of payload.hits) expect(hit.via.startsWith("pick")).toBe(true);
      }
    } finally {
      await mcp.close();
    }
  });

  it("carries the design-relation count so a caller can tell a replica-only graph", async () => {
    const adopted = await setupProjectWithAdoptedIr("withir");
    const bare = await setupScannedProject({ alias: "noir" });

    const one = await connectInProcess(adopted.studioHome);
    try {
      const payload = resultJson(
        await callTool(one.client, "find_documents", { alias: "withir", anchor: "pick" }),
      ) as DocumentsPayload;
      expect(payload.designEdges).toBeGreaterThan(0);
      expect(payload.replicaWarning).toBeNull();
      expect(payload.irVersion).toBe(1);
    } finally {
      await one.close();
    }

    const two = await connectInProcess(bare.studioHome);
    try {
      const payload = resultJson(
        await callTool(two.client, "find_documents", { alias: "noir", anchor: "README.md" }),
      ) as DocumentsPayload;
      expect(payload.designEdges).toBe(0);
      expect(payload.replicaWarning).toContain("스캔 복제본뿐이다");
      expect(payload.hits).toEqual([]);
    } finally {
      await two.close();
    }
  });

  it("names the candidates instead of guessing when the anchor is ambiguous", async () => {
    const { studioHome, alias } = await setupProjectWithAdoptedIr();
    const mcp = await connectInProcess(studioHome);
    try {
      const payload = resultJson(
        await callTool(mcp.client, "find_documents", { alias, anchor: "ir:document" }),
      ) as DocumentsPayload;
      expect(payload.error).toContain("좁혀");
      expect(payload.candidates.length).toBeGreaterThan(1);
      expect(payload.hits).toEqual([]);
    } finally {
      await mcp.close();
    }
  });
});
