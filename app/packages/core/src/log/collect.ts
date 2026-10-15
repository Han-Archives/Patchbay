import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { readProgress } from "../studio/progressStore.js";
import { readStudio } from "../studio/studioStore.js";
import { readTodos, readTodoHistory } from "../studio/todoStore.js";
import { readCycleItems } from "../studio/cycleItemStore.js";
import { readDashboardHistory } from "../studio/dashboardHistoryStore.js";
import { ROOM_DIR_NAME, displayRoomTitle, readRoom, readRoomMeta } from "../rooms/store.js";
import { ROOM_SPEAKER_LABEL } from "../rooms/types.js";
import { projectStudioDir } from "../studio/studioStore.js";
import { readLogChanges, type LogChange } from "./changes.js";
import { makeTagger, type LogConfig, type TagFrom } from "./config.js";
import { addDays, zonedParts } from "./paths.js";

/** 콘솔 화면도 커널 모듈을 번들하므로 모듈 맨 위에서 Node 함수를 부르지 않는다 — 부를 때 감싼다. */
function run(cmd: string, args: string[], options: { maxBuffer: number }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve({ stdout, stderr })));
  });
}

export const LOG_KINDS = ["진행", "대화", "할일", "흐름도", "메모", "커밋"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/**
 * 하루에 일어난 일 한 건. `id` 는 원문을 가리키는 안정된 이름이라 같은 원문이면 같은 id 가 나온다.
 * 대화는 방 하나의 하루치 말 묶음이다 (`room:<방>:<날짜>:<처음 seq>-<끝 seq>`).
 */
export interface LogEvent {
  id: string;
  date: string;
  /** 그날의 시각 HH:mm (설정 시간대). 대화는 처음–끝. */
  time: string;
  at: string;
  kind: LogKind;
  /** 보고 · 추가 · 완료 · 되돌림 · 삭제 · 고침 · 발췌 n · 메모 · 커밋 */
  change: string;
  title: string;
  detail?: string[];
  excerpt?: string[];
  omitted?: number;
  files?: string[];
  /** 경로 규칙으로 붙은 태그마다 그 파일들 — 태그별 고유 파일 수를 센다. */
  filesByTag?: Record<string, string[]>;
  tags: string[];
  tagFrom: Record<string, TagFrom>;
  ref: { type: "progress" | "room" | "todo" | "cycle" | "memo" | "commit"; id: string; fromSeq?: number; toSeq?: number };
}

export type SourceState = "ok" | "empty" | "unavailable" | "error";
export interface LogSource { name: string; state: SourceState; count: number; note?: string }

export interface Collected {
  events: LogEvent[];
  sources: LogSource[];
  /** 오늘 장에만 — 조회 시점의 커밋 안 된 파일 수. 오늘 변경이 아니다. */
  workTree: number | null;
}

const EXCERPT_CHARS = 120;
const EXCERPT_MAX = 10;
const CHANGE_LABEL: Record<LogChange["change"], string> = { add: "추가", done: "완료", undone: "되돌림", delete: "삭제", edit: "고침" };

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** [from, to] 날짜 안의 사건을 원문에서 모은다. 날짜는 설정 시간대 기준. 규칙으로만 — LLM 없음. */
export async function collectLogEvents(studioHome: string, alias: string, from: string, to: string, config: LogConfig, now = new Date()): Promise<Collected> {
  const tz = config.tz;
  const tagger = makeTagger(config);
  const inRange = (date: string) => date >= from && date <= to;
  const events: LogEvent[] = [];
  const sources: LogSource[] = [];
  const place = (at: string) => { const p = zonedParts(at, tz); return p && inRange(p.date) ? p : null; };

  // 연결: 흐름도 항목 태그 → 할일 → 대화방
  const [cycles, todos, history] = await Promise.all([readCycleItems(studioHome, alias), readTodos(studioHome, alias), readTodoHistory(studioHome, alias)]);
  const todoTags = new Map<string, Set<string>>();
  for (const item of cycles) if (item.todoId) (todoTags.get(item.todoId) ?? todoTags.set(item.todoId, new Set()).get(item.todoId)!).add(item.tag);
  const roomTags = new Map<string, Set<string>>();
  for (const todo of [...todos, ...history]) {
    const tags = todoTags.get(todo.id);
    if (tags && todo.roomId) for (const t of tags) (roomTags.get(todo.roomId) ?? roomTags.set(todo.roomId, new Set()).get(todo.roomId)!).add(t);
  }
  const tagged = (linked: Iterable<string>, text: string, files: string[] = []) => {
    const tagFrom: Record<string, TagFrom> = {};
    for (const t of linked) tagFrom[t] ??= "연결";
    for (const f of files) for (const t of tagger.pathTags(f)) tagFrom[t] ??= "경로";
    for (const t of tagger.wordTags(text)) tagFrom[t] ??= "낱말";
    const order = [...config.tags, ...Object.keys(tagFrom).filter((t) => !config.tags.includes(t))];
    return { tags: order.filter((t) => t in tagFrom), tagFrom };
  };

  // 진행 보고 — timestamp 는 일한 시각이 아니라 보고가 기록된 시각이다.
  const progress = await readProgress(studioHome, alias);
  let count = 0;
  const seen = new Map<string, number>();
  for (const entry of [...(progress.current ? [progress.current] : []), ...progress.history]) {
    const p = place(entry.timestamp);
    if (!p) continue;
    const key = `progress:${entry.timestamp}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const detail = [entry.asked ? `요청: ${clip(entry.asked, 300)}` : "", entry.did ? `반영: ${clip(entry.did, 400)}` : ""].filter(Boolean);
    events.push({ id: n ? `${key}#${n}` : key, date: p.date, time: p.time, at: entry.timestamp, kind: "진행", change: "보고", title: clip(entry.summary, 120), ...(detail.length ? { detail } : {}), ...tagged([], `${entry.summary} ${entry.asked ?? ""} ${entry.did ?? ""}`), ref: { type: "progress", id: entry.timestamp } });
    count++;
  }
  sources.push({ name: "진행 보고", state: count ? "ok" : "empty", count });

  // 대화방 — 말한 시각(sourceAt)이 있으면 그날로, 없으면 방에 적은 시각으로.
  count = 0;
  let late = 0;
  const roomDir = path.join(projectStudioDir(studioHome, alias), ROOM_DIR_NAME);
  let names: string[] = [];
  try { names = (await fs.readdir(roomDir)).filter((n) => n.endsWith(".jsonl")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const floor = Date.parse(`${addDays(from, -1)}T00:00:00Z`);
  let broken = 0;
  for (const name of names.sort()) {
    const id = name.slice(0, -".jsonl".length);
    const stat = await fs.stat(path.join(roomDir, name));
    if (stat.mtimeMs < floor) continue; // 범위보다 오래전에 마지막으로 쓴 방은 열지 않는다
    const room = await readRoom(studioHome, alias, id);
    if (!room) continue;
    broken += room.broken.length;
    const meta = await readRoomMeta(studioHome, alias, id);
    const title = displayRoomTitle(meta.title, room.messages);
    const byDate = new Map<string, typeof room.messages>();
    for (const m of room.messages) {
      if (m.role !== "user" && m.role !== "speaker") continue;
      const p = place(m.sourceAt ?? m.at);
      if (!p) continue;
      if (m.sourceAt && zonedParts(m.at, tz)?.date !== p.date) late++;
      (byDate.get(p.date) ?? byDate.set(p.date, []).get(p.date)!).push(m);
    }
    for (const [date, msgs] of byDate) {
      const users = msgs.filter((m) => m.role === "user");
      const speakers = new Map<string, number>();
      for (const m of msgs) if (m.role === "speaker") speakers.set(ROOM_SPEAKER_LABEL[m.speaker], (speakers.get(ROOM_SPEAKER_LABEL[m.speaker]) ?? 0) + 1);
      const first = msgs[0]!, last = msgs[msgs.length - 1]!;
      const t1 = zonedParts(first.sourceAt ?? first.at, tz)!.time, t2 = zonedParts(last.sourceAt ?? last.at, tz)!.time;
      const excerpt = users.slice(0, EXCERPT_MAX).map((m) => `${zonedParts(m.sourceAt ?? m.at, tz)!.time} ${clip(m.text, EXCERPT_CHARS)}`);
      const who = [`사용자 ${users.length}`, ...[...speakers].map(([k, v]) => `${k} ${v}`)].join(" · ");
      events.push({
        id: `room:${id}:${date}:${first.seq}-${last.seq}`, date, time: t1 === t2 ? t1 : `${t1}–${t2}`, at: first.sourceAt ?? first.at,
        kind: "대화", change: users.length ? `발췌 ${users.length}` : `답 ${msgs.length}`, title, detail: [`현재 제목 · ${who}`],
        ...(excerpt.length ? { excerpt } : {}), ...(users.length > EXCERPT_MAX ? { omitted: users.length - EXCERPT_MAX } : {}),
        ...tagged(roomTags.get(id) ?? [], `${title} ${users.map((m) => m.text).join(" ")}`),
        ref: { type: "room", id, fromSeq: first.seq, toSeq: last.seq },
      });
      count++;
    }
  }
  sources.push({ name: "대화방", state: count ? "ok" : "empty", count, ...(broken ? { note: `깨진 줄 ${broken}` } : late ? { note: `늦게 옮긴 말 ${late}건은 말한 날로` } : {}) });

  // 할일 · 흐름도 — 변동 기록이 먼저, 기록이 없던 때는 원문의 등록 · 완료 시각으로.
  const { changes, broken: badChanges } = await readLogChanges(studioHome, alias);
  const covered = new Set(changes.map((c) => `${c.target}:${c.id}:${c.change}`));
  let todoCount = 0, cycleCount = 0;
  const pushChange = (c: Pick<LogChange, "at" | "target" | "id" | "change" | "title" | "tag">, linked: Iterable<string>) => {
    const p = place(c.at);
    if (!p) return;
    const kind: LogKind = c.target === "todo" ? "할일" : "흐름도";
    events.push({ id: `${c.target}:${c.id}:${c.change}:${c.at}`, date: p.date, time: p.time, at: c.at, kind, change: CHANGE_LABEL[c.change], title: clip(c.title, 120), ...tagged(linked, c.title), ref: { type: c.target, id: c.id } });
    if (c.target === "todo") todoCount++; else cycleCount++;
  };
  for (const c of changes) pushChange(c, c.target === "cycle" ? (c.tag ? [c.tag] : []) : todoTags.get(c.id) ?? []);
  const todoRows = new Map<string, { id: string; title: string; at: string; completedAt?: string }>();
  for (const t of history) todoRows.set(t.id, t);
  for (const t of todos) if (!t.source) todoRows.set(t.id, t);
  for (const t of todoRows.values()) {
    if (!covered.has(`todo:${t.id}:add`)) pushChange({ at: t.at, target: "todo", id: t.id, change: "add", title: t.title }, todoTags.get(t.id) ?? []);
    if (t.completedAt && !covered.has(`todo:${t.id}:done`)) pushChange({ at: t.completedAt, target: "todo", id: t.id, change: "done", title: t.title }, todoTags.get(t.id) ?? []);
  }
  for (const item of cycles) if (!covered.has(`cycle:${item.id}:add`)) pushChange({ at: item.at, target: "cycle", id: item.id, change: "add", title: item.name, tag: item.tag }, [item.tag]);
  sources.push({ name: "할일", state: todoCount ? "ok" : "empty", count: todoCount, ...(badChanges ? { note: `변동 기록 깨진 줄 ${badChanges}` } : {}) });
  sources.push({ name: "흐름도 항목", state: cycleCount ? "ok" : "empty", count: cycleCount });

  // History 메모 — 사람이 고른 날짜 그대로, 태그도 적은 그대로.
  count = 0;
  for (const memo of await readDashboardHistory(studioHome, alias)) {
    if (!inRange(memo.date)) continue;
    const [head, ...rest] = memo.content.split("\n");
    const tagFrom: Record<string, TagFrom> = Object.fromEntries(memo.tags.map((t) => [t, "입력" as const]));
    events.push({ id: `memo:${memo.id}`, date: memo.date, time: zonedParts(memo.timestamp, tz)?.date === memo.date ? zonedParts(memo.timestamp, tz)!.time : "--:--", at: memo.timestamp, kind: "메모", change: "메모", title: clip(head ?? "", 120), ...(rest.join(" ").trim() ? { detail: [clip(rest.join(" "), 400)] } : {}), tags: [...memo.tags], tagFrom, ref: { type: "memo", id: memo.id } });
    count++;
  }
  sources.push({ name: "History 메모", state: count ? "ok" : "empty", count });

  // git 커밋 — 등록부 path 의 레포. 커밋 시각(작성 시각) 기준.
  const project = (await readStudio(studioHome)).projects.find((row) => row.alias === alias);
  let workTree: number | null = null;
  if (!project?.path) sources.push({ name: "git 커밋", state: "unavailable", count: 0, note: "등록된 경로 없음" });
  else {
    try {
      const { stdout } = await run("git", ["-C", project.path, "log", `--since=${addDays(from, -1)}T00:00:00Z`, `--until=${addDays(to, 2)}T00:00:00Z`, "--date=iso-strict", "--pretty=format:%x1e%H%x1f%aI%x1f%s", "--name-only", "--no-renames"], { maxBuffer: 32 * 1024 * 1024 });
      count = 0;
      for (const block of stdout.split("\x1e")) {
        if (!block.trim()) continue;
        const [head, ...rest] = block.split("\n");
        const [sha, at, subject] = (head ?? "").split("\x1f");
        if (!sha || !at) continue;
        const p = place(at);
        if (!p) continue;
        const files = rest.map((f) => f.trim()).filter(Boolean);
        const filesByTag: Record<string, string[]> = {};
        for (const f of files) for (const t of tagger.pathTags(f)) (filesByTag[t] ??= []).push(f);
        events.push({ id: `commit:${sha.slice(0, 12)}`, date: p.date, time: p.time, at, kind: "커밋", change: "커밋", title: clip(subject ?? "", 120), files, filesByTag, ...tagged([], subject ?? "", files), ref: { type: "commit", id: sha } });
        count++;
      }
      sources.push({ name: "git 커밋", state: count ? "ok" : "empty", count });
      const today = zonedParts(now, tz)!.date;
      if (inRange(today)) {
        const status = await run("git", ["-C", project.path, "status", "--porcelain"], { maxBuffer: 8 * 1024 * 1024 });
        workTree = status.stdout.split("\n").filter((l) => l.trim()).length;
      }
    } catch (error) {
      const text = String((error as { stderr?: string }).stderr ?? (error as Error).message);
      sources.push({ name: "git 커밋", state: /not a git repository|does not have any commits/i.test(text) ? "unavailable" : "error", count: 0, note: /not a git repository/i.test(text) ? "git 레포가 아님" : clip(text, 120) });
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { events, sources, workTree };
}
