import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, placeOnBoard, readOverlay, registerProject, writeOverlayIfAbsent } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { defaultConsoleSkillSlug } from "./skillContract.js";
import { acceptSkillDraftView, distillSkillDraft, patchSkillView } from "./skillView.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-skill-view-"));
}

describe("distillSkillDraft", () => {
  it("returns 400 without alias or board items and 404 when unregistered", async () => {
    expect(await distillSkillDraft(tmpStudioHome(), {})).toMatchObject({ ok: false, status: 400 });
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    expect(await distillSkillDraft(studioHome, { alias: "nope" })).toMatchObject({ ok: false, status: 404 });
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    expect(await distillSkillDraft(studioHome, { alias: "demo" })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("writes a draft then accept confirms it", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await placeOnBoard(studioHome, "demo", {
      id: "neo4j:file:README.md",
      kind: "neo4j",
      ref: "README.md",
      title: "README",
    });
    expect(defaultConsoleSkillSlug("demo")).toBe("from-demo");
    const drafted = await distillSkillDraft(studioHome, { alias: "demo" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.body.slug).toBe("from-demo");
    const accepted = await acceptSkillDraftView(studioHome, { slug: "from-demo" });
    expect(accepted.ok).toBe(true);
  });
});

describe("patchSkillView — 「프로젝트에 설치」", () => {
  it("확정한 스킬을 프로젝트 skills/ 에 놓고 실제 연결을 기록한다", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-patch-repo-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    await writeOverlayIfAbsent(studioHome, "demo");
    await placeOnBoard(studioHome, "demo", { id: "neo4j:file:README.md", kind: "neo4j", ref: "README.md", title: "README" });
    await distillSkillDraft(studioHome, { alias: "demo" });
    await acceptSkillDraftView(studioHome, { slug: "from-demo" });

    const result = await patchSkillView(studioHome, { slug: "from-demo", alias: "demo" });
    expect(result).toMatchObject({ ok: true, body: { slug: "from-demo", to: "skill:skills/from-demo/SKILL.md" } });
    expect(fs.existsSync(path.join(repo, "skills", "from-demo", "SKILL.md"))).toBe(true);
    const wires = (await readOverlay(studioHome, "demo")).wires;
    expect(wires.map((wire) => [wire.from, wire.to])).toEqual([["skill:from-demo", "skill:skills/from-demo/SKILL.md"]]);
  });

  it("확정 안 된 스킬 · 모르는 프로젝트는 404, 이름이 없으면 400 — 아무것도 쓰지 않는다", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    expect(await patchSkillView(studioHome, { slug: "ghost", alias: "demo" })).toMatchObject({ ok: false, status: 404 });
    expect(await patchSkillView(studioHome, { alias: "demo" })).toMatchObject({ ok: false, status: 400 });
    expect((await readOverlay(studioHome, "demo")).wires).toEqual([]);
  });
});

