import { readOverlay, readPassedNodes, recordTestRuns, recordPassedNodes } from "@patchbay/core";
import type { TestActivity, TestActivityEntry } from "./testContract.js";

export type { TestActivity, TestActivityEntry } from "./testContract.js";

/**
 * 3 테스트의 실행 로그 (사용자 결정 2026-10-08 — 테스트 아래쪽 버튼을 누르면 보이는 정도로).
 *
 * 프로젝트의 그래프 서버(`langgraph dev`)에서 이 설계의 스레드를 읽어, 실행마다
 * 「무엇이 들어왔나 · 어느 노드가 일했나 · 어느 노드가 건너뛰었나」를 낸다. 서버의 체크포인트에는
 * 노드가 쓴 값(`writes`)이 비어 오므로, 이웃한 체크포인트의 값을 비교한다 — 값을 바꾼 노드가 일한 노드다.
 *
 * 일한 노드는 작업 공간에 쌓는다(`test/passed-nodes.json`). 4 지식 그래프 · 5 문서 호출은
 * 설계의 노드를 모두 한 번 이상 지난 뒤 열린다 — 단계 띠는 그 파일을 읽는다.
 */



interface Checkpoint {
  values?: Record<string, unknown>;
  next?: string[];
  created_at?: string;
  metadata?: { source?: string; step?: number; run_id?: string };
}

const TIMEOUT_MS = 5000;

async function call<T>(fetchImpl: typeof fetch, url: string, method: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).sort();
}

/** 한 스레드의 체크포인트들(최신이 앞) → 실행마다의 항목. 순수 함수 — 시험은 이것을 본다. */
export function activityFromHistory(threadId: string, history: readonly Checkpoint[], statusOf: (runId: string) => string): TestActivityEntry[] {
  const steps = [...history].sort((a, b) => (a.metadata?.step ?? 0) - (b.metadata?.step ?? 0));
  const byRun = new Map<string, TestActivityEntry>();
  const entryFor = (runId: string, at: string | undefined) => {
    let entry = byRun.get(runId);
    if (!entry) {
      entry = { runId, threadId, status: statusOf(runId), startedAt: at ?? null, endedAt: at ?? null, input: [], worked: [], skipped: [] };
      byRun.set(runId, entry);
    }
    if (at && (!entry.startedAt || at < entry.startedAt)) entry.startedAt = at;
    if (at && (!entry.endedAt || at > entry.endedAt)) entry.endedAt = at;
    return entry;
  };
  let before: Record<string, unknown> = {};
  let ran: string | undefined;
  for (const cp of steps) {
    const after = cp.values ?? {};
    const runId = cp.metadata?.run_id;
    // 「입력」 체크포인트는 입력을 넣기 전 값이다 — 입력은 다음 단계(`__start__`)에서 들어간다 (2026-10-08 실측).
    if (runId && cp.metadata?.source !== "input") {
      const entry = entryFor(runId, cp.created_at);
      const changed = changedKeys(before, after);
      if (ran === "__start__") {
        for (const k of changed) if (!entry.input.includes(k)) entry.input.push(k);
      } else if (ran) {
        const list = changed.length ? entry.worked : entry.skipped;
        if (!list.includes(ran)) list.push(ran);
      }
    } else if (runId) {
      entryFor(runId, cp.created_at);
    }
    before = after;
    ran = cp.next?.[0];
  }
  return [...byRun.values()];
}

export async function readTestActivity(
  studioHome: string,
  alias: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<TestActivity> {
  const overlay = await readOverlay(studioHome, alias);
  const total = (overlay.ir?.nodes ?? []).map((n) => n.id);
  const graphId = overlay.ir?.graph || null;
  const known = await readPassedNodes(studioHome, alias);
  const passedOf = (nodes: Record<string, string>) => total.filter((id) => nodes[id]);
  const base: TestActivity = { reachable: false, url: baseUrl, graphId, threads: 0, entries: [], passed: passedOf(known.nodes), total };
  if (!graphId) return { ...base, error: "승인된 설계가 없다 — 어느 그래프의 실행인지 모른다." };

  const ok = await call<unknown>(fetchImpl, `${baseUrl}/ok`, "GET");
  if (ok === null) return { ...base, error: `그래프 서버(${baseUrl})에 닿지 못했다 — 프로젝트에서 서버를 켜야 한다.` };

  const threads =
    (await call<{ thread_id: string }[]>(fetchImpl, `${baseUrl}/threads/search`, "POST", {
      metadata: { graph_id: graphId },
      limit: 10,
      sort_by: "updated_at",
      sort_order: "desc",
    })) ?? [];
  const entries: TestActivityEntry[] = [];
  for (const t of threads.slice(0, 5)) {
    const [history, runs] = await Promise.all([
      call<Checkpoint[]>(fetchImpl, `${baseUrl}/threads/${encodeURIComponent(t.thread_id)}/history`, "POST", { limit: 300 }),
      call<{ run_id: string; status: string }[]>(fetchImpl, `${baseUrl}/threads/${encodeURIComponent(t.thread_id)}/runs?limit=100`, "GET"),
    ]);
    const status = new Map((runs ?? []).map((r) => [r.run_id, r.status]));
    entries.push(...activityFromHistory(t.thread_id, history ?? [], (id) => status.get(id) ?? "unknown"));
  }
  entries.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  // 원본으로 남긴다 — 4 지식 그래프의 실행 행이 여기서 다시 만들어진다(원칙 7).
  await recordTestRuns(studioHome, alias, entries);
  const seen = entries.flatMap((e) => e.worked.map((node) => ({ node, at: e.startedAt ?? now.toISOString() })));
  const passed = await recordPassedNodes(studioHome, alias, seen, now);
  return { ...base, reachable: true, threads: threads.length, entries: entries.slice(0, 60), passed: passedOf(passed.nodes) };
}
