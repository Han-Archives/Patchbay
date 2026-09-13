import { describe, expect, it } from "vitest";
import type { Studio } from "@patchbay/core";
import { resolveProjectAlias } from "./aliasResolution.js";

function studioWith(aliases: string[]): Studio {
  return {
    name: "Test Studio",
    projects: aliases.map((alias) => ({ alias, kind: "local_repo" as const, path: `/tmp/${alias}` })),
  };
}

describe("resolveProjectAlias", () => {
  it("uses the explicit alias when it is registered", () => {
    const result = resolveProjectAlias(studioWith(["a", "b"]), "b");
    expect(result).toEqual({ ok: true, alias: "b" });
  });

  it("errors when the explicit alias isn't registered", () => {
    const result = resolveProjectAlias(studioWith(["a"]), "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("nope");
  });

  it("defaults to the single registered project when --project is omitted", () => {
    const result = resolveProjectAlias(studioWith(["only"]), undefined);
    expect(result).toEqual({ ok: true, alias: "only" });
  });

  it("errors when no project is registered and none was given", () => {
    const result = resolveProjectAlias(studioWith([]), undefined);
    expect(result.ok).toBe(false);
  });

  it("errors and asks to disambiguate when multiple projects are registered and none was given", () => {
    const result = resolveProjectAlias(studioWith(["a", "b"]), undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("a");
      expect(result.message).toContain("b");
    }
  });
});
