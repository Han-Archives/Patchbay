import { createHash } from "node:crypto";
import { consultProgress, consultItem } from "./catalog.js";
import { sourceFor, type Provenance, type ProvenanceSource, EMPTY_PROVENANCE } from "./provenance.js";
import { requirementDisplay } from "./display.js";

/**
 * PRD — 초안에서 **결정적으로** 그린다 (명세 20261006a §14). 모델이 쓰지 않는다.
 *
 * 그래서 사람이 검토한 글과 채택되는 설계가 같다. 초안은 미완성이 정상이라 `unknown` 위에서 돈다 —
 * 상담 중에도 PRD가 자라는 것을 보여야 한다. 비어 있는 자리는 「아직」으로 적고 지어내지 않는다.
 */

export interface PrdLine {
  text: string;
  source: ProvenanceSource;
  /** 이 줄의 IR 경로. 비어 있으면 IR 자리가 없는 줄(아직 · 진행)이다. */
  path: string;
  gate: string;
  /** 근거 턴 — 상담 기록의 seq. 요약 패널이 이 줄을 누르면 그 말로 간다 (§12.5). */
  turn?: number;
  /** 줄인 줄의 원문 — 화면이 접어 두었다가 펼친다 (요구사항). */
  detail?: string;
}

export interface PrdSection {
  /** 1~11. 절 번호는 고정이다 — 검토 기록이 이 번호로 붙는다. */
  n: number;
  title: string;
  gates: string[];
  lines: PrdLine[];
  /** 그린 줄들의 지문. 바뀌면 그 절의 검토가 「확인 전」으로 돌아간다 (§14.2). */
  digest: string;
}

export const PRD_SECTION_TITLES = [
  "한 줄 요약과 배경",
  "쓰는 사람과 장면",
  "목표와 성공 기준",
  "범위 · 하지 않는 것 · 가정 · 제약",
  "다루는 것",
  "동작 흐름",
  "실행 환경",
  "맡기는 범위와 안전",
  "참고 문서",
  "약속과 시험",
  "아직 정하지 않은 것",
] as const;

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(obj) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

const PATTERN_LABEL: Record<string, string> = {
  ubiquitous: "항상",
  event: "~하면",
  state: "~인 동안",
  unwanted: "잘못되면",
  optional: "있으면",
};
const PRIORITY_LABEL: Record<string, string> = { must: "꼭", should: "있으면 좋음", could: "나중에" };
const CAP_LABEL: Record<string, string> = {
  "cap:read": "읽기",
  "cap:draft": "초안 쓰기",
  "cap:pr": "진짜 파일 고치기",
  "cap:external": "밖으로 보내기",
};
const RISK_LABEL: Record<string, string> = { low: "작음", medium: "중간", high: "큼" };
const AUTONOMY_LABEL: Record<string, string> = {
  suggest: "제안만",
  approve: "확인 뒤 실행",
  notify: "실행하고 알림",
  full: "끝까지 스스로",
};
const MEMORY_LABEL: Record<string, string> = { none: "기억하지 않음", thread: "이번 대화 안에서만", long: "계속 기억" };
const STORED_LABEL: Record<string, string> = { env: "환경 변수", keychain: "키체인", host: "호스트 로그인", file: "파일" };

const digestOf = (lines: PrdLine[]): string =>
  createHash("sha256")
    .update(lines.map((line) => `${line.source}|${line.path}|${line.text}`).join("\n"))
    .digest("hex")
    .slice(0, 16);

export function renderPrd(draft: unknown, provenance: Provenance = EMPTY_PROVENANCE): PrdSection[] {
  const ir = obj(draft);
  const sections: PrdLine[][] = PRD_SECTION_TITLES.map(() => []);
  const gatesOf: string[][] = PRD_SECTION_TITLES.map(() => []);

  const put = (n: number, gate: string, path: string, text: string): void => {
    if (!text) return;
    const origin = sourceFor(provenance, path);
    sections[n - 1]!.push({ text, source: origin.source, path, gate, ...(typeof origin.turn === "number" ? { turn: origin.turn } : {}) });
    if (!gatesOf[n - 1]!.includes(gate)) gatesOf[n - 1]!.push(gate);
  };
  const gap = (n: number, gate: string, what: string): void => {
    sections[n - 1]!.push({ text: `${what} — 아직`, source: "default", path: "", gate });
    if (!gatesOf[n - 1]!.includes(gate)) gatesOf[n - 1]!.push(gate);
  };

  // 1 — 한 줄 요약과 배경
  const why = obj(ir.why);
  if (str(ir.goal)) put(1, "1.1", "goal", str(ir.goal));
  else gap(1, "1.1", "목적");
  put(1, "1.0", "why.alternative", str(why.alternative) && `지금 방식: ${str(why.alternative)}`);
  put(1, "1.0", "why.modelNeed", str(why.modelNeed) && `규칙으로 안 되는 일: ${str(why.modelNeed)}`);
  put(1, "1.0", "why.verdict", str(why.verdict) && `결론: ${str(why.verdict)}`);
  list(ir.alternatives).forEach((alt, i) =>
    put(1, "1.0", `alternatives[${i}]`, `검토한 대안 — ${str(alt.what)}: ${str(alt.whyNot)}`),
  );

  // 2 — 쓰는 사람과 장면
  list(ir.stakeholders).forEach((s, i) => put(2, "1.1", `stakeholders[${i}]`, `${str(s.role)} — ${str(s.need)}`));
  put(2, "1.1", "jobStory", str(ir.jobStory) && `장면: ${str(ir.jobStory)}`);
  const ui = obj(ir.interface);
  if (strs(ui.entry).length) put(2, "1.7", "interface.entry", `부르는 곳: ${strs(ui.entry).join(" · ")}`);
  put(2, "1.7", "interface.output", str(ui.output) && `결과 모양: ${str(ui.output)}`);
  put(2, "1.7", "interface.review", str(ui.review) && `사람이 확인하는 화면: ${str(ui.review)}`);
  if (!sections[1]!.length) gap(2, "1.1", "쓰는 사람과 장면");

  // 3 — 목표와 성공 기준
  strs(ir.done).forEach((d, i) => put(3, "1.1", `done[${i}]`, `완료: ${d}`));
  list(ir.metrics).forEach((m, i) => put(3, "1.1", `metrics[${i}]`, `성공 지표: ${str(m.what)} → ${str(m.target) || "목표치 없음"}`));
  if (!sections[2]!.length) gap(3, "1.1", "완료 조건");

  // 4 — 범위
  strs(ir.nonGoals).forEach((t, i) => put(4, "1.1", `nonGoals[${i}]`, `하지 않음: ${t}`));
  strs(ir.assumptions).forEach((t, i) => put(4, "1.1", `assumptions[${i}]`, `가정: ${t}`));
  strs(ir.constraints).forEach((t, i) => put(4, "1.1", `constraints[${i}]`, `제약: ${t}`));
  if (!sections[3]!.length) gap(4, "1.1", "하지 않는 것");

  // 5 — 다루는 것
  const concepts = list(ir.concepts);
  const labelOf = (id: string): string => str(concepts.find((c) => str(c.id) === id)?.label) || id;
  concepts.forEach((c, i) => {
    const values = strs(c.values);
    put(5, "0.0", `concepts[${i}]`, `${str(c.label) || str(c.id)} (${str(c.kind)})${values.length ? ` — ${values.join(" · ")}` : ""}`);
  });
  const CARD: Record<string, string> = { one: "정확히 하나", optional: "없거나 하나", many: "여럿" };
  list(ir.relations).forEach((r, i) =>
    put(5, "0.0", `relations[${i}]`, `${labelOf(str(r.from))} → ${labelOf(str(r.to))} · ${CARD[str(r.cardinality)] ?? str(r.cardinality)}`),
  );
  list(ir.rules).forEach((r, i) => put(5, "0.0", `rules[${i}]`, `규칙: ${str(r.text)}`));
  list(ir.competencyQuestions).forEach((q, i) => put(5, "0.0", `competencyQuestions[${i}]`, `답해야 하는 질문: ${str(q.text)}`));
  if (!sections[4]!.length) gap(5, "0.0", "다루는 것");

  // 6 — 동작 흐름 (회로 그림은 화면이 같은 초안으로 그린다)
  const nodes = list(ir.nodes);
  const nodeLabel = (id: string): string =>
    id === "__start__" ? "시작" : id === "__end__" ? "끝" : str(nodes.find((n) => str(n.id) === id)?.label) || id;
  nodes.forEach((n, i) => {
    const writes = strs(n.writes);
    put(6, "1.5", `nodes[${i}]`, `${str(n.label) || str(n.id)}${writes.length ? ` — ${writes.join(" · ")}을(를) 채운다` : ""}`);
  });
  list(ir.edges).forEach((e, i) =>
    put(6, "1.5", `edges[${i}]`, `${nodeLabel(str(e.from))} → ${nodeLabel(str(e.to))}${str(e.when) ? ` (${str(e.when)})` : ""}`),
  );
  const state = list(ir.state);
  if (state.length) put(6, "1.4", "state", `들고 다니는 값: ${state.map((s) => str(s.field)).join(" · ")}`);
  if (!sections[5]!.length) gap(6, "1.5", "단계와 순서");

  // 7 — 실행 환경
  const env = obj(ir.environment);
  if (Object.keys(env).length) {
    put(7, "1.2", "environment.language", `언어: ${str(env.language) || "typescript"}${str(env.runtime) ? ` · ${str(env.runtime)}` : ""}`);
    const remote = obj(env.remote);
    put(
      7,
      "1.2",
      "environment.location",
      str(env.location) === "remote"
        ? `도는 곳: 원격 ${str(remote.host)} — 콘솔은 터널 ${str(remote.tunnel) || "(주소 없음)"}로 붙는다`
        : "도는 곳: 이 컴퓨터",
    );
    put(7, "1.2", "environment.workdir", str(env.workdir) && `작업 폴더: ${str(env.workdir)}`);
    put(7, "1.2", "environment.hardware", str(env.hardware) && `하드웨어: ${str(env.hardware)}`);
    if (strs(env.libraries).length) put(7, "1.2", "environment.libraries", `라이브러리: ${strs(env.libraries).join(" · ")}`);
  } else gap(7, "1.2", "실행 환경");
  list(ir.models).forEach((m, i) =>
    put(7, "1.2", `models[${i}]`, `모델: ${str(m.id)} (${str(m.provider)}) · 기다리는 시간 ${str(m.timeoutMs) || "20000"}ms`),
  );

  // 8 — 맡기는 범위와 안전
  list(ir.caps).forEach((c, i) =>
    put(
      8,
      "1.2",
      `caps[${i}]`,
      `${CAP_LABEL[str(c.id)] ?? str(c.id)}: ${str(c.scope)} · 되돌리기 ${str(c.undo) || "-"}${c.humanApproval === true ? " · 사람 확인" : ""}`,
    ),
  );
  list(ir.tools).forEach((t, i) =>
    put(8, "1.2", `tools[${i}]`, `도구: ${str(t.id)} — ${str(t.what)}${str(t.via) === "mcp" ? ` (MCP ${str(t.server)})` : ""}`),
  );
  if (str(ir.riskLevel)) put(8, "1.2", "riskLevel", `틀리면 피해: ${RISK_LABEL[str(ir.riskLevel)] ?? str(ir.riskLevel)}`);
  if (str(ir.autonomy)) put(8, "1.2", "autonomy", `스스로 하는 정도: ${AUTONOMY_LABEL[str(ir.autonomy)] ?? str(ir.autonomy)}`);
  if (str(ir.memory)) put(8, "1.4", "memory", `기억: ${MEMORY_LABEL[str(ir.memory)] ?? str(ir.memory)}`);
  list(ir.reads).forEach((r, i) => put(8, "1.3", `reads[${i}]`, `읽음: ${str(r.path)} · 민감도 ${str(r.level)}`));
  list(ir.emits).forEach((e, i) =>
    put(8, "1.3", `emits[${i}]`, `내보냄: ${str(e.what)} → ${str(e.to)}${str(e.where) ? ` (${str(e.where)})` : ""}`),
  );
  list(ir.credentials).forEach((c, i) =>
    put(8, "1.3", `credentials[${i}]`, `자격 증명: ${str(c.what)} — ${STORED_LABEL[str(c.storedAt)] ?? str(c.storedAt)}`),
  );
  if (!sections[7]!.length) gap(8, "1.2", "맡기는 범위");

  // 9 — 참고 문서
  list(ir.references).forEach((r, i) => put(9, "0.0", `references[${i}]`, `참고: ${str(r.title)} (${str(r.uri)})`));
  list(ir.documents).forEach((d, i) => put(9, "1.6", `documents[${i}]`, `${str(d.when)} → ${str(d.path)}`));
  if (!sections[8]!.length) gap(9, "1.6", "참고 문서");

  // 10 — 약속과 시험
  // 요구사항은 짧은 한 줄을 먼저 보인다 — 「시스템은」 · EARS 머리는 원문(detail)에만 (사용자 요청 2026-10-07).
  list(ir.requirements).forEach((q, i) => {
    const priority = PRIORITY_LABEL[str(q.priority)];
    const shown = requirementDisplay(q);
    put(10, "1.7", `requirements[${i}]`, `${str(q.id)}${priority ? ` · ${priority}` : ""} — ${shown.short}${str(q.fit) ? ` (기준: ${str(q.fit)})` : ""}`);
    const last = sections[9]!.at(-1);
    if (last && last.path === `requirements[${i}]`) {
      last.detail = `[${PATTERN_LABEL[str(q.pattern)] ?? str(q.pattern)}] ${shown.full}`;
    }
  });
  list(ir.evals).forEach((e, i) => put(10, "1.8", `evals[${i}]`, `시험 ${str(e.id)}: 「${str(e.input)}」 → ${str(e.expect)}`));
  const links = list(ir.requirementLinks);
  const linked = new Set(links.map((l) => str(l.requirement)));
  const unlinked = list(ir.requirements).map((q) => str(q.id)).filter((id) => id && !linked.has(id));
  if (links.length) put(10, "1.8", "requirementLinks", unlinked.length ? `시험에 안 이어진 약속: ${unlinked.join(", ")}` : "약속마다 시험이 이어져 있다");
  if (!sections[9]!.length) gap(10, "1.7", "약속과 시험");

  // 11 — 아직 정하지 않은 것
  strs(ir.openQuestions).forEach((t, i) => put(11, "전체", `openQuestions[${i}]`, t));
  const progress = consultProgress(draft);
  for (const topic of progress.topics) {
    if (topic.missing.length === 0) continue;
    const labels = topic.missing.map((id) => consultItem(id)?.label ?? id);
    sections[10]!.push({ text: `${topic.name}: ${labels.join(" · ")}`, source: "default", path: "", gate: "전체" });
  }
  if (!gatesOf[10]!.length) gatesOf[10]!.push("전체");
  if (!sections[10]!.length) sections[10]!.push({ text: "없음", source: "default", path: "", gate: "전체" });

  return PRD_SECTION_TITLES.map((title, i) => ({
    n: i + 1,
    title,
    gates: gatesOf[i]!,
    lines: sections[i]!,
    digest: digestOf(sections[i]!),
  }));
}
