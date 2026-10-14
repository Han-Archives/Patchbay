import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  boardItemSchema,
  boardLinkSchema,
  boardSchema,
  type Board,
  type BoardItem,
  type BoardLink,
} from "../types/board.js";
import { resolveProjectAlias } from "./aliasResolution.js";
import { ensureProjectDir } from "./projectFiles.js";
import { projectStudioDir, readStudio } from "./studioStore.js";

/**
 * `board.yaml` persistence (spec 2.1).
 * P4: `placeOnBoard`. P7: move / link / unlink / remove.
 * Missing file is `{ items: [], links: [] }`. Scans never call this module.
 * Same-id place, unchanged coords, and duplicate links do not rewrite
 * (watching consoles must not get a spurious `board` SSE).
 */

const BOARD_FILE_NAME = "board.yaml";

function defaultBoard(): Board {
  return boardSchema.parse({});
}

function boardFilePath(studioHome: string, alias: string): string {
  return path.join(projectStudioDir(studioHome, alias), BOARD_FILE_NAME);
}

async function requireAlias(studioHome: string, alias: string): Promise<string> {
  const studio = await readStudio(studioHome);
  const resolution = resolveProjectAlias(studio, alias);
  if (!resolution.ok) throw new Error(resolution.message);
  return resolution.alias;
}

export async function readBoard(studioHome: string, alias: string): Promise<Board> {
  let raw: string;
  try {
    raw = await fs.readFile(boardFilePath(studioHome, alias), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultBoard();
    }
    throw error;
  }
  const parsed: unknown = YAML.parse(raw) ?? {};
  return boardSchema.parse(parsed);
}

async function writeBoard(studioHome: string, alias: string, board: Board): Promise<string> {
  const validated = boardSchema.parse(board);
  const dir = await ensureProjectDir(studioHome, alias);
  const filePath = path.join(dir, BOARD_FILE_NAME);
  await fs.writeFile(filePath, YAML.stringify(validated), "utf8");
  return filePath;
}

export interface PlaceOnBoardInput {
  id: string;
  kind: BoardItem["kind"];
  ref: string;
  title: string;
  x?: number;
  y?: number;
}

export type PlaceOnBoardResult =
  | { alias: string; placed: true; item: BoardItem; board: Board; path: string }
  | { alias: string; placed: false; reason: "already_on_board"; item: BoardItem; board: Board };

/**
 * Adds `item` to `projects/<alias>/board.yaml`. Same `id` is a no-op and
 * does not rewrite the file (so a watching console does not get a spurious
 * `board` SSE). Omitted `x`/`y` default to 0.
 */
export async function placeOnBoard(
  studioHome: string,
  alias: string,
  input: PlaceOnBoardInput,
): Promise<PlaceOnBoardResult> {
  const registered = await requireAlias(studioHome, alias);
  const item = boardItemSchema.parse({
    id: input.id,
    kind: input.kind,
    ref: input.ref,
    title: input.title,
    x: input.x ?? 0,
    y: input.y ?? 0,
  });

  const board = await readBoard(studioHome, registered);
  const existing = board.items.find((entry) => entry.id === item.id);
  if (existing) {
    return { alias: registered, placed: false, reason: "already_on_board", item: existing, board };
  }

  const updated: Board = { ...board, items: [...board.items, item] };
  const filePath = await writeBoard(studioHome, registered, updated);
  return { alias: registered, placed: true, item, board: updated, path: filePath };
}

export type MoveOnBoardResult =
  | { alias: string; moved: true; item: BoardItem; board: Board; path: string }
  | { alias: string; moved: false; reason: "not_on_board" | "unchanged"; item: BoardItem | null; board: Board };

/**
 * Updates one item's CSS-pixel coordinates. Missing id is a no-op.
 * Identical x/y does not rewrite the file.
 */
export async function moveOnBoard(
  studioHome: string,
  alias: string,
  id: string,
  x: number,
  y: number,
): Promise<MoveOnBoardResult> {
  const registered = await requireAlias(studioHome, alias);
  const coords = boardItemSchema.pick({ x: true, y: true }).parse({ x, y });
  const board = await readBoard(studioHome, registered);
  const index = board.items.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return { alias: registered, moved: false, reason: "not_on_board", item: null, board };
  }
  const current = board.items[index]!;
  if (current.x === coords.x && current.y === coords.y) {
    return { alias: registered, moved: false, reason: "unchanged", item: current, board };
  }
  const item: BoardItem = { ...current, x: coords.x, y: coords.y };
  const items = board.items.slice();
  items[index] = item;
  const updated: Board = { ...board, items };
  const filePath = await writeBoard(studioHome, registered, updated);
  return { alias: registered, moved: true, item, board: updated, path: filePath };
}

export type LinkOnBoardResult =
  | { alias: string; linked: true; link: BoardLink; board: Board; path: string }
  | {
      alias: string;
      linked: false;
      reason: "already_linked" | "missing_endpoint" | "self";
      board: Board;
    };

/**
 * Adds a directed placement link. This is not a LangGraph edge and not a
 * Neo4j relationship. Both endpoints must already be items. Duplicate
 * (from, to) is a no-op and does not rewrite.
 */
export async function linkOnBoard(
  studioHome: string,
  alias: string,
  from: string,
  to: string,
): Promise<LinkOnBoardResult> {
  const registered = await requireAlias(studioHome, alias);
  const link = boardLinkSchema.parse({ from, to });
  const board = await readBoard(studioHome, registered);
  if (link.from === link.to) {
    return { alias: registered, linked: false, reason: "self", board };
  }
  const ids = new Set(board.items.map((item) => item.id));
  if (!ids.has(link.from) || !ids.has(link.to)) {
    return { alias: registered, linked: false, reason: "missing_endpoint", board };
  }
  if (board.links.some((entry) => entry.from === link.from && entry.to === link.to)) {
    return { alias: registered, linked: false, reason: "already_linked", board };
  }
  const updated: Board = { ...board, links: [...board.links, link] };
  const filePath = await writeBoard(studioHome, registered, updated);
  return { alias: registered, linked: true, link, board: updated, path: filePath };
}

export type UnlinkOnBoardResult =
  | { alias: string; unlinked: true; board: Board; path: string }
  | { alias: string; unlinked: false; reason: "not_linked"; board: Board };

export async function unlinkOnBoard(
  studioHome: string,
  alias: string,
  from: string,
  to: string,
): Promise<UnlinkOnBoardResult> {
  const registered = await requireAlias(studioHome, alias);
  const link = boardLinkSchema.parse({ from, to });
  const board = await readBoard(studioHome, registered);
  if (!board.links.some((entry) => entry.from === link.from && entry.to === link.to)) {
    return { alias: registered, unlinked: false, reason: "not_linked", board };
  }
  const updated: Board = {
    ...board,
    links: board.links.filter((entry) => !(entry.from === link.from && entry.to === link.to)),
  };
  const filePath = await writeBoard(studioHome, registered, updated);
  return { alias: registered, unlinked: true, board: updated, path: filePath };
}

export type RemoveFromBoardResult =
  | { alias: string; removed: true; board: Board; path: string }
  | { alias: string; removed: false; reason: "not_on_board"; board: Board };

/**
 * Drops an item and every link that mentions it. Missing id is a no-op
 * and does not rewrite.
 */
export async function removeFromBoard(
  studioHome: string,
  alias: string,
  id: string,
): Promise<RemoveFromBoardResult> {
  const registered = await requireAlias(studioHome, alias);
  if (!id) {
    const board = await readBoard(studioHome, registered);
    return { alias: registered, removed: false, reason: "not_on_board", board };
  }
  const board = await readBoard(studioHome, registered);
  if (!board.items.some((item) => item.id === id)) {
    return { alias: registered, removed: false, reason: "not_on_board", board };
  }
  const updated: Board = {
    items: board.items.filter((item) => item.id !== id),
    links: board.links.filter((link) => link.from !== id && link.to !== id),
  };
  const filePath = await writeBoard(studioHome, registered, updated);
  return { alias: registered, removed: true, board: updated, path: filePath };
}

export type ReplacePrefixedBoardSliceResult = {
  alias: string;
  board: Board;
  path: string | null;
  changed: boolean;
  added: number;
  updated: number;
  removed: number;
  linked: number;
};

function snapshotBoard(board: Board): string {
  return JSON.stringify({
    items: board.items.map((item) => ({ ...item })),
    links: board.links.map((link) => ({ ...link })),
  });
}

/**
 * Replaces every item/link whose id starts with `prefix`. Other board
 * entries stay. Matching ids keep their coordinates so a dragged map is
 * not reset when the source JSON changes.
 */
export async function replacePrefixedBoardSlice(
  studioHome: string,
  alias: string,
  prefix: string,
  slice: { items: BoardItem[]; links: BoardLink[] },
): Promise<ReplacePrefixedBoardSliceResult> {
  if (!prefix) {
    throw new Error("board: prefix must not be empty.");
  }
  const registered = await requireAlias(studioHome, alias);
  for (const item of slice.items) {
    if (!item.id.startsWith(prefix)) {
      throw new Error(`board: slice item "${item.id}" must start with "${prefix}".`);
    }
  }
  const sliceIds = new Set(slice.items.map((item) => item.id));
  for (const link of slice.links) {
    if (!sliceIds.has(link.from) || !sliceIds.has(link.to)) {
      throw new Error("board: slice links must stay inside the prefixed item set.");
    }
  }

  const current = await readBoard(studioHome, registered);
  const previous = current.items.filter((item) => item.id.startsWith(prefix));
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const previousLinks = current.links.filter(
    (link) => link.from.startsWith(prefix) || link.to.startsWith(prefix),
  );

  const nextSliceItems = slice.items.map((item) => {
    const prior = previousById.get(item.id);
    return prior ? { ...item, x: prior.x, y: prior.y } : item;
  });
  const keptItems = current.items.filter((item) => !item.id.startsWith(prefix));
  const keptLinks = current.links.filter(
    (link) => !link.from.startsWith(prefix) && !link.to.startsWith(prefix),
  );
  const next: Board = {
    items: [...keptItems, ...nextSliceItems],
    links: [...keptLinks, ...slice.links],
  };

  const added = nextSliceItems.filter((item) => !previousById.has(item.id)).length;
  const updated = nextSliceItems.filter((item) => {
    const prior = previousById.get(item.id);
    return Boolean(prior && (prior.title !== item.title || prior.ref !== item.ref || prior.kind !== item.kind));
  }).length;
  const removed = previous.filter((item) => !sliceIds.has(item.id)).length;
  const previousLinkKeys = new Set(previousLinks.map((link) => `${link.from}->${link.to}`));
  const linked = slice.links.filter((link) => !previousLinkKeys.has(`${link.from}->${link.to}`)).length;

  if (snapshotBoard(current) === snapshotBoard(next)) {
    return { alias: registered, board: current, path: null, changed: false, added: 0, updated: 0, removed: 0, linked: 0 };
  }
  const filePath = await writeBoard(studioHome, registered, next);
  return { alias: registered, board: next, path: filePath, changed: true, added, updated, removed, linked };
}
