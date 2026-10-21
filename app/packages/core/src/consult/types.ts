import { z } from "zod";

/**
 * 상담 기록 — 1 설계 상담의 대화 (명세 20261006a §12.4).
 *
 * `threads/` 와 폴더를 나눈다. 대화(`threads/`)는 LangGraph 그래프의 멈춤에 답하는 길이라 콘솔이 답 붙은
 * 대화를 LangGraph로 재개한다(`resumeReady`). 상담은 그래프가 없다 — 섞이면 콘솔이 상담을 재개하려 든다.
 *
 * - `meta`   — 어느 호스트 · 모델 · 호스트 세션인가. 첫 줄, 그리고 호스트를 바꿀 때마다
 * - `user`   — 사람의 말. PRD 「고쳐 주세요」에서 온 말이면 절 번호
 * - `host`   — 호스트의 답. `costUsd` 는 CLI가 낸 **환산값**이다 — 구독이면 청구액이 아니다
 * - `system` — 실패 · 시간 초과 · 호스트 전환 · 끝냄(`closed` — 그 뒤 파일은 `archive/` 로 간다)
 */

export const CONSULT_HOSTS = ["claude-code", "codex"] as const;
export type ConsultHost = (typeof CONSULT_HOSTS)[number];

const base = { seq: z.number().int().nonnegative(), at: z.string() };

export const consultMetaSchema = z.object({
  ...base,
  role: z.literal("meta"),
  host: z.enum(CONSULT_HOSTS),
  model: z.string(),
  /** 호스트 쪽 세션 id — Claude `--session-id` · Codex `thread_id`. 첫 턴이 끝나기 전엔 없을 수 있다. */
  hostSessionId: z.string().optional(),
  /** 등록한 LLM(`agents.json`)으로 불렀으면 그 Agent — 화면이 누가 상담했는지 보이고 다음 턴에 같은 LLM을 고른다. */
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});
export const consultUserSchema = z.object({
  ...base,
  role: z.literal("user"),
  text: z.string().min(1),
  prdSection: z.number().int().positive().optional(),
  /** 「+」로 붙인 자료 — 참고 자료(`refs/`)의 id와 보이는 이름. 호스트에게는 경로로 넘긴다. */
  attachments: z
    .array(z.object({ id: z.string(), title: z.string(), kind: z.enum(["link", "file", "image"]), uri: z.string() }))
    .optional(),
});
export const consultHostSchema = z.object({
  ...base,
  role: z.literal("host"),
  text: z.string(),
  model: z.string(),
  /** 답한 등록 LLM의 이름. 없으면 호스트를 직접 고른 상담이다. */
  agentName: z.string().optional(),
  ms: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  usage: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).optional(),
});
export const consultSystemSchema = z.object({
  ...base,
  role: z.literal("system"),
  kind: z.enum(["error", "timeout", "host-switch", "closed"]),
  text: z.string(),
});

export const consultMessageSchema = z.discriminatedUnion("role", [
  consultMetaSchema,
  consultUserSchema,
  consultHostSchema,
  consultSystemSchema,
]);
export type ConsultMessage = z.infer<typeof consultMessageSchema>;
export type ConsultMeta = z.infer<typeof consultMetaSchema>;
export type NewConsultMessage =
  | Omit<z.infer<typeof consultMetaSchema>, "seq" | "at">
  | Omit<z.infer<typeof consultUserSchema>, "seq" | "at">
  | Omit<z.infer<typeof consultHostSchema>, "seq" | "at">
  | Omit<z.infer<typeof consultSystemSchema>, "seq" | "at">;

/**
 * 파일이 말하는 지금.
 * - `empty`   — 아무 말도 없다
 * - `waiting` — 사람이 말했고 답이 아직 없다 (돌고 있거나, 콘솔이 꺼져 끊겼다)
 * - `idle`    — 호스트가 답했다
 * - `failed`  — 마지막 턴이 실패했다 — 다시 보내면 된다
 * - `closed`  — 끝낸 대화다. 보관에서 읽기만 하고, 이어 말하려면 새 상담을 연다
 */
export type ConsultStatus = "empty" | "waiting" | "idle" | "failed" | "closed";
