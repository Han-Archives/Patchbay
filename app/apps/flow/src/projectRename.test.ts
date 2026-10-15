import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlowApp, type FlowApp } from "./server.js";

const { running } = vi.hoisted(() => ({ running: [] as string[] }));
vi.mock("./roomHost.js", async importOriginal => ({ ...await importOriginal<typeof import("./roomHost.js")>(), runningRoomAliases: () => running }));

describe("POST /api/project/name", () => {
  let base: string;
  let home: string;
  let repo: string;
  let app: FlowApp;
  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pb-rename-api-")));
    home = path.join(base, "home"); repo = path.join(base, "original");
    await fs.mkdir(repo);
    await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
    app = createFlowApp({ studioHome: home });
  });
  afterEach(async () => { running.length = 0; vi.restoreAllMocks(); await app.close(); await fs.rm(base, { recursive: true, force: true }); });
  const request = (name: string, headers = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ alias: "demo", name }) });

  it("renames the folder and exposes the new name/path in shell and workspace", async () => {
    const response = await app.request("/api/project/name", request("New Project"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alias: "demo", name: "New Project", path: path.join(base, "New Project") });
    const workspace = await (await app.request("/api/workspace")).json();
    expect(workspace.projects[0]).toMatchObject({ alias: "demo", name: "New Project", path: path.join(base, "New Project") });
    expect((await (await app.request("/api/shell")).json()).projects[0].name).toBe("New Project");
  });

  it("enforces read-only access and cross-origin write protection", async () => {
    await app.close();
    app = createFlowApp({ studioHome: home, access: { token: "write", readToken: "read" } });
    expect((await app.request("/api/project/name", request("next", { authorization: "Bearer read" }))).status).toBe(403);
    expect((await app.request("/api/project/name", request("next", { authorization: "Bearer write", origin: "https://elsewhere.invalid" }))).status).toBe(403);
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
  });

  it("returns errors for invalid names, collisions and running work without moving the folder", async () => {
    expect((await app.request("/api/project/name", request("../escape"))).status).toBe(400);
    await fs.mkdir(path.join(base, "existing"));
    expect((await app.request("/api/project/name", request("existing"))).status).toBe(409);
    running.push("demo");
    expect((await app.request("/api/project/name", request("next"))).status).toBe(409);
    expect((await fs.stat(repo)).isDirectory()).toBe(true);
  });

  it("blocks new writes while a folder move is in progress", async () => {
    const originalRename = fs.rename.bind(fs);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === repo) { enter(); await waiting; }
      return originalRename(from, to);
    });
    const first = app.request("/api/project/name", request("next"));
    try {
      await entered;
      const second = await app.request("/api/todos/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", action: "sync", suggestions: [] }) });
      expect(second.status).toBe(409);
      expect((await app.request("/api/session")).status).toBe(200);
    } finally { release(); }
    expect((await first).status).toBe(200);
  });
});
