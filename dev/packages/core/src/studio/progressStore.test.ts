import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerProject } from "./studioStore.js";
import {
  readAllProjectsProgress,
  readProgress,
  readProgressMd,
  readProgressRaw,
  readStudioProgressRollup,
  writeProgressEntry,
  writeProgressMd,
  writeStudioProgressRollup,
} from "./progressStore.js";

function tmpStudioHome(): string {
  // Safety: always a freshly created OS tmpdir, never the real ~/.patchbay.
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-progress-store-"));
}

describe("progress.yaml (kernel-owned)", () => {
  it("readProgress returns a fresh default ({current: null, history: []}) when the file doesn't exist", async () => {
    const home = tmpStudioHome();
    const progress = await readProgress(home, "demo");
    expect(progress).toEqual({ current: null, history: [] });
  });

  it("writeProgressEntry sets current from only the given arguments, generating its own timestamp", async () => {
    const home = tmpStudioHome();
    const before = Date.now();
    const progress = await writeProgressEntry(home, "demo", { summary: "wiring up progress" });
    const after = Date.now();

    expect(progress.current).not.toBeNull();
    expect(progress.current?.project).toBe("demo");
    expect(progress.current?.summary).toBe("wiring up progress");
    expect(progress.current?.skill).toBeUndefined();
    expect(progress.current?.step).toBeUndefined();

    const timestampMs = new Date(progress.current!.timestamp).getTime();
    expect(timestampMs).toBeGreaterThanOrEqual(before);
    expect(timestampMs).toBeLessThanOrEqual(after);
  });

  it("writeProgressEntry carries skill/step through unchanged when given", async () => {
    const home = tmpStudioHome();
    const progress = await writeProgressEntry(home, "demo", {
      summary: "running the map-project skill",
      skill: "skill:map-project",
      step: "scan",
    });
    expect(progress.current?.skill).toBe("skill:map-project");
    expect(progress.current?.step).toBe("scan");
  });

  it("a second writeProgressEntry moves the previous current onto the front of history", async () => {
    const home = tmpStudioHome();
    await writeProgressEntry(home, "demo", { summary: "first thing" });
    const second = await writeProgressEntry(home, "demo", { summary: "second thing" });

    expect(second.current?.summary).toBe("second thing");
    expect(second.history).toHaveLength(1);
    expect(second.history[0]?.summary).toBe("first thing");
  });

  it("a third writeProgressEntry keeps history most-recent-first", async () => {
    const home = tmpStudioHome();
    await writeProgressEntry(home, "demo", { summary: "first thing" });
    await writeProgressEntry(home, "demo", { summary: "second thing" });
    const third = await writeProgressEntry(home, "demo", { summary: "third thing" });

    expect(third.current?.summary).toBe("third thing");
    expect(third.history.map((entry) => entry.summary)).toEqual(["second thing", "first thing"]);
  });

  it("readProgress round-trips exactly what writeProgressEntry wrote", async () => {
    const home = tmpStudioHome();
    const written = await writeProgressEntry(home, "demo", { summary: "round trip check" });
    const read = await readProgress(home, "demo");
    expect(read).toEqual(written);
  });

  it("readProgressRaw returns a valid, round-trippable YAML default when progress.yaml doesn't exist", async () => {
    const home = tmpStudioHome();
    const raw = await readProgressRaw(home, "demo");
    expect(raw).toContain("current");
    expect(() => JSON.parse(JSON.stringify(raw))).not.toThrow();
  });

  it("readProgressRaw reflects the current on-disk content after a write", async () => {
    const home = tmpStudioHome();
    await writeProgressEntry(home, "demo", { summary: "raw check" });
    const raw = await readProgressRaw(home, "demo");
    expect(raw).toContain("raw check");
  });
});

describe("PROGRESS.md (kernel-owned, mirrors writeAtlas/readAtlas)", () => {
  it("writeProgressMd returns the absolute path written, and readProgressMd reads it back", async () => {
    const home = tmpStudioHome();
    const written = await writeProgressMd(home, "demo", "# Progress\n\n## Current\n\n진행 중인 작업 없음\n");
    expect(path.isAbsolute(written)).toBe(true);
    expect(written).toBe(path.join(home, "projects", "demo", "PROGRESS.md"));
    const read = await readProgressMd(home, "demo");
    expect(read).toBe("# Progress\n\n## Current\n\n진행 중인 작업 없음\n");
  });

  it("writeProgressMd always overwrites wholesale", async () => {
    const home = tmpStudioHome();
    await writeProgressMd(home, "demo", "first\n");
    await writeProgressMd(home, "demo", "second\n");
    const read = await readProgressMd(home, "demo");
    expect(read).toBe("second\n");
  });

  it("readProgressMd throws when it hasn't been generated yet", async () => {
    const home = tmpStudioHome();
    await expect(readProgressMd(home, "demo")).rejects.toThrow();
  });
});

describe("readAllProjectsProgress", () => {
  it("reads every registered project's Progress, sorted by alias ascending, defaulting the never-written ones", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "zeta", kind: "local_repo", path: "/tmp/zeta" });
    await registerProject(home, { alias: "alpha", kind: "local_repo", path: "/tmp/alpha" });
    await writeProgressEntry(home, "zeta", { summary: "zeta work" });
    // "alpha" is registered but never had progress written -- should still
    // appear, with the default empty Progress.

    const all = await readAllProjectsProgress(home);
    expect(all.map((entry) => entry.alias)).toEqual(["alpha", "zeta"]);
    expect(all[0]?.progress).toEqual({ current: null, history: [] });
    expect(all[1]?.progress.current?.summary).toBe("zeta work");
  });

  it("returns an empty array when no projects are registered", async () => {
    const home = tmpStudioHome();
    expect(await readAllProjectsProgress(home)).toEqual([]);
  });
});

describe("studio-wide progress.md rollup (kernel-owned, sibling to studio.yaml)", () => {
  it("writeStudioProgressRollup writes to <studioHome>/progress.md, not inside projects/<alias>/", async () => {
    const home = tmpStudioHome();
    const written = await writeStudioProgressRollup(home, "# Studio Progress\n\n등록된 프로젝트 없음\n");
    expect(written).toBe(path.join(home, "progress.md"));
    const read = await readStudioProgressRollup(home);
    expect(read).toBe("# Studio Progress\n\n등록된 프로젝트 없음\n");
  });

  it("writeStudioProgressRollup always overwrites wholesale", async () => {
    const home = tmpStudioHome();
    await writeStudioProgressRollup(home, "first\n");
    await writeStudioProgressRollup(home, "second\n");
    expect(await readStudioProgressRollup(home)).toBe("second\n");
  });

  it("readStudioProgressRollup throws when it hasn't been generated yet", async () => {
    const home = tmpStudioHome();
    await expect(readStudioProgressRollup(home)).rejects.toThrow();
  });
});
