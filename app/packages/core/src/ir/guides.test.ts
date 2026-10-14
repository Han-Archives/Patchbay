import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IR_GATE_CELLS } from "./gates.js";
import { IR_CELL_GUIDES } from "./guides.js";

describe("칸 안내", () => {
  it("열 칸 모두 묻는 말 · 요령 · 예시가 있다 — 「예시」 버튼이 빈 칸을 열지 않게", () => {
    for (const cell of IR_GATE_CELLS) {
      const guide = IR_CELL_GUIDES[cell.id];
      expect(guide, cell.id).toBeDefined();
      expect(guide!.ask.endsWith("?"), `${cell.id} 는 질문이다`).toBe(true);
      expect(guide!.how.length).toBeGreaterThan(0);
      expect(guide!.example.length).toBeGreaterThan(0);
    }
  });

  // 지킬 이름(실물 프로젝트)은 공개 레포에 적지 않는다 — 비공개 기록층의 목록을 읽고, 없으면 건너뛴다.
  const privateNames = (() => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../workspace/records/private-names.txt");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : [];
  })();
  it.skipIf(privateNames.length === 0)("예시는 가상 에이전트다 — 수락 시험 대상을 끌어오지 않는다", () => {
    const text = JSON.stringify(IR_CELL_GUIDES).toLowerCase();
    for (const name of privateNames) expect(text.includes(name.toLowerCase()), name).toBe(false);
  });
});
