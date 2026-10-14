import type { Ir, IrEval } from "../types/ir.js";
import { runFailed, type RunRecord } from "./types.js";

/**
 * 5.4 -- 실패 실행 기록을 평가 사례 **초안**으로 바꾼다. 이것이 순환을 닫는다:
 * 없으면 5단계는 관찰이고 순환이 아니다 (기획서 §2).
 *
 * Three rules the shape enforces rather than documents:
 *
 * 1. **초안일 뿐이다.** This returns a value; writing it is the caller's job, and
 *    the only file a draft may reach is `ir.proposed.yaml`. The approved
 *    `overlay.ir` has exactly one write path (`ir adopt`, 명세 §2.3), so a
 *    failing run cannot edit the design behind a person's back.
 * 2. **요구사항 연결은 비워 둔다.** The runtime does not know requirements -- it
 *    knows a node failed. Guessing which requirement that voids would put a
 *    fabricated row in the traceability table, which is the one table §3.7 makes
 *    the original.
 * 3. **기대값을 지어내지 않는다.** 「무엇이 나와야 하는가」는 설계가 이미 적은
 *    문장이다. 같은 노드에 평가가 있으면 그 `expect` 를 **그대로** 옮기고, 없으면
 *    비워 두고 사람에게 넘긴다 -- 초안이 기대값을 새로 쓰면 그건 생성기가 요구사항을
 *    발명하는 것이다.
 */

export interface EvalDraft {
  id: string;
  node: string;
  /** Always deterministic: CI replays it through a fixed-response adapter, never a live model (명세 §8). */
  kind: "deterministic";
  input: string;
  /** Copied from the design's own eval on this node. Empty when there is none -- then `unfilled` names it. */
  expect: string;
  /** Which run, and why. A draft nobody can trace back is a draft nobody will approve. */
  basis: string;
  /**
   * 같은 실패(노드 · 실패 종류)의 평가가 초안에 이미 있다. 그때 `id` 는 초안에 있는 그 행의 id 이고,
   * `draftsAsIrEvals` 는 이 행을 다시 내보내지 않는다.
   */
  inDraft: boolean;
}

/** 요구사항 칸이 비어 있는 추적 표 행. 사람이 채운다. */
export interface RequirementLinkToFill {
  requirement: null;
  node: string;
  eval: string;
}

export interface EvalDraftResult {
  /** The run ids this draft came from. */
  from: string[];
  irVersion: number;
  draftEvals: EvalDraft[];
  requirementLinksToFill: RequirementLinkToFill[];
  /** Draft ids whose `expect` a person must write. */
  unfilled: string[];
  /** Records left out, and why -- a skipped failure must never be silent. */
  skipped: Array<{ runId: string; why: string }>;
}

/**
 * Drafts one evaluation per failing run.
 *
 * Deduplicated by (node, failure kind): twenty timeouts on the same node are one
 * evaluation case, not twenty. The run ids all stay in `basis` so nothing about
 * how often it happened is lost.
 */
export function draftEvalsFromRuns(
  ir: Ir,
  records: readonly RunRecord[],
  options: {
    /**
     * 지금의 `ir.proposed.yaml`. 주면 두 가지가 달라진다: 새 id 는 승인본과 초안 **둘 다**
     * 피해서 매기고(사람이 초안에 먼저 쓴 E7 과 겹치지 않게), 같은 실패의 평가가 초안에 이미
     * 있으면 새로 만들지 않고 그 행을 가리킨다(`inDraft`). 같은지는 id 가 아니라 (노드, 실패
     * 종류)로 본다 — id 는 누가 먼저 썼느냐에 따라 달라진다.
     */
    draft?: Ir;
  } = {},
): EvalDraftResult {
  const nodeIds = new Set(ir.nodes.map((node) => node.id));
  const expectByNode = new Map<string, string>();
  for (const entry of ir.evals) {
    if (!expectByNode.has(entry.node)) expectByNode.set(entry.node, entry.expect);
  }

  const from: string[] = [];
  const skipped: Array<{ runId: string; why: string }> = [];
  const groups = new Map<string, { node: string; runs: RunRecord[]; label: string }>();

  for (const record of records) {
    if (!runFailed(record)) continue;
    if (record.irVersion !== ir.version) {
      skipped.push({ runId: record.runId, why: `irVersion ${record.irVersion} — 이 설계(v${ir.version})와 대조할 수 없다` });
      continue;
    }
    const node = record.error?.nodeId ?? record.nodeId;
    if (node === null) {
      skipped.push({ runId: record.runId, why: "실패한 노드가 없다 — 어느 노드의 평가로 만들지 알 수 없다" });
      continue;
    }
    if (!nodeIds.has(node)) {
      skipped.push({ runId: record.runId, why: `노드 "${node}" 가 설계에 없다 — 대조 결과를 먼저 본다` });
      continue;
    }
    const label = failureLabel(record);
    const key = `${node}::${label}`;
    const group = groups.get(key);
    if (group) group.runs.push(record);
    else groups.set(key, { node, runs: [record], label });
    from.push(record.runId);
  }

  const draftEvals: EvalDraft[] = [];
  const requirementLinksToFill: RequirementLinkToFill[] = [];
  const unfilled: string[] = [];
  const draftRows = options.draft?.evals ?? [];
  const taken = new Set([...ir.evals, ...draftRows].map((entry) => entry.id));

  for (const group of groups.values()) {
    const existing = draftRows.find((entry) => isDraftOf(entry, group.node, group.label));
    const id = existing?.id ?? nextEvalId(taken);
    taken.add(id);
    const first = group.runs[0]!;
    const expect = expectByNode.get(group.node) ?? "";
    if (!expect) unfilled.push(id);
    draftEvals.push({
      id,
      node: group.node,
      kind: "deterministic",
      input: `${INPUT_PREFIX}${group.label} (${first.runId} 재현)`,
      expect,
      basis: group.runs.map((record) => basisLine(record)).join(" · "),
      inDraft: existing !== undefined,
    });
    requirementLinksToFill.push({ requirement: null, node: group.node, eval: id });
  }

  return { from, irVersion: ir.version, draftEvals, requirementLinksToFill, unfilled, skipped };
}

const INPUT_PREFIX = "고정 응답 어댑터: ";

/**
 * 이 초안 행이 (node, label) 실패에서 나온 것인가. `input` 은 이 파일이 쓴 모양
 * (`고정 응답 어댑터: <label> (<runId> 재현)`)이라 거기서 읽는다. 사람이 `input` 을 고쳐 썼으면
 * 다른 행으로 보고 새로 만든다 — 조용히 빠지는 것보다 겹쳐 보이는 쪽이 사람이 고칠 수 있다.
 */
function isDraftOf(entry: IrEval, node: string, label: string): boolean {
  return entry.node === node && entry.input.startsWith(`${INPUT_PREFIX}${label} (`);
}

/**
 * What to feed the fixed-response adapter. A timeout carries its own number --
 * replaying it at a different duration tests a different branch.
 */
function failureLabel(record: RunRecord): string {
  if (record.error?.kind === "timeout" || record.status === "timeout") {
    const ms = record.modelCalls.find((call) => call.status === "timeout")?.ms;
    return ms === undefined ? "타임아웃 초과" : `${ms}ms 초과`;
  }
  return record.status;
}

function basisLine(record: RunRecord): string {
  const parts = [record.runId];
  if (record.error) parts.push(`error.kind=${record.error.kind}`, `nodeId=${record.error.nodeId}`);
  else parts.push(`status=${record.status}`);
  return parts.join(" · ");
}

/** `E7` after `E1..E6`. Numeric so the order a person reads matches the order they were found. */
function nextEvalId(taken: ReadonlySet<string>): string {
  let highest = 0;
  for (const id of taken) {
    const match = /^E(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let next = highest + 1;
  while (taken.has(`E${next}`)) next += 1;
  return `E${next}`;
}

/** The drafts as `evals[]` rows, ready to merge into `ir.proposed.yaml`. */
export function draftsAsIrEvals(result: EvalDraftResult): IrEval[] {
  return result.draftEvals.filter((draft) => !draft.inDraft).map((draft) => ({
    id: draft.id,
    node: draft.node,
    kind: draft.kind,
    input: draft.input,
    expect: draft.expect,
  }));
}
