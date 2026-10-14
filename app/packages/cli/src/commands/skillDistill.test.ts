import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { placeOnBoard, registerProject, skillPackageExists } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPatch } from "./patch.js";
import { runSkillAccept } from "./skillAccept.js";
import { runSkillDistill } from "./skillDistill.js";

let studioHome: string;
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-skill-"));
  process.env.PATCHBAY_HOME = studioHome;
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

describe("skill distill / accept", () => {
  it("writes a proposed SKILL.md and accept makes patchbay patch possible", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-skill-proj-"));
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectDir });
    await placeOnBoard(studioHome, "demo", {
      id: "langgraph:flow:draft",
      kind: "langgraph",
      ref: "flow:draft",
      title: "draft",
    });

    const missingProject = await runSkillDistill({}, studioHome);
    expect(missingProject).toBe(1);

    const distilled = await runSkillDistill({ project: "demo", slug: "harvested", json: true }, studioHome);
    expect(distilled).toBe(0);
    expect(await skillPackageExists(studioHome, "harvested")).toBe(false);
    expect(fs.existsSync(path.join(studioHome, "skills", "harvested.proposed", "SKILL.md"))).toBe(true);

    const accepted = await runSkillAccept("harvested", { json: true }, studioHome);
    expect(accepted).toBe(0);
    expect(await skillPackageExists(studioHome, "harvested")).toBe(true);

    const patched = await runPatch("harvested", "demo", { json: true }, studioHome);
    expect(patched).toBe(0);
    expect(fs.existsSync(path.join(projectDir, "skills", "harvested", "SKILL.md"))).toBe(true);
  });

  it("accept without a draft exits 1", async () => {
    expect(await runSkillAccept("missing", {}, studioHome)).toBe(1);
  });
});
