import { josa } from "./josa.js";
import type { IrReference } from "../../types/ir.js";
import { SURVEY_ITEMS, type SurveyCondition, type SurveyItemDef } from "./items.js";

/**
 * 설문의 계산 — 답에서 사실(모델이 필요한가)과 후보(줄 · 규칙 · 약속)를 만든다.
 * 화면용(`view.ts`)과 설계도용(`compile.ts`)이 같은 계산을 쓴다 — 둘이 다른 말을 하지 않게.
 */

export type SurveyAnswers = Record<string, unknown>;

/** 「잘 모르겠어요」 — 기본값으로 넘어가되 요약에 표시가 남는다. */
export const SURVEY_UNSURE = "__unsure__";

export interface SurveyContext {
  /** 스캔 결과의 폴더 (레포 기준 상대 경로). */
  folders: string[];
  /** 스캔 결과의 마크다운 파일. */
  markdown: string[];
  /** 붙인 참고 자료 (`refs.yaml`). */
  references?: IrReference[];
}

export interface SurveyRow {
  key: string;
  label: string;
}

export interface SurveyCandidate {
  key: string;
  label: string;
  /** 요구사항 후보일 때 — EARS 패턴. */
  pattern?: "ubiquitous" | "event" | "state" | "unwanted" | "optional";
  /** 요구사항 후보일 때 — 기능 · 품질 · 제약. */
  kind?: "functional" | "quality" | "constraint";
  /** 요구사항 후보일 때 — 적합 기준(Volere). 품질 · 제약에는 늘 있다. */
  fit?: string;
  /** 기본 우선순위. */
  priority?: "must" | "should" | "could";
}

export type Priority = "must" | "should" | "could" | "wont";

const str = (v: unknown): string | null => (typeof v === "string" && v !== SURVEY_UNSURE && v.trim() ? v.trim() : null);
const list = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : null;
const record = (v: unknown): Record<string, string> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : null;

/** 받은 답을 읽되, 없거나 「잘 모르겠어요」면 정해 둔 기본값. */
export class SurveyReader {
  constructor(
    readonly answers: SurveyAnswers,
    readonly ctx: SurveyContext,
  ) {}

  unsure(id: string): boolean {
    return this.answers[id] === SURVEY_UNSURE;
  }

  get input(): string {
    return str(this.answers["o.input"]) ?? "입력";
  }
  get outputs(): string[] {
    const picked = list(this.answers["o.outputs"]);
    return picked && picked.length ? picked : ["classify"];
  }
  has(output: string): boolean {
    return this.outputs.includes(output);
  }
  get categoryName(): string {
    return str(this.answers["o.categoryName"]) ?? "갈래";
  }
  get categories(): string[] {
    const values = list(this.answers["o.categories"]);
    return values && values.length ? values : ["값1", "값2"];
  }

  /** 0층 — 내놓는 것마다 개념 하나. 받는 것은 `input`. */
  get conceptLabels(): Record<string, string> {
    return {
      input: this.input,
      category: this.categoryName,
      reason: "이유",
      summary: "요약",
      doc: "안내 문서",
      edited: "고친 파일",
      message: "보낼 메시지",
    };
  }

  relationRows(): SurveyRow[] {
    const L = this.conceptLabels;
    const rows: SurveyRow[] = [];
    if (this.has("classify")) rows.push({ key: "input>category", label: `${L.input} 하나에 ${L.category}는` });
    if (this.has("recommend")) {
      rows.push(
        this.has("classify")
          ? { key: "category>doc", label: `${L.category} 하나에 안내 문서는` }
          : { key: "input>doc", label: `${L.input} 하나에 안내 문서는` },
      );
    }
    if (this.has("reason")) rows.push({ key: "input>reason", label: `${L.input} 하나에 이유는` });
    if (this.has("summary")) rows.push({ key: "input>summary", label: `${L.input} 하나에 요약은` });
    if (this.has("edit")) rows.push({ key: "input>edited", label: `${L.input} 하나에 고친 파일은` });
    if (this.has("send")) rows.push({ key: "input>message", label: `${L.input} 하나에 보낼 메시지는` });
    return rows;
  }

  cardinality(rowKey: string): "one" | "optional" | "many" {
    const v = record(this.answers["o.relations"])?.[rowKey];
    return v === "optional" || v === "many" ? v : "one";
  }

  ruleCandidates(): SurveyCandidate[] {
    const L = this.conceptLabels;
    const out: SurveyCandidate[] = [];
    for (const row of this.relationRows()) {
      if (this.cardinality(row.key) !== "one") continue;
      const [from, to] = row.key.split(">") as [string, string];
      out.push({ key: `rel:${row.key}`, label: `${L[from]} 하나는 ${josa(L[to], "을", "를")} 정확히 하나 가진다` });
    }
    if (this.has("classify")) {
      out.push({ key: "enum:category", label: `${L.category}는 ${this.categories.join(" · ")} 밖의 값을 갖지 않는다` });
    }
    if (this.has("recommend")) out.push({ key: "res:doc", label: "안내 문서는 실제로 있는 파일이다" });
    return out;
  }

  /** 체크 문항 — 답이 없거나 「잘 모르겠어요」면 후보 전부를 남긴 것으로 읽는다. */
  kept(id: string, candidates: SurveyCandidate[]): SurveyCandidate[] {
    const picked = list(this.answers[id]);
    if (!picked || this.unsure(id)) return candidates;
    return candidates.filter((c) => picked.includes(c.key));
  }

  ruleableRows(): SurveyRow[] {
    const labels = Object.fromEntries(
      [
        ["classify", "갈래 나누기"],
        ["reason", "이유 · 설명 쓰기"],
        ["summary", "요약"],
        ["recommend", "문서 추천"],
        ["edit", "파일 고치기"],
        ["send", "밖으로 보내기"],
      ].map(([k, v]) => [k, v]),
    ) as Record<string, string>;
    return this.outputs.map((o) => ({ key: o, label: labels[o] ?? o }));
  }

  /** 내놓는 것마다 표로 되나. 기본: 이유 · 요약은 모델, 나머지는 표. */
  ruleable(output: string): "table" | "partly" | "model" {
    const v = record(this.answers["n.ruleable"])?.[output];
    if (v === "table" || v === "partly" || v === "model") return v;
    return output === "reason" || output === "summary" ? "model" : "table";
  }
  /** 모델이 맡는 것들. 「일부만」도 모델 몫이 있다. */
  get modelOutputs(): string[] {
    return this.outputs.filter((o) => this.ruleable(o) !== "table");
  }
  get needsModel(): boolean {
    return this.modelOutputs.length > 0;
  }

  doneCandidates(): SurveyCandidate[] {
    const L = this.conceptLabels;
    const map: Record<string, string> = {
      classify: `${L.category}가 ${this.categories.join(" · ")} 중 하나다`,
      reason: `이유가 ${L.input}의 말을 인용한다`,
      summary: `요약이 ${L.input}보다 짧다`,
      recommend: "추천한 문서가 실제로 있는 파일이다",
      edit: "고친 파일이 사람 확인을 거친다",
      send: "보낸 내용이 기록에 남는다",
    };
    return this.outputs.map((o) => ({ key: `done:${o}`, label: map[o] ?? o }));
  }

  get actions(): string[] {
    const picked = list(this.answers["p.actions"]);
    if (picked && picked.length) return picked.includes("read") ? picked : ["read", ...picked];
    const out = ["read", "draft"];
    if (this.has("edit")) out.push("edit");
    if (this.has("send")) out.push("send");
    return out;
  }
  /** 제안만 · 확인 뒤 실행이면 사람 확인은 늘 있다. 그 밖에는 p.approval 의 답. */
  get approval(): boolean {
    if (this.autonomy === "suggest" || this.autonomy === "approve") return true;
    return str(this.answers["p.approval"]) !== "no";
  }
  get undo(): "revert" | "backup" | "none" {
    const v = str(this.answers["p.undo"]);
    return v === "backup" || v === "none" ? v : "revert";
  }
  get modelProvider(): "host" | "api" {
    return str(this.answers["p.model"]) === "api" ? "api" : "host";
  }
  get timeoutMs(): number {
    const v = Number(str(this.answers["p.timeout"]));
    if (Number.isInteger(v) && v > 0) return v;
    return this.modelProvider === "host" ? 600_000 : 30_000;
  }
  get reads(): string[] {
    const picked = list(this.answers["i.reads"]);
    return picked && picked.length ? picked : ["."];
  }
  get emits(): "raw" | "summary" | "none" {
    const v = str(this.answers["i.emits"]);
    return v === "raw" || v === "none" ? v : "summary";
  }

  stateCandidates(): SurveyCandidate[] {
    const L = this.conceptLabels;
    const out: SurveyCandidate[] = [
      { key: "field:messages", label: "messages — 대화 기록 (사람과 에이전트가 주고받은 말)" },
      { key: "field:input", label: `input — ${L.input}` },
    ];
    for (const id of this.outputConceptIds()) out.push({ key: `field:${id}`, label: `${id} — ${L[id]}` });
    return out;
  }
  outputConceptIds(): string[] {
    const ids: string[] = [];
    if (this.has("classify")) ids.push("category");
    if (this.has("reason")) ids.push("reason");
    if (this.has("summary")) ids.push("summary");
    if (this.has("recommend")) ids.push("doc");
    if (this.has("edit")) ids.push("edited");
    if (this.has("send")) ids.push("message");
    return ids;
  }

  get pattern(): "chain" | "routing" | "evaluator" {
    const v = str(this.answers["f.pattern"]);
    return v === "routing" || v === "evaluator" ? v : "chain";
  }
  fallback(id: "f.onRefuse" | "f.onTimeout"): "skip" | "human" | "retry" {
    const v = str(this.answers[id]);
    return v === "human" || v === "retry" ? v : "skip";
  }
  get onEmpty(): "answer" | "stop" {
    return str(this.answers["f.onEmpty"]) === "stop" ? "stop" : "answer";
  }

  docRows(): SurveyRow[] {
    if (!this.has("recommend")) return [];
    if (!this.has("classify")) return [{ key: "*", label: `모든 ${this.input}` }];
    return this.categories.map((value) => ({ key: value, label: `${this.categoryName}가 「${value}」일 때` }));
  }
  /** 줄마다 고른 문서. 고르지 않았으면 마크다운을 차례로 하나씩. */
  docFor(rowKey: string, index: number): string | null {
    const v = record(this.answers["d.docs"])?.[rowKey];
    if (typeof v === "string" && v && v !== SURVEY_UNSURE) return v;
    const md = this.ctx.markdown;
    return md.length ? md[index % md.length]! : null;
  }

  requirementCandidates(): SurveyCandidate[] {
    const L = this.conceptLabels;
    const produced = this.outputConceptIds().map((id) => L[id]).join(" · ");
    const out: SurveyCandidate[] = [
      { key: "req:main", pattern: "ubiquitous", kind: "functional", label: `시스템은 ${L.input} 하나마다 ${produced || "결과"}를 준다.` },
    ];
    if (this.trigger === "event") {
      out.push({ key: "req:trigger", pattern: "event", kind: "functional", label: `When 알림이나 새 ${josa(L.input, "이", "가")} 들어오면, 시스템은 바로 처리를 시작한다.` });
    } else if (this.trigger === "schedule") {
      out.push({ key: "req:trigger", pattern: "event", kind: "functional", label: `When 정해진 시간이 되면, 시스템은 쌓인 ${josa(L.input, "을", "를")} 처리한다.` });
    }
    if (this.onEmpty === "answer") {
      out.push({
        key: "req:empty",
        pattern: "unwanted",
        kind: "functional",
        label: `If ${josa(L.input, "이", "가")} 비어 있으면, 시스템은 아무것도 고르지 말고 「입력이 비었다」고 답한다.`,
      });
    } else {
      out.push({ key: "req:empty", pattern: "unwanted", kind: "functional", label: `If ${josa(L.input, "이", "가")} 비어 있으면, 시스템은 아무것도 하지 않고 끝낸다.` });
    }
    if (this.needsModel) {
      const what = this.modelOutputs.map((o) => (o === "classify" ? L.category : L[o === "recommend" ? "doc" : o] ?? o)).join(" · ");
      const act = (f: "skip" | "human" | "retry") =>
        f === "skip"
          ? `${what}만 비우고 나머지는 준다`
          : f === "human"
            ? "멈추고 사람에게 넘긴다"
            : "한 번 다시 묻고, 그래도 안 되면 그 결과만 비운다";
      out.push({ key: "req:refuse", pattern: "unwanted", kind: "functional", label: `If 모델이 ${what} 쓰기를 거절하면, 시스템은 ${act(this.fallback("f.onRefuse"))}.` });
      out.push({
        key: "req:timeout",
        pattern: "unwanted",
        kind: "functional",
        label: `If ${Math.round(this.timeoutMs / 1000)}초 안에 모델의 답이 없으면, 시스템은 ${act(this.fallback("f.onTimeout"))}.`,
      });
    }
    for (const rule of this.kept("o.rules", this.ruleCandidates())) {
      if (rule.key === "enum:category") {
        out.push({
          key: "req:enum",
          pattern: "unwanted",
          kind: "functional",
          label: `If ${L.category}가 ${this.categories.join(" · ")} 밖의 값이면, 시스템은 그 값을 쓰지 않고 「모르겠다」고 답한다.`,
        });
      } else if (rule.key === "res:doc") {
        out.push({ key: "req:doc", pattern: "unwanted", kind: "functional", label: "If 고른 안내 문서가 실제로 없으면, 시스템은 없다고 답하고 다른 문서를 고르지 않는다." });
      } else {
        // rel:input>category → 「시스템은 메모 하나에 갈래를 정확히 하나 정한다.」
        const [from, to] = rule.key.slice("rel:".length).split(">") as [string, string];
        out.push({
          key: `req:${rule.key}`,
          pattern: "ubiquitous",
          kind: "functional",
          label: `시스템은 ${L[from]} 하나에 ${josa(L[to], "을", "를")} 정확히 하나 정한다.`,
        });
      }
    }
    // 품질 (ISO 25010) — 적합 기준이 늘 붙는다.
    if (this.speedSeconds !== null) {
      const t = this.speedSeconds >= 60 ? `${this.speedSeconds / 60}분` : `${this.speedSeconds}초`;
      out.push({ key: "req:speed", pattern: "ubiquitous", kind: "quality", priority: "should", label: `시스템은 ${L.input} 하나에 ${t} 안에 답한다.`, fit: `시험 예의 95%가 ${t} 안에 끝난다` });
    }
    if (this.accuracy !== null) {
      out.push({ key: "req:accuracy", pattern: "ubiquitous", kind: "quality", label: `시스템은 ${L.category}를 맞게 정한다.`, fit: `시험 예의 ${this.accuracy}% 이상이 맞다` });
    }
    if (this.privacy) {
      out.push({
        key: "req:privacy",
        pattern: "unwanted",
        kind: "quality",
        label: `If ${L.input}에 개인정보나 비밀이 있으면, 시스템은 그것을 밖으로 보내거나 기록에 그대로 남기지 않는다.`,
        fit: "개인정보가 든 시험 예에서 밖으로 나간 내용과 기록에 그 개인정보가 없다",
      });
    }
    if (this.trace === "all") {
      out.push({ key: "req:trace", pattern: "ubiquitous", kind: "quality", priority: "should", label: `시스템은 처리한 ${L.input}마다 결과와 근거를 기록에 남긴다.`, fit: `실행 기록이 ${L.input}마다 하나 있고 결과와 근거가 비어 있지 않다` });
    } else if (this.trace === "failures") {
      out.push({ key: "req:trace", pattern: "unwanted", kind: "quality", priority: "should", label: "If 처리에 실패하면, 시스템은 실패 이유를 기록에 남긴다.", fit: "실패한 시험 예마다 이유가 적힌 기록이 하나 있다" });
    }
    // 자율 수준 · 넘기는 조건 (Microsoft · OpenAI 가이드, EU AI Act 사람 감독)
    if (this.autonomy === "suggest") {
      out.push({ key: "req:autonomy", pattern: "ubiquitous", kind: "functional", label: "시스템은 결과를 제안으로만 내고, 실행은 사람이 한다." });
    } else if (this.autonomy === "approve" && (this.has("edit") || this.has("send"))) {
      out.push({ key: "req:autonomy", pattern: "ubiquitous", kind: "functional", label: "시스템은 파일을 고치거나 밖으로 보내기 전에 사람의 확인을 받는다." });
    } else if (this.autonomy === "notify") {
      out.push({ key: "req:autonomy", pattern: "ubiquitous", kind: "functional", label: "시스템은 한 일을 바로 사람에게 알린다." });
    }
    const escText: Record<string, string> = {
      lowconf: "If 결과의 확신이 낮으면",
      novel: `If 처음 보는 종류의 ${josa(L.input, "이", "가")} 들어오면`,
      irreversible: "If 되돌릴 수 없는 일을 하기 직전이면",
      repeat: "If 같은 실패가 두 번 나면",
    };
    for (const e of this.escalations) {
      if (escText[e]) out.push({ key: `req:esc:${e}`, pattern: "unwanted", kind: "functional", label: `${escText[e]}, 시스템은 멈추고 사람에게 넘긴다.` });
    }
    // 밖에서 온 글 속 지시 (OWASP LLM01)
    if (this.untrusted) {
      out.push({
        key: "req:injection",
        pattern: "unwanted",
        kind: "quality",
        label: "If 읽은 글 안에 지시가 들어 있으면, 시스템은 그 지시를 따르지 않고 내용으로만 다룬다.",
        fit: "지시가 숨은 시험 예에서 숨은 지시대로 행동한 경우가 0건이다",
      });
    }
    // 기억 (LangGraph 단기 · 장기)
    if (this.memory === "long") {
      out.push({ key: "req:memory", pattern: "ubiquitous", kind: "quality", priority: "should", label: "시스템은 기억한 것을 사람이 보고 지울 수 있게 한다.", fit: "기억 목록에서 한 항목을 지우면 다음 실행에 쓰이지 않는다" });
    }
    // 확신 · 정정 (Google PAIR · Microsoft HAX)
    if (this.confidence === "always") {
      out.push({ key: "req:confidence", pattern: "ubiquitous", kind: "quality", priority: "should", label: "시스템은 결과마다 확신 정도(높음 · 보통 · 낮음)를 함께 보인다.", fit: "결과마다 확신 표시가 하나 있다" });
    } else if (this.confidence === "low") {
      out.push({ key: "req:confidence", pattern: "unwanted", kind: "quality", priority: "should", label: "If 확신이 낮으면, 시스템은 결과에 「확실하지 않음」을 붙인다.", fit: "확신이 낮은 시험 예마다 「확실하지 않음」 표시가 있다" });
    }
    if (this.correctable) {
      out.push({ key: "req:correct", pattern: "event", kind: "functional", priority: "should", label: "When 사용자가 결과를 고치면, 시스템은 고친 내용을 기록하고 다음 판의 시험 예로 남긴다." });
    }
    // 제약 — 고른 것마다 하나.
    const constraintText: Record<string, [string, string]> = {
      offline: ["시스템은 인터넷 없이 동작한다.", "네트워크를 끊고 시험 예가 모두 끝난다"],
      nocost: ["시스템은 유료 API를 부르지 않는다.", "실행 기록에 유료 호출이 0건이다"],
      folder: ["시스템은 정한 폴더 밖의 파일을 건드리지 않는다.", "실행 뒤 정한 폴더 밖의 파일이 바뀌지 않았다"],
      korean: ["시스템은 결과를 한국어로 쓴다.", "결과 문장이 모두 한국어다"],
    };
    for (const c of this.constraints) {
      const t = constraintText[c];
      if (t) out.push({ key: `req:c:${c}`, pattern: "ubiquitous", kind: "constraint", label: t[0], fit: t[1] });
    }
    return out;
  }

  // ── 1.1 — 요구사항 명세 관례에서 (29148 · Volere · PRD) ───────────
  get users(): string[] {
    const picked = list(this.answers["g.users"]);
    return picked && picked.length ? picked : ["me"];
  }
  get trigger(): "manual" | "schedule" | "event" {
    const v = str(this.answers["g.trigger"]);
    return v === "schedule" || v === "event" ? v : "manual";
  }
  get current(): "manual" | "tool" | "none" {
    const v = str(this.answers["g.current"]);
    return v === "tool" || v === "none" ? v : "manual";
  }
  get metricKeys(): string[] {
    const picked = list(this.answers["g.metrics"]);
    return picked && picked.length ? picked : ["accuracy"];
  }
  targetRows(): SurveyRow[] {
    const labels: Record<string, string> = { time: "걸리는 시간", accuracy: "정확도", coverage: "빠뜨리는 비율", cost: "비용" };
    return this.metricKeys.map((k) => ({ key: k, label: labels[k] ?? k }));
  }
  target(metric: string): "low" | "mid" | "high" {
    const v = record(this.answers["g.targets"])?.[metric];
    return v === "low" || v === "high" ? v : "mid";
  }
  /** 지표의 목표치 문장 — 적합 기준. 정확도는 1.7의 정확도 답이 있으면 그것을 따른다. */
  targetText(metric: string): string {
    const level = this.target(metric);
    const base = this.current === "none" ? "처음 정한 기준" : "지금";
    switch (metric) {
      case "time":
        return { low: `${base}보다 줄어든다`, mid: `${base}의 절반 이하`, high: `${base}의 10분의 1 이하` }[level];
      case "accuracy":
        return `시험 예의 ${this.accuracy ?? { low: 80, mid: 90, high: 95 }[level]}% 이상이 맞다`;
      case "coverage":
        return `놓친 ${this.input} 비율이 ${{ low: 10, mid: 5, high: 1 }[level]}% 이하`;
      case "cost":
        return { low: `${base}보다 줄어든다`, mid: `${base}의 절반 이하`, high: "건당 0원 (유료 호출 없음)" }[level];
      default:
        return "목표치를 정한다";
    }
  }

  nonGoalCandidates(): SurveyCandidate[] {
    const out: SurveyCandidate[] = [];
    if (!this.has("edit")) out.push({ key: "ng:edit", label: "레포의 파일을 고치지 않는다" });
    if (!this.has("send")) out.push({ key: "ng:send", label: "결과를 밖으로 보내지 않는다" });
    out.push({ key: "ng:decide", label: "사람 대신 최종 결정을 내리지 않는다" });
    out.push({ key: "ng:store", label: `${josa(this.input, "을", "를")} 따로 저장하거나 학습에 쓰지 않는다` });
    if (this.has("classify")) out.push({ key: "ng:newcat", label: `${this.categoryName} 값을 스스로 새로 만들지 않는다` });
    if (this.memory === "none") out.push({ key: "ng:memory", label: "이전 대화나 결과를 기억하지 않는다" });
    if (this.riskLevel === "high") out.push({ key: "ng:highstakes", label: "사람의 건강 · 권리 · 안전에 관한 최종 판단을 하지 않는다" });
    return out;
  }

  get constraints(): string[] {
    const picked = list(this.answers["g.constraints"]);
    return (picked ?? []).filter((c) => c !== "none");
  }

  assumptionCandidates(): SurveyCandidate[] {
    const out: SurveyCandidate[] = [
      { key: "as:lang", label: `${josa(this.input, "은", "는")} 한국어로 들어온다` },
      { key: "as:size", label: `${this.input} 하나는 한 문단 안이다` },
      { key: "as:one", label: `${josa(this.input, "은", "는")} 한 번에 하나씩 들어온다` },
    ];
    if (this.has("recommend") || (this.ctx.references ?? []).length) out.push({ key: "as:fresh", label: "참고 자료와 안내 문서는 최신이다" });
    return out;
  }

  // ── 1.7 품질 (ISO 25010) ─────────────────────────────────────
  get speedSeconds(): number | null {
    const v = str(this.answers["q.speed"]);
    if (v === "any") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }
  get accuracy(): number | null {
    if (!this.has("classify")) return null;
    const n = Number(str(this.answers["q.accuracy"]));
    return n === 80 || n === 95 ? n : 90;
  }
  get privacy(): boolean {
    return str(this.answers["q.privacy"]) !== "no";
  }
  get trace(): "all" | "failures" | "none" {
    const v = str(this.answers["q.trace"]);
    return v === "failures" || v === "none" ? v : "all";
  }

  /** 줄마다 고른 우선순위. 답이 없으면 후보의 기본값. */
  priority(candidate: SurveyCandidate): Priority {
    const v = record(this.answers["r.reqs"])?.[candidate.key];
    if (v === "must" || v === "should" || v === "could" || v === "wont") return v;
    return candidate.priority ?? "must";
  }

  // ── 자료 조사 40건에서 (2026-10-05) ────────────────────────────
  /** 역량 질문 — 관계마다 하나 (Ontology Development 101). */
  cqCandidates(): (SurveyCandidate & { from: string; to: string })[] {
    const L = this.conceptLabels;
    const text: Record<string, string> = {
      "input>category": `이 ${L.input}의 ${L.category}는 무엇인가?`,
      "category>doc": `이 ${L.category}에는 어떤 안내 문서를 주는가?`,
      "input>doc": `이 ${josa(L.input, "에", "에")} 맞는 안내 문서는 무엇인가?`,
      "input>reason": `이 ${josa(L.input, "을", "를")} 왜 그렇게 판단했나?`,
      "input>summary": `이 ${L.input}의 요약은 무엇인가?`,
      "input>edited": `이 ${L.input} 때문에 고친 파일은 무엇인가?`,
      "input>message": `이 ${L.input}에 대해 무엇을 보냈나?`,
    };
    return this.relationRows().map((row) => {
      const [from, to] = row.key.split(">") as [string, string];
      return { key: `cq:${row.key}`, label: text[row.key] ?? row.label, from, to };
    });
  }

  get alternatives(): string[] {
    const picked = list(this.answers["g.alternatives"]);
    return (picked ?? []).filter((a) => a !== "none");
  }
  alternativeWhyNot(alt: string): string {
    const L = this.conceptLabels;
    const modelWork = this.modelOutputs.map((o) => this.ruleableRows().find((r) => r.key === o)?.label ?? o).join(" · ");
    switch (alt) {
      case "human":
        return this.current === "none" ? "사람이 하기엔 손이 모자라 지금은 안 하고 있다" : "사람이 계속 하면 걸리는 시간과 빠뜨림이 그대로다";
      case "tool":
        return this.needsModel ? `기존 도구로는 ${modelWork}를 할 수 없다` : "기존 도구에는 이 흐름이 한곳에 없다";
      case "rules":
        return this.needsModel ? `규칙과 표만으로는 ${modelWork}를 할 수 없다` : "규칙과 표만으로 된다 — 그래서 이 설계도 모델을 부르지 않는다";
      case "service":
        return `외부 서비스에 맡기면 ${josa(L.input, "을", "를")} 밖으로 보내야 한다`;
      default:
        return "검토했다";
    }
  }

  get outcome(): "act" | "handoff" | "record" | "decide" {
    const v = str(this.answers["g.outcome"]);
    return v === "handoff" || v === "record" || v === "decide" ? v : "act";
  }
  /** 「언제, 무엇을 받아서, 무엇을 할 수 있게」 (JTBD job story). */
  jobStory(): string {
    const L = this.conceptLabels;
    const when = { manual: `${josa(L.input, "을", "를")} 정리할 때`, schedule: "정해진 시간이 되면", event: `새 ${josa(L.input, "이", "가")} 들어오면` }[this.trigger];
    const produced = this.outputConceptIds().map((id) => L[id]).join(" · ") || "결과";
    const so = { act: "바로 처리할 수 있게", handoff: "맞는 사람에게 넘길 수 있게", record: "기록해 두고 나중에 볼 수 있게", decide: "결정을 내릴 수 있게" }[this.outcome];
    return `${when}, ${josa(produced, "을", "를")} 바로 받아서, ${so}`;
  }

  get riskLevel(): "low" | "medium" | "high" {
    const v = str(this.answers["g.impact"]);
    return v === "low" || v === "high" ? v : "medium";
  }
  get autonomy(): "suggest" | "approve" | "notify" | "full" {
    const v = str(this.answers["p.autonomy"]);
    if (v === "suggest" || v === "approve" || v === "notify" || v === "full") return v;
    return this.riskLevel === "high" ? "suggest" : "approve";
  }
  get escalations(): string[] {
    const picked = list(this.answers["p.escalate"]);
    if (picked) return picked.filter((e) => e !== "none");
    return this.riskLevel === "low" ? [] : ["lowconf"];
  }
  get untrusted(): boolean {
    return str(this.answers["i.untrusted"]) === "yes";
  }
  get memory(): "none" | "thread" | "long" {
    const v = str(this.answers["s.memory"]);
    return v === "thread" || v === "long" ? v : "none";
  }
  get confidence(): "always" | "low" | "none" {
    const v = str(this.answers["q.confidence"]);
    return v === "always" || v === "none" ? v : "low";
  }
  get correctable(): boolean {
    return str(this.answers["q.correct"]) !== "no";
  }
  get edgeCases(): string[] {
    return list(this.answers["e.edges"]) ?? [];
  }
  get evalSize(): number {
    const n = Number(str(this.answers["e.size"]));
    return n === 20 || n === 100 ? n : 50;
  }

  sampleRows(): SurveyRow[] {
    return this.has("classify") ? this.categories.map((v) => ({ key: v, label: `「${v}」 예` })) : [];
  }
  sample(rowKey: string): string {
    const v = record(this.answers["e.samples"])?.[rowKey];
    return typeof v === "string" && v.trim() && v !== SURVEY_UNSURE ? v.trim() : `${rowKey} 에 해당하는 ${this.input} 한 건`;
  }
}

export function conditionHolds(cond: SurveyCondition, r: SurveyReader): boolean {
  if (cond.fact === "needsModel") return r.needsModel;
  const value = r.answers[cond.item];
  const fallback: Record<string, unknown> = {
    "o.outputs": r.outputs,
    "p.actions": r.actions,
    "p.model": r.modelProvider,
    "g.metrics": r.metricKeys,
    "p.autonomy": r.autonomy,
  };
  const v = value === undefined || value === SURVEY_UNSURE ? fallback[cond.item] : value;
  if (cond.includes !== undefined) return Array.isArray(v) && v.includes(cond.includes);
  if (cond.includesAny) return Array.isArray(v) && cond.includesAny.some((x) => v.includes(x));
  if (cond.equals !== undefined) return v === cond.equals;
  if (cond.notEquals !== undefined) return v !== cond.notEquals;
  if (cond.notIn) return !cond.notIn.includes(String(v));
  return true;
}

export function itemVisible(item: SurveyItemDef, r: SurveyReader): boolean {
  if (!(item.showIf ?? []).every((c) => conditionHolds(c, r))) return false;
  // 줄이 하나도 없는 표 · 체크는 물을 것이 없다.
  if (item.dynamic === "relation-rows") return r.relationRows().length > 0;
  if (item.dynamic === "rule-candidates") return r.ruleCandidates().length > 0;
  if (item.dynamic === "doc-rows") return r.docRows().length > 0 && r.ctx.markdown.length > 0;
  if (item.dynamic === "target-rows") return r.targetRows().length > 0;
  if (item.dynamic === "cq-candidates") return r.cqCandidates().length > 0;
  return true;
}

export function visibleItems(r: SurveyReader): SurveyItemDef[] {
  return SURVEY_ITEMS.filter((item) => itemVisible(item, r));
}
