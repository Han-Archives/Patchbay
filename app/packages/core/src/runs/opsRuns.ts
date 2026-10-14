import fs from "node:fs/promises";
import path from "node:path";
import { projectStudioDir } from "../studio/studioStore.js";

/**
 * 3 운영의 실행 한 번 — 그래프 서버의 스레드 체크포인트에서 읽은 것 (사용자 결정 2026-10-08).
 * §5.2 실행 기록(`runs/<id>.json`)과 다르다: 모델 · 도구 · 문서 호출 칸이 없어도 「어느 노드가 일했나」는 안다.
 *
 * `ops/activity.json` 이 원본이다 — 4 지식 그래프의 실행 행(`Run` · `RAN`)이 여기서 다시 만들어진다(원칙 7).
 */
export interface OpsRunEntry {
  runId: string;
  threadId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  /** 이 실행에 들어온 State 칸 (사람이 넣은 답 등). */
  input: string[];
  /** 값을 바꾼 노드 — 실제로 일했다. */
  worked: string[];
  /** 돌았지만 할 일이 없어 건너뛴 노드. */
  skipped: string[];
}

export const OPS_ACTIVITY_FILE = "activity.json";
const KEEP = 500;

function file(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), "ops", OPS_ACTIVITY_FILE);
}

export async function readOpsRuns(studioHome: string, alias: string): Promise<OpsRunEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(studioHome, alias), "utf8")) as { runs?: OpsRunEntry[] };
    return parsed.runs ?? [];
  } catch {
    return [];
  }
}

/** 실행 id로 합친다 — 같은 실행을 다시 읽으면 새 값으로. 최신 500개만 둔다. 바뀐 게 없으면 쓰지 않는다. */
export async function recordOpsRuns(studioHome: string, alias: string, entries: readonly OpsRunEntry[]): Promise<OpsRunEntry[]> {
  const current = await readOpsRuns(studioHome, alias);
  const byId = new Map(current.map((e) => [e.runId, e]));
  let changed = false;
  for (const e of entries) {
    const before = byId.get(e.runId);
    if (!before || JSON.stringify(before) !== JSON.stringify(e)) {
      byId.set(e.runId, e);
      changed = true;
    }
  }
  const runs = [...byId.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).slice(0, KEEP);
  if (changed) {
    await fs.mkdir(path.dirname(file(studioHome, alias)), { recursive: true });
    await fs.writeFile(file(studioHome, alias), JSON.stringify({ runs }, null, 2), "utf8");
  }
  return runs;
}
