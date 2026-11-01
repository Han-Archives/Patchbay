import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evalEvidenceDir, evalEvidenceFilePath, readEvalEvidence, writeEvalEvidence } from "./evidence.js";

function home(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pb-evidence-"));
}
function file(dir: string, name: string, body = "x"): string {
  const target = path.join(dir, name);
  fs.writeFileSync(target, body);
  return target;
}

describe("평가 근거", () => {
  it("판 · 평가별 폴더에 근거와 첨부를 두고, 다시 붙이면 같은 이름만 바꾼다", async () => {
    const studio = home();
    const src = home();
    const first = await writeEvalEvidence(studio, "demo", { evalId: "E1", irVersion: 3, how: "눌러 봄", observed: "열림", files: [file(src, "a.png"), file(src, "out.txt")], screen: "test" });
    expect(first.ok).toBe(true);
    expect(fs.existsSync(path.join(evalEvidenceDir(studio, "demo", 3, "E1"), "a.png"))).toBe(true);

    const second = await writeEvalEvidence(studio, "demo", { evalId: "E1", irVersion: 3, files: [file(src, "a.png", "y"), file(src, "b.png")] });
    expect(second.ok && second.evidence).toMatchObject({ how: "눌러 봄", observed: "열림", screen: "test", files: ["out.txt", "a.png", "b.png"] });

    const all = await readEvalEvidence(studio, "demo", 3);
    expect(Object.keys(all)).toEqual(["E1"]);
    expect(await readEvalEvidence(studio, "demo", 4)).toEqual({});
  });

  it("목록에 없는 이름 · 경로를 벗어나는 이름은 내주지 않는다", async () => {
    const studio = home();
    await writeEvalEvidence(studio, "demo", { evalId: "E1", irVersion: 1, files: [file(home(), "a.png")] });
    expect(await evalEvidenceFilePath(studio, "demo", 1, "E1", "a.png")).toMatch(/a\.png$/);
    expect(await evalEvidenceFilePath(studio, "demo", 1, "E1", "evidence.json")).toBeNull();
    expect(await evalEvidenceFilePath(studio, "demo", 1, "E1", "../../../overlay.yaml")).toBeNull();
    expect(await evalEvidenceFilePath(studio, "demo", 1, "..", "a.png")).toBeNull();
  });

  it("붙일 수 없는 형식 · 경로가 들어간 평가 id는 거절한다", async () => {
    const studio = home();
    expect((await writeEvalEvidence(studio, "demo", { evalId: "E1", irVersion: 1, files: [file(home(), "page.html")] })).ok).toBe(false);
    expect((await writeEvalEvidence(studio, "demo", { evalId: "../x", irVersion: 1 })).ok).toBe(false);
  });
});
