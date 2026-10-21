import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerProject } from "./studioStore.js";
import { listWorkspaceDir, loadWorkspaceFile, saveWorkspaceFile, workspaceFileGrade } from "./workspaceFiles.js";

async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-wsfiles-"));
  await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
  await registerProject(home, { alias: "other", kind: "local_repo", path: "/tmp/other" });
  const root = path.join(home, "projects/demo");
  fs.mkdirSync(path.join(root, "chats"), { recursive: true });
  fs.mkdirSync(path.join(root, "log/records"), { recursive: true });
  fs.writeFileSync(path.join(root, "todos.json"), '{"todos":[]}\n');
  fs.writeFileSync(path.join(root, "board.yaml"), "columns: []\n");
  fs.writeFileSync(path.join(root, "ATLAS.md"), "# Atlas\n");
  fs.writeFileSync(path.join(root, "chats/r1.jsonl"), '{"seq":0}\n');
  fs.writeFileSync(path.join(root, "chats/r1.jsonl.lock"), "");
  fs.writeFileSync(path.join(root, "log/records/2026-10-16.md"), "# 하루\n");
  fs.writeFileSync(path.join(root, ".env"), "KEY=1\n");
  fs.mkdirSync(path.join(home, "projects/other"), { recursive: true });
  fs.writeFileSync(path.join(home, "projects/other/todos.json"), '{"todos":[]}\n');
  return { home, root };
}

describe("폴더 · 문서 편집기 — 기록 폴더", () => {
  it("편집 등급: 대화 · 사건은 쓰는 중, 스캔 · Log 기록은 자동, 나머지는 편집", () => {
    expect(workspaceFileGrade("chats/r1.jsonl")).toBe("live");
    expect(workspaceFileGrade("chats/r1.meta.json")).toBe("live");
    expect(workspaceFileGrade("log/events/changes.jsonl")).toBe("live");
    expect(workspaceFileGrade("ATLAS.md")).toBe("auto");
    expect(workspaceFileGrade("log/records/2026-10-16.md")).toBe("auto");
    expect(workspaceFileGrade("todos.json")).toBe("edit");
    expect(workspaceFileGrade("todo-history/a/summary.md")).toBe("edit");
  });

  it("루트 목록: 폴더가 먼저, 잠금 파일은 숨기고, 비밀 파일은 표시만 한다", async () => {
    const { home } = await setup();
    const result = await listWorkspaceDir(home, "demo", "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.entries.map((entry) => entry.name)).toEqual([
      "chats", "log", ".env", "ATLAS.md", "board.yaml", "todos.json",
    ]);
    expect(result.body.entries.find((entry) => entry.name === ".env")?.secret).toBe(true);
    expect(result.body.entries.find((entry) => entry.name === "chats")?.count).toBe(1);
    expect(result.body.summary).toMatchObject({ folders: 2, files: 4, total: 6, grades: { edit: 3, auto: 2, live: 1 } });
    expect(result.body.note).toContain("코드와 문서는 여기 없다");
  });

  it("기록 폴더 밖 · 다른 프로젝트 · 모르는 프로젝트는 닿지 않는다", async () => {
    const { home } = await setup();
    expect(await listWorkspaceDir(home, "demo", "../other")).toMatchObject({ ok: false, status: 400 });
    expect(await loadWorkspaceFile(home, "demo", "../other/todos.json")).toMatchObject({ ok: false, status: 400 });
    expect(await listWorkspaceDir(home, "nope", "")).toMatchObject({ ok: false, status: 404 });
    expect(await loadWorkspaceFile(home, "demo", ".env")).toMatchObject({ ok: false, status: 403 });
  });

  it("링크로 밖을 가리키는 파일은 열지 않는다", async () => {
    const { home, root } = await setup();
    fs.symlinkSync(path.join(home, "projects/other/todos.json"), path.join(root, "linked.json"));
    expect(await loadWorkspaceFile(home, "demo", "linked.json")).toMatchObject({ ok: false, status: 403 });
    const list = await listWorkspaceDir(home, "demo", "");
    expect(list.ok && list.body.entries.some((entry) => entry.name === "linked.json")).toBe(false);
  });

  it("편집 파일은 저장되고, 연 뒤에 바뀌었으면 409 로 덮지 않는다", async () => {
    const { home, root } = await setup();
    const opened = await loadWorkspaceFile(home, "demo", "todos.json");
    if (!opened.ok) throw new Error(opened.error);
    const next = '{"todos":[{"id":"t1"}]}\n';
    const saved = await saveWorkspaceFile(home, { alias: "demo", path: "todos.json", content: next, expectedHash: opened.body.hash });
    expect(saved.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, "todos.json"), "utf8")).toBe(next);

    fs.writeFileSync(path.join(root, "todos.json"), '{"todos":[{"id":"agent"}]}\n');
    const stale = await saveWorkspaceFile(home, { alias: "demo", path: "todos.json", content: "{}", expectedHash: opened.body.hash });
    expect(stale).toMatchObject({ ok: false, status: 409 });
    expect(fs.readFileSync(path.join(root, "todos.json"), "utf8")).toContain("agent");
  });

  it("형식이 틀리거나 읽기 전용 등급이면 쓰지 않는다", async () => {
    const { home, root } = await setup();
    expect(await saveWorkspaceFile(home, { alias: "demo", path: "todos.json", content: "{" })).toMatchObject({ ok: false, status: 400 });
    expect(await saveWorkspaceFile(home, { alias: "demo", path: "board.yaml", content: "a: [" })).toMatchObject({ ok: false, status: 400 });
    expect(await saveWorkspaceFile(home, { alias: "demo", path: "ATLAS.md", content: "x" })).toMatchObject({ ok: false, status: 403 });
    expect(await saveWorkspaceFile(home, { alias: "demo", path: "chats/r1.jsonl", content: "x" })).toMatchObject({ ok: false, status: 403 });
    expect(fs.readFileSync(path.join(root, "todos.json"), "utf8")).toBe('{"todos":[]}\n');
  });
});
