// 진행 화면 생성기 — `knowledge/patchbay/기획/실행.md`를 읽어 `knowledge/patchbay/진행.html`로 렌더한다.
//
//   cd app/packages/core && node ../../../knowledge/patchbay/절차/진행보기_20260929_v1.mjs
//   → knowledge/patchbay/진행.html  (IDE에서 열거나 브라우저로 본다)
//
// 파일이 소스 오브 트루스고 화면은 그 렌더다 (기획서 원칙 7). 표와 다이어그램을 손으로
// 옮겨 적지 않는다 — 옮겨 적으면 실행.md를 고칠 때마다 화면이 조용히 낡는다.
// 고정 자료 검증은 **생성 시점에 실제로 돌려서** 그 출력을 그대로 싣는다.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = path.join(ROOT, "knowledge/patchbay/기획/실행.md");
const OUT = path.join(ROOT, "knowledge/patchbay/진행.html");

const md = fs.readFileSync(SRC, "utf8");

// ── 실행.md 파싱 ────────────────────────────────────────────
/** mermaid 블록의 `id["라벨"]`과 `a --> b`. */
function parseDiagram(text) {
  const block = text.match(/```mermaid\n([\s\S]*?)```/);
  if (!block) return { nodes: [], edges: [] };
  const nodes = [];
  const edges = [];
  for (const line of block[1].split("\n")) {
    const node = line.match(/^\s*([\w-]+)\["([^"]+)"\]/);
    if (node) { nodes.push({ id: node[1], label: node[2] }); continue; }
    const edge = line.match(/^\s*([\w-]+)\s*-->\s*([\w-]+)/);
    if (edge) edges.push({ from: edge[1], to: edge[2] });
  }
  return { nodes, edges };
}

/** 「단계 · 상태 · 작업 · 파일」 표. 첫 번째 것만 읽는다. */
function parseTable(text) {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => /^\|\s*단계\s*\|\s*상태\s*\|/.test(l));
  if (head < 0) return [];
  const rows = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 4) rows.push({ step: cells[0], status: cells[1], work: cells[2], files: cells[3] });
  }
  return rows;
}

/** 콘솔의 parseWorkLogPhase 와 같은 규칙. */
const phaseOf = (status) => (/완료|done/i.test(status) ? "done" : /진행|running/i.test(status) ? "running" : "idle");

const { nodes, edges } = parseDiagram(md);
const rows = parseTable(md);
const phases = new Map(rows.map((r) => [r.step.replace(/\*\*/g, ""), phaseOf(r.status)]));

// 표의 「단계」와 노드 라벨이 정확히 일치해야 노드에 상태색이 붙는다.
const unmatched = nodes.filter((n) => !phases.has(n.label)).map((n) => n.label);

// ── 배치: 최장경로 랭크 (콘솔 layoutArchitecture 와 같은 규칙) ──
const incoming = new Map(nodes.map((n) => [n.id, []]));
for (const e of edges) if (incoming.has(e.to)) incoming.get(e.to).push(e.from);
const rank = new Map();
const visiting = new Set();
function rankOf(id) {
  if (rank.has(id)) return rank.get(id);
  if (visiting.has(id)) return 0;          // 순환 가드 — 콘솔과 같은 이유로 순환 엣지를 넣지 않는다
  visiting.add(id);
  const preds = incoming.get(id) ?? [];
  const value = preds.length === 0 ? 0 : Math.max(...preds.map(rankOf)) + 1;
  visiting.delete(id);
  rank.set(id, value);
  return value;
}
nodes.forEach((n) => rankOf(n.id));

const BOX_W = 132, BOX_H = 46, COL = 186, ROW = 68, PAD = 16;
const byRank = new Map();
for (const n of nodes) {
  const r = rank.get(n.id) ?? 0;
  byRank.set(r, [...(byRank.get(r) ?? []), n]);
}
const pos = new Map();
for (const [r, list] of byRank) {
  list.forEach((n, i) => pos.set(n.id, { x: PAD + r * COL, y: PAD + i * ROW }));
}
const width = PAD + (Math.max(...rank.values()) + 1) * COL - (COL - BOX_W) + PAD;
const height = PAD + Math.max(...[...byRank.values()].map((l) => l.length)) * ROW - (ROW - BOX_H) + PAD;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** 인라인 마크다운(굵게·코드)만 최소로 렌더한다. */
const inline = (s) =>
  esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");

// 엣지: 출발 칸의 상태로 색을 준다. 같은 출발에서 여러 개면 중간 x를 어긋뜨린다.
const fanout = new Map();
const traces = edges.map((e) => {
  const a = pos.get(e.from), b = pos.get(e.to);
  if (!a || !b) return "";
  const n = fanout.get(e.from) ?? 0;
  fanout.set(e.from, n + 1);
  const sx = a.x + BOX_W, sy = a.y + BOX_H / 2 + (n - 1) * 6;
  const tx = b.x - 4, ty = b.y + BOX_H / 2;
  const mid = sx + 14 + n * 7;
  const src = nodes.find((x) => x.id === e.from);
  const cls = phases.get(src?.label ?? "") ?? "idle";
  const d = Math.abs(sy - ty) < 1 ? `M${sx} ${sy} H${tx}` : `M${sx} ${sy} H${mid} V${ty} H${tx}`;
  return `<path class="t t-${cls}" marker-end="url(#ah-${cls})" d="${d}"/>`;
}).join("\n        ");

const boxes = nodes.map((n) => {
  const p = pos.get(n.id);
  const cls = phases.get(n.label) ?? "idle";
  const lines = n.label.length > 9 ? [n.label.slice(0, Math.ceil(n.label.length / 2)), n.label.slice(Math.ceil(n.label.length / 2))] : [n.label];
  const text = lines.map((l, i) =>
    `<text class="lbl ${cls === "idle" ? "lbl-idle" : ""}" x="${p.x + BOX_W / 2}" y="${p.y + BOX_H / 2 + 4 + (i - (lines.length - 1) / 2) * 14}" text-anchor="middle">${esc(l)}</text>`).join("");
  return `<rect class="n n-${cls}" x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="2"/>${text}`;
}).join("\n        ");

// ── 고정 자료 검증을 실제로 돌린다 ──────────────────────────
let verify = "", verifyOk = false;
try {
  verify = execFileSync("node", [path.join(HERE, "고정자료-검증_20260929_v1.mjs")], {
    cwd: path.join(ROOT, "app/packages/core"), encoding: "utf8",
  });
  verifyOk = /전부 통과/.test(verify);
} catch (err) {
  verify = (err.stdout ?? "") + (err.stderr ?? String(err));
}

const counts = { done: 0, running: 0, idle: 0 };
for (const r of rows) counts[phaseOf(r.status)] += 1;
const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
const next = rows.find((r) => phaseOf(r.status) === "running") ?? rows.find((r) => phaseOf(r.status) === "idle");

const html = `<title>Patchbay 진행</title>
<style>
  :root {
    --ground:#E7EBE8; --panel:#F8FAF8; --panel2:#EFF3F0; --ink:#151A18; --ink2:#4A5652; --ink3:#7C8A84;
    --rule:#C9D3CD; --soft:#DBE3DE; --done:#1C7551; --done-t:#DDEDE5; --run:#A85C16; --run-t:#F5E7D6; --idle:#8A958F;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --ground:#0E1312; --panel:#161D1A; --panel2:#1B2421; --ink:#E4EBE7; --ink2:#A3B1AB; --ink3:#74837C;
    --rule:#2C3833; --soft:#232E2A; --done:#4FC295; --done-t:#14332A; --run:#DB9550; --run-t:#332514; --idle:#66746D;
  } }
  :root[data-theme="dark"] {
    --ground:#0E1312; --panel:#161D1A; --panel2:#1B2421; --ink:#E4EBE7; --ink2:#A3B1AB; --ink3:#74837C;
    --rule:#2C3833; --soft:#232E2A; --done:#4FC295; --done-t:#14332A; --run:#DB9550; --run-t:#332514; --idle:#66746D;
  }
  body { background:var(--ground); color:var(--ink); font-family:"IBM Plex Sans KR",-apple-system,system-ui,sans-serif; font-size:14px; line-height:1.6; }
  .wrap { max-width:1180px; margin:0 auto; padding:32px 22px 60px; display:flex; flex-direction:column; gap:30px; }
  h1 { font-size:26px; font-weight:700; letter-spacing:-.02em; margin:0; }
  .eyebrow { font-size:10.5px; font-weight:600; letter-spacing:.18em; color:var(--ink3); margin:0; }
  .sub { margin:0; color:var(--ink2); }
  code { font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:.92em; }
  .readout { display:flex; flex-wrap:wrap; border:1px solid var(--rule); border-radius:3px; background:var(--panel); overflow:hidden; }
  .readout div { flex:1 1 120px; padding:11px 15px; border-right:1px solid var(--soft); }
  .readout div:last-child { border-right:0; }
  .readout dt { font-size:10px; font-weight:600; letter-spacing:.14em; color:var(--ink3); }
  .readout dd { margin:0; font-family:"IBM Plex Mono",monospace; font-size:18px; font-variant-numeric:tabular-nums; }
  .readout .u { font-size:11.5px; color:var(--ink3); font-family:inherit; }
  figure { margin:0; display:flex; flex-direction:column; gap:12px; }
  .scroll { overflow-x:auto; border:1px solid var(--rule); border-radius:3px; background:var(--panel); padding:8px; }
  svg { display:block; min-width:${width}px; width:100%; height:auto; }
  .n { stroke-width:1.25; } .n-done{fill:var(--done-t);stroke:var(--done);} .n-running{fill:var(--run-t);stroke:var(--run);} .n-idle{fill:var(--panel2);stroke:var(--rule);}
  .lbl { font-family:inherit; font-size:11px; font-weight:500; fill:var(--ink); } .lbl-idle{fill:var(--ink2);}
  .t { fill:none; stroke-width:1.25; } .t-done{stroke:var(--done);} .t-running{stroke:var(--run);} .t-idle{stroke:var(--rule);}
  #ah-done path{fill:var(--done);} #ah-running path{fill:var(--run);} #ah-idle path{fill:var(--rule);}
  .legend { display:flex; gap:20px; flex-wrap:wrap; font-size:12.5px; color:var(--ink2); }
  .legend span { display:inline-flex; align-items:center; gap:7px; }
  .sw { width:20px; height:10px; border-radius:2px; border:1.25px solid; }
  .sw-done{background:var(--done-t);border-color:var(--done);} .sw-running{background:var(--run-t);border-color:var(--run);} .sw-idle{background:var(--panel2);border-color:var(--rule);}
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--rule); border-radius:3px; }
  th { text-align:left; font-size:10.5px; font-weight:600; letter-spacing:.14em; color:var(--ink3); padding:10px 14px; border-bottom:1px solid var(--rule); }
  td { padding:11px 14px; border-bottom:1px solid var(--soft); vertical-align:top; font-size:13px; }
  tr:last-child td { border-bottom:0; }
  td.step { font-weight:600; white-space:nowrap; }
  td.files { color:var(--ink2); font-size:12px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:2px; font-size:11.5px; font-weight:600; border:1px solid; white-space:nowrap; }
  .p-done{color:var(--done);border-color:var(--done);background:var(--done-t);} .p-running{color:var(--run);border-color:var(--run);background:var(--run-t);} .p-idle{color:var(--ink3);border-color:var(--rule);background:var(--panel2);}
  tr.r-done td.step, tr.r-running td.step { color:var(--ink); }
  tr.r-idle td { color:var(--ink2); }
  pre { margin:0; padding:14px 16px; background:var(--panel2); border:1px solid var(--rule); border-radius:3px; overflow-x:auto; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; line-height:1.55; }
  .ok { color:var(--done); font-weight:600; } .warn { color:var(--run); font-weight:600; }
  .next { border:1px solid var(--rule); border-top:3px solid var(--run); border-radius:3px; background:var(--panel); padding:16px 18px; display:flex; flex-direction:column; gap:6px; }
  .next h2 { margin:0; font-size:17px; } .next p { margin:0; color:var(--ink2); font-size:13.5px; }
  footer { font-size:12px; color:var(--ink3); border-top:1px solid var(--rule); padding-top:12px; }
</style>
<div class="wrap">
  <header style="display:flex;flex-direction:column;gap:12px">
    <p class="eyebrow">PATCHBAY · 현재 진행</p>
    <h1>${counts.done}칸 완료 · ${counts.running}칸 진행 중 · ${counts.idle}칸 예정</h1>
    <p class="sub"><code>knowledge/patchbay/기획/실행.md</code>를 읽어 만든 화면이다. 표를 고치면 여기도 바뀐다 — 손으로 옮겨 적지 않는다.</p>
    <dl class="readout">
      <div><dt>완료</dt><dd>${counts.done} <span class="u">/ ${rows.length}칸</span></dd></div>
      <div><dt>진행 중</dt><dd>${counts.running}</dd></div>
      <div><dt>고정 자료 검증</dt><dd class="${verifyOk ? "ok" : "warn"}">${verifyOk ? "통과" : "확인 필요"}</dd></div>
      <div><dt>라벨 일치</dt><dd>${nodes.length - unmatched.length} <span class="u">/ ${nodes.length}</span></dd></div>
      <div><dt>만든 시각</dt><dd style="font-size:13px">${now}</dd></div>
    </dl>
  </header>

  <figure>
    <p class="eyebrow">실행 순서 — 화살표는 「먼저 끝나야 한다」</p>
    <div class="scroll">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="실행 순서 ${nodes.length}칸. 완료 ${counts.done}, 진행 중 ${counts.running}, 예정 ${counts.idle}.">
        <defs>
          <marker id="ah-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1 L7 4 L0 7 Z"/></marker>
          <marker id="ah-running" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1 L7 4 L0 7 Z"/></marker>
          <marker id="ah-idle" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1 L7 4 L0 7 Z"/></marker>
        </defs>
        ${traces}
        ${boxes}
      </svg>
    </div>
    <div class="legend">
      <span><i class="sw sw-done"></i> 완료</span>
      <span><i class="sw sw-running"></i> 진행 중</span>
      <span><i class="sw sw-idle"></i> 예정</span>
      ${unmatched.length ? `<span class="warn">라벨이 표와 안 맞는 노드: ${unmatched.map(esc).join(", ")} — 상태색이 안 붙는다</span>` : ""}
    </div>
  </figure>

  <section style="display:flex;flex-direction:column;gap:12px">
    <p class="eyebrow">칸마다 무엇을 하나</p>
    <table>
      <thead><tr><th>단계</th><th>상태</th><th>작업</th><th>파일</th></tr></thead>
      <tbody>
${rows.map((r) => {
  const ph = phaseOf(r.status);
  return `        <tr class="r-${ph}"><td class="step">${inline(r.step)}</td><td><span class="pill p-${ph}">${inline(r.status)}</span></td><td>${inline(r.work)}</td><td class="files">${inline(r.files)}</td></tr>`;
}).join("\n")}
      </tbody>
    </table>
  </section>

  <section style="display:flex;flex-direction:column;gap:12px">
    <p class="eyebrow">고정 자료 검증 — 이 화면을 만들 때 실제로 돌린 결과</p>
    <pre>${esc(verify.trim())}</pre>
  </section>

  ${next ? `<section class="next">
    <p class="eyebrow">다음 칸</p>
    <h2>${inline(next.step)}</h2>
    <p>${inline(next.work)}</p>
    <p style="color:var(--ink3)">${inline(next.files)}</p>
  </section>` : ""}

  <footer>
    다시 만들기 — <code>cd app/packages/core &amp;&amp; node ../../../knowledge/patchbay/절차/진행보기_20260929_v1.mjs</code><br>
    원본 <code>knowledge/patchbay/기획/실행.md</code> · 검증 <code>knowledge/patchbay/절차/고정자료-검증_20260929_v1.mjs</code> · 콘솔 <code>http://127.0.0.1:4317</code>
  </footer>
</div>
`;

fs.writeFileSync(OUT, html);
console.log(`${path.relative(ROOT, OUT)} — ${rows.length}칸 (완료 ${counts.done} · 진행 ${counts.running} · 예정 ${counts.idle})`);
if (unmatched.length) console.log(`  ⚠ 표와 라벨이 안 맞는 노드: ${unmatched.join(", ")}`);
console.log(`  고정 자료 검증: ${verifyOk ? "통과" : "확인 필요"}`);
