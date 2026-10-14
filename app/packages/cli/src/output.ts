/**
 * Thin output helpers shared by every command, so each one doesn't
 * reimplement the human/--json branch. `console.log`/`console.error`
 * (stdout/stderr) only -- no prompting, no reading from stdin anywhere in
 * this module (spec Phase 3 non-interactive contract).
 */

export function printResult(json: boolean, jsonPayload: unknown, lines: string[]): void {
  if (json) {
    console.log(JSON.stringify(jsonPayload));
    return;
  }
  for (const line of lines) console.log(line);
}

export function printError(json: boolean, message: string, jsonPayload?: unknown): void {
  if (json) {
    console.error(JSON.stringify(jsonPayload ?? { ok: false, error: message }));
    return;
  }
  console.error(message);
}
