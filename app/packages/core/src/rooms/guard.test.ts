import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeStudio } from "../studio/studioStore.js";
import { guardRoots, guardTool, outsideTarget, requiresDeleteApproval } from "./guard.js";
import { recordSessionBinding } from "./mirror.js";

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
    expect(bash(`node -e "require('node:fs').writeFileSync('${other}/x', 'x')"`)).toBe(path.join(other, "x"));
    expect(bash(`python -c "open('${other}/x', 'w').write('x')"`)).toBe(path.join(other, "x"));
    expect(bash(`node -e "require('node:fs').writeFileSync('inside.txt', 'x')"`)).toBeNull();
  });

  it("Bash 명령 속 URL · 정규식 조각은 경로로 보지 않는다 (세션 9d11a206 오탐 2026-10-20~27)", async () => {
    const { home, repo, other } = await setup(true);
    const roots = guardRoots(home, "demo", repo, []);
    const bash = (command: string) => outsideTarget("Bash", { command }, repo, roots);
    // 실제로 거절됐던 명령들 (줄여 옮김).
    expect(bash(`node a.js > out.log 2>&1; curl -s -w "%{http_code}\\n" http://127.0.0.1:4318/`)).toBeNull();
    expect(bash(`git commit -q -F - <<'EOF'\nx\n\nClaude-Session: https://claude.ai/code/session_01GN\nEOF`)).toBeNull();
    expect(bash(`node -e 'p.on("console", m => errs.push(m)); await p.goto("http:" + "//localhost:5180"); t.replace(/\\n{2,}/g, "\\n")'`)).toBeNull();
    expect(bash(`node -e 'xs.forEach(x=>console.log((x.detail||"").replace(/\\s+/g," ")))'`)).toBeNull();
    // 화살표 · >= 는 리다이렉트가 아니다 — 읽기만 하는 스크립트의 require 절대 경로를 보지 않는다 (853줄 2026-11-03).
    expect(bash(`node -e 'const m = require("${other}/node_modules/x"); console.log(Object.keys(m).filter(k => k.length >= 3))'`)).toBeNull();
    expect(bash(`node -e 'if (process.argv.length>=2) require("${other}/x.js")'`)).toBeNull();
    expect(bash(`node -e 'require("${other}/x.js")' >> ${other}/z`)).toBe(path.join(other, "x.js"));
    // 같은 명령에 진짜 바깥 경로가 있으면 그대로 막는다.
    expect(bash(`curl http://127.0.0.1:4318/ > ${other}/x`)).toBe(path.join(other, "x"));
    expect(bash(`node -e 's.replace(/\\s+/g," ")' > ${other}/y`)).toBe(path.join(other, "y"));
    expect(bash(`cp a.txt /tmp/`)).toBe("/private/tmp");
  });

  it("세션 기록 파일이 없어도 PostToolUse 가 적은 묶음으로 막는다 (eval-r9-2 2026-11-01)", async () => {    const { home, repo } = await setup(false);
    const missing = path.join(home, "no-such-session.jsonl");
    const outside = path.join(path.dirname(repo), "root-marker");
    const write = () => guardTool(home, { sessionId: "s-missing", transcriptPath: missing, toolName: "Write", toolInput: { file_path: outside }, cwd: repo }, []);
    expect(await write()).toBeNull();
    // 오류 결과 · 다른 글은 묶음이 아니다.
    expect(await recordSessionBinding(home, "s-missing", [{ type: "text", text: "등록되지 않은 프로젝트" }])).toBeNull();
    expect(await write()).toBeNull();
    // Claude Code 2.1.296 의 room_bind tool_response 모양 그대로.
    const response = [{ type: "text", text: JSON.stringify({ bound: true, alias: "demo", roomId: "r1", title: null }, null, 2) }];
    expect(await recordSessionBinding(home, "s-missing", response)).toEqual({ alias: "demo", roomId: "r1" });
    const denied = await write();
    expect(denied?.deny).toContain("「demo」");
    expect(denied?.deny).toContain(outside);
    expect((await guardTool(home, { sessionId: "s-missing", transcriptPath: missing, toolName: "Write", toolInput: { file_path: path.join(repo, "a.ts") }, cwd: repo }, []))?.deny).toBeNull();
    // 다른 세션은 그대로 묶이지 않음.
    expect(await guardTool(home, { sessionId: "s-other", transcriptPath: missing, toolName: "Write", toolInput: { file_path: outside }, cwd: repo }, [])).toBeNull();
  });

  it("묶음을 확인한 뒤 난 오류는 막는다 (사용자 결정 2026-11-03)", async () => {
    const { home, other, transcript } = await setup(true);
    fs.writeFileSync(path.join(home, "studio.yaml"), "projects: 3\n");
    const denied = await guardTool(home, { transcriptPath: transcript, toolName: "Write", toolInput: { file_path: path.join(other, "a.ts") }, cwd: other }, []);
    expect(denied?.deny).toContain("「demo」");
    expect(denied?.deny).toContain("확인하지 못해 막았습니다");
  });

  it("묶음을 확인하기 전의 이상한 경우는 허용하되 세션 상태에 남긴다 (사용자 결정 2026-11-03)", async () => {
    const { home, repo, other } = await setup(false);
    const issues = (session: string) => (JSON.parse(fs.readFileSync(path.join(home, "room-mirror", `${session}.json`), "utf8")) as { guardIssues?: { event: string; tool: string; message: string }[] }).guardIssues ?? [];
    const write = (session: string, transcriptPath: string) => guardTool(home, { sessionId: session, transcriptPath, toolName: "Write", toolInput: { file_path: path.join(other, "a.ts") }, cwd: repo }, []);
    // 세션 기록 파일도 세션 상태도 없음 — 세션마다 처음 한 번만 남는다.
    const missing = path.join(home, "no-such.jsonl");
    expect(await write("s-none", missing)).toBeNull();
    expect(await write("s-none", missing)).toBeNull();
    expect(issues("s-none")).toEqual([expect.objectContaining({ event: "PreToolUse", tool: "Write", message: expect.stringContaining("세션 기록 파일도 세션 상태도 없어") })]);
    // 세션 기록을 못 읽음(폴더) — 세션 상태에 묶음이 없으면 허용하고 남긴다, 있으면 그 묶음으로 막는다.
    expect(await write("s-dir", home)).toBeNull();
    expect(issues("s-dir")[0]?.message).toContain("세션 기록을 읽지 못해");
    await recordSessionBinding(home, "s-dir", [{ type: "text", text: JSON.stringify({ bound: true, alias: "demo", roomId: "r1" }) }]);
    expect((await write("s-dir", home))?.deny).toContain("「demo」");
    // 세션 상태가 깨졌으면 덮어쓰지 않고 오류를 올린다 (훅이 허용하고 stderr 에 남긴다).
    fs.writeFileSync(path.join(home, "room-mirror", "s-broken.json"), "{");
    await expect(write("s-broken", missing)).rejects.toThrow();
    expect(fs.readFileSync(path.join(home, "room-mirror", "s-broken.json"), "utf8")).toBe("{");
    // 세션 기록에서 묶이지 않은 것으로 읽힌 보통 세션은 아무것도 남기지 않는다.
    const { transcript } = await setup(false);
    expect(await guardTool(home, { sessionId: "s-plain", transcriptPath: transcript, toolName: "Write", toolInput: { file_path: path.join(other, "a.ts") }, cwd: repo }, [])).toBeNull();
    expect(fs.existsSync(path.join(home, "room-mirror", "s-plain.json"))).toBe(false);
  });

  it("프로젝트 안 삭제도 사람 승인 대상으로 올리고 바깥 삭제는 먼저 거절한다", async () => {
    const { home, repo, other, transcript } = await setup(true);
    expect(requiresDeleteApproval("Bash", { command: `rm -rf ${repo}/dist` })).toBe(true);
    expect((await guardTool(home, { transcriptPath: transcript, toolName: "Bash", toolInput: { command: `rm -rf ${repo}/dist` }, cwd: repo }, []))?.ask).toContain("사람의 승인");
    const outside = await guardTool(home, { transcriptPath: transcript, toolName: "Bash", toolInput: { command: `rm ${other}/a.ts` }, cwd: repo }, []);
    expect(outside?.deny).toContain(other); expect(outside?.ask).toBeUndefined();
  });
});
