import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { createFlowApp } from "./server.js";

describe("구조도 읽기", () => {
  it("문서 폴더의 기획/구조도.json을 읽어 균형 검사와 함께 돌려주고, 없거나 깨졌으면 그렇게 알린다", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pb-structure-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pb-structure-repo-"));
    await registerProject(home, { alias: "demo", kind: "local_repo", path: repo, docs: "notes" });
    const app = createFlowApp({ studioHome: home });
    try {
      const get = async () => (await app.request("/api/structure?alias=demo")).json() as Promise<{ status: string; rel: string; issues?: string[]; error?: string }>;
      expect(await get()).toEqual({ status: "missing", rel: "notes/기획/구조도.json" });
      fs.mkdirSync(path.join(repo, "notes/기획"), { recursive: true });
      fs.writeFileSync(path.join(repo, "notes/기획/구조도.json"), "{");
      expect((await get()).status).toBe("broken");
      fs.writeFileSync(path.join(repo, "notes/기획/구조도.json"), JSON.stringify({
        elements: [{ id: "a", label: "가", role: "process", evidence: null }, { id: "s", label: "저장", role: "store", evidence: null }],
        relationships: [{ id: "r1", from: "a", to: "s", label: "기록", effect: "write", evidence: null }, { id: "r2", from: "a", to: "x", label: "틀린 끝", evidence: null }],
        views: [{ id: "structure", title: "구조", kind: "structure", relationshipIds: ["r1"] }],
      }));
      const ready = await get();
      expect(ready.status).toBe("ready");
      expect(ready.issues).toEqual(["r2의 끝이 요소가 아니다"]);
      expect((await app.request("/api/structure?alias=nope")).status).toBe(404);
    } finally { await app.close(); }
  });
});
