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

  it("강조를 켠 글은 # 제목 줄을 따로 나누고, 끄면 · ``` 울타리 안이면 글자로 둔다", () => {
    const text = "# 10/26 브리핑\n\n**순서는** 그대로.\n\n## 제안 순서\n- 첫째\n```\n# 주석\n```";
    expect(chatBlocks(text, true)).toEqual([
      { heading: "10/26 브리핑", level: 1 },
      "**순서는** 그대로.",
      { heading: "제안 순서", level: 2 },
      "- 첫째\n```\n# 주석\n```",
    ]);
    expect(chatBlocks(text)).toEqual([text]);
    expect(chatBlocks("#### 깊은 제목", true)).toEqual([{ heading: "깊은 제목", level: 3 }]);
  });
});
