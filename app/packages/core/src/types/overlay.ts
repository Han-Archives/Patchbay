import { z } from "zod";
import { patchSchema, wireSchema } from "./project.js";
import { decisionSchema } from "./domain.js";
import { irSchema } from "./ir.js";

/**
 * Human-declared project process. Not a workflow engine: the 프로젝트 tab
 * writes this once (installer), the 흐름 tab paints it next to LangGraph.
 */
export const PROCESS_OUTPUTS = ["table", "diagram", "text"] as const;
export type ProcessOutput = (typeof PROCESS_OUTPUTS)[number];

export const processStepSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    output: z.enum(PROCESS_OUTPUTS).optional(),
  })
  .transform((step) => ({
    id: step.id,
    label: step.label,
    output: step.output ?? ("table" as const),
  }));
export type ProcessStep = z.infer<typeof processStepSchema>;

export const processEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type ProcessEdge = z.infer<typeof processEdgeSchema>;

export interface OverlayProcess {
  configured: boolean;
  goal: string;
  folders: string[];
  steps: ProcessStep[];
  edges: ProcessEdge[];
  bind: Record<string, string>;
}

export const EMPTY_PROCESS: OverlayProcess = {
  configured: false,
  goal: "",
  folders: [],
  steps: [],
  edges: [],
  bind: {},
};

export const processSchema = z
  .object({
    configured: z.boolean().optional(),
    goal: z.string().optional(),
    folders: z.array(z.string()).optional(),
    steps: z.array(processStepSchema).optional(),
    edges: z.array(processEdgeSchema).optional(),
    bind: z.record(z.string(), z.string()).optional(),
  })
  .transform(
    (value): OverlayProcess => ({
      configured: value.configured ?? false,
      goal: value.goal ?? "",
      folders: value.folders ?? [],
      steps: value.steps ?? [],
      edges: value.edges ?? [],
      bind: value.bind ?? {},
    }),
  );

/**
 * A ceiling on one run. Patchbay **reports** a breach; it does not stop a run
 * (원칙 9 — 런타임 강제는 Patchbay가 하지 않는다). Enforcement belongs to the
 * generated code and its runtime, and a limit that claimed to stop things while
 * only watching would be worse than no limit.
 */
export const budgetSchema = z.object({
  /** Max input+output tokens for one run. Omitted: no token ceiling. */
  tokensPerRun: z.number().int().positive().optional(),
  /** Max USD for one run. Omitted: no cost ceiling. */
  costUsdPerRun: z.number().positive().optional(),
  /** Why this number. A ceiling with no reason is a number nobody dares change. */
  why: z.string().default(""),
});
export type Budget = z.infer<typeof budgetSchema>;

/**
 * `overlay.yaml` shape — this file is human-owned. A scan process must
 * never overwrite it (a runtime/process rule enforced elsewhere, not by
 * this schema — hence no field here implies anything is "generated").
 */
export const overlaySchema = z.object({
  patches: z.array(patchSchema).default([]),
  wires: z.array(wireSchema).default([]),
  decisions: z.array(decisionSchema).default([]),
  accepted_guides: z.array(z.string()).default([]),
  process: z.preprocess((value) => value ?? {}, processSchema),
  /**
   * The agent graph's design (명세 20260929a §2.2). Optional on purpose, and
   * *not* defaulted to `{}`: an absent `ir` means 1단계 hasn't started, while
   * an empty one is a malformed file, and a default would erase that
   * difference. A different axis from `process` -- that is the person's work
   * plan (curriculum, weeks), this is the graph; `process.bind` joins them.
   */
  ir: irSchema.optional(),
  /**
   * 실행별 비용 한도 (기획서 5.6 — 누가: 사람).
   *
   * **`ir` 안이 아니라 여기다.** The IR is the design's 저작물 (원칙 2) and its
   * fields are fixed by 명세 §3; an operating limit is not part of the design --
   * two people running the same design can afford different ceilings, and moving
   * the ceiling must not bump `ir.version`. So it sits in `overlay` beside it,
   * human-owned like everything else in this file.
   *
   * Optional and *not* defaulted: an absent budget means「한도를 걸지 않았다」,
   * which is different from a budget of zero.
   */
  budget: budgetSchema.optional(),
  /**
   * 3 운영의 사용 창 — 프로젝트가 만든 화면 (사용자 결정 2026-10-08: 문제는 Patchbay 운영 안에서 푼다).
   * 화면은 프로젝트가 만들고 Patchbay는 틀만 맡는다. 설계(ir)가 아니다 — 같은 설계라도 화면 주소는 기기마다 다르다.
   */
  app: z.object({ url: z.string().url() }).optional(),
});
export type Overlay = z.infer<typeof overlaySchema>;
