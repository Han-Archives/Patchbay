import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { beforeEach, describe, expect, it } from "vitest";
import { parseIr } from "../types/ir.js";
import { draftProgress, renderIrSkeleton } from "./draft.js";
import { startIrDraft } from "../studio/irStore.js";
import { PROPOSED_IR_FILE_NAME } from "../studio/irStore.js";
import { projectStudioDir } from "../studio/studioStore.js";

/**
 * 1단계를 **시작하는** 자리의 시험.
 *
 * 설계 화면이 완성된 IR만 읽을 수 있으면 1단계 내내 쓸모가 없다 — 열 칸을 채우는
 * 동안 초안은 언제나 불완전하다. 그래서 「골격은 파싱되지 않는다」와 「그래도 칸별
 * 상태는 읽힌다」가 같이 성립해야 한다.
 */

describe("빈 골격", () => {
  it("0.0 온톨로지와 아홉 칸을 다 적고, 값은 하나도 지어내지 않는다", () => {
    const text = renderIrSkeleton("demo", "triage");
    for (const cell of ["0.0", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"]) {
      expect(text, cell).toContain(cell);
    }
    // 1.9는 내용 칸이 아니라 검사 그 자체다.
    expect(text).not.toContain("# ── 1.9");

    const doc = parseYaml(text) as Record<string, unknown>;
    expect(doc.project).toBe("demo");
    expect(doc.graph).toBe("triage");
    expect(doc.schemaVersion).toBe(3);
    // 1단계 칸이 아닌 `graph` 는 비어도 명세 기본값 `""` 이다 — `null` 이면 다 채워도 막힌다.
    expect((parseYaml(renderIrSkeleton("demo")) as Record<string, unknown>).graph).toBe("");
    // 키는 있고 값은 없다 — 고쳐 쓸 파일이라 키가 있어야 옆에 적는다.
    // 값을 지어내면 그 순간 안 쓴 것과 쓴 것이 같아 보인다.
    for (const key of ["concepts", "why", "goal", "done", "caps", "reads", "state", "nodes", "edges", "requirements", "evals"]) {
      expect(key in doc, key).toBe(true);
      expect(doc[key], key).toBeNull();
    }
  });

  it("골격은 아직 유효한 IR이 아니다 — 통과는 다 채운 뒤다", () => {
    const parsed = parseIr(parseYaml(renderIrSkeleton("demo")));
    expect(parsed.ok).toBe(false);
  });
});

describe("칸별 진행 상태", () => {
  it("빈 골격은 열 칸이 전부 비어 있다고 말한다", () => {
    const progress = draftProgress(parseYaml(renderIrSkeleton("demo")));
    expect(progress.total).toBe(10);
    expect(progress.answered).toBe(0);
    expect(progress.cells.every((cell) => cell.fill === "empty")).toBe(true);
    // 무엇을 쓰면 되는지 키 이름으로 말한다.
    expect(progress.cells.find((cell) => cell.id === "1.1")?.missing).toEqual(["goal", "done"]);
    expect(progress.cells.find((cell) => cell.id === "1.2")?.missing).toEqual(["caps", "tools", "models"]);
  });

  /** 명세 §5.2의 「빈 배열은 값이다」와 같은 축 — 안 쓴 것과 없다고 쓴 것은 다르다. */
  it("`[]` 로 적은 칸과 아직 안 쓴 칸을 나눈다", () => {
    const declared = draftProgress({ tools: [], models: [] });
    expect(declared.cells.find((cell) => cell.id === "1.2")?.fill).toBe("declared");

    const untouched = draftProgress({});
    expect(untouched.cells.find((cell) => cell.id === "1.2")?.fill).toBe("empty");
  });

  it("한 키만 채워도 그 칸은 손댄 것으로 센다", () => {
    const progress = draftProgress({ goal: "오답 하나에 조각 하나" });
    const cell = progress.cells.find((entry) => entry.id === "1.1");
    expect(cell?.fill).toBe("filled");
    expect(cell?.missing).toEqual(["done"]);
    expect(progress.answered).toBe(1);
  });

  it("빈 문자열과 빈 객체는 채운 것이 아니다", () => {
    expect(draftProgress({ goal: "   " }).cells.find((c) => c.id === "1.1")?.fill).toBe("empty");
    expect(draftProgress({ why: { alternative: "", modelNeed: "" } }).cells.find((c) => c.id === "1.0")?.fill).toBe("empty");
  });

  it("파싱되지 않는 값에도 답한다 — 1단계 중에는 그게 정상이다", () => {
    for (const raw of [null, undefined, "글자", 42, []]) {
      const progress = draftProgress(raw);
      expect(progress.total).toBe(10);
      expect(progress.answered).toBe(0);
    }
  });

  it("다 채운 IR은 아홉 칸이 다 찬다", () => {
    const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__", "valid.ir.yaml");
    const progress = draftProgress(parseYaml(fs.readFileSync(FIXTURE, "utf8")));
    expect(progress.answered).toBe(10);
  });
});

describe("startIrDraft", () => {
  let studioHome: string;
  beforeEach(() => {
    studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-draft-"));
  });

  it("골격을 쓰고 그 파일을 알려 준다", async () => {
    const result = await startIrDraft(studioHome, "demo", { graph: "triage" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(fs.existsSync(result.file)).toBe(true);
    expect(fs.readFileSync(result.file, "utf8")).toContain("1.0 에이전트가 필요한가");
  });

  /** 초안은 사람과 호스트 모델의 저작물이다 — 「시작」이 그것을 지울 수 있으면 안 된다. */
  it("있는 초안을 덮지 않는다", async () => {
    const dir = projectStudioDir(studioHome, "demo");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, PROPOSED_IR_FILE_NAME);
    fs.writeFileSync(file, "# 사람이 쓰던 것\n", "utf8");

    const result = await startIrDraft(studioHome, "demo");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("덮으면 안 된다");
    expect(result.error).toContain("이미 초안이 있다");
    expect(fs.readFileSync(file, "utf8")).toBe("# 사람이 쓰던 것\n");
  });
});
