import { mirrorSession, requireStudioHome } from "@patchbay/core";

/**
 * Claude Code 훅 (`UserPromptSubmit` · `Stop`) 이 부른다 — stdin 에 훅 입력 JSON 이 온다.
 * 세션이 `room_bind` 로 방을 고른 뒤에만 옮겨 적는다. 훅은 세션을 막지 않으므로 무슨 일이
 * 있어도 0 으로 끝나고, 문제는 stderr 에만 남긴다.
 */
export async function runRoomMirror(readInput: () => Promise<string> = readStdin): Promise<number> {
  try {
    const raw = await readInput();
    const hook = JSON.parse(raw || "{}") as { session_id?: unknown; transcript_path?: unknown; hook_event_name?: unknown; prompt?: unknown };
    if (typeof hook.session_id !== "string" || typeof hook.transcript_path !== "string") return 0;
    await mirrorSession(requireStudioHome(), {
      sessionId: hook.session_id,
      transcriptPath: hook.transcript_path,
      event: typeof hook.hook_event_name === "string" ? hook.hook_event_name : "",
      ...(typeof hook.prompt === "string" ? { prompt: hook.prompt } : {}),
    });
  } catch (error) {
    console.error(`patchbay room mirror: ${(error as Error).message}`);
  }
  return 0;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
