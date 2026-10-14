import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendWire,
  computeFlowGraph,
  ensureStudioInitialized,
  inferredSchema,
  overlaySchema,
  registerProject,
  type Wire,
  writeInferred,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { loadGraph } from "./graph.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-flow-graph-"));
}

const SAMPLE_INFERRED = inferredSchema.parse({
  discoveredPorts: ["skill:map-project", "source:README.md"],
  git: { branch: "main", head: "", recentCommitSubjects: [] },
  agents: [],
});

async function seedProject(studioHome: string, alias: string): Promise<void> {
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias, kind: "local_repo", path: "/tmp/does-not-matter" });
  await writeOverlayIfAbsent(studioHome, alias);
  await writeInferred(studioHome, alias, SAMPLE_INFERRED);
}

describe("loadGraph", () => {
  it("returns exactly computeFlowGraph's output for the resolved alias", async () => {
    const studioHome = tmpStudioHome();
    await seedProject(studioHome, "demo");

    const { alias, graph } = await loadGraph(studioHome, "demo");
    expect(alias).toBe("demo");

    const overlay = overlaySchema.parse({});
    expect(graph).toEqual(computeFlowGraph(SAMPLE_INFERRED, overlay));
  });

  it("defaults to the sole registered project when no alias is given", async () => {
    const studioHome = tmpStudioHome();
    await seedProject(studioHome, "solo");

    const { alias } = await loadGraph(studioHome);
    expect(alias).toBe("solo");
  });

  it("throws a clear error for an unregistered alias", async () => {
    const studioHome = tmpStudioHome();
    await seedProject(studioHome, "demo");
    await expect(loadGraph(studioHome, "nope")).rejects.toThrow(/No project registered/);
  });

  it("reflects wires recorded in overlay.yaml as edges", async () => {
    const studioHome = tmpStudioHome();
    await seedProject(studioHome, "demo");
    await appendWire(studioHome, "demo", {
      project: "demo",
      from: "skill:map-project",
      to: "skill:skills/map-project/SKILL.md",
      kind: "uses",
      install: "symlink",
    } as Wire);

    const { graph } = await loadGraph(studioHome, "demo");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.kind).toBe("uses");
  });
});
