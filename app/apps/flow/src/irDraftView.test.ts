import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PROPOSED_IR_FILE_NAME,
  ensureStudioInitialized,
  projectStudioDir,
  registerProject,
  writeOverlayIfAbsent,
} from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { loadIrView, startDraftView } from "./irView.js";

/**
 * 1단계를 **인터페이스에서 시작**하는 길.
 *
 * 화면이 완성된 IR만 읽을 수 있으면 1단계 내내 쓸모가 없다 — 열 칸을 채우는 동안
 * 초안은 언제나 불완전하다. 그래서 「못 읽었다」가 아니라 「어디까지 왔나」가 나와야 한다.
 */
async function studio(alias = "demo"): Promise<string> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-irdraft-"));
  await ensureStudioInitialized(home);
  await registerProject(home, { alias, kind: "local_repo", path: "/tmp/a" });
  await writeOverlayIfAbsent(home, alias);
  return home;
}

const draftPath = (home: string, alias = "demo") =>
  path.join(projectStudioDir(home, alias), PROPOSED_IR_FILE_NAME);

describe("1단계 시작", () => {
  it("설계가 없으면 여기서 시작할 수 있다고 말한다 — 터미널로 내보내지 않는다", async () => {
    const home = await studio();
    const result = await loadIrView(home, "demo");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.body.status).toBe("missing");
    if (result.body.status !== "missing") throw new Error("expected missing");
    expect(result.body.canStart).toBe(true);
  });

  it("시작하면 골격이 생기고, 화면이 0.0과 아홉 칸을 빈 채로 받는다", async () => {
    const home = await studio();
    const started = await startDraftView(home, { alias: "demo" });
    expect(started.ok).toBe(true);
    expect(fs.existsSync(draftPath(home))).toBe(true);

    const result = await loadIrView(home, "demo");
    if (!result.ok || result.body.status !== "drafting") throw new Error("expected drafting");
    expect(result.body.progress.total).toBe(10);
    expect(result.body.progress.answered).toBe(0);
    // 무엇을 채우면 되는지 키 이름으로 말한다 — 이게 없으면 화면이 할 말이 없다.
    expect(result.body.progress.cells.find((cell) => cell.id === "1.1")?.missing).toEqual(["goal", "done"]);
    expect(result.body.file).toBe(draftPath(home));
  });

  it("칸을 채우면 진행이 오르고, `[]` 는 「아직」과 다르게 센다", async () => {
    const home = await studio();
    await startDraftView(home, { alias: "demo" });
    const file = draftPath(home);
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace("goal: \n", "goal: 오답 하나에 조각 하나\n")
        .replace("done:\n", "done:\n  - 조각 경로가 존재하는 파일이다\n")
        .replace("tools:\n", "tools: []\n"),
      "utf8",
    );

    const result = await loadIrView(home, "demo");
    if (!result.ok || result.body.status !== "drafting") throw new Error("expected drafting");
    const cells = result.body.progress.cells;
    // 1.1은 내용으로, 1.2는 「없음」으로 — 둘 다 답한 칸이다.
    expect(result.body.progress.answered).toBe(2);
    expect(cells.find((cell) => cell.id === "1.1")?.fill).toBe("filled");
    // 「없는 것이 답이다」와 「아직 안 썼다」는 다른 사실이다 (명세 §5.2와 같은 축).
    expect(cells.find((cell) => cell.id === "1.2")?.fill).toBe("declared");
    expect(cells.find((cell) => cell.id === "1.3")?.fill).toBe("empty");
  });

  /** 초안은 사람과 호스트 모델의 저작물이다 — 버튼이 그것을 지울 수 있으면 안 된다. */
  it("있는 초안을 덮지 않고 409로 거절한다", async () => {
    const home = await studio();
    await startDraftView(home, { alias: "demo" });
    fs.writeFileSync(draftPath(home), "# 사람이 쓰던 것\n", "utf8");

    const again = await startDraftView(home, { alias: "demo" });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("덮으면 안 된다");
    expect(again.status).toBe(409);
    expect(fs.readFileSync(draftPath(home), "utf8")).toBe("# 사람이 쓰던 것\n");
  });

  it("alias 가 없거나 등록되지 않았으면 만들지 않는다", async () => {
    const home = await studio();
    const noAlias = await startDraftView(home, {});
    expect(noAlias.ok).toBe(false);
    if (!noAlias.ok) expect(noAlias.status).toBe(400);
    const unknown = await startDraftView(home, { alias: "nope" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.status).toBe(404);
  });
});
