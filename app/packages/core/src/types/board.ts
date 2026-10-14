import { z } from "zod";

/**
 * `board.yaml` shape (spec 2.1). Human + agent owned: console drag and
 * `place_on_board`. Scans never read or overwrite this file.
 */

export const BOARD_KINDS = ["langgraph", "neo4j", "port"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export const boardItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(BOARD_KINDS),
  ref: z.string().min(1),
  title: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
});
export type BoardItem = z.infer<typeof boardItemSchema>;

export const boardLinkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type BoardLink = z.infer<typeof boardLinkSchema>;

export const boardSchema = z.object({
  items: z.array(boardItemSchema).default([]),
  links: z.array(boardLinkSchema).default([]),
});
export type Board = z.infer<typeof boardSchema>;
