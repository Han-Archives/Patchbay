import fs from "node:fs";
import {
  projectDocs,
  computeAtlasCounts,
  computeAtlasSections,
  computeClarityScore,
  hasReadmePort,
  readInferred,
  readOverlay,
  readProgress,
  readStudio,
  renderProgressLevel1,
  walk,
  type Inferred,
  type Overlay,
  type Patch,
  type Wire,
  designSummary,
  readProposedIr,
} from "@patchbay/core";
import { isBrokenScanError, type DecisionView, type GapView, type ProgressCurrentView, type ProjectViewResponse } from "./projectContract.js";
import { syncPlanMemoryToProcess, toProcessView } from "./processView.js";

export type LoadProjectViewResult =
  | { ok: true; body: ProjectViewResponse }
  | { ok: false; status: 400 | 404; error: string };

function toGap(entry: Patch | Wire): GapView {
  return { from: entry.from, to: entry.to, kind: entry.kind };
}

function toProgressView(entry: {
  project: string;
  summary: string;
  skill?: string;
  step?: string;
  asked?: string;
  did?: string;
  timestamp: string;
}): ProgressCurrentView {
  return {
    project: entry.project,
    summary: entry.summary,
    skill: entry.skill,
    step: entry.step,
    asked: entry.asked,
    did: entry.did,
    timestamp: entry.timestamp,
  };
}

function toDecisionView(entry: Overlay["decisions"][number]): DecisionView {
  return {
    id: entry.id,
    concept: entry.concept,
    summary: entry.summary,
    rationale: entry.rationale,
    date: entry.date,
  };
}

function clarityForPath(projectPath: string, inferred: Inferred): number | null {
  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    return null;
  }
  return computeClarityScore({
    hasReadme: hasReadmePort(inferred),
    commitSubjects: inferred.git.recentCommitSubjects,
    allRelativePaths: walk(projectPath).map((file) => file.relativePath),
  });
}

/**
 * Studio files in, Core aggregations out. The console must not invent a
 * second Atlas model -- `computeAtlasSections` is the same function ATLAS.md uses.
 */
export async function loadProjectView(studioHome: string, alias: string | undefined): Promise<LoadProjectViewResult> {
  if (!alias) {
    return { ok: false, status: 400, error: "project: alias query parameter is required." };
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    const known = studio.projects.map((project) => project.alias);
    return {
      ok: false,
      status: 404,
      error:
        `No project registered with alias "${alias}". ` +
        (known.length > 0
          ? `Registered aliases: ${known.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    };
  }

  const draft = await readProposedIr(studioHome, alias);
  const design = draft.ok ? designSummary(draft.raw) : null;

  let inferred;
  try {
    inferred = await readInferred(studioHome, alias);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (missing || isBrokenScanError(error)) {
      const process = await syncPlanMemoryToProcess(studioHome, alias, registered.path, undefined, projectDocs(registered));
      return {
        ok: true,
        body: {
          status: "unscanned",
          alias,
          path: registered.path,
          process: toProcessView(process, registered.path, projectDocs(registered)),
          design,
          ...(missing ? {} : { broken: (error as Error).message }),
        },
      };
    }
    throw error;
  }

  const overlay: Overlay = await readOverlay(studioHome, alias);
  const process = await syncPlanMemoryToProcess(studioHome, alias, registered.path, undefined, projectDocs(registered));
  const sections = computeAtlasSections(inferred, overlay);
  const progress = await readProgress(studioHome, alias);

  return {
    ok: true,
    body: {
      status: "ok",
      alias,
      path: registered.path,
      counts: computeAtlasCounts(sections),
      sections: {
        skills: sections.skills,
        rules: sections.rules,
        unlabeledPorts: sections.unlabeledPorts,
        matched: sections.matched.map((pair) => toGap(pair.patch)),
        patchesWithoutWire: sections.patchesWithoutWire.map(toGap),
        wiresWithoutPatch: sections.wiresWithoutPatch.map(toGap),
      },
      progress: {
        current: progress.current ? toProgressView(progress.current) : null,
        history: progress.history.map(toProgressView),
      },
      currentLine: renderProgressLevel1(progress),
      decisions: overlay.decisions.map(toDecisionView),
      process: toProcessView(process, registered.path, projectDocs(registered)),
      clarity: clarityForPath(registered.path, inferred),
      git: { branch: inferred.git.branch, head: inferred.git.head },
      design,
    },
  };
}
