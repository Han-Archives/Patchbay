import { guardTool, isRoomBindTool, recordGuardIssue, recordSessionBinding, requireStudioHome, resolveStudioHome } from "@patchbay/core";

type HookInput = { session_id?: unknown; transcript_path?: unknown; hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown; tool_response?: unknown; cwd?: unknown };

/**
 * Claude Code 훅 (`PreToolUse` · `PostToolUse`) — stdin 에 훅 입력 JSON 이 온다.
 * 세션이 `room_bind` 로 프로젝트에 묶였으면, 그 프로젝트 밖에 쓰는 도구 호출을 막는다.
 * `PostToolUse` 로 `room_bind` 결과가 오면 그 묶음을 세션 상태에 적는다 — 세션 기록 파일이
 * 없는 세션도 막을 수 있게 (2026-11-03 R9.2 수리).
 * 막을 때는 훅 결정 JSON(`permissionDecision: deny`)을 찍는다. 묶음을 확인하기 전에 문제가 생기면
 * 막지 않고 stderr 와 세션 상태 `guardIssues` 에 남긴다 — 훅이 묶이지 않은 세션까지 멈추게 하지 않는다
 * (사용자 결정 2026-11-03). 작업 공간을 못 찾으면 stderr 에만 남는다.
 */
export async function runRoomGuard(readInput: () => Promise<string> = readStdin, write: (text: string) => void = (text) => process.stdout.write(text)): Promise<number> {
  let hook: HookInput = {};
  try {
    hook = JSON.parse((await readInput()) || "{}") as HookInput;
    if (hook.hook_event_name === "PostToolUse") {
      if (typeof hook.session_id === "string" && isRoomBindTool(hook.tool_name)) {
        const home = requireStudioHome();
        if (!(await recordSessionBinding(home, hook.session_id, hook.tool_response))) {
          // 실패한 묶기면 정상이다. 결과 모양이 바뀌어 못 읽은 것이면 여기서 보인다.
          await recordGuardIssue(home, hook.session_id, { event: "PostToolUse", tool: String(hook.tool_name), message: `room_bind 결과에서 묶음을 읽지 못해 적지 않았다: ${JSON.stringify(hook.tool_response ?? null).slice(0, 300)}` });
        }
      }
      return 0;
    }
    if (typeof hook.transcript_path !== "string" || typeof hook.tool_name !== "string") return 0;
    // studio.yaml 검사 전에 묶음부터 본다 — 깨진 studio.yaml 로 묶인 세션이 풀리지 않게 (guardTool 이 막는다).
    const decision = await guardTool(resolveStudioHome(), {
      sessionId: typeof hook.session_id === "string" ? hook.session_id : undefined,
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
    if (typeof hook.session_id === "string") {
      try {
        await recordGuardIssue(requireStudioHome(), hook.session_id, {
          event: typeof hook.hook_event_name === "string" ? hook.hook_event_name : "",
          tool: typeof hook.tool_name === "string" ? hook.tool_name : null,
          message: `오류로 허용했다: ${(error as Error).message}`,
        });
      } catch (inner) {
        console.error(`patchbay room guard: 세션 상태에도 남기지 못했다: ${(inner as Error).message}`);
      }
    }
  }
  return 0;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
