import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureStudioInitialized,
  inferredSchema,
  projectStudioDir,
  registerProject,
  writeInferred,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { loadImpactView } from "./impactView.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-impact-"));
}

const SAMPLE_INFERRED = inferredSchema.parse({
  discoveredPorts: [
    "source:docs/types.md",
    "source:README.md",
    "skill:skills/a/SKILL.md",
    "skill:skills/b/SKILL.md",
  ],
  git: { branch: "main", head: "abc1234", recentCommitSubjects: ["init"] },
  agents: [],
});

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

async function setup(wires: Array<[string, string, string]>): Promise<string> {
  const studioHome = tmpStudioHome();
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
  await writeOverlayIfAbsent(studioHome, "demo");
  await writeInferred(studioHome, "demo", SAMPLE_INFERRED);
  writeWires(studioHome, "demo", wires);
  return studioHome;
}

describe("loadImpactView", () => {
  it("returns 400 without alias and 404 for an unregistered one", async () => {
    const missing = await loadImpactView(tmpStudioHome(), undefined, undefined, undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(400);

    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const unknown = await loadImpactView(studioHome, "nope", undefined, undefined);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(404);
  });

  it("groups rings by hop and carries label/name for each port", async () => {
    const studioHome = await setup([
      ["skill:skills/a/SKILL.md", "source:docs/types.md", "reads"],
      ["skill:skills/b/SKILL.md", "source:docs/types.md", "reads"],
      ["skill:skills/b/SKILL.md", "source:README.md", "produces"],
    ]);

    const result = await loadImpactView(studioHome, "demo", "source:docs/types.md", 2);
    expect(result.ok).toBe(true);
    if (!result.ok || result.body.status !== "ok") return;

    expect(result.body.total).toBe(3);
    expect(result.body.rings).toHaveLength(2);
    // A skill's basename is always SKILL.md, so its folder is its name.
    expect(result.body.rings[0]!.ports.map((p) => p.name)).toEqual(["a", "b"]);
    expect(result.body.rings[0]!.ports[0]!.label).toBe("Skill");
    expect(result.body.rings[1]!.ports[0]).toMatchObject({
      path: "README.md",
      label: "File",
      kind: "produces",
      via: "skill:skills/b/SKILL.md",
    });
  });

  it("answers with no Neo4j port anywhere in the call", async () => {
    // loadImpactView's signature has no Neo4jPort parameter at all -- the
    // radius is a Core computation, so the 지식 tab keeps working with the
    // sidecar down.
    const studioHome = await setup([["skill:skills/a/SKILL.md", "source:docs/types.md", "reads"]]);
    const result = await loadImpactView(studioHome, "demo", "source:docs/types.md", undefined);
    expect(result.ok).toBe(true);
    if (!result.ok || result.body.status !== "ok") return;
    expect(result.body.total).toBe(1);
    expect(result.body.maxHops).toBe(3);
  });

  it("reports debt with no origin, and marks an unknown origin as not known", async () => {
    const studioHome = await setup([
      ["skill:skills/a/SKILL.md", "source:docs/types.md", "reads"],
      ["skill:skills/b/SKILL.md", "source:docs/types.md", "reads"],
    ]);

    const debtOnly = await loadImpactView(studioHome, "demo", undefined, undefined);
    if (!debtOnly.ok || debtOnly.body.status !== "ok") throw new Error("expected ok");
    expect(debtOnly.body.origin).toBeNull();
    expect(debtOnly.body.rings).toEqual([]);
    expect(debtOnly.body.debt.orphans).toBe(1); // source:README.md is discovered but unwired

    const unknown = await loadImpactView(studioHome, "demo", "source:ghost.md", undefined);
    if (!unknown.ok || unknown.body.status !== "ok") throw new Error("expected ok");
    expect(unknown.body.known).toBe(false);
    expect(unknown.body.total).toBe(0);
  });

  it("returns unscanned when inferred.json is missing", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const result = await loadImpactView(studioHome, "demo", undefined, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.status).toBe("unscanned");
  });
});
