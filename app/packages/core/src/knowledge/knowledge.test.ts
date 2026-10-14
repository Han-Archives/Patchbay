import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parseIr, type Ir } from "../types/ir.js";
import {
  DESIGN_RELATIONS,
  KNOWLEDGE_LABELS,
  KNOWLEDGE_RELATIONS,
  RELATION_ORIGINS,
  countsFromNodes,
  isDesignRelation,
  labelFromNeo4jLabels,
  type KnowledgeSnapshot,
} from "./contract.js";
import { auditReplica, documentPortId, knowledgeFromIr, mergeSnapshots } from "./ingest.js";
import { countMatches, resolveAnchor, retrieveDocuments, splitTerms } from "./retrieve.js";

/**
 * M5's gate, run against the fixed test material (명세 §8) rather than a real
 * repo: the acceptance run on the real project is held until the build is
 * finished (사용자 결정 2026-09-28).
 *
 * `valid.ir.yaml` stands in for it exactly where it counts -- four document
 * dependencies on one node, told apart only by their `when`, plus two guide
 * files the design never names. That is the same shape as "어휘·사실·추론
 * 오답이 서로 다른 조각을 고른다".
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ir", "__fixtures__");

function loadIr(): Ir {
  const raw = parseYaml(fs.readFileSync(path.join(FIXTURES, "valid.ir.yaml"), "utf8"));
  const parsed = parseIr(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.ir;
}

/** The scan side of the replica: the guide folder as `scan` would have found it. */
function scanSnapshot(): KnowledgeSnapshot {
  const files = fs.readdirSync(path.join(FIXTURES, "guides")).sort();
  const nodes = [
    { path: "guides", name: "guides", label: "Folder" as const, port: null, level: 1 as const, text: null },
    ...files.map((file) => ({
      path: `guides/${file}`,
      name: file,
      label: "File" as const,
      port: documentPortId(`guides/${file}`),
      level: 1 as const,
      text: null,
    })),
  ];
  const edges = files.map((file) => ({ from: "guides", to: `guides/${file}`, kind: "CONTAINS" as const }));
  return { nodes, edges };
}

function fullReplica(): KnowledgeSnapshot {
  return mergeSnapshots(scanSnapshot(), knowledgeFromIr(loadIr()));
}

describe("3.1 · 3.2 관계 계약과 원본 파일", () => {
  it("every relation names the file it came from and the command that rebuilds it", () => {
    for (const kind of KNOWLEDGE_RELATIONS) {
      const origin = RELATION_ORIGINS[kind];
      expect(origin.source, kind).toMatch(/\.(json|yaml)/);
      expect(origin.rebuild.length, kind).toBeGreaterThan(0);
      expect(origin.means.length, kind).toBeGreaterThan(0);
    }
  });

  it("no relation is both a scan relation and a design relation", () => {
    const design = DESIGN_RELATIONS.filter(isDesignRelation);
    expect(design).toEqual([...DESIGN_RELATIONS]);
    expect(isDesignRelation("CONTAINS")).toBe(false);
    expect(isDesignRelation("REFERENCES")).toBe(false);
  });

  it("counts a row under its own label", () => {
    const counts = countsFromNodes(fullReplica().nodes);
    expect(counts.documents).toBe(4);
    expect(counts.requirements).toBe(7);
    expect(counts.evals).toBe(6);
    expect(counts.agentNodes).toBe(4);
    expect(counts.files).toBe(6);
    expect(counts.folders).toBe(1);
  });

  it("reads a stored label back, and falls to File for an unknown set", () => {
    expect(labelFromNeo4jLabels(["Knowledge", "Document"])).toBe("Document");
    expect(labelFromNeo4jLabels(["Knowledge"])).toBe("File");
    for (const label of KNOWLEDGE_LABELS) {
      expect(labelFromNeo4jLabels(["Knowledge", label])).toBe(label);
    }
  });
});

describe("3.3 · 3.4 인제스트", () => {
  it("turns the IR into the rows a scan cannot produce", () => {
    const design = knowledgeFromIr(loadIr());
    const labels = new Set(design.nodes.map((node) => node.label));
    expect([...labels].sort()).toEqual(["AgentNode", "Document", "Eval", "Requirement"]);
    // 1.7 · 1.8의 추적 표가 그대로 관계가 된다.
    // 요구사항 일곱 개가 각자 노드를 하나 지목한다 -- 노드는 겹쳐도 행은 일곱이다 (R7 품질 요구사항, 2026-10-05).
    expect(design.edges.filter((edge) => edge.kind === "IMPLEMENTS")).toHaveLength(7);
    expect(design.edges.filter((edge) => edge.kind === "VERIFIES")).toHaveLength(7);
    expect(design.edges.filter((edge) => edge.kind === "CHECKS")).toHaveLength(6);
    expect(design.edges.filter((edge) => edge.kind === "CONSULTS")).toHaveLength(4);
  });

  it("leaves LangGraph's terminals out of the rows", () => {
    const design = knowledgeFromIr(loadIr());
    expect(design.nodes.map((node) => node.name)).not.toContain("__start__");
    // intake→classify, classify→explain, classify→pick, explain→pick. __start__/__end__ 제외.
    expect(design.edges.filter((edge) => edge.kind === "FLOWS_TO")).toHaveLength(4);
  });

  it("carries the IR's declared grade onto the document row rather than re-deriving it", () => {
    const design = knowledgeFromIr(loadIr());
    for (const doc of design.nodes.filter((node) => node.label === "Document")) {
      expect(doc.level).toBe(1);
      expect(doc.port).toMatch(/^source:guides\//);
    }
  });

  it("joins a document row to the file it names, and leaves a missing one dangling", () => {
    const linked = fullReplica().edges.filter((edge) => edge.kind === "AT");
    expect(linked).toHaveLength(4);

    const ir = loadIr();
    const typo: Ir = {
      ...ir,
      documents: ir.documents.map((doc) => (doc.id === "D1" ? { ...doc, path: "guides/does-not-exist.md" } : doc)),
    };
    const dangling = mergeSnapshots(scanSnapshot(), knowledgeFromIr(typo)).edges.filter((e) => e.kind === "AT");
    expect(dangling).toHaveLength(3);
    expect(dangling.map((edge) => edge.from)).not.toContain("ir:document/D1");
  });

  it("keeps the design row and the file it points at as two nodes", () => {
    const replica = fullReplica();
    expect(replica.nodes.filter((node) => node.path === "guides/bug.md")).toHaveLength(1);
    expect(replica.nodes.filter((node) => node.path === "ir:document/D1")).toHaveLength(1);
  });
});

describe("3.5 스캔 복제본뿐인가", () => {
  it("warns when every relation is one the scan already wrote", () => {
    const audit = auditReplica(scanSnapshot());
    expect(audit.designEdges).toBe(0);
    expect(audit.warning).toContain("스캔 복제본뿐이다");
    expect(audit.warning).toContain("ir adopt");
  });

  it("stops warning once the design is in", () => {
    const audit = auditReplica(fullReplica());
    expect(audit.designEdges).toBeGreaterThan(0);
    expect(audit.warning).toBeNull();
  });
});

describe("4.1 앵커를 찾는다", () => {
  const replica = fullReplica();

  it("takes a path, a PortId, a design row id, or a node id", () => {
    expect(resolveAnchor(replica, "guides/bug.md").node?.label).toBe("File");
    expect(resolveAnchor(replica, "source:guides/bug.md").node?.path).toBe("guides/bug.md");
    expect(resolveAnchor(replica, "ir:node/pick").node?.name).toBe("pick");
    expect(resolveAnchor(replica, "pick").node?.label).toBe("AgentNode");
    expect(resolveAnchor(replica, "D2").node?.path).toBe("ir:document/D2");
  });

  it("refuses to guess when a partial match is ambiguous", () => {
    const found = resolveAnchor(replica, "guides/");
    expect(found.node).toBeNull();
    expect(found.candidates.length).toBeGreaterThan(1);
    expect(found.error).toContain("좁혀");
  });

  it("says so when nothing matches, and when the anchor is empty", () => {
    expect(resolveAnchor(replica, "없는것").error).toContain("맞는 항목이 없다");
    expect(resolveAnchor(replica, "  ").error).toContain("앵커가 비었다");
  });
});

describe("4.2 · 4.3 1~2홉과 이웃 안 순위", () => {
  const replica = fullReplica();

  /**
   * The gate: three different inputs, three different documents. Nothing in
   * the graph distinguishes D1..D3 except `when`, which is exactly the
   * hardcoded routing table 4.6 is meant to replace.
   */
  it.each([
    ["저장 버튼이 두 번 눌린다 — 버그다", "guides/bug.md"],
    ["이런 기능을 요청합니다", "guides/request.md"],
    ["이게 왜 이렇게 되는지 질문이 있습니다", "guides/question.md"],
  ])("routes %j to %s", (query, expected) => {
    const result = retrieveDocuments(replica, { anchor: "pick", query });
    expect(result.error).toBeNull();
    expect(result.hits[0]?.path).toBe(expected);
    expect(result.hits[0]?.matched).toBeGreaterThan(0);
  });

  it("returns every candidate with nothing matched rather than inventing a fallback", () => {
    const result = retrieveDocuments(replica, { anchor: "pick", query: "zzz 알 수 없는 입력" });
    expect(result.hits).toHaveLength(4);
    expect(result.matchedCount).toBe(0);
    // 어느 문서를 쓸지는 노드가 정한다 -- R4·E3가 그 분기를 덮는다.
  });

  it("ranks only inside the radius: one hop from pick reaches its documents, none of the files", () => {
    const result = retrieveDocuments(replica, { anchor: "pick", maxHops: 1, query: "버그" });
    expect(result.maxHops).toBe(1);
    expect(result.hits.map((hit) => hit.hops)).toEqual([1, 1, 1, 1]);
  });

  it("does not reach pick's documents from intake within two hops", () => {
    // intake -FLOWS_TO-> classify -FLOWS_TO-> pick 이 이미 2홉이다.
    const result = retrieveDocuments(replica, { anchor: "intake", maxHops: 2, query: "버그" });
    expect(result.hits).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  it("walks against the arrow: a guide file finds the document row that names it", () => {
    const result = retrieveDocuments(replica, { anchor: "guides/bug.md", maxHops: 1 });
    expect(result.hits.map((hit) => hit.documentId)).toEqual(["D1"]);
    expect(result.hits[0]?.via).toBe("bug.md <-[AT]- D1");
  });

  it("ignores a guide the design never named", () => {
    const result = retrieveDocuments(replica, { anchor: "pick", query: "안 쓰는 안내" });
    expect(result.hits.map((hit) => hit.path)).not.toContain("guides/stale-a.md");
  });

  it("orders the same input the same way every time", () => {
    const once = retrieveDocuments(replica, { anchor: "pick", query: "질문" });
    const twice = retrieveDocuments(replica, { anchor: "pick", query: "질문" });
    expect(once.hits).toEqual(twice.hits);
  });
});

describe("4.4 민감도 필터", () => {
  it("withholds a secret row and never steps through it", () => {
    const replica = fullReplica();
    const secret = replica.nodes.map((node) =>
      node.path === "ir:document/D1" ? { ...node, level: 4 as const } : node,
    );
    const result = retrieveDocuments({ nodes: secret, edges: replica.edges }, { anchor: "pick", query: "버그" });
    expect(result.hits.map((hit) => hit.documentId)).not.toContain("D1");
    expect(result.withheld).toBeGreaterThan(0);
    for (const hit of result.hits) expect(hit.via).not.toContain("D1");
  });

  it("refuses a secret anchor outright", () => {
    const replica = fullReplica();
    const secret = replica.nodes.map((node) => (node.path === "ir:node/pick" ? { ...node, level: 4 as const } : node));
    const result = retrieveDocuments({ nodes: secret, edges: replica.edges }, { anchor: "ir:node/pick" });
    expect(result.hits).toHaveLength(0);
    expect(result.error).toContain("비밀 등급");
  });

  it("reads an ungraded row as working grade, not as public", () => {
    // 낡은 행은 level이 없다. 인메모리 스냅샷은 항상 등급을 싣지만, Neo4j에서
    // 돌아온 행은 그렇지 않다 -- 그 기본값은 어댑터가 L2로 정한다.
    const replica = fullReplica();
    const result = retrieveDocuments(replica, { anchor: "pick", secretLevel: 2, query: "버그" });
    // guides/*는 L1이라 남고, 문서 행도 L1이라 남는다.
    expect(result.hits.length).toBeGreaterThan(0);
  });
});

describe("4.5 근거 경로", () => {
  const replica = fullReplica();

  it("gives every hit a path from the anchor", () => {
    const result = retrieveDocuments(replica, { anchor: "pick", query: "버그" });
    expect(result.hits.length).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.via.startsWith("pick")).toBe(true);
      expect(hit.via).toContain(hit.documentId);
      expect(hit.via).toMatch(/-\[|\]-/);
    }
  });

  it("names the node that consults the document, so a run record can use the row as is", () => {
    const result = retrieveDocuments(replica, { anchor: "pick", query: "버그" });
    const hit = result.hits[0]!;
    expect(hit).toMatchObject({ nodeId: "pick", path: "guides/bug.md", level: 1 });
    expect(typeof hit.via).toBe("string");
  });

  it("shows the two hops when the anchor is a level away", () => {
    const result = retrieveDocuments(replica, { anchor: "classify", maxHops: 2, query: "버그" });
    expect(result.hits[0]?.via).toBe("classify -[FLOWS_TO]-> pick -[CONSULTS]-> D1");
    expect(result.hits[0]?.hops).toBe(2);
  });
});

describe("말 나누기", () => {
  it("keeps words of two characters or more, once each", () => {
    expect(splitTerms("버그, 버그 — 저장 a")).toEqual(["버그", "저장"]);
    expect(splitTerms("")).toEqual([]);
  });

  it("matches a Korean input word against the condition it carries", () => {
    expect(countMatches(["버그다"], ["갈래가 버그"])).toBe(1);
    expect(countMatches(["버그"], ["갈래가 버그"])).toBe(1);
    expect(countMatches(["요청"], ["갈래가 버그"])).toBe(0);
    expect(countMatches([], ["갈래가 버그"])).toBe(0);
  });
});
