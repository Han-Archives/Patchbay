#!/usr/bin/env node
import { Command } from "commander";
import { runAtlas } from "./commands/atlas.js";
import { runInit } from "./commands/init.js";
import { runPatch } from "./commands/patch.js";
import { runProgress } from "./commands/progress.js";
import { runProgressWrite } from "./commands/progressWrite.js";
import { runProjectAdd } from "./commands/projectAdd.js";
import { runProjectNew } from "./commands/projectNew.js";
import { runScan } from "./commands/scan.js";

/**
 * CLI composition root (spec Phase 3): parse argv, call Core functions,
 * print output, set the exit code. No studio-home file I/O happens here
 * directly -- it all lives in `@patchbay/core`'s `studio/` module.
 *
 * Never prompts: `!process.stdin.isTTY` or `--json` both mean "don't
 * prompt" per the spec, and in this phase there is no prompting content at
 * all yet (Phase 9), so that rule is satisfied trivially -- nothing here
 * ever calls `readline` or similar.
 */
async function runAction(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const program = new Command();
program.name("patchbay").description("Patchbay CLI").version("0.0.0");
// Must be set before any `.command()` calls below -- subcommands copy the
// parent's exit-override callback at creation time, not at parse time.
program.exitOverride();

program
  .command("init")
  .description("Initialize the Patchbay studio home")
  .option("--name <name>", "studio name (defaults to the machine's hostname)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runInit(opts));
  });

const project = program.command("project").description("Manage registered projects");

project
  .command("add")
  .description("Register an existing project with the studio and scan it")
  .requiredOption("--path <path>", "absolute path to the existing project")
  .option("--alias <alias>", "alias to register under (defaults to the directory's basename)")
  .option("--force-add", "register even if the clarity score is below the triage threshold")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runProjectAdd(opts));
  });

project
  .command("new")
  .description("Create and register a brand-new project (design interview not yet implemented)")
  .argument("<alias>", "alias to register the new project under")
  .requiredOption("--path <path>", "absolute path for the new project directory")
  .option("--json", "machine-readable output")
  .action(async (alias, opts) => {
    process.exitCode = await runAction(() => runProjectNew(alias, opts));
  });

program
  .command("scan")
  .description("Re-scan a registered project and regenerate inferred.json/ATLAS.md/FLOW.md")
  .option("--project <alias>", "alias of the registered project (required if more than one is registered)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runScan(opts));
  });

program
  .command("atlas")
  .description("Print a registered project's Atlas to stdout")
  .option("--project <alias>", "alias of the registered project (required if more than one is registered)")
  .option("--level <level>", "layer to print: 1 (digest), 2 (ATLAS.md, default), or 3 (inferred.json)", "2")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runAtlas(opts));
  });

program
  .command("patch")
  .description("Install a Skill Bay skill into a registered project and record the resulting wire")
  .argument("<skill>", "studio Skill Bay slug (no skill: prefix)")
  .argument("<project>", "alias of the registered project to install into")
  .option("--json", "machine-readable output")
  .action(async (skill, projectAlias, opts) => {
    process.exitCode = await runAction(() => runPatch(skill, projectAlias, opts));
  });

const progress = program
  .command("progress")
  .description("Show progress: the studio-wide rollup (no --project), or one project's progress");

// The read behavior (`patchbay progress [--project] [--level]`) is
// registered as a *hidden default* subcommand rather than options directly
// on `progress` itself. Commander parses a subcommand's own args by first
// stripping its name off as a bare "operand" at the parent's parse pass and
// only afterwards handing the rest to `progress`'s parser -- so if
// `progress` declared its own `--project`/`--level` options directly, a
// colliding `--project`/`--level` typed after `progress write` would be
// consumed by `progress`'s parser before `write`'s own parser ever saw it
// (verified directly against commander@12's `_dispatchSubcommand`/
// `_parseCommand`). Giving `progress` itself zero options -- exactly like
// the existing `project` namespace command above, which also has no options
// of its own -- sidesteps the collision entirely; `isDefault: true` makes
// `patchbay progress ...` dispatch here without the caller ever typing a
// subcommand name, and `hidden: true` keeps that implementation detail out
// of `--help` output.
progress
  .command("show", { isDefault: true, hidden: true })
  .description("Show progress: the studio-wide rollup (no --project), or one project's progress")
  .option("--project <alias>", "alias of a registered project (omit for the studio-wide rollup)")
  .option("--level <level>", "layer to print for --project: 1 (summary, default), 2 (PROGRESS.md), or 3 (raw progress.yaml)")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runProgress(opts));
  });

progress
  .command("write")
  .description(
    "Record a new current-progress entry for a project, regenerating progress.yaml, PROGRESS.md, and the studio-wide progress.md",
  )
  .option("--project <alias>", "alias of the registered project (required)")
  .option("--summary <text>", "freeform description of what is currently being worked on (required)")
  .option("--skill <slug>", "skill port/slug being run, if any")
  .option("--step <name>", "named step within that skill, if any")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runProgressWrite(opts));
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  // commander throws a CommanderError (e.g. missing --path, unknown
  // command) instead of calling process.exit directly because of
  // exitOverride() above -- translate that into our own exit-code contract
  // (bad/missing arguments -> exit 1) instead of letting it crash the
  // process with a stack trace. Commander has already written its own
  // message to stderr by this point (`Command.error()` does that
  // unconditionally), so this branch only sets the exit code -- it must
  // not print the message again.
  const commanderExitCode = (error as { exitCode?: unknown }).exitCode;
  const isCommanderError = typeof (error as { code?: unknown }).code === "string";
  if (!isCommanderError) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = typeof commanderExitCode === "number" ? commanderExitCode : 1;
}
