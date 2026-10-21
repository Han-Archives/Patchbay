import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExistingLink, ExistingLinkResult } from "@patchbay/core";

/**
 * 「이미 구현됨」 길의 3 테스트 — 확인된 연결의 테스트를 그 프로젝트의 vitest로 돌린다
 * (절차 `이미구현-길-설계안_20261020_v1` §4). 결과는 연결마다 통과 · 실패 · 못 찾음이다.
 *
 * vitest는 테스트 파일에서 위로 올라가며 처음 만나는 `node_modules/.bin/vitest` 의 자리에서 돈다 —
 * 모노레포는 테스트 파일과 vitest 가 다른 폴더에 있다(Patchbay 자신이 `app/`).
 */

export interface ExistingRunRow {
  id: string;
  state: ExistingLinkResult["state"];
  note?: string;
}

interface VitestAssertion {
  ancestorTitles?: string[];
  title?: string;
  status?: string;
}

export interface VitestReport {
  testResults?: Array<{ name?: string; status?: string; message?: string; assertionResults?: VitestAssertion[] }>;
}

const RUN_TIMEOUT_MS = 10 * 60_000;

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** 테스트 파일에서 프로젝트 폴더까지 올라가며 vitest 가 있는 첫 폴더. 없으면 null. */
export async function vitestRootFor(projectPath: string, file: string): Promise<string | null> {
  const top = path.resolve(projectPath);
  let dir = path.dirname(path.resolve(top, file));
  for (;;) {
    if (await exists(path.join(dir, "node_modules", ".bin", "vitest"))) return dir;
    if (dir === top || !dir.startsWith(top)) return null;
    dir = path.dirname(dir);
  }
}

/**
 * 보고서 → 연결마다의 결과. 순수 함수 — 시험은 이것을 본다.
 * `test` 가 비면 파일 전체, 아니면 그 이름이거나 그 이름 아래(` > ` 로 이어진)의 테스트 전부가 통과해야 한다.
 */
export function rowsFromReport(links: readonly ExistingLink[], report: VitestReport, root: string, projectPath: string): ExistingRunRow[] {
  const byFile = new Map((report.testResults ?? []).map((entry) => [path.resolve(entry.name ?? ""), entry]));
  return links.map((link): ExistingRunRow => {
    const entry = byFile.get(path.resolve(projectPath, link.file));
    if (!entry) return { id: link.id, state: "missing", note: `vitest(${path.relative(projectPath, root) || "."})가 이 파일을 돌리지 않았다` };
    const tests = (entry.assertionResults ?? []).map((row) => ({ name: [...(row.ancestorTitles ?? []), row.title ?? ""].join(" > "), status: row.status ?? "" }));
    const mine = link.test ? tests.filter((row) => row.name === link.test || row.name.startsWith(`${link.test} > `)) : tests;
    if (mine.length === 0) {
      if (!link.test && entry.status === "failed") return { id: link.id, state: "fail", note: entry.message?.split("\n")[0] ?? "파일이 실패했다" };
      return { id: link.id, state: "missing", note: link.test ? `「${link.test}」 테스트가 없다` : "파일에 테스트가 없다" };
    }
    const failed = mine.filter((row) => row.status === "failed");
    if (failed.length) return { id: link.id, state: "fail", note: `실패 ${failed.length}/${mine.length}: ${failed[0]!.name}` };
    const notRun = mine.filter((row) => row.status !== "passed");
    if (notRun.length) return { id: link.id, state: "missing", note: `돌지 않음 ${notRun.length}/${mine.length} (${notRun[0]!.status})` };
    return { id: link.id, state: "pass" };
  });
}

function runVitest(root: string, files: string[], outputFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, "node_modules", ".bin", "vitest"), ["run", "--reporter=json", `--outputFile=${outputFile}`, ...files], {
      cwd: root,
      stdio: "ignore",
      env: { ...process.env, CI: "1" },
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), RUN_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    // 실패한 테스트가 있으면 0이 아닌 코드로 끝난다 — 그것도 결과다. 보고서가 있는지로 판단한다.
    child.on("close", () => { clearTimeout(timer); resolve(); });
  });
}

/** 확인된 연결만 돌린다. vitest 자리마다 한 번씩. */
export async function runExistingTests(projectInput: string, links: readonly ExistingLink[]): Promise<ExistingRunRow[]> {
  // vitest 보고서는 실제 경로를 쓴다 — macOS의 /var → /private/var 처럼 링크가 낀 경로는 그대로 비교하면 어긋난다.
  const projectPath = await fs.realpath(projectInput);
  const confirmed = links.filter((link) => link.state === "confirmed");
  const groups = new Map<string | null, ExistingLink[]>();
  for (const link of confirmed) {
    const root = await vitestRootFor(projectPath, link.file);
    groups.set(root, [...(groups.get(root) ?? []), link]);
  }
  const rows: ExistingRunRow[] = [];
  for (const [root, group] of groups) {
    if (!root) {
      rows.push(...group.map((link) => ({ id: link.id, state: "missing" as const, note: "이 파일 위로 vitest 가 설치된 폴더가 없다" })));
      continue;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchbay-existing-run-"));
    const output = path.join(dir, "report.json");
    try {
      const files = [...new Set(group.map((link) => path.relative(root, path.resolve(projectPath, link.file))))];
      await runVitest(root, files, output);
      let report: VitestReport;
      try {
        report = JSON.parse(await fs.readFile(output, "utf8")) as VitestReport;
      } catch {
        rows.push(...group.map((link) => ({ id: link.id, state: "fail" as const, note: "vitest 가 보고서를 남기지 않았다 — 설정 오류나 시간 초과" })));
        continue;
      }
      rows.push(...rowsFromReport(group, report, root, projectPath));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  return rows;
}
