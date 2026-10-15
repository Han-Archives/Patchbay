import { z } from "zod";

export const historyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "실제 존재하는 날짜를 입력해주세요.");
export const dashboardHistoryInputSchema = z.object({
  date: historyDateSchema,
  tags: z.array(z.string().trim().min(1).max(30)).min(1).max(6).transform(tags => [...new Set(tags)]),
  content: z.string().trim().min(1).max(5000),
});
export const dashboardHistoryEntrySchema = dashboardHistoryInputSchema.extend({ id: z.string().uuid(), timestamp: z.string().datetime() });
export type DashboardHistoryInput = z.input<typeof dashboardHistoryInputSchema>;
export type DashboardHistoryEntry = z.infer<typeof dashboardHistoryEntrySchema>;
