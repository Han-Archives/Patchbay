import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { afterEach, describe, expect, it } from "vitest";
import { readOverviewDoc } from "./overviewView.js";

const roots: string[] = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-overview-"));
  roots.push(root);
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  await fs.mkdir(path.join(repo, "records"), { recursive: true });
  await registerProject(home, { alias: "demo", kind: "local_repo", path: repo, docs: "records" });
  return { home, repo };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("개요 문서 우선·6개 섹션 대체", () => {
  it("등록부의 문서 폴더에 있는 개요.md를 읽는다", async () => {
    const { home, repo } = await fixture();
    await fs.writeFile(path.join(repo, "records", "개요.md"), "# 프로젝트 개요\n\n## 목적과 대상\n본문\n");

    await expect(readOverviewDoc(home, "demo")).resolves.toEqual({
      ok: true,
      rel: "records/개요.md",
      content: "# 프로젝트 개요\n\n## 목적과 대상\n본문\n",
    });
  });

  it("개요.md가 없으면 화면이 설계 초안으로 대체할 수 있게 404를 돌려준다", async () => {
    const { home } = await fixture();
    await expect(readOverviewDoc(home, "demo")).resolves.toMatchObject({ ok: false, status: 404 });
  });
});
