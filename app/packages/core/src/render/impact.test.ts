import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { overlaySchema } from "../types/overlay.js";
import { computeImpactRadius, computePortDebt } from "./impact.js";

const baseGit = { branch: "main", head: "a".repeat(40), recentCommitSubjects: [] };

const wire = (from: string, to: string, kind: string) => ({
  project: "demo",
  from,
  to,
  kind,
  install: "copy" as const,
});

/**
 * Shape modelled on a real registered project's overlay: one hub file that
 * several skills read, each skill pulling its own prompt/drill behind it.
 *
 *   유형.md ── next-slot ── drills/next-slot.md
 *          └── diagnose  ── prompts/diagnose.md
 *                        └── drills/wrong-log.md ── week2-gate.md
 */
const overlay = overlaySchema.parse({
  wires: [
    wire("skill:skills/next-slot/SKILL.md", "source:docs/자료/유형.md", "reads"),
    wire("skill:skills/diagnose/SKILL.md", "source:docs/자료/유형.md", "reads"),
    wire("skill:skills/next-slot/SKILL.md", "source:drills/next-slot.md", "produces"),
    wire("skill:skills/diagnose/SKILL.md", "source:prompts/diagnose.md", "uses"),
    wire("skill:skills/diagnose/SKILL.md", "source:drills/wrong-log.md", "reads"),
    wire("skill:skills/study-day/SKILL.md", "source:drills/wrong-log.md", "reads"),
    wire("skill:skills/study-day/SKILL.md", "source:drills/week2-gate.md", "reads"),
  ],
});

describe("impact.ts: computeImpactRadius", () => {
  it("partitions the neighbourhood into rings by shortest distance", () => {
    const radius = computeImpactRadius(overlay, "source:docs/자료/유형.md", 3);

    expect(radius.hops[0]!.map((hit) => hit.port)).toEqual([
      "skill:skills/diagnose/SKILL.md",
      "skill:skills/next-slot/SKILL.md",
    ]);
    expect(radius.hops[1]!.map((hit) => hit.port)).toEqual([
      "source:drills/next-slot.md",
      "source:drills/wrong-log.md",
      "source:prompts/diagnose.md",
    ]);
    expect(radius.hops[2]!.map((hit) => hit.port)).toEqual(["skill:skills/study-day/SKILL.md"]);
    expect(radius.total).toBe(6);
  });

  it("reports a port at its shortest distance only, never in a later ring too", () => {
    const radius = computeImpactRadius(overlay, "source:docs/자료/유형.md", 3);
    const everywhere = radius.hops.flat().map((hit) => hit.port);
    expect(new Set(everywhere).size).toBe(everywhere.length);
    expect(everywhere).not.toContain("source:docs/자료/유형.md");
  });

  it("walks undirected -- reaching a skill from the file it reads", () => {
    // 유형.md is only ever a wire's `to`; a directed walk would find nothing.
    const radius = computeImpactRadius(overlay, "source:docs/자료/유형.md", 1);
    expect(radius.hops[0]).toHaveLength(2);
    expect(radius.hops[0]![0]!.kind).toBe("reads");
    expect(radius.hops[0]![0]!.via).toBe("source:docs/자료/유형.md");
  });

  it("stops at maxHops and always returns that many rings", () => {
    const radius = computeImpactRadius(overlay, "source:docs/자료/유형.md", 2);
    expect(radius.hops).toHaveLength(2);
    expect(radius.total).toBe(5);
    expect(radius.hops.flat().map((hit) => hit.port)).not.toContain("skill:skills/study-day/SKILL.md");
  });

  it("returns empty rings for an unknown or blank origin rather than throwing", () => {
    expect(computeImpactRadius(overlay, "source:nope.md", 3).total).toBe(0);
    expect(computeImpactRadius(overlay, "", 3).hops).toHaveLength(3);
    expect(computeImpactRadius(overlaySchema.parse({}), "source:a.md", 3).total).toBe(0);
  });
});

describe("impact.ts: computePortDebt", () => {
  it("orphans are discovered ports no patch or wire touches", () => {
    const inferred = inferredSchema.parse({
      discoveredPorts: [
        "source:docs/자료/유형.md",
        "source:README.md",
        "source:AGENTS.md",
        "skill:skills/next-slot/SKILL.md",
      ],
      git: baseGit,
    });
    const debt = computePortDebt(inferred, overlay);
    expect(debt.orphans).toEqual(["source:AGENTS.md", "source:README.md"]);
  });

  it("hubs are ports at or above the degree threshold, busiest first", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    const debt = computePortDebt(inferred, overlay, 2);
    expect(debt.hubs[0]).toEqual({ port: "skill:skills/diagnose/SKILL.md", degree: 3 });
    expect(debt.hubs.map((hub) => hub.port)).toContain("source:drills/wrong-log.md");
    expect(debt.hubs.every((hub) => hub.degree >= 2)).toBe(true);
  });

  it("counts a distinct neighbour once even when several entries repeat the edge", () => {
    const repeated = overlaySchema.parse({
      patches: [{ project: "demo", from: "skill:a", to: "artifact:b", kind: "produces" }],
      wires: [wire("skill:a", "artifact:b", "produces")],
    });
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    expect(computePortDebt(inferred, repeated, 1).hubs).toEqual([
      { port: "artifact:b", degree: 1 },
      { port: "skill:a", degree: 1 },
    ]);
  });
});
