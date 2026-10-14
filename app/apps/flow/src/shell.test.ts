import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStudioInitialized, registerProject } from "@patchbay/core";
import { loadShell } from "./shell.js";
import { createMemoryNeo4jPort } from "./neo4jAdapter.js";
import {
  adapterLabel,
  DISCONNECTED_ADAPTERS,
  isTabId,
  resolveShellSelection,
  TABS,
} from "./shellContract.js";

describe("TABS", () => {
  it("freezes the four console tab ids from spec 1", () => {
    expect(TABS.map((tab) => tab.id)).toEqual(["project", "flow", "knowledge", "board"]);
  });

  it("accepts only those ids", () => {
    expect(isTabId("project")).toBe(true);
    expect(isTabId("graph")).toBe(false);
  });
});

describe("resolveShellSelection", () => {
  it("returns null when nothing is registered", () => {
    expect(resolveShellSelection([])).toBeNull();
    expect(resolveShellSelection([], "demo")).toBeNull();
  });

  it("uses the requested alias when it is registered", () => {
    expect(resolveShellSelection(["alpha", "zeta"], "zeta")).toBe("zeta");
  });

  it("falls back to the first registered alias when requested is missing or unknown", () => {
    expect(resolveShellSelection(["alpha", "zeta"])).toBe("alpha");
    expect(resolveShellSelection(["alpha", "zeta"], "nope")).toBe("alpha");
  });
});

describe("adapterLabel", () => {
  it("labels disconnected adapters in Korean", () => {
    expect(adapterLabel("LangGraph", "disconnected")).toBe("LangGraph 연결 안 됨");
    expect(adapterLabel("Neo4j", "connected")).toBe("Neo4j 연결됨");
  });
});

describe("loadShell", () => {
  it("lists registered aliases and keeps adapters disconnected", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-shell-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "demo", kind: "local_repo", path: "/tmp/demo" });

    const shell = await loadShell(studioHome, "demo");
    expect(shell.projects).toEqual([{ alias: "demo" }]);
    expect(shell.selected).toBe("demo");
    expect(shell.adapters).toEqual(DISCONNECTED_ADAPTERS);
  });

  it("selects the first project when the requested alias is not registered", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-shell-"));
    await ensureStudioInitialized(studioHome);
    await registerProject(studioHome, { alias: "alpha", kind: "local_repo", path: "/tmp/a" });

    const shell = await loadShell(studioHome, "missing");
    expect(shell.selected).toBe("alpha");
  });

  it("marks langgraph connected when the port probe succeeds", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-shell-"));
    await ensureStudioInitialized(studioHome);
    const shell = await loadShell(studioHome, undefined, {
      langgraph: {
        url: "http://langgraph.test",
        probe: async () => true,
        listAssistants: async () => [],
        getGraph: async () => null,
        listThreads: async () => [],
        getState: async () => null,
        listRuns: async () => [],
        listHistory: async () => [],
        createThread: async () => null,
        waitRun: async () => ({ status: "error", error: "unused" }),
      },
    });
    expect(shell.adapters).toEqual({ langgraph: "connected", neo4j: "disconnected" });
  });

  it("stays disconnected when probe throws", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-shell-"));
    await ensureStudioInitialized(studioHome);
    const shell = await loadShell(studioHome, undefined, {
      langgraph: {
        url: "http://langgraph.test",
        probe: async () => {
          throw new Error("boom");
        },
        listAssistants: async () => null,
        getGraph: async () => null,
        listThreads: async () => null,
        getState: async () => null,
        listRuns: async () => null,
        listHistory: async () => null,
        createThread: async () => null,
        waitRun: async () => ({ status: "timeout" }),
      },
    });
    expect(shell.adapters.langgraph).toBe("disconnected");
  });

  it("marks neo4j connected when the port probe succeeds", async () => {
    const studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-shell-"));
    await ensureStudioInitialized(studioHome);
    const shell = await loadShell(studioHome, undefined, { neo4j: createMemoryNeo4jPort() });
    expect(shell.adapters).toEqual({ langgraph: "disconnected", neo4j: "connected" });
  });
});
