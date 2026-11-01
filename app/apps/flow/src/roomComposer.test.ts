import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomPanel } from "./RoomPanel.js";
import {
  buildComposedMessage,
  filterProjectFiles,
  filterRulesAndSkills,
  makeStagedDoc,
  makeStagedImage,
  makeStagedLink,
  makeStagedProjectFile,
  makeStagedRuleOrSkill,
} from "./roomComposer.js";

describe("대화창 첨부 대기(stage) 및 모달 검색·필터", () => {
  it("RoomPanel 초기 화면에 첨부 · LLM 추가 · 모드 버튼이 모두 렌더링된다", () => {
    const html = renderToStaticMarkup(createElement(RoomPanel, { project: "patchbay", revision: 0 }));
    expect(html).toContain('aria-label="첨부"');
    expect(html).toContain('aria-label="LLM 추가"');
    expect(html).toContain('aria-label="모드"');
    expect(html).toContain('title="자료 · 파일 · 규칙/스킬 · 링크 추가"');
    expect(html).toContain('title="참여 LLM 선택 · 관리"');
  });

  it("문서·사진·링크·프로젝트 파일·규칙/스킬을 입력창에 담아 한 메시지로 합친다", () => {
    const doc = makeStagedDoc("요구사항.md", "# 제목\n본문 내용");
    const img = makeStagedImage("화면.png", "/api/refs/raw?alias=demo&id=F1");
    const link = makeStagedLink("https://example.com/docs/spec");
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const file = makeStagedProjectFile("src/App.tsx", "export function App() {}");
    const rule = makeStagedRuleOrSkill({ kind: "규칙", name: "briefing", description: "네 칸으로 브리핑" });
    const skill = makeStagedRuleOrSkill({ kind: "스킬", name: "task-clarity", description: "논의 대상과 할 일 정리", scope: "studio" });

    const combined = buildComposedMessage("이 내용으로 검토해 줘", [doc, img, link.item, file, rule, skill]);
    expect(combined).toContain("첨부 · 문서 「요구사항.md」\n# 제목\n본문 내용");
    expect(combined).toContain("![화면.png](/api/refs/raw?alias=demo&id=F1)");
    expect(combined).toContain("첨부 · 링크\nhttps://example.com/docs/spec");
    expect(combined).toContain("첨부 · 프로젝트 「src/App.tsx」\nexport function App() {}");
    expect(combined).toContain("규칙 「briefing」대로 스킬 「task-clarity」대로 이 내용으로 검토해 줘");
  });

  it("첨부만 있고 입력글이 비어 있어도 전송 가능한 본문을 만든다", () => {
    const fileImg = makeStagedProjectFile("design/시안.png");
    expect(fileImg.isImage).toBe(true);
    expect(buildComposedMessage("   ", [fileImg])).toBe("첨부 · 프로젝트 이미지\n![design/시안.png](<design/시안.png>)");
  });

  it("http/https 가 아닌 링크는 거절한다", () => {
    expect(makeStagedLink("javascript:alert(1)").ok).toBe(false);
    expect(makeStagedLink("ftp://example.com").ok).toBe(false);
    expect(makeStagedLink("https://patchbay.local/guide").ok).toBe(true);
  });

  it("프로젝트 파일 검색은 파일명이 검색어로 시작하는 항목을 먼저 보여 준다", () => {
    const files = ["docs/RoomPanel-guide.md", "src/RoomPanel.tsx", "src/roomHost.ts", "README.md"];
    expect(filterProjectFiles(files, "roompanel")).toEqual(["src/RoomPanel.tsx", "docs/RoomPanel-guide.md"]);
    expect(filterProjectFiles(files, "src ts")).toEqual(["src/roomHost.ts", "src/RoomPanel.tsx"]);
  });

  it("규칙 · 스킬 목록은 종류 필터(전체/규칙/스킬)와 이름·설명 검색을 함께 지원한다", () => {
    const rows = [
      { kind: "규칙" as const, name: "briefing", description: "오늘 할 일을 네 칸으로 답한다", apply: "always" as const },
      { kind: "스킬" as const, name: "task-clarity", description: "논의 대상 정의와 사용자가 해야 하는 일 안내", scope: "studio" as const },
      { kind: "스킬" as const, name: "intent-md", description: "개발 의도 문서 작성", scope: "studio" as const },
    ];
    expect(filterRulesAndSkills(rows, "", "규칙").map((r) => r.name)).toEqual(["briefing"]);
    expect(filterRulesAndSkills(rows, "", "스킬").map((r) => r.name)).toEqual(["task-clarity", "intent-md"]);
    expect(filterRulesAndSkills(rows, "논의 대상", "all").map((r) => r.name)).toEqual(["task-clarity"]);
  });
});
