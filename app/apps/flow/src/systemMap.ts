import fs from "node:fs/promises";
import path from "node:path";
import { architectureRel } from "./boardContract.js";
import type { SystemMap } from "./testContract.js";

/** 프로젝트 소유 아키텍처 원본만 사용한다. 없으면 공통 구조를 만들어내지 않는다. */
export async function readSystemMap(repo: string, docs = "docs"): Promise<SystemMap | null> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(repo, architectureRel(docs)), "utf8"));
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;
    const nodes = raw.nodes.filter((n: any) => typeof n.id === "string" && typeof n.label === "string" && typeof n.layer === "string").map((n: any) => ({ id: n.id, label: n.label, layer: n.layer, ref: typeof n.ref === "string" ? n.ref : undefined, detail: Array.isArray(n.detail) ? n.detail.filter((d: unknown) => Array.isArray(d) && d.length === 2 && d.every(v => typeof v === "string")) : [] }));
    const ids = new Set(nodes.map((n: { id: string }) => n.id));
    const edges = raw.edges.filter((e: any) => ids.has(e.from) && ids.has(e.to)).map((e: any) => ({ from: e.from, to: e.to, label: typeof e.label === "string" ? e.label : undefined }));
    return { nodes, edges };
  } catch { return null; }
}
