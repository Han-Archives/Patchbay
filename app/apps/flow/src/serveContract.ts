/** Bind address for the console server (`patchbay flow`). No view types here -- process-level only. */

/**
 * The console has no login and `/api/source` serves file contents, so the
 * address it listens on *is* its access control. `@hono/node-server` calls
 * `server.listen(port, hostname)`; with `hostname` undefined Node binds every
 * interface, which on a Tailscale network hands the whole tailnet a reader.
 * So the default is the loopback.
 *
 * Remote viewing from a phone (`docs/절차/mobile-remote-flow_20260925_v1.md`)
 * stays possible as an explicit opt-in: `--host 0.0.0.0`, or better, the
 * machine's tailnet address so the LAN is not included.
 */
export const DEFAULT_FLOW_HOST = "127.0.0.1";

/** `override` is already the CLI/env value. Empty/missing → the loopback. */
export function resolveFlowHost(override?: string): string {
  const raw = override?.trim();
  return raw ? raw : DEFAULT_FLOW_HOST;
}

/** Only these reach the console from this machine alone -- anything else is a remote listener. */
export function isLoopbackHost(host: string): boolean {
  return host === DEFAULT_FLOW_HOST || host === "localhost" || host === "::1";
}

/**
 * A bind address is not always an address you can dial: `0.0.0.0` and `::`
 * mean "every interface", so the browser gets `localhost` instead.
 */
export function dialHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "localhost";
  if (host === "::1") return "[::1]";
  return host;
}
