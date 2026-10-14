import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface FlowCommandOptions {
  project?: string;
  port?: string;
  host?: string;
}

/**
 * `patchbay flow [--project <alias>] [--port <n>] [--host <addr>]` -- spawns
 * `@patchbay/flow`'s built server as a child process, inheriting stdio. A
 * short-lived, manually started foreground process, never a daemon.
 *
 * `--project`/`--port`/`--host` are passed via environment variables rather
 * than argv, since the child is a plain `node <entrypoint>` with no argument
 * parser of its own (see `apps/flow/src/serve.ts`). `--host` defaults to the
 * loopback there; a remote address is an explicit choice.
 */
export async function runFlow(options: FlowCommandOptions): Promise<number> {
  const entrypoint = fileURLToPath(import.meta.resolve("@patchbay/flow/dist-server/serve.js"));

  const env = { ...process.env };
  if (options.project) env.PATCHBAY_FLOW_PROJECT = options.project;
  if (options.port) env.PATCHBAY_FLOW_PORT = options.port;
  if (options.host) env.PATCHBAY_FLOW_HOST = options.host;

  return new Promise<number>((resolve, reject) => {
    const child = spawn("node", [entrypoint], { stdio: "inherit", env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
