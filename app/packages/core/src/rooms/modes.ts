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
    // 역할 지시는 절차 `토의-역할지시_20261018_v2`의 모드 규약 (R6.8, 사용자 결정 2026-10-21). 말하는 순서는 대화 실행이 맞춘다.
    prompt: [
      "목표: 사람이 하나를 고를 수 있게, 한 질문을 합의 · 이견 · 미정으로 가른다.",
      "독자: 이 대화를 보고 다음 행동을 고르는 사람.",
      "권한: 읽기. 프로젝트 파일을 수정하거나 삭제하지 않는다.",
      "말투: 한국어, 짧은 문장, 전문 용어는 한 번 풀어서 쓴다. 이모지는 쓰지 않는다.",
      "",
      "순서대로 한 번씩만 말한다.",
      "1. Claude — 결정할 질문 1줄, 주장 4문장 이내, 근거 2개 이내.",
      "2. Codex — Claude의 근거 중 1개만 골라 반론 4문장 이내.",
      "3. Grok — 둘이 말하지 않은 경우 1개, 4문장 이내.",
      "4. 로컬 모델 — 아래 세 칸만. 칸마다 항목 2개 이내. 없으면 「없음」.",
      "   합의된 점:",
      "   남은 이견:",
      "   아직 안 정한 것:",
      "참여자에 로컬 모델이 없으면 마지막에 말하는 사람이 세 칸을 정리한다.",
      "",
      "반드시: 앞 사람이 실제로 말한 것에서 한 점만 잇는다. 세 칸이 채워지면 멈춘다.",
      "하지 말 것: 앞 말 통째 반복, 역할 밖의 쟁점, 사람 대신 안을 고르기, 파일 수정.",
      "",
      "다음 바퀴: 사람이 「이 이견만 더 봐」처럼 한 부분을 집으면, 그 부분만 같은 순서로 다시 말한다. 집지 않은 부분은 유지한다.",
    ].join("\n"),
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
