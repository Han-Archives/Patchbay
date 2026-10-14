import { describe, expect, it } from "vitest";
import { overlaySchema } from "./overlay.js";

describe("Overlay", () => {
  it("parses with all arrays defaulted to empty", () => {
    const result = overlaySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        patches: [],
        wires: [],
        decisions: [],
        accepted_guides: [],
        process: { configured: false, goal: "", folders: [], steps: [], edges: [], bind: {} },
      });
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
      process: {
        configured: true,
        goal: "출시",
        folders: ["docs/기획"],
        steps: [
          { id: "intake", label: "오답 접수" },
          { id: "diagnose", label: "진단" },
        ],
        edges: [{ from: "intake", to: "diagnose" }],
        bind: { diagnose: "diagnose" },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.process.steps.map((step) => step.output)).toEqual(["table", "table"]);
    }
  });

  it("rejects a malformed wire (missing install)", () => {
    const result = overlaySchema.safeParse({
      wires: [{ project: "patchbay", from: "skill:map-project", to: "artifact:ATLAS.md", kind: "produces" }],
    });
    expect(result.success).toBe(false);
  });
});
