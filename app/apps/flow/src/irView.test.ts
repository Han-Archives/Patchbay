import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adoptIr, ensureStudioInitialized, loadPrd, markPrdSection, projectStudioDir, readOverlay, registerProject } from "@patchbay/core";
import { beforeEach, describe, expect, it } from "vitest";
import { adoptIrView, loadIrView } from "./irView.js";
import { isIrViewReady, phaseOf } from "./irContract.js";

/**
 * The 설계 segment's two jobs: show which cell is blocked, and refuse to adopt
 * a design that has not passed. Both are checked against the same fixtures the
 * kernel's DRC tests use -- the screen and the CLI must agree, or a person gets
 * a different answer depending on where they look.
 */

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/core/src/ir/__fixtures__",
);
const ALIAS = "demo";
let studioHome: string;

async function seedProposed(mutate?: (text: string) => string): Promise<void> {
  const text = await fs.readFile(path.join(FIXTURES, "valid.ir.yaml"), "utf8");
  const dir = path.join(studioHome, "projects", ALIAS);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ir.proposed.yaml"), mutate ? mutate(text) : text, "utf8");
}

beforeEach(async () => {
  studioHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-ir-view-"));
  await ensureStudioInitialized(studioHome);
  // 문서 경로는 프로젝트 레포 기준이라, 고정 자료 폴더를 레포로 등록한다.
  await registerProject(studioHome, { alias: ALIAS, kind: "local_repo", path: FIXTURES });
});

describe("loadIrView", () => {
  it("alias가 없으면 400, 등록되지 않은 프로젝트면 404", async () => {
    const noAlias = await loadIrView(studioHome, undefined);
    expect(noAlias).toMatchObject({ ok: false, status: 400 });
    const unknown = await loadIrView(studioHome, "nope");
    expect(unknown).toMatchObject({ ok: false, status: 404 });
  });

  it("IR도 초안도 없으면 1단계 미착수라고 답한다", async () => {
    const result = await loadIrView(studioHome, ALIAS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.status).toBe("missing");
  });

  it("초안이 있으면 초안을 먼저 보여 주고, 열 칸이 전부 통과로 뜬다", async () => {
    await seedProposed();
    const result = await loadIrView(studioHome, ALIAS);
    expect(result.ok).toBe(true);
    if (!result.ok || !isIrViewReady(result.body)) throw new Error("ready 여야 한다");
    expect(result.body.source).toBe("proposed");
    expect(result.body.passed).toBe(true);
    expect(result.body.gates).toHaveLength(11);
    expect(result.body.gates.every((gate) => gate.status === "pass")).toBe(true);
    expect(result.body.canAdopt).toBe(true);
  });

  it("막힌 칸은 fail, 그 때문에 무효가 된 칸은 invalid — 둘은 다른 일을 요구한다", async () => {
    await seedProposed((text) => text.replace(/^models:\n(?:  .*\n)+/m, "models: []\n"));
    const result = await loadIrView(studioHome, ALIAS);
    if (!result.ok || !isIrViewReady(result.body)) throw new Error("ready 여야 한다");
    const byId = new Map(result.body.gates.map((gate) => [gate.id, gate]));
    expect(byId.get("1.2")?.status).toBe("fail");
    expect(byId.get("1.2")?.failed).toContain("1.2/model-declared");
    expect(byId.get("1.5")?.status).toBe("invalid");
    expect(byId.get("1.6")?.status).toBe("invalid");
    expect(byId.get("1.9")?.status).toBe("fail");
    // 승인 전 초안이 현재 IR을 덮지 않는다 — 채택 자체가 막힌다.
    expect(result.body.canAdopt).toBe(false);
    expect(result.body.adoptBlockedBy).toContain("1.2");
    // 막힌 Phase를 판정 화면에서 바로 고칠 수 있게 칸 기술이 같이 온다.
    expect(Object.keys(result.body.fields)).toHaveLength(10);
  });

  /** 화면은 칸을 Phase 1~9 로 부른다. 1.9는 Phase가 아니라 최종 검사다. */
  it("명세 칸 1.0~1.8 이 Phase 1~9 와 1:1이다", () => {
    expect(["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"].map(phaseOf)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(phaseOf("1.9")).toBeNull();
    expect(phaseOf("2.0")).toBeNull();
  });

  /**
   * 초안이 아직 IR로 안 읽히는 것은 **1단계 중의 정상 상태**다 — 열 칸을 채우는 동안
   * 계속 그렇다. 그래서 오류만 던지지 않고 어디까지 왔는지를 함께 준다. 이유는
   * 지우지 않고 함께 싣는다: 형식이 깨진 것과 아직 안 채운 것은 다른 일이다.
   */
  it("초안이 아직 IR이 아니면 어디까지 왔는지를 함께 말한다", async () => {
    await seedProposed((text) => text.replace("schemaVersion: 3", "schemaVersion: 9"));
    const result = await loadIrView(studioHome, ALIAS);
    if (!result.ok) throw new Error("ok 여야 한다");
    expect(result.body.status).toBe("drafting");
    if (result.body.status !== "drafting") throw new Error("drafting 이어야 한다");
    expect(result.body.error).toContain("schemaVersion 9");
    // 다 적힌 초안이므로 0.0과 아홉 칸이 다 차 있다 — 막힌 것은 형식 하나다.
    expect(result.body.progress.answered).toBe(10);
  });

  /** 승인된 IR이 안 읽히는 것은 다른 일이다 — 통과했던 것이 깨진 것이다. */
  it("승인된 IR이 깨지면 그건 broken 으로 말한다", async () => {
    await seedProposed();
    await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    const overlayPath = path.join(projectStudioDir(studioHome, ALIAS), "overlay.yaml");
    const overlayText = await fs.readFile(overlayPath, "utf8");
    await fs.writeFile(overlayPath, overlayText.replace("schemaVersion: 3", "schemaVersion: 9"), "utf8");
    const result = await loadIrView(studioHome, ALIAS, "current");
    if (!result.ok) throw new Error("ok 여야 한다");
    expect(result.body.status).toBe("broken");
    if (result.body.status === "broken") expect(result.body.error).toContain("schemaVersion 9");
  });

  it("채택한 뒤에는 승인된 판을 볼 수 있고, 차이가 없다고 말한다", async () => {
    await seedProposed();
    await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    const result = await loadIrView(studioHome, ALIAS);
    if (!result.ok || !isIrViewReady(result.body)) throw new Error("ready 여야 한다");
    expect(result.body.hasCurrent).toBe(true);
    expect(result.body.currentVersion).toBe(1);
    expect(result.body.diff?.identical).toBe(true);

    const current = await loadIrView(studioHome, ALIAS, "current");
    if (!current.ok || !isIrViewReady(current.body)) throw new Error("ready 여야 한다");
    expect(current.body.source).toBe("current");
    // 승인된 판에서는 채택 버튼이 아무것도 하지 않는다.
    expect(current.body.canAdopt).toBe(false);
  });
});

async function confirmPrd(): Promise<void> {
  const prd = await loadPrd(studioHome, ALIAS);
  if (!prd.ok) throw new Error(prd.error);
  for (const section of prd.sections) await markPrdSection(studioHome, ALIAS, prd.sections, { n: section.n, state: "ok" });
}

describe("adoptIrView", () => {
  it("PRD 검토가 덜 됐으면 화면의 채택은 409 — 어느 절인지 말한다 (명세 20261006a §14.2)", async () => {
    await seedProposed();
    const result = await adoptIrView(studioHome, { alias: ALIAS });
    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toContain("PRD 검토가 덜 됐다");
    expect((await readOverlay(studioHome, ALIAS)).ir).toBeUndefined();
  });

  it("검사를 통과하고 PRD 11절이 맞아요면 채택하고 overlay.ir 가 생긴다", async () => {
    await seedProposed();
    await confirmPrd();
    const result = await adoptIrView(studioHome, { alias: ALIAS });
    expect(result).toMatchObject({ ok: true });
    const overlay = await readOverlay(studioHome, ALIAS);
    expect(overlay.ir?.version).toBe(1);
  });

  it("검사가 막으면 409로 거절하고 아무것도 쓰지 않는다 — 화면에도 --force 는 없다", async () => {
    await seedProposed((text) => text.replace(/^models:\n(?:  .*\n)+/m, "models: []\n"));
    await confirmPrd();
    const result = await adoptIrView(studioHome, { alias: ALIAS });
    expect(result).toMatchObject({ ok: false, status: 409 });
    const overlay = await readOverlay(studioHome, ALIAS);
    expect(overlay.ir).toBeUndefined();
  });

  it("alias가 없으면 400", async () => {
    expect(await adoptIrView(studioHome, {})).toMatchObject({ ok: false, status: 400 });
  });
});
