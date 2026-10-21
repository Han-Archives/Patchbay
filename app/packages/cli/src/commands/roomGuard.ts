import { guardTool, requireStudioHome } from "@patchbay/core";

/**
 * Claude Code 훅 (`PreToolUse`) — stdin 에 훅 입력 JSON 이 온다.
 * 세션이 `room_bind` 로 프로젝트에 묶였으면, 그 프로젝트 밖에 쓰는 도구 호출을 막는다.
 * 막을 때는 훅 결정 JSON(`permissionDecision: deny`)을 찍는다. 문제가 생기면 막지 않고
 * stderr 에만 남긴다 — 훅이 세션을 멈추게 하지 않는다.
 */
export async function runRoomGuard(readInput: () => Promise<string> = readStdin, write: (text: string) => void = (text) => process.stdout.write(text)): Promise<number> {
  try {
    const hook = JSON.parse((await readInput()) || "{}") as { transcript_path?: unknown; tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
    if (typeof hook.transcript_path !== "string" || typeof hook.tool_name !== "string") return 0;
    const decision = await guardTool(requireStudioHome(), {
      transcriptPath: hook.transcript_path,
      toolName: hook.tool_name,
      toolInput: hook.tool_input && typeof hook.tool_input === "object" ? (hook.tool_input as Record<string, unknown>) : {},
      cwd: typeof hook.cwd === "string" ? hook.cwd : process.cwd(),
    });
    if (decision?.deny) {
      write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.deny } }));
    } else if (decision?.ask) {
      write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: decision.ask } }));
    }
  } catch (error) {
    console.error(`patchbay room guard: ${(error as Error).message}`);
  }
  return 0;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
