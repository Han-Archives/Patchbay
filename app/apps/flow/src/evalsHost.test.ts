import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureStudioInitialized, writeEvalEvidence, parseIr, readCurrentEvalRun, readIrFile, registerProject, setOverlayIr, writeOverlayIfAbsent } from "@patchbay/core";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowApp, type FlowApp } from "./server.js";
import type { EvalsReviewResponse } from "./evalsContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_IR = path.resolve(HERE, "..", "..", "..", "packages", "core", "src", "ir", "__fixtures__", "valid.ir.yaml");

let app: FlowApp | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function adopted(): Promise<string> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-evals-api-"));
  await ensureStudioInitialized(home);
  await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
  await writeOverlayIfAbsent(home, "demo");
  const read = await readIrFile(FIXTURE_IR);
  if (!read.ok) throw new Error(read.error);
  const parsed = parseIr(read.raw);
  if (!parsed.ok) throw new Error(parsed.error);
  await setOverlayIr(home, "demo", parsed.ir);
  return home;
}

const post = (body: unknown) => app!.request("/api/evals/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const run = (irVersion: number) => ({ irVersion, ranAt: "2026-10-31T00:00:00.000Z", how: "사람 채점", results: [{ evalId: "E1", kind: "deterministic", status: "pass" }, { evalId: "E2", kind: "deterministic", status: "fail", note: "다시 정하지 않음" }] });

describe("Review 화면 평가 결과 받기", () => {
  it("승인된 판의 평가를 보여 주고, 받은 결과를 그 판에 붙인다", async () => {
    const home = await adopted();
    app = createFlowApp({ studioHome: home });
    const before = await (await app.request("/api/evals?alias=demo")).json() as EvalsReviewResponse;
    expect(before.status).toBe("ok");
    if (before.status !== "ok") return;
    expect(before.irVersion).toBe(1);
    expect(before.evals.map(e => e.id)).toContain("E1");
    expect(before.current).toBeNull();

    const res = await post({ alias: "demo", run: run(1) });
    expect(res.status).toBe(200);
    const body = await res.json() as { score: { passed: number; failed: number }; missing: string[] };
    expect(body.score).toMatchObject({ passed: 1, failed: 1 });
    expect(body.missing.length).toBe(before.evals.length - 2);

    const stored = await readCurrentEvalRun(home, "demo");
    expect(stored.ok && stored.run.results[1]?.note).toBe("다시 정하지 않음");
    const after = await (await app.request("/api/evals?alias=demo")).json() as EvalsReviewResponse;
    expect(after.status === "ok" && after.current?.score.passed).toBe(1);
  });

  it("다른 판의 결과는 CLI와 같은 이유로 거절하고 아무것도 쓰지 않는다", async () => {
    const home = await adopted();
    app = createFlowApp({ studioHome: home });
    const res = await post({ alias: "demo", run: run(9) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("v9");
    expect((await readCurrentEvalRun(home, "demo")).ok).toBe(false);
  });

  it("형식이 틀린 결과는 받지 않는다", async () => {
    app = createFlowApp({ studioHome: await adopted() });
    const res = await post({ alias: "demo", run: { irVersion: 1, results: [{ evalId: "E1", status: "maybe" }] } });
    expect(res.status).toBe(400);
  });
});

describe("draftFromJson", () => {
  it("채점 화면이 내려 준 JSON을 건마다 채우고, 다른 판이면 거절한다", async () => {
    const { draftFromJson } = await import("./EvalReviewPanel.js");
    const text = JSON.stringify(run(3));
    const ok = draftFromJson(text, 3);
    expect(ok.ok && ok.draft).toEqual({ E1: { status: "pass" }, E2: { status: "fail", note: "다시 정하지 않음" } });
    const wrong = draftFromJson(text, 4);
    expect(!wrong.ok && wrong.error).toContain("v3");
    expect(draftFromJson("{", 3).ok).toBe(false);
  });
});

describe("평가 근거 보이기", () => {
  it("근거를 평가 옆에 싣고, 첨부는 적힌 이름만 내준다", async () => {
    const home = await adopted();
    const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-evidence-src-")), "shot.png");
    fs.writeFileSync(shot, "png");
    await writeEvalEvidence(home, "demo", { evalId: "E1", irVersion: 1, how: "눌러 봄", observed: "열림", files: [shot], screen: "test" });
    app = createFlowApp({ studioHome: home });
    const view = await (await app.request("/api/evals?alias=demo")).json() as EvalsReviewResponse;
    const e1 = view.status === "ok" ? view.evals.find(e => e.id === "E1") : undefined;
    expect(e1?.evidence).toMatchObject({ observed: "열림", files: ["shot.png"], screen: "test" });
    const img = await app.request("/api/evals/evidence-file?alias=demo&version=1&eval=E1&name=shot.png");
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect((await app.request("/api/evals/evidence-file?alias=demo&version=1&eval=E1&name=evidence.json")).status).toBe(404);
  });

  it("지금 화면 링크는 작업 화면 · 대화방만 만든다", async () => {
    const { screenLink } = await import("./EvalReviewPanel.js");
    expect(screenLink("test")).toMatchObject({ kind: "place", place: "test", label: "테스트" });
    expect(screenLink("room:abc")).toMatchObject({ kind: "room", id: "abc" });
    expect(screenLink("javascript:alert(1)")).toBeNull();
    expect(screenLink(undefined)).toBeNull();
  });
});
