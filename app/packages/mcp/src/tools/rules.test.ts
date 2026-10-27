import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { callTool, connectInProcess, resultJson } from "../testSupport.js";

describe("get_rules · save_rule (in-process MCP)", () => {
  it("저장한 규칙 · 스킬을 늘 지킬 것과 요청할 때 쓸 것으로 나눠 읽는다", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-mcp-rules-"));
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: path.join(studioHome, "nope") });
    const { client, close } = await connectInProcess(studioHome);
    try {
      await callTool(client, "save_rule", { alias: "demo", kind: "rule", name: "tone", description: "짧게", body: "세 문장 이내.", apply: "always" });
      await callTool(client, "save_rule", { alias: "demo", kind: "rule", name: "deck", description: "덱 만들 때", body: "끝난 뒤에 만든다." });
      await callTool(client, "save_rule", { alias: "demo", kind: "skill", name: "review", description: "검토", body: "검토 절차" });
      const all = resultJson(await callTool(client, "get_rules", { alias: "demo" })) as { always: { body: string }[]; onRequest: { name: string }[]; skills: { name: string }[] };
      expect(all.always.map(rule => rule.body)).toEqual(["세 문장 이내."]);
      expect(all.onRequest.map(rule => rule.name)).toEqual(["deck"]);
      expect(all.skills.map(skill => skill.name)).toEqual(["review"]);
      expect(resultJson(await callTool(client, "get_rules", { alias: "demo", name: "deck" }))).toMatchObject({ kind: "rule", body: "끝난 뒤에 만든다." });
      expect(resultJson(await callTool(client, "get_rules", { alias: "demo", name: "review" }))).toMatchObject({ kind: "skill" });
      expect((await callTool(client, "get_rules", { alias: "demo", name: "none" })).isError).toBe(true);
    } finally {
      await close();
    }
  });
});
