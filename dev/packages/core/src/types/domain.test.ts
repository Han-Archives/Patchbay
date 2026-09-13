import { describe, expect, it } from "vitest";
import { conceptSchema, decisionSchema, signalSchema, viewSchema } from "./domain.js";

describe("Concept", () => {
  it("parses required fields", () => {
    const result = conceptSchema.safeParse({
      id: "atlas-visibility",
      project: "patchbay",
      name: "Atlas Visibility",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing project", () => {
    expect(conceptSchema.safeParse({ id: "atlas-visibility", name: "Atlas Visibility" }).success).toBe(
      false,
    );
  });
});

describe("Decision", () => {
  it("parses required fields, relating to a Concept by id", () => {
    const result = decisionSchema.safeParse({
      id: "d-001",
      concept: "atlas-visibility",
      summary: "Symlink studio files rather than copy",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing concept reference", () => {
    expect(decisionSchema.safeParse({ id: "d-001", summary: "..." }).success).toBe(false);
  });
});

describe("Signal", () => {
  it("parses with its own PortId kind", () => {
    const result = signalSchema.safeParse({ port: "signal:signals/build-red.json" });
    expect(result.success).toBe(true);
  });

  it("rejects a port of the wrong kind", () => {
    expect(signalSchema.safeParse({ port: "artifact:ATLAS.md" }).success).toBe(false);
  });
});

describe("View", () => {
  it("parses with an empty signals array", () => {
    const result = viewSchema.safeParse({ id: "v-1", name: "Build Health" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.signals).toEqual([]);
    }
  });

  it("parses with related Signals", () => {
    const result = viewSchema.safeParse({
      id: "v-1",
      name: "Build Health",
      signals: ["signal:signals/build-red.json"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a signals entry that isn't a signal: PortId", () => {
    const result = viewSchema.safeParse({
      id: "v-1",
      name: "Build Health",
      signals: ["artifact:ATLAS.md"],
    });
    expect(result.success).toBe(false);
  });
});
