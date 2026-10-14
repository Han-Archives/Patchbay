import { describe, expect, it } from "vitest";
import { overlaySchema } from "../types/overlay.js";
import type { Overlay } from "../types/overlay.js";
import { inferredSchema, type Inferred } from "../types/inferred.js";
import { graphFromInferred, nodeFromPort, projectRelPathFromPort } from "./scanGraph.js";

const EMPTY_OVERLAY = overlaySchema.parse({});

describe("nodeFromPort", () => {
  it("maps source/signal to File, skill fileRef to Skill, slug to .skill/", () => {
    expect(nodeFromPort("source:README.md")).toEqual({
      path: "README.md",
      name: "README.md",
      label: "File",
      port: "source:README.md",
      level: 0, // a signal file every project publishes
      text: null,
    });
    expect(nodeFromPort("skill:skills/map-project/SKILL.md")?.label).toBe("Skill");
    expect(nodeFromPort("skill:map-project")).toEqual({
      path: ".skill/map-project",
      name: "map-project",
      label: "Skill",
      port: "skill:map-project",
      // A Bay slug has no project path to grade, so it lands on the working
      // default -- NOT on 0, which the synthetic ".skill/" path would invite.
      level: 2,
      text: null,
    });
    expect(nodeFromPort("artifact:docs/ATLAS.md")?.label).toBe("Artifact");
    expect(nodeFromPort("agent:bot")).toBeNull();
    expect(projectRelPathFromPort("source:lectures/reading.md")).toBe("lectures/reading.md");
    expect(projectRelPathFromPort("skill:skills/diagnose-weakness/SKILL.md")).toBe(
      "skills/diagnose-weakness/SKILL.md",
    );
    expect(projectRelPathFromPort("agent:bot")).toBeNull();
  });

  it("grades a secret path L4 even when it matches a signal-file pattern", () => {
    // Reachable, not theoretical: both of these satisfy findSignalPaths AND a
    // secret rule, which is why the scanner withholds them from
    // discoveredPorts rather than trusting every consumer to filter.
    expect(nodeFromPort("source:.ssh/README.md")?.level).toBe(4);
    expect(nodeFromPort("source:secrets/.cursor/rules/x.mdc")?.level).toBe(4);
    expect(nodeFromPort("source:docs/plan.md")?.level).toBe(2);
  });
});

describe("graphFromInferred", () => {
  it("adds parent folders and CONTAINS, overlay wires as REFERENCES, and skips agents", () => {
    const inferred: Inferred = inferredSchema.parse({
      discoveredPorts: [
        "source:README.md",
        "skill:skills/map-project/SKILL.md",
        "agent:bot",
      ],
      portLevels: {
        "source:README.md": { level: 0, reason: "프로젝트가 공개하는 신호 파일입니다" },
        "skill:skills/map-project/SKILL.md": { level: 2, reason: "프로젝트 작업 파일입니다" },
      },
      git: { branch: "main", head: "abc", recentCommitSubjects: [] },
      agents: [],
    });
    const overlay: Overlay = overlaySchema.parse({
      wires: [
        {
          project: "demo",
          from: "skill:map-project",
          to: "skill:skills/map-project/SKILL.md",
          kind: "uses",
          install: "symlink",
        },
      ],
    });

    const graph = graphFromInferred(inferred, overlay);
    const paths = graph.nodes.map((node) => node.path);
    expect(paths).toEqual([
      ".skill",
      ".skill/map-project",
      "README.md",
      "skills",
      "skills/map-project",
      "skills/map-project/SKILL.md",
    ]);
    expect(graph.nodes.find((n) => n.path === "skills")?.label).toBe("Folder");
    expect(graph.edges).toContainEqual({
      from: "skills",
      to: "skills/map-project",
      kind: "CONTAINS",
    });
    expect(graph.edges).toContainEqual({
      from: "skills/map-project",
      to: "skills/map-project/SKILL.md",
      kind: "CONTAINS",
    });
    expect(graph.edges).toContainEqual({
      from: ".skill/map-project",
      to: "skills/map-project/SKILL.md",
      kind: "REFERENCES",
    });
    expect(graph.nodes.some((n) => n.port === "agent:bot")).toBe(false);

    // The stored verdict from inferred.json wins over a live re-derivation.
    expect(graph.nodes.find((n) => n.path === "README.md")?.level).toBe(0);
    expect(graph.nodes.find((n) => n.path === "skills/map-project/SKILL.md")?.level).toBe(2);
    // A folder is only as public as its most secret child.
    expect(graph.nodes.find((n) => n.path === "skills")?.level).toBe(2);
  });

  it("a folder takes the most secret grade under it, and a level never relaxes on re-upsert", () => {
    const inferred: Inferred = inferredSchema.parse({
      discoveredPorts: ["source:vault/README.md", "source:vault/notes.md"],
      portLevels: {
        // The scanner would withhold an L4 port, so this stands in for a
        // hand-wired overlay endpoint reaching the same folder.
        "source:vault/README.md": { level: 0, reason: "신호 파일" },
        "source:vault/notes.md": { level: 3, reason: "원본" },
      },
      git: { branch: "main", head: "abc", recentCommitSubjects: [] },
      agents: [],
    });

    const graph = graphFromInferred(inferred, EMPTY_OVERLAY);
    expect(graph.nodes.find((n) => n.path === "vault/README.md")?.level).toBe(0);
    expect(graph.nodes.find((n) => n.path === "vault/notes.md")?.level).toBe(3);
    expect(graph.nodes.find((n) => n.path === "vault")?.level).toBe(3);
  });
});
