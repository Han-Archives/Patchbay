/**
 * Client-safe 2단계(구현) view types. **타입만 가져온다** — 커널에서 값을 하나라도
 * 끌어오면 `node:fs` 를 쓰는 커널 묶음이 브라우저 묶음에 들어온다. 뼈대 파일 이름은
 * 커널이 정하므로 (`SCAFFOLD_FILES`) 서버가 이름과 설명을 붙여 내려준다.
 */

import type { Ir, NodeSetComparison } from "@patchbay/core";

export type { Ir, NodeSetComparison };

export interface ScaffoldFileView {
  file: string;
  role: string;
  exists: boolean;
  /** 프로젝트 폴더 기준 상대 경로. 파일 보기로 열 수 있게. */
  path: string;
}

/**
 * 1단계의 출력이 아직 없다 — 2단계는 열리지 않는다 (기획 20260928a §2).
 * 화면은 이 자리에서 1 설계로 돌려보낸다.
 */
export interface BuildViewLocked {
  status: "locked";
  alias: string;
  reason: string;
  next: string;
}

export interface BuildViewReady {
  status: "ready";
  alias: string;
  /** 승인본 버전 (`overlay.ir`). 번호가 없는 승인본도 있다. */
  version: number | null;
  /** 프로젝트 폴더 기준 상대 경로 — 절대 경로는 사람이 읽을 것이 아니다. */
  outDir: string;
  files: ScaffoldFileView[];
  /** 세 파일이 다 있다. */
  generated: boolean;
  /**
   * IR 노드와 `graph.ts` 노드 (2.6). 생성 전에는 `graph` 가 빈 배열이다 —
   * 「아직 없다」와 「어긋난다」는 다른 말이라 여기서 합치지 않는다.
   */
  nodes: NodeSetComparison;
  /** 승인본 그대로. 화면이 노드·엣지를 그린다. */
  ir: Ir;
}

export type BuildViewResponse = BuildViewLocked | BuildViewReady;

export interface BuildGenerateResponse {
  ok: boolean;
  /** 이번에 쓴 파일. 빈 배열이면 전부 이미 있었다. */
  written?: string[];
  /** 이미 있어서 건드리지 않은 파일 (`--force` 가 없다). */
  skipped?: string[];
  outDir?: string;
  nodes?: NodeSetComparison;
  error?: string;
  /** 1.9가 막았을 때 돌아갈 칸. */
  failedGates?: string[];
}

/** 생성 결과를 사람의 한 줄로. 화면과 시험이 같은 문장을 쓴다. */
export function generateNote(body: BuildGenerateResponse): string {
  if (!body.ok) return body.error ?? "생성하지 못했다";
  const written = body.written ?? [];
  const skipped = body.skipped ?? [];
  const head = written.length ? `생성했다 — ${written.join(", ")}` : "새로 쓸 파일이 없었다";
  return skipped.length ? `${head} · 이미 있어 그대로 둠: ${skipped.join(", ")}` : head;
}
