import { describe, expect, it } from "vitest";
import { answerText, splitQuestions } from "./roomQuestions.js";

describe("대화방 「질문」 칸", () => {
  it("선택지 · 추천 · 기타 칸을 읽고 본문에서 떼어 낸다", () => {
    const { text, questions } = splitQuestions([
      "시험은 통과했다.",
      "",
      "```질문",
      "배포 전에 무엇을 먼저 할까요?",
      "1. 시험부터 다시 돌린다 — 5분 걸린다 (추천)",
      "2. 바로 배포한다",
      "기타: 다른 순서가 있으면 적어 주세요",
      "```",
    ].join("\n"));
    expect(text).toBe("시험은 통과했다.");
    expect(questions).toEqual([{
      question: "배포 전에 무엇을 먼저 할까요?",
      options: [
        { label: "시험부터 다시 돌린다", detail: "5분 걸린다", recommended: true },
        { label: "바로 배포한다", detail: "", recommended: false },
      ],
      input: "다른 순서가 있으면 적어 주세요",
    }]);
  });

  it("입력만 있는 질문 · 칸이 비면 직접 적는 칸을 둔다", () => {
    const { questions } = splitQuestions("```질문\n새 프로젝트 이름은?\n입력: 영문 소문자, 예 my-app\n```\n```질문\n더 할 말이 있나요?\n```");
    expect(questions.map((q) => [q.options.length, q.input])).toEqual([[0, "영문 소문자, 예 my-app"], [0, "답을 적어 주세요"]]);
  });

  it("닫히지 않은 칸 · 다른 코드 칸은 글로 둔다", () => {
    expect(splitQuestions("```ts\nconst a = 1;\n```").questions).toEqual([]);
    const open = splitQuestions("앞\n```질문\n고를까?");
    expect(open.questions).toEqual([]);
    expect(open.text).toBe("앞\n```질문\n고를까?");
  });

  it("답 글은 질문과 고른 것 · 적은 말을 같이 적고, 답하지 않은 질문은 뺀다", () => {
    const { questions } = splitQuestions("```질문\n어느 쪽?\n1. 가 — 빠름\n2. 나\n기타: 직접\n```\n```질문\n이름은?\n입력: 예 a\n```");
    expect(answerText(questions, [{ choice: 1, note: "단 내일" }, { choice: null, note: "" }])).toBe("질문: 어느 쪽?\n답: 2. 나 · 단 내일");
    expect(answerText(questions, [undefined, { choice: null, note: "app" }])).toBe("질문: 이름은?\n답: app");
  });
});
