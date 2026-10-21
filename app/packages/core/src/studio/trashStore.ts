import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectStudioDir } from "./studioStore.js";

export const TRASH_RETENTION_MS = 4 * 24 * 60 * 60 * 1000;
// UI도 커널의 타입·상수를 가져오므로 모듈 로딩 중 Node 함수를 실행하지 않는다.
export const TRASH_FILE = ".trash/MANIFEST.json";
const entrySchema = z.object({
  id: z.string().uuid(), kind: z.enum(["room", "todo"]), recordId: z.string().min(1),
  deletedAt: z.string().datetime(), expiresAt: z.string().datetime(), payload: z.unknown(),
});
const fileSchema = z.object({ entries: z.array(entrySchema) });
export type TrashEntry = z.infer<typeof entrySchema>;
const writes = new Map<string, Promise<unknown>>();
export const trashPath = (home: string, alias: string) => path.join(projectStudioDir(home, alias), TRASH_FILE);
async function raw(home: string, alias: string): Promise<TrashEntry[]> {
  try { return fileSchema.parse(JSON.parse(await fs.readFile(trashPath(home, alias), "utf8"))).entries; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function save(home: string, alias: string, entries: TrashEntry[]) {
  const file = trashPath(home, alias); await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify({ entries }, null, 2) + "\n"); await fs.rename(temporary, file);
}
function update(home: string, alias: string, change: (entries: TrashEntry[]) => TrashEntry[] | Promise<TrashEntry[]>) {
  const file = trashPath(home, alias);
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const before = await raw(home, alias); const entries = fileSchema.parse({ entries: await change(before) }).entries;
    if (JSON.stringify(before) !== JSON.stringify(entries)) await save(home, alias, entries);
    return entries;
  });
  writes.set(file, next); void next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => undefined); return next;
}
export async function readTrash(home: string, alias: string, now = new Date()): Promise<TrashEntry[]> {
  return update(home, alias, entries => entries.filter(entry => Date.parse(entry.expiresAt) > now.getTime()));
}
export async function trashRecord(home: string, alias: string, input: { kind: "room" | "todo"; recordId: string; payload: unknown }, now = new Date()): Promise<TrashEntry> {
  const entry = entrySchema.parse({ ...input, id: randomUUID(), deletedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TRASH_RETENTION_MS).toISOString() });
  await update(home, alias, entries => [...entries.filter(row => Date.parse(row.expiresAt) > now.getTime()), entry]); return entry;
}
