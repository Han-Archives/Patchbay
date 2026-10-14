import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectStudioDir } from "../studio/studioStore.js";
import { roomMemberSchema, type RoomMember } from "./types.js";

/**
 * Agents 목록: 프로젝트에 한 번 등록해 두고 대화마다 골라 부르는 LLM.
 * `~/.patchbay/projects/<alias>/agents.json`. 방의 담당(`members`)은 여기서 복사해 간다.
 * 프로젝트에 목록이 없으면 `~/.patchbay/agents.default.json`(기본 Agents)을 쓴다.
 */
export const AGENTS_FILE_NAME = "agents.json";
export const DEFAULT_AGENTS_FILE_NAME = "agents.default.json";

const agentsFileSchema = z.object({ agents: z.array(roomMemberSchema) });

export function agentsPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), AGENTS_FILE_NAME);
}

export function defaultAgentsPath(studioHome: string): string {
  return path.join(studioHome, DEFAULT_AGENTS_FILE_NAME);
}

async function readAgentsFile(file: string): Promise<RoomMember[] | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return agentsFileSchema.parse(JSON.parse(text)).agents;
}

export async function readAgents(studioHome: string, alias: string): Promise<RoomMember[]> {
  return (await readAgentsFile(agentsPath(studioHome, alias)))
    ?? (await readAgentsFile(defaultAgentsPath(studioHome)))
    ?? [];
}

export async function writeAgents(studioHome: string, alias: string, agents: RoomMember[]): Promise<void> {
  const file = agentsPath(studioHome, alias);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ agents }, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}
