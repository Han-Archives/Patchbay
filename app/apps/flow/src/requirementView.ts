import { loadRequirementWorkspace, markRequirements, saveRequirement, readStudio, readConsult, readRoom, RequirementError, requirementReviewInputSchema, requirementEditInputSchema } from "@patchbay/core";
import type { Hono } from "hono";

async function known(home: string, alias: unknown): Promise<string> {
  if (typeof alias !== "string" || !alias.trim()) throw new RequirementError("프로젝트가 필요합니다.");
  if (!(await readStudio(home)).projects.some(p => p.alias === alias)) throw new RequirementError("등록된 프로젝트가 아닙니다.", 404);
  return alias;
}
export function registerRequirementRoutes(app: Hono, home: string) {
  app.get("/api/requirements", async c => {
    try {
      const alias = await known(home, c.req.query("alias"));
      return c.json(await loadRequirementWorkspace(home, alias, c.req.query("source") === "current" ? "current" : "proposed"));
    } catch (e) { return c.json({ error: (e as Error).message }, e instanceof RequirementError ? e.status : 500); }
  });
  app.post("/api/requirements/review", async c => {
    try {
      const parsed = requirementReviewInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new RequirementError("검토 요청 형식이 올바르지 않습니다.");
      const alias = await known(home, parsed.data.alias);
      return c.json(await markRequirements(home, alias, parsed.data));
    } catch (e) { return c.json({ error: (e as Error).message }, e instanceof RequirementError ? e.status : 500); }
  });
  app.post("/api/requirements/edit", async c => {
    try {
      const parsed = requirementEditInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new RequirementError("요구사항 편집 요청 형식이 올바르지 않습니다.");
      const alias = await known(home, parsed.data.alias);
      return c.json(await saveRequirement(home, alias, parsed.data));
    } catch (e) { return c.json({ error: (e as Error).message }, e instanceof RequirementError ? e.status : 500); }
  });
  app.get("/api/requirements/evidence", async c => {
    try {
      const alias = await known(home, c.req.query("alias"));
      const workspace = await loadRequirementWorkspace(home, alias, c.req.query("source") === "current" ? "current" : "proposed");
      const row = workspace.rows.find(r => r.id === c.req.query("id"));
      if (!row) throw new RequirementError("요구사항이 없습니다.", 404);
      const ref = (row.after ?? row.before)?.source;
      if (!ref) return c.json({ reference: null, messages: [], note: "연결된 대화 근거가 없습니다. 요구사항 편집에서 근거를 연결할 수 있습니다." });
      const read = ref.kind === "consult" ? await readConsult(home, alias, ref.id) : await readRoom(home, alias, ref.id);
      if (!read) return c.json({ reference: ref, messages: [], note: "근거 대화를 찾지 못했습니다. 참조를 확인해주세요." });
      const messages = read.messages.filter(m => "text" in m && typeof m.text === "string");
      const index = ref.turn === undefined ? -1 : messages.findIndex(m => m.seq === ref.turn);
      const selected = ref.turn === undefined ? messages.slice(-5) : index < 0 ? [] : messages.slice(Math.max(0, index - 1), index + 2);
      return c.json({ reference: ref, messages: selected.map(m => ({ turn: m.seq, role: m.role, at: m.at, text: "text" in m ? m.text : "" })),
        note: ref.turn === undefined ? "특정 발언이 연결되지 않아 최근 문맥을 표시합니다." : index < 0 ? "참조한 발언을 찾지 못했습니다." : "" });
    } catch (e) { return c.json({ error: (e as Error).message }, e instanceof RequirementError ? e.status : 500); }
  });
}
