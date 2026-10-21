import { describe, expect, it } from "vitest";
import { chatTokens, projectFileHref } from "./chatLinks.js";

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
