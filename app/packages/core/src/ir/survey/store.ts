import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { projectStudioDir } from "../../studio/studioStore.js";
import { PROPOSED_IR_FILE_NAME } from "../../studio/irStore.js";
import { compileSurvey } from "./compile.js";
import { surveyItem } from "./items.js";
import type { SurveyAnswers, SurveyContext } from "./model.js";

/**
 * 설문 답 — `~/.patchbay/projects/<alias>/ir.answers.yaml`.
 *
 * 답이 원본이고 `ir.proposed.yaml` 은 답에서 만든다. 설문으로 돌아오면 예전 답이 그대로 있다
 * (사용자 결정 2026-10-05). 승인되는 것은 여전히 IR 하나다 — 이 파일은 초안을 만드는 재료다.
 *
 * 사람이 초안을 직접 고쳤으면 설문이 그걸 덮지 않는다 (원칙 6). 만든 초안의 지문을 들고 있다가
 * 지금 초안과 다르면 멈춘다. 그래도 설문으로 다시 만들려면 옛 초안을 보관하고 덮는다.
 */

export const SURVEY_ANSWERS_FILE_NAME = "ir.answers.yaml";

interface AnswersFile {
  answers: SurveyAnswers;
  /** 설문이 마지막으로 쓴 초안의 지문. */
  compiled?: string;
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

export async function readSurveyAnswers(studioHome: string, alias: string): Promise<AnswersFile> {
  try {
    const raw = YAML.parse(await fs.readFile(path.join(projectStudioDir(studioHome, alias), SURVEY_ANSWERS_FILE_NAME), "utf8"));
    const answers = raw && typeof raw === "object" && raw.answers && typeof raw.answers === "object" ? raw.answers : {};
    return { answers, ...(typeof raw?.compiled === "string" ? { compiled: raw.compiled } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { answers: {} };
    throw error;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export type SaveSurveyResult =
  | { ok: true; draftFile: string; archived?: string }
  | { ok: false; status: 400 | 409; error: string; conflict?: boolean };

export function renderCompiledDraft(doc: Record<string, unknown>): string {
  return [
    `# ${doc.project} 설계(IR) 초안 — 설계 설문의 답에서 만들었다 (${SURVEY_ANSWERS_FILE_NAME}).`,
    "# 직접 고치면 설문은 이 파일을 덮지 않고 멈춘다. 설문으로 다시 만들려면 화면에서 「설문으로 다시 만들기」.",
    YAML.stringify(doc, { lineWidth: 0 }),
  ].join("\n");
}

/**
 * 답 하나를 저장하고 초안을 다시 만든다. `value === null` 은 답을 지운다.
 * `force` — 직접 고친 초안을 `ir.proposed.before-survey-<시각>.yaml` 로 보관하고 덮는다.
 */
export async function saveSurveyAnswer(
  studioHome: string,
  alias: string,
  input: { item: string; value: unknown; force?: boolean },
  ctx: SurveyContext,
  base: { project: string; graph?: string; version?: number },
  now: Date = new Date(),
): Promise<SaveSurveyResult> {
  if (!surveyItem(input.item)) return { ok: false, status: 400, error: `설문에 ${input.item} 문항이 없다.` };
  const dir = projectStudioDir(studioHome, alias);
  const draftFile = path.join(dir, PROPOSED_IR_FILE_NAME);
  const current = await readSurveyAnswers(studioHome, alias);
  const existing = await readText(draftFile);

  let archived: string | undefined;
  if (existing !== null && hash(existing) !== current.compiled) {
    if (!input.force) {
      return {
        ok: false,
        status: 409,
        conflict: true,
        error: "초안이 설문 밖에서 고쳐졌다 — 설문이 덮지 않는다. 옛 초안을 보관하고 설문으로 다시 만들려면 「설문으로 다시 만들기」.",
      };
    }
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    archived = path.join(dir, `ir.proposed.before-survey-${stamp}.yaml`);
    await fs.rename(draftFile, archived);
  }

  const answers = { ...current.answers };
  if (input.value === null || input.value === undefined) delete answers[input.item];
  else answers[input.item] = input.value;

  const text = renderCompiledDraft(compileSurvey(answers, ctx, base));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(draftFile, text, "utf8");
  await fs.writeFile(
    path.join(dir, SURVEY_ANSWERS_FILE_NAME),
    `# 설계 설문 답 — 이 답에서 ${PROPOSED_IR_FILE_NAME} 를 만든다.\n${YAML.stringify({ answers, compiled: hash(text) }, { lineWidth: 0 })}`,
    "utf8",
  );
  return { ok: true, draftFile, ...(archived ? { archived } : {}) };
}

/** 지금 초안의 프로젝트 이름 · 그래프 · 판 — 설문으로 다시 만들어도 이 셋은 지킨다. */
export async function surveyDraftBase(studioHome: string, alias: string): Promise<{ project: string; graph?: string; version?: number }> {
  const text = await readText(path.join(projectStudioDir(studioHome, alias), PROPOSED_IR_FILE_NAME));
  if (text === null) return { project: alias };
  try {
    const raw = YAML.parse(text);
    return {
      project: typeof raw?.project === "string" ? raw.project : alias,
      ...(typeof raw?.graph === "string" ? { graph: raw.graph } : {}),
      ...(typeof raw?.version === "number" ? { version: raw.version } : {}),
    };
  } catch {
    return { project: alias };
  }
}
