import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { writeStudio, projectStudioDir } from "../studio/studioStore.js";
import { updateTodos } from "../studio/todoStore.js";
import { updateCycleItems } from "../studio/cycleItemStore.js";
import { appendRoomMessage } from "../rooms/store.js";
import { buildLog, confirmLogDay, readLogDay, readLogMonth, reopenLogDay } from "./build.js";
import { readLogChanges } from "./changes.js";
import { globRegExp, makeTagger, defaultLogConfig } from "./config.js";
import { assertLogDate, isoWeekKey, isoWeekRange, logPaths } from "./paths.js";
import { draftLogReport } from "./report.js";
import { checkLogSummary, compactLogRecord, logRecordIds, writeLogSummary } from "./summary.js";

// 시간대 Asia/Seoul — 2026-10-15 (목) 하루는 UTC 10-14T15:00 ~ 10-15T15:00
const NOW = new Date("2026-10-15T12:00:00Z"); // 21:00 KST
const kst = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString();

function git(repo: string, args: string[], at?: string) {
  execFileSync("git", ["-C", repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}) }, stdio: "ignore" });
}

async function setup(opts: { git?: boolean } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-log-")));
  const home = path.join(base, "home"), repo = path.join(base, "repo"), other = path.join(base, "other");
  for (const dir of [home, repo, other]) fs.mkdirSync(dir, { recursive: true });
  await writeStudio(home, { name: "t", projects: [{ alias: "demo", kind: "local_repo", path: repo }, { alias: "else", kind: "local_repo", path: other }] });
  if (opts.git) {
    git(repo, ["init", "-q"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "Panel.tsx"), "x");
    fs.writeFileSync(path.join(repo, "notes.md"), "x");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "패널 그리기"], kst("2026-10-15", "10:30"));
  }
  const progress = { current: { project: "demo", summary: "흐름도 표 만들기", asked: "표로 보여 줘", did: "트리 표 추가", timestamp: kst("2026-10-15", "14:02") }, history: [{ project: "demo", summary: "어제 정리", timestamp: kst("2026-10-14", "18:20") }] };
  fs.mkdirSync(projectStudioDir(home, "demo"), { recursive: true });
  fs.writeFileSync(path.join(projectStudioDir(home, "demo"), "progress.yaml"), YAML.stringify(progress));
  return { home, repo, other };
}

describe("Log 날짜 · 주", () => {
  it("파일 이름이 되는 날짜만 받는다", () => {
    expect(() => assertLogDate("../etc")).toThrow();
    expect(() => assertLogDate("2026-02-30")).toThrow();
    expect(assertLogDate("2026-10-15")).toBe("2026-10-15");
  });
  it("ISO 주는 월요일에 시작하고 해를 넘긴다", () => {
    expect(isoWeekKey("2026-10-15")).toBe("2026-W42");
    expect(isoWeekRange("2026-W42")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(() => isoWeekRange("2026-W60")).toThrow();
  });
  it("작은 glob", () => {
    expect(globRegExp("**/*.{tsx,css}").test("app/src/Panel.tsx")).toBe(true);
    expect(globRegExp("**/*.{tsx,css}").test("Panel.tsx")).toBe(true);
    expect(globRegExp("**/*.md").test("a/b.mdx")).toBe(false);
    const tagger = makeTagger(defaultLogConfig());
    expect(tagger.pathTags("src/Panel.tsx")).toEqual(["UI"]);
    expect(tagger.wordTags("저장 스키마를 바꿈")).toEqual(["데이터"]);
  });
});

describe("Log 정리", () => {
  it("원문에서 그날 기록을 만들고, 같은 입력이면 같은 바이트, 빈 날 · 오지 않은 날은 파일이 없다", async () => {
    const { home } = await setup({ git: true });
    const first = await buildLog(home, "demo", { from: "2026-10-01", to: "2026-10-31" }, NOW);
    expect(first.written.sort()).toEqual(["2026-10-14", "2026-10-15"]);
    const p = logPaths(home, "demo");
    const record = fs.readFileSync(path.join(p.records, "2026-10-15.md"), "utf8");
    expect(record).toContain("state: 잠정");
    expect(record).toContain("**흐름도 표 만들기** · 보고");
    expect(record).toContain("반영: 트리 표 추가");
    expect(record).toContain("**패널 그리기** · 커밋 · #UI #문서");
    expect(record).toContain("## 작업 트리 상태");
    expect(record).not.toMatch(/built|builtAt/);
    expect(fs.existsSync(path.join(p.records, "2026-10-13.md"))).toBe(false);
    expect(fs.existsSync(path.join(p.records, "2026-10-16.md"))).toBe(false);
    const again = await buildLog(home, "demo", { from: "2026-10-15", to: "2026-10-15" }, NOW);
    expect(again.written).toEqual([]);
    expect(fs.readFileSync(path.join(p.records, "2026-10-15.md"), "utf8")).toBe(record);
    const index = await readLogMonth(home, "demo", "2026-10");
    expect(index?.days["2026-10-15"]).toMatchObject({ state: "잠정", files: 2, fileTags: { UI: 1, 문서: 1 } });
    expect(index?.days["2026-10-15"]?.kinds).toEqual({ 커밋: 1, 진행: 1 });
  });

  it("할일 · 흐름도의 추가 · 완료 · 되돌림 · 삭제를 변동 기록으로 남기고 기록에 보인다", async () => {
    const { home } = await setup();
    const at = new Date(kst("2026-10-15", "09:00"));
    await updateTodos(home, "demo", () => [{ id: "t1", title: "레일 버튼 색", done: false, at: at.toISOString() }], at);
    await updateTodos(home, "demo", (rows) => rows.map((r) => ({ ...r, done: true })), new Date(kst("2026-10-15", "10:00")));
    await updateTodos(home, "demo", (rows) => rows.map((r) => ({ ...r, done: false })), new Date(kst("2026-10-15", "11:00")));
    await updateTodos(home, "demo", () => [], new Date(kst("2026-10-15", "12:00")));
    await updateTodos(home, "demo", () => [{ id: "auto", title: "막힘", done: false, at: at.toISOString(), source: "attention" }], at);
    await updateCycleItems(home, "demo", () => [{ id: "c1", step: "design", task: "흐름", name: "오류 흐름", desc: "", tag: "UI", source: "user", at: at.toISOString() }], at);
    const { changes } = await readLogChanges(home, "demo");
    expect(changes.map((c) => `${c.target}:${c.change}`)).toEqual(["todo:add", "todo:done", "todo:undone", "todo:delete", "cycle:add"]);
    await buildLog(home, "demo", { from: "2026-10-15", to: "2026-10-15" }, NOW);
    const day = await readLogDay(home, "demo", "2026-10-15");
    expect(day.events.filter((e) => e.kind === "할일").map((e) => e.change)).toEqual(["추가", "완료", "되돌림", "삭제"]);
    expect(day.events.find((e) => e.kind === "흐름도")?.tagFrom).toEqual({ UI: "연결" });
    expect(day.record).toContain("**레일 버튼 색** · 삭제");
  });

  it("미러가 늦게 옮긴 말은 말한 날로 묶고, 흐름도 태그는 할일 → 방으로 물려받는다", async () => {
    const { home } = await setup();
    await appendRoomMessage(home, "demo", "r1", { role: "user", text: "어제 한 말", sourceAt: kst("2026-10-14", "23:50") }, new Date(kst("2026-10-15", "00:10")));
    await appendRoomMessage(home, "demo", "r1", { role: "user", text: "오늘 한 말" }, new Date(kst("2026-10-15", "09:00")));
    await updateCycleItems(home, "demo", () => [{ id: "c1", step: "build", task: "화면", name: "표", desc: "", tag: "데이터", source: "user", at: kst("2026-10-01", "09:00"), todoId: "t9" }]);
    await updateTodos(home, "demo", () => [{ id: "t9", title: "표 만들기", done: false, at: kst("2026-10-01", "09:00"), roomId: "r1" }]);
    await buildLog(home, "demo", { from: "2026-10-14", to: "2026-10-15" }, NOW);
    const d14 = await readLogDay(home, "demo", "2026-10-14");
    const d15 = await readLogDay(home, "demo", "2026-10-15");
    expect(d14.events.find((e) => e.kind === "대화")).toMatchObject({ id: "room:r1:2026-10-14:0-0", excerpt: ["23:50 어제 한 말"], tagFrom: { 데이터: "연결" } });
    expect(d15.events.find((e) => e.kind === "대화")?.id).toBe("room:r1:2026-10-15:1-1");
  });

  it("확정한 날은 원문이 바뀌어도 그대로, 풀면 다시 잠정", async () => {
    const { home } = await setup();
    await buildLog(home, "demo", { from: "2026-10-14", to: "2026-10-14" }, NOW);
    const confirmed = await confirmLogDay(home, "demo", "2026-10-14", NOW);
    expect(confirmed.state).toBe("확정");
    await expect(confirmLogDay(home, "demo", "2026-10-14", NOW)).rejects.toThrow("이미 확정");
    await expect(confirmLogDay(home, "demo", "2026-10-16", NOW)).rejects.toThrow("오지 않은");
    fs.writeFileSync(path.join(projectStudioDir(home, "demo"), "progress.yaml"), YAML.stringify({ current: null, history: [] }));
    await buildLog(home, "demo", { from: "2026-10-14", to: "2026-10-14" }, NOW);
    const kept = await readLogDay(home, "demo", "2026-10-14");
    expect(kept.record).toContain("**어제 정리**");
    expect(kept.record).toContain("state: 확정");
    const reopened = await reopenLogDay(home, "demo", "2026-10-14", NOW);
    expect(reopened.state).toBeNull(); // 원문이 비었으니 잠정 기록도 없다
    expect(fs.readdirSync(path.join(logPaths(home, "demo").events, "archive"))).toHaveLength(1);
  });

  it("git 레포가 아니면 수집 불가로 남기고, 두 프로젝트는 섞이지 않으며, 동시에 정리해도 색인이 깨지지 않는다", async () => {
    const { home } = await setup();
    await appendRoomMessage(home, "else", "r1", { role: "user", text: "다른 프로젝트 말" }, new Date(kst("2026-10-15", "09:00")));
    await Promise.all([1, 2, 3].map(() => buildLog(home, "demo", { from: "2026-10-15", to: "2026-10-15" }, NOW)));
    const index = await readLogMonth(home, "demo", "2026-10");
    expect(index?.sources.find((s) => s.name === "git 커밋")).toMatchObject({ state: "unavailable", note: "git 레포가 아님" });
    expect(index?.entries.some((e) => e.kind === "대화")).toBe(false);
    await buildLog(home, "else", { from: "2026-10-15", to: "2026-10-15" }, NOW);
    expect((await readLogMonth(home, "else", "2026-10"))?.entries.map((e) => e.kind)).toEqual(["대화"]);
  });
});

describe("Log 보고서 바탕 · 요약", () => {
  it("기간 근거를 모아 처음 한 번 만들고, 그다음은 덮지 않는다", async () => {
    const { home } = await setup({ git: true });
    const first = await draftLogReport(home, "demo", "week", "2026-W42", NOW);
    expect(first.created).toBe(true);
    expect(first.text).toContain("range: 2026-10-12 ~ 2026-10-18");
    expect(first.text).toContain("> 아직 끝나지 않은 기간이다.");
    expect(first.text).toContain("10/15 흐름도 표 만들기 — 트리 표 추가 [progress:");
    expect(first.text).toContain("| UI | 1 | 1 |");
    fs.writeFileSync(first.file, "사람이 고침\n");
    const second = await draftLogReport(home, "demo", "week", "2026-W42", NOW);
    expect(second).toMatchObject({ created: false, text: "사람이 고침\n" });
  });

  it("요약 입력은 사건 줄을 남기고 딸린 줄부터 줄이며, 흔한 절 이름 바꿈은 바로잡는다", () => {
    const record = `---\nstate: 잠정\n---\n# x\n\n## 진행\n\n- 10:00 **일** · 보고 · \`progress:a\`\n  - 요청: ${"가".repeat(300)}\n  - 반영: 됨\n  - 발췌 ${"나".repeat(300)}\n\n## 수집\n\n- 진행 보고: 1건\n`;
    expect(compactLogRecord(record, 10_000)).not.toContain("## 수집");
    expect(compactLogRecord(record, 200)).toBe("# x\n\n## 진행\n\n- 10:00 **일** · 보고 · `progress:a`\n  - 반영: 됨");
    expect(compactLogRecord(record, 50)).toBe("# x\n\n## 진행\n\n- 10:00 **일** · 보고 · `progress:a`");
    expect(compactLogRecord(record, 10)).toBeNull();
    const text = "## 한 눈에\n했다.\n## 한 일\n- 일 [progress:a]\n## 결정\n- 확인되지 않음\n## 막힌 것\n- 확인되지 않음\n## 태그 제안\n- 일 [progress:a]";
    expect(checkLogSummary(text, record).ok).toBe(true);
  });

  it("근거 id 가 기록에 없거나 절이 빠진 요약은 거절하고, 기록이 바뀌면 낡음", async () => {
    const { home } = await setup();
    await buildLog(home, "demo", { from: "2026-10-15", to: "2026-10-15" }, NOW);
    const day = await readLogDay(home, "demo", "2026-10-15");
    const id = [...logRecordIds(day.record!)][0]!;
    const good = `## 한 줄 요약\n표를 만들었다.\n## 한 일\n- 트리 표 [${id}]\n## 결정\n- 확인되지 않음\n## 막힌 것 · 남은 일\n- 확인되지 않음\n## 태그 제안\n- 트리표 [${id}]`;
    expect(checkLogSummary(good, day.record!)).toMatchObject({ ok: true, tags: ["트리표"] });
    expect(checkLogSummary(good.replace(id, "progress:없는것"), day.record!).errors.join()).toContain("기록에 없는 근거");
    expect(checkLogSummary(good.replace("## 결정\n- 확인되지 않음\n", ""), day.record!).ok).toBe(false);
    await writeLogSummary(home, "demo", "2026-10-15", { model: "m", text: good, record: day.record! });
    expect((await readLogDay(home, "demo", "2026-10-15")).summary.state).toBe("fresh");
    await updateTodos(home, "demo", () => [{ id: "n", title: "새 일", done: false, at: kst("2026-10-15", "20:00") }], new Date(kst("2026-10-15", "20:00")));
    await buildLog(home, "demo", { from: "2026-10-15", to: "2026-10-15" }, NOW);
    expect((await readLogDay(home, "demo", "2026-10-15")).summary.state).toBe("stale");
  });
});
