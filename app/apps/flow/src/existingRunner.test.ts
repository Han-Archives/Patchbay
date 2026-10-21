import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROPOSED_IR_FILE_NAME, adoptIr, registerProject, writeStudio, type ExistingLink } from "@patchbay/core";
import { rowsFromReport, vitestRootFor } from "./existingRunner.js";
import { existingBuildAction, loadBuildView } from "./buildView.js";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES = path.join(APP, "packages/core/src/ir/__fixtures__");

const link = (id: string, file: string, test = ""): ExistingLink => ({ id, requirement: "R1", file, test, state: "confirmed", by: "person", at: "2026-10-20T00:00:00.000Z" });

describe("rowsFromReport", () => {
  const project = "/repo";
  const report = {
    testResults: [
      {
        name: "/repo/app/a.test.ts",
        status: "failed",
        assertionResults: [
          { ancestorTitles: ["레일"], title: "프로젝트를 고르면 바뀐다", status: "passed" },
          { ancestorTitles: ["레일", "이름"], title: "고치면 폴더도 바뀐다", status: "failed" },
          { ancestorTitles: ["개요"], title: "없으면 초안", status: "skipped" },
        ],
      },
    ],
  };

  it("이름이 같거나 그 아래인 테스트가 모두 통과해야 통과 — 하나라도 실패면 실패", () => {
    const rows = rowsFromReport(
      [link("a", "app/a.test.ts", "레일 > 프로젝트를 고르면 바뀐다"), link("b", "app/a.test.ts", "레일"), link("c", "app/a.test.ts")],
      report,
      "/repo/app",
      project,
    );
    expect(rows[0]).toEqual({ id: "a", state: "pass" });
    expect(rows[1]).toMatchObject({ id: "b", state: "fail", note: "실패 1/2: 레일 > 이름 > 고치면 폴더도 바뀐다" });
    expect(rows[2]).toMatchObject({ id: "c", state: "fail" });
  });

  it("없는 이름 · 돌지 않은 파일 · 건너뛴 테스트는 못 찾음 — 통과로 치지 않는다", () => {
    const rows = rowsFromReport(
      [link("a", "app/a.test.ts", "레일 > 없는 테스트"), link("b", "app/b.test.ts"), link("c", "app/a.test.ts", "개요")],
      report,
      "/repo/app",
      project,
    );
    expect(rows.map((row) => row.state)).toEqual(["missing", "missing", "missing"]);
    expect(rows[2]!.note).toContain("skipped");
  });
});

describe("이미 구현됨 — 고르기 · 잇기 · 실제 vitest 실행", () => {
  it("고르면 /api/build 가 existing 으로 바뀌고, 이은 테스트를 그 프로젝트의 vitest로 돌려 결과를 남긴다", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-existing-home-"));
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "pb-existing-repo-"));
    await fs.symlink(path.join(APP, "node_modules"), path.join(repo, "node_modules"));
    await fs.mkdir(path.join(repo, "src"));
    await fs.writeFile(
      path.join(repo, "src", "pick.test.ts"),
      `import { describe, expect, it } from "vitest";\ndescribe("pick", () => {\n  it("고른다", () => expect(1).toBe(1));\n  it("틀린다", () => expect(1).toBe(2));\n});\n`,
    );
    await writeStudio(home, { name: "Test", projects: [] });
    await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
    await fs.mkdir(path.join(home, "projects", "demo"), { recursive: true });
    await fs.writeFile(path.join(home, "projects", "demo", PROPOSED_IR_FILE_NAME), await fs.readFile(path.join(FIXTURES, "valid.ir.yaml"), "utf8"));
    const adopted = await adoptIr(home, "demo", { docRoot: FIXTURES });
    expect(adopted.ok).toBe(true);

    expect((await loadBuildView(home, "demo")).ok && (await loadBuildView(home, "demo") as { body: { status: string } }).body.status).toBe("ready");
    expect((await existingBuildAction(home, { alias: "demo", action: "choose" })).status).toBe(200);
    expect(await vitestRootFor(repo, "src/pick.test.ts")).toBe(path.resolve(repo));

    await existingBuildAction(home, { alias: "demo", action: "link", requirement: "R1", file: "src/pick.test.ts", test: "pick > 고른다" });
    await existingBuildAction(home, { alias: "demo", action: "link", requirement: "R2", file: "src/pick.test.ts", test: "pick > 틀린다" });
    const ran = await existingBuildAction(home, { alias: "demo", action: "run" });
    expect(ran.status).toBe(200);
    if (!ran.body.ok) throw new Error(ran.body.error);
    const state = (id: string) => ran.body.ok && ran.body.view.summary.requirements.find((req) => req.id === id)?.state;
    expect(state("R1")).toBe("pass");
    expect(state("R2")).toBe("fail");
    expect(ran.body.view.ranAt).not.toBeNull();
  }, 60_000);

  it("채택 전에는 고를 수 없다", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-existing-home-"));
    await writeStudio(home, { name: "Test", projects: [] });
    await registerProject(home, { alias: "demo", kind: "local_repo", path: home });
    expect(await existingBuildAction(home, { alias: "demo", action: "choose" })).toMatchObject({ status: 409 });
  });
});
