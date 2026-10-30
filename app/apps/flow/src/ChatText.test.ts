import { describe, expect, it } from "vitest";
import { chatBlocks } from "./ChatText.js";
import { ChatText } from "./ChatText.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

describe("대화 안 이미지 미리보기", () => {
  const render = (text: string, bold = false) => renderToStaticMarkup(createElement(ChatText, { text, project: "demo", bold }));

  it("문서 이미지·사진 경로와 마크다운 이미지를 본문에 표시하고 원본 열기·받기를 제공한다", () => {
    const html = render("문서: ![첫 화면](<시안/홈 화면.png>)\n사진: photos/cat.jpg", true);
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('alt="첫 화면"');
    expect(html).toContain('src="/api/project-file/demo/' + encodeURIComponent("시안") + '/' + encodeURIComponent("홈 화면.png") + '"');
    expect(html).toContain('href="/api/project-file/demo/photos/cat.jpg?download=1"');
    expect(html).not.toContain("![첫 화면]");
  });

  it("일반 마크다운 이미지 링크와 쿼리 있는 사진 URL도 바로 표시한다", () => {
    const html = render("[사진](photos/cat.jpg)\nhttps://example.com/photo.png?size=large");
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('alt="사진"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it("업로드한 사진은 기존 첨부 주소로 표시하고 다른 프로젝트 첨부는 표시하지 않는다", () => {
    const html = render("![사진](/api/refs/raw?alias=demo&id=F1)");
    expect(html).toContain('src="/api/refs/raw?alias=demo&amp;id=F1"');
    expect(html).toContain('id=F1&amp;download=1');
    expect(render("![다른 사진](/api/refs/raw?alias=other&id=F1)")).not.toContain("<img");
  });

  it("코드 울타리·위험한 주소·일반 문서는 이미지로 바꾸지 않는다", () => {
    for (const text of ["```md\n![예시](photos/cat.jpg)\n```", "![사진](javascript:alert)", "![사진](data:image/svg+xml,test)", "reports/plan.pdf", "design/home.html"]) {
      expect(render(text, true)).not.toContain("<img");
    }
    expect(render("[기획서](reports/plan.pdf)")).toContain('href="/api/project-file/demo/reports/plan.pdf"');
  });
});
