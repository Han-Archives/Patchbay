import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import "./chatLayout.css";

const STORAGE_KEY = "patchbay.chat.width";
const MIN_WORK = 800;
const MIN_CHAT = 310;
const MAX_CHAT = 640;

export function useChatLayout(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [desired, setDesired] = useState<number | null>(() => {
    try {
      const value = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(value) && value >= MIN_CHAT && value <= MAX_CHAT ? value : null;
    } catch { return null; }
  });
  const [available, setAvailable] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const frame = useRef(0);
  const pending = useRef<number | null>(null);
  const base = available + 64 <= 1250 ? 310 : 340;
  // Existing narrow layouts keep their baseline; widening never takes more work space.
  const max = Math.max(base, Math.min(MAX_CHAT, available - MIN_WORK));
  const width = Math.max(MIN_CHAT, Math.min(desired ?? base, max));

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setAvailable(root.clientWidth));
    observer.observe(root);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => { if (!active) setExpanded(false); }, [active]);

  useEffect(() => {
    if (!expanded || !active) return;
    const root = ref.current!;
    const pane = root.querySelector<HTMLElement>("main.pane")!;
    const chat = root.querySelector<HTMLElement>(".workspace-chat-panel")!;
    const previous = document.activeElement as HTMLElement | null;
    pane.inert = true;
    const button = chat.querySelector<HTMLButtonElement>(".chat-expand");
    button?.focus({ preventScroll: true });
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
      if (event.key === "Tab") {
        const elements = [...chat.querySelectorAll<HTMLElement>("button,input,textarea,select,a[href],[tabindex]")]
          .filter(el => !el.matches(":disabled") && el.tabIndex >= 0 && el.getClientRects().length);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || !chat.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !chat.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      pane.inert = false;
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [expanded, active]);

  function save(value: number | null) {
    try {
      if (value === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(value));
    } catch { /* Resizing also works when browser storage is unavailable. */ }
  }
  function finish() {
    if (!drag.current) return;
    cancelAnimationFrame(frame.current);
    const value = pending.current ?? width;
    setDesired(value); save(value);
    pending.current = null; drag.current = null;
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || expanded) return;
    event.preventDefault(); event.currentTarget.focus();
    drag.current = { id: event.pointerId, x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    pending.current = Math.max(MIN_CHAT, Math.min(max, start.width + start.x - event.clientX));
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { if (pending.current !== null) setDesired(pending.current); });
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    if (event.key === "Home") next = MIN_CHAT;
    else if (event.key === "End") next = max;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = width + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 40 : 16);
    else return;
    event.preventDefault();
    next = Math.max(MIN_CHAT, Math.min(max, next));
    setDesired(next); save(next);
  }
  return {
    ref, width, expanded: expanded && active, setExpanded,
    separator: {
      onPointerDown: pointerDown, onPointerMove: pointerMove,
      onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
      onKeyDown: keyDown, onDoubleClick: () => { setDesired(null); save(null); },
      "aria-valuemin": MIN_CHAT, "aria-valuemax": max, "aria-valuenow": width,
    },
  };
}
