import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectStudioDir } from "../studio/studioStore.js";
import { roomModeSchema, type RoomMode } from "./types.js";

/**
 * 대화 모드 목록: 목적별로 여러 LLM이 어떻게 논의하고 어디까지 고칠지(`read` | `edit` | `apply`) 정한다.
 * `~/.patchbay/projects/<alias>/modes.json` 이 없으면 `~/.patchbay/modes.default.json`, 그것도 없으면 기본 6대 모드를 돌려준다.
 */
export const MODES_FILE_NAME = "modes.json";
export const DEFAULT_MODES_FILE_NAME = "modes.default.json";

const modesFileSchema = z.object({ modes: z.array(roomModeSchema) });

export const DEFAULT_ROOM_MODES: RoomMode[] = [
  {
    id: "discuss",
    name: "토의",
    icon: "discuss",
    color: "#3d6fe0",
    execution: "read",
    prompt: "찬반과 대안을 비교하고, 바로 앞에 말한 사람의 말에서 한 점을 받아 이어 말한다. 마지막에는 합의된 점, 남은 이견, 아직 안 정한 것을 정리한다.",
  },
  {
    id: "report",
    name: "보고서 작성",
    icon: "report",
    color: "#2b8a6e",
    execution: "edit",
    prompt: "첫 번째 사람은 개요와 본문 초안을 작성하고, 다음 사람은 사실 오류·근거 누락·구조 결함만 짚어 보완한다.",
  },
  {
    id: "planning",
    name: "플래닝",
    icon: "planning",
    color: "#6d4aff",
    execution: "read",
    prompt: "실행 순서, 선행 의존 관계, 하지 않을 것, 그리고 맞다·틀리다로 판정할 수 있는 완료 조건을 정한다. 코드를 바로 고치지 않는다.",
  },
  {
    id: "design",
    name: "디자인",
    icon: "design",
    color: "#d97724",
    execution: "edit",
    prompt: "화면 제약과 상태를 먼저 맞춘 뒤 시안을 비교하고, 읽어야 아는 설명 대신 바로 보이는 시각 산출물(HTML·SVG·CSS)로 남긴다.",
  },
  {
    id: "study",
    name: "스터디",
    icon: "study",
    color: "#4f7cac",
    execution: "read",
    prompt: "핵심 원리와 헷갈리기 쉬운 지점을 설명하고, 마지막에 사람이 자기 말로 이해를 확인할 수 있는 짧은 질문을 남긴다.",
  },
  {
    id: "coding",
    name: "코딩",
    icon: "coding",
    color: "#8b5cf6",
    execution: "apply",
    prompt: "요구사항과 완료 조건을 임의로 바꾸지 않는다. 수정 권한이 있는 사람이 직접 코드를 반영하고 형 검사·시험을 돌린 뒤, 다음 사람은 다른 시각에서 결함과 빠진 시험을 독립 검토한다.",
  },
];

export function modesPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), MODES_FILE_NAME);
}

export function defaultModesPath(studioHome: string): string {
  return path.join(studioHome, DEFAULT_MODES_FILE_NAME);
}

async function readModesFile(file: string): Promise<RoomMode[] | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return modesFileSchema.parse(JSON.parse(text)).modes;
}

export async function readModes(studioHome: string, alias: string): Promise<RoomMode[]> {
  return (await readModesFile(modesPath(studioHome, alias)))
    ?? (await readModesFile(defaultModesPath(studioHome)))
    ?? DEFAULT_ROOM_MODES.map((mode) => ({ ...mode }));
}

export async function writeModes(studioHome: string, alias: string, modes: RoomMode[]): Promise<void> {
  const file = modesPath(studioHome, alias);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ modes }, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}
