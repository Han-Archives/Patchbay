import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject, writeRoomMeta } from "@patchbay/core";
import { describe, expect, it, vi } from "vitest";
import { createFlowApp, type ServerRestart } from "./server.js";
import type { RoomRunner } from "./roomHost.js";

async function setup() {
  const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-restart-"));
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-restart-repo-"));
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: projectPath });
  return studioHome;
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("서버 다시 켜기", () => {
  it("연결이 없으면 501, 빌드가 실패하면 끄지 않고, 성공하면 202 뒤에 교대한다", async () => {
    const studioHome = await setup();
    const bare = createFlowApp({ studioHome });
    expect((await (await bare.request("/api/server")).json()).canRestart).toBe(false);
    expect((await bare.request("/api/server/restart", post({}))).status).toBe(501);
    await bare.close();

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const restart: ServerRestart = { build: vi.fn(async () => ({ ok: false, output: "error TS2322" })), restart: vi.fn() };
      const app = createFlowApp({ studioHome, serverRestart: restart });
      const failed = await app.request("/api/server/restart", post({ build: true }));
      expect(failed.status).toBe(500);
      expect((await failed.json()).output).toContain("TS2322");
      vi.runAllTimers();
      expect(restart.restart).not.toHaveBeenCalled();

      vi.mocked(restart.build).mockResolvedValue({ ok: true, output: "" });
      const ok = await app.request("/api/server/restart", post({ build: true }));
      expect(ok.status).toBe(202);
      expect((await app.request("/api/server/restart", post({}))).status).toBe(409);
      vi.runAllTimers();
      expect(restart.restart).toHaveBeenCalledTimes(1);
      await app.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("LLM이 일하는 중이면 거절하고 어느 프로젝트인지 알린다", async () => {
    const studioHome = await setup();
    let release!: () => void;
    const runner: RoomRunner = () => new Promise(resolve => { release = () => resolve({ ok: true, text: "끝", ms: 1 }); });
    const restart: ServerRestart = { build: vi.fn(async () => ({ ok: true, output: "" })), restart: vi.fn() };
    const app = createFlowApp({ studioHome, serverRestart: restart, roomRunner: runner, roomBin: "mock" });
    const roomId = "2026-10-26-aaaaaaaa";
    await writeRoomMeta(studioHome, "demo", roomId, { title: null, kept: false, members: [{ id: "m", speaker: "claude-code", model: "", role: "이끈다.", enabled: true }] });
    const sent = await app.request("/api/room/send", post({ alias: "demo", roomId, text: "일해", round: "talk" }));
    expect(sent.status).toBe(202);
    const busy = await app.request("/api/server/restart", post({ build: true }));
    expect(busy.status).toBe(409);
    expect((await busy.json()).aliases).toEqual(["demo"]);
    expect(restart.build).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await app.close();
  });
});
