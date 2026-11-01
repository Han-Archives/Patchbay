import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectStudioDir } from "../studio/studioStore.js";

/**
 * 평가 근거 -- what the person scoring an eval looks at (사용자 결정 2026-10-31).
 *
 * Whoever ran the eval (a session, a script) files what it did, what it saw and
 * the screenshots or output it captured, at the moment it ran. The Review screen
 * shows it beside the 통과 · 실패 · 건너뜀 choice, so a score is judged on the
 * thing that was evaluated -- not on today's screen, which may have moved on.
 *
 * Kept per design version (`eval-evidence/v<n>/<evalId>/`), so adopting the next
 * version needs nothing moved.
 */

export const EVAL_EVIDENCE_DIR_NAME = "eval-evidence";
export const EVAL_EVIDENCE_FILE_NAME = "evidence.json";
/** What can be attached: pictures the screen shows, and text output. */
export const EVAL_EVIDENCE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".md", ".json", ".log"] as const;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SAFE_NAME = /^[^/\\\x00-\x1f]+$/;

export const evalEvidenceSchema = z.object({
  evalId: z.string().min(1),
  irVersion: z.number().int().positive(),
  at: z.string(),
  /** What was done to run it. */
  how: z.string().default(""),
  /** What was seen. */
  observed: z.string().default(""),
  /** Attached file names, in the order to show them. */
  files: z.array(z.string()).default([]),
  /**
   * Where the console shows this today -- a work place (`test`, `files`, ...)
   * or `room:<id>`. Only a link: the evidence is the record, the screen is for comparing.
   */
  screen: z.string().optional(),
});
export type EvalEvidence = z.infer<typeof evalEvidenceSchema>;

export interface EvalEvidenceInput {
  evalId: string;
  irVersion: number;
  how?: string;
  observed?: string;
  /** Local paths to copy in. */
  files?: string[];
  screen?: string;
}

export function evalEvidenceDir(studioHome: string, alias: string, irVersion: number, evalId?: string): string {
  const base = path.join(projectStudioDir(studioHome, alias), EVAL_EVIDENCE_DIR_NAME, `v${irVersion}`);
  return evalId === undefined ? base : path.join(base, evalId);
}

export type WriteEvalEvidenceResult = { ok: true; evidence: EvalEvidence; dir: string } | { ok: false; error: string };

/** Files (or replaces) one eval's evidence. Earlier attachments are kept unless the same name comes again. */
export async function writeEvalEvidence(studioHome: string, alias: string, input: EvalEvidenceInput): Promise<WriteEvalEvidenceResult> {
  if (!SAFE_NAME.test(input.evalId) || input.evalId === "." || input.evalId === "..") return { ok: false, error: `평가 id가 이름으로 쓸 수 없다: ${input.evalId}` };
  const sources = input.files ?? [];
  for (const file of sources) {
    const ext = path.extname(file).toLowerCase();
    if (!(EVAL_EVIDENCE_EXTENSIONS as readonly string[]).includes(ext)) {
      return { ok: false, error: `${path.basename(file)} — 붙일 수 있는 형식이 아니다 (${EVAL_EVIDENCE_EXTENSIONS.join(" ")}).` };
    }
    let size: number;
    try { size = (await fs.stat(file)).size; } catch { return { ok: false, error: `${file} 가 없다.` }; }
    if (size > MAX_FILE_BYTES) return { ok: false, error: `${path.basename(file)} 가 10MB를 넘는다.` };
  }
  const names = sources.map((file) => path.basename(file));
  if (new Set(names).size !== names.length) return { ok: false, error: "같은 이름의 파일을 두 번 붙였다." };

  const dir = evalEvidenceDir(studioHome, alias, input.irVersion, input.evalId);
  await fs.mkdir(dir, { recursive: true });
  const before = await readOne(dir);
  for (const [index, file] of sources.entries()) await fs.copyFile(file, path.join(dir, names[index]!));
  const evidence: EvalEvidence = {
    evalId: input.evalId,
    irVersion: input.irVersion,
    at: new Date().toISOString(),
    how: input.how ?? before?.how ?? "",
    observed: input.observed ?? before?.observed ?? "",
    files: [...(before?.files ?? []).filter((name) => !names.includes(name)), ...names],
    ...((input.screen ?? before?.screen) ? { screen: input.screen ?? before?.screen } : {}),
  };
  const target = path.join(dir, EVAL_EVIDENCE_FILE_NAME);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await fs.rename(temp, target);
  return { ok: true, evidence, dir };
}

async function readOne(dir: string): Promise<EvalEvidence | null> {
  try {
    const parsed = evalEvidenceSchema.safeParse(JSON.parse(await fs.readFile(path.join(dir, EVAL_EVIDENCE_FILE_NAME), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Every eval's evidence for one version, keyed by eval id. A broken entry is skipped, not fatal. */
export async function readEvalEvidence(studioHome: string, alias: string, irVersion: number): Promise<Record<string, EvalEvidence>> {
  const base = evalEvidenceDir(studioHome, alias, irVersion);
  let entries: string[];
  try { entries = await fs.readdir(base); } catch { return {}; }
  const out: Record<string, EvalEvidence> = {};
  for (const name of entries.sort()) {
    const evidence = await readOne(path.join(base, name));
    if (evidence && evidence.evalId === name) out[name] = evidence;
  }
  return out;
}

/** The path of one attachment, or null if the name is not one this evidence lists. */
export async function evalEvidenceFilePath(studioHome: string, alias: string, irVersion: number, evalId: string, name: string): Promise<string | null> {
  if (!SAFE_NAME.test(evalId) || !SAFE_NAME.test(name) || evalId === ".." || name === "..") return null;
  const dir = evalEvidenceDir(studioHome, alias, irVersion, evalId);
  const evidence = await readOne(dir);
  return evidence?.files.includes(name) ? path.join(dir, name) : null;
}
