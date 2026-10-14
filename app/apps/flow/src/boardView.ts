import {
  linkOnBoard,
  moveOnBoard,
  placeOnBoard,
  readBoard,
  readStudio,
  removeFromBoard,
  unlinkOnBoard,
  type Board,
} from "@patchbay/core";
import {
  isBoardKind,
  nextBoardSlot,
  roundBoardCoord,
  type BoardKind,
  type BoardView,
} from "./boardContract.js";

export type LoadBoardResult =
  | { ok: true; body: BoardView }
  | { ok: false; status: 400 | 404; error: string };

export type BoardMutationResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: 400 | 404; error: string };

function toView(alias: string, board: Board): BoardView {
  return { alias, items: board.items, links: board.links };
}

export async function loadBoardView(studioHome: string, alias: string | undefined): Promise<LoadBoardResult> {
  if (!alias) {
    return { ok: false, status: 400, error: "board: alias query parameter is required." };
  }
  const studio = await readStudio(studioHome);
  const registered = studio.projects.find((project) => project.alias === alias);
  if (!registered) {
    const known = studio.projects.map((project) => project.alias);
    return {
      ok: false,
      status: 404,
      error:
        `No project registered with alias "${alias}". ` +
        (known.length > 0
          ? `Registered aliases: ${known.join(", ")}.`
          : `No projects are registered yet -- run "patchbay project add --path <path>" first.`),
    };
  }
  const board = await readBoard(studioHome, alias);
  return { ok: true, body: toView(alias, board) };
}

export async function placeBoardItem(
  studioHome: string,
  input: {
    alias?: unknown;
    id?: unknown;
    kind?: unknown;
    ref?: unknown;
    title?: unknown;
    x?: unknown;
    y?: unknown;
  },
): Promise<BoardMutationResult> {
  const alias = requiredString(input.alias, "alias");
  if (!alias.ok) return alias;
  const id = requiredString(input.id, "id");
  if (!id.ok) return id;
  const kind = requiredKind(input.kind);
  if (!kind.ok) return kind;
  const ref = requiredString(input.ref, "ref");
  if (!ref.ok) return ref;
  const title = requiredString(input.title, "title");
  if (!title.ok) return title;

  try {
    const loaded = await loadBoardView(studioHome, alias.value);
    if (!loaded.ok) return loaded;
    const x = optionalCoord(input.x);
    const y = optionalCoord(input.y);
    if (!x.ok) return x;
    if (!y.ok) return y;
    const slot = nextBoardSlot(loaded.body.items.length);
    const result = await placeOnBoard(studioHome, alias.value, {
      id: id.value,
      kind: kind.value,
      ref: ref.value,
      title: title.value,
      x: x.value ?? slot.x,
      y: y.value ?? slot.y,
    });
    return {
      ok: true,
      status: 200,
      body: {
        ...toView(result.alias, result.board),
        placed: result.placed,
        reason: result.placed ? null : result.reason,
        item: result.item,
      },
    };
  } catch (error) {
    return mutationError(error);
  }
}

export async function moveBoardItem(
  studioHome: string,
  input: { alias?: unknown; id?: unknown; x?: unknown; y?: unknown },
): Promise<BoardMutationResult> {
  const alias = requiredString(input.alias, "alias");
  if (!alias.ok) return alias;
  const id = requiredString(input.id, "id");
  if (!id.ok) return id;
  const x = requiredCoord(input.x, "x");
  if (!x.ok) return x;
  const y = requiredCoord(input.y, "y");
  if (!y.ok) return y;
  try {
    const loaded = await loadBoardView(studioHome, alias.value);
    if (!loaded.ok) return loaded;
    const result = await moveOnBoard(studioHome, alias.value, id.value, x.value, y.value);
    if (!result.moved && result.reason === "not_on_board") {
      return { ok: false, status: 404, error: `board: item "${id.value}" is not on the board.` };
    }
    return {
      ok: true,
      status: 200,
      body: {
        ...toView(result.alias, result.board),
        moved: result.moved,
        reason: result.moved ? null : result.reason,
        item: result.item,
      },
    };
  } catch (error) {
    return mutationError(error);
  }
}

export async function linkBoardItems(
  studioHome: string,
  input: { alias?: unknown; from?: unknown; to?: unknown },
): Promise<BoardMutationResult> {
  const ends = linkEnds(input);
  if (!ends.ok) return ends;
  try {
    const loaded = await loadBoardView(studioHome, ends.alias);
    if (!loaded.ok) return loaded;
    const result = await linkOnBoard(studioHome, ends.alias, ends.from, ends.to);
    if (!result.linked && (result.reason === "missing_endpoint" || result.reason === "self")) {
      return {
        ok: false,
        status: 400,
        error:
          result.reason === "self"
            ? "board: a link cannot start and end on the same item."
            : "board: both link ends must already be on the board.",
      };
    }
    return {
      ok: true,
      status: 200,
      body: {
        ...toView(result.alias, result.board),
        linked: result.linked,
        reason: result.linked ? null : result.reason,
      },
    };
  } catch (error) {
    return mutationError(error);
  }
}

export async function unlinkBoardItems(
  studioHome: string,
  input: { alias?: unknown; from?: unknown; to?: unknown },
): Promise<BoardMutationResult> {
  const ends = linkEnds(input);
  if (!ends.ok) return ends;
  try {
    const loaded = await loadBoardView(studioHome, ends.alias);
    if (!loaded.ok) return loaded;
    const result = await unlinkOnBoard(studioHome, ends.alias, ends.from, ends.to);
    return {
      ok: true,
      status: 200,
      body: {
        ...toView(result.alias, result.board),
        unlinked: result.unlinked,
        reason: result.unlinked ? null : result.reason,
      },
    };
  } catch (error) {
    return mutationError(error);
  }
}

export async function removeBoardItem(
  studioHome: string,
  input: { alias?: unknown; id?: unknown },
): Promise<BoardMutationResult> {
  const alias = requiredString(input.alias, "alias");
  if (!alias.ok) return alias;
  const id = requiredString(input.id, "id");
  if (!id.ok) return id;
  try {
    const loaded = await loadBoardView(studioHome, alias.value);
    if (!loaded.ok) return loaded;
    const result = await removeFromBoard(studioHome, alias.value, id.value);
    return {
      ok: true,
      status: 200,
      body: {
        ...toView(result.alias, result.board),
        removed: result.removed,
        reason: result.removed ? null : result.reason,
      },
    };
  } catch (error) {
    return mutationError(error);
  }
}

function linkEnds(input: { alias?: unknown; from?: unknown; to?: unknown }):
  | { ok: true; alias: string; from: string; to: string }
  | { ok: false; status: 400; error: string } {
  const alias = requiredString(input.alias, "alias");
  if (!alias.ok) return alias;
  const from = requiredString(input.from, "from");
  if (!from.ok) return from;
  const to = requiredString(input.to, "to");
  if (!to.ok) return to;
  return { ok: true, alias: alias.value, from: from.value, to: to.value };
}

function requiredString(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; status: 400; error: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, status: 400, error: `board: ${field} is required.` };
  }
  return { ok: true, value: value.trim() };
}

function requiredKind(
  value: unknown,
): { ok: true; value: BoardKind } | { ok: false; status: 400; error: string } {
  if (!isBoardKind(value)) {
    return { ok: false, status: 400, error: "board: kind must be langgraph, neo4j, or port." };
  }
  return { ok: true, value };
}

function requiredCoord(
  value: unknown,
  field: string,
): { ok: true; value: number } | { ok: false; status: 400; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, status: 400, error: `board: ${field} must be a finite number.` };
  }
  return { ok: true, value: roundBoardCoord(value) };
}

function optionalCoord(
  value: unknown,
): { ok: true; value: number | undefined } | { ok: false; status: 400; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  return requiredCoord(value, "coordinate");
}

function mutationError(error: unknown): BoardMutationResult {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "ZodError") {
    return { ok: false, status: 400, error: "board: invalid item or coordinates." };
  }
  if (message.includes("No project registered") || message.includes("No projects are registered")) {
    return { ok: false, status: 404, error: message };
  }
  return { ok: false, status: 400, error: message };
}
