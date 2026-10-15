import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dashboardHistoryEntrySchema, dashboardHistoryInputSchema, type DashboardHistoryInput } from "../types/dashboardHistory.js";
import { projectStudioDir } from "./studioStore.js";

const fileSchema = z.object({ entries: z.array(dashboardHistoryEntrySchema) });
export const DASHBOARD_HISTORY_FILE = "dashboard-history.json";
const writes = new Map<string, Promise<unknown>>();
export function dashboardHistoryPath(home: string, alias: string) { return path.join(projectStudioDir(home, alias), DASHBOARD_HISTORY_FILE); }
export async function readDashboardHistory(home: string, alias: string) {
  try { return fileSchema.parse(JSON.parse(await fs.readFile(dashboardHistoryPath(home, alias), "utf8"))).entries; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
export function appendDashboardHistory(home: string, alias: string, input: DashboardHistoryInput) {
  const value = dashboardHistoryInputSchema.parse(input);
  const file = dashboardHistoryPath(home, alias);
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const entries = await readDashboardHistory(home, alias);
    const entry = dashboardHistoryEntrySchema.parse({ ...value, id: randomUUID(), timestamp: new Date().toISOString() });
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ entries: [entry, ...entries] }, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
    return entry;
  });
  writes.set(file, next);
  void next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => undefined);
  return next;
}
