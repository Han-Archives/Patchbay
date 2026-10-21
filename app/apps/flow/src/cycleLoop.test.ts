import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { cycleEdges } from "./ProjectCycleFlow.js";
import { createFlowApp } from "./server.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("설계→구현→테스트→검토 고리 표시", () => {
  it("고리를 잇고, Review에서 승인은 결과로 · 반려는 설계로 가는 두 길을 그린다", () => {
    const edges = cycleEdges("design").map(({ source, target, label, sourceHandle }) => ({ source, target, label, sourceHandle }));
    expect(edges).toEqual([
      { source: "design", target: "build", label: "구체화", sourceHandle: "out" },
      { source: "build", target: "test", label: "실행", sourceHandle: "out" },
      { source: "test", target: "review", label: "결과 확인", sourceHandle: "out" },
      { source: "review", target: "design", label: "반려", sourceHandle: "reject" },
      { source: "review", target: "result", label: "승인", sourceHandle: "approve" },
    ]);
    // 첫 바퀴의 설계에서 반려 선은 흐르지 않는다 — 들어오는 앞길만 흐른다.
    expect(cycleEdges("design").find((e) => e.id === "e4")!.animated).toBe(false);
    expect(cycleEdges("result").find((e) => e.id === "e5")!.animated).toBe(true);
  });
});

describe("서비스 화면을 테스트 화면에 임베드", () => {
  it("프로젝트가 만든 화면 주소를 저장해 테스트 화면에 띄우고, 실행 기록은 따로 여는 버튼에 둔다", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-use-"));
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-use-repo-")) });
    const app = createFlowApp({ studioHome });
    const bad = await app.request("/api/test/app", { method: "POST", body: JSON.stringify({ alias: "demo", url: "localhost:5180" }), headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
    const saved = await app.request("/api/test/app", { method: "POST", body: JSON.stringify({ alias: "demo", url: "http://localhost:5180" }), headers: { "content-type": "application/json" } });
    expect(await saved.json()).toEqual({ ok: true, app: { url: "http://localhost:5180" } });
    const dashboard = (await (await app.request("/api/dashboard?alias=demo")).json()) as { app?: string };
    expect(dashboard.app).toBe("http://localhost:5180");
    const pane = fs.readFileSync(path.join(here, "UsePane.tsx"), "utf8");
    expect(pane).toContain('<iframe className="use-frame" title="사용 창" src={app} />');
    expect(pane).toMatch(/className="use-toggle" aria-expanded=\{open\} onClick=\{\(\) => setOpen\(\(v\) => !v\)\}>\s*실행 기록/);
    expect(pane).toMatch(/\{open \? \(\s*<div className="use-log">/);
  });
});
