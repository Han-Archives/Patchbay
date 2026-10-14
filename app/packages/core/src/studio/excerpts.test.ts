import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PortId } from "../types/portId.js";
import { readSignalExcerpts } from "./excerpts.js";

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-excerpts-"));
  fs.mkdirSync(path.join(dir, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# public readme\n");
  fs.writeFileSync(path.join(dir, ".ssh", "README.md"), "PRIVATE KEY MATERIAL\n");
  fs.writeFileSync(path.join(dir, ".env"), "TOKEN=hunter2\n");
  return dir;
}

const ports = (...raw: string[]) => raw as unknown as PortId[];

describe("readSignalExcerpts: sensitivity gate", () => {
  it("excerpts a public signal file", async () => {
    const dir = tempProject();
    try {
      const out = await readSignalExcerpts(dir, ports("source:README.md"));
      expect(out.map((entry) => entry.path)).toEqual(["README.md"]);
      expect(out[0]?.content).toContain("public readme");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never excerpts a secret, even when the port asks for one", async () => {
    const dir = tempProject();
    try {
      // This content goes to a model. `/api/source`'s 403 does not cover this
      // path, and a stale inferred.json written before the scanner started
      // withholding secrets can still carry these ports -- so the gate here is
      // the one that holds.
      const out = await readSignalExcerpts(
        dir,
        ports("source:README.md", "source:.ssh/README.md", "source:.env"),
      );
      expect(out.map((entry) => entry.path)).toEqual(["README.md"]);
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain("PRIVATE KEY MATERIAL");
      expect(serialized).not.toContain("hunter2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips non-source ports and unreadable files without failing the bundle", async () => {
    const dir = tempProject();
    try {
      const out = await readSignalExcerpts(
        dir,
        ports("skill:map-project", "source:gone.md", "source:README.md"),
      );
      expect(out.map((entry) => entry.path)).toEqual(["README.md"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
