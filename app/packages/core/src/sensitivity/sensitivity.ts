/**
 * Content sensitivity levels for a project's files.
 *
 * NOT user roles: Patchbay is a single-user localhost tool with no login and
 * nobody to authorize (기획 §4 rules out a multi-user SaaS). These grade the
 * *content*, so each surface can decide what it is allowed to emit -- the
 * console's file peek, an MCP bundle sent to a model, anything shared onward.
 *
 * The scale is fixed; what assigns a level is not. Today only two levels have
 * built-in rules -- L4 from the secret patterns below, L0 from the signal
 * files every project publishes -- and everything else is L2. L1 is a
 * projection rather than a file property (Atlas already shows names without
 * contents), and L3 depends on what a given project considers third-party, so
 * it needs a per-project declaration that does not exist yet. Levels without
 * a rule are left unassigned rather than guessed at.
 */

export const SENSITIVITY_LEVELS = [0, 1, 2, 3, 4] as const;
export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];

/** Never read, never sent, never rendered. */
export const SECRET_LEVEL = 4 satisfies SensitivityLevel;
/** Safe to send to a model or share onward. */
export const PUBLIC_LEVEL = 0 satisfies SensitivityLevel;
/** A project's own working files -- the default when no rule matches. */
export const WORKING_LEVEL = 2 satisfies SensitivityLevel;

export const SENSITIVITY_LABELS: Record<SensitivityLevel, string> = {
  0: "공개",
  1: "구조",
  2: "작업",
  3: "원본",
  4: "비밀",
};

export interface SensitivityVerdict {
  level: SensitivityLevel;
  /** One line naming the rule, shown to whoever was refused. */
  reason: string;
}

/** A path segment that makes everything under it a secret. */
const SECRET_DIRS = new Set([".ssh", ".gnupg", ".aws", ".gcloud", "secrets", ".secrets"]);

/** Exact filenames that are secrets wherever they sit. */
const SECRET_NAMES = new Set([
  ".netrc",
  ".npmrc",
  ".pgpass",
  ".htpasswd",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
]);

/** Extensions that carry key material. */
const SECRET_EXTENSIONS = new Set([".asc", ".gpg", ".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"]);

const ENV_FILE = /^\.env(\..+)?$/;
const DOTTED_ENV = /\.env$/;
const SERVICE_ACCOUNT = /^service-account.*\.json$/;
const README = /^README\..+$/;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Grades a project-relative POSIX path. Pure -- it reads the path, never the
 * file, so classifying a secret never opens one.
 */
export function classifyPath(relPath: string): SensitivityVerdict {
  const segments = relPath.split("/").filter(Boolean);
  const name = segments.at(-1) ?? relPath;
  const lower = name.toLowerCase();

  for (const segment of segments.slice(0, -1)) {
    if (SECRET_DIRS.has(segment.toLowerCase())) {
      return { level: SECRET_LEVEL, reason: `비밀 폴더 "${segment}" 안입니다` };
    }
  }
  if (ENV_FILE.test(name) || DOTTED_ENV.test(lower)) {
    return { level: SECRET_LEVEL, reason: "환경변수 파일입니다" };
  }
  if (SECRET_NAMES.has(lower) || SERVICE_ACCOUNT.test(lower)) {
    return { level: SECRET_LEVEL, reason: `자격 증명 파일 이름("${name}")입니다` };
  }
  if (SECRET_EXTENSIONS.has(extensionOf(lower))) {
    return { level: SECRET_LEVEL, reason: `키 확장자("${extensionOf(lower)}")입니다` };
  }

  const inCursorRules = segments[0] === ".cursor" && segments[1] === "rules";
  if (README.test(name) || name === "AGENTS.md" || name === "CLAUDE.md" || inCursorRules) {
    return { level: PUBLIC_LEVEL, reason: "프로젝트가 공개하는 신호 파일입니다" };
  }

  return { level: WORKING_LEVEL, reason: "프로젝트 작업 파일입니다" };
}

/** True when `level` may not leave the machine or reach a model. */
export function isSecret(level: SensitivityLevel): boolean {
  return level >= SECRET_LEVEL;
}
