import { z } from "zod";
import { SENSITIVITY_LEVELS, type SensitivityLevel } from "../sensitivity/sensitivity.js";

/**
 * `overlay.yaml`'s `ir` section -- the design of one agent graph
 * (명세 20260929a §3). Human + host-model owned: a scan never writes it,
 * and the only write path is `ir adopt` (§2.3).
 *
 * This file fixes *shape*; the design rules live in `../ir/checks.ts`.
 * The split is deliberate: a schema that also enforced "Unwanted >= 1" or
 * "every node reaches __end__" would reject a draft the moment a person
 * started writing it, and the gate列 would have no way to report which
 * cell to go back to. So the schema accepts empty arrays and the DRC
 * decides whether the design passes.
 */

/**
 * The IR *file format* version. Not the project's design iteration (`version`).
 * 2 (2026-10-05) adds the ontology layer — `concepts` · `relations` · `rules` —
 * under every other cell. A version-1 file still reads: it simply has an empty
 * ontology, which the 0.0 checks then report as the cell to fill.
 */
export const IR_SCHEMA_VERSION = 3;
/** The oldest file format this Patchbay reads without a migration step. */
export const IR_MIN_SCHEMA_VERSION = 1;

/** 0.0 — what kind of thing a concept is in the agent's world. */
export const CONCEPT_KINDS = ["input", "output", "enum", "resource", "internal"] as const;
export type ConceptKind = (typeof CONCEPT_KINDS)[number];

/** 0.0 — how many of `to` one `from` has. */
export const CARDINALITIES = ["one", "optional", "many"] as const;
export type Cardinality = (typeof CARDINALITIES)[number];

/** 0.0 — what a relation means: owns a value · points at a resource · is produced from. */
export const RELATION_KINDS = ["has", "points", "derives"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** 0.0 — where a rule came from. Derived rules are rebuilt from the layer; `manual` ones are a person's. */
export const RULE_SOURCES = ["relation", "enum", "resource", "manual"] as const;

/**
 * Actor capabilities -- a set, not an ordered ladder (기획서 원칙 10).
 * Never named `level`: that token means content sensitivity and nothing else.
 */
export const CAP_IDS = ["cap:read", "cap:draft", "cap:pr", "cap:external"] as const;
export type CapId = (typeof CAP_IDS)[number];
export const capIdSchema = z.enum(CAP_IDS);

/** Fixed so the generator can emit code for it. A free-form Korean string cannot be compiled. */
export const IR_REDUCERS = ["append", "lastWrite", "custom"] as const;
export type IrReducer = (typeof IR_REDUCERS)[number];

/** EARS (Mavin, RE'09). `unwanted` is the one that goes missing in LLM agents. */
export const EARS_PATTERNS = ["ubiquitous", "event", "state", "unwanted", "optional"] as const;
export type EarsPattern = (typeof EARS_PATTERNS)[number];

/** Where an emission goes. `external` is what forces `cap:external`. */
export const EMIT_TARGETS = ["model", "file", "external", "db"] as const;
export type EmitTarget = (typeof EMIT_TARGETS)[number];

/** Code-scored vs model-scored. CI runs the first every time; the second needs a fixed-response adapter. */
export const EVAL_KINDS = ["deterministic", "model"] as const;
export type EvalKind = (typeof EVAL_KINDS)[number];

/** LangGraph's own terminals. They are edge endpoints, never entries in `nodes[]`. */
export const RESERVED_NODE_IDS = ["__start__", "__end__"] as const;

export const DEFAULT_MODEL_TIMEOUT_MS = 20_000;

/** Content sensitivity `0..4`. The same scale `classifyPath` writes into `inferred.portLevels`. */
export const sensitivityLevelSchema = z.union(
  SENSITIVITY_LEVELS.map((value) => z.literal(value)) as [
    z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<4>,
  ],
);

/**
 * 0.0 — one thing the agent deals with. The bottom layer: every other cell
 * picks its words from here (사용자 결정 2026-10-05 — 온톨로지를 IR의 첫 층으로).
 */
export const irConceptSchema = z.object({
  /** Code name — becomes a State field. */
  id: z.string().min(1),
  /** What a person calls it. */
  label: z.string(),
  kind: z.enum(CONCEPT_KINDS),
  /** For `enum`: the closed set of values. */
  values: z.array(z.string()).default([]),
  note: z.string().optional(),
});
export type IrConcept = z.infer<typeof irConceptSchema>;

export const irRelationSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(RELATION_KINDS),
  cardinality: z.enum(CARDINALITIES),
});
export type IrRelation = z.infer<typeof irRelationSchema>;

/** 0.0 — something that is always true in that world. 1.7 turns these into requirements. */
export const irRuleSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  source: z.enum(RULE_SOURCES).default("manual"),
});
export type IrRule = z.infer<typeof irRuleSchema>;

/**
 * 0.0 — 이 설계가 기대는 자료 (SRS의 References · Volere의 Relevant facts).
 * 링크 · 파일 · 이미지. 파일과 이미지는 `~/.patchbay/projects/<alias>/refs/` 에 산다.
 */
export const REFERENCE_KINDS = ["link", "file", "image"] as const;
export const irReferenceSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  kind: z.enum(REFERENCE_KINDS),
  /** 링크면 URL, 파일 · 이미지면 refs/ 안의 파일 이름. */
  uri: z.string(),
  note: z.string().optional(),
});
export type IrReference = z.infer<typeof irReferenceSchema>;

/** 1.1 — 누가 쓰고 무엇이 필요한가 (29148 사용자 특성 · Volere 이해관계자). */
export const irStakeholderSchema = z.object({
  id: z.string().min(1),
  role: z.string(),
  need: z.string(),
});
export type IrStakeholder = z.infer<typeof irStakeholderSchema>;

/** 1.1 — 성공 지표 (PRD success metrics). `target` 이 적합 기준이다 — 잴 수 없으면 지표가 아니다. */
export const irMetricSchema = z.object({
  id: z.string().min(1),
  what: z.string(),
  target: z.string(),
});
export type IrMetric = z.infer<typeof irMetricSchema>;

/**
 * 0.0 — 역량 질문 (Noy & McGuinness, Ontology Development 101). 온톨로지가 답할 수 있어야 하는 질문이고,
 * `from → to` 관계가 0층에 있어야 답할 수 있다 (DRC).
 */
export const irCompetencyQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  from: z.string(),
  to: z.string(),
});
export type IrCompetencyQuestion = z.infer<typeof irCompetencyQuestionSchema>;

/** 1.1 — 검토한 다른 방법과 고르지 않은 이유 (Google 설계 문서 · ADR). */
export const irAlternativeSchema = z.object({
  what: z.string(),
  whyNot: z.string(),
});

/** 1.1 — 틀렸을 때 피해의 크기 (NIST AI RMF MAP · EU AI Act 위험 등급). */
export const RISK_LEVELS = ["low", "medium", "high"] as const;
/** 1.2 — 자율 수준: 제안만 · 사람이 확인한 뒤 · 하고 나서 알림 · 완전 자동 (Microsoft · OpenAI 에이전트 가이드). */
export const AUTONOMY_LEVELS = ["suggest", "approve", "notify", "full"] as const;
/** 1.4 — 기억 범위: 없음 · 한 대화 안 · 오래 (LangGraph 단기 · 장기 기억). */
export const MEMORY_SCOPES = ["none", "thread", "long"] as const;

/** 비어 있어도 되는 목록 — 초안에 키만 있고 값이 없으면(null) 빈 목록으로 읽는다. */
const optionalList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (v === null ? undefined : v), z.array(item).default([]));

/** MoSCoW. 「이번엔 안 함(won't)」은 요구사항이 아니라 `nonGoals` 로 간다. */
export const PRIORITIES = ["must", "should", "could"] as const;
/** 기능 · 품질(ISO 25010) · 제약. */
export const REQUIREMENT_KINDS = ["functional", "quality", "constraint"] as const;

/** 1.0 AJR -- why an agent at all. */
/** 3판 (명세 20261006a §3.9) — 1.2 아래. 그래프가 도는 곳과 쓰는 언어. */
export const ENV_LOCATIONS = ["local", "remote"] as const;
/** 2 구현 생성기가 내는 언어. 다른 값은 파싱은 되고 `1.2/env-language` 가 막는다 — enum이면 파싱 오류로 떨어져 이유를 못 말한다. */
export const SCAFFOLD_LANGUAGES = ["typescript"] as const;

export const irEnvironmentSchema = z.object({
  language: z.string().default("typescript"),
  runtime: z.string().optional(),
  workdir: z.string().optional(),
  location: z.enum(ENV_LOCATIONS).default("local"),
  remote: z
    .object({
      host: z.string(),
      via: z.literal("ssh").default("ssh"),
      /** 콘솔 쪽 로컬 주소 — 콘솔의 LangGraph 주소는 하나라 원격 그래프는 SSH 터널로 붙는다. */
      tunnel: z.string(),
      note: z.string().optional(),
    })
    .optional(),
  hardware: z.string().optional(),
  libraries: z.array(z.string()).default([]),
});
export type IrEnvironment = z.infer<typeof irEnvironmentSchema>;

/** 3판 — 1.7 아래. 사용 화면은 요구사항이다 (Volere look and feel). */
export const INTERFACE_ENTRIES = ["chat", "cli", "web", "console", "api", "schedule"] as const;
export const irInterfaceSchema = z.object({
  entry: z.array(z.enum(INTERFACE_ENTRIES)).default([]),
  output: z.string(),
  review: z.string().optional(),
});
export type IrInterface = z.infer<typeof irInterfaceSchema>;

/** 3판 — 1.3 아래. 비밀의 값이 아니라 **어디 있는지**만 든다. */
export const CREDENTIAL_STORES = ["env", "keychain", "host", "file"] as const;
export const irCredentialSchema = z.object({
  id: z.string().min(1),
  what: z.string(),
  storedAt: z.enum(CREDENTIAL_STORES),
  note: z.string().optional(),
});
export type IrCredential = z.infer<typeof irCredentialSchema>;

export const irWhySchema = z.object({
  alternative: z.string(),
  modelNeed: z.string(),
  verdict: z.string(),
  /**
   * Whether the verdict demands a model call. A boolean rather than something
   * derived from `verdict`: the trial DRC grepped that sentence for
   * /모델이 한다|모델만|LLM/, so rewording the conclusion silently flipped the
   * check. A judgment is never guessed from prose.
   */
  needsModel: z.boolean(),
  note: z.string().optional(),
});
export type IrWhy = z.infer<typeof irWhySchema>;

/** 1.2 -- one delegated capability and how to take it back. */
export const irCapSchema = z.object({
  id: capIdSchema,
  scope: z.string(),
  undo: z.string(),
  humanApproval: z.boolean(),
});
export type IrCap = z.infer<typeof irCapSchema>;

/** A tool carries `caps`, never a `level`: tools are actors, grades belong to content. */
export const TOOL_VIA = ["code", "mcp"] as const;

export const irToolSchema = z.object({
  id: z.string().min(1),
  caps: z.array(capIdSchema).default([]),
  what: z.string(),
  irreversible: z.boolean().default(false),
  /** 3판 — 코드 안의 함수인가, MCP 서버의 도구인가. 생성기는 MCP 도구를 자리와 주석으로만 만든다. */
  via: z.enum(TOOL_VIA).optional(),
  /** `via: mcp` 일 때 — MCP 서버 이름. */
  server: z.string().optional(),
});
export type IrTool = z.infer<typeof irToolSchema>;

/**
 * A model call. A separate axis from tools -- a node can call a model with no
 * tools at all, and the trial DRC's "needs a model => needs a tool" was a bad
 * coupling (구현준비 20260928a §1의 2번).
 */
export const irModelSchema = z.object({
  id: z.string().min(1),
  provider: z.string(),
  caps: z.array(capIdSchema).default([]),
  /** Which nodes call it. Required: the generator and the M6 run comparison both attach per node. */
  usedBy: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(DEFAULT_MODEL_TIMEOUT_MS),
  fallback: z.string().optional(),
});
export type IrModel = z.infer<typeof irModelSchema>;

/** 1.3 -- what is read, and how secret it is. */
export const irReadSchema = z.object({
  path: z.string().min(1),
  level: sensitivityLevelSchema,
  why: z.string().optional(),
});
export type IrRead = z.infer<typeof irReadSchema>;

/** 1.3 -- what leaves, where to, and on whose authority. */
export const irEmitSchema = z.object({
  what: z.string(),
  level: sensitivityLevelSchema,
  to: z.enum(EMIT_TARGETS),
  reason: z.string(),
  /** 3판 — `to: db` 일 때 어느 저장소 · 테이블인가. Patchbay 자신의 Neo4j는 여기 적지 않는다. */
  where: z.string().optional(),
});
export type IrEmit = z.infer<typeof irEmitSchema>;

/** 1.4 -- the netlist. Fixed before nodes exist, like a harness. */
export const irStateFieldSchema = z.object({
  field: z.string().min(1),
  type: z.string().min(1),
  reducer: z.enum(IR_REDUCERS),
  reducerRef: z.string().optional(),
  /** A code literal as a string (`"[]"`, `'""'`). An empty string is a value, not a missing field. */
  default: z.string(),
  /** 0.0 concept this field carries, when it carries one. */
  concept: z.string().optional(),
});
export type IrStateField = z.infer<typeof irStateFieldSchema>;

/** 1.5 -- one node and everything it touches. */
export const irNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  reads: z.array(z.string()).default([]),
  writes: z.array(z.string()).default([]),
  models: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  documents: z.array(z.string()).default([]),
});
export type IrNode = z.infer<typeof irNodeSchema>;

/**
 * 1.5 -- one edge. `when` carries the branch condition, which is why edges are
 * objects and not `[from, to]` tuples: a tuple has nowhere to put it.
 */
export const irEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  when: z.string().optional(),
});
export type IrEdge = z.infer<typeof irEdgeSchema>;

/**
 * 1.6 -- one line per dependency, not a map keyed by branch. A map makes the
 * key a per-project vocabulary, and then the check has to know the project.
 */
export const irDocDepSchema = z.object({
  id: z.string().min(1),
  node: z.string().min(1),
  path: z.string().min(1),
  level: sensitivityLevelSchema,
  when: z.string(),
  via: z.string().optional(),
});
export type IrDocDep = z.infer<typeof irDocDepSchema>;

/** 1.7 -- an EARS sentence. */
export const irRequirementSchema = z.object({
  id: z.string().min(1),
  pattern: z.enum(EARS_PATTERNS),
  text: z.string(),
  note: z.string().optional(),
  /** MoSCoW. 비면 must 로 읽는다. */
  priority: z.enum(PRIORITIES).optional(),
  kind: z.enum(REQUIREMENT_KINDS).optional(),
  /** Volere 적합 기준 — 이 요구사항이 지켜졌는지 재는 기준. 품질 요구사항에는 꼭 있어야 한다 (DRC). */
  fit: z.string().optional(),
  /** 화면에 보이는 짧은 한 줄 (25자 안쪽, 「시스템은」 없이 — 사용자 요청 2026-10-07). `text` 는 EARS 원문으로 남는다. */
  summary: z.string().optional(),
  /** 개요+초점 편집기. 기존 text는 그대로 보존한다. */
  group: z.string().optional(),
  goal: z.string().optional(),
  condition: z.string().optional(),
  response: z.string().optional(),
  exceptions: z.array(z.string()).optional(),
  acceptance: z.string().optional(),
  openQuestions: z.array(z.string()).optional(),
  changeReason: z.string().optional(),
  sourceRef: z.object({
    kind: z.enum(["consult", "room"]),
    id: z.string().min(1).refine(id => !/[\\/]/.test(id) && id !== "." && id !== ".."),
    turn: z.number().int().nonnegative().optional(),
  }).optional(),
});
export type IrRequirement = z.infer<typeof irRequirementSchema>;

/** 1.8 -- one evaluation. `scoring` is required for model-scored ones (DRC, not schema). */
export const irEvalSchema = z.object({
  id: z.string().min(1),
  node: z.string().min(1),
  kind: z.enum(EVAL_KINDS),
  input: z.string(),
  expect: z.string(),
  scoring: z.string().optional(),
});
export type IrEval = z.infer<typeof irEvalSchema>;

/**
 * 1.8 -- the traceability row: requirement × node × evaluation. This array is
 * the source of the RTM, not `evals[].covers`; invalidation (§7.3) reads it to
 * answer "what did editing the State just void?".
 *
 * Never called `trace`: that word is taken by runtime run records (§5.1).
 */
export const irRequirementLinkSchema = z.object({
  requirement: z.string().min(1),
  node: z.string().min(1),
  eval: z.string().min(1),
});
export type IrRequirementLink = z.infer<typeof irRequirementLinkSchema>;

export const irSchema = z.object({
  schemaVersion: z.number().int(),
  /** The project's design iteration. v(n) vs v(n+1) compare against this. */
  version: z.number().int().positive(),
  project: z.string().min(1),
  graph: z.string().default(""),
  // 0.0 — the ontology. Empty in a version-1 file.
  concepts: z.array(irConceptSchema).default([]),
  relations: z.array(irRelationSchema).default([]),
  rules: z.array(irRuleSchema).default([]),
  references: optionalList(irReferenceSchema),
  competencyQuestions: optionalList(irCompetencyQuestionSchema),
  why: irWhySchema,
  goal: z.string(),
  /** At least one judgeable completion condition -- the one emptiness the schema itself refuses. */
  done: z.array(z.string()).min(1),
  // 1.1 — 요구사항 명세 관례에서 가져온 칸들 (사용자 요청 2026-10-05).
  stakeholders: optionalList(irStakeholderSchema),
  metrics: optionalList(irMetricSchema),
  /** 하지 않는 것 — 범위 밖. 에이전트는 빠진 것에서 범위를 추론하지 못한다. */
  nonGoals: optionalList(z.string()),
  constraints: optionalList(z.string()),
  assumptions: optionalList(z.string()),
  /** 「언제 · 무엇을 원하고 · 그래서 무엇을」(JTBD job story). */
  jobStory: z.string().optional(),
  alternatives: optionalList(irAlternativeSchema),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  autonomy: z.enum(AUTONOMY_LEVELS).optional(),
  memory: z.enum(MEMORY_SCOPES).optional(),
  /** 아직 정하지 않은 것 — 「잘 모르겠어요」로 넘긴 문항 (Spec Kit의 NEEDS CLARIFICATION). */
  openQuestions: optionalList(z.string()),
  // 3판 — 명세 20261006a §3.9. 새 Phase가 아니라 기존 칸 아래에 붙는다.
  // 골격은 선택 칸을 빈 키(null)로 쓴다 — null은 「아직」이다.
  environment: z.preprocess((v) => (v === null ? undefined : v), irEnvironmentSchema.optional()),
  interface: z.preprocess((v) => (v === null ? undefined : v), irInterfaceSchema.optional()),
  credentials: optionalList(irCredentialSchema),
  caps: z.array(irCapSchema),
  tools: z.array(irToolSchema).default([]),
  models: z.array(irModelSchema).default([]),
  reads: z.array(irReadSchema),
  emits: z.array(irEmitSchema).default([]),
  state: z.array(irStateFieldSchema),
  nodes: z.array(irNodeSchema),
  edges: z.array(irEdgeSchema),
  documents: z.array(irDocDepSchema).default([]),
  requirements: z.array(irRequirementSchema),
  evals: z.array(irEvalSchema),
  requirementLinks: z.array(irRequirementLinkSchema),
});
export type Ir = z.infer<typeof irSchema>;

export type ParseIrResult = { ok: true; ir: Ir } | { ok: false; error: string };

/**
 * Reads an unknown value as an IR, refusing unknown formats *before* shape
 * errors are reported -- a v2 file failing with forty field errors tells the
 * reader nothing, while "this Patchbay reads up to schemaVersion 1" tells them
 * exactly what to do.
 */
export function parseIr(raw: unknown): ParseIrResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "ir: 내용이 객체가 아니다. overlay.yaml의 ir 절을 확인한다." };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return {
      ok: false,
      error: `ir: schemaVersion이 없다. 이 Patchbay는 schemaVersion ${IR_SCHEMA_VERSION}을 읽는다.`,
    };
  }
  if (version > IR_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `ir: schemaVersion ${version}은 이 Patchbay보다 새 형식이다 ` +
        `(여기는 ${IR_SCHEMA_VERSION}까지). Patchbay를 올리거나 그 버전으로 다시 만든다.`,
    };
  }
  if (version < IR_MIN_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `ir: schemaVersion ${version}은 옛 형식이다 (여기는 ${IR_MIN_SCHEMA_VERSION}~${IR_SCHEMA_VERSION}). ` +
        `마이그레이션이 필요하다 — 자동으로 고치지 않는다.`,
    };
  }
  const parsed = irSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `  ${issue.path.join(".") || "(최상위)"} — ${issue.message}`);
    const more = parsed.error.issues.length > 10 ? `\n  … 외 ${parsed.error.issues.length - 10}건` : "";
    return { ok: false, error: `ir: 형식이 맞지 않는다.\n${lines.join("\n")}${more}` };
  }
  return { ok: true, ir: parsed.data };
}

export type { SensitivityLevel };
