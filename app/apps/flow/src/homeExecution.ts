import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import type { StudioRegisteredProject } from "@patchbay/core";
import { dayKey, type HomeExecutionGroup } from "./homeContract.js";

interface Sample { id: string; cwd: string; at: string; failed: boolean; source: "Claude" | "Codex" }
interface Parsed { samples: Sample[]; rejected: number }
const cache = new Map<string, { stamp: string; value: Parsed }>();
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

/** Read completed commands only. Command strings, outputs and conversation text never leave this reader. */
async function parseSession(file: string, source: Sample["source"]): Promise<Parsed> {
  const stat = await fs.stat(file), stamp = `${stat.mtimeMs}:${stat.size}`;
  const previous = cache.get(file);
  if (previous?.stamp === stamp) return previous.value;
  const samples = new Map<string, Sample>(), legacy = new Map<string, Sample>();
  const calls = new Map<string, { cwd: string; at: string }>();
  let cwd = "", session = path.basename(file), rejected = 0;
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try { row = object(JSON.parse(line)); } catch { rejected++; continue; }
      const p = object(row.payload);
      if (row.type === "session_meta") { cwd = typeof p.cwd === "string" ? p.cwd : cwd; session = typeof p.id === "string" ? p.id : session; }
      if (row.type === "turn_context" && typeof p.cwd === "string") cwd = p.cwd;
      if (source === "Codex") {
        const item = object(p.item);
        if (row.type === "event_msg" && p.type === "item_completed" && item.type === "CommandExecution" && ["completed", "failed"].includes(item.status) && typeof item.exit_code === "number") {
          const at = typeof p.started_at_ms === "number" ? new Date(p.started_at_ms).toISOString() : row.timestamp;
          if (typeof item.id === "string") samples.set(`${session}:${item.id}`, { id: `${session}:${item.id}`, cwd: typeof item.cwd === "string" ? item.cwd : cwd, at, failed: item.exit_code !== 0, source });
        }
        if (row.type === "response_item" && p.type === "function_call" && ["exec_command", "shell_command", "shell"].includes(p.name) && typeof p.call_id === "string") {
          let args; try { args = object(JSON.parse(p.arguments)); } catch { continue; }
          calls.set(p.call_id, { cwd: args.workdir ?? args.cwd ?? cwd, at: row.timestamp });
        }
        if (row.type === "response_item" && p.type === "function_call_output" && calls.has(p.call_id)) {
          const output = typeof p.output === "string" ? p.output : "";
          const match = /(?:Process exited with code|exit_code["']?\s*:)\s*(-?\d+)/.exec(output);
          if (match) legacy.set(`${session}:${p.call_id}`, { id: `${session}:${p.call_id}`, ...calls.get(p.call_id)!, failed: Number(match[1]) !== 0, source });
        }
      } else {
        const message = object(row.message);
        if (!Array.isArray(message.content)) continue;
        for (const block of message.content.map(object)) {
          if (row.type === "assistant" && block.type === "tool_use" && block.name === "Bash" && typeof block.id === "string") {
            calls.set(block.id, { cwd: row.cwd, at: row.timestamp });
          }
          if (row.type === "user" && block.type === "tool_result" && calls.has(block.tool_use_id)) {
            const result = object(row.toolUseResult);
            // Denied tools have no shell result. Background launch acknowledgements are not completed commands.
            if (!("stdout" in result) || result.backgroundTaskId || result.task_id) continue;
            const id = `${row.sessionId ?? row.session_id ?? session}:${block.tool_use_id}`;
            samples.set(id, { id, ...calls.get(block.tool_use_id)!, failed: block.is_error === true || result.interrupted === true, source });
          }
        }
      }
    }
  } finally { lines.close(); input.destroy(); }
  // Prefer completed command events when a legacy response has the same execution ID.
  const value = { samples: [...new Map([...legacy, ...samples]).values()], rejected };
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(file, { stamp, value });
  return value;
}

export async function collectHomeCommands(hostHome: string, projects: StudioRegisteredProject[], month: string, now: Date, includeHidden = false): Promise<{ groups: HomeExecutionGroup[]; rejected: number; unavailable: string[] }> {
  const groups = new Map<string, HomeExecutionGroup>(), seen = new Set<string>();
  const unavailable: string[] = [];
  let rejected = 0;
  const roots = projects.map(p => ({ ...p, root: path.resolve(p.path) })).sort((a, b) => b.root.length - a.root.length);
  const floor = new Date(`${month}-01T00:00:00`).getTime() - 86400000;
  async function visit(dir: string, source: Sample["source"]): Promise<void> {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") unavailable.push(source); return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await visit(file, source); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        if ((await fs.stat(file)).mtimeMs < floor) continue;
        const parsed = await parseSession(file, source);
        rejected += parsed.rejected;
        for (const sample of parsed.samples) {
          if (typeof sample.cwd !== "string" || !Number.isFinite(Date.parse(sample.at)) || Date.parse(sample.at) > now.getTime()) continue;
          const cwd = path.resolve(sample.cwd);
          const project = roots.find(p => cwd === p.root || cwd.startsWith(p.root + path.sep));
          if (!project || (project.hidden && !includeHidden)) continue;
          const date = dayKey(new Date(sample.at)), id = `${source}:${sample.id}`;
          if (!date.startsWith(month) || seen.has(id)) continue;
          seen.add(id);
          const key = `${date}:${project.alias}:${source}`;
          const group = groups.get(key) ?? { date, alias: project.alias, source, count: 0, failed: 0 };
          group.count++; if (sample.failed) group.failed++;
          groups.set(key, group);
        }
      } catch { unavailable.push(source); }
    }
  }
  await visit(path.join(hostHome, ".claude", "projects"), "Claude");
  await visit(path.join(hostHome, ".codex", "sessions"), "Codex");
  return { groups: [...groups.values()], rejected, unavailable: [...new Set(unavailable)] };
}
