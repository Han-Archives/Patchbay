import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultRoomRunner } from "./roomHost.js";

describe("RAG text-only process contract", () => {
  it("passes safe-mode, empty tools/MCP and ephemeral session flags to the actual Claude subprocess", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-rag-flags-"));
    const bin = path.join(dir, "fake-claude.cjs"), capture = path.join(dir, "args.json");
    await fs.writeFile(bin, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync('+JSON.stringify(capture)+',JSON.stringify(process.argv.slice(2)));process.stdout.write(JSON.stringify({result:"answer"}));\n', { mode: 0o700 });
    const turn = await defaultRoomRunner({ speaker: "claude-code", model: "", role: "원문만 답한다", execution: "text", prompt: "untrusted input", cwd: dir, bin, timeoutMs: 3000 });
    expect(turn.ok).toBe(true);
    const args: string[] = JSON.parse(await fs.readFile(capture, "utf8"));
    expect(args).toContain("--safe-mode"); expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config"); expect(args[args.indexOf("--mcp-config") + 1]).toBe('{"mcpServers":{}}');
    expect(args).toContain("--no-session-persistence"); expect(args).not.toContain("--add-dir");
  });
  it("stops a real running text process and refuses Codex before starting a process", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-rag-stop-")), bin = path.join(dir, "fake.cjs"), marker = path.join(dir, "began");
    await fs.writeFile(bin, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync('+JSON.stringify(marker)+',"started");setInterval(()=>{},1000);\n', { mode: 0o700 });
    const controller = new AbortController();
    const pending = defaultRoomRunner({ speaker: "local", model: "chat", role: "", execution: "text", prompt: "test", cwd: dir, bin, timeoutMs: 5000, signal: controller.signal });
    await vi.waitFor(async () => expect(await fs.readFile(marker, "utf8")).toBe("started"));
    controller.abort(); expect(await pending).toMatchObject({ ok: false, kind: "stopped" });
    expect(await defaultRoomRunner({ speaker: "codex", model: "", role: "", execution: "text", prompt: "test", cwd: dir, bin: "does-not-exist", timeoutMs: 500 })).toMatchObject({ ok: false, kind: "error" });
  });
});
