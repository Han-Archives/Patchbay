import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStudio, resolveStudioHome } from "@patchbay/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProjectTriage } from "./projectTriage.js";

// Safety: PATCHBAY_HOME is redirected to a fresh tmpdir per test even though
// this command never writes there -- guards against a future regression
// accidentally introducing studio-home I/O.
let originalPatchbayHome: string | undefined;

beforeEach(() => {
  originalPatchbayHome = process.env.PATCHBAY_HOME;
  process.env.PATCHBAY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-project-triage-home-"));
});

afterEach(() => {
  if (originalPatchbayHome === undefined) delete process.env.PATCHBAY_HOME;
  else process.env.PATCHBAY_HOME = originalPatchbayHome;
  vi.restoreAllMocks();
});

function tmpProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-triage-fixture-"));
  fs.writeFileSync(path.join(dir, "notes_final.md"), "some TODO here\n");
  fs.writeFileSync(path.join(dir, "notes_v2.md"), "content\n");
  return dir;
}

describe("runProjectTriage", () => {
  it("exit 1 when --path is missing", async () => {
    const exitCode = await runProjectTriage({});
    expect(exitCode).toBe(1);
  });

  it("exit 1 when --path does not exist", async () => {
    const missing = path.join(os.tmpdir(), "patchbay-does-not-exist-" + Date.now());
    const exitCode = await runProjectTriage({ path: missing });
    expect(exitCode).toBe(1);
  });

  it("exit 0 on success: writes excavation.json in the target folder and prints its path", async () => {
    const projectDir = tmpProjectDir();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runProjectTriage({ path: projectDir, json: true });
    expect(exitCode).toBe(0);

    const printed = JSON.parse(logSpy.mock.calls.at(-1)![0] as string);
    expect(printed.ok).toBe(true);
    expect(printed.excavationPath).toBe(path.join(projectDir, "excavation.json"));
    expect(fs.existsSync(printed.excavationPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(printed.excavationPath, "utf8"));
    expect(written.duplicateMatches).toEqual(
      expect.arrayContaining([
        { relativePath: "notes_final.md", pattern: "_final" },
        { relativePath: "notes_v2.md", pattern: "_v2" },
      ]),
    );
  });

  it("never registers a project with the studio", async () => {
    const projectDir = tmpProjectDir();
    await runProjectTriage({ path: projectDir });

    const studio = await readStudio(resolveStudioHome());
    expect(studio.projects).toEqual([]);
  });
});
