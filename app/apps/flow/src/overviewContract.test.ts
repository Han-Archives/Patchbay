import { describe, expect, it } from "vitest";
import { parseOverview } from "./overviewContract.js";

describe("parseOverview", () => {
  it("splits ## sections and keeps paragraphs, lists, tables, code and quotes", () => {
    const doc = parseOverview([
      "---", "id: x", "---", "# 제목", "", "한 줄 소개.", "", "## 하나", "", "첫 문단", "이어서", "", "- 가", "- 나", "",
      "| 열1 | 열2 |", "| --- | --- |", "| a | b |", "", "```", "## 코드 안의 제목은 절이 아니다", "```", "", "> 인용", "", "### 소제목", "", "## 둘", "끝",
    ].join("\n"));
    expect(doc.title).toBe("제목");
    expect(doc.intro).toEqual([{ type: "p", text: "한 줄 소개." }]);
    expect(doc.sections.map((s) => s.title)).toEqual(["하나", "둘"]);
    expect(doc.sections[0]!.blocks).toEqual([
      { type: "p", text: "첫 문단 이어서" },
      { type: "list", items: ["가", "나"] },
      { type: "table", header: ["열1", "열2"], rows: [["a", "b"]] },
      { type: "code", text: "## 코드 안의 제목은 절이 아니다" },
      { type: "quote", text: "인용" },
      { type: "h", text: "소제목" },
    ]);
  });
});
