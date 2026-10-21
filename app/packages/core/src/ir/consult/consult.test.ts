import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { CONSULT_ITEMS, CONSULT_TOPICS, consultProgress, selectPath } from "./catalog.js";
import { mergeProvenance, readProvenance, sourceFor, writeProvenance } from "./provenance.js";
import { PRD_SECTION_TITLES, renderPrd } from "./prd.js";
import { markPrdSection, prdReviewStatus, readPrdReview } from "./review.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../__fixtures__/valid.ir.yaml");
const valid = (): Record<string, unknown> => parseYaml(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
const tmpHome = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "pb-consult-"));

describe("하위 칸 목록 — 명세 20261006a §12.2", () => {
  it("59칸 · 묻기 28 · 해석 22 · 기본값 9, 주제 일곱", () => {
    const fills = { ask: 0, infer: 0, default: 0 };
    for (const entry of CONSULT_ITEMS) fills[entry.fill]++;
    expect(CONSULT_ITEMS).toHaveLength(59);
    expect(fills).toEqual({ ask: 28, infer: 22, default: 9 });
    expect(new Set(CONSULT_ITEMS.map((e) => e.topic))).toEqual(new Set(CONSULT_TOPICS));
  });

  it("id가 겹치지 않고, 칸마다 「빠지면 생기는 일」이 있다", () => {
    const ids = CONSULT_ITEMS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONSULT_ITEMS.every((e) => e.why.length > 5)).toBe(true);
  });
});

describe("selectPath", () => {
  const draft = { concepts: [{ id: "memo", kind: "input" }, { id: "kind", kind: "enum", values: ["a", "b"] }], tools: [] };
  it("거르기 · 원소 · 안쪽 키", () => {
    expect(selectPath(draft, "concepts[kind=input]")).toHaveLength(1);
    expect(selectPath(draft, "concepts[kind=enum].values")).toEqual([["a", "b"]]);
    expect(selectPath(draft, "concepts[].id")).toEqual(["memo", "kind"]);
  });
  it("빈 키는 「아직」(undefined), `[]` 는 값이다", () => {
    expect(selectPath(draft, "goal")).toBeUndefined();
    expect(selectPath(draft, "tools")).toEqual([[]]);
  });
});

describe("consultProgress — §12.3", () => {
  it("빈 초안이면 첫 주제부터, 다 묻기 · 해석 칸이 빈다", () => {
    const progress = consultProgress({});
    expect(progress.next).toBe("목표와 요구사항");
    expect(progress.topics.every((t) => t.filled === 0)).toBe(true);
  });

  it("「없음이 답」([])은 찬 칸이다 — 빈 키와 다르다", () => {
    const before = consultProgress({}).topics.find((t) => t.name === "목표와 요구사항")!;
    const after = consultProgress({ nonGoals: [] }).topics.find((t) => t.name === "목표와 요구사항")!;
    expect(before.missing).toContain("2-f");
    expect(after.missing).not.toContain("2-f");
  });

  it("기본값 칸은 주제 진행을 막지 않는다", () => {
    const progress = consultProgress(valid());
    expect(progress.topics.find((t) => t.name === "제약과 규칙")?.done).toBe(true);
    expect(progress.defaults).toContain("N3");
  });
});

describe("출처 — §12.6", () => {
  it("가장 긴 앞부분을 쓰고, 없으면 해석으로 본다", () => {
    const prov = mergeProvenance({ entries: [] }, [
      { path: "requirements", source: "inferred" },
      { path: "requirements[1]", source: "said", turn: 4 },
    ], "consult");
    expect(sourceFor(prov, "requirements[1].text").source).toBe("said");
    expect(sourceFor(prov, "requirements[0]").source).toBe("inferred");
    expect(sourceFor(prov, "goal").source).toBe("inferred");
    expect(prov.origin).toBe("consult");
  });

  it("처음 만든 길은 바뀌지 않고, 같은 경로는 새것으로", async () => {
    const home = tmpHome();
    let prov = mergeProvenance({ entries: [] }, [{ path: "goal", source: "inferred" }], "consult");
    prov = mergeProvenance(prov, [{ path: "goal", source: "said", turn: 2 }], "survey");
    await writeProvenance(home, "p", prov);
    const read = await readProvenance(home, "p");
    expect(read.origin).toBe("consult");
    expect(read.entries).toEqual([{ path: "goal", source: "said", turn: 2 }]);
  });
});

describe("PRD — §14", () => {
  it("11절 고정, 같은 초안이면 같은 PRD (결정적)", () => {
    const a = renderPrd(valid());
    const b = renderPrd(valid());
    expect(a.map((s) => s.title)).toEqual([...PRD_SECTION_TITLES]);
    expect(a).toEqual(b);
  });

  it("빈 초안도 그린다 — 지어내지 않고 「아직」으로", () => {
    const prd = renderPrd({});
    expect(prd[0]!.lines[0]!.text).toBe("목적 — 아직");
    expect(prd[10]!.lines.some((l) => l.text.startsWith("목표와 요구사항:"))).toBe(true);
  });

  it("줄마다 출처가 붙는다", () => {
    const prd = renderPrd(valid(), { entries: [{ path: "goal", source: "said", turn: 1 }] });
    expect(prd[0]!.lines[0]).toMatchObject({ path: "goal", source: "said" });
    expect(prd[0]!.lines[1]!.source).toBe("inferred");
  });

  it("3판 칸이 PRD에 나온다 — 환경 · 사용 화면 · 자격 증명", () => {
    const text = renderPrd(valid()).flatMap((s) => s.lines.map((l) => l.text)).join("\n");
    expect(text).toContain("언어: typescript");
    expect(text).toContain("부르는 곳: console");
    expect(text).toContain("자격 증명: 모델 공급자 API — 환경 변수");
  });
});

describe("PRD 검토 — §14.2", () => {
  it("맞아요를 누른 절은 내용이 바뀌면 확인 전으로 돌아간다", async () => {
    const home = tmpHome();
    const draft = valid();
    const prd = renderPrd(draft);
    for (const s of prd) await markPrdSection(home, "p", prd, { n: s.n, state: "ok" });
    expect(prdReviewStatus(prd, await readPrdReview(home, "p")).allOk).toBe(true);

    draft.goal = "바뀐 목적";
    const changed = renderPrd(draft);
    const status = prdReviewStatus(changed, await readPrdReview(home, "p"));
    expect(status.allOk).toBe(false);
    expect(status.sections[0]).toMatchObject({ state: "pending", stale: true });
    expect(status.sections[2]!.state).toBe("ok");
  });

  it("고쳐 주세요는 한 줄이 있어야 한다 — 그 말이 상담으로 간다", async () => {
    const home = tmpHome();
    const prd = renderPrd(valid());
    const result = await markPrdSection(home, "p", prd, { n: 8, state: "fix" });
    expect(result.ok).toBe(false);
    const ok = await markPrdSection(home, "p", prd, { n: 8, state: "fix", note: "메모는 고치지 않는다" });
    expect(ok.ok).toBe(true);
    expect(prdReviewStatus(prd, await readPrdReview(home, "p")).sections[7]).toMatchObject({ state: "fix", note: "메모는 고치지 않는다" });
  });
});

describe("상담 쓰기 검사 — 실제 상담에서 나온 것 (2026-10-07)", async () => {
  const { normalizeConsultPatch, validateConsultValues, consultPatchWarnings } = await import("./draftWrite.js");

  it("「항상」「꼭」 같은 표시명은 계약 값으로 바꾼다", () => {
    const patch = normalizeConsultPatch({ requirements: [{ id: "R1", pattern: "항상", text: "x", priority: "꼭" }], riskLevel: "낮음" });
    expect(patch.requirements).toEqual([{ id: "R1", pattern: "ubiquitous", text: "x", priority: "must" }]);
    expect(patch.riskLevel).toBe("low");
    expect(validateConsultValues(patch)).toEqual([]);
  });

  it("정해진 값 자리에 문장을 넣으면 거절한다 — 버리지 않는다", () => {
    const problems = validateConsultValues({ interface: { entry: ["Patchbay 브라우저 화면"] } });
    expect(problems[0]).toContain("interface.entry.0");
  });

  it("목록처럼 긴 goal 에는 requirements 로 나누라고 알린다", () => {
    const warnings = consultPatchWarnings({ goal: "학습 에이전트 — 1. 문제 수집 2. 문제지 배포 3. 해설 4. 오답노트" });
    expect(warnings[0]).toContain("requirements");
    expect(consultPatchWarnings({ goal: "메모 한 줄을 넣으면 갈래 하나가 나온다" })).toEqual([]);
  });
});

describe("아키텍처 — PRD 옆 그림", async () => {
  const { buildArchitecture } = await import("./architecture.js");
  it("같은 초안이면 같은 그림, 블록마다 PRD 절, 연결은 있는 블록끼리만", () => {
    const a = buildArchitecture(valid());
    expect(buildArchitecture(valid())).toEqual(a);
    expect(a.blocks.find((b) => b.id === "step:explain")).toMatchObject({ lane: "단계", section: 6, label: "고른 이유 쓰기" });
    expect(a.blocks.find((b) => b.kind === "model")?.section).toBe(7);
    const ids = new Set(a.blocks.map((b) => b.id));
    expect(a.links.every((l) => ids.has(l.from) && ids.has(l.to))).toBe(true);
    expect(a.links).toContainEqual(expect.objectContaining({ from: "step:explain", to: "model:claude-opus-5" }));
  });
  it("빈 초안은 빈 그림 — 지어내지 않는다", () => {
    expect(buildArchitecture({})).toEqual({ blocks: [], links: [] });
  });
});

describe("요구사항 보이기 — 「시스템은」 빼고 짧게 (사용자 요청 2026-10-07)", async () => {
  const { requirementDisplay } = await import("./display.js");
  const { consultPatchWarnings } = await import("./draftWrite.js");

  it("summary 가 있으면 그것을, 없으면 상투어를 걷어 낸 원문을 보인다", () => {
    expect(requirementDisplay({ text: "시스템은 x 를 한다.", summary: "x 하기" }).short).toBe("x 하기");
    expect(requirementDisplay({ text: "When 새 기록이 들어오면, 시스템은 갈래를 다시 정한다." }).short).toBe("새 기록이 들어오면, 갈래를 다시 정한다");
    expect(requirementDisplay({ text: "시스템은 " + "가".repeat(80) }).short.length).toBeLessThanOrEqual(48);
  });

  it("PRD 10절은 짧은 줄을 보이고 원문은 detail 로 접어 둔다", () => {
    const draft = valid();
    const prd = renderPrd(draft);
    const line = prd[9]!.lines.find((l) => l.path === "requirements[0]")!;
    expect(line.text).not.toContain("시스템은");
    expect(line.detail).toContain("시스템은");
  });

  it("summary 없거나 길면 상담자에게 알린다", () => {
    expect(consultPatchWarnings({ requirements: [{ id: "R1", text: "x" }] })[0]).toContain("summary");
    expect(consultPatchWarnings({ requirements: [{ id: "R1", text: "x", summary: "가".repeat(30) }] })[0]).toContain("25자");
    expect(consultPatchWarnings({ requirements: [{ id: "R1", text: "x", summary: "짧은 한 줄" }] })).toEqual([]);
  });
});

describe("0 구조 — 상담에서 적은 설계 · 아키텍처 말 (사용자 요청 2026-10-07)", async () => {
  const { designSummary } = await import("./designSummary.js");
  const { buildArchitecture } = await import("./architecture.js");
  it("목표 · 요구사항(짧은 줄) · 장면 · 환경을 뽑는다", () => {
    const d = designSummary(valid())!;
    expect(d.goal).toContain("기록 한 건");
    expect(d.requirements[0]!.text).not.toContain("시스템은");
    expect(d.environment).toContain("typescript");
    expect(designSummary(null)).toBeNull();
  });
  it("아키텍처 블록은 코드 이름이 아니라 말로 — 코드 이름은 detail 에", () => {
    const a = buildArchitecture(valid());
    const tool = a.blocks.find((b) => b.id === "tool:write-draft")!;
    expect(tool.label).not.toBe("write-draft");
    expect(tool.detail).toContain("write-draft");
    expect(a.blocks.find((b) => b.id === "screen")!.label).toBe("Patchbay 콘솔");
    expect(a.blocks.find((b) => b.kind === "model")!.label).toBe("Claude");
  });
});

describe("형식이 맞지 않는 초안 — 칸별로 모으고 고쳐 달라기 (2026-10-07)", async () => {
  const { draftFormatProblems, formatFixRequest } = await import("./formatProblems.js");
  it("맞는 초안은 빈 목록", () => {
    expect(draftFormatProblems(valid())).toEqual([]);
  });
  it("정해진 값 자리의 문장 · 목록 자리의 글을 칸별로 세고, 쓸 수 있는 값을 붙인다", () => {
    const draft = valid();
    draft.riskLevel = "넘겨도 되는 수준";
    (draft.relations as Record<string, unknown>[])[0]!.kind = "구성된다";
    (draft.nodes as Record<string, unknown>[])[0]!.writes = "input";
    const problems = draftFormatProblems(draft);
    expect(problems.find((p) => p.field === "riskLevel")).toMatchObject({ count: 1, allowed: ["low", "medium", "high"] });
    expect(problems.find((p) => p.field === "nodes.writes")?.message).toContain("목록이어야");
    const request = formatFixRequest(problems);
    expect(request).toContain("relations.kind (관계 뜻) 1곳 — 쓸 수 있는 값: has | points | derives");
  });
});

describe("검사 맞추기 · 시작 끝 이름 (2026-10-07)", async () => {
  const { normalizeConsultPatch } = await import("./draftWrite.js");
  const { checkProblems, checkFixRequest } = await import("./checkFix.js");
  it("「시작」 「끝」은 __start__ · __end__ 로 받는다", () => {
    const out = normalizeConsultPatch({ edges: [{ from: "시작", to: "a" }, { from: "a", to: "끝" }] });
    expect(out.edges).toEqual([{ from: "__start__", to: "a" }, { from: "a", to: "__end__" }]);
  });
  it("막힌 검사를 사람 말과 고칠 길로 바꿔 상담자에게 넘긴다", () => {
    const problems = checkProblems([
      { id: "1.8/eval-scoring", gate: "1.8", ok: false, note: "" },
      { id: "1.5/reachable", gate: "1.5", ok: true, note: "" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.what).toContain("채점 기준");
    expect(checkFixRequest(problems)).toContain("evals[kind=model].scoring");
  });
});

describe("요구사항 요약 · 정규화", async () => {
  const { normalizeConsultPatch, consultPatchWarnings } = await import("./draftWrite.js");
  const { buildConsultBrief } = await import("../../consult/brief.js");

  it("도출한 요구사항은 EARS 패턴 · 우선순위 계약 값으로 바꾸고, 요약이 없거나 길면 다시 쓰게 한다", () => {
    const patch = normalizeConsultPatch({ requirements: [{ id: "R1", pattern: "~하면", text: "사용자가 메모를 넣으면, 시스템은 갈래를 정한다.", priority: "꼭", summary: "메모 갈래 정하기" }] });
    expect(patch.requirements).toEqual([{ id: "R1", pattern: "event", text: "사용자가 메모를 넣으면, 시스템은 갈래를 정한다.", priority: "must", summary: "메모 갈래 정하기" }]);
    expect(consultPatchWarnings(patch)).toEqual([]);
    expect(consultPatchWarnings({ requirements: [{ id: "R2", text: "x" }] })[0]).toContain("summary");
    const brief = buildConsultBrief({ alias: "t", draft: {}, consultId: "c" });
    expect(brief).toContain("요구사항마다 `summary` 를 붙인다");
    expect(brief).toContain("`text` 는 EARS 원문");
  });
});
