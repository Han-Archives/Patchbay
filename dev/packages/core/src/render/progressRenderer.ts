import type { Progress, ProgressEntry } from "../types/progress.js";

/**
 * Renders the progress surface (spec Phase 7): a project's `PROGRESS.md`
 * (L2) and the studio-wide `progress.md` rollup (L1 across every
 * registered project, spec 5.5: "포트폴리오 전체의 지금 뭐가 돌아가는지
 * 보여준다"). Pure functions -- no I/O, consume the data structures
 * `progressStore.ts` reads, never call it themselves (same split as
 * `atlasRenderer.ts`/`layers.ts`).
 */

/** Shown wherever there's no `current` entry to report -- a project that's never had `progress write` called, or whose most recent entry was superseded some other way. */
const IDLE_MESSAGE = "진행 중인 작업 없음";

function renderEntry(entry: ProgressEntry): string {
  const lines = [`- summary: ${entry.summary}`];
  if (entry.skill) lines.push(`  skill: ${entry.skill}`);
  if (entry.step) lines.push(`  step: ${entry.step}`);
  lines.push(`  timestamp: ${entry.timestamp}`);
  return lines.join("\n");
}

/**
 * Renders a project's `PROGRESS.md` (L2): the `current` entry, then a
 * `## History` list. History is rendered in the order `Progress.history`
 * already holds it -- `writeProgressEntry` (`progressStore.ts`) always
 * pushes the superseded `current` onto the *front* of `history`, so this
 * is most-recent-first without needing to re-sort here.
 */
export function renderProgressMd(progress: Progress): string {
  const currentSection = progress.current ? renderEntry(progress.current) : IDLE_MESSAGE;
  const historySection = progress.history.length === 0 ? IDLE_MESSAGE : progress.history.map(renderEntry).join("\n");

  return [
    "# Progress",
    "",
    "## Current",
    "",
    currentSection,
    "",
    "## History",
    "",
    historySection,
    "",
  ].join("\n");
}

/**
 * One-line summary of `progress`'s `current` entry -- used as the CLI's
 * `patchbay progress --project <alias>` (level 1, default) and the MCP
 * `get_progress` tool's level 1 (also default), computed on the spot from
 * `readProgress`'s result rather than a separate digest file (spec Phase 7:
 * no new digest file this phase, level 1 is computed, not stored).
 */
export function renderProgressLevel1(progress: Progress): string {
  if (!progress.current) return IDLE_MESSAGE;
  const parts = [progress.current.summary];
  if (progress.current.skill) parts.push(`skill: ${progress.current.skill}`);
  if (progress.current.step) parts.push(`step: ${progress.current.step}`);
  return parts.join(" — ");
}

/**
 * Renders the studio-wide `progress.md` rollup (L1 across ALL registered
 * projects, spec 5.5): one line per project showing its `current` summary
 * (plus skill/step if present) or an idle marker, so a human can scan the
 * whole portfolio's current activity at a glance. Consumes the array
 * `readAllProjectsProgress` returns -- doesn't call it itself.
 */
export function renderStudioProgressRollup(entries: { alias: string; progress: Progress }[]): string {
  const body =
    entries.length === 0
      ? "등록된 프로젝트 없음"
      : entries.map(({ alias, progress }) => `- **${alias}**: ${renderProgressLevel1(progress)}`).join("\n");

  return ["# Studio Progress", "", body, ""].join("\n");
}
