import { describe, expect, it } from "vitest";
import { chatBlocks } from "./ChatText.js";

describe("대화 글의 마크다운 표", () => {
  it("머리 줄 · 구분 줄 · 본문 줄을 표로 나누고 앞뒤 글은 그대로 둔다", () => {
    const text = [
      "## 제안 순서",
      "| # | 할일 | 이유 |",
      "|---|---|---|",
      "| 1 | 폰 알림 채널 설정 (`t-1`) | 값만 넣으면 됩니다. |",
      "| 8 | must가 맞는지 (`e151ea8`) | |",
      "| 9 | R7.2a 추천  | 코드 대조 (`d09`) | 상태 메모로 보입니다. |",
      "",
      "끝.",
    ].join("\n");
    expect(chatBlocks(text)).toEqual([
      "## 제안 순서",
      {
        head: ["#", "할일", "이유"],
        rows: [
          ["1", "폰 알림 채널 설정 (`t-1`)", "값만 넣으면 됩니다."],
          ["8", "must가 맞는지 (`e151ea8`)", ""],
          ["9", "R7.2a 추천", "코드 대조 (`d09`)", "상태 메모로 보입니다."],
        ],
      },
      "끝.",
    ]);
  });

  it("구분 줄이 없으면 표로 보지 않고, 칸 안의 \\| 는 글자로 둔다", () => {
    expect(chatBlocks("| a | b |\n| c | d |")).toEqual(["| a | b |\n| c | d |"]);
    expect(chatBlocks("| 명령 | 뜻 |\n| :-- | --: |\n| a \\| b | 또는 |")).toEqual([{ head: ["명령", "뜻"], rows: [["a | b", "또는"]] }]);
  });
});
