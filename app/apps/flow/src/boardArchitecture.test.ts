import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureStudioInitialized, readBoard, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import {
  ARCH_COL_W,
  ARCH_ORIGIN_X,
  architectureRel,
  architectureItemId,
  layoutArchitecture,
  parseArchitectureMap,
  placeArchitectureMap,
} from "./boardArchitecture.js";

const SAMPLE = {
  title: "아키텍처 구조",
  nodes: [
    { id: "structure", label: "아키텍처 구조", layer: "맵", ref: "docs/기획/아키텍처.md", detail: [["한 줄", "스튜디오"]] },
    { id: "core", label: "커널", layer: "커널", ref: "dev/packages/core/src/index.ts", detail: [] },
  ],
  edges: [{ from: "structure", to: "core" }],
};

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-arch-"));
}

// Patchbay 자신의 아키텍처 맵은 비공개 기록층에 있다 — 공개 레포(파일 없음)에서는 이 두 시험을 건너뛴다.
const REAL_ARCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../workspace/records/patchbay/기획/아키텍처.json");
const HAS_REAL_ARCH = fs.existsSync(REAL_ARCH);

describe("parseArchitectureMap", () => {
  it.skipIf(!HAS_REAL_ARCH)("parses the Patchbay repo architecture file", () => {
    const abs = REAL_ARCH;
    const map = parseArchitectureMap(JSON.parse(fs.readFileSync(abs, "utf8")));
    expect("error" in map).toBe(false);
    if ("error" in map) return;
    expect(map.title).toBe("아키텍처 구조");
    expect(map.nodes[0]?.id).toBe("structure");
    expect(map.nodes.length).toBeGreaterThan(20);
    expect(map.edges.length).toBeGreaterThan(20);
  });
  it("keeps title, nodes, and edges and drops unknown endpoints", () => {
    const map = parseArchitectureMap({
      ...SAMPLE,
      edges: [...SAMPLE.edges, { from: "structure", to: "missing" }, { from: "core", to: "core" }],
    });
    expect("error" in map).toBe(false);
    if ("error" in map) return;
    expect(map.title).toBe("아키텍처 구조");
    expect(map.nodes.map((node) => node.id)).toEqual(["structure", "core"]);
    expect(map.edges).toEqual([{ from: "structure", to: "core" }]);
  });

  it("rejects a node whose ref escapes the project", () => {
    const map = parseArchitectureMap({
      title: "x",
      nodes: [{ id: "a", label: "A", layer: "맵", ref: "../secret", detail: [] }],
      edges: [],
    });
    expect(map).toEqual({ error: 'architecture: ref must be a relative project path (a).' });
  });
});

describe("layoutArchitecture", () => {
  it("puts children one column to the right of their parent", () => {
    const map = parseArchitectureMap(SAMPLE);
    if ("error" in map) throw new Error(map.error);
    const pos = layoutArchitecture(map.nodes, map.edges);
    expect(pos.get("structure")).toEqual({ x: ARCH_ORIGIN_X, y: 24 });
    expect(pos.get("core")).toEqual({ x: ARCH_ORIGIN_X + ARCH_COL_W, y: 24 });
  });
});

describe("placeArchitectureMap", () => {
  it("places arch: items and links from the project JSON", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-arch-repo-"));
    fs.mkdirSync(path.join(repo, "docs", "기획"), { recursive: true });
    fs.writeFileSync(path.join(repo, architectureRel()), JSON.stringify(SAMPLE));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });

    const first = await placeArchitectureMap(studioHome, { alias: "demo" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.body.placed).toBe(2);
    expect(first.body.linked).toBe(1);
    expect(first.body.title).toBe("아키텍처 구조");

    const board = await readBoard(studioHome, "demo");
    expect(board.items.map((item) => item.id)).toEqual([
      architectureItemId("structure"),
      architectureItemId("core"),
    ]);
    expect(board.items[0]).toMatchObject({
      kind: "port",
      ref: "source:docs/기획/아키텍처.md",
      title: "아키텍처 구조",
    });
    expect(board.links).toEqual([
      { from: architectureItemId("structure"), to: architectureItemId("core") },
    ]);

    const again = await placeArchitectureMap(studioHome, { alias: "demo" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.body.placed).toBe(0);
    expect(again.body.linked).toBe(0);
  });

  it.skipIf(!HAS_REAL_ARCH)("places the real Patchbay map onto a temp studio board", async () => {
    const studioHome = tmpStudioHome();
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    await ensureStudioInitialized(studioHome);
    // Patchbay 자신은 문서 폴더가 비공개 기록층이다 — 등록부 `docs` 칸이 경로를 정한다.
    await registerProject(studioHome, { alias: "patchbay", kind: "local_repo", path: repo, docs: "workspace/records/patchbay" });
    const result = await placeArchitectureMap(studioHome, { alias: "patchbay" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.title).toBe("아키텍처 구조");
    expect(Number(result.body.placed)).toBeGreaterThan(20);
    const board = await readBoard(studioHome, "patchbay");
    expect(board.items[0]?.title).toBe("아키텍처 구조");
    expect(board.items.every((item) => item.id.startsWith("arch:"))).toBe(true);
  });

  it("POST /api/board/architecture writes the same board", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-arch-http-"));
    fs.mkdirSync(path.join(repo, "docs", "기획"), { recursive: true });
    fs.writeFileSync(path.join(repo, architectureRel()), JSON.stringify(SAMPLE));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    const { createFlowApp } = await import("./server.js");
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/board/architecture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; items: Array<{ title: string }> };
    expect(body.title).toBe("아키텍처 구조");
    expect(body.items.map((item) => item.title)).toEqual(["아키텍처 구조", "커널"]);
    await app.close();
  });

  it("returns 404 when the architecture file is missing", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-arch-empty-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    const result = await placeArchitectureMap(studioHome, { alias: "demo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});
