import fs from "node:fs/promises";
import path from "node:path";
import { evalEvidenceFilePath, fitEvalRun, parseEvalRun, readCurrentEvalRun, readEvalEvidence, readOverlay, readStudio, scoreEvalRun, writeEvalRun } from "@patchbay/core";
import type { Hono } from "hono";
import type { EvalsReviewResponse } from "./evalsContract.js";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".json": "text/plain; charset=utf-8" };

class EvalsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}

async function known(home: string, alias: unknown): Promise<string> {
  if (typeof alias !== "string" || !alias.trim()) throw new EvalsError("프로젝트가 필요합니다.");
  if (!(await readStudio(home)).projects.some(p => p.alias === alias)) throw new EvalsError("등록된 프로젝트가 아닙니다.", 404);
  return alias;
}

/**
 * Review 화면의 평가 결과 받기 — `patchbay evals record` 와 같은 길 (사용자 요청 2026-10-31).
 * 결과를 만드는 곳은 여전히 바깥이다(실행 · 사람 채점). 콘솔은 받은 결과를 승인된 판에 붙일 뿐이고,
 * 판이 다르면 CLI와 같은 이유로 거절한다 (Core `fitEvalRun`).
 */
export async function loadEvalsReview(home: string, alias: string): Promise<EvalsReviewResponse> {
  const overlay = await readOverlay(home, alias);
  if (!overlay.ir) return { status: "no-design", alias };
  const summaries = new Map(overlay.ir.requirements.map(req => [req.id, req.summary ?? req.text]));
  const current = await readCurrentEvalRun(home, alias);
  const evidence = await readEvalEvidence(home, alias, overlay.ir.version);
  return {
    status: "ok",
    alias,
    irVersion: overlay.ir.version,
    evals: overlay.ir.evals.map(entry => ({
      id: entry.id,
      node: entry.node,
      kind: entry.kind,
      input: entry.input,
      expect: entry.expect,
      requirements: overlay.ir!.requirementLinks.filter(link => link.eval === entry.id).map(link => ({ id: link.requirement, summary: summaries.get(link.requirement) ?? "" })),
      evidence: evidence[entry.id] ?? null,
    })),
    current: current.ok && current.run.irVersion === overlay.ir.version ? { run: current.run, score: scoreEvalRun(current.run) } : null,
  };
}

export function registerEvalRoutes(app: Hono, home: string) {
  app.get("/api/evals", async c => {
    try { return c.json(await loadEvalsReview(home, await known(home, c.req.query("alias")))); }
    catch (e) { return c.json({ error: (e as Error).message }, e instanceof EvalsError ? e.status : 500); }
  });
  /** 근거 첨부 한 개 — evidence.json 에 적힌 이름만 내준다. */
  app.get("/api/evals/evidence-file", async c => {
    try {
      const alias = await known(home, c.req.query("alias"));
      const version = Number(c.req.query("version"));
      if (!Number.isInteger(version) || version < 1) throw new EvalsError("판이 필요합니다.");
      const file = await evalEvidenceFilePath(home, alias, version, c.req.query("eval") ?? "", c.req.query("name") ?? "");
      if (!file) throw new EvalsError("근거 파일이 없습니다.", 404);
      return new Response(new Uint8Array(await fs.readFile(file)), { headers: { "content-type": MIME[path.extname(file).toLowerCase()] ?? "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    } catch (e) { return c.json({ error: (e as Error).message }, e instanceof EvalsError ? e.status : 500); }
  });
  app.post("/api/evals/record", async c => {
    try {
      const body = await c.req.json().catch(() => null) as { alias?: unknown; run?: unknown } | null;
      const alias = await known(home, body?.alias);
      const parsed = parseEvalRun(body?.run);
      if (!parsed.ok) throw new EvalsError(parsed.error);
      const fit = fitEvalRun((await readOverlay(home, alias)).ir, parsed.run);
      if (!fit.ok) throw new EvalsError(fit.error, 409);
      await writeEvalRun(home, alias, parsed.run);
      return c.json({ ok: true, score: scoreEvalRun(parsed.run), unknown: fit.unknown, missing: fit.missing });
    } catch (e) { return c.json({ error: (e as Error).message }, e instanceof EvalsError ? e.status : 500); }
  });
}
