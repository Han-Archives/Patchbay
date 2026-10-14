import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, readOverlay, registerProject, writeOverlayIfAbsent } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { addDecisionView } from "./decisionView.js";

async function studio(): Promise<string> {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-decision-"));
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
  await writeOverlayIfAbsent(studioHome, "demo");
  return studioHome;
}

describe("addDecisionView — 「결정 남기기」", () => {
  it("직접 기록에 한 줄을 남긴다 — CLI 와 같은 기본값(concept 는 프로젝트 이름)", async () => {
    const studioHome = await studio();
    const result = await addDecisionView(studioHome, { alias: "demo", summary: "  스캔은 화면에서  ", rationale: "" });
    if (!result.ok) throw new Error(result.error);
    expect(result.body.count).toBe(1);
    expect(result.body.decision).toMatchObject({ concept: "demo", summary: "스캔은 화면에서" });
    expect(result.body.decision.id).toMatch(/^dec-/);
    expect(result.body.decision).not.toHaveProperty("rationale");
    const overlay = await readOverlay(studioHome, "demo");
    expect(overlay.decisions.map((row) => row.summary)).toEqual(["스캔은 화면에서"]);
  });

  it("빈 한 줄은 400, 모르는 이름은 404 — 아무것도 쓰지 않는다", async () => {
    const studioHome = await studio();
    expect(await addDecisionView(studioHome, { alias: "demo", summary: "   " })).toMatchObject({ ok: false, status: 400 });
    expect(await addDecisionView(studioHome, { alias: "nope", summary: "x" })).toMatchObject({ ok: false, status: 404 });
    expect((await readOverlay(studioHome, "demo")).decisions).toEqual([]);
  });
});
