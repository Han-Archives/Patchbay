import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendDecision, newDecision, readOverlay, writeOverlayIfAbsent } from "./projectFiles.js";
import { readProgress, writeProgressEntry } from "./progressStore.js";
import { registerProject } from "./studioStore.js";
import { resetAuthoredStructure } from "./resetStructure.js";

describe("resetAuthoredStructure — 0 구조 옛 기록을 보관하고 비운다", () => {
  it("요구 · 구현과 결정을 archive 로 옮기고 비운다 — 지우지 않는다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-reset-"));
    await registerProject(home, { alias: "p", kind: "local_repo", path: "/tmp/p" });
    await writeOverlayIfAbsent(home, "p");
    await writeProgressEntry(home, "p", { summary: "옛 일", asked: "옛 요청", did: "옛 결과" });
    await appendDecision(home, "p", newDecision("p", { summary: "옛 결정" }));
    const result = await resetAuthoredStructure(home, "p", new Date("2026-10-07T00:00:00Z"));
    expect(result.archived).toEqual({ progress: 1, decisions: 1 });
    expect((await readProgress(home, "p")).current).toBeNull();
    expect((await readOverlay(home, "p")).decisions).toEqual([]);
    expect(fs.readFileSync(path.join(result.archiveDir, "progress.yaml"), "utf8")).toContain("옛 요청");
    expect(fs.readFileSync(path.join(result.archiveDir, "overlay.authored.yaml"), "utf8")).toContain("옛 결정");
  });
});
