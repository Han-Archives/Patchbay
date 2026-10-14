import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skills");

function readSkill(slug: string): string {
  return fs.readFileSync(path.join(SKILLS_ROOT, slug, "SKILL.md"), "utf8");
}

describe("bundled skill contracts (P8 regression)", () => {
  it("map-project is lookup-only and records progress start/done", () => {
    const text = readSkill("map-project");
    expect(text).toContain("아무 파일도 쓰지 않는다");
    expect(text).toContain("patchbay progress write");
    expect(text).toContain("--skill map-project --step start");
    expect(text).toContain("--skill map-project --step done");
    expect(text).toContain("scan");
    expect(text).not.toContain("워커 세션을 원격으로 켠다");
  });

  it("adopt-project does not write estimated current work before confirmation", () => {
    const text = readSkill("adopt-project");
    expect(text).toContain("확인 전에는 `progress.yaml.current`에 추정값을 쓰지 않는다");
    expect(text).toContain("덮어쓰지 않는다");
    expect(text).toContain("patchbay progress write");
  });

  it("triage-project does not delete and is not a terminus", () => {
    const text = readSkill("triage-project");
    expect(text).toContain("삭제하지 않는다");
    expect(text).toContain("_archive/");
    expect(text).toContain("new-project");
    expect(text).toContain("adopt-project");
    expect(text).toContain("progress write");
  });
});
