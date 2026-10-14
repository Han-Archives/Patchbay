import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SCAFFOLD_DIR, adoptIr, ensureStudioInitialized, registerProject } from "@patchbay/core";
import { beforeEach, describe, expect, it } from "vitest";
import { generateScaffoldView, loadBuildView } from "./buildView.js";

/**
 * 2단계 입구의 두 가지 일: **채택 전에는 1 설계로 돌려보내고, 채택 뒤에는 화면에서
 * 뼈대를 만든다.** 커널의 생성기 시험과 같은 고정 자료를 쓴다 — 화면과 CLI가 다른 답을
 * 내면 사람은 어디를 봐야 할지 모른다.
 */

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/core/src/ir/__fixtures__",
);
const ALIAS = "demo";
let studioHome: string;
let repo: string;

/** 고정 자료의 IR은 `guides/**` 를 문서로 가리킨다 — 레포에 그 파일이 있어야 1.6이 통과한다. */
async function seedRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-build-repo-"));
  await fs.cp(path.join(FIXTURES, "guides"), path.join(dir, "guides"), { recursive: true });
  return dir;
}

async function seedAdopted(): Promise<void> {
  const text = await fs.readFile(path.join(FIXTURES, "valid.ir.yaml"), "utf8");
  const dir = path.join(studioHome, "projects", ALIAS);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ir.proposed.yaml"), text, "utf8");
  const adopted = await adoptIr(studioHome, ALIAS, { docRoot: repo });
  if (!adopted.ok) throw new Error(adopted.error);
}

async function scaffoldFiles(): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(repo, DEFAULT_SCAFFOLD_DIR))).sort();
  } catch {
    return [];
  }
}

beforeEach(async () => {
  studioHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-build-view-"));
  repo = await seedRepo();
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias: ALIAS, kind: "local_repo", path: repo });
});

describe("loadBuildView", () => {
  it("alias가 없으면 400, 등록되지 않은 프로젝트면 404", async () => {
    expect(await loadBuildView(studioHome, undefined)).toMatchObject({ ok: false, status: 400 });
    expect(await loadBuildView(studioHome, "nope")).toMatchObject({ ok: false, status: 404 });
  });

  it("채택 전에는 잠겼다고 답한다 — 오류가 아니다", async () => {
    const result = await loadBuildView(studioHome, ALIAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.status).toBe("locked");
    if (result.body.status !== "locked") return;
    expect(result.body.next).toContain("1 설계");
  });

  it("채택 뒤에는 세 파일이 아직 없고, 노드는 승인본 쪽만 있다", async () => {
    await seedAdopted();
    const result = await loadBuildView(studioHome, ALIAS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.body.status !== "ready") throw new Error("ready가 아니다");
    expect(result.body.version).toBe(1);
    expect(result.body.generated).toBe(false);
    expect(result.body.files.map((file) => file.file).sort()).toEqual([
      "evals.test.ts",
      "graph.ts",
      "state.ts",
    ]);
    expect(result.body.files.every((file) => !file.exists)).toBe(true);
    // 「아직 없다」와 「어긋난다」는 다른 말이다 — graph 가 비어 있다.
    expect(result.body.nodes.graph).toEqual([]);
    expect(result.body.nodes.ir).toEqual(["intake", "classify", "explain", "pick"]);
  });
});

describe("generateScaffoldView", () => {
  it("채택되지 않았으면 409 — 2단계는 1단계의 산출물만 먹는다", async () => {
    const result = await generateScaffoldView(studioHome, { alias: ALIAS });
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (result.ok) return;
    expect(result.error).toContain("채택");
    expect(await scaffoldFiles()).toEqual([]);
  });

  it("alias가 없으면 400, 등록되지 않은 프로젝트면 404", async () => {
    expect(await generateScaffoldView(studioHome, {})).toMatchObject({ ok: false, status: 400 });
    expect(await generateScaffoldView(studioHome, { alias: "nope" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("세 파일을 쓰고, 두 번째는 사람 수정을 덮지 않는다", async () => {
    await seedAdopted();
    const first = await generateScaffoldView(studioHome, { alias: ALIAS });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.body.written?.slice().sort()).toEqual(["evals.test.ts", "graph.ts", "state.ts"]);
    expect(first.body.outDir).toBe(DEFAULT_SCAFFOLD_DIR);
    expect(await scaffoldFiles()).toEqual(["evals.test.ts", "graph.ts", "state.ts"]);

    const graphPath = path.join(repo, DEFAULT_SCAFFOLD_DIR, "graph.ts");
    const kept = `${await fs.readFile(graphPath, "utf8")}\n// 사람이 쓴 줄\n`;
    await fs.writeFile(graphPath, kept, "utf8");

    const second = await generateScaffoldView(studioHome, { alias: ALIAS });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.body.written).toEqual([]);
    expect(second.body.skipped?.slice().sort()).toEqual(["evals.test.ts", "graph.ts", "state.ts"]);
    expect(await fs.readFile(graphPath, "utf8")).toBe(kept);
  });

  it("생성 뒤에는 화면이 노드 집합이 맞는다고 말한다 (2.6)", async () => {
    await seedAdopted();
    expect((await generateScaffoldView(studioHome, { alias: ALIAS })).ok).toBe(true);
    const result = await loadBuildView(studioHome, ALIAS);
    if (!result.ok || result.body.status !== "ready") throw new Error("ready가 아니다");
    expect(result.body.generated).toBe(true);
    expect(result.body.nodes.match).toBe(true);
    expect(result.body.nodes.graph).toEqual(result.body.nodes.ir);
  });
});
