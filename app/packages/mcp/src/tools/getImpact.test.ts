import fs from "node:fs";
import path from "node:path";
import { projectStudioDir } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { setupScannedProject, setupUnscannedProject } from "../testFixtures.js";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

interface ImpactPayload {
  alias: string;
  debt: { orphanCount: number; orphans: string[]; hubs: Array<{ port: string; degree: number }> };
  impact?: {
    origin: string;
    maxHops: number;
    total: number;
    known: boolean;
    hops: Array<{ hop: number; count: number; ports: Array<{ port: string; via: string; kind: string }> }>;
  };
}

/**
 * Overwrites the fixture's empty `overlay.yaml` with wires. There is no
 * Core writer for whole overlays on purpose (overlay is human-owned), so a
 * fixture writes the file the way a person would.
 */
function writeWires(studioHome: string, alias: string, wires: Array<[string, string, string]>): void {
  const yaml = [
    "patches: []",
    "wires:",
    ...wires.flatMap(([from, to, kind]) => [
      `  - project: ${alias}`,
      `    from: ${from}`,
      `    to: ${to}`,
      `    kind: ${kind}`,
      "    install: copy",
    ]),
    "decisions: []",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(projectStudioDir(studioHome, alias), "overlay.yaml"), yaml, "utf8");
}

describe("get_impact (in-process MCP)", () => {
  it("groups the blast radius by hop distance from the given port", async () => {
    const { studioHome, alias } = await setupScannedProject();
    writeWires(studioHome, alias, [
      ["skill:skills/a/SKILL.md", "source:shared.md", "reads"],
      ["skill:skills/b/SKILL.md", "source:shared.md", "reads"],
      ["skill:skills/b/SKILL.md", "source:only-b.md", "produces"],
    ]);

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_impact", { alias, port: "source:shared.md", hops: 2 });
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as ImpactPayload;

      expect(payload.impact?.maxHops).toBe(2);
      expect(payload.impact?.total).toBe(3);
      expect(payload.impact?.hops[0]!.ports.map((hit) => hit.port)).toEqual([
        "skill:skills/a/SKILL.md",
        "skill:skills/b/SKILL.md",
      ]);
      expect(payload.impact?.hops[1]!.ports).toEqual([
        { port: "source:only-b.md", via: "skill:skills/b/SKILL.md", kind: "produces" },
      ]);
    } finally {
      await close();
    }
  });

  it("answers without Neo4j -- the tool never opens a bolt connection", async () => {
    const { studioHome, alias } = await setupScannedProject();
    writeWires(studioHome, alias, [["skill:skills/a/SKILL.md", "source:shared.md", "reads"]]);

    // No sidecar is running in this test process and none is configured;
    // a Neo4j-backed implementation would fail or return nothing here.
    const { client, close } = await connectInProcess(studioHome);
    try {
      const payload = resultJson(
        await callTool(client, "get_impact", { alias, port: "source:shared.md" }),
      ) as ImpactPayload;
      expect(payload.impact?.total).toBe(1);
    } finally {
      await close();
    }
  });

  it("reports port debt even when no port is given", async () => {
    const { studioHome, alias } = await setupScannedProject();
    writeWires(studioHome, alias, [
      ["skill:skills/hub/SKILL.md", "source:one.md", "reads"],
      ["skill:skills/hub/SKILL.md", "source:two.md", "reads"],
      ["skill:skills/hub/SKILL.md", "source:three.md", "reads"],
      ["skill:skills/hub/SKILL.md", "source:four.md", "reads"],
    ]);

    const { client, close } = await connectInProcess(studioHome);
    try {
      const payload = resultJson(await callTool(client, "get_impact", { alias })) as ImpactPayload;
      expect(payload.impact).toBeUndefined();
      expect(payload.debt.hubs).toEqual([{ port: "skill:skills/hub/SKILL.md", degree: 4 }]);
      // README.md is the only discovered port the fixture scans, and no wire names it.
      expect(payload.debt.orphans).toContain("source:README.md");
      expect(payload.debt.orphanCount).toBe(payload.debt.orphans.length);
    } finally {
      await close();
    }
  });

  it("an unknown port is reported as not known rather than as an error", async () => {
    const { studioHome, alias } = await setupScannedProject();

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_impact", { alias, port: "source:nope.md" });
      expect(result.isError).toBeFalsy();
      const payload = resultJson(result) as ImpactPayload;
      expect(payload.impact?.total).toBe(0);
      expect(payload.impact?.known).toBe(false);
    } finally {
      await close();
    }
  });

  it("an unscanned project errors with the same guidance as the other read tools", async () => {
    const { studioHome } = await setupUnscannedProject();

    const { client, close } = await connectInProcess(studioHome);
    try {
      const result = await callTool(client, "get_impact", { alias: "demo" });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("has not been scanned yet");
    } finally {
      await close();
    }
  });
});
