import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultAgentsPath, readAgents, writeAgents } from "./agents.js";

describe("Agents 목록", () => {
  const lead = { id: "a1", speaker: "claude-code" as const, model: "claude-opus-5-5", role: "이끈다.", name: "수리" };
  const solo = { id: "b1", speaker: "codex" as const, model: "gpt-5.6-terra", role: "만든다.", name: "팍스" };

  it("프로젝트에 목록이 없으면 기본 Agents를, 있으면 그 목록을 쓴다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-agents-"));
    expect(await readAgents(home, "demo")).toEqual([]);
    fs.writeFileSync(defaultAgentsPath(home), JSON.stringify({ agents: [lead] }));
    expect(await readAgents(home, "demo")).toEqual([lead]);
    await writeAgents(home, "demo", [solo]);
    expect(await readAgents(home, "demo")).toEqual([solo]);
    await writeAgents(home, "demo", []);
    expect(await readAgents(home, "demo")).toEqual([]);
  });
});
