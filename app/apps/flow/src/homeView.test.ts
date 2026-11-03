import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureStudioInitialized, registerProject, setProjectHidden, updateTodos, writeOverlayApp, writeRunRecord, projectRunsDir, type RunRecord } from "@patchbay/core";
import { loadHome } from "./homeView.js";
import { appLaunchUrl, outputDocumentText, outputUrl } from "./homeContract.js";
import { createFlowApp } from "./server.js";

let home: string, repo: string;
const now = new Date(2026, 10, 2, 20);
async function file(relative: string, text: string) { const abs = path.join(repo, relative); await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, text); }
function run(id: string, date = new Date(2026, 10, 2, 10)): RunRecord {
  return { runId: id, graphId: "demo", irVersion: 1, status: "success", nodeId: null, startedAt: date.toISOString(), endedAt: date.toISOString(), modelCalls: [], toolCalls: [], documentCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null };
}
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-home-data-"));
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-home-repo-"));
  await ensureStudioInitialized(home);
  await registerProject(home, { alias: "demo", kind: "local_repo", path: repo, docs: "records", name: "예시 프로젝트" });
});
describe("workspace home · actual records", () => {
  it("uses the registered document root and searches body text without returning full documents", async () => {
    await file("records/report.md", "---\nid: internal-metadata\n---\n# 실제 보고서\n\n고유한 검색 문장이 있습니다.");
    await file("knowledge/study/index.html", "<title>화면 검토</title><p>화면 본문</p>");
    await file("src/main.ts", "고유한 검색 문장");
    const body = await loadHome(home, { query: "고유한 검색", now });
    const p = body.projects[0]!;
    expect(p.outputCount).toBe(2);
    expect(p.outputs.filter(o => o.matches).map(o => o.title)).toEqual(["실제 보고서"]);
    expect(p.matches).toBe(false);
    expect(p.outputs[0]).not.toHaveProperty("content");
    expect(p.outputs.find(o => o.kind === "문서")!.excerpt).not.toContain("internal-metadata");
    expect(p.appUrl).toBeNull();
  });
  it("excludes secrets, archived editions, raw memory and symlinks to other folders", async () => {
    await file("records/report.md", "# current");
    await file("records/archive/old.md", "SHOULD_NOT_APPEAR");
    await file("records/secrets/key.md", "SHOULD_NOT_APPEAR");
    await file("records/기억.md", "SHOULD_NOT_APPEAR");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-home-outside-"));
    await fs.writeFile(path.join(outside, "outside.md"), "SHOULD_NOT_APPEAR");
    await fs.symlink(outside, path.join(repo, "records/linked"));
    await fs.symlink(path.join(outside, "outside.md"), path.join(repo, "records/link.md"));
    const body = await loadHome(home, { now });
    expect(body.projects[0]!.outputs.map(o => o.path)).toEqual(["records/report.md"]);
    expect(JSON.stringify(body)).not.toContain("SHOULD_NOT_APPEAR");
  });
  it("keeps task order while excluding completed, inactive and deleted tasks", async () => {
    await updateTodos(home, "demo", () => [
      { id: "second", title: "앞선 일", at: now.toISOString(), done: false },
      { id: "first", title: "다음 일", at: now.toISOString(), done: false },
      { id: "inactive", title: "오래된 제안", at: now.toISOString(), done: false, inactive: true },
      { id: "done", title: "끝낸 일", at: now.toISOString(), done: true },
    ]);
    const p = (await loadHome(home, { now })).projects[0]!;
    expect(p.todos.map(t => [t.id, t.order])).toEqual([["second", 1], ["first", 2]]);
    expect(p.status).toBe("turn");
    expect((await loadHome(home, { now, running: ["demo"] })).projects[0]!.status).toBe("running");
  });
  it("counts each collected run once, excludes other months and reports rejected records", async () => {
    await writeRunRecord(home, "demo", run("one")); await writeRunRecord(home, "demo", run("two"));
    await writeRunRecord(home, "demo", run("before", new Date(2026, 9, 31, 12)));
    await fs.writeFile(path.join(projectRunsDir(home, "demo"), "broken.json"), "not json");
    const body = await loadHome(home, { now });
    expect(body.execution).toMatchObject({ days: { "2026-11-02": 2 }, total: 2, activeDays: 1, rejected: 1, groups: [{ date: "2026-11-02", alias: "demo", source: "테스트", count: 2, failed: 0 }] });
    expect((await loadHome(home, { now, month: "2026-10" })).execution.total).toBe(1);
    expect((await loadHome(home, { now, month: "2026-09" })).execution.total).toBe(0);
  });
  it("hiding a project also removes its results, tasks and runs from the home", async () => {
    await file("records/report.md", "# report"); await writeRunRecord(home, "demo", run("one"));
    await setProjectHidden(home, "demo", true);
    const body = await loadHome(home, { now });
    expect(body.projects).toEqual([]); expect(body.execution.total).toBe(0);
    const included = await loadHome(home, { now, hidden: true });
    expect(included.projects[0]!.outputCount).toBe(1); expect(included.execution.total).toBe(1);
  });
  it("does not confuse documents with an app address", async () => {
    await file("records/report.md", "# report");
    expect((await loadHome(home, { now })).projects[0]).toMatchObject({ outputCount: 1, appUrl: null });
    await writeOverlayApp(home, "demo", "http://127.0.0.1:4321/");
    expect((await loadHome(home, { now })).projects[0]!.appUrl).toBe("http://127.0.0.1:4321/");
  });
  it("never creates a sample output or placeholder execution for an empty workspace", async () => {
    const body = await loadHome(home, { now });
    expect(body.projects[0]).toMatchObject({ outputCount: 0, todos: [], appUrl: null });
    expect(body.execution.total).toBe(0);
  });
});
describe("home navigation and API", () => {
  it("resolves document images and links against the source folder without changing external links", () => {
    expect(outputDocumentText("![화면](./shot.png) [문서](../readme.md) [웹](https://example.com/a)", "records/run/report.md")).toBe("![화면](records/run/shot.png) [문서](records/readme.md) [웹](https://example.com/a)");
    expect(outputDocumentText("[밖](../../outside.md)", "records/report.md")).toBe("[밖](../../outside.md)");
  });
  it("allows only http(s) application URLs, and encodes real output paths", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/app", "https://user:pass@example.com/", "bad"]) expect(appLaunchUrl(value)).toBeNull();
    expect(appLaunchUrl("https://example.com/app")).toBe("https://example.com/app");
    expect(outputUrl({ alias: "demo", path: "records/화면 #1.html" })).toBe("/api/project-file/demo/records/%ED%99%94%EB%A9%B4%20%231.html");
  });
  it("is authenticated, readable without write access and validates the month", async () => {
    const app = createFlowApp({ studioHome: home, access: { token: "write", readToken: "read" } });
    try {
      expect((await app.request("/api/home")).status).toBe(401);
      const headers = { authorization: "Bearer read" };
      const response = await app.request("/api/home?month=2026-11", { headers });
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).projects[0].alias).toBe("demo");
      expect((await app.request("/api/home?month=2026-13", { headers })).status).toBe(400);
    } finally { await app.close(); }
  });
});
