import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  bucketKeyFromNodeId,
  bucketOf,
  buildAtlasLayout,
  cableLabel,
  defaultCollapsedBuckets,
  focusNeighbourhood,
  folderNodeId,
  shortLabel,
  type AtlasSectionsView,
  type FolderData,
  type JackData,
} from "./atlasGraphLayout.js";

const wire = (from: string, to: string, kind = "reads") => ({ from, to, kind });

const emptySections: AtlasSectionsView = {
  skills: [],
  rules: [],
  unlabeledPorts: [],
  matched: [],
  patchesWithoutWire: [],
  wiresWithoutPatch: [],
};

/**
 * Shaped like a real registered project's overlay: every cable leaves `skills/`
 * for a resource folder, and most wire endpoints are NOT in discoveredPorts.
 * Under the old status-based grouping those endpoints all fell into one "기타"
 * bucket, which is the bug this layout exists to fix.
 */
const sections: AtlasSectionsView = {
  ...emptySections,
  unlabeledPorts: ["skill:skills/next-slot/SKILL.md", "skill:skills/study-day/SKILL.md"],
  rules: ["source:README.md"],
  wiresWithoutPatch: [
    wire("skill:skills/next-slot/SKILL.md", "source:docs/자료/유형.md"),
    wire("skill:skills/study-day/SKILL.md", "source:docs/자료/유형.md"),
    wire("skill:skills/study-day/SKILL.md", "source:docs/기획/실행.md"),
    wire("skill:skills/next-slot/SKILL.md", "source:drills/next-slot.md", "produces"),
  ],
};

function folders(nodes: Node[]): Array<Node<FolderData>> {
  return nodes.filter((node): node is Node<FolderData> => node.type === "folder");
}
function jacks(nodes: Node[]): Array<Node<JackData>> {
  return nodes.filter((node): node is Node<JackData> => node.type === "jack");
}

describe("shortLabel", () => {
  it("uses the alias itself for a short logical port", () => {
    expect(shortLabel("skill:map-project")).toBe("map-project");
  });

  it("uses the skill's directory name, not the shared SKILL.md filename", () => {
    expect(shortLabel("skill:dev/packages/skills/adopt-project/SKILL.md")).toBe("adopt-project");
  });

  it("falls back to the last path segment for a non-SKILL.md port", () => {
    expect(shortLabel("source:README.md")).toBe("README.md");
  });
});

describe("bucketOf", () => {
  it("groups by the port's top-level folder", () => {
    expect(bucketOf("source:docs/자료/유형.md")).toBe("docs");
    expect(bucketOf("skill:skills/next-slot/SKILL.md")).toBe("skills");
    expect(bucketOf("source:보관/완료/2주차/1일.md")).toBe("보관");
  });

  it("puts a repo-root file in its own bucket, not a folder that does not exist", () => {
    expect(bucketOf("source:README.md")).toBe("(루트)");
  });

  it("a bay slug is not a path in this repo, so it gets its own bucket", () => {
    expect(bucketOf("skill:map-project")).toBe("스킬 베이");
  });
});

describe("bucketKeyFromNodeId", () => {
  it("round-trips a folder key through its node id", () => {
    expect(bucketKeyFromNodeId(folderNodeId("docs"))).toBe("docs");
    expect(bucketKeyFromNodeId(folderNodeId("(루트)"))).toBe("(루트)");
  });

  it("returns null for a plain jack node id (a port string, not a container)", () => {
    expect(bucketKeyFromNodeId("skill:map-project")).toBeNull();
  });
});

describe("buildAtlasLayout: grouping", () => {
  it("groups by folder, so wire endpoints land in real folders instead of one 기타 bucket", () => {
    const layout = buildAtlasLayout(sections, new Set());
    expect(folders(layout.nodes).map((node) => node.data.label)).toEqual(
      expect.arrayContaining(["skills", "docs", "drills", "(루트)"]),
    );
    expect(folders(layout.nodes).map((node) => node.data.label)).not.toContain("기타");
  });

  it("counts every port once across containers", () => {
    const layout = buildAtlasLayout(sections, new Set());
    expect(layout.portCount).toBe(6); // 2 skills + README + 2 docs + 1 drill
    expect(jacks(layout.nodes)).toHaveLength(6);
    expect(layout.bucketCount).toBe(4);
  });

  it("orders containers producers-first -- skills emits every cable here", () => {
    const layout = buildAtlasLayout(sections, new Set());
    expect(folders(layout.nodes)[0]!.data.label).toBe("skills");
  });

  it("puts producers in a left lane and consumers in a right one", () => {
    const layout = buildAtlasLayout(sections, defaultCollapsedBuckets(sections));
    const xOf = (label: string) =>
      folders(layout.nodes).find((node) => node.data.label === label)!.position.x;
    const producer = xOf("skills");
    for (const consumer of ["docs", "drills", "(루트)"]) {
      expect(xOf(consumer)).toBeGreaterThan(producer);
    }
    // Consumers share one lane rather than stacking into a diagonal.
    expect(xOf("docs")).toBe(xOf("drills"));
  });

  it("spills a lane into another column once it grows too tall", () => {
    const wide: AtlasSectionsView = {
      ...emptySections,
      rules: Array.from({ length: 40 }, (_, i) => `source:f${String(i).padStart(2, "0")}/a.md`),
    };
    const layout = buildAtlasLayout(wide, defaultCollapsedBuckets(wide));
    const columns = new Set(folders(layout.nodes).map((node) => node.position.x));
    expect(columns.size).toBeGreaterThan(1);
  });
});

describe("cableLabel", () => {
  it("names a single kind, and counts it once there is more than one cable", () => {
    expect(cableLabel(new Map([["reads", 1]]))).toBe("reads");
    expect(cableLabel(new Map([["reads", 14]]))).toBe("reads ×14");
  });

  it("drops the kind when a pair carries several, so the label stays short", () => {
    expect(cableLabel(new Map([["reads", 14], ["produces", 10], ["uses", 2]]))).toBe("×26");
  });
});

describe("buildAtlasLayout: containers", () => {
  it("every jack is a child of its folder container, clamped inside it", () => {
    const layout = buildAtlasLayout(sections, new Set());
    for (const jack of jacks(layout.nodes)) {
      expect(jack.parentId).toBe(folderNodeId(bucketOf(jack.id)));
      expect(jack.extent).toBe("parent");
    }
  });

  it("a parent container precedes its children (XYFlow requires it)", () => {
    const layout = buildAtlasLayout(sections, new Set());
    for (const jack of jacks(layout.nodes)) {
      const parentIndex = layout.nodes.findIndex((node) => node.id === jack.parentId);
      const childIndex = layout.nodes.findIndex((node) => node.id === jack.id);
      expect(parentIndex).toBeGreaterThanOrEqual(0);
      expect(parentIndex).toBeLessThan(childIndex);
    }
  });

  it("a container is tall enough for the rows it holds, and shrinks when collapsed", () => {
    const open = buildAtlasLayout(sections, new Set());
    const shut = buildAtlasLayout(sections, new Set(["skills"]));
    const openSkills = folders(open.nodes).find((node) => node.data.label === "skills")!;
    const shutSkills = folders(shut.nodes).find((node) => node.data.label === "skills")!;
    expect(openSkills.height).toBeGreaterThan(shutSkills.height!);
    expect(jacks(shut.nodes).some((jack) => jack.parentId === folderNodeId("skills"))).toBe(false);
  });

  it("keeps the Atlas status on each jack as a property, not as the grouping", () => {
    const layout = buildAtlasLayout(sections, new Set());
    const byId = new Map(jacks(layout.nodes).map((node) => [node.id, node.data.status]));
    expect(byId.get("skill:skills/next-slot/SKILL.md")).toBe("unlabeled");
    expect(byId.get("source:README.md")).toBe("source");
    expect(byId.get("source:docs/자료/유형.md")).toBe("other");
  });
});

describe("buildAtlasLayout: cables", () => {
  it("draws file-to-file cables while both folders are open", () => {
    const layout = buildAtlasLayout(sections, new Set());
    const cable = layout.edges.find((edge) => edge.target === "source:drills/next-slot.md");
    expect(cable).toMatchObject({ source: "skill:skills/next-slot/SKILL.md", label: "produces" });
  });

  it("redirects a collapsed folder's cables to its container and merges duplicates", () => {
    const layout = buildAtlasLayout(sections, new Set(["docs"]));
    const merged = layout.edges.find(
      (edge) => edge.target === folderNodeId("docs") && edge.source === "skill:skills/study-day/SKILL.md",
    );
    // study-day reads two different docs files; collapsed they are one cable.
    expect(merged?.label).toBe("reads ×2");
  });

  it("drops a cable that would start and end in the same collapsed container", () => {
    const selfish: AtlasSectionsView = {
      ...emptySections,
      wiresWithoutPatch: [wire("source:docs/a.md", "source:docs/b.md")],
    };
    expect(buildAtlasLayout(selfish, new Set(["docs"])).edges).toEqual([]);
    expect(buildAtlasLayout(selfish, new Set()).edges).toHaveLength(1);
  });
});

describe("defaultCollapsedBuckets", () => {
  it("starts every folder collapsed, so the first frame is a folder map", () => {
    const collapsed = defaultCollapsedBuckets(sections);
    expect([...collapsed].sort()).toEqual(["(루트)", "docs", "drills", "skills"]);
  });

  it("an explicit threshold still opens the folders under it", () => {
    const many: AtlasSectionsView = {
      ...emptySections,
      rules: Array.from({ length: 9 }, (_, i) => `source:docs/f${i}.md`),
      unlabeledPorts: ["skill:skills/one/SKILL.md"],
    };
    const collapsed = defaultCollapsedBuckets(many, 8);
    expect(collapsed.has("docs")).toBe(true);
    expect(collapsed.has("skills")).toBe(false);
  });

  it("an empty project collapses nothing and lays out nothing", () => {
    expect(defaultCollapsedBuckets(emptySections).size).toBe(0);
    const layout = buildAtlasLayout(emptySections, new Set());
    expect(layout).toMatchObject({ nodes: [], edges: [], portCount: 0, bucketCount: 0 });
  });
});

describe("focus mode", () => {
  const STUDY = "skill:skills/study-day/SKILL.md";
  const NEXT = "skill:skills/next-slot/SKILL.md";
  const TYPES = "source:docs/자료/유형.md";

  it("a neighbourhood is the port plus whatever it cables to, either direction", () => {
    expect([...focusNeighbourhood(sections, STUDY)].sort()).toEqual(
      [STUDY, "source:docs/기획/실행.md", TYPES].sort(),
    );
    // 유형.md is only ever a cable's target; the walk still finds its readers.
    expect([...focusNeighbourhood(sections, TYPES)].sort()).toEqual([NEXT, STUDY, TYPES].sort());
  });

  it("draws only the focused port's cables, not the whole graph", () => {
    const all = buildAtlasLayout(sections, new Set());
    const focused = buildAtlasLayout(sections, new Set(), NEXT);
    expect(all.edges.length).toBeGreaterThan(focused.edges.length);
    for (const edge of focused.edges) {
      expect([edge.source, edge.target]).toContain(NEXT);
    }
  });

  it("lights the neighbourhood and dims the rest, without removing anything", () => {
    const layout = buildAtlasLayout(sections, new Set(), STUDY);
    const byId = new Map(jacks(layout.nodes).map((node) => [node.id, node.data]));
    expect(byId.get(STUDY)).toMatchObject({ focused: true, dimmed: false });
    expect(byId.get(TYPES)).toMatchObject({ focused: false, dimmed: false });
    expect(byId.get(NEXT)).toMatchObject({ focused: false, dimmed: true });
    // Dimmed, not dropped -- the map keeps its shape so nothing jumps.
    expect(jacks(layout.nodes)).toHaveLength(jacks(buildAtlasLayout(sections, new Set()).nodes).length);
  });

  it("dims a folder only when none of its files are in the neighbourhood", () => {
    const layout = buildAtlasLayout(sections, new Set(), STUDY);
    const byLabel = new Map(folders(layout.nodes).map((node) => [node.data.label, node.data.dimmed]));
    expect(byLabel.get("docs")).toBe(false);
    expect(byLabel.get("skills")).toBe(false); // holds the focused skill
    expect(byLabel.get("drills")).toBe(true);
  });

  it("no focus leaves every node lit", () => {
    const layout = buildAtlasLayout(sections, new Set(), null);
    expect(jacks(layout.nodes).every((node) => !node.data.dimmed && !node.data.focused)).toBe(true);
    expect(folders(layout.nodes).every((node) => !node.data.dimmed)).toBe(true);
  });
});

describe("port info on jacks", () => {
  const NEXT = "skill:skills/next-slot/SKILL.md";
  const info = {
    [NEXT]: { path: "skills/next-slot/SKILL.md", summary: "다음날 첫 슬롯을 고른다." },
    "source:README.md": { path: null, summary: "" },
  };

  it("carries the summary and the openable path onto the jack", () => {
    const layout = buildAtlasLayout(sections, new Set(), null, info);
    const byId = new Map(jacks(layout.nodes).map((node) => [node.id, node.data]));
    expect(byId.get(NEXT)).toMatchObject({
      summary: "다음날 첫 슬롯을 고른다.",
      openPath: "skills/next-slot/SKILL.md",
    });
  });

  it("a port with no file has no openPath, so the UI cannot offer to open it", () => {
    const layout = buildAtlasLayout(sections, new Set(), null, info);
    const readme = jacks(layout.nodes).find((node) => node.id === "source:README.md")!;
    expect(readme.data).toMatchObject({ openPath: null, summary: "" });
  });

  it("omitting the map leaves every jack blank rather than throwing", () => {
    const layout = buildAtlasLayout(sections, new Set());
    expect(jacks(layout.nodes).every((node) => node.data.summary === "" && node.data.openPath === null)).toBe(
      true,
    );
  });
});
