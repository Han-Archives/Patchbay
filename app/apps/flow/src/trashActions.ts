import { readTrash, restoreRoom, takeTrashEntry, todoItemSchema, TrashError, updateTodos, type TrashEntry } from "@patchbay/core";

/** 휴지통 목록 한 줄 — 원문(payload)은 내보내지 않는다. */
export interface TrashRow { id: string; kind: TrashEntry["kind"]; recordId: string; title: string; deletedAt: string; expiresAt: string }

function titleOf(entry: TrashEntry): string {
  const payload = entry.payload as { title?: unknown; meta?: unknown } | null;
  if (entry.kind === "todo") return typeof payload?.title === "string" ? payload.title : entry.recordId;
  try {
    const meta = typeof payload?.meta === "string" ? JSON.parse(payload.meta) as { title?: unknown } : null;
    if (typeof meta?.title === "string" && meta.title.trim()) return meta.title.trim();
  } catch { /* 제목 파일이 깨졌으면 ID로 보인다 */ }
  return `대화 ${entry.recordId}`;
}

export async function listTrash(home: string, alias: string, now = new Date()): Promise<TrashRow[]> {
  return (await readTrash(home, alias, now))
    .map(entry => ({ id: entry.id, kind: entry.kind, recordId: entry.recordId, title: titleOf(entry), deletedAt: entry.deletedAt, expiresAt: entry.expiresAt }))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** 할일은 Tasks로, 대화는 대화 폴더로 되돌린다. 같은 ID가 살아 있으면 409로 막고 휴지통에 남긴다. */
export async function restoreTrash(home: string, alias: string, id: string, now = new Date()): Promise<TrashRow> {
  const entry = await takeTrashEntry(home, alias, id, async row => {
    if (row.kind === "room") return restoreRoom(home, alias, row.recordId, row.payload as { transcript?: string; meta?: string });
    const todo = todoItemSchema.parse(row.payload);
    await updateTodos(home, alias, fresh => {
      const live = fresh.find(item => item.id === todo.id);
      if (live && !live.deletedAt) throw new TrashError("같은 ID의 할일이 이미 있어 되살리지 않았습니다.", 409);
      // 자동 추천은 삭제 표시만 남아 있다 — 표시를 걷으면 다음 동기화에서 다시 보인다.
      // 저장소는 새 줄을 옛 줄 위에 덮으므로, 키를 빼지 않고 undefined로 지운다.
      if (live) return fresh.map(item => item.id === todo.id ? { ...item, deletedAt: undefined, inactive: false } : item);
      const { deletedAt: _d, ...rest } = todo;
      return [...fresh, rest];
    }, now);
  }, now);
  return { id: entry.id, kind: entry.kind, recordId: entry.recordId, title: titleOf(entry), deletedAt: entry.deletedAt, expiresAt: entry.expiresAt };
}
