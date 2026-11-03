import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureStudioInitialized, registerProject, writeRunRecord, type StudioRegisteredProject } from "@patchbay/core";
import { collectHomeCommands } from "./homeExecution.js";
import { loadHome } from "./homeView.js";
import { createFlowApp } from "./server.js";

let host: string, repo: string;
const at = new Date(2026, 10, 2, 10).toISOString(), now = new Date(2026, 10, 3, 12);
let projects: StudioRegisteredProject[];
beforeEach(async () => {
  host = await fs.mkdtemp(path.join(os.tmpdir(), "pb-execution-"));
  repo = path.join(host, "repo"); await fs.mkdir(repo);
  projects = [{ alias: "demo", path: repo, kind: "local_repo" }];
});
const meta = () => ({ type: "session_meta", payload: { id: "session", cwd: repo } });
const command = (id: string, cwd = repo, exit = 0, time = at) => ({ timestamp: time, type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id, cwd, status: "completed", exit_code: exit, command: "DO_NOT_RETURN_SECRET", aggregated_output: "PRIVATE_OUTPUT" } } });
async function jsonl(relative: string, rows: unknown[]) { const file = path.join(host, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, rows.map(r => JSON.stringify(r)).join("\n") + "\n"); return file; }
describe("home completed command collection", () => {
  it("counts actual commands once, assigns the closest project, and excludes hidden or unrelated paths", async () => {
    projects.push({ alias: "hidden", path: path.join(repo, "private"), kind: "local_repo", hidden: true });
    await jsonl(".codex/sessions/one.jsonl", [meta(), command("one"), command("one"), command("failed", path.join(repo, "app"), 1), command("hidden", path.join(repo, "private")), command("other", repo + "-other"), command("future", repo, 0, new Date(2026, 10, 4).toISOString()), command("before", repo, 0, new Date(2026, 9, 31).toISOString())]);
    await jsonl(".codex/sessions/copy.jsonl", [meta(), command("one")]);
    const result = await collectHomeCommands(host, projects, "2026-11", now);
    expect(result.groups).toEqual([{ date: "2026-11-02", alias: "demo", source: "Codex", count: 2, failed: 1 }]);
    expect(JSON.stringify(result)).not.toMatch(/DO_NOT_RETURN_SECRET|PRIVATE_OUTPUT|repo|command/);
    expect((await collectHomeCommands(host, projects, "2026-11", now, true)).groups.find(g => g.alias === "hidden")?.count).toBe(1);
  });
  it("counts Claude Bash results, excludes denied, background, read and incomplete calls, and handles duplicate transcripts", async () => {
    const call = (id: string, name = "Bash") => ({ type: "assistant", timestamp: at, cwd: repo, message: { content: [{ type: "tool_use", name, id, input: { command: "PRIVATE" } }] } });
    const result = (id: string, extra = {}) => ({ type: "user", sessionId: "claude-session", timestamp: at, toolUseResult: { stdout: "PRIVATE", ...extra }, message: { content: [{ type: "tool_result", tool_use_id: id, is_error: id === "fail" }] } });
    const rows = [call("ok"), result("ok"), call("fail"), result("fail"), call("read", "Read"), result("read"), call("pending"), call("denied"), { ...result("denied"), toolUseResult: "User rejected" }, call("background"), result("background", { backgroundTaskId: "task" })];
    await jsonl(".claude/projects/demo/one.jsonl", rows);
    await jsonl(".claude/projects/demo/copy.jsonl", rows);
    expect((await collectHomeCommands(host, projects, "2026-11", now)).groups).toEqual([{ date: "2026-11-02", alias: "demo", source: "Claude", count: 2, failed: 1 }]);
  });
  it("supports legacy Codex results and invalidates cached files after appending", async () => {
    const file = await jsonl(".codex/sessions/legacy.jsonl", [meta(), { timestamp: at, type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "legacy", arguments: JSON.stringify({ cmd: "PRIVATE" }) } }, { timestamp: at, type: "response_item", payload: { type: "function_call_output", call_id: "legacy", output: "Process exited with code 0" } }]);
    expect((await collectHomeCommands(host, projects, "2026-11", now)).groups[0]?.count).toBe(1);
    await fs.appendFile(file, JSON.stringify(command("new")) + "\n");
    const result = await collectHomeCommands(host, projects, "2026-11", now);
    expect(result.groups[0]?.count).toBe(2); // mixed session formats retain distinct actual commands
    await fs.appendFile(file, JSON.stringify(command("new-two")) + "\n");
    expect((await collectHomeCommands(host, projects, "2026-11", now)).groups[0]?.count).toBe(3);
  });
  it("uses the actual local date at midnight and reports corrupt source lines", async () => {
    const midnight = new Date(2026, 10, 1, 0, 15).toISOString();
    const file = await jsonl(".codex/sessions/date.jsonl", [meta(), command("date", repo, 0, midnight)]);
    await fs.appendFile(file, "broken\n");
    expect(await collectHomeCommands(host, projects, "2026-11", now)).toMatchObject({ groups: [{ date: "2026-11-01", count: 1 }], rejected: 1 });
  });
  it("combines command and test groups in the authenticated home API without reading real host data", async () => {
    const studio = path.join(host, "workspace"); await ensureStudioInitialized(studio);
    await registerProject(studio, projects[0]!);
    await jsonl(".codex/sessions/api.jsonl", [meta(), command("one")]);
    await writeRunRecord(studio, "demo", { runId: "run", graphId: "demo", irVersion: 1, status: "error", nodeId: null, startedAt: at, endedAt: at, modelCalls: [], toolCalls: [], documentCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, error: null });
    expect((await loadHome(studio, { now })).execution).toMatchObject({ total: 1, commandsConnected: false });
    expect((await loadHome(studio, { now, hostHome: host, query: "no-match" })).execution).toMatchObject({ total: 2, days: { "2026-11-02": 2 }, activeDays: 1, commandsConnected: true });
    const app = createFlowApp({ studioHome: studio, executionHostHome: host, access: { token: "write", readToken: "read" } });
    try {
      expect((await app.request("/api/home")).status).toBe(401);
      const response = await app.request("/api/home?month=2026-11", { headers: { authorization: "Bearer read" } });
      expect(response.status).toBe(200);
      expect((await response.json()).execution.total).toBe(2);
    } finally { await app.close(); }
  });
});
