import type { BoardKind, BoardView } from "./boardContract.js";

export type PlaceOnCanvasResult =
  | { ok: true; placed: boolean; already: boolean; board: BoardView }
  | { ok: false; error: string };

export async function placeOnCanvas(input: {
  alias: string;
  id: string;
  kind: BoardKind;
  ref: string;
  title: string;
}): Promise<PlaceOnCanvasResult> {
  try {
    const res = await fetch("/api/board/place", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json()) as BoardView & { placed?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      placed: body.placed === true,
      already: body.placed === false,
      board: { alias: body.alias, items: body.items ?? [], links: body.links ?? [] },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
