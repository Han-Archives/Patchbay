import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inferredSchema, type Inferred } from "../types/inferred.js";
import {
  ensureProjectDir,
  readAtlas,
  readAtlasDigest,
  readFlow,
  readInferred,
  readOverlay,
  writeAtlas,
  writeAtlasDigest,
  writeFlow,
  writeInferred,
  writeOverlayIfAbsent,
} from "./projectFiles.js";

function tmpStudioHome(): string {
  // Safety: always a freshly created OS tmpdir, never the real ~/.patchbay.
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-project-files-"));
}

const sampleInferred: Inferred = inferredSchema.parse({
  discoveredPorts: ["skill:src/nested/SKILL.md", "source:README.md"],
  git: { branch: "main", head: "a".repeat(40), recentCommitSubjects: ["initial commit"] },
  agents: [],
});

describe("overlay.yaml (human-owned)", () => {
  it("readOverlay returns a fresh default when the file doesn't exist", async () => {
    const home = tmpStudioHome();
    const overlay = await readOverlay(home, "demo");
    expect(overlay).toEqual({ patches: [], wires: [], decisions: [], accepted_guides: [] });
  });

  it("writeOverlayIfAbsent creates the file the first time", async () => {
    const home = tmpStudioHome();
    await writeOverlayIfAbsent(home, "demo");
    const dir = await ensureProjectDir(home, "demo");
    expect(fs.existsSync(path.join(dir, "overlay.yaml"))).toBe(true);
  });

  it("writeOverlayIfAbsent never overwrites an existing overlay.yaml", async () => {
    const home = tmpStudioHome();
    const dir = await ensureProjectDir(home, "demo");
    fs.writeFileSync(path.join(dir, "overlay.yaml"), "patches: [{ project: demo, from: x, to: y, kind: uses }]\n");

    await writeOverlayIfAbsent(home, "demo");

    const raw = fs.readFileSync(path.join(dir, "overlay.yaml"), "utf8");
    expect(raw).toContain("kind: uses");
  });
});

describe("inferred.json (kernel-owned)", () => {
  it("round-trips via writeInferred/readInferred", async () => {
    const home = tmpStudioHome();
    await writeInferred(home, "demo", sampleInferred);
    const read = await readInferred(home, "demo");
    expect(read).toEqual(sampleInferred);
  });

  it("writeInferred always overwrites wholesale", async () => {
    const home = tmpStudioHome();
    await writeInferred(home, "demo", sampleInferred);
    const second: Inferred = { ...sampleInferred, discoveredPorts: [] };
    await writeInferred(home, "demo", second);
    const read = await readInferred(home, "demo");
    expect(read.discoveredPorts).toEqual([]);
  });
});

describe("ATLAS.md / FLOW.md (kernel-owned)", () => {
  it("writeAtlas returns the absolute path written, and readAtlas reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeAtlas(home, "demo", "## Skills\n\n없음\n");
    expect(path.isAbsolute(written)).toBe(true);
    expect(written).toBe(path.join(home, "projects", "demo", "ATLAS.md"));
    const read = await readAtlas(home, "demo");
    expect(read).toBe("## Skills\n\n없음\n");
  });

  it("writeFlow returns the absolute path written, and readFlow reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeFlow(home, "demo", "```mermaid\nflowchart TD\n```\n");
    expect(written).toBe(path.join(home, "projects", "demo", "FLOW.md"));
    const read = await readFlow(home, "demo");
    expect(read).toContain("flowchart TD");
  });

  it("writeAtlasDigest returns the absolute path written (next to ATLAS.md), and readAtlasDigest reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeAtlasDigest(home, "demo", "# Atlas Digest\n\n- Skills: 0\n");
    expect(path.isAbsolute(written)).toBe(true);
    expect(written).toBe(path.join(home, "projects", "demo", "ATLAS.digest.md"));
    const read = await readAtlasDigest(home, "demo");
    expect(read).toBe("# Atlas Digest\n\n- Skills: 0\n");
  });

  it("writeAtlasDigest always overwrites wholesale, like writeAtlas", async () => {
    const home = tmpStudioHome();
    await writeAtlasDigest(home, "demo", "- Skills: 1\n");
    await writeAtlasDigest(home, "demo", "- Skills: 2\n");
    const read = await readAtlasDigest(home, "demo");
    expect(read).toBe("- Skills: 2\n");
  });
});
