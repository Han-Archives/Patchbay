import { listRooms, readRoom, readStudio, type RoomMessage } from "@patchbay/core";
import { notifyText, type RoomNotificationOptions } from "./roomNotifications.js";

/**
 * 맡긴 일은 1시간 안에 결과 (R7.7, 사용자 결정 2026-10-21: 재고 · 표시하고 넘으면 폰 알림).
 * 잴 대상은 Claude 세션(폰 Remote Control 포함)을 훅이 옮긴 대화다 — 기록만으로는 폰과 터미널을 가르지 못한다.
 * 사람의 말 하나가 시계를 시작하고, 다음 사람의 말 앞의 마지막 답이 끝이다. 답이 질문이면 사람이 답할 때
 * 새 시계가 시작되므로, 사람을 기다린 시간은 저절로 빠진다.
 */
export const TASK_LIMIT_MS = 60 * 60 * 1000;
/** 대시보드가 보는 기간. */
export const TASK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface TaskTurn { roomId: string; title: string; seq: number; startAt: string; endAt: string | null; ms: number }

const when = (m: RoomMessage) => Date.parse(m.sourceAt ?? m.at);

/** 한 대화의 맡김 → 결과 구간. 아직 답이 없는 마지막 구간은 지금까지 걸린 시간이고 `endAt` 이 없다. */
export function sessionTurns(roomId: string, title: string, messages: readonly RoomMessage[], now: Date): TaskTurn[] {
  const turns: TaskTurn[] = [];
  let open: { seq: number; start: number } | null = null;
  let last: number | null = null;
  const close = () => {
    if (!open) return;
    const end = last;
    turns.push({ roomId, title, seq: open.seq, startAt: new Date(open.start).toISOString(), endAt: end === null ? null : new Date(end).toISOString(), ms: (end ?? now.getTime()) - open.start });
  };
  for (const m of messages) {
    // 사람의 말은 무엇이든 앞 구간을 닫는다. 새 시계는 세션에서 맡긴 말만 연다 — 콘솔에서 쓴 말은 재지 않는다.
    if (m.role === "user") { close(); open = m.via === "claude-session" ? { seq: m.seq, start: when(m) } : null; last = null; }
    else if (m.role === "speaker" && open) last = when(m);
  }
  close();
  return turns;
}

/** 기간 안에 시작한 구간과 그중 1시간을 넘긴 구간. */
export async function loadTaskTiming(home: string, alias: string, now = new Date()): Promise<{ limitMs: number; measured: number; over: TaskTurn[] }> {
  const since = now.getTime() - TASK_WINDOW_MS;
  const rooms = (await listRooms(home, alias)).filter(room => room.updatedAt && Date.parse(room.updatedAt) >= since);
  const turns: TaskTurn[] = [];
  for (const room of rooms) {
    const read = await readRoom(home, alias, room.id);
    if (read) turns.push(...sessionTurns(room.id, room.title, read.messages, now).filter(turn => Date.parse(turn.startAt) >= since));
  }
  return { limitMs: TASK_LIMIT_MS, measured: turns.length, over: turns.filter(turn => turn.ms > TASK_LIMIT_MS).sort((a, b) => b.startAt.localeCompare(a.startAt)) };
}

/** 넘긴 지 이만큼 지난 구간은 알리지 않는다 — 끝난 세션의 옛 기록이 콘솔을 켤 때 한꺼번에 울리지 않게. */
export const TASK_ALERT_WINDOW_MS = 2 * 60 * 60 * 1000;
/** 서버가 확인하는 주기. */
export const TASK_CHECK_MS = 5 * 60 * 1000;

/** 아직 답이 없는데 1시간을 넘긴 구간 — 알림 대상. 같은 구간은 한 번만 알린다(`sent`는 콘솔이 떠 있는 동안 기억). */
export function overdueOpenTurns(timing: { over: TaskTurn[] }, sent: Set<string>, alias: string): TaskTurn[] {
  const fresh = timing.over.filter(turn => turn.endAt === null && turn.ms <= TASK_LIMIT_MS + TASK_ALERT_WINDOW_MS && !sent.has(`${alias}/${turn.roomId}/${turn.seq}`));
  for (const turn of fresh) sent.add(`${alias}/${turn.roomId}/${turn.seq}`);
  return fresh;
}

/** 모든 프로젝트를 보고, 새로 1시간을 넘긴 구간을 폰 알림 채널로 보낸다. 보낸 구간을 돌려준다. */
export async function alertOverdueTasks(home: string, options: RoomNotificationOptions, sent: Set<string>, now = new Date()): Promise<TaskTurn[]> {
  const alerted: TaskTurn[] = [];
  for (const project of (await readStudio(home)).projects) {
    for (const turn of overdueOpenTurns(await loadTaskTiming(home, project.alias, now), sent, project.alias)) {
      const link = options.publicUrl ? `\n${options.publicUrl.replace(/\/$/, "")}#room/${encodeURIComponent(project.alias)}/${encodeURIComponent(turn.roomId)}` : "";
      await notifyText(options, `Patchbay · ${project.alias}\n맡긴 일이 1시간을 넘겼다 — 「${turn.title}」 ${Math.round(turn.ms / 60_000)}분째 결과 없음${link}`);
      alerted.push(turn);
    }
  }
  return alerted;
}
