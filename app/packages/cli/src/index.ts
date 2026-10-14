#!/usr/bin/env node
import { requireStudioHome } from "@patchbay/core";
import { Command } from "commander";
import { runAtlas } from "./commands/atlas.js";
import { runDecisionAdd } from "./commands/decisionAdd.js";
import { runFlow } from "./commands/flow.js";
import { runIrAdopt } from "./commands/irAdopt.js";
import { runIrCheck } from "./commands/irCheck.js";
import { runIrPrd } from "./commands/irPrd.js";
import { runEvalsRecord } from "./commands/evalsRecord.js";
import { runKnowledgeAudit } from "./commands/knowledgeAudit.js";
import { runKnowledgeDocs } from "./commands/knowledgeDocs.js";
import { runRunsCollect } from "./commands/runsCollect.js";
import { runRunsCompare } from "./commands/runsCompare.js";
import { runRunsDraftEvals } from "./commands/runsDraftEvals.js";
import { runVersionCompare } from "./commands/versionCompare.js";
import { runIrDiff } from "./commands/irDiff.js";
import { runIrGenerate } from "./commands/irGenerate.js";
import { runInit } from "./commands/init.js";
import { runBackup } from "./commands/backup.js";
import { runPatch } from "./commands/patch.js";
import { runProgress } from "./commands/progress.js";
import { runProgressWrite } from "./commands/progressWrite.js";
import { runProjectAdd } from "./commands/projectAdd.js";
import { runProjectNew } from "./commands/projectNew.js";
import { runProjectTriage } from "./commands/projectTriage.js";
import { runRoomMirror } from "./commands/roomMirror.js";
import { runScan } from "./commands/scan.js";
import { runSkillAccept } from "./commands/skillAccept.js";
import { runSkillDistill } from "./commands/skillDistill.js";

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

// 작업 공간을 여는 명령은 먼저 위치를 확인한다 — 틀리면 빈 작업 공간을 만들지 않고 멈춘다
// (저장구조.md 3절). 새로 만드는 명령, 작업 공간을 쓰지 않는 `project triage` 는 예외이고,
// 훅(`room mirror`)은 늘 0으로 끝나야 해서 안에서 확인한다.
const SKIP_STUDIO_CHECK = new Set(["init", "project add", "project new", "project triage", "room mirror"]);
program.hook("preAction", (_root, action) => {
  const names: string[] = [];
  for (let cmd: typeof action | null = action; cmd && cmd !== program; cmd = cmd.parent) names.unshift(cmd.name());
  if (SKIP_STUDIO_CHECK.has(names.join(" "))) return;
  requireStudioHome();
});

program
  .command("init")
  .description("Initialize the Patchbay studio home")
  .option("--name <name>", "studio name (defaults to the machine's hostname)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runInit(opts));
  });

program
  .command("backup")
  .description("Commit the studio home (작업 공간) to its private backup repo and push")
  .option("--message <message>", "commit message (defaults to a timestamp)")
  .option("--no-push", "commit only, do not push")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runBackup(opts));
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

project
  .command("triage")
  .description("Run a forensic scan (no LLM) over an unsorted folder and write excavation.json inside it")
  .requiredOption("--path <path>", "absolute path to the folder to triage")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runProjectTriage(opts));
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
  .command("flow")
  .description("Start the local Patchbay console (project / flow / knowledge / board)")
  .option("--project <alias>", "alias of the registered project (required if more than one is registered)")
  .option("--port <port>", "local port to listen on (default 4317)")
  .option(
    "--host <addr>",
    "address to bind (default 127.0.0.1; pass a tailnet address or 0.0.0.0 to view from another device -- the console has no login)",
  )
  .action(async (opts) => {
    process.exitCode = await runAction(() => runFlow(opts));
  });

const ir = program
  .command("ir")
  .description("Read, check, and generate from a project's IR — the agent graph's design (명세 20260929a)");

ir.command("check")
  .description("Run the 1.9 design rules over the IR and name the cell to go back to")
  .option("--project <alias>", "alias of the registered project")
  .option("--proposed", "check ir.proposed.yaml (the draft) instead of the approved overlay.ir")
  .option("--file <path>", "check an IR file at an arbitrary path (documents resolve beside it)")
  .option("--docs <dir>", "directory the IR's document paths are relative to")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runIrCheck(opts));
  });

ir.command("prd")
  .description("Draw ir.proposed.yaml as the 11-section PRD with a source on every line (명세 20261006a §14)")
  .option("--project <alias>", "alias of the registered project")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runIrPrd(opts));
  });

ir.command("adopt")
  .description("Adopt ir.proposed.yaml as the approved overlay.ir — the only write path (명세 §2.3)")
  .option("--project <alias>", "alias of the registered project")
  .option("--yes", "confirm replacing an already-approved IR (there is no --force for a failing check)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runIrAdopt(opts));
  });

ir.command("diff")
  .description("Show ir.proposed.yaml against the approved overlay.ir, section by section")
  .option("--project <alias>", "alias of the registered project")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runIrDiff(opts));
  });

ir.command("generate")
  .description("Write state.ts, graph.ts, and failing eval tests once — never overwrites existing files")
  .option("--project <alias>", "alias of the registered project")
  .option("--proposed", "generate from ir.proposed.yaml instead of the approved overlay.ir")
  .option("--file <path>", "generate from an IR file at an arbitrary path")
  .option("--docs <dir>", "directory the IR's document paths are relative to")
  .option("--out <dir>", "directory to write into (default: <project>/src/agent)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runIrGenerate(opts));
  });

const knowledge = program
  .command("knowledge")
  .description("Query the project's knowledge graph — 문서 호출과 복제본 점검 (기획서 3·4단계)");

knowledge
  .command("docs")
  .description("Find the documents within 1~2 hops of an anchor, each with its evidence path")
  .option("--project <alias>", "alias of the registered project")
  .option("--anchor <ref>", "where to start: a path, a name, or a port address (pick · D1 · guides/bug.md)")
  .option("--input <text>", "the input being routed — its words are what the ranking uses")
  .option("--hops <n>", "1 or 2 (default 2)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runKnowledgeDocs(opts));
  });

knowledge
  .command("audit")
  .description("Count the replica by label and warn when it holds nothing the scan did not already have")
  .option("--project <alias>", "alias of the registered project")
  .option("--origins", "also print each relation's source file and how to rebuild it (3.2)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runKnowledgeAudit(opts));
  });

const runs = program
  .command("runs")
  .description("Collect run records and hold them against the design — 5단계 운영 (명세 §5)");

runs
  .command("collect")
  .description("File a normalized §5.2 run record at runs/<runId>.json")
  .option("--project <alias>", "alias of the registered project")
  .option("--file <path>", "a run record, or an array of them, already normalized to §5.2")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runRunsCollect(opts));
  });

runs
  .command("compare")
  .description("Hold the collected runs against the approved design, and report cost-ceiling breaches")
  .option("--project <alias>", "alias of the registered project")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runRunsCompare(opts));
  });

runs
  .command("draft-evals")
  .description("Turn failing runs into evaluation drafts — writes ir.proposed.yaml only, never the approved design")
  .option("--project <alias>", "alias of the registered project")
  .option("--write", "add the drafts to ir.proposed.yaml (without this it only prints them)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runRunsDraftEvals(opts));
  });

const evals = program
  .command("evals")
  .description("Record the results of running a version's evals[] (Patchbay does not run them)");

evals
  .command("record")
  .description("File eval results for the design in force, so two versions can be compared later")
  .option("--project <alias>", "alias of the registered project")
  .option("--file <path>", "eval results JSON")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runEvalsRecord(opts));
  });

const version = program
  .command("version")
  .description("Put two design versions side by side — same eval set only (명세 §6.2)");

version
  .command("compare")
  .description("Compare v(n) and v(n+1) by eval score and cost; refuses when the eval set changed")
  .option("--project <alias>", "alias of the registered project")
  .option("--before <n>", "version to compare from (default: the newest archived one)")
  .option("--after <n>", "version to compare to (default: the design in force)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runVersionCompare(opts));
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

const skill = program.command("skill").description("Harvest a board segment into a Skill Bay draft (does not run the skill)");

skill
  .command("distill")
  .description("Write skills/<slug>.proposed/SKILL.md from the project's board.yaml")
  .option("--project <alias>", "alias of the registered project (required)")
  .option("--slug <slug>", "Bay slug (default from-<alias>)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runSkillDistill(opts));
  });

skill
  .command("accept")
  .description("Confirm a draft: move skills/<slug>.proposed to skills/<slug>")
  .argument("<slug>", "studio Skill Bay slug")
  .option("--json", "machine-readable output")
  .action(async (slug, opts) => {
    process.exitCode = await runAction(() => runSkillAccept(slug, opts));
  });

const decision = program
  .command("decision")
  .description("Record human decisions (spec 1.2 ontology: Decision --> Concept) in a project's overlay.yaml");

decision
  .command("add")
  .description("Append a decision to overlay.yaml for a registered project")
  .option("--project <alias>", "alias of the registered project (required)")
  .option("--summary <text>", "what was decided (required)")
  .option("--concept <id>", "Concept id this decision relates to (default: the project alias)")
  .option("--rationale <text>", "why, if useful")
  .option("--date <iso>", "ISO 8601 date/time (default: now)")
  .option("--id <id>", "decision id (default: generated)")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runDecisionAdd(opts));
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
  .option("--asked <text>", "what the person asked for, in their own terms")
  .option("--did <text>", "what was actually built or changed for it")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    process.exitCode = await runAction(() => runProgressWrite(opts));
  });

const room = program.command("room").description("Conversation rooms (the console's right-hand chat)");

room
  .command("mirror")
  .description(
    "Claude Code hook (UserPromptSubmit/Stop): copy this session's dialogue into the room it bound with MCP room_bind. Reads the hook JSON on stdin; always exits 0",
  )
  .action(async () => {
    process.exitCode = await runRoomMirror();
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
