import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectStudioDir } from "./studioStore.js";
import { appendLogChanges, cycleChanges } from "../log/changes.js";

/**
 * 흐름도 작업 아래의 세부 항목 — 대시보드 흐름도 밑 트리 표 (사용자 요청 2026-10-15).
 * 사용자가 + 로 넣거나 LLM이 계획해 넣는다. ▶ 를 누르면 할일(todos.json)에 올라가고 todoId로 잇는다.
 * 상태(대기 · 진행 · 완료)는 저장하지 않는다 — 연결된 할일과 실제 대화 실행에서 매번 계산한다.
 */
export const CYCLE_ITEMS_FILE_NAME = "cycle-items.json";
export const CYCLE_ITEM_TAGS = ["UI", "Agent", "데이터", "서버", "문서"] as const;

export const cycleItemSchema = z.object({
  id: z.string().min(1),
  /** 흐름도 큰 칸 — design · build · test · review · result. 2026-10-15 전 기록의 `run`(테스트)은 `test` 로 읽는다. */
  step: z.preprocess((v) => (v === "run" ? "test" : v), z.enum(["design", "build", "test", "review", "result"])),
  /** 어느 작업 아래인지 — 표의 작업 이름 그대로. */
  task: z.string().min(1).max(200),
  name: z.string().min(1).max(80),
  desc: z.string().max(200),
  tag: z.enum(CYCLE_ITEM_TAGS),
  source: z.enum(["llm", "user"]),
  at: z.string(),
  todoId: z.string().min(1).optional(),
});
export type CycleItem = z.infer<typeof cycleItemSchema>;

const fileSchema = z.object({ items: z.array(cycleItemSchema) });
const writes = new Map<string, Promise<unknown>>();

export function cycleItemsPath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), CYCLE_ITEMS_FILE_NAME);
}

export async function readCycleItems(studioHome: string, alias: string): Promise<CycleItem[]> {
  let text: string;
  try {
    text = await fs.readFile(cycleItemsPath(studioHome, alias), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return fileSchema.parse(JSON.parse(text)).items;
}

/** 추가 · 빼기 · 할일 연결이 서로의 변경을 덮어쓰지 않도록 직렬화한다. */
export function updateCycleItems(studioHome: string, alias: string, change: (fresh: CycleItem[]) => CycleItem[] | Promise<CycleItem[]>, now = new Date()): Promise<CycleItem[]> {
  const file = cycleItemsPath(studioHome, alias);
  const next = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const fresh = await readCycleItems(studioHome, alias);
    const items = fileSchema.parse({ items: await change(fresh) }).items;
    if (new Set(items.map(row => row.id)).size !== items.length) throw new Error("세부 항목 ID가 중복된다.");
    if (JSON.stringify(fresh) !== JSON.stringify(items)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
      await fs.rename(tmp, file);
      await appendLogChanges(studioHome, alias, cycleChanges(fresh, items, now.toISOString()));
    }
    return items;
  });
  writes.set(file, next);
  void next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => undefined);
  return next;
}
