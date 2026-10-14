import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { linkBoardItems, loadBoardView, moveBoardItem, placeBoardItem, removeBoardItem } from "./boardView.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-board-view-"));
}

describe("loadBoardView", () => {
  it("returns 400 without alias and 404 when unregistered", async () => {
    const missing = await loadBoardView(tmpStudioHome(), undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(400);

    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const unknown = await loadBoardView(studioHome, "nope");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(404);
  });

  it("places on the lattice, moves, links, and removes", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });

    const empty = await loadBoardView(studioHome, "demo");
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.body).toEqual({ alias: "demo", items: [], links: [] });

    const first = await placeBoardItem(studioHome, {
      alias: "demo",
      id: "langgraph:flow:draft",
      kind: "langgraph",
      ref: "flow:draft",
      title: "draft",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.body).toMatchObject({
      placed: true,
      items: [{ id: "langgraph:flow:draft", x: 0, y: 0 }],
    });

    const second = await placeBoardItem(studioHome, {
      alias: "demo",
      id: "neo4j:file:README.md",
      kind: "neo4j",
      ref: "README.md",
      title: "README",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.body).toMatchObject({
      placed: true,
      items: expect.arrayContaining([{ id: "neo4j:file:README.md", kind: "neo4j", ref: "README.md", title: "README", x: 220, y: 0 }]),
    });

    const dup = await placeBoardItem(studioHome, {
      alias: "demo",
      id: "langgraph:flow:draft",
      kind: "langgraph",
      ref: "flow:draft",
      title: "ignored",
    });
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.body.placed).toBe(false);

    const moved = await moveBoardItem(studioHome, { alias: "demo", id: "langgraph:flow:draft", x: 12.4, y: 8.6 });
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(moved.body.item).toMatchObject({ x: 12, y: 9 });

    const linked = await linkBoardItems(studioHome, {
      alias: "demo",
      from: "langgraph:flow:draft",
      to: "neo4j:file:README.md",
    });
    expect(linked.ok).toBe(true);
    if (linked.ok) expect(linked.body.linked).toBe(true);

    const self = await linkBoardItems(studioHome, {
      alias: "demo",
      from: "langgraph:flow:draft",
      to: "langgraph:flow:draft",
    });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.status).toBe(400);

    const removed = await removeBoardItem(studioHome, { alias: "demo", id: "langgraph:flow:draft" });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.body.links).toEqual([]);
    expect((removed.body.items as Array<{ id: string }>).map((item) => item.id)).toEqual(["neo4j:file:README.md"]);
  });
});
