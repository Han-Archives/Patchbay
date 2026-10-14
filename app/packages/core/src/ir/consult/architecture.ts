/**
 * 아키텍처 그림 — PRD 옆에 그리는 한 장 (사용자 요청 2026-10-07).
 *
 * PRD와 **같은 초안**에서 결정적으로 만든다. 블록마다 PRD 절 번호를 단다 — 그림에서 이상한 곳을 보면
 * 그 절로 가서 「고쳐 주세요」를 누르면 된다. 이름은 PRD가 쓰는 말(초안의 label · what · role)을 그대로 쓴다.
 * 초안은 미완성이 정상이라 `unknown` 위에서 돈다. 없는 것은 그리지 않고 지어내지 않는다.
 *
 * 줄(lane): 사람 · 화면 → 들어오는 것 → 단계 → 모델 · 도구 → 나가는 것 · 저장소
 */

export const ARCH_LANES = ["사람 · 화면", "들어오는 것", "단계", "모델 · 도구", "나가는 것"] as const;
export type ArchLane = (typeof ARCH_LANES)[number];

export type ArchBlockKind = "person" | "screen" | "input" | "doc" | "step" | "model" | "tool" | "output" | "store" | "secret";

export interface ArchBlock {
  id: string;
  label: string;
  /** 한 줄 설명 — 마우스를 올리면 보인다. */
  detail?: string;
  kind: ArchBlockKind;
  lane: ArchLane;
  /** PRD 절 번호 (1~11). */
  section: number;
}

export interface ArchLink {
  from: string;
  to: string;
  label?: string;
  /** 설계에 적힌 연결이 아니라 해석으로 이은 것 (예: 읽는 폴더 → 첫 단계). */
  dashed?: boolean;
}

export interface Architecture {
  blocks: ArchBlock[];
  links: ArchLink[];
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const short = (text: string, n = 26): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** 코드 이름 대신 PRD 검토에 쓰는 말로 (사용자 요청 2026-10-07 — 「적절한 워드로」). 코드 이름은 detail(마우스 올림)에 남긴다. */
const ENTRY_WORD: Record<string, string> = { chat: "채팅", cli: "터미널", web: "웹 화면", console: "Patchbay 콘솔", api: "API", schedule: "예약 실행" };
const PROVIDER_WORD: Record<string, string> = { host: "호스트 모델", anthropic: "Claude", openai: "OpenAI", google: "Gemini", xai: "Grok", local: "로컬 모델" };
const EMIT_WORD: Record<string, string> = { model: "모델로 보냄", file: "파일로 씀", external: "밖으로 보냄", db: "DB에 쌓음" };

export function buildArchitecture(draft: unknown): Architecture {
  const ir = obj(draft);
  const blocks: ArchBlock[] = [];
  const links: ArchLink[] = [];
  const add = (block: ArchBlock) => {
    if (!blocks.some((b) => b.id === block.id)) blocks.push(block);
  };

  // 사람 · 화면 (PRD 2)
  list(ir.stakeholders).forEach((s, i) =>
    add({ id: `person:${str(s.id) || i}`, label: short(str(s.role) || "쓰는 사람"), detail: str(s.need), kind: "person", lane: "사람 · 화면", section: 2 }),
  );
  const ui = obj(ir.interface);
  const entries = strs(ui.entry);
  if (entries.length || str(ui.output)) {
    add({ id: "screen", label: entries.length ? entries.map((e) => ENTRY_WORD[e] ?? e).join(" · ") : "화면", detail: str(ui.output), kind: "screen", lane: "사람 · 화면", section: 2 });
  }

  // 단계 (PRD 6)
  const nodes = list(ir.nodes);
  const nodeIds = new Set(nodes.map((n) => str(n.id)).filter(Boolean));
  for (const n of nodes) {
    const id = str(n.id);
    if (!id) continue;
    add({ id: `step:${id}`, label: short(str(n.label) || id), detail: strs(n.writes).length ? `채운다: ${strs(n.writes).join(" · ")}` : undefined, kind: "step", lane: "단계", section: 6 });
  }
  const edges = list(ir.edges);
  const firstSteps = edges.filter((e) => str(e.from) === "__start__" && nodeIds.has(str(e.to))).map((e) => `step:${str(e.to)}`);
  const lastSteps = edges.filter((e) => str(e.to) === "__end__" && nodeIds.has(str(e.from))).map((e) => `step:${str(e.from)}`);
  const entry = firstSteps[0] ?? (nodes[0] ? `step:${str(nodes[0].id)}` : null);
  const exit = lastSteps[0] ?? (nodes.length ? `step:${str(nodes.at(-1)!.id)}` : null);
  for (const e of edges) {
    const from = str(e.from);
    const to = str(e.to);
    if (nodeIds.has(from) && nodeIds.has(to)) links.push({ from: `step:${from}`, to: `step:${to}`, ...(str(e.when) ? { label: short(str(e.when), 18) } : {}) });
  }

  // 사람 · 화면 → 첫 단계, 마지막 단계 → 화면
  const screenOrPerson = blocks.find((b) => b.kind === "screen")?.id ?? blocks.find((b) => b.kind === "person")?.id;
  if (screenOrPerson && entry) links.push({ from: screenOrPerson, to: entry, label: "넣는다" });
  if (screenOrPerson && exit && exit !== entry) links.push({ from: exit, to: screenOrPerson, label: "보인다", dashed: true });

  // 들어오는 것 — 읽는 폴더 (PRD 8) · 참고 문서 (PRD 9)
  list(ir.reads).forEach((r, i) => {
    const id = `input:${i}`;
    add({ id, label: short(str(r.why) || `폴더 ${str(r.path)}`), detail: `${str(r.path)} · 민감도 ${String(r.level ?? "")}`, kind: "input", lane: "들어오는 것", section: 8 });
    if (entry) links.push({ from: id, to: entry, dashed: true });
  });
  list(ir.documents).forEach((d, i) => {
    const id = `doc:${str(d.id) || i}`;
    add({ id, label: short(str(d.when) ? `${str(d.when)} 볼 문서` : str(d.path) || "문서"), detail: str(d.path), kind: "doc", lane: "들어오는 것", section: 9 });
    const node = str(d.node);
    if (nodeIds.has(node)) links.push({ from: id, to: `step:${node}` });
  });

  // 모델 · 도구 (PRD 7 · 8)
  for (const m of list(ir.models)) {
    const id = `model:${str(m.id)}`;
    if (!str(m.id)) continue;
    add({ id, label: short(PROVIDER_WORD[str(m.provider)] ?? (str(m.provider) || "모델")), detail: str(m.id), kind: "model", lane: "모델 · 도구", section: 7 });
    for (const user of strs(m.usedBy)) if (nodeIds.has(user)) links.push({ from: `step:${user}`, to: id, label: "부른다" });
  }
  for (const t of list(ir.tools)) {
    const tid = str(t.id);
    if (!tid) continue;
    const id = `tool:${tid}`;
    add({ id, label: short(str(t.what) || tid), detail: str(t.via) === "mcp" ? `${tid} · MCP ${str(t.server)}` : tid, kind: "tool", lane: "모델 · 도구", section: 8 });
    for (const n of nodes) if (strs(n.tools).includes(tid)) links.push({ from: `step:${str(n.id)}`, to: id, label: "쓴다" });
  }

  // 나가는 것 · 저장소 (PRD 8)
  list(ir.emits).forEach((e, i) => {
    const to = str(e.to);
    const id = `out:${i}`;
    add({
      id,
      label: short(to === "db" ? `DB: ${str(e.where) || str(e.what)}` : str(e.what) || to),
      detail: `${EMIT_WORD[to] ?? to}${str(e.reason) ? ` — ${str(e.reason)}` : ""}`,
      kind: to === "db" ? "store" : "output",
      lane: "나가는 것",
      section: 8,
    });
    if (exit) links.push({ from: exit, to: id, label: to === "model" ? "모델로" : to === "external" ? "밖으로" : to === "db" ? "쌓는다" : "쓴다" });
  });
  list(ir.credentials).forEach((c, i) => {
    const id = `secret:${str(c.id) || i}`;
    add({ id, label: short(`열쇠: ${str(c.what)}`), detail: `둔 곳: ${str(c.storedAt)}`, kind: "secret", lane: "나가는 것", section: 8 });
    // 밖으로 나가는 도구 · 모델이 이 열쇠를 쓴다 — 설계에 짝이 적혀 있지 않아 점선으로 잇는다.
    const outbound = blocks.filter((b) => (b.kind === "tool" || b.kind === "model") && b.lane === "모델 · 도구");
    for (const target of outbound.slice(0, 2)) links.push({ from: id, to: target.id, dashed: true });
  });

  const ids = new Set(blocks.map((b) => b.id));
  return { blocks, links: links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to) };
}
