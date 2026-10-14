import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { excavationSchema } from "../types/excavation.js";
import { excavate, excavationFilePath, writeExcavation } from "./excavation.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initGit(dir: string): void {
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  run("git init -q -b main");
  run("git config user.name 'Patchbay Test'");
  run("git config user.email test@patchbay.invalid");
}

describe("excavate", () => {
  it("produces a value that passes excavationSchema.safeParse", async () => {
    const dir = tmpDir("patchbay-excavation-");
    fs.writeFileSync(path.join(dir, "README.md"), "# Fixture\n");
    const result = await excavate(dir);
    expect(excavationSchema.safeParse(result).success).toBe(true);
  });

  it("reports isRepo: false and zeroed git fields for a non-git folder", async () => {
    const dir = tmpDir("patchbay-excavation-nogit-");
    fs.writeFileSync(path.join(dir, "a.txt"), "hi\n");
    const result = await excavate(dir);
    expect(result.git.isRepo).toBe(false);
    expect(result.git.commitCount).toBe(0);
    expect(result.git.uniqueCommitRatio).toBe(0);
  });

  it("computes commitCount and uniqueCommitRatio over the full history, not capped at 20", async () => {
    const dir = tmpDir("patchbay-excavation-git-");
    initGit(dir);
    const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
    for (let i = 0; i < 25; i += 1) {
      run(`git commit -q --allow-empty -m "commit number ${i}"`);
    }
    run('git commit -q --allow-empty -m "commit number 0"'); // one duplicate subject

    const result = await excavate(dir);
    expect(result.git.isRepo).toBe(true);
    expect(result.git.commitCount).toBe(26);
    expect(result.git.uniqueCommitRatio).toBeCloseTo(25 / 26, 5);
  });

  it("reports readme.exists and wordCount from an actual README", async () => {
    const dir = tmpDir("patchbay-excavation-readme-");
    fs.writeFileSync(path.join(dir, "README.md"), "one two three four\n");
    const result = await excavate(dir);
    expect(result.readme).toEqual({ exists: true, wordCount: 4 });
  });

  it("reports readme.exists: false when there is no README", async () => {
    const dir = tmpDir("patchbay-excavation-noreadme-");
    fs.writeFileSync(path.join(dir, "a.txt"), "hi\n");
    const result = await excavate(dir);
    expect(result.readme).toEqual({ exists: false, wordCount: 0 });
  });

  it("finds duplicate/variant-name matches with their matched pattern", async () => {
    const dir = tmpDir("patchbay-excavation-dupes-");
    fs.writeFileSync(path.join(dir, "report_final.md"), "x\n");
    fs.writeFileSync(path.join(dir, "report_v2.md"), "x\n");
    fs.writeFileSync(path.join(dir, "clean.md"), "x\n");
    const result = await excavate(dir);
    expect(result.duplicateMatches).toEqual(
      expect.arrayContaining([
        { relativePath: "report_final.md", pattern: "_final" },
        { relativePath: "report_v2.md", pattern: "_v2" },
      ]),
    );
    expect(result.duplicateMatches).toHaveLength(2);
  });

  it("buckets every file into exactly one modificationDistribution bucket", async () => {
    const dir = tmpDir("patchbay-excavation-mtime-");
    fs.writeFileSync(path.join(dir, "recent.txt"), "x\n");
    const oldPath = path.join(dir, "old.txt");
    fs.writeFileSync(oldPath, "x\n");
    const now = new Date();
    const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldPath, twoYearsAgo, twoYearsAgo);

    const result = await excavate(dir, { now });
    const totalBucketed = result.modificationDistribution.reduce((sum, bucket) => sum + bucket.fileCount, 0);
    expect(totalBucketed).toBe(result.totalFiles);

    const recentBucket = result.modificationDistribution.find((b) => b.label === "7d")!;
    const oldestBucket = result.modificationDistribution.find((b) => b.label === "365d+")!;
    expect(recentBucket.fileCount).toBeGreaterThanOrEqual(1);
    expect(oldestBucket.fileCount).toBeGreaterThanOrEqual(1);
  });

  it("flags a lone, unrecognized file as an orphan but not README/package.json", async () => {
    const dir = tmpDir("patchbay-excavation-orphan-");
    fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
    fs.mkdirSync(path.join(dir, "lonely"));
    fs.writeFileSync(path.join(dir, "lonely", "mystery.dat"), "x\n");
    fs.mkdirSync(path.join(dir, "paired"));
    fs.writeFileSync(path.join(dir, "paired", "a.ts"), "x\n");
    fs.writeFileSync(path.join(dir, "paired", "b.ts"), "x\n");

    const result = await excavate(dir);
    expect(result.orphanFiles).toContain("lonely/mystery.dat");
    expect(result.orphanFiles).not.toContain("README.md");
    expect(result.orphanFiles).not.toContain("paired/a.ts");
    expect(result.orphanFiles).not.toContain("paired/b.ts");
  });

  it("counts TODO/FIXME density, skipping binary extensions and oversized files", async () => {
    const dir = tmpDir("patchbay-excavation-todo-");
    fs.writeFileSync(path.join(dir, "a.ts"), "// TODO: fix this\nconst x = 1; // FIXME later\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "const y = 2;\n");
    fs.writeFileSync(path.join(dir, "image.png"), "not really a png but has TODO in it\n");

    const result = await excavate(dir);
    expect(result.todoDensity.totalMatches).toBe(2);
    expect(result.todoDensity.filesWithMatches).toBe(1);
    expect(result.todoDensity.scannedTextFiles).toBe(2); // a.ts + b.ts, not image.png
  });

  it("excavating the same unchanged folder twice at the same instant produces byte-identical JSON", async () => {
    const dir = tmpDir("patchbay-excavation-stable-");
    fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
    const now = new Date();
    const first = await excavate(dir, { now });
    const second = await excavate(dir, { now });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("writeExcavation", () => {
  it("writes excavation.json inside the given project path and returns its absolute path", async () => {
    const dir = tmpDir("patchbay-excavation-write-");
    fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
    const excavation = await excavate(dir);

    const written = await writeExcavation(dir, excavation);
    expect(written).toBe(excavationFilePath(dir));
    expect(fs.existsSync(written)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(written, "utf8"));
    expect(excavationSchema.safeParse(parsed).success).toBe(true);
  });
});
