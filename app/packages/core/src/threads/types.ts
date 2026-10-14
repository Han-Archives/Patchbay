import { z } from "zod";

/**
 * 대화 — Patchbay에서 한 대화의 기록 (사용자 결정 2026-10-05: 대화는 LangGraph `thread_id`로 관리한다).
 *
 * 대화 하나는 LangGraph 스레드 하나다. 같은 id가 두 곳의 이름표다 — LangGraph의 체크포인터는
 * 그래프 상태를, 이 파일은 사람이 읽을 대화를 든다. 원본은 이 파일이다 (원칙 7).
 *
 * 메시지는 다섯 갈래다:
 * - `user`     — 사람이 대화 칸에 적은 것
 * - `graph`    — 그래프 실행의 결과. 끝났거나(`success` · `error`), 노드가 `interrupt`로 멈췄다(`waiting`)
 * - `host`     — 멈춘 노드에 IDE의 호스트 모델이 단 답 (MCP). 거절도 답이다
 * - `system`   — 한도 시간 안에 답이 없어서 Patchbay가 「시간 초과」로 닫았다
 * - `feedback` — 사람이 한 메시지에 붙인 👍 · 👎 · 메모
 *
 * Patchbay는 모델을 부르지 않는다 (원칙 5 · 9). 쓰는 것은 호스트, 실행은 LangGraph다.
 */

const base = {
  /** 파일 안 순번. 0부터. 다른 메시지가 이 번호로 가리킨다. */
  seq: z.number().int().nonnegative(),
  at: z.string(),
};

export const threadUserMessageSchema = z.object({
  ...base,
  role: z.literal("user"),
  text: z.string().min(1),
});

export const GRAPH_MESSAGE_STATUSES = ["success", "error", "waiting"] as const;

export const threadGraphMessageSchema = z.object({
  ...base,
  role: z.literal("graph"),
  status: z.enum(GRAPH_MESSAGE_STATUSES),
  assistantId: z.string(),
  runId: z.string().optional(),
  /** 멈춘 노드, 또는 마지막으로 돈 노드. */
  nodeId: z.string().optional(),
  text: z.string().optional(),
  /** `waiting` 일 때 — 노드가 `interrupt()`에 넘긴 값. 호스트가 읽는 「요청」이다. */
  request: z.unknown().optional(),
  /** `waiting` 일 때 — 이 시각까지 답이 없으면 시간 초과로 닫는다. */
  deadlineAt: z.string().optional(),
});

export const threadHostMessageSchema = z.object({
  ...base,
  role: z.literal("host"),
  /** 답하는 `waiting` 메시지의 seq. */
  replyTo: z.number().int().nonnegative(),
  outcome: z.enum(["answered", "refused"]),
  text: z.string(),
  /** 답한 호스트 모델 이름 (예: `claude-code · opus`). 호스트가 스스로 밝힌다. */
  model: z.string().optional(),
  /** 멈춘 때부터 답까지 걸린 시간. */
  ms: z.number().int().nonnegative().optional(),
});

export const threadSystemMessageSchema = z.object({
  ...base,
  role: z.literal("system"),
  replyTo: z.number().int().nonnegative(),
  outcome: z.literal("timeout"),
  text: z.string(),
});

export const threadFeedbackMessageSchema = z.object({
  ...base,
  role: z.literal("feedback"),
  target: z.number().int().nonnegative(),
  value: z.enum(["up", "down"]),
  note: z.string().optional(),
});

export const threadMessageSchema = z.discriminatedUnion("role", [
  threadUserMessageSchema,
  threadGraphMessageSchema,
  threadHostMessageSchema,
  threadSystemMessageSchema,
  threadFeedbackMessageSchema,
]);

export type ThreadMessage = z.infer<typeof threadMessageSchema>;
export type ThreadUserMessage = z.infer<typeof threadUserMessageSchema>;
export type ThreadGraphMessage = z.infer<typeof threadGraphMessageSchema>;
export type ThreadHostMessage = z.infer<typeof threadHostMessageSchema>;
export type ThreadSystemMessage = z.infer<typeof threadSystemMessageSchema>;
export type ThreadFeedbackMessage = z.infer<typeof threadFeedbackMessageSchema>;

/** 새로 붙일 메시지 — `seq`와 `at`은 저장소가 매긴다. */
export type NewThreadMessage =
  | Omit<ThreadUserMessage, "seq" | "at">
  | Omit<ThreadGraphMessage, "seq" | "at">
  | Omit<ThreadHostMessage, "seq" | "at">
  | Omit<ThreadSystemMessage, "seq" | "at">
  | Omit<ThreadFeedbackMessage, "seq" | "at">;

/**
 * 대화의 지금.
 * - `empty`    — 아직 아무것도 없다
 * - `sent`     — 사람이 적었고 그래프 결과가 아직 없다
 * - `waiting`  — 노드가 멈춰 호스트의 답을 기다린다
 * - `resuming` — 답(또는 시간 초과)이 왔고 그래프를 다시 돌려야 한다
 * - `done`     — 마지막 실행이 끝났다
 * - `failed`   — 마지막 실행이 오류로 끝났다
 */
export type ThreadStatus = "empty" | "sent" | "waiting" | "resuming" | "done" | "failed";
