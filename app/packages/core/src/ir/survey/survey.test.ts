import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { parseIr } from "../../types/ir.js";
import { runIrChecks, summarizeIrChecks } from "../checks.js";
import { compileSurvey } from "./compile.js";
import { SURVEY_UNSURE, type SurveyAnswers, type SurveyContext } from "./model.js";
import { readSurveyAnswers, saveSurveyAnswer } from "./store.js";
import { buildSurveyView } from "./view.js";

/**
 * 설계 설문 — 가상 에이전트 「메모 갈래 나누기」로 본다 (수락 시험 대상을 끌어오지 않는다).
 */

const CTX: SurveyContext = {
  folders: ["guides", "inbox"],
  markdown: ["guides/bug.md", "guides/request.md", "guides/question.md"],
};
const BASE = { project: "memo-triage" };

const MEMO: SurveyAnswers = {
  "o.input": "메모",
  "o.outputs": ["classify", "reason", "recommend"],
  "o.categoryName": "갈래",
  "o.categories": ["버그", "요청", "질문"],
  "o.relations": { "input>category": "one", "category>doc": "one", "input>reason": "optional" },
  "o.rules": ["rel:input>category", "rel:category>doc", "enum:category", "res:doc"],
  "n.ruleable": { classify: "table", reason: "model", recommend: "table" },
  "g.done": ["done:classify", "done:reason", "done:recommend"],
  "p.actions": ["read", "draft"],
  "p.model": "host",
  "p.timeout": "600000",
  "i.reads": ["inbox", "guides"],
  "f.pattern": "chain",
  "f.onRefuse": "skip",
  "f.onTimeout": "skip",
  "f.onEmpty": "answer",
  "d.docs": { 버그: "guides/bug.md", 요청: "guides/request.md", 질문: "guides/question.md" },
  "e.samples": { 버그: "저장 버튼이 두 번 눌린다", 요청: "어두운 화면이 있으면 좋겠다", 질문: "내보내기는 어디서 하나요" },
};

async function docRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-survey-root-"));
  await fs.mkdir(path.join(root, "guides"), { recursive: true });
  for (const f of CTX.markdown) await fs.writeFile(path.join(root, f), "# x\n");
  return root;
}

function judge(answers: SurveyAnswers, root?: string, viaYaml = true) {
  const doc = compileSurvey(answers, CTX, BASE);
  const parsed = parseIr(viaYaml ? YAML.parse(YAML.stringify(doc)) : JSON.parse(JSON.stringify(doc)));
  if (!parsed.ok) return { parsed, summary: null };
  return { parsed, summary: summarizeIrChecks(runIrChecks(parsed.ir, root ? { docRoot: root } : {})) };
}

describe("답 → 설계도", () => {
  it("「메모 갈래 나누기」의 답은 검사를 전부 통과하는 설계도가 된다", async () => {
    const { parsed, summary } = judge(MEMO, await docRoot());
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    expect(summary!.failed).toEqual([]);
    if (!parsed.ok) return;
    const ir = parsed.ir;
    expect(ir.schemaVersion).toBe(3);
    expect(ir.concepts.map((c) => c.id)).toEqual(["input", "category", "reason", "doc"]);
    expect(ir.concepts.find((c) => c.id === "category")?.values).toEqual(["버그", "요청", "질문"]);
    expect(ir.models).toEqual([expect.objectContaining({ provider: "host", usedBy: ["explain"], timeoutMs: 600000 })]);
    expect(ir.nodes.map((n) => n.id)).toEqual(["intake", "classify", "explain", "pick", "answer"]);
    expect(ir.documents.map((d) => d.path)).toEqual(CTX.markdown);
    expect(ir.requirements.filter((q) => q.pattern === "unwanted").length).toBeGreaterThanOrEqual(3);
    // 값 목록의 값마다 시험이 하나씩
    expect(ir.evals.filter((e) => e.expect.startsWith("갈래가")).map((e) => e.input)).toEqual([
      "저장 버튼이 두 번 눌린다",
      "어두운 화면이 있으면 좋겠다",
      "내보내기는 어디서 하나요",
    ]);
  });

  it("아무것도 답하지 않아도(전부 「잘 모르겠어요」) 읽히는 설계도다", () => {
    expect(judge({}).summary?.failed).toEqual([]);
    expect(judge({ "o.outputs": SURVEY_UNSURE, "f.onEmpty": SURVEY_UNSURE }).summary?.failed).toEqual([]);
  });

  it("분기 조합을 전부 돌려도 설계도로 읽히고, 깨지는 것은 정한 위험뿐이다", () => {
    const outputs = ["classify", "reason", "summary", "recommend", "edit", "send"];
    let combos = 0;
    for (let mask = 1; mask < 1 << outputs.length; mask += 1) {
      const picked = outputs.filter((_, i) => mask & (1 << i));
      for (const model of ["host", "api"])
        for (const fb of ["skip", "human", "retry"])
          for (const approval of ["yes", "no"])
            for (const pattern of ["chain", "routing", "evaluator"])
              for (const empty of ["answer", "stop"]) {
                combos += 1;
                const answers: SurveyAnswers = {
                  ...MEMO,
                  "o.outputs": picked,
                  "o.relations": {},
                  "o.rules": undefined,
                  "n.ruleable": {},
                  "g.done": undefined,
                  "p.actions": undefined,
                  "p.model": model,
                  // 사람 확인 답이 살아 있도록 「실행하고 알린다」 — 제안만 · 확인 뒤 실행은 확인이 늘 붙는다.
                  "p.autonomy": "notify",
                  "p.approval": approval,
                  "p.undo": "none",
                  "f.onRefuse": fb,
                  "f.onTimeout": fb,
                  "f.pattern": pattern,
                  "f.onEmpty": empty,
                  "r.reqs": undefined,
                  "d.docs": {},
                };
                const { parsed, summary } = judge(answers, undefined, false);
                expect(parsed.ok, `${picked} ${model} ${fb} ${pattern}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
                const allowed = approval === "no" && picked.some((o) => o === "edit" || o === "send") ? ["1.2/irreversible-approval"] : [];
                expect(summary!.failed, `${picked} ${model} ${fb} ${approval} ${pattern} ${empty}`).toEqual(allowed);
              }
    }
    expect(combos).toBe(63 * 2 * 3 * 2 * 3 * 2);
  }, 120_000);
});

describe("요구사항 명세 관례 (29148 · Volere · PRD · ISO 25010 · MoSCoW)", () => {
  const REFS = [
    { id: "F1", title: "기존 운영 문서", kind: "link" as const, uri: "https://example.com/ops" },
    { id: "F2", title: "화면 시안", kind: "image" as const, uri: "F2-ui.png" },
  ];
  const full: SurveyAnswers = {
    ...MEMO,
    "o.refs": ["F2"],
    "g.users": ["me", "team"],
    "g.trigger": "event",
    "g.metrics": ["time", "accuracy"],
    "g.targets": { time: "mid", accuracy: "high" },
    "g.constraints": ["korean"],
    "q.speed": "30",
    "q.accuracy": "95",
    "q.privacy": "yes",
    "q.trace": "all",
    "r.reqs": { "req:trace": "wont" },
  };

  it("사용자 · 지표 · 하지 않는 것 · 제약 · 가정 · 참고 자료가 설계도에 들어간다", async () => {
    const doc = compileSurvey(full, { ...CTX, references: REFS }, BASE) as Record<string, any>;
    expect(doc.references.map((r: any) => r.id)).toEqual(["F2"]);
    expect(doc.stakeholders.map((s: any) => s.role)).toEqual(["만든 사람(나)", "팀 동료"]);
    expect(doc.metrics).toEqual([
      { id: "M1", what: "걸리는 시간", target: "지금의 절반 이하" },
      { id: "M2", what: "갈래 정확도", target: "시험 예의 95% 이상이 맞다" },
      { id: "M3", what: "시험 예 수", target: "50개 이상, 실패 종류마다 고르게" },
    ]);
    expect(doc.constraints).toEqual(["결과는 한국어로 쓴다"]);
    expect(doc.assumptions.length).toBeGreaterThan(0);
    // 「이번엔 안 함」은 요구사항이 아니라 하지 않는 것으로 간다
    expect(doc.nonGoals.some((g: string) => g.startsWith("이번에는 하지 않는다"))).toBe(true);
    expect(doc.requirements.some((q: any) => q.text.includes("기록에 남긴다"))).toBe(false);
    // 품질 요구사항에는 적합 기준이 붙는다
    const quality = doc.requirements.filter((q: any) => q.kind === "quality");
    expect(quality.length).toBeGreaterThanOrEqual(3);
    expect(quality.every((q: any) => typeof q.fit === "string" && q.fit.length > 0)).toBe(true);
    expect(doc.requirements.find((q: any) => q.pattern === "event")?.text).toContain("When");
    const { parsed, summary } = judge(full, await docRoot());
    expect(parsed.ok).toBe(true);
    expect(summary!.failed).toEqual([]);
  });

  it("서로 부딪치는 답은 높은 위험으로 표시한다", () => {
    const view = buildSurveyView({ ...MEMO, "p.model": "api", "g.constraints": ["nocost", "offline"] }, CTX);
    expect(view.risks.filter((r) => r.level === "high").map((r) => r.text)).toEqual([
      "「유료 API를 쓰지 않는다」와 「API로 모델을 부른다」가 부딪친다",
      "「인터넷 없이」와 「API로 모델을 부른다」가 부딪친다",
    ]);
  });
});

describe("화면이 그리는 설문", () => {
  it("갈래를 고르지 않으면 갈래 문항이 숨고, 모델이 필요 없으면 모델 문항이 숨는다", () => {
    const view = buildSurveyView({ "o.outputs": ["recommend"], "n.ruleable": { recommend: "table" } }, CTX);
    const ids = view.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).not.toContain("o.categories");
    expect(ids).not.toContain("p.model");
    expect(ids).toContain("d.docs");
    expect(view.needsModel).toBe(false);
  });

  it("뒤 문항의 줄 · 후보는 앞 답의 낱말로 만든다", () => {
    const view = buildSurveyView(MEMO, CTX);
    const rel = view.sections[0]!.items.find((i) => i.id === "o.relations")!;
    expect(rel.rows?.map((r) => r.label)).toContain("메모 하나에 갈래는");
    const reqs = view.sections.find((s) => s.cell === "1.7")!.items.find((i) => i.id === "r.reqs")!;
    expect(reqs.rows?.some((c) => c.label.includes("If 메모가 비어 있으면"))).toBe(true);
  });

  it("사람 확인 없이 고치거나 보내면 높은 위험으로 표시한다", () => {
    const view = buildSurveyView({ "o.outputs": ["edit"], "p.actions": ["read", "edit"], "p.autonomy": "notify", "p.approval": "no", "p.undo": "none" }, CTX);
    expect(view.risks.map((r) => r.level)).toEqual(["high", "high"]);
  });
});

describe("답 저장", () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-survey-store-"));
  });

  it("답이 남고 초안이 다시 만들어진다", async () => {
    const saved = await saveSurveyAnswer(home, "demo", { item: "o.input", value: "메모" }, CTX, BASE);
    expect(saved.ok).toBe(true);
    expect((await readSurveyAnswers(home, "demo")).answers).toEqual({ "o.input": "메모" });
    const draft = await fs.readFile(path.join(home, "projects", "demo", "ir.proposed.yaml"), "utf8");
    expect(draft).toContain("label: 메모");
  });

  it("초안을 직접 고쳤으면 덮지 않고, 다시 만들기는 옛 초안을 보관한다", async () => {
    await saveSurveyAnswer(home, "demo", { item: "o.input", value: "메모" }, CTX, BASE);
    const file = path.join(home, "projects", "demo", "ir.proposed.yaml");
    await fs.appendFile(file, "# 사람이 고쳤다\n");
    const blocked = await saveSurveyAnswer(home, "demo", { item: "o.input", value: "노트" }, CTX, BASE);
    expect(blocked).toMatchObject({ ok: false, status: 409, conflict: true });
    const forced = await saveSurveyAnswer(home, "demo", { item: "o.input", value: "노트", force: true }, CTX, BASE);
    expect(forced.ok && forced.archived).toBeTruthy();
    expect(await fs.readFile(forced.ok ? forced.archived! : "", "utf8")).toContain("# 사람이 고쳤다");
  });

  it("없는 문항은 거절한다", async () => {
    expect(await saveSurveyAnswer(home, "demo", { item: "zz", value: 1 }, CTX, BASE)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("조사", () => {
  it("받침에 맞춰 고른다 — 한글이 아니면 둘 다", async () => {
    const { josa } = await import("./josa.js");
    expect(josa("메모", "을", "를")).toBe("메모를");
    expect(josa("갈래", "이", "가")).toBe("갈래가");
    expect(josa("안내 문서", "은", "는")).toBe("안내 문서는");
    expect(josa("기록", "을", "를")).toBe("기록을");
    expect(josa("note", "을", "를")).toBe("note을(를)");
  });
});

describe("자료 조사 40건에서 더한 문항 (2026-10-05)", () => {
  const full: SurveyAnswers = {
    ...MEMO,
    "o.cq": ["cq:input>category", "cq:category>doc"],
    "g.alternatives": ["rules", "human"],
    "g.trigger": "event",
    "g.outcome": "handoff",
    "g.impact": "medium",
    "p.autonomy": "approve",
    "p.escalate": ["lowconf", "novel"],
    "i.untrusted": "yes",
    "s.memory": "thread",
    "q.confidence": "always",
    "q.correct": "yes",
    "e.edges": ["두 갈래에 걸친 메모", "영어로 쓴 메모"],
    "e.size": "100",
    "f.onEmpty": SURVEY_UNSURE,
  };

  it("역량 질문 · 대안 · 일의 맥락 · 위험 · 자율 · 기억 · 모르는 것이 설계도에 들어가고 검사를 통과한다", async () => {
    const doc = compileSurvey(full, CTX, BASE) as Record<string, any>;
    expect(doc.competencyQuestions.map((q: any) => q.text)).toEqual(["이 메모의 갈래는 무엇인가?", "이 갈래에는 어떤 안내 문서를 주는가?"]);
    expect(doc.alternatives[0]).toEqual({ what: "규칙과 표만으로", whyNot: "규칙과 표만으로는 이유 · 설명 쓰기를 할 수 없다" });
    expect(doc.jobStory).toBe("새 메모가 들어오면, 갈래 · 이유 · 안내 문서를 바로 받아서, 맞는 사람에게 넘길 수 있게");
    expect([doc.riskLevel, doc.autonomy, doc.memory]).toEqual(["medium", "approve", "thread"]);
    expect(doc.state.map((f: any) => f.field)).toContain("history");
    expect(doc.openQuestions).toEqual(["입력이 비어 있으면? — 기본값으로 설계했다"]);
    const texts = doc.requirements.map((q: any) => q.text);
    expect(texts).toContain("If 결과의 확신이 낮으면, 시스템은 멈추고 사람에게 넘긴다.");
    expect(texts.some((t: string) => t.includes("지시를 따르지 않고"))).toBe(true);
    expect(doc.evals.map((e: any) => e.input)).toEqual(expect.arrayContaining(["두 갈래에 걸친 메모", "영어로 쓴 메모"]));
    const { parsed, summary } = judge(full, await docRoot());
    expect(parsed.ok).toBe(true);
    expect(summary!.failed).toEqual([]);
  });

  it("피해가 큰데 끝까지 알아서 하면 검사(1.2/oversight)가 막고 화면은 높은 위험으로 표시한다", () => {
    const risky = { ...MEMO, "g.impact": "high", "p.autonomy": "full" };
    expect(judge(risky).summary!.failed).toEqual(["1.2/oversight"]);
    expect(buildSurveyView(risky, CTX).risks.map((r) => r.text)).toContain("틀리면 사람이 다칠 수 있는 일을 사람 확인 없이 끝까지 한다");
  });

  it("밖에서 온 글을 읽으면서 고치기 권한이 있으면 높은 위험, 쓰지 않는 권한은 줄이라고 한다", () => {
    const view = buildSurveyView({ ...MEMO, "i.untrusted": "yes", "p.actions": ["read", "edit"] }, CTX);
    const texts = view.risks.map((r) => r.text);
    expect(texts.some((t) => t.includes("프롬프트 인젝션"))).toBe(true);
    expect(texts.some((t) => t.includes("권한을 줄인다"))).toBe(true);
  });

  it("자율이 「제안만」이거나 「확인 뒤 실행」이면 사람 확인 문항은 묻지 않는다", () => {
    const ids = (a: SurveyAnswers) => buildSurveyView(a, CTX).sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids({ ...MEMO, "p.actions": ["read", "edit"], "p.autonomy": "approve" })).not.toContain("p.approval");
    expect(ids({ ...MEMO, "p.actions": ["read", "edit"], "p.autonomy": "full" })).toContain("p.approval");
  });
});
