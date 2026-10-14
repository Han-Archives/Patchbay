import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parseIr, type Ir } from "../types/ir.js";
import {
  SCAFFOLD_FILES,
  compareNodeSets,
  extractGraphNodeIds,
  generateScaffoldSources,
} from "./generate.js";
import { writeScaffold } from "../studio/generateScaffold.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function loadValid(): Ir {
  const parsed = parseIr(parseYaml(fs.readFileSync(path.join(FIXTURES, "valid.ir.yaml"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.ir;
}

describe("generateScaffoldSources", () => {
  const ir = loadValid();
  const sources = generateScaffoldSources(ir);

  it("고정 자료에서 생성한 세 파일이 스냅샷과 같다", async () => {
    await expect(sources[SCAFFOLD_FILES.state]).toMatchFileSnapshot(
      path.join(FIXTURES, "scaffold", SCAFFOLD_FILES.state),
    );
    await expect(sources[SCAFFOLD_FILES.graph]).toMatchFileSnapshot(
      path.join(FIXTURES, "scaffold", SCAFFOLD_FILES.graph),
    );
    await expect(sources[SCAFFOLD_FILES.evals]).toMatchFileSnapshot(
      path.join(FIXTURES, "scaffold", SCAFFOLD_FILES.evals),
    );
  });

  it("생성한 그래프의 노드 집합이 IR과 같다", () => {
    const nodes = compareNodeSets(ir, sources[SCAFFOLD_FILES.graph]);
    expect(nodes).toMatchObject({
      ir: ["intake", "classify", "explain", "pick"],
      graph: ["intake", "classify", "explain", "pick"],
      missing: [],
      extra: [],
      match: true,
    });
  });

  it("노드 껍데기에 그 노드가 쓰는 권한이 주석으로 들어간다", () => {
    const graph = sources[SCAFFOLD_FILES.graph];
    expect(graph).toContain("권한: cap:draft (write-draft)");
    expect(graph).toContain("권한: cap:external (claude-opus-5)");
    expect(graph).toContain("노드 내부는 아직 비어 있다 (2.4)");
  });

  it("되돌릴 수 없는 툴이 있으면 사람 확인 스텁을 넣는다", () => {
    const gated = structuredClone(ir);
    const pick = gated.nodes.find((node) => node.id === "pick");
    if (!pick) throw new Error("pick");
    pick.tools = [...pick.tools, "edit-guide"];
    const graph = generateScaffoldSources(gated)[SCAFFOLD_FILES.graph];
    expect(graph).toContain("async function humanGate");
    expect(graph).toContain('await humanGate("edit-guide")');
    expect(graph).toContain("사람 확인: edit-guide");
  });

  it("실패하는 평가 테스트가 eval id를 빠뜨리지 않는다", () => {
    const tests = sources[SCAFFOLD_FILES.evals];
    for (const evaluation of ir.evals) {
      expect(tests).toContain(evaluation.id);
    }
    expect(tests).toContain("고정 응답 어댑터로만 재현한다");
  });
});

describe("extractGraphNodeIds", () => {
  it("addNode 호출만 읽고 START/END는 버린다", () => {
    expect(
      extractGraphNodeIds(`
        graph.addNode("__start__", x)
        graph.addNode("intake", intake)
        graph.addNode('pick', pick)
      `),
    ).toEqual(["intake", "pick"]);
  });
});

describe("writeScaffold", () => {
  const ir = loadValid();
  const docRoot = FIXTURES;

  it("없는 디렉터리에 세 파일을 쓰고, 두 번째는 덮지 않는다", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scaffold-"));
    const first = await writeScaffold(ir, out, { docRoot });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.written.sort()).toEqual(Object.values(SCAFFOLD_FILES).slice().sort());
    expect(first.skipped).toEqual([]);

    const graphPath = path.join(out, SCAFFOLD_FILES.graph);
    const original = fs.readFileSync(graphPath, "utf8");
    fs.writeFileSync(graphPath, original.replace("받아적기", "사람이 고친 라벨"), "utf8");

    const second = await writeScaffold(ir, out, { docRoot });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.written).toEqual([]);
    expect(second.skipped.map((row) => row.file).sort()).toEqual(
      Object.values(SCAFFOLD_FILES).slice().sort(),
    );
    expect(fs.readFileSync(graphPath, "utf8")).toContain("사람이 고친 라벨");
  });

  it("기존 graph.ts의 노드 집합이 IR과 다르면 덮지 않고 어긋남을 말한다", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scaffold-drift-"));
    const first = await writeScaffold(ir, out, { docRoot });
    expect(first.ok).toBe(true);

    const graphPath = path.join(out, SCAFFOLD_FILES.graph);
    fs.writeFileSync(
      graphPath,
      fs.readFileSync(graphPath, "utf8").replace(`.addNode("pick", pick)`, `.addNode("other", pick)`),
      "utf8",
    );
    const drifted = await writeScaffold(ir, out, { docRoot });
    expect(drifted.ok).toBe(false);
    if (drifted.ok) return;
    expect(drifted.error).toContain("노드 집합이 IR과 다르다");
    expect(drifted.nodes?.missing).toEqual(["pick"]);
    expect(drifted.nodes?.extra).toEqual(["other"]);
    expect(drifted.skipped?.some((row) => row.file === SCAFFOLD_FILES.graph)).toBe(true);
  });

  it("검사가 막힌 IR은 파일을 만들지 않는다", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scaffold-fail-"));
    const broken = structuredClone(ir);
    broken.models = [];
    const result = await writeScaffold(broken, out, { docRoot });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("1.2");
    expect(fs.readdirSync(out)).toEqual([]);
  });
});

describe("생성기 — 실제 설계에서 깨진 것 (2026-10-07)", async () => {
  const { tsType, evalInputField, generateEvalsTestTs } = await import("./generate.js");
  it("느슨한 타입 낱말은 TypeScript 타입으로, 처음 값이 null 이면 null 을 더한다", () => {
    expect(tsType({ type: "array", default: "[]" })).toBe("unknown[]");
    expect(tsType({ type: "object", default: "null" })).toBe("Record<string, unknown> | null");
    expect(tsType({ type: "string", default: '""' })).toBe("string");
    expect(tsType({ type: "BaseMessage[]", default: "[]" })).toBe("BaseMessage[]");
    expect(tsType({ type: "string | null", default: "null" })).toBe("string | null");
  });
  it("시험 입력 칸은 받는 개념을 가리키는 칸 → input → 첫 단계가 읽는 칸, 없으면 주석", () => {
    const base = { concepts: [], state: [{ field: "sheet", type: "string", reducer: "lastWrite", default: '""' }], nodes: [{ id: "a", label: "a", reads: ["sheet"], writes: [], models: [], tools: [], documents: [] }], edges: [{ from: "__start__", to: "a" }] };
    expect(evalInputField(base as never)?.field).toBe("sheet");
    const none = { ...base, state: [], nodes: [{ ...base.nodes[0], reads: [] }] };
    expect(evalInputField(none as never)).toBeNull();
    const text = generateEvalsTestTs({ ...none, version: 1, project: "p", graph: "", evals: [{ id: "E1", node: "a", kind: "deterministic", input: "x", expect: "y" }] } as never);
    expect(text).toContain('// 입력: "x"');
    expect(text).not.toContain("input:");
  });
});
