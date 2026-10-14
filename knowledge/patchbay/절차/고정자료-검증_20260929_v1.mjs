// 고정 시험 자료 검증 — 명세 20260929a §8.
//
//   cd app/packages/core && node ../../../knowledge/patchbay/절차/고정자료-검증_20260929_v1.mjs
//
// 두 가지를 확인한다.
//   1. valid.ir.yaml 이 26개 검사를 전부 통과한다.
//   2. fail-cases.yaml 의 각 건이 **지목한 검사를 실제로 깨뜨린다.**
//
// 2번이 핵심이다. 통과하는 자료만 있으면 검사가 아무것도 안 잡아도 늘 초록이다
// (구현준비 5절 «새 검사는 실패 고정 자료를 먼저 만든 뒤 구현한다»).
// 같이 깨지는 검사는 막지 않는다 — 한 칸을 무너뜨리면 다른 칸도 흔들리는 것이 설계의 사실이고,
// 무효 전파(명세 §7.3)가 말하는 바다. 다만 **지목한 검사는 반드시 깨져야** 한다.

import { createRequire } from "node:module";
const yaml = createRequire(process.cwd() + "/")("yaml");
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks, failuresOf } from "./명세검사-DRC_20260929_v1.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, "../../../app/packages/core/src/ir/__fixtures__");
const RUNS = path.resolve(HERE, "../../../app/packages/core/src/runs/__fixtures__");

const load = (p) => yaml.parse(fs.readFileSync(p, "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

/** `a.b[0].c` → 부모 컨테이너와 마지막 키. */
function resolve(root, dotted) {
  const parts = dotted.replace(/\[(\d+)\]/g, ".$1").split(".");
  let node = root;
  for (const key of parts.slice(0, -1)) node = node[Array.isArray(node) ? Number(key) : key];
  const last = parts.at(-1);
  return { node, key: Array.isArray(node) ? Number(last) : last };
}

function applyOps(ir, ops) {
  const next = clone(ir);
  for (const op of ops) {
    if ("set" in op) {
      const { node, key } = resolve(next, op.set);
      node[key] = op.to;
    } else if ("delete" in op) {
      const { node, key } = resolve(next, op.delete);
      if (Array.isArray(node)) node.splice(key, 1);
      else delete node[key];
    } else if ("append" in op) {
      const { node, key } = resolve(next, `${op.append}.0`);
      void key;
      node.push(op.item);
    } else {
      throw new Error(`모르는 op: ${JSON.stringify(op)}`);
    }
  }
  return next;
}

const valid = load(path.join(FIXTURES, "valid.ir.yaml"));
const { cases } = load(path.join(FIXTURES, "fail-cases.yaml"));

let bad = 0;
console.log("\n=== 고정 시험 자료 검증 ===\n");

// 1. 유효 자료
const baseline = runChecks(valid, FIXTURES);
const baseFail = failuresOf(baseline).failed;
const ran = baseline.filter((r) => r.ok !== null).length;
if (baseFail.length) {
  console.log(`  ❌ valid.ir.yaml 이 통과하지 못한다 — ${baseFail.join(", ")}`);
  bad += 1;
} else {
  console.log(`  ✅ valid.ir.yaml — ${ran} / ${ran} 통과`);
}

// 2. 검사마다 실패 자료가 하나씩 있나
const covered = new Set(cases.map((c) => c.check));
const allChecks = baseline.map((r) => r.id);
const uncovered = allChecks.filter((id) => !covered.has(id));
if (uncovered.length) {
  console.log(`  ❌ 실패 자료가 없는 검사 ${uncovered.length}개 — ${uncovered.join(", ")}`);
  bad += 1;
} else {
  console.log(`  ✅ 검사 ${allChecks.length}개 전부에 실패 자료가 있다`);
}

// 3. 각 건이 지목한 검사를 실제로 깨뜨리나
console.log();
for (const c of cases) {
  const mutated = applyOps(valid, c.ops);
  const results = runChecks(mutated, FIXTURES);
  const failed = failuresOf(results).failed;
  const hit = failed.includes(c.check);
  const collateral = failed.filter((id) => id !== c.check);
  if (!hit) bad += 1;
  console.log(
    `  ${hit ? "✅" : "❌"} ${c.check.padEnd(28)}${hit ? "" : "  ← 깨지지 않았다"}` +
      (collateral.length ? `  (같이 깨짐: ${collateral.join(", ")})` : ""),
  );
}

// 4. 실행 기록 고정 자료 — 명세 §5.2의 필수 필드
const REQUIRED = ["runId", "graphId", "irVersion", "status", "nodeId", "startedAt", "endedAt",
                  "modelCalls", "toolCalls", "documentCalls", "usage", "error"];
const STATUSES = new Set(["success", "error", "timeout", "refused"]);
console.log();
for (const name of ["success.json", "refused.json", "timeout.json"]) {
  const file = path.join(RUNS, name);
  if (!fs.existsSync(file)) { console.log(`  ❌ ${name} 이 없다`); bad += 1; continue; }
  const rec = JSON.parse(fs.readFileSync(file, "utf8"));
  const missing = REQUIRED.filter((f) => !(f in rec));
  const okStatus = STATUSES.has(rec.status);
  const ok = missing.length === 0 && okStatus;
  if (!ok) bad += 1;
  console.log(`  ${ok ? "✅" : "❌"} ${name.padEnd(14)} status=${rec.status}` +
    (missing.length ? `  빠진 필드: ${missing.join(", ")}` : "") + (okStatus ? "" : "  ← 상태값이 네 값 밖이다"));
}

console.log(`\n  ${bad ? `${bad}건 실패` : "전부 통과"}\n`);
process.exitCode = bad ? 1 : 0;
