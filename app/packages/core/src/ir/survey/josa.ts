/**
 * 받침에 맞춘 조사 — 「메모를」 「갈래가」. 한글이 아닌 낱말(영어 · 숫자)은 「을(를)」처럼 둘 다 쓴다.
 * 설문 문장이 사람 말로 읽혀야 요구사항이 와닿는다 (사용자 요청 2026-10-05).
 */
export function josa(input: string | undefined, withBatchim: string, without: string): string {
  const word = input ?? "";
  const last = word.trim().at(-1);
  if (!last) return word;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${word}${withBatchim}(${without})`;
  const batchim = (code - 0xac00) % 28;
  // 「으로/로」는 ㄹ 받침도 「로」다.
  if (withBatchim === "으로" && batchim === 8) return `${word}${without}`;
  return `${word}${batchim ? withBatchim : without}`;
}
