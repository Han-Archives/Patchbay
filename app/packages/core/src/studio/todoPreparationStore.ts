import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { projectStudioDir } from "./studioStore.js";
import { roomMemberSchema, roomModeSchema } from "../rooms/types.js";

export const PREPARATION_LABELS = { queued: "준비 대기", preparing: "준비 중", ready: "검토 대기", waiting: "선행 결과 대기", held: "보류", stale: "재검토 필요", applying: "승인 후 실행 중", done: "완료", failed: "확인 필요", stopped: "중지됨" } as const;
export const preparationDependencySchema = z.object({ todoId: z.string().min(1), kind: z.enum(["reference", "required"]), reason: z.string().min(1).max(2000), versionId: z.string().optional(), inputDigest: z.string().optional() });
export const preparationArtifactSchema = z.object({ name: z.string().min(1).max(120), format: z.enum(["markdown", "html", "text", "diff"]), content: z.string().min(1).max(300_000) });
export const preparationDraftSchema = z.object({
  modeId: z.string().min(1), reason: z.string().min(1).max(4000),
  plan: z.array(z.string().min(1).max(4000)).min(1).max(30),
  completion: z.array(z.string().min(1).max(2000)).min(1).max(20),
  dependencies: z.array(preparationDependencySchema).max(30),
  artifacts: z.array(preparationArtifactSchema).max(10),
  remaining: z.string().min(1).max(8000),
});
export const todoPreparationSchema = preparationDraftSchema.extend({
  plan: z.array(z.string().min(1).max(4000)).max(30), completion: z.array(z.string().min(1).max(2000)).max(20),
  id: z.string().uuid(), batchId: z.string().uuid(), todoId: z.string().min(1), title: z.string(), roomId: z.string(),
  inputDigest: z.string(), baseline: z.string(), member: roomMemberSchema, mode: roomModeSchema.optional(),
  status: z.enum(["queued", "preparing", "ready", "waiting", "held", "stale", "applying", "done", "failed", "stopped"]),
  at: z.string(), updatedAt: z.string(), error: z.string().optional(), revisionNote: z.string().optional(),
  approvedAt: z.string().optional(), result: z.string().optional(),
});
export type TodoPreparation = z.infer<typeof todoPreparationSchema>;
export type PreparationArtifact = z.infer<typeof preparationArtifactSchema>;
export const preparationFileSchema = z.object({ versions: z.array(todoPreparationSchema) });
export const TODO_PREPARATIONS_FILE = "todo-preparations.json";
const writes = new Map<string, Promise<unknown>>();
export function todoPreparationsPath(home: string, alias: string) { return path.join(projectStudioDir(home, alias), TODO_PREPARATIONS_FILE); }
export function todoInputDigest(todo: { title: string; detail?: string }) { return createHash("sha256").update(JSON.stringify([todo.title, todo.detail ?? ""])).digest("hex"); }
export async function readTodoPreparations(home: string, alias: string): Promise<TodoPreparation[]> {
  try { return preparationFileSchema.parse(JSON.parse(await fs.readFile(todoPreparationsPath(home, alias), "utf8"))).versions; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
export function latestPreparations(versions: TodoPreparation[]): TodoPreparation[] {
  const latest = new Map<string, TodoPreparation>();
  for (const version of versions) latest.set(version.todoId, version);
  return [...latest.values()];
}
export function updateTodoPreparations(home: string, alias: string, change: (versions: TodoPreparation[]) => TodoPreparation[] | Promise<TodoPreparation[]>): Promise<TodoPreparation[]> {
  const file = todoPreparationsPath(home, alias);
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const fresh = await readTodoPreparations(home, alias);
    const versions = preparationFileSchema.parse({ versions: await change(fresh) }).versions;
    if (new Set(versions.map(v => v.id)).size !== versions.length) throw new Error("준비본 ID가 중복됩니다.");
    if (JSON.stringify(fresh) !== JSON.stringify(versions)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ versions }, null, 2) + "\n", "utf8");
      await fs.rename(tmp, file);
    }
    return versions;
  });
  writes.set(file, next);
  void next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => undefined);
  return next;
}
