import fs from "node:fs/promises";
import path from "node:path";
import { projectStudioDir } from "../studio/studioStore.js";
import { TEST_STAGE_DIR_NAME } from "./store.js";

/**
 * 실제로 일한 노드 — 테스트에서 그래프가 돌 때, 값을 바꾼 노드(건너뛰지 않은 노드)를 처음 지난 시각과 함께 쌓는다
 * (사용자 결정 2026-10-08: 4 지식 그래프 · 5 문서 호출은 설계의 노드를 모두 한 번 이상 지난 뒤 연다).
 *
 * §5.2 실행 기록과는 다르다 — 그것은 모델 · 도구 · 문서 호출까지 채워야 쓰이고, 못 채우면 쓰지 않는다.
 * 이 파일은 「어느 노드가 실제로 돌았나」 하나만 적는다. 단계 띠는 파일에서 읽으므로 그래프 서버가 꺼져도 남는다.
 */
export const PASSED_NODES_FILE = "passed-nodes.json";

export interface PassedNodes {
  /** 노드 id → 처음 일한 시각. */
  nodes: Record<string, string>;
  /** 마지막으로 그래프 서버에서 읽은 시각. */
  readAt: string | null;
}

/** `test-runs/` 가 아니라 `test/` 에 둔다 — `test-runs/*.json` 은 모두 실행 기록으로 읽힌다. */
function file(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), TEST_STAGE_DIR_NAME, PASSED_NODES_FILE);
}

export async function readPassedNodes(studioHome: string, alias: string): Promise<PassedNodes> {
  try {
    const parsed = JSON.parse(await fs.readFile(file(studioHome, alias), "utf8")) as Partial<PassedNodes>;
    return { nodes: parsed.nodes ?? {}, readAt: parsed.readAt ?? null };
  } catch {
    return { nodes: {}, readAt: null };
  }
}

/** 새로 일한 노드를 더한다. 이미 있는 노드의 처음 시각은 바꾸지 않는다. 바뀐 게 없으면 쓰지 않는다. */
export async function recordPassedNodes(
  studioHome: string,
  alias: string,
  seen: ReadonlyArray<{ node: string; at: string }>,
  now: Date = new Date(),
): Promise<PassedNodes> {
  const current = await readPassedNodes(studioHome, alias);
  let changed = false;
  for (const { node, at } of seen) {
    const earlier = current.nodes[node];
    if (!earlier || Date.parse(at) < Date.parse(earlier)) {
      current.nodes[node] = at;
      changed = true;
    }
  }
  current.readAt = now.toISOString();
  if (changed) {
    await fs.mkdir(path.dirname(file(studioHome, alias)), { recursive: true });
    await fs.writeFile(file(studioHome, alias), JSON.stringify(current, null, 2), "utf8");
  }
  return current;
}
