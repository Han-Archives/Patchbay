import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, registerProject } from "@patchbay/core";
import { describe, expect, it } from "vitest";
import { loadSourceFile, normalizeProjectRelPath, saveSourceFile, SOURCE_FILE_MAX_BYTES } from "./sourceFileView.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function seededStudio(): Promise<{ studioHome: string; repo: string }> {
  const studioHome = tmpDir("patchbay-source-studio-");
  const repo = tmpDir("patchbay-source-repo-");
  fs.writeFileSync(path.join(repo, "README.md"), "# hello\n");
  fs.mkdirSync(path.join(repo, "lectures"));
  fs.writeFileSync(path.join(repo, "lectures", "reading.md"), "강의\n");
  await ensureStudioInitialized(studioHome);
  await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: repo });
  return { studioHome, repo };
}

describe("normalizeProjectRelPath", () => {
  it("accepts posix relative files and rejects traversal", () => {
    expect(normalizeProjectRelPath("lectures/reading.md")).toBe("lectures/reading.md");
    expect(normalizeProjectRelPath("./lectures/reading.md")).toBe("lectures/reading.md");
    expect(normalizeProjectRelPath("../secret")).toBeNull();
    expect(normalizeProjectRelPath("/etc/passwd")).toBeNull();
    expect(normalizeProjectRelPath("")).toBeNull();
  });
});

describe("loadSourceFile / saveSourceFile", () => {
  it("reads and writes a file inside the registered project", async () => {
    const { studioHome } = await seededStudio();
    const loaded = await loadSourceFile(studioHome, "demo", "lectures/reading.md");
    expect(loaded).toMatchObject({
      ok: true,
      body: { alias: "demo", path: "lectures/reading.md", content: "강의\n" },
    });

    const saved = await saveSourceFile(studioHome, {
      alias: "demo",
      path: "lectures/reading.md",
      content: "고친 강의\n",
    });
    expect(saved.ok).toBe(true);
    const again = await loadSourceFile(studioHome, "demo", "lectures/reading.md");
    expect(again.ok && again.body.content).toBe("고친 강의\n");
  });

  it("rejects missing alias, unknown alias, folders, missing files, and escape", async () => {
    const { studioHome } = await seededStudio();
    expect((await loadSourceFile(studioHome, undefined, "README.md")).status).toBe(400);
    expect((await loadSourceFile(studioHome, "nope", "README.md")).status).toBe(404);
    expect((await loadSourceFile(studioHome, "demo", "lectures")).status).toBe(400);
    expect((await loadSourceFile(studioHome, "demo", "missing.md")).status).toBe(404);
    expect((await loadSourceFile(studioHome, "demo", "../README.md")).status).toBe(400);
    expect((await saveSourceFile(studioHome, { alias: "demo", path: "README.md", content: 1 })).status).toBe(400);
  });

  it("rejects oversized files", async () => {
    const { studioHome, repo } = await seededStudio();
    const huge = "x".repeat(SOURCE_FILE_MAX_BYTES + 1);
    fs.writeFileSync(path.join(repo, "big.md"), huge);
    expect((await loadSourceFile(studioHome, "demo", "big.md")).status).toBe(413);
    expect(
      (await saveSourceFile(studioHome, { alias: "demo", path: "README.md", content: huge })).status,
    ).toBe(413);
  });
});

describe("sensitivity gate", () => {
  /** The leak this gate exists for: GET /api/source returned .env verbatim. */
  async function studioWithSecrets() {
    const seeded = await seededStudio();
    fs.writeFileSync(path.join(seeded.repo, ".env"), "LANGSMITH_API_KEY=sk-real-key\n");
    fs.mkdirSync(path.join(seeded.repo, "secrets"));
    fs.writeFileSync(path.join(seeded.repo, "secrets", "notes.md"), "내부\n");
    fs.writeFileSync(path.join(seeded.repo, "server.pem"), "-----BEGIN KEY-----\n");
    return seeded;
  }

  it("refuses to read a secret, and never puts its contents in the response", async () => {
    const { studioHome } = await studioWithSecrets();
    const result = await loadSourceFile(studioHome, "demo", ".env");
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain("비밀");
    expect(result.error).not.toContain("sk-real-key");
  });

  it("refuses every secret shape, not just .env", async () => {
    const { studioHome } = await studioWithSecrets();
    for (const rel of ["secrets/notes.md", "server.pem"]) {
      expect((await loadSourceFile(studioHome, "demo", rel)).status).toBe(403);
    }
  });

  it("refuses to save over a secret too -- the gate covers both verbs", async () => {
    const { studioHome, repo } = await studioWithSecrets();
    const saved = await saveSourceFile(studioHome, { alias: "demo", path: ".env", content: "X=1\n" });
    expect(saved).toMatchObject({ ok: false, status: 403 });
    // The file on disk is untouched.
    expect(fs.readFileSync(path.join(repo, ".env"), "utf8")).toContain("sk-real-key");
  });

  it("says which rule matched so the refusal is explainable", async () => {
    const { studioHome } = await studioWithSecrets();
    const result = await loadSourceFile(studioHome, "demo", "server.pem");
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain(".pem");
  });

  it("leaves ordinary project files readable", async () => {
    const { studioHome } = await studioWithSecrets();
    const result = await loadSourceFile(studioHome, "demo", "lectures/reading.md");
    expect(result.ok).toBe(true);
  });

  it("refuses a secret that does not exist, without touching the filesystem", async () => {
    const { studioHome } = await seededStudio();
    // A missing ordinary file is 404; a secret is refused before any stat.
    expect((await loadSourceFile(studioHome, "demo", "nope.md")).status).toBe(404);
    expect((await loadSourceFile(studioHome, "demo", ".env")).status).toBe(403);
  });
});
