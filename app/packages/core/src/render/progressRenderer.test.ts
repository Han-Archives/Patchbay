import { describe, expect, it } from "vitest";
import type { Progress } from "../types/progress.js";
import { renderProgressLevel1, renderProgressMd, renderStudioProgressRollup } from "./progressRenderer.js";

const emptyProgress: Progress = { current: null, history: [] };

describe("renderProgressMd", () => {
  it("renders an idle marker when current is null and history is empty", () => {
    const md = renderProgressMd(emptyProgress);
    expect(md).toContain("## Current");
    expect(md).toContain("## History");
    expect(md).toContain("진행 중인 작업 없음");
  });

  it("renders the current entry's summary/skill/step/timestamp", () => {
    const progress: Progress = {
      current: {
        project: "demo",
        summary: "wiring up the progress surface",
        skill: "skill:map-project",
        step: "scan",
        timestamp: "2026-09-13T00:00:00.000Z",
      },
      history: [],
    };
    const md = renderProgressMd(progress);
    expect(md).toContain("wiring up the progress surface");
    expect(md).toContain("skill:map-project");
    expect(md).toContain("scan");
    expect(md).toContain("2026-09-13T00:00:00.000Z");
  });

  it("renders history entries, in the order Progress.history already holds them (no re-sorting)", () => {
    const progress: Progress = {
      current: { project: "demo", summary: "now", timestamp: "2026-09-13T03:00:00.000Z" },
      history: [
        { project: "demo", summary: "second most recent", timestamp: "2026-09-13T02:00:00.000Z" },
        { project: "demo", summary: "oldest", timestamp: "2026-09-13T01:00:00.000Z" },
      ],
    };
    const md = renderProgressMd(progress);
    const secondIndex = md.indexOf("second most recent");
    const oldestIndex = md.indexOf("oldest");
    expect(secondIndex).toBeGreaterThan(-1);
    expect(oldestIndex).toBeGreaterThan(secondIndex);
  });

  it("omits skill/step lines when not present on an entry", () => {
    const progress: Progress = {
      current: { project: "demo", summary: "no skill or step here", timestamp: "2026-09-13T00:00:00.000Z" },
      history: [],
    };
    const md = renderProgressMd(progress);
    expect(md).not.toContain("skill:");
    expect(md).not.toContain("step:");
  });
});

describe("renderProgressLevel1", () => {
  it("returns the idle marker when current is null", () => {
    expect(renderProgressLevel1(emptyProgress)).toBe("진행 중인 작업 없음");
  });

  it("returns just the summary when skill/step are absent", () => {
    const progress: Progress = {
      current: { project: "demo", summary: "just a summary", timestamp: "2026-09-13T00:00:00.000Z" },
      history: [],
    };
    expect(renderProgressLevel1(progress)).toBe("just a summary");
  });

  it("includes skill/step when present", () => {
    const progress: Progress = {
      current: {
        project: "demo",
        summary: "doing a thing",
        skill: "skill:map-project",
        step: "scan",
        timestamp: "2026-09-13T00:00:00.000Z",
      },
      history: [],
    };
    const line = renderProgressLevel1(progress);
    expect(line).toContain("doing a thing");
    expect(line).toContain("skill:map-project");
    expect(line).toContain("scan");
  });
});

describe("renderStudioProgressRollup", () => {
  it("renders one line per project, idle for those with no current entry", () => {
    const rollup = renderStudioProgressRollup([
      { alias: "alpha", progress: emptyProgress },
      {
        alias: "zeta",
        progress: {
          current: { project: "zeta", summary: "shipping phase 7", timestamp: "2026-09-13T00:00:00.000Z" },
          history: [],
        },
      },
    ]);
    expect(rollup).toContain("alpha");
    expect(rollup).toContain("진행 중인 작업 없음");
    expect(rollup).toContain("zeta");
    expect(rollup).toContain("shipping phase 7");
  });

  it("renders a no-projects marker for an empty array", () => {
    const rollup = renderStudioProgressRollup([]);
    expect(rollup).toContain("등록된 프로젝트 없음");
  });

  it("keeps each project's line self-contained (one project's summary text doesn't bleed into another's line)", () => {
    const rollup = renderStudioProgressRollup([
      {
        alias: "alpha",
        progress: {
          current: { project: "alpha", summary: "alpha work", timestamp: "2026-09-13T00:00:00.000Z" },
          history: [],
        },
      },
      {
        alias: "zeta",
        progress: {
          current: { project: "zeta", summary: "zeta work", timestamp: "2026-09-13T00:00:00.000Z" },
          history: [],
        },
      },
    ]);
    const lines = rollup.split("\n").filter((line) => line.startsWith("- "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("alpha work");
    expect(lines[0]).not.toContain("zeta work");
    expect(lines[1]).toContain("zeta work");
    expect(lines[1]).not.toContain("alpha work");
  });
});
