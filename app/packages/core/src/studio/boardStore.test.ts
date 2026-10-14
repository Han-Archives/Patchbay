import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerProject } from "./studioStore.js";
import {
  linkOnBoard,
  moveOnBoard,
  placeOnBoard,
  readBoard,
  removeFromBoard,
  replacePrefixedBoardSlice,
  unlinkOnBoard,
} from "./boardStore.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-board-store-"));
}

describe("board.yaml", () => {
  it("readBoard returns empty items/links when the file is missing", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    expect(await readBoard(home, "demo")).toEqual({ items: [], links: [] });
  });

  it("placeOnBoard appends an item and is a no-op for the same id without rewriting", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const first = await placeOnBoard(home, "demo", {
      id: "port:source:README.md",
      kind: "port",
      ref: "source:README.md",
      title: "README",
      x: 120,
      y: 80,
    });
    expect(first.placed).toBe(true);
    if (!first.placed) return;
    expect(first.item).toEqual({
      id: "port:source:README.md",
      kind: "port",
      ref: "source:README.md",
      title: "README",
      x: 120,
      y: 80,
    });
    expect(fs.existsSync(first.path)).toBe(true);

    const before = fs.readFileSync(first.path, "utf8");
    const second = await placeOnBoard(home, "demo", {
      id: "port:source:README.md",
      kind: "port",
      ref: "source:README.md",
      title: "ignored retitle",
      x: 0,
      y: 0,
    });
    expect(second.placed).toBe(false);
    if (second.placed) return;
    expect(second.reason).toBe("already_on_board");
    expect(second.item.title).toBe("README");
    expect(fs.readFileSync(first.path, "utf8")).toBe(before);
  });

  it("defaults omitted coordinates to 0 and rejects an unregistered alias", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const placed = await placeOnBoard(home, "demo", {
      id: "neo4j:file:docs/a.md",
      kind: "neo4j",
      ref: "docs/a.md",
      title: "a.md",
    });
    expect(placed.placed).toBe(true);
    if (placed.placed) {
      expect(placed.item.x).toBe(0);
      expect(placed.item.y).toBe(0);
    }

    await expect(
      placeOnBoard(home, "nope", { id: "x", kind: "port", ref: "x", title: "x" }),
    ).rejects.toThrow(/No project registered/);
  });

  it("moveOnBoard updates coordinates and skips a rewrite when unchanged", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await placeOnBoard(home, "demo", {
      id: "port:source:README.md",
      kind: "port",
      ref: "source:README.md",
      title: "README",
      x: 0,
      y: 0,
    });
    const moved = await moveOnBoard(home, "demo", "port:source:README.md", 40, 80);
    expect(moved.moved).toBe(true);
    if (!moved.moved) return;
    expect(moved.item).toMatchObject({ x: 40, y: 80 });
    const before = fs.readFileSync(moved.path, "utf8");
    const again = await moveOnBoard(home, "demo", "port:source:README.md", 40, 80);
    expect(again.moved).toBe(false);
    if (again.moved) return;
    expect(again.reason).toBe("unchanged");
    expect(fs.readFileSync(moved.path, "utf8")).toBe(before);
    const missing = await moveOnBoard(home, "demo", "port:missing", 1, 1);
    expect(missing).toMatchObject({ moved: false, reason: "not_on_board" });
  });

  it("linkOnBoard is directed, rejects self/missing ends, and unlinks; remove drops incident links", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await placeOnBoard(home, "demo", {
      id: "langgraph:flow:draft",
      kind: "langgraph",
      ref: "flow:draft",
      title: "draft",
    });
    await placeOnBoard(home, "demo", {
      id: "neo4j:file:README.md",
      kind: "neo4j",
      ref: "README.md",
      title: "README",
    });

    const self = await linkOnBoard(home, "demo", "langgraph:flow:draft", "langgraph:flow:draft");
    expect(self).toMatchObject({ linked: false, reason: "self" });
    const dangling = await linkOnBoard(home, "demo", "langgraph:flow:draft", "nope");
    expect(dangling).toMatchObject({ linked: false, reason: "missing_endpoint" });

    const linked = await linkOnBoard(home, "demo", "langgraph:flow:draft", "neo4j:file:README.md");
    expect(linked.linked).toBe(true);
    if (!linked.linked) return;
    const before = fs.readFileSync(linked.path, "utf8");
    const dup = await linkOnBoard(home, "demo", "langgraph:flow:draft", "neo4j:file:README.md");
    expect(dup).toMatchObject({ linked: false, reason: "already_linked" });
    expect(fs.readFileSync(linked.path, "utf8")).toBe(before);

    const unlinked = await unlinkOnBoard(home, "demo", "langgraph:flow:draft", "neo4j:file:README.md");
    expect(unlinked.unlinked).toBe(true);
    expect((await readBoard(home, "demo")).links).toEqual([]);
    const unlinkedAgain = await unlinkOnBoard(home, "demo", "langgraph:flow:draft", "neo4j:file:README.md");
    expect(unlinkedAgain).toMatchObject({ unlinked: false, reason: "not_linked" });

    await linkOnBoard(home, "demo", "langgraph:flow:draft", "neo4j:file:README.md");
    const removed = await removeFromBoard(home, "demo", "langgraph:flow:draft");
    expect(removed.removed).toBe(true);
    expect(await readBoard(home, "demo")).toEqual({
      items: [{ id: "neo4j:file:README.md", kind: "neo4j", ref: "README.md", title: "README", x: 0, y: 0 }],
      links: [],
    });
    const removedAgain = await removeFromBoard(home, "demo", "langgraph:flow:draft");
    expect(removedAgain).toMatchObject({ removed: false, reason: "not_on_board" });
  });

  it("replacePrefixedBoardSlice updates titles, drops removed ids, and keeps other items", async () => {
    const home = tmpStudioHome();
    await registerProject(home, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    await placeOnBoard(home, "demo", {
      id: "neo4j:file:README.md",
      kind: "neo4j",
      ref: "README.md",
      title: "README",
      x: 9,
      y: 9,
    });
    await placeOnBoard(home, "demo", {
      id: "arch:a",
      kind: "port",
      ref: "source:a.md",
      title: "A",
      x: 40,
      y: 80,
    });
    await placeOnBoard(home, "demo", {
      id: "arch:b",
      kind: "port",
      ref: "source:b.md",
      title: "B",
      x: 1,
      y: 1,
    });

    const synced = await replacePrefixedBoardSlice(home, "demo", "arch:", {
      items: [
        { id: "arch:a", kind: "port", ref: "source:a2.md", title: "A2", x: 0, y: 0 },
        { id: "arch:c", kind: "port", ref: "source:c.md", title: "C", x: 12, y: 34 },
      ],
      links: [{ from: "arch:a", to: "arch:c" }],
    });
    expect(synced.changed).toBe(true);
    expect(synced).toMatchObject({ added: 1, updated: 1, removed: 1, linked: 1 });
    expect(synced.board.items).toEqual([
      { id: "neo4j:file:README.md", kind: "neo4j", ref: "README.md", title: "README", x: 9, y: 9 },
      { id: "arch:a", kind: "port", ref: "source:a2.md", title: "A2", x: 40, y: 80 },
      { id: "arch:c", kind: "port", ref: "source:c.md", title: "C", x: 12, y: 34 },
    ]);
    expect(synced.board.links).toEqual([{ from: "arch:a", to: "arch:c" }]);

    const again = await replacePrefixedBoardSlice(home, "demo", "arch:", {
      items: synced.board.items.filter((item) => item.id.startsWith("arch:")),
      links: synced.board.links,
    });
    expect(again.changed).toBe(false);
    expect(again.path).toBeNull();
  });
});
