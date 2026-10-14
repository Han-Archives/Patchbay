import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listRooms, readRoom, readRoomMeta, roomStatus, readStudio } from "@patchbay/core";
import { jsonResult } from "./result.js";

/** 원문 조회만 한다. 상담을 섞거나 그래프를 재개하지 않는다. */
export function registerRoomTools(server: McpServer, studioHome: string) {
  server.registerTool("get_room", {
    title: "Get operations conversation",
    description: "Reads a Patchbay room and its adopted design, assignments and execution evidence. Consultation is separate; use consult_history for consultation sources. Does not call a model or resume LangGraph.",
    inputSchema: { alias: z.string(), roomId: z.string().optional(), afterSeq: z.number().int().min(-1).optional(), limit: z.number().int().min(1).max(200).default(100) },
    annotations: { readOnlyHint: true },
  }, async ({ alias, roomId, afterSeq, limit }) => {
    if (!(await readStudio(studioHome)).projects.some(p => p.alias === alias)) return { ...jsonResult({ error: "등록된 프로젝트가 아니다." }), isError: true };
    if (!roomId) return jsonResult({ rooms: await listRooms(studioHome, alias) });
    try {
      const read = await readRoom(studioHome, alias, roomId);
      if (!read) return { ...jsonResult({ error: "대화방이 없다." }), isError: true };
      const meta = await readRoomMeta(studioHome, alias, roomId);
      const matching = read.messages.filter(m => m.seq > (afterSeq ?? -1));
      const messages = matching.slice(0, limit);
      return jsonResult({ id: roomId, title: meta.title, status: roomStatus(read.messages),
        members: meta.members, execution: meta.execution ?? null, messages,
        nextSeq: messages.at(-1)?.seq ?? afterSeq ?? -1, hasMore: matching.length > messages.length, broken: read.broken,
        consultation: "상담 원문은 consult_history로 별도 조회한다." });
    } catch (error) { return { ...jsonResult({ error: (error as Error).message }), isError: true }; }
  });
}
