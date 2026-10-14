import { RESERVED_NODE_IDS, type Ir } from "../types/ir.js";
import { RUN_STATUSES, type RunRecord, type RunStatus } from "./types.js";

/**
 * 5.3 -- 설계와 실물을 대조한다.
 *
 * Not the same comparison as `apps/flow/src/compareFlow.ts`: that one overlays
 * the *planning* process (`overlay.process.steps`) on the LangGraph graph for
 * the 흐름 tab. This one holds the **design** (`overlay.ir`) against **run
 * records**, and its findings are about declarations -- a model nobody declared,
 * a capability the design never delegated. Merging the two would give one
 * function two questions and no way to name which answer failed.
 *
 * Read-only and decision-free: it reports, it does not edit the IR. Turning a
 * failure into an evaluation case is `draftEvals.ts`, and that writes a draft.
 */

/** The three lanes the 흐름 tab already uses, for the same reason: a detour has to stay visible. */
export type RunLane = "plan" | "actual" | "both";

export const RUN_FINDING_KINDS = [
  "node-not-in-design",
  "model-not-declared",
  "model-node-not-declared",
  "tool-not-declared",
  "cap-not-declared",
  "document-not-declared",
  "document-node-mismatch",
  "timeout-before-limit",
  "node-never-ran",
] as const;
export type RunFindingKind = (typeof RUN_FINDING_KINDS)[number];

export interface RunFinding {
  kind: RunFindingKind;
  /** Which run showed it. Null for a finding about the design itself. */
  runId: string | null;
  nodeId: string | null;
  /** One line, in the words a person reads. */
  detail: string;
}

export interface RunNodeLane {
  id: string;
  lane: RunLane;
  /** How many compared runs touched this node. */
  runs: number;
}

export interface RunCompareResult {
  irVersion: number;
  compared: number;
  /** Records the design cannot be held against. `irVersion` is what joins them (§5.4). */
  skipped: Array<{ runId: string; irVersion: number }>;
  byStatus: Record<RunStatus, number>;
  nodes: RunNodeLane[];
  findings: RunFinding[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** Sum of the records that reported a cost. Null when none did. */
    costUsd: number | null;
    /** How many compared records left `costUsd` out -- a sum over a subset must say so. */
    costMissing: number;
  };
}

const RESERVED = new Set<string>(RESERVED_NODE_IDS);

export function compareRunsToDesign(ir: Ir, records: readonly RunRecord[]): RunCompareResult {
  const designNodes = new Set(ir.nodes.map((node) => node.id));
  const modelById = new Map(ir.models.map((model) => [model.id, model]));
  const toolById = new Map(ir.tools.map((tool) => [tool.id, tool]));
  const docsByPath = new Map(ir.documents.map((doc) => [doc.path, doc]));

  const findings: RunFinding[] = [];
  const touched = new Map<string, number>();
  const runtimeOnly = new Set<string>();
  const byStatus = Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])) as Record<RunStatus, number>;
  const skipped: Array<{ runId: string; irVersion: number }> = [];

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let costSeen = 0;
  let costMissing = 0;
  let compared = 0;

  const note = (node: string | null, runId: string | null, kind: RunFindingKind, detail: string) => {
    findings.push({ kind, runId, nodeId: node, detail });
  };

  /** Counts a node as having run, and flags it when the design does not have it. */
  const seeNode = (nodeId: string | null, runId: string, where: string) => {
    if (nodeId === null || RESERVED.has(nodeId)) return;
    touched.set(nodeId, (touched.get(nodeId) ?? 0) + 1);
    if (designNodes.has(nodeId)) return;
    if (!runtimeOnly.has(nodeId)) runtimeOnly.add(nodeId);
    note(nodeId, runId, "node-not-in-design", `${where}가 설계에 없는 노드 "${nodeId}" 를 가리킨다.`);
  };

  for (const record of records) {
    if (record.irVersion !== ir.version) {
      // 대조하지 않고 뺀다. 다른 설계의 기록을 이 설계에 대고 세면 숫자가 거짓이 된다.
      skipped.push({ runId: record.runId, irVersion: record.irVersion });
      continue;
    }
    compared += 1;
    byStatus[record.status] += 1;

    inputTokens += record.usage.inputTokens;
    outputTokens += record.usage.outputTokens;
    if (record.usage.costUsd === undefined) costMissing += 1;
    else {
      costUsd += record.usage.costUsd;
      costSeen += 1;
    }

    seeNode(record.nodeId, record.runId, "기록의 nodeId");
    if (record.error) seeNode(record.error.nodeId, record.runId, "error.nodeId");

    for (const call of record.modelCalls) {
      seeNode(call.nodeId, record.runId, "모델 호출");
      const declared = modelById.get(call.model);
      if (!declared) {
        note(
          call.nodeId,
          record.runId,
          "model-not-declared",
          `선언되지 않은 모델 "${call.model}" 을 불렀다 (ir.models[] 에 없다).`,
        );
        continue;
      }
      if (!declared.usedBy.includes(call.nodeId)) {
        note(
          call.nodeId,
          record.runId,
          "model-node-not-declared",
          `"${call.model}" 을 "${call.nodeId}" 에서 불렀는데 usedBy 에 그 노드가 없다.`,
        );
      }
      /**
       * A call that reports `timeout` **below** the declared limit means the cut
       * came from somewhere else -- a gateway, a client default, another wrapper.
       * Reported because the design's timeout branch was written for the declared
       * number, and a shorter cut fires it on a different condition.
       */
      if (call.status === "timeout" && call.ms < declared.timeoutMs) {
        note(
          call.nodeId,
          record.runId,
          "timeout-before-limit",
          `"${call.model}" 이 ${call.ms}ms 에 끊겼는데 선언한 한도는 ${declared.timeoutMs}ms 다 — 다른 데서 끊었다.`,
        );
      }
    }

    for (const call of record.toolCalls) {
      seeNode(call.nodeId, record.runId, "툴 호출");
      const declared = toolById.get(call.tool);
      if (!declared) {
        note(
          call.nodeId,
          record.runId,
          "tool-not-declared",
          `선언되지 않은 툴 "${call.tool}" 을 불렀다 (ir.tools[] 에 없다).`,
        );
        continue;
      }
      // §4.3 ③ -- 권한은 여기서 대조한다. 런타임을 막는 건 Patchbay의 일이 아니다 (원칙 9).
      for (const cap of call.caps) {
        if (declared.caps.includes(cap as (typeof declared.caps)[number])) continue;
        note(
          call.nodeId,
          record.runId,
          "cap-not-declared",
          `"${call.tool}" 이 선언되지 않은 권한 "${cap}" 으로 돌았다 — 설계는 ${
            declared.caps.length > 0 ? declared.caps.join(" · ") : "없음"
          } 만 위임했다.`,
        );
      }
    }

    for (const call of record.documentCalls) {
      seeNode(call.nodeId, record.runId, "문서 호출");
      const declared = docsByPath.get(call.path);
      if (!declared) {
        note(
          call.nodeId,
          record.runId,
          "document-not-declared",
          `선언되지 않은 문서 "${call.path}" 를 읽었다 (ir.documents[] 에 없다).`,
        );
        continue;
      }
      if (declared.node !== call.nodeId) {
        note(
          call.nodeId,
          record.runId,
          "document-node-mismatch",
          `"${call.path}" 는 설계에서 "${declared.node}" 의 문서인데 "${call.nodeId}" 가 읽었다.`,
        );
      }
    }
  }

  const nodes: RunNodeLane[] = [];
  for (const node of ir.nodes) {
    const runs = touched.get(node.id) ?? 0;
    nodes.push({ id: node.id, lane: runs > 0 ? "both" : "plan", runs });
    if (runs === 0 && compared > 0) {
      note(node.id, null, "node-never-ran", `설계에 있는 노드 "${node.id}" 가 대조한 ${compared}건에서 한 번도 돌지 않았다.`);
    }
  }
  for (const id of [...runtimeOnly].sort()) {
    nodes.push({ id, lane: "actual", runs: touched.get(id) ?? 0 });
  }

  return {
    irVersion: ir.version,
    compared,
    skipped,
    byStatus,
    nodes,
    findings,
    usage: {
      inputTokens,
      outputTokens,
      costUsd: costSeen > 0 ? Number(costUsd.toFixed(6)) : null,
      costMissing,
    },
  };
}
