import { describe, expect, it } from "vitest";
import { chatTokens, imageHref, isChatImage, projectFileHref, refImageHref } from "./chatLinks.js";

describe("chatTokens", () => {
  it("links a web address without the sentence's closing punctuation", () => {
    expect(chatTokens("첨부 · 링크\nhttps://example.com/a?b=1).")).toEqual([
      { kind: "text", text: "첨부 · 링크\n" },
      { kind: "url", text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { kind: "text", text: ")." },
    ]);
  });

  it("links deliverable paths, absolute or relative, even with a Korean particle attached", () => {
    expect(chatTokens("시안은 design/홈_v1.html에 두었고 /Users/me/p/out/deck.pdf 도 있다")).toEqual([
      { kind: "text", text: "시안은 " },
      { kind: "file", text: "design/홈_v1.html", path: "design/홈_v1.html" },
      { kind: "text", text: "에 두었고 " },
      { kind: "file", text: "/Users/me/p/out/deck.pdf", path: "/Users/me/p/out/deck.pdf" },
      { kind: "text", text: " 도 있다" },
    ]);
  });

  it("takes a backticked path with spaces whole", () => {
    expect(chatTokens("열기: `시안/홈 화면.html`")).toEqual([
      { kind: "text", text: "열기: " },
      { kind: "file", text: "`시안/홈 화면.html`", path: "시안/홈 화면.html" },
    ]);
  });

  it("links a backticked web address too", () => {
    expect(chatTokens("`https://example.com/x`")).toEqual([{ kind: "url", text: "https://example.com/x", href: "https://example.com/x" }]);
  });

  it("leaves code files, bare names and other backticks as text", () => {
    for (const text of ["src/server.ts:12 고침", "README.md 참고", "`npm run build`", "v1.2 / 3.5"]) {
      expect(chatTokens(text)).toEqual([{ kind: "text", text }]);
    }
  });
});

describe("이미지 주소", () => {
  it("사진 확장자와 쿼리를 구분하고 일반 문서는 제외한다", () => {
    expect(isChatImage("photos/A.JPEG?raw=1#preview")).toBe(true);
    expect(isChatImage("reports/plan.pdf")).toBe(false);
    expect(isChatImage("https://example.com/page?file=cat.png")).toBe(false);
  });

  it("마크다운 이미지의 한글·공백 경로를 한 덩이로 읽는다", () => {
    expect(chatTokens("![표지](<문서/첫 화면.png>)")).toEqual([{ kind: "image", text: "![표지](<문서/첫 화면.png>)", target: "문서/첫 화면.png", alt: "표지" }]);
    expect(imageHref("demo", "문서/첫 화면.png")).toBe(projectFileHref("demo", "문서/첫 화면.png"));
  });

  it("첨부 주소는 프로젝트를 대조하고 실행 가능한 주소는 제외한다", () => {
    expect(imageHref("demo", refImageHref("demo", "F1"))).toBe("/api/refs/raw?alias=demo&id=F1");
    expect(imageHref("demo", refImageHref("other", "F1"))).toBeNull();
    for (const target of ["javascript:alert(1)", "data:image/png,abc", "file:///tmp/cat.png", "//example.com/cat.png"]) expect(imageHref("demo", target)).toBeNull();
  });
});

describe("projectFileHref", () => {
  it("keeps folders as path segments so a draft's relative assets resolve", () => {
    expect(projectFileHref("demo", "./시안/홈 화면.html")).toBe(
      `/api/project-file/demo/${encodeURIComponent("시안")}/${encodeURIComponent("홈 화면.html")}`,
    );
  });

  it("sends an absolute path as one segment for the server to relocate", () => {
    expect(projectFileHref("demo", "/r/a.pdf", true)).toBe("/api/project-file/demo/%2Fr%2Fa.pdf?download=1");
  });
});
