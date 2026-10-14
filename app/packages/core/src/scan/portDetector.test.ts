import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { walk } from "./fileWalker.js";
import { detectPorts, findSkillPorts } from "./portDetector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = path.join(__dirname, "__fixtures__", "sample-project");

describe("findSkillPorts", () => {
  it("emits a fileRef-form skill: port for a SKILL.md with no matching Bay slug", () => {
    const ports = findSkillPorts(walk(SAMPLE_PROJECT), []);
    expect(ports).toContain("skill:src/nested/SKILL.md");
  });

  it("emits the bare Bay-slug form when the parent dir name matches studioBaySlugs", () => {
    const ports = findSkillPorts(walk(SAMPLE_PROJECT), ["studio-bay-example"]);
    expect(ports).toContain("skill:studio-bay-example");
    expect(ports).not.toContain("skill:studio-bay-example/SKILL.md");
  });

  it("defaults studioBaySlugs to [] and uses the fileRef form for every SKILL.md", () => {
    const ports = findSkillPorts(walk(SAMPLE_PROJECT));
    expect(ports).toContain("skill:studio-bay-example/SKILL.md");
    expect(ports).toContain("skill:src/nested/SKILL.md");
  });

  it("does not find SKILL.md inside ignored directories", () => {
    const ports = findSkillPorts(walk(SAMPLE_PROJECT));
    expect(ports.some((p) => p.includes("node_modules"))).toBe(false);
    expect(ports.some((p) => p.includes("/dist/"))).toBe(false);
  });
});

describe("detectPorts", () => {
  it("combines skill ports and signal ports into one sorted, deduplicated array", () => {
    const ports = detectPorts(walk(SAMPLE_PROJECT));
    expect(ports).toEqual([...ports].sort());
    expect(new Set(ports).size).toBe(ports.length);

    expect(ports).toContain("source:README.md");
    expect(ports).toContain("source:AGENTS.md");
    expect(ports).toContain("source:CLAUDE.md");
    expect(ports).toContain("source:.cursor/rules/a.md");
    expect(ports).toContain("source:.cursor/rules/b.mdc");
    expect(ports).toContain("skill:src/nested/SKILL.md");
  });

  it("applies the Bay-slug exception when combining", () => {
    const ports = detectPorts(walk(SAMPLE_PROJECT), { studioBaySlugs: ["studio-bay-example"] });
    expect(ports).toContain("skill:studio-bay-example");
  });

  it("returns [] when nothing is discoverable", () => {
    const noSignalFiles = [{ absolutePath: "/x/src/index.ts", relativePath: "src/index.ts" }];
    expect(detectPorts(noSignalFiles)).toEqual([]);
  });

  it("every emitted port passes portIdSchema (validated via successful construction)", () => {
    // detectPorts throws internally on an invalid PortId (see portDetector's
    // toPortId), so simply not throwing across the whole fixture is itself
    // a validity assertion; this test makes that intent explicit.
    expect(() => detectPorts(walk(SAMPLE_PROJECT), { studioBaySlugs: ["studio-bay-example"] })).not.toThrow();
  });
});
