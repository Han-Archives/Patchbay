import { describe, expect, it } from "vitest";
import { createLangGraphHttpPort } from "./langgraphAdapter.js";

const BASE = "http://langgraph.test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: URL, method: string, body: unknown) => Response | Promise<Response>): typeof fetch {
  return (async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : null;
    const body = raw ? (JSON.parse(raw) as unknown) : undefined;
    return handler(url, method, body);
  }) as typeof fetch;
}

describe("createLangGraphHttpPort", () => {
  it("probes POST /assistants/search and treats non-2xx as disconnected", async () => {
    const connected = createLangGraphHttpPort({
      url: BASE,
      fetch: mockFetch((url, method) => {
        expect(method).toBe("POST");
        expect(url.pathname).toBe("/assistants/search");
        return jsonResponse([]);
      }),
    });
    expect(await connected.probe()).toBe(true);

    const down = createLangGraphHttpPort({
      url: BASE,
      fetch: mockFetch(() => jsonResponse({ detail: "nope" }, 500)),
    });
    expect(await down.probe()).toBe(false);
  });

  it("does not hang the shell when the sidecar ignores the request", async () => {
    const port = createLangGraphHttpPort({
      url: BASE,
      timeoutMs: 40,
      fetch: ((_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
          });
        })) as typeof fetch,
    });
    const started = Date.now();
    expect(await port.probe()).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("lists assistants, graphs, threads, state, and runs over the SDK HTTP paths", async () => {
    const port = createLangGraphHttpPort({
      url: BASE,
      fetch: mockFetch((url, method) => {
        if (url.pathname === "/assistants/search") {
          return jsonResponse([{ assistant_id: "agent", name: "Agent", graph_id: "agent" }]);
        }
        if (url.pathname === "/assistants/agent/graph") {
          return jsonResponse({
            nodes: [{ id: "draft" }],
            edges: [{ source: "__start__", target: "draft" }],
          });
        }
        if (url.pathname === "/threads/search") {
          expect(method).toBe("POST");
          return jsonResponse([{ thread_id: "t1", updated_at: "2026-09-18T00:00:00Z" }]);
        }
        if (url.pathname === "/threads/t1/state") {
          return jsonResponse({ next: ["draft"], values: { original: "원문" } });
        }
        if (url.pathname === "/threads/t1/runs") {
          expect(method).toBe("GET");
          return jsonResponse([{ status: "success" }]);
        }
        return jsonResponse({ detail: url.pathname }, 404);
      }),
    });

    expect(await port.listAssistants()).toEqual([{ id: "agent", name: "Agent", graphId: "agent" }]);
    expect(await port.getGraph("agent")).toEqual({
      nodes: [{ id: "draft" }],
      edges: [{ source: "__start__", target: "draft" }],
    });
    expect(await port.listThreads()).toEqual([{ id: "t1", updatedAt: "2026-09-18T00:00:00Z" }]);
    expect(await port.getState("t1")).toEqual({ next: ["draft"], values: { original: "원문" } });
    expect(await port.listRuns("t1")).toEqual([{ status: "success" }]);
  });

  it("creates a thread and waits on POST .../runs/wait", async () => {
    const port = createLangGraphHttpPort({
      url: BASE,
      fetch: mockFetch((url, method, body) => {
        if (url.pathname === "/threads" && method === "POST") {
          return jsonResponse({ thread_id: "t-new" });
        }
        if (url.pathname === "/threads/t-new/runs/wait") {
          expect(body).toEqual({ assistant_id: "agent", input: { q: 1 } });
          return jsonResponse({ messages: [] });
        }
        return jsonResponse({ detail: url.pathname }, 404);
      }),
    });
    expect(await port.createThread("agent")).toBe("t-new");
    expect(await port.waitRun({ threadId: "t-new", assistantId: "agent", input: { q: 1 } })).toEqual({
      status: "ok",
      body: { messages: [] },
    });
  });

  it("maps a wait __error__ body to status error", async () => {
    const port = createLangGraphHttpPort({
      url: BASE,
      fetch: mockFetch(() =>
        jsonResponse({ __error__: { error: "ValueError", message: "bad node" } }, 200),
      ),
    });
    expect(await port.waitRun({ threadId: "t1", assistantId: "agent", input: {} })).toEqual({
      status: "error",
      error: "ValueError: bad node",
    });
  });

  it("falls back to POST .../runs when wait is 404", async () => {
    const port = createLangGraphHttpPort({
      url: BASE,
      fetch: mockFetch((url) => {
        if (url.pathname.endsWith("/runs/wait")) return jsonResponse({ detail: "no wait" }, 404);
        if (url.pathname.endsWith("/runs")) return jsonResponse({ run_id: "r1", status: "pending" });
        return jsonResponse({}, 404);
      }),
    });
    expect(await port.waitRun({ threadId: "t1", assistantId: "agent", input: {} })).toEqual({
      status: "ok",
      body: { run_id: "r1", status: "pending" },
    });
  });
});
