import { describe, expect, it } from "vitest";
import { parsePortId, portIdSchema } from "./portId.js";

describe("PortId", () => {
  it.each([
    "source:README.md",
    "skill:map-project", // Bay slug — no slash, no dot
    "skill:skills/local-foo/SKILL.md", // project-local fileRef — ends in SKILL.md
    "artifact:ATLAS.md",
    "agent:writer-01",
    "signal:signals/build-red.json",
  ])("parses %s successfully", (raw) => {
    const result = parsePortId(raw);
    expect(result.success).toBe(true);
  });

  it("round-trips the raw string as the parsed value", () => {
    const result = parsePortId("source:README.md");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("source:README.md");
    }
  });

  describe("ambiguity rule for skill:", () => {
    it("treats a bare name with no slash or dot as a Bay slug", () => {
      expect(parsePortId("skill:map-project").success).toBe(true);
    });

    it("accepts a project-local fileRef ending in SKILL.md", () => {
      expect(parsePortId("skill:skills/local-foo/SKILL.md").success).toBe(true);
    });

    it("rejects a path-like ref that does not end in SKILL.md", () => {
      expect(parsePortId("skill:skills/local-foo/README.md").success).toBe(false);
      expect(parsePortId("skill:skills/local-foo").success).toBe(false);
    });

    it("rejects a slug-shaped ref containing a dot that isn't SKILL.md", () => {
      expect(parsePortId("skill:map.project").success).toBe(false);
    });
  });

  describe("parse failures", () => {
    it("rejects an empty kind", () => {
      expect(parsePortId(":README.md").success).toBe(false);
      expect(parsePortId("README.md").success).toBe(false);
    });

    it("rejects control whitespace (tabs, newlines)", () => {
      expect(parsePortId("source:foo\tbar.md").success).toBe(false);
      expect(parsePortId("source:foo\nbar.md").success).toBe(false);
    });

    // Regression test: a real scan of a project with Korean folder names
    // (e.g. "projects/완료/ADP 자격증 공부/README.md") threw instead of
    // registering, because a plain space anywhere in the raw PortId was
    // rejected -- but the scanner builds source:/skill: PortIds directly
    // from real filesystem paths, and ordinary spaces in file/directory
    // names are completely normal.
    it("accepts an ordinary space in a fileRef", () => {
      expect(parsePortId("source:foo bar.md").success).toBe(true);
      expect(parsePortId("source:projects/완료/ADP 자격증 공부/README.md").success).toBe(true);
    });

    it("rejects .. path segments", () => {
      expect(parsePortId("source:../secrets.md").success).toBe(false);
      expect(parsePortId("artifact:foo/../bar.md").success).toBe(false);
    });

    it("rejects absolute paths", () => {
      expect(parsePortId("source:/etc/passwd").success).toBe(false);
    });

    it("rejects an unknown kind", () => {
      expect(parsePortId("widget:foo.md").success).toBe(false);
    });

    it("rejects an empty ref", () => {
      expect(parsePortId("source:").success).toBe(false);
    });
  });

  it("is usable as a nested Zod schema", () => {
    const wrapper = portIdSchema;
    expect(wrapper.safeParse("artifact:ATLAS.md").success).toBe(true);
  });
});
