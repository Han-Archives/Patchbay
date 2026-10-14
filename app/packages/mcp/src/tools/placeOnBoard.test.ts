import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBoard, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson, resultText } from "../testSupport.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-place-board-"));
}

describe("place_on_board (in-process MCP)", () => {
  it("writes board.yaml and no-ops on the same id", async () => {
    const studioHome = tmpStudioHome();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const first = await callTool(client, "place_on_board", {
        alias: "demo",
        id: "port:source:README.md",
        kind: "port",
        ref: "source:README.md",
        title: "README",
        x: 40,
        y: 80,
      });
      expect(first.isError).toBeFalsy();
      const placed = resultJson(first) as { placed: true; item: { x: number; y: number } };
      expect(placed.placed).toBe(true);
      expect(placed.item.x).toBe(40);
      expect(placed.item.y).toBe(80);

      const boardPath = path.join(studioHome, "projects", "demo", "board.yaml");
      expect(fs.existsSync(boardPath)).toBe(true);

      const second = await callTool(client, "place_on_board", {
        alias: "demo",
        id: "port:source:README.md",
        kind: "port",
        ref: "source:README.md",
        title: "other title",
      });
      const skipped = resultJson(second) as { placed: false; reason: string };
      expect(skipped.placed).toBe(false);
      expect(skipped.reason).toBe("already_on_board");

      const board = await readBoard(studioHome, "demo");
      expect(board.items).toHaveLength(1);
      expect(board.items[0]?.title).toBe("README");
    } finally {
      await close();
    }
  });

  it("errors for an unknown kind or unregistered alias", async () => {
    const studioHome = tmpStudioHome();
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const { client, close } = await connectInProcess(studioHome);
    try {
      const badKind = await callTool(client, "place_on_board", {
        alias: "demo",
        id: "x",
        kind: "canvas",
        ref: "x",
        title: "x",
      });
      expect(badKind.isError).toBe(true);

      const missing = await callTool(client, "place_on_board", {
        alias: "nope",
        id: "x",
        kind: "port",
        ref: "x",
        title: "x",
      });
      expect(missing.isError).toBe(true);
      expect(resultText(missing)).toContain("No project registered");
    } finally {
      await close();
    }
  });
});
