import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendThreadMessage,
  ensureStudioInitialized,
  inferredSchema,
  parseIr,
  projectRunsDir,
  projectStudioDir,
  readIrFile,
  registerProject,
  setOverlayIr,
  writeInferred,
  writeOverlayIfAbsent,
  writeProgressEntry,
} from "@patchbay/core";
import { afterEach, describe, expect, it } from "vitest";
import { createFlowApp, type FlowApp } from "./server.js";
import { DISCONNECTED_ADAPTERS } from "./shell.js";
import { createMemoryNeo4jPort } from "./neo4jAdapter.js";

function tmpStudioHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-flow-app-"));
}

describe("GET /api/shell", () => {
  it("returns disconnected adapters and a null selection when nothing is registered", async () => {
    const studioHome = tmpStudioHome();
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/shell");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: unknown[];
      selected: string | null;
      adapters: unknown;
    };
    expect(body.projects).toEqual([]);
    expect(body.selected).toBeNull();
    expect(body.adapters).toEqual(DISCONNECTED_ADAPTERS);
  });

  it("lists registered projects and honors the preferred alias", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "alpha", kind: "local_repo", path: "/tmp/a" });
    await registerProject(studioHome, { alias: "zeta", kind: "local_repo", path: "/tmp/z" });

    const app = createFlowApp({ studioHome, project: "zeta" });
    const res = await app.request("/api/shell");
    const body = (await res.json()) as { selected: string; projects: Array<{ alias: string }> };
    expect(body.selected).toBe("zeta");
    expect(body.projects.map((p) => p.alias)).toEqual(["alpha", "zeta"]);
  });
});

describe("GET /api/workspace", () => {
  it("lists registered projects with stage status", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/workspace");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: Array<{ alias: string; current: string }> };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({ alias: "demo", current: "dashboard" });
  });
});

describe("POST /api/project", () => {
  it("registers a folder and returns the alias", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-post-repo-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# x\n");
    await ensureStudioInitialized(studioHome);
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: repo, alias: "added", forceAdd: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alias: string };
    expect(body.alias).toBe("added");
  });

  it("returns 400 without a path", async () => {
    const app = createFlowApp({ studioHome: tmpStudioHome() });
    const res = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/build", () => {
  it("채택 전에는 잠겼다고 답한다 — 오류가 아니다", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/build?alias=demo");
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "locked" });
  });

  it("alias가 없으면 400", async () => {
    const app = createFlowApp({ studioHome: tmpStudioHome() });
    expect((await app.request("/api/build")).status).toBe(400);
  });
});

describe("POST /api/build/generate", () => {
  it("채택되지 않은 프로젝트는 409", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/build/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { ok: boolean }).toMatchObject({ ok: false });
  });
});

describe("쓰기 보호", () => {
  it("다른 출처가 text/plain 으로 보낸 쓰기는 403이고 아무것도 쓰지 않는다", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-guard-repo-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    const app = createFlowApp({ studioHome });

    const res = await app.request("/api/project/scan", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: JSON.stringify({ alias: "demo" }),
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(projectStudioDir(studioHome, "demo"), "inferred.json"))).toBe(false);
  });

  it("다른 출처는 JSON 이어도 403, 같은 호스트는 통과", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const app = createFlowApp({ studioHome });
    const send = (origin: string) =>
      app.request("http://127.0.0.1:4317/api/project/scan", {
        method: "POST",
        headers: { "content-type": "application/json", origin, host: "127.0.0.1:4317" },
        body: JSON.stringify({ alias: "nope" }),
      });
    expect((await send("https://evil.example")).status).toBe(403);
    expect((await send("http://127.0.0.1:4317")).status).toBe(404);
  });
});

describe("POST /api/project/scan", () => {
  const post = (app: FlowApp, alias: string) =>
    app.request("/api/project/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias }),
    });

  it("등록된 프로젝트를 스캔하고, 다시 누르면 앞 잭 수를 같이 돌려준다 — overlay 는 그대로", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scan-repo-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    await writeOverlayIfAbsent(studioHome, "demo");
    const overlayFile = path.join(projectStudioDir(studioHome, "demo"), "overlay.yaml");
    fs.appendFileSync(overlayFile, "# 사람이 쓴 줄\n");
    const app = createFlowApp({ studioHome });

    const first = await post(app, "demo");
    expect(first.status).toBe(200);
    const one = (await first.json()) as { ports: number; portsBefore: number | null };
    expect(one.portsBefore).toBeNull();
    expect(one.ports).toBeGreaterThan(0);
    const project = await app.request("/api/project?alias=demo");
    expect(((await project.json()) as { status: string }).status).not.toBe("unscanned");

    fs.writeFileSync(path.join(repo, "notes.md"), "more\n");
    const two = (await (await post(app, "demo")).json()) as { ports: number; portsBefore: number | null };
    expect(two.portsBefore).toBe(one.ports);
    expect(fs.readFileSync(overlayFile, "utf8")).toContain("# 사람이 쓴 줄");
  });

  it("스캔 결과 파일이 깨졌으면 500이 아니라 「깨졌다」고 답하고, 다시 스캔하면 새로 쓴다", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-scan-repo-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    await writeOverlayIfAbsent(studioHome, "demo");
    fs.writeFileSync(path.join(projectStudioDir(studioHome, "demo"), "inferred.json"), "{ not json", "utf8");
    const app = createFlowApp({ studioHome });

    const view = await app.request("/api/project?alias=demo");
    expect(view.status).toBe(200);
    expect((await view.json()) as { status: string; broken?: string }).toMatchObject({ status: "unscanned", broken: expect.any(String) });

    const res = await post(app, "demo");
    expect(res.status).toBe(200);
    expect((await res.json()) as { previousBroken: boolean; portsBefore: number | null }).toMatchObject({
      previousBroken: true,
      portsBefore: null,
    });
    const after = await app.request("/api/project?alias=demo");
    expect(((await after.json()) as { status: string }).status).toBe("ok");
  });

  it("모르는 이름은 404", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const res = await post(createFlowApp({ studioHome }), "nope");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/runs/draft-evals", () => {
  const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "core", "src");
  const post = (app: FlowApp) =>
    app.request("/api/runs/draft-evals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo" }),
    });

  it("실패 기록을 초안에 넣고 승인본은 그대로 · 두 번째는 409", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    const read = await readIrFile(path.join(FIXTURES, "ir", "__fixtures__", "valid.ir.yaml"));
    if (!read.ok) throw new Error(read.error);
    const parsed = parseIr(read.raw);
    if (!parsed.ok) throw new Error(parsed.error);
    await setOverlayIr(studioHome, "demo", parsed.ir);
    const runs = projectRunsDir(studioHome, "demo");
    fs.mkdirSync(runs, { recursive: true });
    for (const name of ["success", "refused", "timeout"]) {
      fs.copyFileSync(path.join(FIXTURES, "runs", "__fixtures__", `${name}.json`), path.join(runs, `${name}.json`));
    }
    const overlayFile = path.join(projectStudioDir(studioHome, "demo"), "overlay.yaml");
    const approved = fs.readFileSync(overlayFile, "utf8");
    const app = createFlowApp({ studioHome });

    const first = await post(app);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { added: string[] }).added).toEqual(["E7", "E8"]);
    expect(fs.readFileSync(overlayFile, "utf8")).toBe(approved);
    expect((await post(app)).status).toBe(409);
  });

  it("설계가 없으면 409", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    expect((await post(createFlowApp({ studioHome }))).status).toBe(409);
  });
});

describe("GET /api/project", () => {
  it("returns 400 without alias", async () => {
    const app = createFlowApp({ studioHome: tmpStudioHome() });
    const res = await app.request("/api/project");
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown alias", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/project?alias=nope");
    expect(res.status).toBe(404);
  });
});

async function readSseUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (state: { events: Array<{ event: string; alias: string }>; comments: string[] }) => boolean,
  timeoutMs = 8000,
): Promise<{ events: Array<{ event: string; alias: string }>; comments: string[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Array<{ event: string; alias: string }> = [];
  const comments: string[] = [];
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline && !predicate({ events, comments })) {
      const remaining = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<undefined>((resolve) => {
          setTimeout(resolve, remaining);
        }),
      ]);
      if (!chunk || chunk.done) break;
      if (!chunk.value) continue;
      buf += decoder.decode(chunk.value, { stream: true });
      buf = buf.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      for (;;) {
        const sep = buf.indexOf("\n\n");
        if (sep < 0) break;
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let eventName: string | undefined;
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) comments.push(line.slice(1).trim());
          else if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (eventName) {
          const payload = JSON.parse(dataLines.join("\n")) as { alias: string };
          events.push({ event: eventName, alias: payload.alias });
        }
      }
    }
    if (!predicate({ events, comments })) {
      throw new Error(`SSE timeout; events=${JSON.stringify(events)} comments=${JSON.stringify(comments)}`);
    }
    return { events, comments };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

describe("GET /api/events", () => {
  let app: FlowApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("streams text/event-stream and a keepalive comment, not a fifth event name", async () => {
    app = createFlowApp({ studioHome: tmpStudioHome() });
    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const body = res.body;
    expect(body).toBeTruthy();
    const { comments, events } = await readSseUntil(body!, (state) => state.comments.includes("keepalive"), 2000);
    expect(events).toEqual([]);
    expect(comments).toContain("keepalive");
  }, 10_000);

  it("pushes a progress event after writeProgressEntry", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });

    app = createFlowApp({ studioHome, watch: true });
    await app.watchReady;

    const res = await app.request("/api/events");
    expect(res.body).toBeTruthy();
    const pending = readSseUntil(res.body!, (state) =>
      state.events.some((event) => event.event === "progress" && event.alias === "demo"),
    );
    await writeProgressEntry(studioHome, "demo", { summary: "live progress from another writer" });
    const { events } = await pending;
    expect(events).toContainEqual({ event: "progress", alias: "demo" });
  }, 15_000);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockLangGraphFetch(): typeof fetch {
  return (async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname === "/assistants/search") {
      return jsonResponse([{ assistant_id: "agent", name: "agent", graph_id: "agent" }]);
    }
    if (url.pathname === "/assistants/agent/graph") {
      return jsonResponse({
        nodes: [{ id: "draft" }],
        edges: [{ source: "__start__", target: "draft" }],
      });
    }
    if (url.pathname === "/threads/search") {
      return jsonResponse([{ thread_id: "t1", updated_at: "2026-09-18T00:00:00Z" }]);
    }
    if (url.pathname === "/threads/t1/state") {
      return jsonResponse({
        values: { original: "원문", summary: "정리" },
        next: ["draft"],
        checkpoint: { checkpoint_id: "ckpt-1" },
      });
    }
    if (url.pathname === "/threads/t1/runs" && method === "GET") {
      return jsonResponse([{ status: "success" }]);
    }
    if (url.pathname === "/threads" && method === "POST") {
      return jsonResponse({ thread_id: "t-new" });
    }
    if (url.pathname.endsWith("/runs/wait")) {
      return jsonResponse({});
    }
    return jsonResponse({ detail: url.pathname }, 404);
  }) as typeof fetch;
}

describe("GET /api/flow", () => {
  it("returns disconnected without probing when langgraph is omitted, and is not the scan graph", async () => {
    const app = createFlowApp({ studioHome: tmpStudioHome() });
    const flow = await app.request("/api/flow");
    expect(flow.status).toBe(200);
    expect(await flow.json()).toEqual({ status: "disconnected", url: "http://127.0.0.1:2024" });

    const graph = await app.request("/api/graph");
    expect(graph.status).toBe(400);
    const graphBody = (await graph.json()) as { error: string };
    expect(graphBody.error).toMatch(/No project registered|registered/i);
  });

  it("returns a connected LangGraph view when the sidecar fetch succeeds", async () => {
    const app = createFlowApp({
      studioHome: tmpStudioHome(),
      langgraph: { url: "http://langgraph.test", fetch: mockLangGraphFetch() },
    });
    const shell = await app.request("/api/shell");
    const shellBody = (await shell.json()) as { adapters: { langgraph: string } };
    expect(shellBody.adapters.langgraph).toBe("connected");

    const flow = await app.request("/api/flow");
    const body = (await flow.json()) as {
      status: string;
      original: string;
      currentNodes: string[];
      empty: string;
    };
    expect(body.status).toBe("connected");
    expect(body.original).toBe("원문");
    expect(body.currentNodes).toEqual(["draft"]);
    expect(body.empty).toBe("none");
  });
});

describe("POST /api/flow/runs", () => {
  it("returns 503 when LangGraph is not attached", async () => {
    const app = createFlowApp({ studioHome: tmpStudioHome() });
    const res = await app.request("/api/flow/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistantId: "agent" }),
    });
    expect(res.status).toBe(503);
  });

  it("delegates a run to LangGraph and returns the flow view", async () => {
    const app = createFlowApp({
      studioHome: tmpStudioHome(),
      langgraph: { url: "http://langgraph.test", fetch: mockLangGraphFetch() },
    });
    const res = await app.request("/api/flow/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistantId: "agent", input: { q: 1 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; selectedThreadId: string };
    expect(body.status).toBe("connected");
    expect(body.selectedThreadId).toBe("t-new");
  });
});

describe("GET /api/knowledge", () => {
  it("returns disconnected without probing when neo4j is omitted", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const app = createFlowApp({ studioHome });
    const res = await app.request("/api/knowledge?alias=demo");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "disconnected",
      uri: "bolt://127.0.0.1:7687",
      alias: "demo",
    });
  });

  it("returns 400 without alias", async () => {
    const app = createFlowApp({ studioHome: tmpStudioHome(), neo4j: { port: createMemoryNeo4jPort() } });
    const res = await app.request("/api/knowledge");
    expect(res.status).toBe(400);
  });

  it("ingests inferred into the replica and searches by path", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    await writeOverlayIfAbsent(studioHome, "demo");
    await writeInferred(studioHome, "demo", inferredSchema.parse({
      discoveredPorts: ["source:README.md", "skill:map-project"],
      git: { branch: "main", head: "abc", recentCommitSubjects: [] },
      agents: [],
    }));

    const app = createFlowApp({ studioHome, neo4j: { port: createMemoryNeo4jPort() } });
    const shell = await app.request("/api/shell");
    const shellBody = (await shell.json()) as { adapters: { neo4j: string } };
    expect(shellBody.adapters.neo4j).toBe("connected");

    const res = await app.request("/api/knowledge?alias=demo&q=README");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; hits: Array<{ path: string }> };
    expect(body.status).toBe("connected");
    expect(body.hits.map((hit) => hit.path)).toEqual(["README.md"]);
  });
});

describe("GET /api/board", () => {
  it("returns 400 without alias and 404 for an unknown project", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    const app = createFlowApp({ studioHome });
    expect((await app.request("/api/board")).status).toBe(400);
    expect((await app.request("/api/board?alias=nope")).status).toBe(404);
  });

  it("places langgraph and neo4j items, links them, and remove drops the link", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const app = createFlowApp({ studioHome });

    const empty = await app.request("/api/board?alias=demo");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ alias: "demo", items: [], links: [] });

    const lang = await app.request("/api/board/place", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "demo",
        id: "langgraph:flow:draft",
        kind: "langgraph",
        ref: "flow:draft",
        title: "draft",
      }),
    });
    expect(lang.status).toBe(200);
    expect(await lang.json()).toMatchObject({ placed: true, items: [{ id: "langgraph:flow:draft", x: 0, y: 0 }] });

    const file = await app.request("/api/board/place", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "demo",
        id: "neo4j:file:README.md",
        kind: "neo4j",
        ref: "README.md",
        title: "README",
      }),
    });
    expect(file.status).toBe(200);
    const fileBody = (await file.json()) as { items: Array<{ id: string; x: number }> };
    expect(fileBody.items.map((item) => item.id)).toEqual(["langgraph:flow:draft", "neo4j:file:README.md"]);
    expect(fileBody.items[1]?.x).toBe(220);

    const linked = await app.request("/api/board/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "demo",
        from: "langgraph:flow:draft",
        to: "neo4j:file:README.md",
      }),
    });
    expect(linked.status).toBe(200);

    const moved = await app.request("/api/board/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", id: "neo4j:file:README.md", x: 40.4, y: 80.4 }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ item: { x: 40, y: 80 } });

    const removed = await app.request("/api/board/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", id: "langgraph:flow:draft" }),
    });
    const removedBody = (await removed.json()) as { items: Array<{ id: string }>; links: unknown[] };
    expect(removedBody.items.map((item) => item.id)).toEqual(["neo4j:file:README.md"]);
    expect(removedBody.links).toEqual([]);
  });
});

describe("POST /api/skill/drafts", () => {
  it("harvests the board into a proposed SKILL.md and accept confirms it", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/a" });
    const app = createFlowApp({ studioHome });
    expect((await app.request("/api/skill/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo" }) })).status).toBe(400);

    const placed = await app.request("/api/board/place", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "demo",
        id: "langgraph:flow:draft",
        kind: "langgraph",
        ref: "flow:draft",
        title: "draft",
      }),
    });
    expect(placed.status).toBe(200);

    const draft = await app.request("/api/skill/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo" }),
    });
    expect(draft.status).toBe(200);
    const draftBody = (await draft.json()) as { slug: string; path: string };
    expect(draftBody.slug).toBe("from-demo");
    expect(draftBody.path).toContain("from-demo.proposed");

    const accepted = await app.request("/api/skill/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "from-demo" }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ slug: "from-demo" });
  });
});

describe("GET/PUT /api/source", () => {
  it("reads and writes a file inside the registered project, and rejects escape", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-source-repo-"));
    fs.writeFileSync(path.join(repo, "README.md"), "# peek\n");
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    const app = createFlowApp({ studioHome });

    const missing = await app.request("/api/source?alias=demo&path=nope.md");
    expect(missing.status).toBe(404);

    const escaped = await app.request("/api/source?alias=demo&path=../README.md");
    expect(escaped.status).toBe(400);

    const read = await app.request("/api/source?alias=demo&path=README.md");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ alias: "demo", path: "README.md", content: "# peek\n" });

    const saved = await app.request("/api/source", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", path: "README.md", content: "# saved\n" }),
    });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(repo, "README.md"), "utf8")).toBe("# saved\n");
  });
});

describe("PUT /api/project/process", () => {
  it("stores the installer process on overlay.yaml", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-process-api-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    const app = createFlowApp({ studioHome });

    const missing = await app.request("/api/project/process", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", goal: "출시", folders: [], steps: [{ label: "하나" }] }),
    });
    expect(missing.status).toBe(400);

    const saved = await app.request("/api/project/process", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "demo",
        goal: "빠른 출시",
        folders: ["docs/기획"],
        steps: [{ label: "오답 접수" }, { label: "진단" }],
      }),
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { process: { configured: boolean; goal: string } };
    expect(body.process.configured).toBe(true);
    expect(body.process.goal).toBe("빠른 출시");
  });
});

describe("POST /api/project/process/host", () => {
  it("writes briefing files without spawning a real host", async () => {
    const studioHome = tmpStudioHome();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-host-api-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
    await writeOverlayIfAbsent(studioHome, "demo");
    const app = createFlowApp({ studioHome, hostSpawner: async () => undefined });

    const opened = await app.request("/api/project/process/host", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "demo", stepId: "plan-goal", host: "cursor", note: "출시" }),
    });
    expect(opened.status).toBe(200);
    const body = (await opened.json()) as { briefRel: string; resumed: boolean };
    expect(body.briefRel).toBe("docs/기획/브리핑.md");
    expect(body.resumed).toBe(false);
    expect(fs.existsSync(path.join(repo, "docs/기획/브리핑.md"))).toBe(true);
  });
});

describe("대화 라우트 (thread_id)", () => {
  const post = (app: FlowApp, url: string, body: unknown) =>
    app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function seeded() {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await appendThreadMessage(studioHome, "demo", "th-1", { role: "user", text: "Q3 오답" });
    await appendThreadMessage(studioHome, "demo", "th-1", { role: "graph", status: "success", assistantId: "a", text: "이유" });
    return createFlowApp({ studioHome });
  }

  it("목록 · 한 대화 · 없는 대화", async () => {
    const app = await seeded();
    const list = (await (await app.request("/api/threads?alias=demo")).json()) as { threads: Array<{ status: string }>; pending: number };
    expect(list).toMatchObject({ pending: 0, threads: [expect.objectContaining({ threadId: "th-1", status: "done" })] });
    const one = (await (await app.request("/api/thread?alias=demo&id=th-1")).json()) as { messages: unknown[] };
    expect(one.messages).toHaveLength(2);
    expect((await app.request("/api/thread?alias=demo&id=nope")).status).toBe(404);
    expect((await app.request("/api/thread?alias=demo&id=..")).status).toBe(400);
  });

  it("👍 · 👎는 그래프 · 호스트 메시지에만 붙는다", async () => {
    const app = await seeded();
    expect((await post(app, "/api/thread/feedback", { alias: "demo", threadId: "th-1", target: 0, value: "down" })).status).toBe(400);
    const ok = await post(app, "/api/thread/feedback", { alias: "demo", threadId: "th-1", target: 1, value: "down", note: "단서 없음" });
    expect(ok.status).toBe(200);
  });

  it("LangGraph가 없으면 보내기는 503 — 아무것도 쓰지 않는다", async () => {
    const app = await seeded();
    const res = await post(app, "/api/thread/send", { alias: "demo", assistantId: "a", text: "또" });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/project/hidden", () => {
  it("숨기면 작업 공간에 hidden 이 실리고, 다시 보이면 빠진다", async () => {
    const studioHome = tmpStudioHome();
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });
    const app = createFlowApp({ studioHome });
    const post = (body: unknown) =>
      app.request("/api/project/hidden", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ alias: "demo", hidden: true })).status).toBe(200);
    let ws = (await (await app.request("/api/workspace")).json()) as { projects: Array<{ hidden?: boolean }> };
    expect(ws.projects[0]?.hidden).toBe(true);
    await post({ alias: "demo", hidden: false });
    ws = (await (await app.request("/api/workspace")).json()) as { projects: Array<{ hidden?: boolean }> };
    expect(ws.projects[0]?.hidden).toBeUndefined();
    expect((await post({ alias: "nope", hidden: true })).status).toBe(404);
  });
});
