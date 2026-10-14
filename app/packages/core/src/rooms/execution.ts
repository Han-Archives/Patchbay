import { z } from "zod";
import { roomMemberSchema } from "./types.js";

export const ROOM_WORKFLOW_GRAPH = "patchbay-operations";
export const ROOM_WORKFLOW_PROTOCOL = 1;
export const roomCommandSchema = z.array(z.string().min(1).max(4096)).min(1).max(40);
export const roomConnectedMemberSchema = roomMemberSchema.extend({ id: z.string().min(1) });
export const roomExecutionStartSchema = z.object({
  alias: z.string().min(1), roomId: z.string().min(1), leaderId: z.string().min(1), reviewerId: z.string().min(1),
  testCommand: roomCommandSchema, deployCommand: roomCommandSchema.optional(),
  deployTarget: z.string().max(200).default(""), allowEdits: z.boolean().default(false),
  maxAttempts: z.number().int().min(1).max(3).default(2),
  notifications: z.boolean().default(false),
});
export const roomWorkflowRequestSchema = z.object({
  protocol: z.literal(ROOM_WORKFLOW_PROTOCOL), executionId: z.string(), operationId: z.string(),
  kind: z.enum(["model", "command", "approval", "check_failed", "deploy_approval"]),
  stage: z.enum(["prepare", "act", "check", "deploy"]), memberId: z.string().optional(), task: z.unknown().optional(),
}).passthrough();
export type RoomWorkflowRequest = z.infer<typeof roomWorkflowRequestSchema>;
export const roomReviewSchema = z.object({ outcome: z.enum(["passed", "failed", "consult"]), reason: z.string().min(1), evidence: z.array(z.string()).min(1) });
export const roomPlanSchema = z.object({
  version: z.number().int().positive(),
  digest: z.string().min(1),
  goal: z.string(),
  requirements: z.array(z.object({ id: z.string(), text: z.string(), fit: z.string().optional() })),
  evals: z.array(z.object({ id: z.string(), expect: z.string() })),
  consultIds: z.array(z.string()),
});
export type RoomPlan = z.infer<typeof roomPlanSchema>;
export const roomAssignmentSchema = z.object({
  id: z.string().min(1).max(80),
  memberId: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).min(1),
  instruction: z.string().min(1).max(8000),
  complexity: z.enum(["low", "medium", "high"]),
  reason: z.string().min(1).max(2000),
  effort: z.enum(["low", "medium", "high"]).optional(),
});
export type RoomAssignment = z.infer<typeof roomAssignmentSchema>;
export const roomAllocationSchema = z.object({
  assignments: z.array(roomAssignmentSchema).min(1).max(8),
});
export type RoomAllocation = z.infer<typeof roomAllocationSchema>;
export const roomExecutionSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  assistantId: z.string().min(1),
  plan: roomPlanSchema,
  leaderId: z.string().min(1),
  reviewerId: z.string().min(1),
  members: z.array(roomConnectedMemberSchema),
  testCommand: roomCommandSchema,
  deployCommand: roomCommandSchema.optional(),
  deployTarget: z.string().max(200),
  allowEdits: z.boolean(),
  maxAttempts: z.number().int().min(1).max(3),
  notifications: z.boolean().optional(),
  phase: z.enum(["prepare", "approval", "act", "check", "check_failed", "deploy_approval", "deploy", "done", "failed", "consult", "uncertain"]),
  allocation: roomAllocationSchema.optional(),
  pending: z.unknown().optional(),
  error: z.string().optional(),
});
export type RoomExecution = z.infer<typeof roomExecutionSchema>;

/** 리더가 고른 담당과 요구사항을 채택본·연결된 멤버에 대조한다. */
export function validateRoomAllocation(value: unknown, execution: Pick<RoomExecution, "members" | "reviewerId" | "plan">): RoomAllocation {
  const allocation = roomAllocationSchema.parse(value);
  const requirements = new Set(execution.plan.requirements.map(r => r.id));
  const ids = new Set<string>();
  for (const task of allocation.assignments) {
    if (ids.has(task.id)) throw new Error("작업 id가 중복됐다.");
    ids.add(task.id);
    const member = execution.members.find(m => m.id === task.memberId && m.enabled !== false);
    if (!member) throw new Error("연결된 작업자를 찾지 못했다.");
    if (member.id === execution.reviewerId) throw new Error("수행 담당과 검토 담당은 다른 LLM이어야 한다.");
    if (!task.requirementIds.every(id => requirements.has(id))) throw new Error("채택본에 없는 요구사항은 상담에서 검토한다.");
    if (task.effort && member.speaker !== "claude-code" && member.speaker !== "codex") {
      throw new Error("이 공급자의 강도 전달은 지원하지 않는다. 모델 기본 설정을 선택한다.");
    }
  }
  if (!execution.plan.requirements.every(r => allocation.assignments.some(t => t.requirementIds.includes(r.id)))) {
    throw new Error("채택본의 요구사항이 배정에서 빠졌다.");
  }
  return allocation;
}
