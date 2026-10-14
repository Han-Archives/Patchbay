import { describe, expect, it } from "vitest";
import { emptyCounts } from "@patchbay/core";
import { createMemoryNeo4jPort } from "./neo4jAdapter.js";
import type { KnowledgeNodeView, KnowledgeSnapshot } from "./neo4jContract.js";

const file = (path: string, name: string): KnowledgeNodeView => ({
  path,
  name,
  label: "File",
  port: `source:${path}`,
  level: 2,
  text: null,
});

const SAMPLE: KnowledgeSnapshot = {
  nodes: [
    file("README.md", "README.md"),
    { path: "docs", name: "docs", label: "Folder", port: null, level: 2, text: null },
    file("docs/a.md", "a.md"),
  ],
  edges: [{ from: "docs", to: "docs/a.md", kind: "CONTAINS" }],
};

describe("createMemoryNeo4jPort", () => {
  it("searches by path/name/port without embeddings and drops deleted paths on replace", async () => {
    const port = createMemoryNeo4jPort();
    await port.replaceAlias("demo", SAMPLE);
    const hits = await port.search("demo", "readme");
    expect(hits.map((n) => n.path)).toEqual(["README.md"]);
    expect(await port.counts("demo")).toEqual({ ...emptyCounts(), files: 2, folders: 1 });

    const hood = await port.neighborhood("demo", "docs/a.md");
    expect(hood.selected?.path).toBe("docs/a.md");
    expect(hood.neighbors.map((n) => n.path)).toEqual(["docs"]);

    await port.replaceAlias("demo", { nodes: [file("README.md", "README.md")], edges: [] });
    expect(await port.search("demo", "docs")).toEqual([]);
    expect((await port.search("demo", "")).map((n) => n.path)).toEqual(["README.md"]);
  });

  it("keeps aliases apart", async () => {
    const port = createMemoryNeo4jPort();
    await port.replaceAlias("demo", SAMPLE);
    await port.replaceAlias("notes", { nodes: [file("notes.md", "notes.md")], edges: [] });
    expect((await port.search("notes", "")).map((n) => n.path)).toEqual(["notes.md"]);
    expect(await port.search("demo", "notes.md")).toEqual([]);
  });

  /**
   * The design rows are the reason 3.5 exists, so the replica has to hold them
   * and their relations -- not only the four labels a scan produces.
   */
  it("holds a design row, counts it under its own label, and finds it by its sentence", async () => {
    const port = createMemoryNeo4jPort();
    await port.replaceAlias("demo", {
      nodes: [
        { path: "ir:node/pick", name: "pick", label: "AgentNode", port: null, level: 1, text: "안내 문서 고르기" },
        {
          path: "ir:document/D1",
          name: "D1",
          label: "Document",
          port: "source:guides/bug.md",
          level: 1,
          text: "갈래가 버그",
        },
        file("guides/bug.md", "bug.md"),
      ],
      edges: [
        { from: "ir:node/pick", to: "ir:document/D1", kind: "CONSULTS" },
        { from: "ir:document/D1", to: "guides/bug.md", kind: "AT" },
      ],
    });

    expect(await port.counts("demo")).toEqual({ ...emptyCounts(), files: 1, agentNodes: 1, documents: 1 });
    // 조건 문장으로 찾힌다 -- 파일 이름에는 "갈래"가 없다.
    expect((await port.search("demo", "갈래가 버그")).map((n) => n.name)).toEqual(["D1"]);

    const hood = await port.neighborhood("demo", "ir:document/D1");
    expect(hood.edges.map((edge) => edge.kind).sort()).toEqual(["AT", "CONSULTS"]);
  });
});
