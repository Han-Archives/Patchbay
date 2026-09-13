import { simpleGit } from "simple-git";
import type { InferredGitInfo } from "../types/inferred.js";

/** Hard cap on recentCommitSubjects (spec Phase 2). */
const MAX_RECENT_COMMITS = 20;

/**
 * Reads local git metadata for `rootDir` via `simple-git`.
 *
 * Deliberately local-only: never runs `git fetch`/`git ls-remote`, and
 * never computes ahead/behind counts against a remote — that is an
 * intentional v1 exclusion (spec 7.8), not an oversight. There is no field
 * for it in `inferredGitInfoSchema`, so there is nothing to compute it for.
 *
 * Fallback behavior (a judgment call, since the spec only says "decide
 * something sensible"):
 *  - Not a git repo at all -> `{ branch: "", head: "", recentCommitSubjects: [] }`.
 *  - A git repo with zero commits yet (freshly `git init`'d, nothing
 *    committed) -> `branch` still resolves (via the symbolic HEAD ref,
 *    which exists before any commit), but `head` is `""` and
 *    `recentCommitSubjects` is `[]`, since there is no commit to name.
 * Never throws for either case — a scan should succeed on any folder.
 */
export async function readGitInfo(rootDir: string): Promise<InferredGitInfo> {
  const git = simpleGit(rootDir);

  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    return { branch: "", head: "", recentCommitSubjects: [] };
  }

  // `rev-parse --abbrev-ref HEAD` resolves the branch name off the
  // symbolic HEAD ref even before the first commit exists, unlike
  // `branchLocal()` (which lists refs/heads/* and is empty pre-commit).
  const branch = await git
    .revparse(["--abbrev-ref", "HEAD"])
    .then((value) => value.trim())
    .catch(() => "");

  // `rev-parse HEAD` fails with no commits yet ("ambiguous argument HEAD") —
  // fall back to "" rather than throwing.
  const head = await git
    .revparse(["HEAD"])
    .then((value) => value.trim())
    .catch(() => "");

  const log = await git.log({ maxCount: MAX_RECENT_COMMITS }).catch(() => undefined);
  const recentCommitSubjects = log ? log.all.map((entry) => entry.message) : [];

  return { branch, head, recentCommitSubjects };
}
