/**
 * P3 SSE contract (spec 3.2). This module is imported by the Vite client
 * (`App.tsx`) as well as the Hono server -- keep it free of `node:*` and
 * chokidar so the browser bundle stays React-only.
 */

/**
 * Watched file -> event name. Two files share `overlay`: both are the
 * project's *authored* design state, and a consumer's response to either is
 * the same -- re-read it. A fifth event name is deliberately not invented for
 * the IR draft; the four names are a freeze value the architecture map pins,
 * and `ir.proposed.yaml` fits what `overlay` already means.
 */
export const STUDIO_EVENT_FILES = {
  "progress.yaml": "progress",
  "inferred.json": "inferred",
  "overlay.yaml": "overlay",
  "ir.proposed.yaml": "overlay",
  // 상담의 출처 · PRD 검토 — 초안과 같이 읽는 저작 상태라 같은 이름이다 (명세 20261006a §12.6 · §14.2).
  "ir.provenance.yaml": "overlay",
  "ir.review.yaml": "overlay",
  "ir.requirement-review.json": "overlay",
  // 「이미 구현됨」 길의 연결 · 결과 — 승인본 옆의 구현 쪽 사실이라 같은 이름이다 (사용자 결정 2026-10-20).
  "existing-build.json": "overlay",
  "board.yaml": "board",
} as const;

export type StudioWatchedFile = keyof typeof STUDIO_EVENT_FILES;
export type StudioEventName = (typeof STUDIO_EVENT_FILES)[StudioWatchedFile];

/**
 * 대화 파일은 `projects/<alias>/threads/<thread_id>.jsonl` 로 한 단계 아래에 산다. 파일 이름이
 * 대화마다 다르므로 위 표에 넣지 않고 따로 짝짓는다 (사용자 결정 2026-10-05 — 대화는 thread_id로).
 */
export const THREAD_EVENT_NAME = "thread";

/**
 * 상담 파일은 `projects/<alias>/consult/<id>.jsonl` (명세 20261006a §12.4). 대화와 따로 짝짓는다 —
 * `thread` 이벤트는 콘솔이 LangGraph로 재개하는데, 상담은 그래프가 없다.
 */
export const CONSULT_EVENT_NAME = "consult";

/**
 * 대화방 파일은 `projects/<alias>/chats/<id>.jsonl` (+ `.meta.json`, 옮기기 전이면 `rooms/`). 콘솔 밖(Claude Code 훅
 * `patchbay room mirror`)에서도 쓰므로, 화면이 다시 읽도록 알린다. 아래 이름 목록에는 넣지 않는다 —
 * 그 목록은 화면 전체를 다시 읽게 하는데, 방의 한 줄마다 그럴 일은 아니다. 대화 칸만 다시 읽는다.
 */
export const ROOM_EVENT_NAME = "room";
/** 선택한 지식 자료와 근거별 검토 기록. 설계 변경과 구별한다. */
export const SEMANTIC_EVENT_NAME = "knowledge";

export const STUDIO_EVENT_NAMES = [
  "progress",
  "inferred",
  "overlay",
  "board",
  THREAD_EVENT_NAME,
  CONSULT_EVENT_NAME,
] as const;

export interface StudioEvent {
  event: StudioEventName | typeof THREAD_EVENT_NAME | typeof CONSULT_EVENT_NAME | typeof ROOM_EVENT_NAME | typeof SEMANTIC_EVENT_NAME;
  alias: string;
  /** 대화 이벤트일 때만 — 바뀐 대화. */
  threadId?: string;
  /** 상담 이벤트일 때만 — 바뀐 상담. */
  consultId?: string;
  /** 대화방 이벤트일 때만 — 바뀐 방. */
  roomId?: string;
}

/** SSE comment, not a fifth event name. */
export const SSE_KEEPALIVE_COMMENT = ": keepalive\n\n";
export const SSE_KEEPALIVE_MS = 15_000;

function posixify(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

/**
 * Maps a changed path to one of the four SSE events when it is exactly
 * `projects/<alias>/<watched-file>`. Nested extra segments, `PROGRESS.md`,
 * and the studio-wide `progress.md` rollup return null.
 *
 * `ir.proposed.yaml` reports as `overlay`: editing a draft's State has to make
 * the 설계 화면's invalidation show up without a reload (구현준비 M3의 통과 조건).
 */
export function parseStudioEvent(filePath: string, studioHome?: string): StudioEvent | null {
  let relative = posixify(filePath);
  if (studioHome) {
    const home = posixify(studioHome).replace(/\/+$/, "");
    if (relative === home) return null;
    if (relative.startsWith(`${home}/`)) {
      relative = relative.slice(home.length + 1);
    }
  }

  const semantic = /(?:^|\/)projects\/([^/]+)\/knowledge\/semantic\.json$/.exec(relative);
  if (semantic?.[1]) return { event: SEMANTIC_EVENT_NAME, alias: semantic[1] };
  const thread = /(?:^|\/)projects\/([^/]+)\/threads\/([^/]+)\.jsonl$/.exec(relative);
  if (thread?.[1] && thread[2]) return { event: THREAD_EVENT_NAME, alias: thread[1], threadId: thread[2] };
  const consult = /(?:^|\/)projects\/([^/]+)\/consult\/([^/]+)\.jsonl$/.exec(relative);
  if (consult?.[1] && consult[2]) return { event: CONSULT_EVENT_NAME, alias: consult[1], consultId: consult[2] };
  const room = /(?:^|\/)projects\/([^/]+)\/(?:chats|rooms)\/([^/]+?)(?:\.meta\.json|\.jsonl)$/.exec(relative);
  if (room?.[1] && room[2]) return { event: ROOM_EVENT_NAME, alias: room[1], roomId: room[2] };

  const match = /(?:^|\/)projects\/([^/]+)\/([^/]+)$/.exec(relative);
  if (!match) return null;
  const alias = match[1];
  const fileName = match[2];
  if (!alias || !fileName) return null;
  if (!(fileName in STUDIO_EVENT_FILES)) return null;
  return {
    event: STUDIO_EVENT_FILES[fileName as StudioWatchedFile],
    alias,
  };
}
