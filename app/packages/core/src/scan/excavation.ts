import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { DUPLICATE_PATTERNS } from "../clarity/clarityScore.js";
import { excavationSchema, type Excavation } from "../types/excavation.js";
import { walk, type WalkedFile } from "./fileWalker.js";

/**
 * The forensic scan (spec 6.3/9.7, Phase 9) -- deliberately a *different*
 * scan mode from `scan()` in `scanner.ts`, not an extension of it: no
 * PortId/ontology concept, and (unlike `scan()`) intentionally wall-clock
 * sensitive (`modificationDistribution` needs a "now" to bucket ages
 * against). Still no LLM, no network calls beyond local git.
 */

const EXCAVATION_FILE_NAME = "excavation.json";

/** Basenames (case-insensitive) allowed to be the sole file in their directory without being flagged as an orphan candidate. */
const EXPECTED_LONE_FILE_PATTERN =
  /^(readme|license|licence|changelog|contributing|claude|agents)(\..+)?$|^\.gitignore$|^\.gitattributes$|^\.editorconfig$|^\.env(\..+)?$|^package\.json$|^index\.[a-z0-9]+$/i;

/** Extensions never worth reading for TODO/FIXME density -- binary/media/lock formats. */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".mov", ".wav", ".avi", ".webm",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".wasm", ".bin",
  ".lock",
]);

/** Files larger than this are skipped for TODO/FIXME scanning -- not worth reading wholesale for a heuristic. */
const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;

const TODO_PATTERN = /\b(TODO|FIXME)\b/g;

const MODIFICATION_BUCKETS: ReadonlyArray<{ label: string; maxAgeDays: number | null }> = [
  { label: "7d", maxAgeDays: 7 },
  { label: "30d", maxAgeDays: 30 },
  { label: "90d", maxAgeDays: 90 },
  { label: "365d", maxAgeDays: 365 },
  { label: "365d+", maxAgeDays: null },
];

async function readGitQuality(rootDir: string): Promise<Excavation["git"]> {
  const git = simpleGit(rootDir);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) return { isRepo: false, commitCount: 0, uniqueCommitRatio: 0 };

  // Full log, not capped at 20 like gitReader's `recentCommitSubjects` --
  // this is a quality signal over the whole history, not a display list.
  const log = await git.log().catch(() => undefined);
  const subjects = log ? log.all.map((entry) => entry.message) : [];
  const commitCount = subjects.length;
  const uniqueCommitRatio = commitCount === 0 ? 0 : new Set(subjects).size / commitCount;
  return { isRepo: true, commitCount, uniqueCommitRatio };
}

function findReadme(files: WalkedFile[]): WalkedFile | undefined {
  return files.find((file) => /^README(\..+)?$/i.test(path.posix.basename(file.relativePath)));
}

function readReadmeQuality(files: WalkedFile[]): Excavation["readme"] {
  const readme = findReadme(files);
  if (!readme) return { exists: false, wordCount: 0 };

  let content: string;
  try {
    content = fs.readFileSync(readme.absolutePath, "utf8");
  } catch {
    return { exists: true, wordCount: 0 };
  }
  const trimmed = content.trim();
  return { exists: true, wordCount: trimmed === "" ? 0 : trimmed.split(/\s+/).length };
}

function findDuplicateMatches(files: WalkedFile[]): Excavation["duplicateMatches"] {
  const matches: Excavation["duplicateMatches"] = [];
  for (const file of files) {
    const base = path.posix.basename(file.relativePath);
    for (const pattern of DUPLICATE_PATTERNS) {
      if (base.includes(pattern)) matches.push({ relativePath: file.relativePath, pattern });
    }
  }
  return matches;
}

function bucketModificationDates(files: WalkedFile[], now: Date): Excavation["modificationDistribution"] {
  const counts = MODIFICATION_BUCKETS.map(() => 0);

  for (const file of files) {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file.absolutePath).mtimeMs;
    } catch {
      continue; // race with a delete -- skip rather than fail the whole excavation
    }
    const ageDays = (now.getTime() - mtimeMs) / (1000 * 60 * 60 * 24);
    const foundIndex = MODIFICATION_BUCKETS.findIndex((bucket) => bucket.maxAgeDays === null || ageDays <= bucket.maxAgeDays);
    const bucketIndex = foundIndex === -1 ? MODIFICATION_BUCKETS.length - 1 : foundIndex;
    counts[bucketIndex] = (counts[bucketIndex] ?? 0) + 1;
  }

  return MODIFICATION_BUCKETS.map((bucket, index) => ({ ...bucket, fileCount: counts[index]! }));
}

function findOrphanFiles(files: WalkedFile[]): string[] {
  const byDir = new Map<string, WalkedFile[]>();
  for (const file of files) {
    const dir = path.posix.dirname(file.relativePath);
    const bucket = byDir.get(dir);
    if (bucket) bucket.push(file);
    else byDir.set(dir, [file]);
  }

  const orphans: string[] = [];
  for (const bucket of byDir.values()) {
    if (bucket.length !== 1) continue;
    const [lone] = bucket;
    if (!EXPECTED_LONE_FILE_PATTERN.test(path.posix.basename(lone!.relativePath))) {
      orphans.push(lone!.relativePath);
    }
  }
  return orphans.sort();
}

function scanTodoDensity(files: WalkedFile[]): Excavation["todoDensity"] {
  let totalMatches = 0;
  let filesWithMatches = 0;
  let scannedTextFiles = 0;

  for (const file of files) {
    if (BINARY_EXTENSIONS.has(path.posix.extname(file.relativePath).toLowerCase())) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(file.absolutePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_TEXT_SCAN_BYTES) continue;

    let content: string;
    try {
      content = fs.readFileSync(file.absolutePath, "utf8");
    } catch {
      continue;
    }

    scannedTextFiles += 1;
    const matchCount = content.match(TODO_PATTERN)?.length ?? 0;
    if (matchCount > 0) {
      totalMatches += matchCount;
      filesWithMatches += 1;
    }
  }

  return { totalMatches, filesWithMatches, scannedTextFiles };
}

export interface ExcavateOptions {
  /** Injectable clock, so `modificationDistribution` is testable deterministically. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Runs the forensic scan (no LLM) against `rootDir` and returns a value
 * matching `excavationSchema`. Never writes anything -- pair with
 * `writeExcavation` to persist the result at `<rootDir>/excavation.json`.
 */
export async function excavate(rootDir: string, options: ExcavateOptions = {}): Promise<Excavation> {
  const absoluteRoot = path.resolve(rootDir);
  const now = options.now ?? new Date();
  const files = walk(absoluteRoot);

  const result: Excavation = {
    scannedAt: now.toISOString(),
    totalFiles: files.length,
    git: await readGitQuality(absoluteRoot),
    readme: readReadmeQuality(files),
    duplicateMatches: findDuplicateMatches(files),
    modificationDistribution: bucketModificationDates(files, now),
    orphanFiles: findOrphanFiles(files),
    todoDensity: scanTodoDensity(files),
  };

  return excavationSchema.parse(result);
}

export function excavationFilePath(projectPath: string): string {
  return path.join(projectPath, EXCAVATION_FILE_NAME);
}

/** Overwrites `<projectPath>/excavation.json` wholesale. Returns the absolute path written. */
export async function writeExcavation(projectPath: string, excavation: Excavation): Promise<string> {
  const validated = excavationSchema.parse(excavation);
  const filePath = excavationFilePath(projectPath);
  await fs.promises.writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return filePath;
}
