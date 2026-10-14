import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, readStudio } from "@patchbay/core";
import { beforeEach, describe, expect, it } from "vitest";
import { addProjectView } from "./projectAddView.js";

describe("addProjectView", () => {
  let home: string;
  let repo: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-add-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-add-repo-"));
    await ensureStudioInitialized(home);
    await fs.writeFile(path.join(repo, "README.md"), "# demo\n", "utf8");
  });

  it("경로가 없으면 400", async () => {
    const result = await addProjectView(home, {});
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("폴더가 아니면 400", async () => {
    const result = await addProjectView(home, { path: path.join(repo, "nope") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("등록하고 스캔 산출물을 남긴다", async () => {
    const result = await addProjectView(home, { path: repo, alias: "demo", forceAdd: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.alias).toBe("demo");
    const studio = await readStudio(home);
    expect(studio.projects.map((p) => p.alias)).toEqual(["demo"]);
    await expect(fs.access(path.join(home, "projects", "demo", "ATLAS.md"))).resolves.toBeUndefined();
  });

  it("같은 이름은 409", async () => {
    await addProjectView(home, { path: repo, alias: "demo", forceAdd: true });
    const again = await addProjectView(home, { path: repo, alias: "demo", forceAdd: true });
    expect(again).toMatchObject({ ok: false, status: 409 });
  });
});
