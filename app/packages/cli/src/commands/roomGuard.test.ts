import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeStudio } from "@patchbay/core";
import { runRoomGuard } from "./roomGuard.js";

const saved = process.env.PATCHBAY_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = saved;
  vi.restoreAllMocks();
});

async function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-room-guard-")));
  const home = path.join(base, "home");
  const repo = path.join(base, "repo");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  await writeStudio(home, { name: "t", projects: [{ alias: "demo", kind: "local_repo", path: repo }] });
  process.env.PATCHBAY_HOME = home;
  return { base, home, repo };
}

async function hook(input: unknown): Promise<string> {
  let out = "";
  expect(await runRoomGuard(async () => (typeof input === "string" ? input : JSON.stringify(input)), (text) => { out += text; })).toBe(0);
  return out;
}

function issues(home: string, session: string): { event: string; message: string }[] {
  return (JSON.parse(fs.readFileSync(path.join(home, "room-mirror", `${session}.json`), "utf8")) as { guardIssues?: { event: string; message: string }[] }).guardIssues ?? [];
}

describe("room guard 훅 — 못 찾거나 오류일 때 (사용자 결정 2026-11-03)", () => {
  it("세션 기록 없이 묶이면 바깥 쓰기를 막고, studio.yaml 이 깨져도 묶인 세션은 막는다", async () => {
    const { base, home, repo } = await setup();
    // 훅은 기본 공유 범위(임시 폴더)를 쓰므로 바깥은 임시 폴더 밖이어야 한다. 검사만 하고 쓰지 않는다.
    const write = { hook_event_name: "PreToolUse", session_id: "s1", transcript_path: path.join(base, "none.jsonl"), tool_name: "Write", tool_input: { file_path: "/pb-room-guard-outside" }, cwd: repo };
    expect(await hook(write)).toBe("");
    await hook({ hook_event_name: "PostToolUse", session_id: "s1", tool_name: "mcp__patchbay__room_bind", tool_response: [{ type: "text", text: JSON.stringify({ bound: true, alias: "demo", roomId: "r1" }) }] });
    expect(JSON.parse(await hook(write)).hookSpecificOutput.permissionDecision).toBe("deny");
    fs.writeFileSync(path.join(home, "studio.yaml"), "projects: 3\n");
    const denied = JSON.parse(await hook(write)).hookSpecificOutput;
    expect(denied.permissionDecision).toBe("deny");
    expect(denied.permissionDecisionReason).toContain("확인하지 못해 막았습니다");
  });

  it("room_bind 결과를 못 읽으면 허용하되 세션 상태에 남긴다", async () => {
    const { home } = await setup();
    await hook({ hook_event_name: "PostToolUse", session_id: "s2", tool_name: "mcp__patchbay__room_bind", tool_response: "등록되지 않은 프로젝트" });
    expect(issues(home, "s2")).toEqual([expect.objectContaining({ event: "PostToolUse", message: expect.stringContaining("등록되지 않은 프로젝트") })]);
  });

  it("묶음을 확인하기 전의 오류는 허용하고 남기며, 작업 공간을 못 찾으면 stderr 에만 남긴다", async () => {
    const { base, home, repo } = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fs.mkdirSync(path.join(home, "room-mirror"), { recursive: true });
    fs.writeFileSync(path.join(home, "room-mirror", "s3.json"), "{");
    const write = (session: string) => ({ hook_event_name: "PreToolUse", session_id: session, transcript_path: path.join(base, "none.jsonl"), tool_name: "Write", tool_input: { file_path: path.join(base, "outside") }, cwd: repo });
    // 깨진 세션 상태는 덮어쓰지 않는다 — stderr 만.
    expect(await hook(write("s3"))).toBe("");
    expect(fs.readFileSync(path.join(home, "room-mirror", "s3.json"), "utf8")).toBe("{");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("세션 상태에도 남기지 못했다"));
    // 입력이 JSON 이 아니면 세션을 모른다 — stderr 만.
    expect(await hook("{not json")).toBe("");
    process.env.PATCHBAY_HOME = path.join(base, "file-not-dir");
    fs.writeFileSync(process.env.PATCHBAY_HOME, "");
    expect(await hook(write("s4"))).toBe("");
    expect(fs.existsSync(path.join(home, "room-mirror", "s4.json"))).toBe(false);
  });
});
