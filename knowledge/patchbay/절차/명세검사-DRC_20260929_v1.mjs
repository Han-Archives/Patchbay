// 명세 20260929a §7.1의 검사 목록 26개 — 시험 구현.
// 아직 커널이 아니다. M2가 `app/packages/core/src/ir/`로 옮길 때 이 파일이 검사 목록의 원본이 된다.
// 옛 판(요구사항설계-DRC_20260928_v1.mjs)은 한국어 키와 툴/모델 결합 검사를 쓴다 — 이 파일이 대체한다.
//
//   cd app/packages/core
//   node ../../../knowledge/patchbay/절차/명세검사-DRC_20260929_v1.mjs <ir.yaml> [레포 경로]
//
// 레포 경로를 주면 1.6의 파일 존재·조각 사용률까지 판정하고, 없으면 그 둘을 건너뛴다(통과로 세지 않는다).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const yaml = createRequire(process.cwd() + "/")("yaml");
import fs from "node:fs";
import path from "node:path";

/**
 * 명세 §7.1의 검사 26개를 IR 하나에 돌린다.
 * `ok: null`은 건너뜀(판정하지 않음)이고 통과로 세지 않는다.
 */
export function runChecks(d, docRoot) {
  const out = [];
  const check = (id, ok, note = "") => out.push({ id, ok, note });
  const skip = (id, note) => out.push({ id, ok: null, note });
  const repo = docRoot;

const CAPS = new Set(["cap:read", "cap:draft", "cap:pr", "cap:external"]);
const REDUCERS = new Set(["append", "lastWrite", "custom"]);
const PATTERNS = new Set(["ubiquitous", "event", "state", "unwanted", "optional"]);

const declared = new Set((d.caps ?? []).map((c) => c.id));
const capById = new Map((d.caps ?? []).map((c) => [c.id, c]));
const nodeIds = new Set((d.nodes ?? []).map((n) => n.id));
const fields = new Set((d.state ?? []).map((s) => s.field));
const evalIds = new Set((d.evals ?? []).map((e) => e.id));
const reqIds = new Set((d.requirements ?? []).map((r) => r.id));
const docIds = new Set((d.documents ?? []).map((x) => x.id));

// ── 1.0 · 1.1 ──────────────────────────────────────────────
check("1.0/verdict", Boolean(d.why?.verdict?.trim()));
check("1.1/done-judgeable", Array.isArray(d.done) && d.done.length > 0, `${d.done?.length ?? 0}개`);

// ── 1.2 권한 ───────────────────────────────────────────────
check("1.2/tool-caps",
  (d.tools ?? []).every((t) => (t.caps ?? []).length > 0 && t.caps.every((c) => declared.has(c))),
  `툴 ${(d.tools ?? []).length}개`);
// 모델 필요성은 why.needsModel 로 판정한다. 결론 문장을 정규식으로 훑지 않는다 — 표현이 바뀌면 검사가 뒤집힌다.
check("1.2/model-declared", !(d.why?.needsModel && (d.models ?? []).length === 0), `models ${(d.models ?? []).length}개`);
check("1.2/model-caps", (d.models ?? []).every((m) => (m.caps ?? []).every((c) => declared.has(c))));
check("1.2/irreversible-approval",
  (d.tools ?? []).every((t) => !t.irreversible || (t.caps ?? []).every((c) => capById.get(c)?.humanApproval === true)));
check("1.2/caps-known", [...declared].every((c) => CAPS.has(c)), [...declared].join(" "));

// ── 1.3 정보 경계 ──────────────────────────────────────────
const levelled = [...(d.reads ?? []), ...(d.emits ?? []), ...(d.documents ?? [])];
check("1.3/read-level", levelled.every((r) => Number.isInteger(r.level)), `${levelled.length}개`);
check("1.3/no-l4", !levelled.some((r) => r.level >= 4));
check("1.3/external-cap", !(d.emits ?? []).some((e) => e.to === "external") || declared.has("cap:external"));

// ── 1.4 넷리스트 ───────────────────────────────────────────
check("1.4/reducer-default",
  (d.state ?? []).every((s) => REDUCERS.has(s.reducer) && s.default !== undefined), `${(d.state ?? []).length}칸`);
check("1.4/custom-ref", (d.state ?? []).every((s) => s.reducer !== "custom" || Boolean(s.reducerRef)));

// ── 1.5 회로 ───────────────────────────────────────────────
const badField = [];
for (const n of d.nodes ?? [])
  for (const f of [...(n.reads ?? []), ...(n.writes ?? [])]) if (!fields.has(f)) badField.push(`${n.id}:${f}`);
check("1.5/known-fields", badField.length === 0, badField.join(", "));
const touched = new Set((d.nodes ?? []).flatMap((n) => [...(n.reads ?? []), ...(n.writes ?? [])]));
const orphan = [...fields].filter((f) => !touched.has(f));
check("1.5/no-orphan-field", orphan.length === 0, orphan.join(", "));
const edges = (d.edges ?? []).map((e) => [e.from, e.to]);
const grow = (seed, forward) => {
  const s = new Set(seed);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of edges) {
      const [from, to] = forward ? [a, b] : [b, a];
      if (s.has(from) && !s.has(to)) { s.add(to); grew = true; }
    }
  }
  return s;
};
const reach = grow(["__start__"], true);
const canEnd = grow(["__end__"], false);
check("1.5/reachable", [...nodeIds].every((i) => reach.has(i)), [...nodeIds].filter((i) => !reach.has(i)).join(", "));
check("1.5/can-end", [...nodeIds].every((i) => canEnd.has(i)), [...nodeIds].filter((i) => !canEnd.has(i)).join(", "));

// ── 1.6 문서 의존 ──────────────────────────────────────────
check("1.6/node-exists", (d.documents ?? []).every((x) => nodeIds.has(x.node)));
const refs = (d.nodes ?? []).flatMap((n) => n.documents ?? []);
check("1.6/doc-ref-exists", refs.every((r) => docIds.has(r)), `노드가 가리키는 문서 ${refs.length}개`);
if (repo) {
  const missing = (d.documents ?? []).map((x) => x.path).filter((p) => !fs.existsSync(path.join(repo, p)));
  check("1.6/doc-exists", missing.length === 0, `${(d.documents ?? []).length}개 확인${missing.length ? " · 없음: " + missing.join(", ") : ""}`);
  // 후보 풀은 선언된 문서들이 실제로 사는 폴더들의 합집합이다.
  const folders = [...new Set((d.documents ?? []).map((x) => path.dirname(x.path)))];
  let pool = 0;
  for (const f of folders) {
    const abs = path.join(repo, f);
    if (fs.existsSync(abs)) pool += fs.readdirSync(abs).filter((n) => n.endsWith(".md")).length;
  }
  const used = new Set((d.documents ?? []).map((x) => x.path)).size;
  check("1.6/doc-coverage", used >= pool / 2, `후보 ${pool}개 중 ${used}개를 쓴다`);
} else {
  skip("1.6/doc-exists", "레포 경로가 없다");
  skip("1.6/doc-coverage", "레포 경로가 없다");
}

// ── 1.7 요구사항 ───────────────────────────────────────────
check("1.7/ears-pattern", (d.requirements ?? []).every((r) => PATTERNS.has(r.pattern)),
  (d.requirements ?? []).filter((r) => !PATTERNS.has(r.pattern)).map((r) => r.id).join(", "));
const unwanted = (d.requirements ?? []).filter((r) => r.pattern === "unwanted").length;
check("1.7/unwanted", unwanted >= 1, `${unwanted}개`);

// ── 1.8 추적 표 ────────────────────────────────────────────
const linked = new Set((d.requirementLinks ?? []).map((l) => l.requirement));
const blanks = [...reqIds].filter((r) => !linked.has(r));
check("1.8/rtm-complete", blanks.length === 0, blanks.length ? `빈 칸: ${blanks.join(", ")}` : "");
check("1.8/eval-node-exists", (d.evals ?? []).every((e) => nodeIds.has(e.node)));
check("1.8/link-integrity",
  (d.requirementLinks ?? []).every((l) => reqIds.has(l.requirement) && nodeIds.has(l.node) && evalIds.has(l.eval)));
check("1.8/eval-scoring", (d.evals ?? []).every((e) => e.kind !== "model" || Boolean(e.scoring)));

  return out;
}

/** 실패한 검사 id와 돌아갈 칸. 회귀 기준은 통과 개수가 아니다 (명세 §9 채택값 18). */
export function failuresOf(results) {
  const failed = results.filter((r) => r.ok === false).map((r) => r.id);
  return { failed, gates: [...new Set(failed.map((id) => id.split("/")[0]))] };
}

export function printResults(results, title) {
  console.log(`\n=== 설계 규칙 검사 — ${title} ===\n`);
  for (const r of results) console.log(`  ${r.ok === null ? "⏭ " : r.ok ? "✅" : "❌"} ${r.id}${r.note ? `  — ${r.note}` : ""}`);
  const ran = results.filter((r) => r.ok !== null);
  const pass = ran.filter((r) => r.ok).length;
  const skipped = results.length - ran.length;
  console.log(`\n  ${pass} / ${ran.length} 통과${skipped ? ` · ${skipped}개 건너뜀` : ""}`);
  const { gates } = failuresOf(results);
  console.log(`  ${gates.length ? "돌아갈 칸: " + gates.join(" · ") : "게이트 통과 — 2단계로"}\n`);
  return gates.length;
}

// 직접 실행했을 때만 CLI로 동작한다. import 하면 위 함수만 쓴다.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [, , irPath, docRoot] = process.argv;
  if (!irPath) {
    console.error("사용법: node 명세검사-DRC_20260929_v1.mjs <ir.yaml> [문서 루트]");
    process.exit(2);
  }
  const ir = yaml.parse(fs.readFileSync(irPath, "utf8"));
  process.exitCode = printResults(runChecks(ir, docRoot), path.basename(irPath)) ? 1 : 0;
}
