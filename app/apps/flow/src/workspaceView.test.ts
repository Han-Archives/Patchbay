import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adoptIr,
  ensureStudioInitialized,
  registerProject,
  writeInferred,
  writeProgressEntry,
  recordPassedNodes,
  writeRunRecord,
} from "@patchbay/core";
import { beforeEach, describe, expect, it } from "vitest";
import { startDraftView } from "./irView.js";
import { attentionOf, currentStage, projectInitials, stagesOf, type ProjectFacts } from "./workspaceContract.js";
import { loadWorkspace } from "./workspaceView.js";

/**
 * 작업 공간 레일이 프로젝트마다 「지금 어디 서 있나」를 한 줄로 말한다.
 * 그 한 줄이 설계 화면 · CLI와 다른 말을 하면 레일을 믿을 수 없다.
 */

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/core/src/ir/__fixtures__",
);

const NONE: ProjectFacts = {
  scan: { ports: 3 },
  adopted: null,
  adoptedBroken: false,
  draft: null,
  scaffold: false,
  runs: 0,
};

/** 등록만 한 프로젝트는 스캔 전이다 — 화면 등록 · CLI `project add` 는 둘 다 스캔까지 한다. */
async function markScanned(home: string, alias: string): Promise<void> {
  await writeInferred(home, alias, { discoveredPorts: ["source:README.md"], portLevels: {}, git: { branch: "", head: "" }, agents: [] } as never);
}

const tones = (facts: ProjectFacts) => stagesOf(facts).map((stage) => `${stage.id}:${stage.tone}`);

describe("stagesOf", () => {
  it("띠는 0 대시보드 · 1 설계 · 2 구현 · 3 테스트 · 4 지식 그래프 · 5 문서 호출 (사용자 결정 2026-10-08)", () => {
    expect(stagesOf(NONE).map((stage) => stage.id)).toEqual(["dashboard", "design", "build", "test", "graph", "docs"]);
  });

  it("스캔했고 설계가 없으면 1 설계에 서 있고 뒤는 잠긴다", () => {
    expect(tones(NONE)).toEqual([
      "dashboard:done",
      "design:now",
      "build:locked",
      "test:locked",
      "graph:locked",
      "docs:locked",
    ]);
    expect(stagesOf(NONE)[0]!.status).toBe("스캔됨 · 항목 3");
    expect(stagesOf(NONE)[1]!.status).toBe("시작 전");
    expect(currentStage(stagesOf(NONE))).toBe("design");
  });

  it("검사를 다 통과한 초안은 채택 대기 — 채택 전에는 2 구현이 열리지 않는다", () => {
    const facts = { ...NONE, draft: { readable: true as const, passed: 26, total: 26, failedGates: [] } };
    expect(tones(facts).slice(1, 3)).toEqual(["design:now", "build:locked"]);
    expect(stagesOf(facts)[1]!.status).toBe("검사 26 / 26 통과 · 채택 대기");
  });

  it("막힌 초안은 돌아갈 Phase를 말한다 — 칸 번호가 아니라 화면의 이름으로", () => {
    const facts = { ...NONE, draft: { readable: true as const, passed: 20, total: 26, failedGates: ["1.2", "1.9"] } };
    const design = stagesOf(facts)[1]!;
    expect(design.tone).toBe("blocked");
    expect(design.detail).toBe("돌아갈 곳: Phase 3 · 최종 검사");
  });

  it("다 적었는데 IR로 안 읽히면 적는 중이 아니라 막힌 것이다", () => {
    const writing = { ...NONE, draft: { readable: false as const, complete: 4, total: 9, error: "x" } };
    expect(stagesOf(writing)[1]).toMatchObject({ tone: "now", status: "초안 작성 중 · Phase 4 / 9 다 적음" });
    const stuck = { ...NONE, draft: { readable: false as const, complete: 9, total: 9, error: "schemaVersion이 없다." } };
    expect(stagesOf(stuck)[1]).toMatchObject({ tone: "blocked", detail: "schemaVersion이 없다." });
  });

  it("채택하면 2 구현 · 뼈대만으로는 지남이 아니다 — 빈 노드를 다 채워야 3 테스트가 열린다", () => {
    const adopted = { ...NONE, adopted: { version: 1 }, nodes: { total: 9, passed: 0 } };
    expect(tones(adopted).slice(1)).toEqual(["design:done", "build:now", "test:locked", "graph:locked", "docs:locked"]);
    const scaffolded = { ...adopted, scaffold: true, filled: { total: 9, empty: 9 } };
    expect(stagesOf(scaffolded)[2]).toMatchObject({ tone: "now", status: "노드 채우는 중 · 0/9" });
    expect(tones(scaffolded)[3]).toBe("test:locked");
    const filled = { ...scaffolded, filled: { total: 9, empty: 0 } };
    expect(stagesOf(filled)[2]).toMatchObject({ tone: "done", status: "노드 9/9 채움" });
    expect(tones(filled).slice(3)).toEqual(["test:now", "graph:locked", "docs:locked"]);
    expect(currentStage(stagesOf(filled))).toBe("test");
  });

  it("4 지식 그래프 · 5 문서 호출은 설계의 노드를 모두 한 번 이상 지난 뒤에 열린다 (사용자 결정 2026-10-08)", () => {
    const base = { ...NONE, adopted: { version: 2 }, scaffold: true, filled: { total: 9, empty: 0 } };
    const some = { ...base, nodes: { total: 9, passed: 6 } };
    expect(stagesOf(some)[3]).toMatchObject({ tone: "now", status: "노드 6/9 지남" });
    expect(stagesOf(some)[4]).toMatchObject({ tone: "locked", status: "노드 6/9 지난 뒤" });
    const all = { ...base, nodes: { total: 9, passed: 9 } };
    expect(tones(all).slice(3)).toEqual(["test:done", "graph:now", "docs:now"]);
    expect(currentStage(stagesOf(all))).toBe("graph");
  });

  it("실행 기록은 설계 없이도 보인다 — 들어온 것을 숨기지 않는다", () => {
    expect(stagesOf({ ...NONE, runs: 3 })[3]).toMatchObject({ tone: "now", status: "노드 정보 없음 · 실행 기록 3건" });
  });

  it("스캔 전이면 0 대시보드에 서 있다 — 그래도 1 설계는 잠그지 않는다 (IR은 스캔을 먹지 않는다)", () => {
    const unscanned = { ...NONE, scan: null };
    expect(tones(unscanned).slice(0, 2)).toEqual(["dashboard:now", "design:now"]);
    expect(currentStage(stagesOf(unscanned))).toBe("dashboard");
    expect(stagesOf({ ...NONE, scan: "broken" })[0]).toMatchObject({ tone: "blocked", status: "스캔 결과가 깨졌다" });
  });
});

describe("attentionOf", () => {
  it("시작 전 프로젝트에는 점이 없다 — 일곱 개 모두에 점이 붙으면 점이 아무것도 말하지 않는다", () => {
    expect(attentionOf(stagesOf(NONE))).toBeNull();
  });

  it("막힌 칸이 있을 때만 막힘 — 손을 댄 프로젝트라도 실행 중처럼 보이는 점을 찍지 않는다", () => {
    const writing = { ...NONE, draft: { readable: false as const, complete: 4, total: 9, error: "x" } };
    expect(attentionOf(stagesOf(writing))).toBeNull();
    expect(attentionOf(stagesOf({ ...NONE, adopted: { version: 1 } }))).toBeNull();
    const finished = { ...NONE, adopted: { version: 3 }, scaffold: true, filled: { total: 9, empty: 0 }, nodes: { total: 9, passed: 9 } };
    expect(attentionOf(stagesOf(finished))).toBeNull(); // 테스트까지 지난 프로젝트 — 2026-10-15 실행 중처럼 보이던 경우
    const failing = { ...NONE, draft: { readable: true as const, passed: 20, total: 26, failedGates: ["1.2"] } };
    expect(attentionOf(stagesOf(failing))).toBe("blocked");
  });
});

describe("projectInitials", () => {
  it("이름이나 낱말 수에 관계없이 첫 글자만 표시한다", () => {
    expect(projectInitials("shop-app")).toBe("s");
    expect(projectInitials("shop-rag")).toBe("s");
    expect(projectInitials("영어 공부")).toBe("영");
    expect(projectInitials("Data Pipeline 실습")).toBe("D");
    expect(projectInitials("practice")).toBe("p");
  });

  it("앞뒤 공백과 빈 이름, 결합된 문자를 처리한다", () => {
    expect(projectInitials("  영어 공부  ")).toBe("영");
    expect(projectInitials("")).toBe("?");
    expect(projectInitials("   ")).toBe("?");
    expect(projectInitials("👩‍💻 개발")).toBe("👩‍💻");
  });
});

describe("loadWorkspace", () => {
  let home: string;
  let repo: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-workspace-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-workspace-repo-"));
    await ensureStudioInitialized(home);
  });

  it("등록된 프로젝트마다 단계와 최근 진행을 준다", async () => {
    await registerProject(home, { alias: "empty", kind: "local_repo", path: repo });
    await markScanned(home, "empty");
    await writeProgressEntry(home, "empty", { summary: "구조 초안 작성", step: "done" });
    const body = await loadWorkspace(home);
    expect(body.projects).toHaveLength(1);
    const project = body.projects[0]!;
    expect(project.current).toBe("design");
    expect(project.stages[0]!.status).toBe("스캔됨 · 항목 1");
    expect(project.stages[1]!.status).toBe("시작 전");
    expect(project.attention).toBeNull();
    expect(project.latest).toMatchObject({ summary: "구조 초안 작성", step: "done" });
  });

  it("막 시작한 초안은 0 / 9 다 적음으로 읽힌다", async () => {
    await registerProject(home, { alias: "draft", kind: "local_repo", path: repo });
    await startDraftView(home, { alias: "draft" });
    const project = (await loadWorkspace(home)).projects[0]!;
    expect(project.stages[0]).toMatchObject({ tone: "now", status: "스캔 전" });
    expect(project.current).toBe("dashboard");
    expect(project.stages[1]).toMatchObject({ tone: "now", status: "초안 작성 중 · Phase 0 / 10 다 적음" });
  });

  it("고정 자료 초안은 설계 화면과 같이 통과 · 채택 대기, 채택하면 구현으로 넘어간다", async () => {
    await registerProject(home, { alias: "demo", kind: "local_repo", path: FIXTURES });
    await markScanned(home, "demo");
    const dir = path.join(home, "projects", "demo");
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(path.join(FIXTURES, "valid.ir.yaml"), path.join(dir, "ir.proposed.yaml"));

    const before = (await loadWorkspace(home)).projects[0]!;
    expect(before.stages[1]!.tone).toBe("now");
    expect(before.stages[1]!.status).toMatch(/^검사 (\d+) \/ \1 통과 · 채택 대기$/);

    const adopted = await adoptIr(home, "demo", { docRoot: FIXTURES });
    expect(adopted.ok).toBe(true);
    const after = (await loadWorkspace(home)).projects[0]!;
    expect(after.stages[1]!.tone).toBe("done");
    expect(after.current).toBe("build");
  });

  it("뼈대 파일과 실행 기록을 프로젝트 파일에서 센다", async () => {
    await registerProject(home, { alias: "built", kind: "local_repo", path: repo });
    await fs.mkdir(path.join(repo, "src", "agent"), { recursive: true });
    await fs.writeFile(path.join(repo, "src", "agent", "graph.ts"), "// 사람이 고친 파일\n", "utf8");
    const run = JSON.parse(await fs.readFile(path.resolve(FIXTURES, "../../runs/__fixtures__/success.json"), "utf8"));
    await writeRunRecord(home, "built", run);
    const project = (await loadWorkspace(home)).projects[0]!;
    expect(project.stages[3]).toMatchObject({ tone: "now", status: "노드 정보 없음 · 실행 기록 1건" });
  });

  it("빈 노드 표시를 graph.ts 에서 세고, 테스트에서 일한 노드를 test/passed-nodes.json 에서 센다", async () => {
    await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
    await markScanned(home, "demo");
    const dir = path.join(home, "projects", "demo");
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(path.join(FIXTURES, "valid.ir.yaml"), path.join(dir, "ir.proposed.yaml"));
    await adoptIr(home, "demo", { docRoot: FIXTURES });
    await fs.mkdir(path.join(repo, "src", "agent"), { recursive: true });
    const stub = (id: string) => `throw new Error("${id}: 노드 내부는 아직 비어 있다 (2.4)");\n`;
    await fs.writeFile(path.join(repo, "src", "agent", "graph.ts"), stub("intake") + stub("classify"), "utf8");
    let project = (await loadWorkspace(home)).projects[0]!;
    expect(project.stages[2]).toMatchObject({ tone: "now", status: "노드 채우는 중 · 2/4" });

    await fs.writeFile(path.join(repo, "src", "agent", "graph.ts"), "// 다 채움\n", "utf8");
    await recordPassedNodes(home, "demo", [{ node: "intake", at: "2026-10-08T00:00:00Z" }, { node: "ghost", at: "2026-10-08T00:00:00Z" }]);
    project = (await loadWorkspace(home)).projects[0]!;
    expect(project.stages[2]).toMatchObject({ tone: "done", status: "노드 4/4 채움" });
    expect(project.stages[3]).toMatchObject({ tone: "now", status: "노드 1/4 지남" }); // 설계에 없는 노드는 세지 않는다
    expect(project.stages[4]!.tone).toBe("locked");
  });
});
