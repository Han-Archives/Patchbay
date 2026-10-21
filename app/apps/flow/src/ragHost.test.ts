import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureStudioInitialized, registerProject, writeAgents, readSemanticState } from "@patchbay/core";
import { createFlowApp, type FlowAppOptions } from "./server.js";
import type { RoomTurnRequest } from "./roomHost.js";
import { createMemoryNeo4jPort } from "./neo4jAdapter.js";

async function fixture(options: Partial<FlowAppOptions> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-rag-host-")), home = path.join(root, "home"), repo = path.join(root, "repo");
  await fs.mkdir(repo); await ensureStudioInitialized(home); await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
  await writeAgents(home, "demo", [{ id: "claude", speaker: "claude-code", model: "test", role: "" }, { id: "local", speaker: "local", model: "test-local", role: "" }, { id: "codex", speaker: "codex", model: "test", role: "" }]);
  await fs.writeFile(path.join(repo, "guide.md"), "# 운영\n\n운영 로그는 30일 보관한다. CANARY_LOCAL_ONLY\n");
  const app = createFlowApp({ studioHome: home, roomBin: "fake", ...options });
  const post = (action: string, body: object) => app.request("/api/rag/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", ...body }) });
  const add = () => post("source", { path: "guide.md", revision: 0 });
  const search = async () => (await post("search", { query: "로그 보관 기간" })).json();
  return { app, root, home, repo, post, add, search };
}
const good = JSON.stringify({ status: "supported", claims: [{ text: "로그는 30일 보관합니다.", citations: [{ id: "1", quote: "운영 로그는 30일 보관한다." }] }] });
describe("RAG HTTP and execution boundaries", () => {
  it("performs source → body search → explicit text-only answer → citation without a graph DB", async () => {
    let calls = 0;
    const f = await fixture({ roomRunner: async req => {
      calls++; expect(req.execution).toBe("text"); expect(req.cwd).not.toContain("repo");
      expect(await fs.readdir(req.cwd)).toEqual([]); expect(req.prompt).toContain("CANARY_LOCAL_ONLY");
      return { ok: true, text: good, ms: 50 };
    } });
    try {
      expect((await f.add()).status).toBe(200); const s = await f.search(); expect(calls).toBe(0);
      const result = await f.post("answer", { query: s.query, revision: s.revision, corpus: s.corpus, requestId: "turn1", memberId: "local" });
      expect(result.status).toBe(200); expect((await result.json()).answer.status).toBe("supported"); expect(calls).toBe(1);
      const original = await f.post("citation", { citation: s.hits[0] }); expect(original.status).toBe(200);
      expect((await original.json()).content).toContain("30일");
      expect((await readSemanticState(f.home, "demo")).evidence).toEqual([]);
      const audit = await fs.readFile(path.join(f.home, "projects/demo/knowledge/rag-deliveries.jsonl"), "utf8");
      expect(audit).toContain('"status":"complete"');
      expect(audit).not.toContain("CANARY_LOCAL_ONLY"); expect(audit).not.toContain("30일"); expect(audit).not.toContain("로그 보관 기간");
      expect((await f.app.request("/api/knowledge/documents?alias=demo&anchor=unknown")).status).toBe(200);
    } finally { await f.app.close(); }
  });
  it("never sends the local-only canary to a remote model or enables an unsupported execution path", async () => {
    let calls = 0;
    const f = await fixture({ roomRunner: async () => { calls++; return { ok: true, text: good, ms: 1 }; } });
    try {
      expect((await f.app.request("/api/rag/models?alias=demo")).status).toBe(200); expect(calls).toBe(0);
      await f.add(); const s = await f.search();
      const args = { query: s.query, revision: s.revision, corpus: s.corpus, requestId: "remote" };
      expect((await f.post("answer", { ...args, memberId: "claude" })).status).toBe(403);
      expect((await f.post("answer", { ...args, memberId: "codex" })).status).toBe(400);
      expect((await f.post("answer", { ...args, localModel: "--bad" })).status).toBe(400);
      expect((await f.post("answer", { ...args, localModel: "text-embedding-bge-m3" })).status).toBe(400);
      expect(calls).toBe(0);
      const state = await readSemanticState(f.home, "demo");
      await f.post("usage", { sourceId: state.sources[0]!.id, revision: s.revision, retrieval: true, remoteTransfer: true });
      const next = await f.search();
      expect((await f.post("answer", { ...args, revision: next.revision, corpus: next.corpus, memberId: "claude" })).status).toBe(200);
      expect(calls).toBe(1);
    } finally { await f.app.close(); }
  });
  it("rejects hallucinated citations and keeps original search available on model failure", async () => {
    const f = await fixture({ roomRunner: async () => ({ ok: true, text: good.replace('"1"', '"999"'), ms: 1 }) });
    try {
      await f.add(); const s = await f.search();
      expect((await f.post("answer", { query: s.query, revision: s.revision, corpus: s.corpus, requestId: "invalid", memberId: "local" })).status).toBe(422);
      expect((await f.search()).hits).toHaveLength(1);
    } finally { await f.app.close(); }
  });
  it.each(["stop", "edit", "revoke"])("blocks a late successful answer after %s", async action => {
    let release!: () => void, began!: () => void;
    const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { began = r; });
    let request: RoomTurnRequest | undefined;
    const f = await fixture({ roomRunner: async req => { request = req; began(); await gate; return { ok: true, text: good, ms: 1 }; } });
    try {
      await f.add(); const s = await f.search();
      const pending = f.post("answer", { query: s.query, revision: s.revision, corpus: s.corpus, requestId: "slow", memberId: "local" });
      await started;
      expect((await (await f.app.request("/api/running")).json()).aliases).toContain("demo");
      if (action === "stop") {
        await f.post("stop", { requestId: "wrong" }); expect(request!.signal!.aborted).toBe(false);
        await f.post("stop", { requestId: "slow" }); expect(request!.signal!.aborted).toBe(true);
      } else if (action === "edit") await fs.writeFile(path.join(f.repo, "guide.md"), "# 운영\n\n로그는 90일 보관한다.\n");
      else { const state = await readSemanticState(f.home, "demo"); await f.post("usage", { sourceId: state.sources[0]!.id, revision: state.seq, retrieval: false, remoteTransfer: false }); }
      release(); expect((await pending).status).toBe(409);
      expect((await (await f.app.request("/api/running")).json()).aliases).not.toContain("demo");
    } finally { release(); await f.app.close(); }
  });
  it("enforces read-only sessions at mutation and generation endpoints", async () => {
    const f = await fixture({ access: { token: "writer", readToken: "reader" } });
    try {
      expect((await f.app.request("/api/rag/sources?alias=demo", { headers: { authorization: "Bearer reader" } })).status).toBe(200);
      expect((await f.app.request("/api/rag/source", { method: "POST", headers: { authorization: "Bearer reader", "content-type": "application/json" }, body: JSON.stringify({ alias: "demo", path: "guide.md", revision: 0 }) })).status).toBe(403);
    } finally { await f.app.close(); }
  });
  it("reflects RAG source/policy events as graph no-ops without leaving a cursor gap", async () => {
    const port = createMemoryNeo4jPort(); const f = await fixture({ neo4j: { port } });
    try {
      await f.add();
      await vi.waitFor(async () => expect(await port.semantic!.cursor("demo")).toBe(1));
      const state = await readSemanticState(f.home, "demo");
      await f.post("usage", { sourceId: state.sources[0]!.id, revision: 1, retrieval: false, remoteTransfer: false });
      await vi.waitFor(async () => expect(await port.semantic!.cursor("demo")).toBe(2));
      expect((await (await f.app.request("/api/knowledge/semantic?alias=demo")).json()).rows).toEqual([]);
    } finally { await f.app.close(); }
  });
  it("admits only one of two simultaneous model requests across asynchronous member lookup", async () => {
    let began!: () => void, release!: () => void, calls = 0;
    const started = new Promise<void>(r => { began = r; }), gate = new Promise<void>(r => { release = r; });
    const f = await fixture({ roomRunner: async () => { calls++; began(); await gate; return { ok: true, text: good, ms: 1 }; } });
    try {
      await f.add(); const s = await f.search(); const body = { query: s.query, revision: s.revision, corpus: s.corpus, memberId: "local" };
      const a = f.post("answer", { ...body, requestId: "a" }), b = f.post("answer", { ...body, requestId: "b" });
      await started; release();
      const results = await Promise.all([a, b]);
      expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect(calls).toBe(1);
    } finally { release(); await f.app.close(); }
  });
});
