import { describe, expect, it } from "vitest";
import { overlaySchema } from "./overlay.js";

describe("Overlay", () => {
  it("parses with all arrays defaulted to empty", () => {
    const result = overlaySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ patches: [], wires: [], decisions: [], accepted_guides: [] });
    }
  });

  it("parses with patches, wires, decisions, and accepted_guides populated", () => {
    const result = overlaySchema.safeParse({
      patches: [
        { project: "patchbay", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" },
      ],
      wires: [
        {
          project: "patchbay",
          from: "skill:map-project",
          to: "artifact:ATLAS.md",
          kind: "produces",
          install: "symlink",
        },
      ],
      decisions: [{ id: "d-1", concept: "atlas-visibility", summary: "Symlink by default" }],
      accepted_guides: ["onboarding-v1"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed wire (missing install)", () => {
    const result = overlaySchema.safeParse({
      wires: [{ project: "patchbay", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" }],
    });
    expect(result.success).toBe(false);
  });
});
