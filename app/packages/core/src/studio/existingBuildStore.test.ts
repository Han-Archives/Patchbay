import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { registerProject, writeStudio } from "./studioStore.js";
import { PROPOSED_IR_FILE_NAME, adoptIr } from "./irStore.js";
import { readOverlay } from "./projectFiles.js";
import { parseIr } from "../types/ir.js";
import {
  chooseExistingBuild,
  readExistingBuild,
  recordExistingResults,
  setExistingLink,
  summarizeExistingBuild,
  writeExistingLink,
} from "./existingBuildStore.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../ir/__fixtures__");
const ALIAS = "demo";
let studioHome: string;
let repo: string;

async function adopted() {
  const parsed = parseIr((await readOverlay(studioHome, ALIAS)).ir);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.ir;
}

beforeEach(async () => {
  studioHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-existing-"));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-existing-repo-"));
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(path.join(repo, "src", "pick.test.ts"), "");
  await fs.writeFile(path.join(repo, "src", "pick.ts"), "");
  await writeStudio(studioHome, { name: "Test", projects: [] });
  await registerProject(studioHome, { alias: ALIAS, kind: "local_repo", path: repo });
  const dir = path.join(studioHome, "projects", ALIAS);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, PROPOSED_IR_FILE_NAME), await fs.readFile(path.join(FIXTURES, "valid.ir.yaml"), "utf8"));
  const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
  if (!result.ok) throw new Error(result.error);
});

describe("이미 구현됨 길", () => {
  it("고르기 전에는 없고, 고르면 빈 연결로 생긴다 — 다시 골라도 그대로", async () => {
    expect(await readExistingBuild(studioHome, ALIAS)).toBeNull();
    const first = await chooseExistingBuild(studioHome, ALIAS, new Date("2026-10-20T00:00:00Z"));
    await chooseExistingBuild(studioHome, ALIAS, new Date("2026-10-21T00:00:00Z"));
    expect(await readExistingBuild(studioHome, ALIAS)).toEqual(first);
    expect(first.links).toEqual([]);
  });

  it("고르지 않은 프로젝트에는 연결을 넣지 못한다", async () => {
    await expect(writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "src/pick.test.ts", by: "person" })).rejects.toThrow("고르지 않았다");
  });

  it("승인본에 없는 요구사항 · 없는 파일 · 폴더 밖 경로는 거절한다", async () => {
    await chooseExistingBuild(studioHome, ALIAS);
    await expect(writeExistingLink(studioHome, ALIAS, { requirement: "R99", file: "src/pick.test.ts", by: "agent" })).rejects.toThrow("승인본에 없다");
    await expect(writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "src/none.test.ts", by: "agent" })).rejects.toThrow("프로젝트에 없다");
    await expect(writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "../x.test.ts", by: "agent" })).rejects.toThrow("상대 경로");
  });

  it("에이전트가 넣으면 제안, 사람이 확인하면 확인 — 에이전트가 다시 넣어도 내려가지 않는다", async () => {
    await chooseExistingBuild(studioHome, ALIAS);
    const link = await writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "./src/pick.test.ts", test: "pick > 고른다", code: "src/pick.ts", by: "agent" });
    expect(link).toMatchObject({ file: "src/pick.test.ts", state: "proposed", by: "agent" });
    await setExistingLink(studioHome, ALIAS, link.id, "confirm");
    await writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "src/pick.test.ts", test: "pick > 고른다", by: "agent" });
    const build = await readExistingBuild(studioHome, ALIAS);
    expect(build?.links).toHaveLength(1);
    expect(build?.links[0]?.state).toBe("confirmed");
    await setExistingLink(studioHome, ALIAS, link.id, "remove");
    expect((await readExistingBuild(studioHome, ALIAS))?.links).toEqual([]);
  });

  it("요약 — 제안은 세지 않고, 확인된 연결이 모두 통과해야 요구사항 통과", async () => {
    await chooseExistingBuild(studioHome, ALIAS);
    const a = await writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "src/pick.test.ts", test: "a", by: "person" });
    const b = await writeExistingLink(studioHome, ALIAS, { requirement: "R1", file: "src/pick.test.ts", test: "b", by: "person" });
    await writeExistingLink(studioHome, ALIAS, { requirement: "R2", file: "src/pick.test.ts", by: "agent" });
    const ir = await adopted();

    let summary = summarizeExistingBuild(ir, (await readExistingBuild(studioHome, ALIAS))!);
    expect(summary).toMatchObject({ total: ir.requirements.length, linked: 1, passed: 0, proposed: 1 });
    expect(summary.requirements.find((r) => r.id === "R1")?.state).toBe("untested");
    expect(summary.requirements.find((r) => r.id === "R2")?.state).toBe("unlinked");

    await recordExistingResults(studioHome, ALIAS, [{ id: a.id, state: "pass" }, { id: b.id, state: "fail", note: "기대와 다름" }]);
    summary = summarizeExistingBuild(ir, (await readExistingBuild(studioHome, ALIAS))!);
    expect(summary.requirements.find((r) => r.id === "R1")?.state).toBe("fail");

    await recordExistingResults(studioHome, ALIAS, [{ id: b.id, state: "pass" }]);
    const build = (await readExistingBuild(studioHome, ALIAS))!;
    summary = summarizeExistingBuild(ir, build);
    expect(summary.requirements.find((r) => r.id === "R1")).toMatchObject({ state: "pass", nodes: ["pick"] });
    expect(summary.passed).toBe(1);
    expect(summary.nodes.pick).toEqual({ total: ir.requirementLinks.filter((row) => row.node === "pick").map((row) => row.requirement).filter((id, i, all) => all.indexOf(id) === i).length, passed: 1 });
    expect(build.ranAt).not.toBeNull();
  });
});
