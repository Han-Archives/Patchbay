import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { registerProject } from "../studio/studioStore.js";
import { setOverlayIr, readOverlay } from "../studio/projectFiles.js";
import { readIrFile, readProposedIr } from "../studio/irStore.js";
import { parseIr, type Ir } from "../types/ir.js";
import { applyConsultPatch } from "./consult/draftWrite.js";
import { loadRequirementWorkspace, markRequirements, saveRequirement } from "./requirements.js";

let home: string, base: Ir;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "pb-req-review-"));
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__/valid.ir.yaml");
  await registerProject(home, { alias: "demo", kind: "local_repo", path: path.dirname(fixture) });
  const read = await readIrFile(fixture);
  const parsed = parseIr(read.ok ? read.raw : null);
  if (!parsed.ok) throw Error("fixture");
  base = parsed.ir;
  const template = base.requirements[0]!, link = base.requirementLinks.find(l => l.requirement === template.id)!;
  base.requirements = Array.from({ length: 30 }, (_, i) => ({
    ...template, id: "R" + (i + 1), summary: "요구 " + (i + 1), group: "묶음 " + Math.floor(i / 6),
    goal: base.goal, exceptions: [], acceptance: "응답 1건이 생성된다.", openQuestions: [],
  }));
  base.requirementLinks = base.requirements.map(r => ({ ...link, requirement: r.id }));
  await setOverlayIr(home, "demo", base);
});
async function draft(changes = 3) {
  const reqs = base.requirements.map((r, i) => i < changes ? { ...r, text: r.text + " 새 조건", changeReason: "사용자 변경" } : r);
  const result = await applyConsultPatch(home, "demo", { patch: { requirements: reqs } });
  expect(result.ok).toBe(true);
  return loadRequirementWorkspace(home, "demo");
}
describe("요구사항 개요·초점 저장", () => {
  it("깨진 초안을 빈 설계로 간주해 덮어쓰지 않는다", async () => {
    await draft();
    const file = path.join(home, "projects/demo/ir.proposed.yaml");
    await fs.writeFile(file, "requirements: [깨진 문법");
    const view = await loadRequirementWorkspace(home, "demo");
    expect(view.draftError).toBeTruthy();
    await expect(saveRequirement(home, "demo", { id: "R1", documentDigest: view.documentDigest, values: base.requirements[0] })).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(file, "utf8")).toBe("requirements: [깨진 문법");
  });
  it("요구사항 ID 중복이 있으면 검토 확정으로 넘기지 않는다", async () => {
    await applyConsultPatch(home, "demo", { patch: { requirements: [base.requirements[0], base.requirements[0]] } });
    const view = await loadRequirementWorkspace(home, "demo");
    expect(view.draftError).toContain("중복");
    await expect(markRequirements(home, "demo", { action: "approved", items: [{ id: "R1", digest: view.rows[0]!.digest }] })).rejects.toMatchObject({ status: 409 });
  });
  it("YAML·스키마의 객체 키 순서 차이를 요구사항 변경으로 세지 않는다", async () => {
    await applyConsultPatch(home, "demo", { patch: { requirements: base.requirements.map(r => Object.fromEntries(Object.entries(r).reverse())) } });
    const view = await loadRequirementWorkspace(home, "demo");
    expect(view.rows.every(r => r.change === "same")).toBe(true);
  });
  it("30개 전체와 직접 변경·공유 단계의 영향 대상을 구분하고 승인본을 보존한다", async () => {
    const view = await draft();
    expect(view.rows).toHaveLength(30);
    expect(view.rows.filter(r => r.change === "changed").map(r => r.id)).toEqual(["R1", "R2", "R3"]);
    expect(view.rows.filter(r => r.impactBy.length)).toHaveLength(27);
    expect(view.rows[0]?.blockers).toEqual([]);
    expect((await readOverlay(home, "demo")).ir?.requirements).toEqual(base.requirements);
    const current = await loadRequirementWorkspace(home, "demo", "current");
    expect(current.rows.every(r => r.change === "same")).toBe(true);
  });
  it("확정·보류·되돌림을 보존하고 내용이 바뀌면 재검토로 전환한다", async () => {
    let view = await draft();
    const item = { id: "R1", digest: view.rows[0]!.digest };
    view = await markRequirements(home, "demo", { items: [item], action: "approved" });
    expect(view.rows[0]?.decision).toBe("approved");
    view = await markRequirements(home, "demo", { items: [item], action: "held" });
    expect(view.rows[0]?.decision).toBe("held");
    view = await markRequirements(home, "demo", { items: [item], action: "pending" });
    expect(view.rows[0]?.decision).toBe("pending");
    await markRequirements(home, "demo", { items: [item], action: "approved" });
    await saveRequirement(home, "demo", { id: "R1", documentDigest: view.documentDigest, values: { ...view.rows[0]!.after!.requirement, text: "새로 정한 요구" } });
    view = await loadRequirementWorkspace(home, "demo");
    expect(view.rows[0]).toMatchObject({ decision: "pending", stale: true });
    await expect(markRequirements(home, "demo", { items: [item], action: "approved" })).rejects.toMatchObject({ status: 409 });
  });
  it("미결 질문이 있는 항목을 섞으면 일괄 확정 전체를 거절한다", async () => {
    let view = await draft();
    view = await saveRequirement(home, "demo", { id: "R2", documentDigest: view.documentDigest, values: { ...view.rows[1]!.after!.requirement, openQuestions: ["해제 시점은?"] } });
    await expect(markRequirements(home, "demo", { action: "approved", items: view.rows.slice(0, 2).map(r => ({ id: r.id, digest: r.digest })) })).rejects.toMatchObject({ status: 409 });
    expect((await loadRequirementWorkspace(home, "demo")).rows[0]?.decision).toBe("pending");
    view = await saveRequirement(home, "demo", { id: "R2", documentDigest: view.documentDigest, values: { ...view.rows[1]!.after!.requirement, openQuestions: [] } });
    view = await markRequirements(home, "demo", { action: "approved", items: view.rows.slice(0, 2).map(r => ({ id: r.id, digest: r.digest })) });
    expect(view.rows.slice(0, 2).every(r => r.decision === "approved")).toBe(true);
  });
  it("오래된 화면의 편집과 잘못된 흐름·시험 연결을 거절한다", async () => {
    const view = await draft();
    await expect(saveRequirement(home, "demo", { id: "R1", documentDigest: "old", values: base.requirements[0] })).rejects.toMatchObject({ status: 409 });
    await expect(saveRequirement(home, "demo", { id: "R1", documentDigest: view.documentDigest, values: base.requirements[0], links: [{ node: "없는 단계", eval: "없는 시험" }] })).rejects.toMatchObject({ status: 400 });
    expect((await loadRequirementWorkspace(home, "demo")).documentDigest).toBe(view.documentDigest);
  });
  it("동시 검토가 서로의 기록을 덮어쓰지 않고 출처가 ID에 따라 유지된다", async () => {
    const reqs = base.requirements.map((r, i) => i === 0 ? { ...r, text: r.text + " 수정" } : r);
    await applyConsultPatch(home, "demo", { patch: { requirements: reqs }, consult: "c1", turn: 3 });
    let view = await loadRequirementWorkspace(home, "demo");
    expect(view.rows[0]?.after?.source).toEqual({ kind: "consult", id: "c1", turn: 3 });
    const a = view.rows[0]!, b = view.rows[1]!;
    // R2는 그대로이므로 먼저 변경한다.
    view = await saveRequirement(home, "demo", { id: b.id, documentDigest: view.documentDigest, values: { ...b.after!.requirement, text: "두 번째 변경" } });
    const second = view.rows.find(r => r.id === b.id)!;
    await Promise.all([markRequirements(home, "demo", { items: [{ id: a.id, digest: a.digest }], action: "approved" }), markRequirements(home, "demo", { items: [{ id: second.id, digest: second.digest }], action: "held" })]);
    view = await loadRequirementWorkspace(home, "demo");
    expect(view.rows.find(r => r.id === a.id)?.decision).toBe("approved");
    expect(view.rows.find(r => r.id === b.id)?.decision).toBe("held");
    const d = await readProposedIr(home, "demo");
    const raw = d.ok ? d.raw as { requirements: unknown[] } : null;
    await applyConsultPatch(home, "demo", { patch: { requirements: [...raw!.requirements].reverse() } });
    expect((await loadRequirementWorkspace(home, "demo")).rows.find(r => r.id === "R1")?.after?.source?.id).toBe("c1");
  });
  it("초안 제외는 승인본을 지우지 않고 현재 판과 비교할 수 있다", async () => {
    const view = await draft(1);
    const next = await saveRequirement(home, "demo", { id: "R1", documentDigest: view.documentDigest, remove: true });
    expect(next.rows.find(r => r.id === "R1")).toMatchObject({ change: "removed", after: null, blockers: [] });
    expect((await readOverlay(home, "demo")).ir?.requirements.some(r => r.id === "R1")).toBe(true);
  });
});
