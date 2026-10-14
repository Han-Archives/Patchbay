import { readStudio } from "@patchbay/core";
import type { LangGraphPort } from "./langgraphAdapter.js";
import type { Neo4jPort } from "./neo4jAdapter.js";
import {
  DISCONNECTED_ADAPTERS,
  resolveShellSelection,
  type AdapterStatus,
  type ShellResponse,
} from "./shellContract.js";

export {
  adapterLabel,
  DISCONNECTED_ADAPTERS,
  isTabId,
  projectLabel,
  resolveShellSelection,
  TABS,
  type AdapterStatus,
  type ShellAdapters,
  type ShellProject,
  type ShellResponse,
  type TabId,
} from "./shellContract.js";

export interface LoadShellOptions {
  langgraph?: LangGraphPort;
  neo4j?: Neo4jPort;
}

export async function loadShell(
  studioHome: string,
  requested?: string,
  options?: LoadShellOptions,
): Promise<ShellResponse> {
  const studio = await readStudio(studioHome);
  const projects = studio.projects.map((project) => ({
    alias: project.alias,
    ...(project.name ? { name: project.name } : {}),
  }));
  let langgraph: AdapterStatus = DISCONNECTED_ADAPTERS.langgraph;
  let neo4j: AdapterStatus = DISCONNECTED_ADAPTERS.neo4j;
  if (options?.langgraph) {
    try {
      langgraph = (await options.langgraph.probe()) ? "connected" : "disconnected";
    } catch {
      langgraph = "disconnected";
    }
  }
  if (options?.neo4j) {
    try {
      neo4j = (await options.neo4j.probe()) ? "connected" : "disconnected";
    } catch {
      neo4j = "disconnected";
    }
  }
  return {
    studioName: studio.name,
    projects,
    selected: resolveShellSelection(
      projects.map((project) => project.alias),
      requested,
    ),
    adapters: { langgraph, neo4j },
  };
}
