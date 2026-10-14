import { appendDecision, newDecision, readStudio, resolveStudioHome } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface DecisionAddOptions {
  project?: string;
  concept?: string;
  summary?: string;
  rationale?: string;
  date?: string;
  id?: string;
  json?: boolean;
}

/**
 * `patchbay decision add --project <alias> --summary "<text>" [--concept <id>]
 *   [--rationale <text>] [--date <iso>] [--id <id>] [--json]`
 *
 * `decisions` has had a schema (`decisionSchema`) and a 프로젝트 tab reader
 * since Phase 0, but no writer anywhere in Core/CLI/MCP -- this is the
 * first one (spec 1.2, "Decision --> Concept"). `--concept` is optional
 * because Concepts themselves have no writer or resolver yet either
 * (`ontology/<alias>.proposed.yaml`'s `concepts:` is always empty in
 * practice); defaulting it to the project alias keeps this usable without
 * forcing a second unimplemented subsystem on the caller.
 *
 * Exit codes:
 *   0 - recorded, overlay.yaml regenerated
 *   1 - missing --project/--summary, or --project isn't a registered alias
 *
 * Never prompts.
 */
export async function runDecisionAdd(
  options: DecisionAddOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);

  if (!options.project) {
    printError(json, "decision add: --project <alias> is required.");
    return 1;
  }
  if (!options.summary) {
    printError(json, "decision add: --summary <text> is required.");
    return 1;
  }

  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === options.project);
  if (!registered) {
    const knownAliases = studio.projects.map((project) => project.alias);
    printError(
      json,
      `decision add: no project registered with alias "${options.project}". ` +
        (knownAliases.length > 0
          ? `Registered aliases: ${knownAliases.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    );
    return 1;
  }

  const decision = newDecision(registered.alias, {
    summary: options.summary,
    rationale: options.rationale,
    concept: options.concept,
    id: options.id,
    date: options.date,
  });

  try {
    const overlay = await appendDecision(studioHome, registered.alias, decision);
    printResult(json, { ok: true, alias: registered.alias, decision }, [
      `Recorded decision "${decision.id}" for "${registered.alias}": ${decision.summary}`,
      `overlay.yaml now has ${overlay.decisions.length} decision(s).`,
    ]);
    return 0;
  } catch (error) {
    printError(json, error instanceof Error ? error.message : String(error));
    return 1;
  }
}
