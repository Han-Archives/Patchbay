import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectRunsDir } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { setupProjectWithAdoptedIr, setupScannedProject } from "../testFixtures.js";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

const RUNS_FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "core", "src", "runs", "__fixtures__",
);

interface RunsPayload {
  alias: string;
  design?: null;
  note?: string;
  irVersion?: number;
  collected: number;
  byStatus?: Record<string, number>;
  findings?: Array<{ kind: string; detail: string }>;
  budget?: { limit: unknown; breaches: unknown[] };
  drafts?: { draftEvals: Array<{ id: string }>; requirementLinksToFill: Array<{ requirement: null }> };
}

function seedRuns(studioHome: string, alias: string, names: readonly string[]): void {
  const dir = projectRunsDir(studioHome, alias);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const raw = JSON.parse(fs.readFileSync(path.join(RUNS_FIXTURES, `${name}.json`), "utf8"));
    fs.writeFileSync(path.join(dir, `${raw.runId}.json`), JSON.stringify(raw, null, 2), "utf8");
  }
}

describe("get_runs (in-process MCP)", () => {
  it("counts the three statuses apart and reports nothing off the design", async () => {
    const { studioHome, alias } = await setupProjectWithAdoptedIr();
    seedRuns(studioHome, alias, ["success", "refused", "timeout"]);
    const mcp = await connectInProcess(studioHome);
    try {
      const payload = resultJson(await callTool(mcp.client, "get_runs", { alias })) as RunsPayload;
      expect(payload.irVersion).toBe(1);
      expect(payload.collected).toBe(3);
      expect(payload.byStatus).toEqual({ success: 1, refused: 1, timeout: 1, error: 0 });
      expect(payload.findings?.filter((f) => f.kind !== "node-never-ran")).toEqual([]);
    } finally {
      await mcp.close();
    }
  });

  it("returns the drafts on request, with the requirement column left blank", async () => {
    const { studioHome, alias } = await setupProjectWithAdoptedIr("drafts");
    seedRuns(studioHome, alias, ["success", "refused", "timeout"]);
    const mcp = await connectInProcess(studioHome);
    try {
      const payload = resultJson(await callTool(mcp.client, "get_runs", { alias, drafts: true })) as RunsPayload;
      expect(payload.drafts?.draftEvals.map((draft) => draft.id)).toEqual(["E7", "E8"]);
      for (const row of payload.drafts?.requirementLinksToFill ?? []) expect(row.requirement).toBeNull();
      // 초안일 뿐이다 -- 승인된 설계에도, 초안 파일에도 쓰지 않는다.
      expect(fs.existsSync(path.join(studioHome, "projects", alias, "ir.proposed.yaml"))).toBe(true);
      const draft = fs.readFileSync(path.join(studioHome, "projects", alias, "ir.proposed.yaml"), "utf8");
      expect(draft).not.toContain("E7");
    } finally {
      await mcp.close();
    }
  });

  it("says a project has no design instead of pretending the runs matched one", async () => {
    const { studioHome, alias } = await setupScannedProject({ alias: "nodesign" });
    const mcp = await connectInProcess(studioHome);
    try {
      const payload = resultJson(await callTool(mcp.client, "get_runs", { alias })) as RunsPayload;
      expect(payload.design).toBeNull();
      expect(payload.note).toContain("ir adopt");
      expect(payload.collected).toBe(0);
    } finally {
      await mcp.close();
    }
  });
});
