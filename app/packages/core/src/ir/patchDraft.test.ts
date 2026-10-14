import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { parseIr } from "../types/ir.js";
import { draftProgress, renderIrSkeleton } from "./draft.js";
import { IR_CELL_FIELDS } from "./fields.js";
import { patchDraftCell } from "./patchDraft.js";

/**
 * 칸을 화면에서 채우는 길.
 *
 * 핵심 둘: 고쳐 써도 **주석이 남아야** 하고, 1단계 중의 불완전한 초안을
 * **거절하지 않아야** 한다. 무엇이 옳은 설계인가는 DRC가 뒤에서 정한다.
 */

const SKELETON = () => renderIrSkeleton("demo", "triage");

function patch(text: string, cell: string, values: Record<string, unknown>): string {
  const result = patchDraftCell(text, cell, values);
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

describe("칸 고쳐 쓰기", () => {
  it("칸 구분선과 사람이 적은 메모가 남는다", () => {
    const withNote = SKELETON().replace("goal:", "# 이건 사람이 적어 둔 메모\ngoal:");
    const out = patch(withNote, "1.1", { goal: "오답 하나에 조각 하나", done: ["조각 경로가 존재한다"] });
    expect(out).toContain("# 이건 사람이 적어 둔 메모");
    expect(out).toContain("# ── 1.2 권한 경계");
    expect(out).toContain("# ── 1.8 평가");
  });

  it("한 칸을 쓰면 다른 칸은 건드리지 않는다", () => {
    const first = patch(SKELETON(), "1.1", { goal: "목적", done: ["조건"] });
    const second = patch(first, "1.4", {
      state: [{ field: "messages", type: "BaseMessage[]", reducer: "append", default: "[]" }],
    });
    const doc = parseYaml(second) as Record<string, unknown>;
    expect(doc.goal).toBe("목적");
    expect(doc.done).toEqual(["조건"]);
    expect(doc.state).toEqual([{ field: "messages", type: "BaseMessage[]", reducer: "append", default: "[]" }]);
  });

  it("`why` 처럼 한 덩어리인 칸도 채워진다", () => {
    const out = patch(SKELETON(), "1.0", {
      why: { alternative: "표로 된다", modelNeed: "이유 문장", verdict: "이유만 모델", needsModel: true },
    });
    const doc = parseYaml(out) as { why: Record<string, unknown> };
    expect(doc.why).toMatchObject({ alternative: "표로 된다", needsModel: true });
    expect(draftProgress(doc).cells.find((cell) => cell.id === "1.0")?.fill).toBe("filled");
  });

  it("안이 다 비면 한 덩어리는 통째로 비운다 — 「아직」으로 읽히게", () => {
    const out = patch(SKELETON(), "1.0", { why: { alternative: "  ", verdict: "", needsModel: false } });
    expect((parseYaml(out) as Record<string, unknown>).why).toBeNull();
  });

  /** 「없는 것이 답이다」와 「아직 안 썼다」는 다른 사실이다 (명세 §5.2와 같은 축). */
  it("`[]` 를 보내면 `[]` 로 적고, 그건 「아직」과 다르다", () => {
    const out = patch(SKELETON(), "1.2", { tools: [] });
    const doc = parseYaml(out) as Record<string, unknown>;
    expect(doc.tools).toEqual([]);
    const cells = draftProgress(doc).cells;
    expect(cells.find((cell) => cell.id === "1.2")?.fill).toBe("declared");
  });

  /** 비면 설계가 아닌 칸에 `[]` 를 적으면 「아직」이 「답했다」로 세진다. */
  it("`[]` 는 비울 수 있는 칸에만 적는다 — caps·done 은 비면 「아직」이다", () => {
    const out = patch(SKELETON(), "1.2", { caps: [], tools: [] });
    const doc = parseYaml(out) as Record<string, unknown>;
    expect(doc.caps).toBeNull();
    expect(doc.tools).toEqual([]);

    const lines = parseYaml(patch(SKELETON(), "1.1", { done: ["", "  "] })) as Record<string, unknown>;
    expect(lines.done).toBeNull();
  });

  it("손대지 않은 행은 버린다 — 꺼진 체크박스만 있는 행은 내용이 아니다", () => {
    const out = patch(SKELETON(), "1.2", { caps: [{ humanApproval: false }] });
    expect((parseYaml(out) as Record<string, unknown>).caps).toBeNull();
  });

  it("빈 숫자 칸은 0 이 아니라 비어 있다", () => {
    const out = patch(SKELETON(), "1.2", {
      models: [{ id: "m", provider: "p", caps: ["cap:external"], usedBy: ["one"], timeoutMs: "" }],
    });
    const models = (parseYaml(out) as { models: Array<Record<string, unknown>> }).models;
    expect(models[0]!.timeoutMs).toBeNull();
  });

  it("빈 문장은 null 로 적힌다 — 빈 문자열을 남기지 않는다", () => {
    const out = patch(patch(SKELETON(), "1.1", { goal: "쓴 것" }), "1.1", { goal: "   " });
    expect((parseYaml(out) as Record<string, unknown>).goal).toBeNull();
  });

  it("행의 타입을 맞춘다 — 민감도는 숫자, 사람 확인은 boolean, 목록은 배열", () => {
    const out = patch(SKELETON(), "1.3", {
      reads: [{ path: "guides/**", level: "1", why: "" }],
    });
    const doc = parseYaml(out) as { reads: Array<Record<string, unknown>> };
    expect(doc.reads[0]).toEqual({ path: "guides/**", level: 1 });

    const caps = patch(SKELETON(), "1.2", {
      caps: [{ id: "cap:read", scope: "읽는다", undo: "아무것도 안 바꾼다", humanApproval: "" }],
      tools: [{ id: "write", caps: "cap:draft", what: "쓴다", irreversible: false }],
    });
    const capsDoc = parseYaml(caps) as { caps: Array<Record<string, unknown>>; tools: Array<Record<string, unknown>> };
    expect(capsDoc.caps[0]!.humanApproval).toBe(false);
    expect(capsDoc.tools[0]!.caps).toEqual(["cap:draft"]);
  });

  it("빈 선택 칸은 키를 쓰지 않는다 — `via: null` 보다 없는 편이 읽기 쉽다", () => {
    const out = patch(SKELETON(), "1.6", {
      documents: [{ id: "D1", node: "pick", path: "guides/bug.md", level: 1, when: "갈래가 버그", via: "" }],
    });
    expect(Object.keys((parseYaml(out) as { documents: object[] }).documents[0]!)).toEqual([
      "id", "node", "path", "level", "when",
    ]);
  });

  it("없는 칸과 없는 키는 거절한다", () => {
    expect(patchDraftCell(SKELETON(), "9.9", {}).ok).toBe(false);
    const wrong = patchDraftCell(SKELETON(), "1.1", { goals: "오타" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("goals");
  });

  it("깨진 YAML은 덮지 않고 말한다", () => {
    const broken = patchDraftCell("goal: [깨짐\n  - 어긋남", "1.1", { goal: "x" });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toContain("YAML이 깨졌다");
  });

  /** 1단계 중에는 불완전한 것이 정상이다 — 판정은 DRC가 뒤에서 한다. */
  it("불완전한 초안을 거절하지 않는다", () => {
    const out = patch(SKELETON(), "1.7", { requirements: [{ id: "R1", pattern: "ubiquitous", text: "문장" }] });
    expect(parseIr(parseYaml(out)).ok).toBe(false); // 아직 IR이 아니다
    expect(draftProgress(parseYaml(out)).answered).toBe(1); // 그래도 한 칸은 찼다
  });

  // 콘솔의 「1단계 시작」은 그래프 이름 없이 골격을 만든다 — 그 길도 같이 본다.
  it.each([
    ["그래프 이름이 있을 때", SKELETON],
    ["그래프 이름 없이 (콘솔이 만드는 골격)", () => renderIrSkeleton("demo")],
  ])("아홉 칸을 다 채우면 IR로 읽힌다 — %s", (_label, skeleton) => {
    let text = skeleton();
    text = patch(text, "0.0", {
      concepts: [{ id: "input", label: "입력", kind: "input" }, { id: "out", label: "결과", kind: "output" }],
      relations: [],
      rules: [],
    });
    text = patch(text, "1.0", { why: { alternative: "a", modelNeed: "b", verdict: "c", needsModel: false } });
    text = patch(text, "1.1", { goal: "목적", done: ["조건"] });
    text = patch(text, "1.2", {
      caps: [{ id: "cap:read", scope: "읽는다", undo: "없다", humanApproval: false }],
      tools: [],
      models: [],
    });
    text = patch(text, "1.3", { reads: [{ path: "a/**", level: 2 }], emits: [] });
    text = patch(text, "1.4", { state: [{ field: "input", type: "string", reducer: "lastWrite", default: '""' }] });
    text = patch(text, "1.5", {
      nodes: [{ id: "one", label: "하나", reads: ["input"], writes: ["input"] }],
      edges: [{ from: "__start__", to: "one" }, { from: "one", to: "__end__" }],
    });
    text = patch(text, "1.6", { documents: [] });
    text = patch(text, "1.7", { requirements: [{ id: "R1", pattern: "unwanted", text: "If …, 시스템은 …" }] });
    text = patch(text, "1.8", {
      evals: [{ id: "E1", node: "one", kind: "deterministic", input: "in", expect: "out" }],
      requirementLinks: [{ requirement: "R1", node: "one", eval: "E1" }],
    });

    const parsed = parseIr(parseYaml(text));
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    expect(draftProgress(parseYaml(text)).answered).toBe(10);
  });
});

describe("칸 기술", () => {
  it("아홉 칸이 전부 기술돼 있고, 키가 골격과 맞는다", () => {
    const doc = parseYaml(SKELETON()) as Record<string, unknown>;
    for (const cell of ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"]) {
      const fields = IR_CELL_FIELDS[cell];
      expect(fields, cell).toBeDefined();
      for (const field of fields!) expect(field.key in doc, `${cell}.${field.key}`).toBe(true);
    }
  });

  it("행 칸은 열을 기술하고, 「없음으로 적기」는 비울 수 있는 칸에만 있다", () => {
    for (const fields of Object.values(IR_CELL_FIELDS)) {
      for (const field of fields) {
        if (field.kind === "rows") expect(field.columns?.length, field.key).toBeGreaterThan(0);
        if (field.canBeEmpty) expect(field.kind, field.key).toBe("rows");
      }
    }
    // caps·reads·state·nodes 는 비면 설계가 아니다 — 「없음으로 적기」를 두지 않는다.
    const notEmptyable = ["caps", "reads", "state", "nodes", "edges", "requirements", "evals"];
    for (const fields of Object.values(IR_CELL_FIELDS)) {
      for (const field of fields) {
        if (notEmptyable.includes(field.key)) expect(field.canBeEmpty, field.key).toBeFalsy();
      }
    }
  });
});
