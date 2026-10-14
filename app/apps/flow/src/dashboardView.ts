import { readSystemMap } from "./systemMap.js";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  projectDocs,
  DEFAULT_SCAFFOLD_DIR,
  parseIr,
  projectStudioDir,
  readOverlay,
  readProgress,
  readPassedNodes,
  readStudio,
  type Ir,
} from "@patchbay/core";
import type { DashboardMetric, DashboardView, EvalOutcome } from "./opsContract.js";

export type { DashboardMetric, DashboardView, EvalOutcome } from "./opsContract.js";

/**
 * 0 대시보드 (사용자 결정 2026-10-08 — 「구조」 창이 큰 대시보드이길 바랐다).
 *
 * 한 장에: 진행(설계 · 노드 채움 · 시험 · 실행) · 에이전트 지표(그래프 서버의 마지막 State) · 먼저 볼 것 ·
 * 요구사항 지도(요구사항 → 시험 결과) · 그래프(설계 노드와 지난 노드). 프로젝트 전용 코드가 없다 —
 * 지표 이름은 설계의 개념에서, 값은 State 칸에서, 시험 결과는 생성된 시험의 「E<n> · …」 이름에서 읽는다.
 */




const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** State 칸 → 사람이 읽는 이름. 같은 낱말의 개념(`estimatedScore` ↔ `estimated-score`)이 있으면 그 라벨의 앞부분. */
export function metricLabel(ir: Ir, field: string): { label: string; output: boolean } {
  const entry = ir.state.find((s) => s.field === field);
  const candidates = [entry?.concept, kebab(field), kebab(field).replace(/s$/, "")].filter(Boolean) as string[];
  const concept = ir.concepts.find((c) => candidates.includes(c.id));
  return { label: concept ? concept.label.split(/\s+—\s+/)[0]! : field, output: concept?.kind === "output" };
}

/** 마지막 State → 지표. 숫자는 그대로, 짧은 글은 글로, 배열은 개수로. 객체는 뺀다(대시보드에 펼치면 읽을 수 없다). */
export function metricsFrom(ir: Ir, values: Record<string, unknown>): DashboardMetric[] {
  const out: DashboardMetric[] = [];
  for (const entry of ir.state) {
    const value = values[entry.field];
    const { label, output } = metricLabel(ir, entry.field);
    if (typeof value === "number") out.push({ field: entry.field, label, output, kind: "number", value });
    else if (typeof value === "string" && value.trim() && value.length <= 40) out.push({ field: entry.field, label, output, kind: "text", value });
    else if (Array.isArray(value)) out.push({ field: entry.field, label, output, kind: "count", value: value.length });
  }
  return out.sort((a, b) => Number(b.output) - Number(a.output));
}

const RESULTS_FILE = "eval-results.json";
const resultsPath = (studioHome: string, alias: string) => path.join(projectStudioDir(studioHome, alias), "ops", RESULTS_FILE);

async function readTests(studioHome: string, alias: string): Promise<DashboardView["tests"]> {
  try {
    return JSON.parse(await fs.readFile(resultsPath(studioHome, alias), "utf8")) as DashboardView["tests"];
  } catch {
    return null;
  }
}

/** vitest JSON 리포트 → 시험 id별 결과. 이름이 「E12 · …」 로 시작하는 시험만 센다(생성기가 붙인 이름). */
export function testsFromVitest(report: unknown, at: string): NonNullable<DashboardView["tests"]> {
  const results: Record<string, EvalOutcome> = {};
  const files = (report as { testResults?: { assertionResults?: { title?: string; status?: string }[] }[] })?.testResults ?? [];
  for (const file of files) {
    for (const t of file.assertionResults ?? []) {
      const id = /^(E\d+)\b/.exec(t.title ?? "")?.[1];
      if (!id) continue;
      const outcome: EvalOutcome =
        t.status === "passed" ? "pass" : t.status === "failed" ? "fail" : t.status === "todo" ? "todo" : "skip";
      // 같은 id의 시험이 여럿이면: 하나라도 실패면 실패, 아니면 하나라도 통과면 통과.
      const prev = results[id];
      results[id] = prev === "fail" || outcome === "fail" ? "fail" : prev === "pass" || outcome === "pass" ? "pass" : outcome;
    }
  }
  const values = Object.values(results);
  return {
    at,
    results,
    passed: values.filter((v) => v === "pass").length,
    failed: values.filter((v) => v === "fail").length,
    todo: values.filter((v) => v === "todo" || v === "skip").length,
  };
}

/** 프로젝트의 생성된 시험을 돌려 결과를 남긴다 — 사람이 대시보드에서 누를 때만. 모델을 부르지 않는 시험이다(명세 §8). */
export async function runProjectTests(studioHome: string, alias: string, timeoutMs = 300_000): Promise<{ ok: true; tests: NonNullable<DashboardView["tests"]> } | { ok: false; error: string }> {
  const project = (await readStudio(studioHome)).projects.find((p) => p.alias === alias);
  if (!project) return { ok: false, error: `"${alias}" 는 등록된 프로젝트가 아니다.` };
  const out = path.join(os.tmpdir(), `patchbay-tests-${alias.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  await fs.rm(out, { force: true });
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn("npx", ["vitest", "run", DEFAULT_SCAFFOLD_DIR, "--reporter=json", `--outputFile=${out}`], {
      cwd: project.path,
      stdio: "ignore",
      env: { ...process.env, CI: "1" },
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve(c);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  let report: unknown;
  try {
    report = JSON.parse(await fs.readFile(out, "utf8"));
  } catch {
    return { ok: false, error: code === null ? "시험을 돌리지 못했다 — npx vitest 를 찾지 못했다." : "시험 결과를 읽지 못했다 — 시간 초과거나 vitest 가 결과를 남기지 않았다." };
  }
  const tests = testsFromVitest(report, new Date().toISOString());
  await fs.mkdir(path.dirname(resultsPath(studioHome, alias)), { recursive: true });
  await fs.writeFile(resultsPath(studioHome, alias), JSON.stringify(tests, null, 2), "utf8");
  return { ok: true, tests };
}

async function latestState(url: string, graphId: string): Promise<{ threadId: string; updatedAt: string | null; values: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`${url}/threads/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ metadata: { graph_id: graphId }, limit: 1, sort_by: "updated_at", sort_order: "desc" }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const [thread] = (await res.json()) as { thread_id: string; updated_at?: string; values?: Record<string, unknown> }[];
    if (!thread) return null;
    return { threadId: thread.thread_id, updatedAt: thread.updated_at ?? null, values: thread.values ?? {} };
  } catch {
    return null;
  }
}

/** .env 에 그 이름이 있나 — 값은 읽지 않는다(이름만 본다). */
async function envNames(repo: string): Promise<Set<string>> {
  try {
    const text = await fs.readFile(path.join(repo, ".env"), "utf8");
    return new Set(text.split("\n").map((l) => /^\s*([A-Z0-9_]+)\s*=/.exec(l)?.[1]).filter((x): x is string => Boolean(x)));
  } catch {
    return new Set();
  }
}

export async function loadDashboard(studioHome: string, alias: string, langgraphUrl: string): Promise<DashboardView> {
  const overlay = await readOverlay(studioHome, alias);
  const parsed = overlay.ir ? parseIr(overlay.ir) : null;
  const ir = parsed?.ok ? parsed.ir : null;
  const project = (await readStudio(studioHome)).projects.find((p) => p.alias === alias);
  const tests = await readTests(studioHome, alias);
  const passed = await readPassedNodes(studioHome, alias);
  const state = ir?.graph ? await latestState(langgraphUrl, ir.graph) : null;

  const attention: string[] = [];
  if (ir) {
    for (const m of ir.models) if (/미정|undecided/i.test(m.provider)) attention.push(`모델 미정 — ${m.id}`);
    const names = project ? await envNames(project.path) : new Set<string>();
    for (const c of ir.credentials) {
      if (c.storedAt !== "env") continue;
      const guess = c.id.toUpperCase().replace(/-/g, "_");
      if (![...names].some((n) => n === guess || n.startsWith(guess.replace(/_KEY$/, "")))) attention.push(`자격 증명 없음 — ${c.id} (.env)`);
    }
    for (const q of ir.openQuestions ?? []) attention.push(`열린 질문 — ${q}`);
  }
  if (ir?.graph && !state) attention.push(`그래프 서버(${langgraphUrl})에 닿지 못했다 — 프로젝트에서 서버를 켠다`);
  if (tests?.failed) attention.push(`시험 실패 ${tests.failed}개`);
  if (tests?.todo) attention.push(`사람 판단 · 건너뛴 시험 ${tests.todo}개`);

  const progress = await readProgress(studioHome, alias);
  return {
    progressLog: [...(progress.current ? [progress.current] : []), ...progress.history],
    alias,
    system: project ? await readSystemMap(project.path, projectDocs(project)) : null,
    design: ir ? { version: ir.version ?? null, requirements: ir.requirements.length, evals: ir.evals.length, nodes: ir.nodes.length } : null,
    requirements: (ir?.requirements ?? []).map((r) => {
      const links = (ir?.requirementLinks ?? []).filter((l) => l.requirement === r.id);
      return {
        id: r.id,
        summary: r.summary ?? r.text,
        priority: r.priority ?? null,
        evals: [...new Set(links.map((l) => l.eval))],
        node: links[0]?.node ?? null,
      };
    }),
    tests,
    nodes: (ir?.nodes ?? []).map((n) => ({ id: n.id, passed: Boolean(passed.nodes[n.id]) })),
    agent: {
      reachable: Boolean(state),
      url: langgraphUrl,
      threadId: state?.threadId ?? null,
      updatedAt: state?.updatedAt ?? null,
      metrics: ir && state ? metricsFrom(ir, state.values) : [],
    },
    attention,
    app: overlay.app?.url ?? null,
  };
}
