import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Row = { id: string; running?: boolean };
type Drag = { id: string; offset: number; targetId: string | null; after: boolean };
type Press = { id: string; pointerId: number; x: number; y: number; startX: number; startY: number; scrollTop: number; armed: boolean; element: HTMLElement };

/** 짧은 터치는 열기/스크롤, 420ms 길게 누르기는 순서 변경. */
export function useTodoReorder(options: { project: string; rows: Row[]; enabled: boolean; onMove: (id: string, beforeId: string | null) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const current = useRef(options);
  current.current = options;
  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const order = options.rows.map(row => `${row.id}:${!!row.running}`).join("|");

  function cancel() {
    const held = press.current;
    press.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    timer.current = null; frame.current = null;
    if (held?.armed) {
      suppressClickUntil.current = Date.now() + 500;
      if (held.element.hasPointerCapture(held.pointerId)) held.element.releasePointerCapture(held.pointerId);
    }
    setDrag(null);
  }

  function target(held: Press) {
    const container = list.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    if (held.x < bounds.left || held.x > bounds.right || held.y < bounds.top - 24 || held.y > bounds.bottom + 24) return null;
    const movable = current.current.rows.filter(row => row.id !== held.id && !row.running);
    const elements = [...container.querySelectorAll<HTMLElement>("[data-todo-id]")];
    for (const row of movable) {
      const rect = elements.find(el => el.dataset.todoId === row.id)?.getBoundingClientRect();
      if (rect && held.y < rect.top + rect.height / 2) return { id: row.id, after: false, beforeId: row.id };
    }
    const last = movable.at(-1);
    return last ? { id: last.id, after: true, beforeId: null } : null;
  }

  function update() {
    const held = press.current;
    const container = list.current;
    if (!held?.armed || !container) return;
    const bounds = container.getBoundingClientRect();
    if (held.x >= bounds.left && held.x <= bounds.right) {
      if (held.y < bounds.top + 28) container.scrollTop -= 6;
      else if (held.y > bounds.bottom - 28) container.scrollTop += 6;
    }
    const destination = target(held);
    const siblings = [...container.querySelectorAll<HTMLElement>("[data-todo-id]")];
    const origin = held.element.offsetTop;
    const offset = Math.max((siblings[0]?.offsetTop ?? origin) - origin, Math.min((siblings.at(-1)?.offsetTop ?? origin) - origin, held.y - held.startY + container.scrollTop - held.scrollTop));
    setDrag({ id: held.id, offset, targetId: destination?.id ?? null, after: destination?.after ?? false });
    frame.current = requestAnimationFrame(update);
  }

  useEffect(() => {
    function move(event: PointerEvent) {
      const held = press.current;
      if (!held || held.pointerId !== event.pointerId) return;
      held.x = event.clientX; held.y = event.clientY;
      if (!held.armed && Math.hypot(held.x - held.startX, held.y - held.startY) > 8) cancel();
      else if (held.armed && event.cancelable) event.preventDefault();
    }
    function end(event: PointerEvent) {
      const held = press.current;
      if (!held || held.pointerId !== event.pointerId) return;
      held.x = event.clientX; held.y = event.clientY;
      const destination = held.armed ? target(held) : null;
      const rows = current.current.rows.filter(row => !row.running);
      const next = rows[rows.findIndex(row => row.id === held.id) + 1]?.id ?? null;
      cancel();
      if (destination && destination.beforeId !== next && current.current.enabled) current.current.onMove(held.id, destination.beforeId);
    }
    function touchMove(event: TouchEvent) { if (press.current?.armed && event.cancelable) event.preventDefault(); }
    function contextMenu(event: Event) { if (press.current) event.preventDefault(); }
    function key(event: KeyboardEvent) { if (event.key === "Escape") cancel(); }
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("contextmenu", contextMenu);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => { cancel(); }, [options.project, options.enabled, order]);

  function start(event: ReactPointerEvent<HTMLElement>, row: Row) {
    if (!current.current.enabled || row.running || event.button !== 0 || !event.isPrimary || (event.target as Element).closest(".todo-menu-wrap, .todo-detail")) return;
    cancel();
    press.current = { id: row.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, scrollTop: list.current?.scrollTop ?? 0, armed: false, element: event.currentTarget };
    timer.current = setTimeout(() => {
      const held = press.current;
      if (!held) return;
      held.armed = true;
      held.element.setPointerCapture(held.pointerId);
      window.getSelection()?.removeAllRanges();
      update();
    }, 420);
  }
  return { list, drag, start, suppressClick: () => Date.now() < suppressClickUntil.current };
}
