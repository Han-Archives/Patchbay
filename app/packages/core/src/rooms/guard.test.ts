import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeStudio } from "../studio/studioStore.js";
import { guardRoots, guardTool, outsideTarget } from "./guard.js";

const bindCall = { type: "assistant", message: { model: "m", content: [{ type: "tool_use", id: "b1", name: "mcp__patchbay__room_bind", input: { alias: "demo" } }] } };
const bindResult = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", content: [{ type: "text", text: JSON.stringify({ bound: true, alias: "demo", roomId: "r1" }) }] }] } };

async function setup(bound: boolean) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-guard-")));
  const home = path.join(base, "home");
  const repo = path.join(base, "repo");
  const other = path.join(base, "other");
  for (const dir of [home, repo, other]) fs.mkdirSync(dir, { recursive: true });
  await writeStudio(home, { name: "t", projects: [{ alias: "demo", kind: "local_repo", path: repo }, { alias: "else", kind: "local_repo", path: other }] });
  const transcript = path.join(home, "t.jsonl");
  fs.writeFileSync(transcript, (bound ? [bindCall, bindResult] : []).map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { home, repo, other, transcript };
}

describe("묶인 세션의 쓰기 범위", () => {
  it("묶이지 않은 세션은 보지 않는다", async () => {
    const { home, other, transcript } = await setup(false);
    expect(await guardTool(home, { transcriptPath: transcript, toolName: "Write", toolInput: { file_path: path.join(other, "a.ts") }, cwd: other }, [])).toBeNull();
  });

  it("묶이면 그 프로젝트 · 작업 공간 프로젝트 폴더 안 쓰기만 허락하고 다른 프로젝트는 막는다", async () => {
    const { home, repo, other, transcript } = await setup(true);
    const check = (toolName: string, toolInput: Record<string, unknown>, cwd = repo) => guardTool(home, { transcriptPath: transcript, toolName, toolInput, cwd }, []);
    expect((await check("Write", { file_path: path.join(repo, "src", "new.ts") }))?.deny).toBeNull();
    expect((await check("Edit", { file_path: "src/a.ts" }))?.deny).toBeNull();
    expect((await check("Write", { file_path: path.join(home, "projects", "demo", "todos.json") }))?.deny).toBeNull();
    expect((await check("Read", { file_path: path.join(other, "a.ts") }))).toBeNull();
    const denied = await check("Edit", { file_path: path.join(other, "a.ts") });
    expect(denied?.alias).toBe("demo");
    expect(denied?.deny).toContain("「demo」");
    expect((await check("Write", { file_path: path.join(home, "projects", "else", "todos.json") }))?.deny).toContain(path.join(home, "projects", "else"));
  });

  it("Bash 는 쓰는 명령일 때 지금 폴더와 적힌 경로를 본다", async () => {
    const { home, repo, other } = await setup(true);
    const roots = guardRoots(home, "demo", repo, []);
    const bash = (command: string, cwd = repo) => outsideTarget("Bash", { command }, cwd, roots);
    expect(bash(`ls ${other}`)).toBeNull();
    expect(bash(`cat ${other}/a.ts | grep x 2>&1`)).toBeNull();
    expect(bash("pnpm test > /dev/null 2>&1")).toBeNull();
    expect(bash("echo hi > out.txt")).toBeNull();
    expect(bash(`rm -rf ${repo}/dist`)).toBeNull();
    expect(outsideTarget("Bash", { command: "echo hi > /tmp/x.txt" }, repo, guardRoots(home, "demo", repo))).toBeNull();
    expect(bash(`rm ${other}/a.ts`)).toBe(path.join(other, "a.ts"));
    expect(bash(`echo hi >> ${other}/log.md`)).toBe(path.join(other, "log.md"));
    expect(bash("sed -i '' s/a/b/ ../other/a.ts")).toBe(path.join(other, "a.ts"));
    expect(bash("git commit -m x", other)).toBe(other);
    expect(bash(`cd ${other} && git add .`)).toBe(other);
  });
});
