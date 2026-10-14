import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { registerProject, writeStudio } from "./studioStore.js";
import { readOverlay } from "./projectFiles.js";
import { adoptIr, readProposedIr, PROPOSED_IR_FILE_NAME, VERSIONS_DIR_NAME } from "./irStore.js";
import { readApprovedProvenance, APPROVED_PROVENANCE_FILE_NAME } from "../ir/consult/provenance.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../ir/__fixtures__");
const ALIAS = "demo";

let studioHome: string;

async function seedProposed(mutate?: (ir: Record<string, unknown>) => void): Promise<void> {
  const raw = YAML.parse(await fs.readFile(path.join(FIXTURES, "valid.ir.yaml"), "utf8")) as Record<string, unknown>;
  mutate?.(raw);
  const dir = path.join(studioHome, "projects", ALIAS);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, PROPOSED_IR_FILE_NAME), YAML.stringify(raw), "utf8");
}

beforeEach(async () => {
  studioHome = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-ir-store-"));
  await writeStudio(studioHome, { name: "Test", projects: [] });
  await registerProject(studioHome, { alias: ALIAS, kind: "local_repo", path: FIXTURES });
});

describe("adoptIr", () => {
  it("채택본의 상담 출처는 이후 초안 변경과 분리하고 다음 채택 때 보관한다", async () => {
    await seedProposed();
    const dir = path.join(studioHome, "projects", ALIAS);
    await fs.writeFile(path.join(dir, "ir.provenance.yaml"), YAML.stringify({ origin: "consult", entries: [{ path: "goal", source: "said", consult: "original", turn: 1 }] }));
    await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    await fs.writeFile(path.join(dir, "ir.provenance.yaml"), YAML.stringify({ origin: "consult", entries: [{ path: "goal", source: "said", consult: "new-draft", turn: 1 }] }));
    expect((await readApprovedProvenance(studioHome, ALIAS, 1)).entries[0]?.consult).toBe("original");
    expect((await readApprovedProvenance(studioHome, ALIAS, 2)).entries).toEqual([]);
    await seedProposed(ir => { ir.goal = "다음 승인본"; });
    await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    const archived = JSON.parse(await fs.readFile(path.join(dir, "versions/1", APPROVED_PROVENANCE_FILE_NAME), "utf8"));
    expect(archived.provenance.entries[0].consult).toBe("original");
    expect((await readApprovedProvenance(studioHome, ALIAS, 2)).entries[0]?.consult).toBe("new-draft");
  });
  it("검사를 통과하면 overlay.ir 가 생기고 버전은 1부터", async () => {
    await seedProposed();
    const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    expect(result).toMatchObject({ ok: true, version: 1, previousVersion: null, archived: null });
    const overlay = await readOverlay(studioHome, ALIAS);
    expect(overlay.ir?.project).toBe("fixture-agent");
    expect(overlay.ir?.version).toBe(1);
  });

  it("검사가 실패하면 아무것도 쓰지 않는다 — --force 는 없다", async () => {
    await seedProposed((ir) => {
      ir.models = []; // 1.0이 모델을 요구하는데 부를 모델이 없다
    });
    const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("1.2");
      expect(result.checks?.failed).toContain("1.2/model-declared");
    }
    const overlay = await readOverlay(studioHome, ALIAS);
    expect(overlay.ir).toBeUndefined();
  });

  it("두 번째 채택은 이전 판을 versions/<n>/ 에 남기고 버전을 올린다", async () => {
    await seedProposed();
    await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    await seedProposed((ir) => {
      ir.goal = "두 번째 판의 목적";
    });
    const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    expect(result).toMatchObject({ ok: true, version: 2, previousVersion: 1 });

    const archived = path.join(studioHome, "projects", ALIAS, VERSIONS_DIR_NAME, "1");
    const kept = YAML.parse(await fs.readFile(path.join(archived, "ir.yaml"), "utf8")) as { goal: string; version: number };
    expect(kept.version).toBe(1);
    expect(kept.goal).not.toBe("두 번째 판의 목적"); // 보관본은 그때의 설계다
    const meta = JSON.parse(await fs.readFile(path.join(archived, "adopted.json"), "utf8")) as Record<string, unknown>;
    expect(meta).toMatchObject({ version: 1, replacedBy: 2, evals: null });

    const overlay = await readOverlay(studioHome, ALIAS);
    expect(overlay.ir?.goal).toBe("두 번째 판의 목적");
  });

  it("버전 번호는 커널이 센다 — 초안이 주장하는 값을 그대로 믿지 않는다", async () => {
    await seedProposed((ir) => {
      ir.version = 99;
    });
    const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    expect(result).toMatchObject({ ok: true, version: 1 });
  });

  it("채택해도 초안 파일은 그대로다 — 비교할 것이 남아야 한다", async () => {
    await seedProposed();
    const before = await readProposedIr(studioHome, ALIAS);
    await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    const after = await readProposedIr(studioHome, ALIAS);
    expect(after.ok).toBe(true);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("초안이 없으면 거절한다", async () => {
    const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(PROPOSED_IR_FILE_NAME);
  });

  it("다른 절(wires·decisions)을 덮지 않는다", async () => {
    const dir = path.join(studioHome, "projects", ALIAS);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "overlay.yaml"),
      YAML.stringify({ patches: [], wires: [], decisions: [{ id: "d1", concept: "c", summary: "사람이 적어 둔 결정", date: "2026-09-29" }], accepted_guides: ["g"], process: {} }),
      "utf8",
    );
    await seedProposed();
    const result = await adoptIr(studioHome, ALIAS, { docRoot: FIXTURES });
    expect(result.ok).toBe(true);
    const overlay = await readOverlay(studioHome, ALIAS);
    expect(overlay.decisions).toHaveLength(1);
    expect(overlay.accepted_guides).toEqual(["g"]);
    expect(overlay.ir?.version).toBe(1);
  });
});
