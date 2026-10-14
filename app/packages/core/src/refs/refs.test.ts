import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { addFileRef, addLinkRef, archiveRef, listRefs, refFilePath, safeRefName } from "./store.js";

let home: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-refs-"));
});

describe("참고 자료", () => {
  it("링크 · 이미지 · 파일을 붙이고 목록으로 읽는다", async () => {
    expect((await addLinkRef(home, "demo", { url: "https://example.com/spec", title: "기존 명세" })).ok).toBe(true);
    const img = await addFileRef(home, "demo", { name: "화면 시안.png", data: Buffer.from([137, 80, 78, 71]) });
    const doc = await addFileRef(home, "demo", { name: "../../etc/notes.md", data: Buffer.from("# x") });
    const refs = await listRefs(home, "demo");
    expect(refs.map((r) => [r.id, r.kind])).toEqual([["F1", "link"], ["F2", "image"], ["F3", "file"]]);
    expect(img.ok && img.ref.uri).toBe("F2-화면-시안.png");
    expect(doc.ok && doc.ref.uri).toBe("F3-notes.md");
    expect(await fs.readFile((await refFilePath(home, "demo", "F2"))!)).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(await refFilePath(home, "demo", "F1")).toBeNull();
  });

  it("http 가 아닌 링크와 빈 파일은 거절한다", async () => {
    expect(await addLinkRef(home, "demo", { url: "file:///etc/passwd" })).toMatchObject({ ok: false });
    expect(await addFileRef(home, "demo", { name: "a.txt", data: Buffer.alloc(0) })).toMatchObject({ ok: false });
  });

  it("빼면 목록에서 사라지고 파일은 보관으로 간다 — 지우지 않는다", async () => {
    await addFileRef(home, "demo", { name: "a.md", data: Buffer.from("x") });
    expect(await archiveRef(home, "demo", "F1")).toBe(true);
    expect(await listRefs(home, "demo")).toEqual([]);
    expect(await fs.readFile(path.join(home, "projects", "demo", "refs", "archive", "F1-a.md"), "utf8")).toBe("x");
  });

  it("이름의 경로 조각을 걷어 낸다", () => {
    expect(safeRefName("../../x y.png")).toBe("x-y.png");
  });
});
