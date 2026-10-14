/** Client-safe Neo4j / knowledge-tab types and freeze values (spec 4.2 / P6). */

import type {
  DocumentHit,
  KnowledgeCounts,
  KnowledgeEdgeView,
  KnowledgeLabel,
  KnowledgeNodeView,
  ReplicaAudit,
  RetrieveHops,
} from "@patchbay/core";

/**
 * The graph's own shape lives in Core (`knowledge/contract.ts`) -- the kernel
 * builds and queries it, and 원칙 8 says the CLI, MCP and this console must see
 * one definition. Re-exported as types so the browser bundle carries none of
 * the kernel's file reading.
 */
export type {
  DocumentHit,
  KnowledgeCounts,
  KnowledgeEdgeView,
  KnowledgeLabel,
  KnowledgeNodeView,
  KnowledgeRelation,
  KnowledgeSnapshot,
  ReplicaAudit,
  RetrieveHops,
} from "@patchbay/core";

export const DEFAULT_NEO4J_URI = "bolt://127.0.0.1:7687";
export const DEFAULT_NEO4J_USER = "neo4j";
export const DEFAULT_NEO4J_PASSWORD = "patchbay";
export const NEO4J_PROBE_TIMEOUT_MS = 800;
export const KNOWLEDGE_HIT_LIMIT = 40;

export interface KnowledgeViewDisconnected {
  status: "disconnected";
  uri: string;
  alias: string | null;
}

export interface KnowledgeViewUnscanned {
  status: "unscanned";
  uri: string;
  alias: string;
  path: string;
}

export interface KnowledgeViewConnected {
  status: "connected";
  uri: string;
  alias: string;
  query: string;
  selected: KnowledgeNodeView | null;
  hits: KnowledgeNodeView[];
  neighbors: KnowledgeNodeView[];
  edges: KnowledgeEdgeView[];
  counts: KnowledgeCounts;
  /**
   * 3.5 -- whether anything in here is a fact the scan did not already have.
   * A replica that is only a copy of `inferred.json` is a warned state, not a
   * failed one: the project may simply not have adopted a design yet.
   */
  replica: ReplicaAudit;
  /** The design iteration the design rows came from. Null before 1단계. */
  irVersion: number | null;
  warning: string | null;
}

/** 4단계 문서 호출의 답. Computed by Core, so it answers with the sidecar down. */
export interface DocumentCallView {
  status: "ok";
  alias: string;
  anchor: string;
  anchorPath: string | null;
  query: string;
  maxHops: RetrieveHops;
  terms: string[];
  hits: DocumentHit[];
  matchedCount: number;
  withheld: number;
  candidates: string[];
  replica: ReplicaAudit;
  error: string | null;
}

export interface DocumentCallUnscanned {
  status: "unscanned";
  alias: string;
  path: string;
}

export type DocumentCallResponse = DocumentCallView | DocumentCallUnscanned;

export function isDocumentCallOk(body: DocumentCallResponse): body is DocumentCallView {
  return body.status === "ok";
}

/** 4.2 -- the hop radius the user can pick from. */
export const DOCUMENT_CALL_HOP_CHOICES = [1, 2] as const;

export type KnowledgeViewResponse =
  | KnowledgeViewDisconnected
  | KnowledgeViewUnscanned
  | KnowledgeViewConnected;

export function isKnowledgeViewConnected(body: KnowledgeViewResponse): body is KnowledgeViewConnected {
  return body.status === "connected";
}

/**
 * Impact radius + port debt. Computed by Core from inferred/overlay, so it
 * has no `uri` and no `disconnected` state -- it answers with the sidecar
 * down, and the same numbers reach a host model through MCP `get_impact`.
 */
export const IMPACT_HOP_CHOICES = [1, 2, 3] as const;

export interface ImpactPortView {
  port: string;
  path: string;
  name: string;
  label: KnowledgeLabel;
  via: string;
  kind: string;
}

export interface ImpactRingView {
  hop: number;
  count: number;
  ports: ImpactPortView[];
}

export interface ImpactViewOk {
  status: "ok";
  alias: string;
  origin: string | null;
  known: boolean;
  maxHops: number;
  total: number;
  rings: ImpactRingView[];
  debt: { orphans: number; hubs: Array<{ port: string; name: string; degree: number }> };
}

export interface ImpactViewUnscanned {
  status: "unscanned";
  alias: string;
  path: string;
}

export type ImpactViewResponse = ImpactViewOk | ImpactViewUnscanned;

export function isImpactViewOk(body: ImpactViewResponse): body is ImpactViewOk {
  return body.status === "ok";
}

export function resolveNeo4jUri(override?: string): string {
  const raw = override?.trim();
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_NEO4J_URI;
}

export function resolveNeo4jUser(override?: string): string {
  const raw = override?.trim();
  return raw ? raw : DEFAULT_NEO4J_USER;
}

export function resolveNeo4jPassword(override?: string): string {
  return override === undefined || override === "" ? DEFAULT_NEO4J_PASSWORD : override;
}

