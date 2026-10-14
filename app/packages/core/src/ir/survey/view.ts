import { IR_GATE_CELLS } from "../gates.js";
import { SURVEY_ITEMS, type SurveyItemDef, type SurveyItemKind, type SurveyOption } from "./items.js";
import { compileSurvey } from "./compile.js";
import { SURVEY_UNSURE, SurveyReader, itemVisible, type SurveyAnswers, type SurveyCandidate, type SurveyContext, type SurveyRow } from "./model.js";

/** 화면이 그리는 문항 하나 — 선택지 · 줄 · 후보가 앞 답으로 풀려 있다. */
export interface SurveyItemView {
  id: string;
  cell: string;
  ask: string;
  help?: string;
  kind: SurveyItemKind;
  placeholder?: string;
  options?: SurveyOption[];
  columns?: SurveyOption[];
  rows?: SurveyRow[];
  candidates?: SurveyCandidate[];
  /** 지금 답. 없으면 null. */
  value: unknown;
  /** 답이 없을 때 「잘 모르겠어요」가 고르는 값 — 화면이 미리 보여 준다. */
  suggested: unknown;
  answered: boolean;
  unsure: boolean;
}

export interface SurveySection {
  cell: string;
  label: string;
  items: SurveyItemView[];
  /** 묻지 않고 앞 답에서 만드는 칸이면 그 설명. */
  auto?: string;
}

export interface SurveyRisk {
  level: "high" | "medium";
  text: string;
}

/** 답할 때마다 자라는 설계의 모습 — 화면 오른쪽이 그린다. */
export interface SurveyPreview {
  references: { id: string; title: string; kind: string; uri: string }[];
  stakeholders: string[];
  metrics: { what: string; target: string }[];
  nonGoals: number;
  priorities: Record<string, number>;
  jobStory: string;
  riskLevel: string;
  autonomy: string;
  openQuestions: number;
  competencyQuestions: number;
  concepts: { id: string; label: string; kind: string; values: string[] }[];
  relations: { from: string; to: string; cardinality: string }[];
  nodes: { id: string; label: string; model: boolean }[];
  edges: { from: string; to: string; when?: string }[];
  requirements: number;
  evals: number;
}

export interface SurveyView {
  sections: SurveySection[];
  answered: number;
  total: number;
  needsModel: boolean;
  risks: SurveyRisk[];
  preview: SurveyPreview;
}

function resolved(item: SurveyItemDef, r: SurveyReader): Pick<SurveyItemView, "options" | "rows" | "candidates" | "columns"> {
  switch (item.dynamic) {
    case "relation-rows":
      return { rows: r.relationRows(), columns: item.columns };
    case "ruleable-rows":
      return { rows: r.ruleableRows(), columns: item.columns };
    case "rule-candidates":
      return { candidates: r.ruleCandidates() };
    case "done-candidates":
      return { candidates: r.doneCandidates() };
    case "requirement-candidates":
      return { candidates: r.requirementCandidates() };
    case "priority-rows":
      return {
        rows: r.requirementCandidates().map((c) => ({ key: c.key, label: c.fit ? `${c.label}  — 기준: ${c.fit}` : c.label })),
        columns: item.columns,
      };
    case "nongoal-candidates":
      return { candidates: r.nonGoalCandidates() };
    case "assumption-candidates":
      return { candidates: r.assumptionCandidates() };
    case "target-rows":
      return { rows: r.targetRows(), columns: item.columns };
    case "cq-candidates":
      return { candidates: r.cqCandidates().map(({ key, label }) => ({ key, label })) };
    case "folders":
      return {
        options: [{ value: ".", label: "레포 전체" }, ...r.ctx.folders.map((f) => ({ value: f, label: `${f}/` }))],
      };
    case "doc-rows":
      return { rows: r.docRows(), columns: r.ctx.markdown.map((file) => ({ value: file, label: file })) };
    case "sample-rows":
      return { rows: r.sampleRows() };
    default:
      return { options: item.options, columns: item.columns };
  }
}

/** 「잘 모르겠어요」가 고르는 값 — 컴파일러가 답이 없을 때 쓰는 바로 그 값이다. */
function suggestion(item: SurveyItemDef, r: SurveyReader): unknown {
  switch (item.id) {
    case "o.input":
      return r.input;
    case "o.outputs":
      return r.outputs;
    case "o.categoryName":
      return r.categoryName;
    case "o.categories":
      return r.categories;
    case "o.relations":
      return Object.fromEntries(r.relationRows().map((row) => [row.key, r.cardinality(row.key)]));
    case "o.rules":
      return r.ruleCandidates().map((c) => c.key);
    case "n.ruleable":
      return Object.fromEntries(r.ruleableRows().map((row) => [row.key, r.ruleable(row.key)]));
    case "g.done":
      return r.doneCandidates().map((c) => c.key);
    case "p.actions":
      return r.actions;
    case "p.approval":
      return r.approval ? "yes" : "no";
    case "p.undo":
      return r.undo;
    case "p.model":
      return r.modelProvider;
    case "p.timeout":
      return String(r.timeoutMs);
    case "i.reads":
      return r.reads;
    case "i.emits":
      return r.emits;
    case "f.pattern":
      return r.pattern;
    case "f.onRefuse":
    case "f.onTimeout":
      return r.fallback(item.id);
    case "f.onEmpty":
      return r.onEmpty;
    case "d.docs":
      return Object.fromEntries(r.docRows().map((row, i) => [row.key, r.docFor(row.key, i)]));
    case "r.reqs":
      return Object.fromEntries(r.requirementCandidates().map((c) => [c.key, r.priority(c)]));
    case "o.refs":
      return (r.ctx.references ?? []).map((ref) => ref.id);
    case "g.users":
      return r.users;
    case "g.trigger":
      return r.trigger;
    case "g.current":
      return r.current;
    case "g.metrics":
      return r.metricKeys;
    case "g.targets":
      return Object.fromEntries(r.targetRows().map((row) => [row.key, r.target(row.key)]));
    case "g.nonGoals":
      return r.nonGoalCandidates().map((c) => c.key);
    case "g.constraints":
      return r.constraints.length ? r.constraints : ["none"];
    case "g.assumptions":
      return r.assumptionCandidates().map((c) => c.key);
    case "q.speed":
      return r.speedSeconds === null ? "any" : String(r.speedSeconds);
    case "q.accuracy":
      return String(r.accuracy ?? 90);
    case "q.privacy":
      return r.privacy ? "unknown" : "no";
    case "q.trace":
      return r.trace;
    case "o.cq":
      return r.cqCandidates().map((c) => c.key);
    case "g.alternatives":
      return r.alternatives.length ? r.alternatives : ["none"];
    case "g.outcome":
      return r.outcome;
    case "g.impact":
      return r.riskLevel;
    case "p.autonomy":
      return r.autonomy;
    case "p.escalate":
      return r.escalations.length ? r.escalations : ["none"];
    case "i.untrusted":
      return r.untrusted ? "yes" : "no";
    case "s.memory":
      return r.memory;
    case "q.confidence":
      return r.confidence;
    case "q.correct":
      return r.correctable ? "yes" : "no";
    case "e.edges":
      return r.edgeCases;
    case "e.size":
      return String(r.evalSize);
    case "e.samples":
      return Object.fromEntries(r.sampleRows().map((row) => [row.key, r.sample(row.key)]));
    default:
      return null;
  }
}

/** 점검표의 위험 표시 (AWS Well-Architected 의 높은 위험 · 중간 위험처럼). */
function risksOf(r: SurveyReader): SurveyRisk[] {
  const out: SurveyRisk[] = [];
  const acts = r.actions;
  if ((acts.includes("edit") || acts.includes("send")) && !r.approval) {
    out.push({ level: "high", text: "파일을 고치거나 밖으로 보내는데 사람 확인이 없다" });
  }
  if (acts.includes("edit") && r.undo === "none") out.push({ level: "high", text: "고친 파일을 되돌릴 수 없다" });
  if (r.needsModel && r.modelProvider === "api" && r.emits === "raw") {
    out.push(
      r.privacy
        ? { level: "high", text: "개인정보가 섞일 수 있는 입력 원문이 그대로 밖의 모델로 나간다" }
        : { level: "medium", text: "입력 원문이 그대로 밖의 모델로 나간다" },
    );
  }
  if (r.riskLevel === "high" && r.autonomy === "full") {
    out.push({ level: "high", text: "틀리면 사람이 다칠 수 있는 일을 사람 확인 없이 끝까지 한다" });
  }
  if (r.untrusted && (r.actions.includes("edit") || r.actions.includes("send"))) {
    out.push({ level: "high", text: "밖에서 온 글이 고치기 · 보내기 권한을 움직일 수 있다 (프롬프트 인젝션)" });
  }
  if (r.memory === "long" && r.privacy) {
    out.push({ level: "medium", text: "개인정보가 섞일 수 있는 내용을 오래 기억한다" });
  }
  if (r.riskLevel !== "low" && r.escalations.length === 0) {
    out.push({ level: "medium", text: "틀리면 손해가 나는데 사람에게 넘기는 조건이 없다" });
  }
  // 과도한 권한 (OWASP LLM08) — 내놓는 것에 없는 일을 할 권한
  if (r.actions.includes("edit") && !r.has("edit")) out.push({ level: "medium", text: "파일을 고칠 권한이 있지만 내놓는 것에 「파일 고치기」가 없다 — 권한을 줄인다" });
  if (r.actions.includes("send") && !r.has("send")) out.push({ level: "medium", text: "밖으로 보낼 권한이 있지만 내놓는 것에 「밖으로 보내기」가 없다 — 권한을 줄인다" });
  if (r.constraints.includes("nocost") && r.needsModel && r.modelProvider === "api") {
    out.push({ level: "high", text: "「유료 API를 쓰지 않는다」와 「API로 모델을 부른다」가 부딪친다" });
  }
  if (r.constraints.includes("offline") && r.needsModel && r.modelProvider === "api") {
    out.push({ level: "high", text: "「인터넷 없이」와 「API로 모델을 부른다」가 부딪친다" });
  }
  if (r.needsModel && r.fallback("f.onRefuse") === "retry" && r.fallback("f.onTimeout") === "retry") {
    out.push({ level: "medium", text: "거절과 시간 초과 둘 다 다시 묻는다 — 늦어질 수 있다" });
  }
  return out;
}

export function buildSurveyView(answers: SurveyAnswers, ctx: SurveyContext): SurveyView {
  const r = new SurveyReader(answers, ctx);
  const sections: SurveySection[] = [];
  let answered = 0;
  let total = 0;
  for (const cell of IR_GATE_CELLS) {
    if (cell.id === "1.9") continue;
    const items = SURVEY_ITEMS.filter((item) => item.cell === cell.id && itemVisible(item, r)).map((item) => {
      const value = answers[item.id] ?? null;
      const isAnswered = value !== null && value !== undefined;
      total += 1;
      if (isAnswered) answered += 1;
      return {
        id: item.id,
        cell: item.cell,
        ask: item.ask,
        ...(item.help ? { help: item.help } : {}),
        kind: item.kind,
        ...(item.placeholder ? { placeholder: item.placeholder } : {}),
        ...resolved(item, r),
        value: value === SURVEY_UNSURE ? null : value,
        suggested: suggestion(item, r),
        answered: isAnswered,
        unsure: value === SURVEY_UNSURE,
      };
    });
    const section: SurveySection = { cell: cell.id, label: cell.label, items };
    if (cell.id === "1.4") section.auto = "0층의 개념이 곧 함께 쓰는 값이다 — 받는 것과 내놓는 것마다 하나, 그리고 대화 기록.";
    sections.push(section);
  }
  const doc = compileSurvey(answers, ctx, { project: "preview" }) as Record<string, any>;
  const preview: SurveyPreview = {
    references: doc.references.map((ref: any) => ({ id: ref.id, title: ref.title, kind: ref.kind, uri: ref.uri })),
    stakeholders: doc.stakeholders.map((s: any) => s.role),
    metrics: doc.metrics.map((m: any) => ({ what: m.what, target: m.target })),
    nonGoals: doc.nonGoals.length,
    jobStory: doc.jobStory,
    riskLevel: doc.riskLevel,
    autonomy: doc.autonomy,
    openQuestions: doc.openQuestions.length,
    competencyQuestions: doc.competencyQuestions.length,
    priorities: doc.requirements.reduce((acc: Record<string, number>, q: any) => ({ ...acc, [q.priority]: (acc[q.priority] ?? 0) + 1 }), {}),
    concepts: doc.concepts.map((c: any) => ({ id: c.id, label: c.label, kind: c.kind, values: c.values ?? [] })),
    relations: doc.relations.map((rel: any) => ({ from: rel.from, to: rel.to, cardinality: rel.cardinality })),
    nodes: doc.nodes.map((n: any) => ({ id: n.id, label: n.label, model: Array.isArray(n.models) && n.models.length > 0 })),
    edges: doc.edges.map((e: any) => ({ from: e.from, to: e.to, ...(e.when ? { when: e.when } : {}) })),
    requirements: doc.requirements.length,
    evals: doc.evals.length,
  };
  return { sections, answered, total, needsModel: r.needsModel, risks: risksOf(r), preview };
}
