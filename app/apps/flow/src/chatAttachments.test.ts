import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addFileRef, addLinkRef, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { chatTokens, projectFileHref } from "./chatLinks.js";
import { sendConsultTurn, type HostRunner, type HostTurnRequest } from "./consultHost.js";
import { createFlowApp } from "./server.js";

describe("첨부와 산출물 링크", () => {
  it("문서 · URL · 프로젝트 파일을 대화에 붙이고, 답에 나온 산출물을 미리 보고 내려받게 한다", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-attach-"));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-attach-repo-"));
    fs.mkdirSync(path.join(repo, "design"));
    fs.writeFileSync(path.join(repo, "design/홈_v1.html"), "<h1>홈</h1>");
    fs.writeFileSync(path.join(repo, "notes.md"), "메모");
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });

    // 상담: 문서와 URL을 붙이면 호스트에게 넘어간다.
    const doc = await addFileRef(studioHome, "demo", { name: "기획.md", data: Buffer.from("# 기획") });
    const link = await addLinkRef(studioHome, "demo", { url: "https://example.com/spec", title: "명세" });
    if (!doc.ok || !link.ok) throw new Error("참고 자료를 만들지 못했다");
    const calls: HostTurnRequest[] = [];
    const runner: HostRunner = async (req) => { calls.push(req); return { ok: true, text: "시안은 design/홈_v1.html 에 두었다", ms: 1 }; };
    const turn = await sendConsultTurn(studioHome, { alias: "demo", text: "이거 참고해", host: "claude-code", model: "", attachments: [doc.ref.id, link.ref.id] }, { runner, bin: "claude" });
    if (!turn.ok) throw new Error(turn.error);
    await turn.done;
    expect(calls[0]!.prompt).toContain("https://example.com/spec");
    expect(calls[0]!.prompt).toContain("기획.md");

    // 대화방: 프로젝트 파일을 골라 그 글을 붙인다.
    const app = createFlowApp({ studioHome });
    const files = (await (await app.request("/api/room/files?alias=demo")).json()) as { files: string[] };
    expect(files.files).toEqual(expect.arrayContaining(["design/홈_v1.html", "notes.md"]));
    const source = (await (await app.request("/api/source?alias=demo&path=notes.md")).json()) as { content: string };
    expect(source.content).toBe("메모");

    // 답의 산출물 경로는 링크가 되고, 열기 · 받기 둘 다 된다.
    const token = chatTokens("시안은 design/홈_v1.html 에 두었다").find((t) => t.kind === "file");
    expect(token).toMatchObject({ kind: "file", path: "design/홈_v1.html" });
    const view = await app.request(projectFileHref("demo", "design/홈_v1.html"));
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toContain("text/html");
    expect(await view.text()).toBe("<h1>홈</h1>");
    const download = await app.request(projectFileHref("demo", "design/홈_v1.html", true));
    expect(download.headers.get("content-disposition")).toContain("attachment");
  });
});
