import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyPath, isSecret, parseIr, projectDocs, readOverlay, readRunRecords, readStudio, readTodos,
  type StudioRegisteredProject,
} from "@patchbay/core";
import { loadWorkspace } from "./workspaceView.js";
import { normalizeProjectRelPath } from "./sourceFileView.js";
import { appLaunchUrl, dayKey, monthKey, validMonth, type HomeOutput, type HomeProject, type HomeResponse } from "./homeContract.js";
import type { WorkspaceProject } from "./workspaceContract.js";
import { collectHomeCommands } from "./homeExecution.js";
import type { HomeExecutionGroup } from "./homeContract.js";

const OUTPUT_LIMIT = 1000;
const SKIP = new Set(["archive", "node_modules", "dist", "dist-client", "dist-server", "__fixtures__"]);
const TYPES: Record<string, HomeOutput["kind"]> = { ".md": "문서", ".html": "화면", ".htm": "화면", ".pdf": "PDF", ".png": "이미지", ".jpg": "이미지", ".jpeg": "이미지", ".webp": "이미지", ".gif": "이미지", ".svg": "이미지" };
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
const inside = (root: string, file: string) => file.startsWith(root + path.sep);

/** Only document/output roots. Never follow symlinks, enumerate raw chats, or include archived editions. */
async function projectOutputs(project: StudioRegisteredProject, query: string): Promise<{ outputs: HomeOutput[]; limited: boolean }> {
  const root = await fs.realpath(project.path);
  const outputs: HomeOutput[] = [], seen = new Set<string>();
  let limited = false;
  async function visit(relative: string): Promise<void> {
    const rel = normalizeProjectRelPath(relative);
    if (!rel || rel.split("/").some(p => p.startsWith(".") || SKIP.has(p)) || isSecret(classifyPath(rel).level)) return;
    const abs = path.resolve(root, rel);
    if (!inside(root, abs) || seen.has(rel)) return;
    seen.add(rel);
    let stat;
    try { stat = await fs.lstat(abs); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(abs)).sort()) {
        if (outputs.length >= OUTPUT_LIMIT) { limited = true; return; }
        await visit(`${rel}/${name}`);
      }
      return;
    }
    const kind = TYPES[path.extname(rel).toLowerCase()] ?? (rel.endsWith(".artifact.json") ? "문서" : null);
    if (!stat.isFile() || !kind || ["기억.md", "대화.md", "PROGRESS.md"].includes(path.basename(rel))) return;
    // Re-check canonical containment before opening content, including symlinked ancestors.
    const real = await fs.realpath(abs);
    if (!inside(root, real) || isSecret(classifyPath(path.relative(root, real)).level)) return;
    let text = "";
    if ((kind === "문서" || kind === "화면") && stat.size <= 256 * 1024) text = await fs.readFile(real, "utf8");
    const filename = path.basename(rel), title = (kind === "화면" ? /<title[^>]*>([^<]+)<\/title>/i.exec(text)?.[1] : /^#\s+(.+)$/m.exec(text)?.[1])?.trim() || filename;
    const readable = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    const excerpt = readable.replace(/<[^>]*>/g, " ").replace(/^[#>*`| -]+/gm, "").replace(/\s+/g, " ").trim().slice(0, 200);
    outputs.push({ alias: project.alias, path: rel, title, kind, at: stat.mtime.toISOString(), excerpt, matches: !query || normalize(`${project.name ?? project.alias} ${title} ${rel} ${text}`).includes(query) });
  }
  // `knowledge` is the public wiki convention; registered docs may point to a private records layer.
  for (const rel of new Set([projectDocs(project), "knowledge"])) await visit(rel);
  return { outputs: outputs.sort((a, b) => b.at.localeCompare(a.at) || a.path.localeCompare(b.path)), limited };
}

export async function loadHome(studioHome: string, options: { query?: string; month?: string; hidden?: boolean; running?: string[]; now?: Date; hostHome?: string | null } = {}): Promise<HomeResponse> {
  const now = options.now ?? new Date(), month = options.month ?? monthKey(now);
  if (!validMonth(month)) throw new Error("월은 YYYY-MM 형식이어야 합니다.");
  const query = normalize((options.query ?? "").trim()).slice(0, 200);
  const [studio, workspace] = await Promise.all([readStudio(studioHome), loadWorkspace(studioHome)]);
  const days: Record<string, number> = {};
  const groups: HomeExecutionGroup[] = [], unavailable: string[] = [];
  let rejected = 0;
  const projects = await Promise.all(studio.projects.filter(p => options.hidden || !p.hidden).map(async (registered): Promise<HomeProject> => {
    const project = workspace.projects.find(p => p.alias === registered.alias)!;
    const issues: string[] = [];
    const safe = async <T>(read: () => Promise<T>, fallback: T, message: string): Promise<T> => { try { return await read(); } catch { issues.push(message); return fallback; } };
    const [overlay, todos, artifacts, runs] = await Promise.all([
      safe(() => readOverlay(studioHome, project.alias), null, "설계 정보를 읽지 못했습니다."),
      safe(() => readTodos(studioHome, project.alias), [], "할 일을 읽지 못했습니다."),
      safe(() => projectOutputs(registered, query), { outputs: [], limited: false }, "결과물 목록을 읽지 못했습니다."),
      safe(() => readRunRecords(studioHome, project.alias), { records: [], rejected: [] }, "실행 기록을 읽지 못했습니다."),
    ]);
    for (const run of runs.records) {
      const date = dayKey(new Date(run.startedAt));
      if (date.startsWith(month) && Date.parse(run.startedAt) <= now.getTime()) {
        let group = groups.find(g => g.alias === project.alias && g.date === date && g.source === "테스트");
        if (!group) { group = { alias: project.alias, date, source: "테스트", count: 0, failed: 0 }; groups.push(group); }
        group.count++; if (run.status !== "success") group.failed++;
      }
    }
    if (issues.includes("실행 기록을 읽지 못했습니다.")) unavailable.push(project.name ?? project.alias);
    rejected += runs.rejected.length;
    const ir = overlay?.ir ? parseIr(overlay.ir) : null;
    const active = todos.filter(t => !t.done && !t.inactive && !t.deletedAt);
    const running = options.running?.includes(project.alias) ?? false;
    const description = ir?.ok ? ir.ir.goal : project.stages.find(s => s.id === project.current)?.next ?? "";
    return { ...project, description, version: ir?.ok ? ir.ir.version ?? null : null, appUrl: appLaunchUrl(overlay?.app?.url),
      todos: active.map((t, index) => ({ id: t.id, title: t.title, at: t.at, alias: project.alias, order: index + 1 })),
      outputs: artifacts.outputs, outputCount: artifacts.outputs.length, outputLimited: artifacts.limited, issues,
      status: running ? "running" : project.attention === "blocked" ? "problem" : active.length > 0 || projectCycleTurn(project) ? "turn" : "normal",
      matches: !query || normalize(`${project.name ?? project.alias} ${project.alias} ${description} ${project.latest?.summary ?? ""}`).includes(query),
    };
  }));
  if (options.hostHome) {
    const commands = await collectHomeCommands(options.hostHome, studio.projects, month, now, options.hidden);
    groups.push(...commands.groups); rejected += commands.rejected; unavailable.push(...commands.unavailable);
  }
  for (const group of groups) days[group.date] = (days[group.date] ?? 0) + group.count;
  groups.sort((a, b) => b.date.localeCompare(a.date) || a.alias.localeCompare(b.alias) || a.source.localeCompare(b.source));
  return { projects, month, today: dayKey(now), execution: { days, total: Object.values(days).reduce((sum, n) => sum + n, 0), activeDays: Object.keys(days).length, rejected, groups, unavailable, commandsConnected: Boolean(options.hostHome) } };
}
function projectCycleTurn(project: WorkspaceProject): boolean {
  return ["design", "build", "test"].every(id => project.stages.some(s => s.id === id && s.tone === "done"));
}
