/**
 * 요구사항을 사람에게 보이는 한 줄로 (사용자 요청 2026-10-07 — 「시스템은」 빼고, 정리해서, 짧게).
 *
 * 1순위는 상담자가 붙인 `summary`. 없으면 원문에서 상투어(「시스템은」 · When/If/While/Where 머리)를 걷어 내고
 * 길면 줄인다. 맞춤법은 고치지 못한다 — 그건 모델의 일이라 「요구사항 정리」로 상담자에게 맡긴다.
 */
export const REQUIREMENT_SUMMARY_MAX = 25;
const DISPLAY_MAX = 48;

export function cleanRequirementText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^\s*(When|If|While|Where)\s+/i, "")
    .replace(/,?\s*(then\s+)?(시스템|에이전트)(은|는|이|가)\s+/g, (m) => (m.trim().startsWith(",") ? ", " : " "))
    .replace(/^(시스템|에이전트)(은|는|이|가)\s+/, "")
    .replace(/\s*,\s*then\s+/i, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,\s]+|[,\s.]+$/g, "")
    .trim();
}

export function requirementDisplay(req: { text?: unknown; summary?: unknown }): { short: string; full: string; summarized: boolean } {
  const full = typeof req.text === "string" ? req.text.trim() : "";
  const summary = typeof req.summary === "string" ? req.summary.trim() : "";
  if (summary) return { short: summary, full, summarized: true };
  const cleaned = cleanRequirementText(full);
  return { short: cleaned.length > DISPLAY_MAX ? `${cleaned.slice(0, DISPLAY_MAX - 1)}…` : cleaned, full, summarized: false };
}
