import type { Ir } from "../types/ir.js";

/**
 * What changed between the approved IR and a draft, counted per section.
 *
 * Sections rather than a text diff: the question before adopting is *which
 * part of the design moved* -- did a node appear, did the State shift -- and
 * that is what decides which gates go stale (명세 §7.3). A line diff answers a
 * different question and buries this one.
 */

const IDENTIFIED = ["caps", "tools", "models", "state", "nodes", "documents", "requirements", "evals"] as const;
type IdentifiedSection = (typeof IDENTIFIED)[number];

const idOf = (section: IdentifiedSection, entry: Record<string, unknown>): string =>
  String(section === "state" ? entry.field : entry.id);

export interface IrSectionDiff {
  section: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export interface IrDiff {
  sections: IrSectionDiff[];
  scalars: string[];
  /** Nothing moved -- adopting would change only the version number. */
  identical: boolean;
}

export function diffIr(current: Ir, proposed: Ir): IrDiff {
  const sections: IrSectionDiff[] = [];
  for (const section of IDENTIFIED) {
    const before = new Map(
      (current[section] as Array<Record<string, unknown>>).map((entry) => [idOf(section, entry), entry]),
    );
    const after = new Map(
      (proposed[section] as Array<Record<string, unknown>>).map((entry) => [idOf(section, entry), entry]),
    );
    const added = [...after.keys()].filter((key) => !before.has(key));
    const removed = [...before.keys()].filter((key) => !after.has(key));
    const changed = [...after.keys()].filter(
      (key) => before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)),
    );
    if (added.length || removed.length || changed.length) sections.push({ section, added, removed, changed });
  }

  // 엣지와 추적 표에는 id가 없다 — 줄 자체가 정체성이라 개수로만 센다.
  for (const name of ["edges", "requirementLinks"] as const) {
    const before = new Set(current[name].map((entry) => JSON.stringify(entry)));
    const after = new Set(proposed[name].map((entry) => JSON.stringify(entry)));
    const added = [...after].filter((key) => !before.has(key)).length;
    const removed = [...before].filter((key) => !after.has(key)).length;
    if (added || removed) {
      sections.push({ section: name, added: added ? [`${added}줄`] : [], removed: removed ? [`${removed}줄`] : [], changed: [] });
    }
  }

  const scalars: string[] = [];
  for (const key of ["project", "graph", "goal"] as const) {
    if (current[key] !== proposed[key]) scalars.push(`${key}: ${current[key]} → ${proposed[key]}`);
  }
  if (JSON.stringify(current.why) !== JSON.stringify(proposed.why)) scalars.push("why: 바뀜 — 1.0이 바뀌면 전부 무효다");
  if (JSON.stringify(current.done) !== JSON.stringify(proposed.done)) scalars.push("done: 바뀜");

  return { sections, scalars, identical: sections.length === 0 && scalars.length === 0 };
}
