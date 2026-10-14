import { ROOM_SPEAKER_LABEL, type RoomMessage } from "./types.js";

/**
 * 이전 대화의 맥락 — 사람이 말한 요구와 모델이 낸 답을 짧게 모아, 다른 대화에 붙인다.
 *
 * 모델을 부르지 않는다. 긴 기록을 통째로 넘기지 않고, 다음 모델이 이 요약만 읽고 요구를 잇게 한다.
 * 화면에서는 대화 칸에 붙인 뒤 기록에 남는다 (`role: memory`).
 */

const ASK_KEEP = 6;
const SAY_KEEP = 4;
const LINE = 160;

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= LINE) return line;
  return `${line.slice(0, LINE)}…`;
}

export function roomMemory(messages: readonly RoomMessage[], title: string): string {
  const asks = messages.filter((m) => m.role === "user").slice(-ASK_KEEP);
  const says = messages.filter((m) => m.role === "speaker").slice(-SAY_KEEP);
  return [
    `맥락. 이전 대화 「${title}」에서 옮긴 요약이다. 아래 요구와 이미 나온 말을 알고 있는 것으로 보고 이어서 답한다.`,
    "",
    "요구:",
    ...(asks.length ? asks.map((m) => `- ${clip(m.text)}`) : ["- (사람이 물은 말이 없다)"]),
    "",
    "나온 말:",
    ...(says.length
      ? says.map((m) => `- ${ROOM_SPEAKER_LABEL[m.speaker]}: ${clip(m.text)}`)
      : ["- (아직 답이 없다)"]),
  ].join("\n");
}
