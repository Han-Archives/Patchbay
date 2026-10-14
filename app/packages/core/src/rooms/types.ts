import { z } from "zod";

/**
 * 대화방 — 오른쪽 대화 칸에서 여러 모델이 한 기록을 나눠 본다 (사용자 요청 2026-10-08).
 *
 * `threads/` 는 LangGraph 재개, `consult/` 는 1 설계 상담이다. 대화방은 둘 다 아니다 —
 * 그래프를 재개하지 않고, 초안을 쓰지도 않는다. 원본은 이 파일이다.
 *
 * 사람은 방에 사람을 부르고 역할을 적는다. 「대화 시작」이나 「토의 시작」이 있어야 그 사람들이 한 바퀴 말한다.
 * 예전 기록의 `to` 는 그때 한 명에게 보낸 자국이다.
 */

export const ROOM_SPEAKERS = ["claude-code", "codex", "grok", "local"] as const;
export type RoomSpeaker = (typeof ROOM_SPEAKERS)[number];

export const ROOM_SPEAKER_LABEL: Record<RoomSpeaker, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  grok: "Grok",
  local: "로컬 모델",
};

const base = { seq: z.number().int().nonnegative(), at: z.string() };

/**
 * 대화방 밖에서 옮겨 적은 말의 출처. `claude-session` 은 Claude Code 세션(폰 Remote Control 포함)의
 * 대화를 훅이 그대로 옮긴 것이다 (`patchbay room mirror`). 비어 있으면 콘솔에서 쓴 말이다.
 */
export const ROOM_VIA = ["claude-session"] as const;

export const roomUserSchema = z.object({
  ...base,
  via: z.enum(ROOM_VIA).optional(),
  role: z.literal("user"),
  text: z.string().min(1),
  /** 예전 기록만 채운다. 지금은 방의 사람들에게 같이 남긴다. */
  to: z.enum(ROOM_SPEAKERS).optional(),
  model: z.string().optional(),
});

export const roomMemberSchema = z.object({
  id: z.string().min(1).optional(),
  speaker: z.enum(ROOM_SPEAKERS),
  model: z.string(),
  /** 주요 역할. 이 사람이 무엇을 하는지. */
  role: z.string(),
  /** 역할명. 화면 아이콘 옆에 사람이 붙인 이름. */
  name: z.string().optional(),
  /** 켜면 대화 화면 아래에 아이콘이 나온다. 비우면 켜진 것이다. */
  enabled: z.boolean().optional(),
  /** 답의 강도. Claude 호출은 `--effort` 로 넘긴다. */
  effort: z.enum(["low", "medium", "high"]).optional(),
  /** 아이콘 색 (#rrggbb). 비우면 남색. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** 아이콘 이미지. 외부 주소(http/https) 또는 작게 줄인 data:image. 있으면 글자 대신 보인다. */
  image: z.string().max(300_000).regex(/^(https?:\/\/|data:image\/)/).optional(),
  /** 아이콘 HTML 원본(HTML·CSS·SVG). 스크립트를 막은 칸에서 모양만 보인다. image 보다 먼저 쓴다. */
  iconHtml: z.string().max(100_000).optional(),
});
export type RoomMember = z.infer<typeof roomMemberSchema>;

export const roomSpeakerSchema = z.object({
  ...base,
  role: z.literal("speaker"),
  via: z.enum(ROOM_VIA).optional(),
  speaker: z.enum(ROOM_SPEAKERS),
  model: z.string(),
  text: z.string(),
  ms: z.number().int().nonnegative(),
  memberId: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  operationId: z.string().optional(),
  /** 호출 결과가 입력·출력 양을 돌려준 경우에만 있다. */
  usage: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).optional(),
});

export const roomSystemSchema = z.object({
  ...base,
  role: z.literal("system"),
  kind: z.enum(["error", "timeout", "stopped"]),
  text: z.string(),
});

/** 다른 대화에서 옮겨 붙인 맥락. 다음 모델은 이 요약을 읽고 요구를 잇는다. */
export const roomMemorySchema = z.object({
  ...base,
  role: z.literal("memory"),
  text: z.string().min(1),
  sourceId: z.string().min(1),
});

/** 실행 기록의 연결만 저장한다. 상담 원문과 LangGraph 체크포인트는 각각의 저장소에 둔다. */
export const roomOperationSchema = z.object({
  ...base,
  role: z.literal("operation"),
  executionId: z.string().min(1),
  operationId: z.string().min(1),
  stage: z.enum(["prepare", "act", "check", "deploy", "consult"]),
  status: z.enum(["started", "completed", "failed", "waiting"]),
  text: z.string(),
  result: z.unknown().optional(),
  threadId: z.string().optional(),
  memberId: z.string().optional(),
  ms: z.number().nonnegative().optional(),
});

export const roomMessageSchema = z.discriminatedUnion("role", [
  roomUserSchema,
  roomSpeakerSchema,
  roomSystemSchema,
  roomMemorySchema,
  roomOperationSchema,
]);
export type RoomMessage = z.infer<typeof roomMessageSchema>;
export type NewRoomMessage =
  | Omit<z.infer<typeof roomUserSchema>, "seq" | "at">
  | Omit<z.infer<typeof roomSpeakerSchema>, "seq" | "at">
  | Omit<z.infer<typeof roomSystemSchema>, "seq" | "at">
  | Omit<z.infer<typeof roomMemorySchema>, "seq" | "at">
  | Omit<z.infer<typeof roomOperationSchema>, "seq" | "at">;

/** `empty` 말 없음 · `waiting` 대화 시작·토의 시작 뒤 답이 없다 · `idle` 대기 · `failed` 마지막 턴이 실패 */
export type RoomStatus = "empty" | "waiting" | "idle" | "failed";
