import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendWire,
  ensureStudioInitialized,
  inferredSchema,
  placeOnBoard,
  recordProgressWrite,
  registerProject,
  type Wire,
  writeInferred,
  writeOverlayIfAbsent,
  writeProgressEntry,
  writeProgressMd,
} from "@patchbay/core";
import { afterEach, describe, expect, it } from "vitest";
import type { StudioEvent } from "./eventsContract.js";
import { startStudioWatch, type StudioWatch } from "./studioWatch.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-studio-watch-"));
}

const SAMPLE_INFERRED = inferredSchema.parse({
  discoveredPorts: ["skill:map-project", "source:README.md"],
  git: { branch: "main", head: "abc1234", recentCommitSubjects: ["init"] },
  agents: [],
});

async function seedScanned(studioHome: string, alias: string): Promise<void> {
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias, kind: "local_repo", path: "/tmp/does-not-matter" });
  await writeOverlayIfAbsent(studioHome, alias);
  await writeInferred(studioHome, alias, SAMPLE_INFERRED);
}

async function waitForEvent(
  events: StudioEvent[],
  match: StudioEvent,
  timeoutMs = 8000,
): Promise<void> {
  await expect
    .poll(() => events.some((item) => item.event === match.event && item.alias === match.alias), {
      timeout: timeoutMs,
    })
    .toBe(true);
}

async function startReadyWatch(studioHome: string, events: StudioEvent[]): Promise<StudioWatch> {
  const created = startStudioWatch(studioHome, (event) => events.push(event));
  await created.ready;
  await new Promise((resolve) => setTimeout(resolve, 300));
  events.length = 0;
  return created;
}

describe("startStudioWatch", () => {
  let watch: StudioWatch | undefined;

  afterEach(async () => {
    await watch?.close();
    watch = undefined;
  });

  it("emits progress when writeProgressEntry updates progress.yaml", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo");
    const events: StudioEvent[] = [];
    watch = await startReadyWatch(studioHome, events);

    await writeProgressEntry(studioHome, "demo", { summary: "sse progress probe" });
    await waitForEvent(events, { event: "progress", alias: "demo" });
  }, 15_000);

  it("emits inferred, overlay, and board for those files", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo");
    const events: StudioEvent[] = [];
    watch = await startReadyWatch(studioHome, events);

    await writeInferred(studioHome, "demo", SAMPLE_INFERRED);
    await waitForEvent(events, { event: "inferred", alias: "demo" });

    await appendWire(studioHome, "demo", {
      project: "demo",
      from: "skill:map-project",
      to: "skill:skills/map-project/SKILL.md",
      kind: "uses",
      install: "symlink",
    } as Wire);
    await waitForEvent(events, { event: "overlay", alias: "demo" });

    fs.writeFileSync(path.join(studioHome, "projects", "demo", "board.yaml"), "items: []\nlinks: []\n");
    await waitForEvent(events, { event: "board", alias: "demo" });
  }, 15_000);

  it("does not emit for PROGRESS.md", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo");
    const events: StudioEvent[] = [];
    watch = await startReadyWatch(studioHome, events);

    await writeProgressMd(studioHome, "demo", "# Progress\n");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(events).toEqual([]);
  }, 15_000);

  it("stops emitting after close", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo");
    const events: StudioEvent[] = [];
    watch = await startReadyWatch(studioHome, events);
    await watch.close();
    watch = undefined;

    await writeProgressEntry(studioHome, "demo", { summary: "after close" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(events).toEqual([]);
  });

  it("emits progress and board after Core recordProgressWrite and placeOnBoard", async () => {
    const studioHome = tmpStudioHome();
    await seedScanned(studioHome, "demo");
    const events: StudioEvent[] = [];
    watch = await startReadyWatch(studioHome, events);

    await recordProgressWrite(studioHome, "demo", { summary: "mcp-equivalent write" });
    await waitForEvent(events, { event: "progress", alias: "demo" });

    await placeOnBoard(studioHome, "demo", {
      id: "port:source:README.md",
      kind: "port",
      ref: "source:README.md",
      title: "README",
    });
    await waitForEvent(events, { event: "board", alias: "demo" });
  }, 15_000);
});
