import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSystemMap } from "./systemMap.js";

describe("project system architecture", () => {
  it("keeps project-owned components and drops dangling connections", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "system-map-"));
    try {
      await fs.mkdir(path.join(repo, "docs/기획"), { recursive: true });
      await fs.writeFile(path.join(repo, "docs/기획/아키텍처.json"), JSON.stringify({ nodes: [{ id: "app", label: "실제 앱", layer: "화면", detail: [["역할", "입력"], [4, false]] }, { id: "db", label: "실제 저장소", layer: "저장" }, { id: 7 }], edges: [{ from: "app", to: "db" }, { from: "app", to: "missing" }] }));
      const map = await readSystemMap(repo);
      expect(map?.nodes.map(n => n.label)).toEqual(["실제 앱", "실제 저장소"]);
      expect(map?.nodes[0]?.detail).toEqual([["역할", "입력"]]);
      expect(map?.edges).toHaveLength(1);
    } finally { await fs.rm(repo, { recursive: true, force: true }); }
  });
  it("does not fabricate architecture for an unregistered map", async () => {
    expect(await readSystemMap("/path/that/does/not/exist")).toBeNull();
  });
});
