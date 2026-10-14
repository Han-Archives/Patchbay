import { describe, expect, it } from "vitest";
import { artifactFromTalk, artifactToMarkdown, goalFromArtifact, leadBefore, markdownFileRefs, orderLabelsFromArtifact, parseArtifact, parseNumberedSteps, phasesFromWorkLog } from "./processArtifact.js";

describe("artifactFromTalk", () => {
  it("turns JSON table fences into a table", () => {
    const artifact = artifactFromTalk({
      output: "table",
      title: "목표설계",
      original: "ignore",
      summary: '```json\n{"type":"table","columns":["항목","내용"],"rows":[["목표","출시"]]}\n```',
    });
    expect(artifact.type).toBe("table");
    expect(artifact.columns).toEqual(["항목", "내용"]);
    expect(artifact.rows).toEqual([["목표", "출시"]]);
  });

  it("turns key:value lines into a two-column table", () => {
    const artifact = artifactFromTalk({
      output: "table",
      title: "약점 진단",
      original: "원문",
      summary: ["영역: reading", "약점: 문장삽입", "다음 강의: lectures/reading.md"].join("\n"),
    });
    expect(artifact.type).toBe("table");
    expect(artifact.rows).toEqual([
      ["영역", "reading"],
      ["약점", "문장삽입"],
      ["다음 강의", "lectures/reading.md"],
    ]);
  });

  it("turns arrows into a diagram when the step asks for one", () => {
    const artifact = artifactFromTalk({
      output: "diagram",
      title: "강의 조각",
      original: "",
      summary: ["접수 → 진단", "진단 → 강의"].join("\n"),
    });
    expect(artifact.type).toBe("diagram");
    expect(artifact.nodes.map((node) => node.label)).toEqual(["접수", "진단", "강의"]);
    const labels = (id: string) => artifact.nodes.find((node) => node.id === id)?.label;
    expect(artifact.edges.map((edge) => `${labels(edge.from)}->${labels(edge.to)}`)).toEqual([
      "접수->진단",
      "진단->강의",
    ]);
  });

  it("keeps prior thread and appends nothing until appendTalk", () => {
    const previous = parseArtifact({ threadId: "t1", messages: [{ role: "user", text: "안녕" }] }, "목표");
    const artifact = artifactFromTalk({
      output: "table",
      title: "목표",
      original: "",
      summary: "목표: 출시\n채택: 약점 루프",
      previous,
    });
    expect(artifact.threadId).toBe("t1");
    expect(artifact.messages).toEqual([{ role: "user", text: "안녕" }]);
  });
});

describe("constitution talk", () => {
  it("keeps a decision table and numbered order together", () => {
    const artifact = artifactFromTalk({
      output: "table",
      title: "기획",
      original: ["목표는 출시", "1. 오답 접수", "2. 약점 진단", "3. 재풀이"].join("\n"),
      summary: ["목표: 빠른 출시", "채택: 약점 루프", "보류: 강의 몰아듣기"].join("\n"),
      constitution: true,
    });
    expect(artifact.rows).toEqual([
      ["목표", "빠른 출시"],
      ["채택", "약점 루프"],
      ["보류", "강의 몰아듣기"],
    ]);
    expect(orderLabelsFromArtifact(artifact)).toEqual(["오답 접수", "약점 진단", "재풀이"]);
    expect(goalFromArtifact(artifact)).toBe("빠른 출시");
  });

  it("keeps a decision table when the beat asks for a diagram", () => {
    const artifact = artifactFromTalk({
      output: "diagram",
      title: "실행",
      original: "약점 루프로 가자. 순서는 오답 접수 다음 진단.",
      summary: ["목표: 빠른 출시", "채택: 약점 루프", "1. 오답 접수", "2. 약점 진단"].join("\n"),
      constitution: true,
    });
    expect(goalFromArtifact(artifact)).toBe("빠른 출시");
    expect(orderLabelsFromArtifact(artifact)).toEqual(["오답 접수", "약점 진단"]);
  });

  it("does not treat 영역/약점 diagnosis as an order", () => {
    const previous = parseArtifact(
      {
        columns: ["항목", "내용"],
        rows: [["목표", "출시"]],
      },
      "기획",
    );
    const artifact = artifactFromTalk({
      output: "table",
      title: "기획",
      original: "오답",
      summary: ["영역: reading", "약점: 문장삽입"].join("\n"),
      previous,
      constitution: true,
    });
    expect(goalFromArtifact(artifact)).toBe("출시");
    expect(orderLabelsFromArtifact(artifact)).toEqual([]);
  });
});

describe("work log", () => {
  it("maps 단계/상태 onto diagram labels and finds md paths", () => {
    const artifact = artifactFromTalk({
      output: "diagram",
      title: "실행",
      original: [
        "1. 운영 원칙",
        "2. 2주차 · R·L",
        "3. 3주차 · 시간 안에 완주",
        "",
        "| 단계 | 상태 | 작업 | 파일 |",
        "| --- | --- | --- | --- |",
        "| 운영 원칙 | 완료 | 규칙 확정 | `docs/기획/방향.md` |",
        "| 2주차 · R·L | 진행 중 |  |  |",
        "| 3주차 · 시간 안에 완주 | 예정 |  |  |",
      ].join("\n"),
      summary: "",
      constitution: true,
    });
    expect(orderLabelsFromArtifact(artifact)).toEqual(["운영 원칙", "2주차 · R·L", "3주차 · 시간 안에 완주"]);
    const phases = phasesFromWorkLog(artifact);
    expect(phases.get("운영 원칙")).toBe("done");
    expect(phases.get("3주차 · 시간 안에 완주")).toBe("idle");
    expect(phases.get("2주차 · R·L")).toBe("running");
    expect(markdownFileRefs("`docs/기획/방향.md`")).toEqual(["docs/기획/방향.md"]);
  });
});

describe("parseNumberedSteps", () => {
  it("reads a numbered list", () => {
    expect(parseNumberedSteps("1. 접수\n2. 진단")).toEqual(["접수", "진단"]);
  });
});

describe("artifactToMarkdown", () => {
  it("renders a markdown table", () => {
    const md = artifactToMarkdown({
      type: "table",
      title: "목표설계",
      columns: ["항목", "내용"],
      rows: [["목표", "출시"]],
      nodes: [],
      edges: [],
      body: "",
      lead: "",
      messages: [],
      threadId: "",
    });
    expect(md).toContain("| 항목 | 내용 |");
    expect(md).toContain("| 목표 | 출시 |");
  });
});

describe("leadBefore", () => {
  it("keeps the prose paragraph a blank line above the table", () => {
    const md = "# 목표\n\n**데이터 분석가가 되기 위한 지식 습득.** 매일 한 바퀴 돈다.\n\n| 영역 | 현재 |\n| --- | --- |\n| 완료 | 5 |\n";
    expect(leadBefore(md)).toBe("**데이터 분석가가 되기 위한 지식 습득.** 매일 한 바퀴 돈다.");
  });

  it("does not mistake a numbered list for a lead", () => {
    const md = "# 실행\n\n1. 운영 원칙\n2. 1주차\n\n| 단계 | 상태 |\n| --- | --- |\n| 수강 | 완료 |\n";
    expect(leadBefore(md)).toBe("");
  });

  it("drops prose that a heading separates from the table", () => {
    const md = "설명 문단\n\n## 표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(leadBefore(md)).toBe("");
  });
});
