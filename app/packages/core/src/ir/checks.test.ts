import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parseIr, type Ir } from "../types/ir.js";
import { runIrChecks, summarizeIrChecks } from "./checks.js";
import { invalidatedBy, invalidatedGates } from "./invalidation.js";

/**
 * The fixtures are the contract's own proof (명세 §8): `valid.ir.yaml` must pass
 * every check, and each case in `fail-cases.yaml` must break the check it
 * names. A suite with only passing fixtures stays green even when a check
 * stops checking anything.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const readYaml = (file: string): unknown => parseYaml(fs.readFileSync(path.join(FIXTURES, file), "utf8"));

function loadValid(): Ir {
  const parsed = parseIr(readYaml("valid.ir.yaml"));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.ir;
}

interface FailCase {
  check: string;
  why: string;
  ops: Array<Record<string, unknown>>;
}

/** `a.b[0].c` -> the containing object/array and the final key. */
function resolvePath(root: unknown, dotted: string): { node: Record<string, unknown>; key: string | number } {
  const parts = dotted.replace(/\[(\d+)\]/g, ".$1").split(".");
  let node = root as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    node = (Array.isArray(node) ? node[Number(part)] : node[part]) as Record<string, unknown>;
  }
  const last = parts.at(-1)!;
  return { node, key: Array.isArray(node) ? Number(last) : last };
}

function applyOps(ir: Ir, ops: FailCase["ops"]): unknown {
  const next = structuredClone(ir) as unknown;
  for (const op of ops) {
    if ("set" in op) {
      const { node, key } = resolvePath(next, op.set as string);
      (node as Record<string | number, unknown>)[key] = op.to;
    } else if ("delete" in op) {
      const { node, key } = resolvePath(next, op.delete as string);
      if (Array.isArray(node)) node.splice(Number(key), 1);
      else delete node[key as string];
    } else if ("append" in op) {
      const { node } = resolvePath(next, `${op.append as string}.0`);
      (node as unknown as unknown[]).push(op.item);
    } else {
      throw new Error(`모르는 op: ${JSON.stringify(op)}`);
    }
  }
  return next;
}

describe("IR 고정 시험 자료", () => {
  it("유효 자료가 43개 검사를 전부 통과한다 — 2026-10-05에 0.0 다섯 · 1.1 지표 · 1.2 감독 · 1.4 개념 · 1.7 둘, 10-06 3판에 1.2 둘 · 1.3 둘, 10-08에 1.2 모델 사용처 · 1.4 입력 칸 · 1.5 노드 읽기가 더해졌다", () => {
    const summary = summarizeIrChecks(runIrChecks(loadValid(), { docRoot: FIXTURES }));
    expect(summary.failed).toEqual([]);
    expect(summary.skipped).toEqual([]);
    expect(summary.passed).toBe(true);
    expect(summary.checks).toHaveLength(43);
  });

  it("문서 루트가 없으면 1.6의 파일 검사 둘을 건너뛴다 — 통과로 세지 않는다", () => {
    const summary = summarizeIrChecks(runIrChecks(loadValid()));
    expect(summary.skipped).toEqual(["1.6/doc-exists", "1.6/doc-coverage"]);
    expect(summary.passed).toBe(true);
  });

  it("검사마다 실패 자료가 하나씩 있다", () => {
    const { cases } = readYaml("fail-cases.yaml") as { cases: FailCase[] };
    const ids = runIrChecks(loadValid(), { docRoot: FIXTURES }).map((result) => result.id);
    expect([...new Set(cases.map((entry) => entry.check))].sort()).toEqual([...ids].sort());
  });

  it.each((readYaml("fail-cases.yaml") as { cases: FailCase[] }).cases.map((entry) => [entry.check, entry] as const))(
    "%s — 지목한 검사를 깨뜨린다",
    (checkId, failCase) => {
      const mutated = applyOps(loadValid(), failCase.ops);
      const parsed = parseIr(mutated);
      // 값 영역이 좁은 몇 가지(cap id · EARS 패턴 · done 비움)는 스키마가 먼저 막는다.
      // 그래도 DRC를 건너뛰지 않는다 — 건너뛰면 그 검사는 영영 안 돌고 초록으로 남는다.
      // M4 생성기처럼 parseIr를 거치지 않고 IR을 만드는 길도 있으므로 두 층 다 잡아야 한다.
      const ir = parsed.ok ? parsed.ir : (mutated as Ir);
      const summary = summarizeIrChecks(runIrChecks(ir, { docRoot: FIXTURES }));
      expect(summary.failed).toContain(checkId);
    },
  );
});

describe("스키마와 DRC가 겹치는 자리", () => {
  const schemaCaught = ["1.1/done-judgeable", "1.2/caps-known", "1.4/reducer-default", "1.7/ears-pattern"];

  it.each(schemaCaught)("%s — 스키마도 막고, 그 뒤에도 DRC가 같은 칸을 지목한다", (checkId) => {
    const { cases } = readYaml("fail-cases.yaml") as { cases: FailCase[] };
    const failCase = cases.find((entry) => entry.check === checkId)!;
    const mutated = applyOps(loadValid(), failCase.ops);

    // 스키마는 형식 오류로 거절한다 — 사람에게는 이 메시지가 먼저 보인다.
    expect(parseIr(mutated).ok).toBe(false);
    // DRC는 돌아갈 칸을 지목한다 — 이쪽이 「어디로 돌아가나」에 답한다.
    const summary = summarizeIrChecks(runIrChecks(mutated as Ir, { docRoot: FIXTURES }));
    expect(summary.failed).toContain(checkId);
    expect(summary.failedGates).toContain(checkId.split("/")[0]);
  });
});

describe("무효 전파 (§7.3)", () => {
  it("목적이 바뀌면 전부 무효다", () => {
    expect(invalidatedBy("1.0")).toContain("1.8");
    expect(invalidatedBy("1.1")).toContain("1.5");
  });

  it("권한은 노드와 문서를, State는 노드와 평가를 무효로 만든다", () => {
    expect(invalidatedBy("1.2")).toEqual(["1.5", "1.6"]);
    expect(invalidatedBy("1.4")).toEqual(["1.5", "1.8"]);
    expect(invalidatedBy("1.7")).toEqual(["1.8"]);
    expect(invalidatedBy("1.8")).toEqual([]);
  });

  it("이미 실패한 칸은 무효 목록에 다시 넣지 않는다", () => {
    expect(invalidatedGates(["1.2", "1.5"])).toEqual(["1.6"]);
  });
});

describe("1.2/env-language — 대소문자", () => {
  it("TypeScript · TS 도 통과한다", async () => {
    const { parse } = await import("yaml");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { parseIr } = await import("../types/ir.js");
    const raw = parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__/valid.ir.yaml"), "utf8"));
    for (const language of ["TypeScript", "TS"]) {
      const parsed = parseIr({ ...raw, environment: { ...raw.environment, language } });
      if (!parsed.ok) throw new Error(parsed.error);
      expect(runIrChecks(parsed.ir).find((c) => c.id === "1.2/env-language")?.ok).toBe(true);
    }
  });
});
