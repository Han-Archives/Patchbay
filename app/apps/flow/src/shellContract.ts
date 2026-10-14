export const TABS = [
  { id: "project", label: "프로젝트" },
  { id: "flow", label: "흐름" },
  { id: "knowledge", label: "지식" },
  { id: "board", label: "배치도" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export type AdapterStatus = "connected" | "disconnected";

export interface ShellAdapters {
  langgraph: AdapterStatus;
  neo4j: AdapterStatus;
}

export interface ShellProject {
  alias: string;
  name?: string;
}

/** What the console calls a project: its studio `name` if set, else the alias. */
export function projectLabel(projects: readonly ShellProject[], alias: string): string {
  return projects.find((project) => project.alias === alias)?.name ?? alias;
}

export interface ShellResponse {
  studioName: string;
  projects: ShellProject[];
  selected: string | null;
  adapters: ShellAdapters;
}

/** P1 default. P5 probes langgraph; P6 probes neo4j. */
export const DISCONNECTED_ADAPTERS: ShellAdapters = {
  langgraph: "disconnected",
  neo4j: "disconnected",
};

export function isTabId(value: string): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

/**
 * Initial project for the console: an explicit alias if it is registered,
 * otherwise the first registered alias, otherwise none.
 */
export function resolveShellSelection(aliases: readonly string[], requested?: string): string | null {
  if (aliases.length === 0) return null;
  if (requested && aliases.includes(requested)) return requested;
  return aliases[0] ?? null;
}

export function adapterLabel(service: "LangGraph" | "Neo4j", status: AdapterStatus): string {
  return status === "connected" ? `${service} 연결됨` : `${service} 연결 안 됨`;
}
