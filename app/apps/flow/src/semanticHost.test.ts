import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureStudioInitialized, registerProject, writeAgents } from "@patchbay/core";
import { createFlowApp, type FlowAppOptions } from "./server.js";
import { createMemoryNeo4jPort, type Neo4jPort } from "./neo4jAdapter.js";
import type { SemanticView, SemanticCandidate } from "@patchbay/core";
import { parseStudioEvent } from "./eventsContract.js";

async function fixture(options: Partial<FlowAppOptions> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pb-semantic-host-")), home = path.join(root, "home"), repo = path.join(root, "repo");
  await fs.mkdir(repo); await ensureStudioInitialized(home); await registerProject(home, { alias: "demo", kind: "local_repo", path: repo });
  await writeAgents(home, "demo", [{ id: "extractor", speaker: "codex", model: "test-model", role: "근거 추출" },
    { id: "local-model", speaker: "local", model: "local-test", role: "로컬" },
    { id: "embedding-model", speaker: "local", model: "nomic-embed-test", role: "임베딩" }]);
  await fs.writeFile(path.join(repo, "guide.md"), "# 원문\n\nPatchbay는 Neo4j를 사용한다.\n");
  const port = options.neo4j?.port ?? createMemoryNeo4jPort();
  const app = createFlowApp({ studioHome: home, neo4j: { port }, ...options });
  const get = (suffix = "") => app.request("/api/knowledge/semantic?alias=demo" + suffix);
  const post = (action: string, body: object, headers = {}) => app.request("/api/knowledge/semantic/" + action, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ alias: "demo", ...body }) });
  const s = await (await app.request("/api/knowledge/semantic/source?alias=demo&path=guide.md", options.access?.token ? { headers: { authorization: "Bearer " + options.access.token } } : undefined)).json();
  const candidate: SemanticCandidate = { subject: "Patchbay", predicate: "USES", object: "Neo4j", chunkId: s.chunks[0].id, quote: s.chunks[0].text };
  const importOne = () => post("import", { path: "guide.md", hash: s.hash, revision: 0, candidates: [candidate] });
  return { root, home, repo, port, app, get, post, s, candidate, importOne };
}
const view = async (r: Response): Promise<SemanticView> => { expect(r.status).toBe(200); return r.json(); };
describe("semantic knowledge HTTP contract", () => {
  it("completes import → review → Neo4j search → original version → withdrawal", async () => {
    const f = await fixture();
    try {
      let v = await view(await f.importOne());
      expect(v.projection.status).toBe("ready"); expect(v.graph.claims).toHaveLength(0);
      v = await view(await f.post("review", { revision: 1, id: v.rows[0]!.id, decision: "approved" }));
      expect(v.graph.entities.map(e => e.name).sort()).toEqual(["Neo4j", "Patchbay"]); expect(v.graph.claims).toHaveLength(1);
      expect((await view(await f.get("&q=absent"))).graph.entities).toHaveLength(0);
      expect((await view(await f.get("&entity=" + v.rows[0]!.from))).graph.claims).toHaveLength(1);
      const source = await f.app.request("/api/knowledge/semantic/version?alias=demo&id=" + v.rows[0]!.versionId);
      expect(source.headers.get("content-type")).toContain("text/plain"); expect(await source.text()).toContain("# 원문");
      const evidence = v.rows[0]!;
      v = await view(await f.post("review", { revision: v.revision, id: evidence.id, decision: "withdrawn" }));
      expect(v.graph.claims).toHaveLength(0); expect(v.rows[0]?.history).toHaveLength(2);
      const before = JSON.stringify(v.graph);
      v = await view(await f.post("sync", { rebuild: true })); expect(JSON.stringify(v.graph)).toBe(before);
    } finally { await f.app.close(); }
  });
  it("retains reviews on projection failure, blocks old results, stops at a failed seq, and retries in order", async () => {
    const base = createMemoryNeo4jPort(); let fail = false; const delivered: number[] = [];
    const port: Neo4jPort = { ...base, semantic: { ...base.semantic!, async apply(alias, p) { delivered.push(p.seq); if (fail && p.seq === 2) throw Error("offline"); await base.semantic!.apply(alias, p); } } };
    const f = await fixture({ neo4j: { port } });
    try {
      const first = await view(await f.importOne()); fail = true;
      let v = await view(await f.post("review", { revision: 1, id: first.rows[0]!.id, decision: "approved" }));
      expect(v.projection.status).toBe("failed"); expect(v.rows[0]?.decision).toBe("approved"); expect(v.graph.claims).toHaveLength(0);
      v = await view(await f.post("review", { revision: 2, id: first.rows[0]!.id, decision: "rejected" }));
      expect(await port.semantic!.cursor("demo")).toBe(1); expect(delivered).not.toContain(3);
      fail = false; v = await view(await f.post("sync", {}));
      expect(delivered.slice(-2)).toEqual([2, 3]); expect(v.projection.status).toBe("ready"); expect(v.graph.claims).toHaveLength(0);
      expect(v.rows[0]?.decision).toBe("rejected");
    } finally { await f.app.close(); }
  });
  it("filters changed and unavailable source evidence before querying a caught-up DB", async () => {
    const f = await fixture();
    try {
      let v = await view(await f.importOne()); v = await view(await f.post("review", { revision: 1, id: v.rows[0]!.id, decision: "approved" }));
      const originalVersionId = v.rows[0]!.versionId;
      await fs.writeFile(path.join(f.repo, "guide.md"), "# 원문\n\nPatchbay는 다른 것을 사용한다.\n");
      v = await view(await f.get()); expect(v.projection.status).toBe("ready"); expect(v.graph.claims).toEqual([]); expect(v.counts.stale).toBe(1);
      await fs.rename(path.join(f.repo, "guide.md"), path.join(f.repo, "moved.md"));
      v = await view(await f.get()); expect(v.rows).toEqual([]);
      expect((await f.app.request("/api/knowledge/semantic/version?alias=demo&id=" + originalVersionId)).status).toBe(404);
    } finally { await f.app.close(); }
  });
  it("runs extraction only on an explicit request and rejects hallucinated evidence atomically", async () => {
    let calls = 0, quote = "없는 인용";
    const f = await fixture({ roomBin: "fake-extractor", roomRunner: async request => {
      calls++; expect(request.speaker).toBe("codex"); expect(request.execution).toBe("read"); expect(request.cwd).toBe(os.tmpdir());
      return { ok: true, text: JSON.stringify({ candidates: [{ subject: "Patchbay", predicate: "USES", object: "Neo4j", chunkId: f.candidate.chunkId, quote }] }), ms: 1 };
    } });
    try {
      await f.get(); expect(calls).toBe(0);
      const members = await (await f.app.request("/api/knowledge/semantic/extractors?alias=demo")).json();
      expect(members.members.map((m: { id: string }) => m.id)).toEqual(["extractor", "local-model"]); expect(calls).toBe(0);
      expect((await f.post("extract", { revision: 0, path: "guide.md", hash: f.s.hash, memberId: "unknown-model" })).status).toBe(400);
      expect(calls).toBe(0);
      expect((await f.post("extract", { revision: 0, path: "guide.md", hash: f.s.hash, memberId: "extractor" })).status).toBe(422);
      expect((await view(await f.get())).revision).toBe(0);
      quote = f.candidate.quote;
      const v = await view(await f.post("extract", { revision: 0, path: "guide.md", hash: f.s.hash, memberId: "extractor" }));
      expect(calls).toBe(2); expect(v.counts.pending).toBe(1); expect(v.graph.claims).toEqual([]);
    } finally { await f.app.close(); }
  });
  it("enforces read-only access, write origins, revision conflicts and schema validation", async () => {
    const f = await fixture({ access: { token: "write", readToken: "read" } });
    try {
      expect((await f.get()).status).toBe(401);
      const source = await f.app.request("/api/knowledge/semantic/source?alias=demo&path=guide.md", { headers: { authorization: "Bearer read" } }); expect(source.status).toBe(200);
      expect((await f.post("sync", {}, { authorization: "Bearer read" })).status).toBe(403);
      expect((await f.post("local-models", {}, { authorization: "Bearer read" })).status).toBe(403);
      expect((await f.post("sync", {}, { authorization: "Bearer write", origin: "https://other.example", host: "localhost" })).status).toBe(403);
      const p = async (body: object) => f.post("import", body, { authorization: "Bearer write" });
      expect((await p({ revision: -1, candidates: [] })).status).toBe(400);
      expect((await p({ revision: 0, path: "guide.md", hash: (await source.json()).hash, candidates: [{ ...f.candidate, predicate: "arbitrary" }] })).status).toBe(400);
    } finally { await f.app.close(); }
  });
  it("supports review when Neo4j is disconnected and emits knowledge invalidation for the stored file", async () => {
    const port = { ...createMemoryNeo4jPort(), probe: async () => false };
    const f = await fixture({ neo4j: { port } });
    try {
      const v = await view(await f.importOne()); expect(v.projection.status).toBe("disconnected"); expect(v.counts.pending).toBe(1);
      expect(parseStudioEvent(path.join(f.home, "projects", "demo", "knowledge", "semantic.json"), f.home)).toEqual({ event: "knowledge", alias: "demo" });
      expect(parseStudioEvent("projects/demo/knowledge/semantic.json.tmp")).toBe(null);
    } finally { await f.app.close(); }
  });
  it("tracks only an explicitly started extraction as running and stops without saving candidates", async () => {
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const f = await fixture({ roomBin: "fake", roomRunner: async request => {
      expect(request.speaker).toBe("local");
      started();
      await new Promise<void>(resolve => request.signal!.addEventListener("abort", () => resolve(), { once: true }));
      return { ok: false, kind: "stopped", text: "stopped", ms: 1 };
    } });
    try {
      const pending = f.post("extract", { revision: 0, path: "guide.md", hash: f.s.hash, memberId: "local-model" });
      await began;
      expect((await (await f.app.request("/api/running")).json()).aliases).toContain("demo");
      expect((await f.post("stop", {})).status).toBe(200);
      expect((await pending).status).toBe(422);
      expect((await view(await f.get())).revision).toBe(0);
      expect((await (await f.app.request("/api/running")).json()).aliases).not.toContain("demo");
    } finally { await f.app.close(); }
  });
  it.each(["registered", "downloaded"])("extracts with an explicitly chosen %s LM Studio model into pending review", async selection => {
    let calls = 0;
    const f = await fixture({ roomBin: "fake-lms", roomRunner: async request => {
      calls++; expect(request.speaker).toBe("local"); expect(request.bin).toBe("fake-lms"); expect(request.execution).toBe("read");
      expect(request.model).toBe(selection === "registered" ? "local-test" : "downloaded-chat-model");
      return { ok: true, text: JSON.stringify({ candidates: [f.candidate] }), ms: 1 };
    } });
    try {
      const source = selection === "registered" ? { memberId: "local-model" } : { localModel: "downloaded-chat-model" };
      const result = await view(await f.post("extract", { revision: 0, path: "guide.md", hash: f.s.hash, ...source }));
      expect(calls).toBe(1); expect(result.counts.pending).toBe(1); expect(result.graph.claims).toEqual([]);
      expect(result.rows[0]?.model).toBe("local · " + (selection === "registered" ? "local-test" : "downloaded-chat-model"));
    } finally { await f.app.close(); }
  });
  it("rejects invalid local model selections and keeps failed local extraction out of saved data", async () => {
    let calls = 0;
    const f = await fixture({ roomBin: "fake-lms", roomRunner: async () => { calls++; return { ok: false, kind: "timeout", text: "timeout", ms: 1 }; } });
    try {
      const base = { revision: 0, path: "guide.md", hash: f.s.hash };
      for (const source of [{ localModel: "" }, { localModel: "nomic-embed-v1" }, { localModel: "--flag" }, { localModel: "bad\nmodel" },
        { localModel: "chat-model", memberId: "local-model" }, { memberId: "embedding-model" }]) {
        expect((await f.post("extract", { ...base, ...source })).status).toBe(400);
      }
      expect(calls).toBe(0);
      const response = await f.post("extract", { ...base, memberId: "local-model" });
      expect(response.status).toBe(422); expect((await response.json()).error).toContain("LM Studio");
      expect((await view(await f.get())).revision).toBe(0);
    } finally { await f.app.close(); }
  });
  it("queries LM Studio model inventory only when requested and excludes embedding models", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pb-semantic-model-list-")), bin = path.join(dir, "lms"), calls = path.join(dir, "calls.json");
    await fs.writeFile(bin, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(JSON.stringify([{type:'llm',modelKey:'qwen-chat',displayName:'Qwen'},{type:'embedding',modelKey:'nomic-embed'},{type:'llm',modelKey:'bad-embed-model'}]));\n`, { mode: 0o700 });
    const f = await fixture({ roomBin: bin });
    try {
      await f.get(); await f.app.request("/api/knowledge/semantic/extractors?alias=demo");
      await expect(fs.access(calls)).rejects.toMatchObject({ code: "ENOENT" });
      const response = await f.post("local-models", {});
      expect(response.status).toBe(200); expect((await response.json()).models).toEqual([{ id: "qwen-chat", name: "Qwen" }]);
      expect(JSON.parse(await fs.readFile(calls, "utf8"))).toEqual(["ls", "--json"]);
      expect((await view(await f.get())).revision).toBe(0);
    } finally { await f.app.close(); }
  });
  it("reports unavailable LM Studio inventory without changing knowledge data", async () => {
    const f = await fixture({ roomBin: null });
    try {
      const response = await f.post("local-models", {}); expect(response.status).toBe(400); expect((await response.json()).error).toContain("LM Studio");
      expect((await f.post("extract", { revision: 0, path: "guide.md", hash: f.s.hash, memberId: "local-model" })).status).toBe(400);
      expect((await view(await f.get())).revision).toBe(0);
    } finally { await f.app.close(); }
  });
});
