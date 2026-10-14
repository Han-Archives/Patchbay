import { describe, expect, it } from "vitest";
import {
  agentSchema,
  artifactSchema,
  matchPatchesAndWires,
  patchSchema,
  projectSchema,
  skillSchema,
  sourceSchema,
  wireSchema,
  type Patch,
  type Wire,
} from "./project.js";

describe("Source", () => {
  it("parses required fields", () => {
    const result = sourceSchema.safeParse({ port: "source:README.md" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing port", () => {
    expect(sourceSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a port of the wrong kind", () => {
    expect(sourceSchema.safeParse({ port: "artifact:ATLAS.md" }).success).toBe(false);
  });
});

describe("Skill", () => {
  it("parses required fields, including its Source", () => {
    const result = skillSchema.safeParse({
      port: "skill:map-project",
      name: "Map Project",
      source: { port: "source:README.md" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing source", () => {
    const result = skillSchema.safeParse({ port: "skill:map-project", name: "Map Project" });
    expect(result.success).toBe(false);
  });
});

describe("Agent (schema-only in v1)", () => {
  it("parses with an empty skills array", () => {
    const result = agentSchema.safeParse({ port: "agent:writer-01", name: "Writer 01" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual([]);
    }
  });

  it("parses with declared skills", () => {
    const result = agentSchema.safeParse({
      port: "agent:writer-01",
      name: "Writer 01",
      skills: ["skill:map-project"],
    });
    expect(result.success).toBe(true);
  });
});

describe("Artifact", () => {
  it("parses required fields including layer", () => {
    const result = artifactSchema.safeParse({
      port: "artifact:ATLAS.md",
      project: "patchbay",
      layer: "digest",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid layer value", () => {
    const result = artifactSchema.safeParse({
      port: "artifact:ATLAS.md",
      project: "patchbay",
      layer: "verbose",
    });
    expect(result.success).toBe(false);
  });
});

describe("Patch", () => {
  const validPatch = {
    project: "patchbay",
    from: "skill:map-project",
    to: "artifact:ATLAS.md",
    kind: "produces",
  };

  it("parses required fields", () => {
    expect(patchSchema.safeParse(validPatch).success).toBe(true);
  });

  it("rejects an invalid kind", () => {
    expect(patchSchema.safeParse({ ...validPatch, kind: "deletes" }).success).toBe(false);
  });

  it("rejects a missing from/to", () => {
    const { from: _from, ...rest } = validPatch;
    expect(patchSchema.safeParse(rest).success).toBe(false);
  });
});

describe("Wire", () => {
  const validWire = {
    project: "patchbay",
    from: "skill:map-project",
    to: "artifact:ATLAS.md",
    kind: "produces",
    install: "symlink",
  };

  it("parses required fields, evidence optional", () => {
    expect(wireSchema.safeParse(validWire).success).toBe(true);
    expect(wireSchema.safeParse({ ...validWire, evidence: "found via scan" }).success).toBe(true);
  });

  it("rejects a missing install", () => {
    const { install: _install, ...rest } = validWire;
    expect(wireSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an invalid install method", () => {
    expect(wireSchema.safeParse({ ...validWire, install: "ftp" }).success).toBe(false);
  });
});

describe("Project", () => {
  it("parses with an empty agents array (the v1 default/common case)", () => {
    const result = projectSchema.safeParse({ alias: "patchbay" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents).toEqual([]);
      expect(result.data.skills).toEqual([]);
    }
  });

  it("parses with skills and agents populated", () => {
    const result = projectSchema.safeParse({
      alias: "patchbay",
      skills: [
        {
          port: "skill:map-project",
          name: "Map Project",
          source: { port: "source:README.md" },
        },
      ],
      agents: [{ port: "agent:writer-01", name: "Writer 01" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing alias", () => {
    expect(projectSchema.safeParse({}).success).toBe(false);
  });
});

describe("matchPatchesAndWires", () => {
  const patch: Patch = {
    project: "patchbay",
    from: "skill:map-project",
    to: "artifact:ATLAS.md",
    kind: "produces",
  } as Patch;

  const matchingWire: Wire = {
    ...patch,
    install: "symlink",
  } as Wire;

  const unmatchedPatch: Patch = {
    project: "patchbay",
    from: "skill:map-project",
    to: "artifact:FLOW.md",
    kind: "produces",
  } as Patch;

  const unmatchedWire: Wire = {
    project: "patchbay",
    from: "source:README.md",
    to: "artifact:ATLAS.md",
    kind: "reads",
    install: "copy",
  } as Wire;

  it("matches a Patch and Wire sharing the (from, to, kind) key", () => {
    const result = matchPatchesAndWires([patch], [matchingWire]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toEqual({ patch, wire: matchingWire });
    expect(result.patchesWithoutWire).toEqual([]);
    expect(result.wiresWithoutPatch).toEqual([]);
  });

  it("reports a Patch with no matching Wire", () => {
    const result = matchPatchesAndWires([unmatchedPatch], []);
    expect(result.matched).toEqual([]);
    expect(result.patchesWithoutWire).toEqual([unmatchedPatch]);
    expect(result.wiresWithoutPatch).toEqual([]);
  });

  it("reports a Wire with no matching Patch (normal, not a bug)", () => {
    const result = matchPatchesAndWires([], [unmatchedWire]);
    expect(result.matched).toEqual([]);
    expect(result.patchesWithoutWire).toEqual([]);
    expect(result.wiresWithoutPatch).toEqual([unmatchedWire]);
  });

  it("ignores evidence when matching (evidence is not part of the key)", () => {
    const wireWithEvidence: Wire = { ...matchingWire, evidence: "observed via scan" } as Wire;
    const result = matchPatchesAndWires([patch], [wireWithEvidence]);
    expect(result.matched).toHaveLength(1);
  });
});
