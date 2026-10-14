import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseIr, readIrFile } from "@patchbay/core";
import { toIrCanvas, stateTraffic } from "./irCanvas.js";
import type { Ir } from "./irContract.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/core/src/ir/__fixtures__/valid.ir.yaml",
);

// YAML 은 Core 가 읽는다 — 콘솔에 파서를 하나 더 두지 않는다 (원칙 8).
let loaded: Ir;
const fixture = (): Ir => loaded;

beforeAll(async () => {
  const read = await readIrFile(FIXTURE);
  if (!read.ok) throw new Error(read.error);
  const parsed = parseIr(read.raw);
  if (!parsed.ok) throw new Error(parsed.error);
  loaded = parsed.ir;
});

describe("toIrCanvas", () => {
  it("선언된 노드와 두 터미널을 함께 그린다 — 도달성 검사가 재는 대상이 보여야 한다", () => {
    const { nodes } = toIrCanvas(fixture());
    const ids = nodes.map((node) => node.id);
    expect(ids).toContain("__start__");
    expect(ids).toContain("__end__");
    expect(ids).toContain("explain");
    expect(nodes.find((node) => node.id === "__start__")?.data.terminal).toBe(true);
  });

  it("모델을 부르는 노드에 표시를 남긴다 — 1.2의 권한이 무는 자리다", () => {
    const { nodes } = toIrCanvas(fixture());
    expect(nodes.find((node) => node.id === "explain")?.className).toBe("ir-node-model");
    expect(nodes.find((node) => node.id === "explain")?.data.models).toEqual(["claude-opus-5"]);
  });

  it("분기 조건은 엣지 라벨로 남는다", () => {
    const { edges } = toIrCanvas(fixture());
    const branch = edges.find((edge) => edge.source === "classify" && edge.target === "pick");
    expect(branch?.label).toContain("거절");
    expect(branch?.className).toBe("ir-edge-branch");
  });

  it("엣지 id는 같은 두 노드를 잇는 선이 둘이어도 겹치지 않는다", () => {
    const { edges } = toIrCanvas(fixture());
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
  });
});

describe("stateTraffic", () => {
  it("칸마다 읽는 노드와 쓰는 노드를 센다", () => {
    const traffic = stateTraffic(fixture());
    expect(traffic.get("reason")?.writers).toEqual(["explain"]);
    expect(traffic.get("reason")?.readers).toEqual(["pick"]);
    expect(traffic.get("input")?.writers).toEqual(["intake"]);
  });
});
