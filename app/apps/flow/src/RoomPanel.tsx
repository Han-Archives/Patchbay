import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import {
  ROOM_SPEAKER_LABEL,
  roomMemory,
  type RoomMember,
  type RoomMessage,
  type RoomSpeaker,
  type RoomStatus,
  type RoomSummary,
  type RoomExecution,
} from "@patchbay/core";
import { RoomExecutionPanel } from "./RoomExecutionPanel.js";

const CHIP: Record<RoomSpeaker, { mark: string; color: string }> = {
  "claude-code": { mark: "Cla", color: "#3d6fe0" },
  codex: { mark: "Co", color: "#e08a2f" },
  grok: { mark: "Gr", color: "#5b6fd6" },
  local: { mark: "Lo", color: "#3d6fe0" },
};

function clipAttach(text: string): string {
  const line = text.trim();
  return line.length > 4000 ? `${line.slice(0, 4000)}\n…` : line;
}

function RoomsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2 3.5h8.5a1.5 1.5 0 0 1 1.5 1.5v4.2a1.5 1.5 0 0 1-1.5 1.5H6.2L3.2 13V10.7H2A1.5 1.5 0 0 1 .5 9.2V5A1.5 1.5 0 0 1 2 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 2h8a1.4 1.4 0 0 1 1.4 1.4v3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function LlmIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.2 1.8v2.2M9.8 1.8v2.2M6.2 12v2.2M9.8 12v2.2M1.8 6.2h2.2M1.8 9.8h2.2M12 6.2h2.2M12 9.8h2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 2.2v4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 3.6a5 5 0 1 0 6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DetailIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

const CHIP_DEFAULT_COLOR = "#2f3f8f";

/** 이름이 있으면 이름 첫 글자, 없으면 공급자 약자. */
function chipMark(member: RoomMember): string {
  const name = member.name?.trim();
  if (name) return Array.from(name)[0]!;
  if (member.speaker === "local" && member.model.trim()) return member.model.trim().slice(0, 2);
  return CHIP[member.speaker].mark;
}

/** HTML 아이콘 → 이미지 → 글자 순서. HTML은 sandbox(스크립트 막음) 칸에서 모양만 그린다. */
function chipFace(member: RoomMember): ReactNode {
  if (member.iconHtml?.trim()) return <iframe className="room-chip-img room-chip-html" sandbox="" srcDoc={iconDoc(member.iconHtml)} title="" tabIndex={-1} aria-hidden="true" />;
  return member.image ? <img className="room-chip-img" src={member.image} alt="" /> : chipMark(member);
}

function iconDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;display:grid;place-items:center;background:transparent}body>*{max-width:100%;max-height:100%}</style></head><body>${html}</body></html>`;
}

/** 이미지 파일을 아이콘 크기(96px)로 줄여 data URL로 만든다. agents.json이 커지지 않게. */
function shrinkIcon(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 96;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("이미지를 줄이지 못했다.")); return; }
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽지 못했다.")); };
    img.src = url;
  });
}

/** 이름이나 색이 있는 Agent만 색을 칠한다. 비우면 남색. */
function chipStyle(member: RoomMember): CSSProperties | undefined {
  // 이미지 · HTML 아이콘은 크기를 고정한다. iframe 기본 폭(300px)이 칸을 늘리지 않게.
  if (member.image || member.iconHtml?.trim()) return { padding: 0, overflow: "hidden", width: 36, minWidth: 36, flex: "none" };
  if (!member.name?.trim() && !member.color) return undefined;
  const color = member.color ?? CHIP_DEFAULT_COLOR;
  return { background: color, borderColor: color, color: "#fff" };
}

/**
 * 오른쪽 대화방. 사람을 부르고 역할을 적은 뒤, 「대화 시작」이나 「토의 시작」이면 그 사람들이 한 바퀴 말한다.
 * 어느 방이든 열면 바로 이어 쓴다. 그 방의 기록 전체가 다음 호출에 다시 들어간다.
 */

/** 방 목록 한 줄. running이면 그 방에서 지금 LLM이 답하는 중이다. */
type RoomRow = RoomSummary & { running?: boolean };

/**
 * 프로젝트마다 마지막으로 연 대화방. 사람이 다른 방을 고르거나 새 대화를 열기 전까지 들어올 때마다 그 방을 연다.
 * 빈 문자열은 사람이 연 「새 대화」, null은 아직 고른 적 없음.
 */
const lastRoomKey = (project: string) => `patchbay.room.${project}`;

function lastRoom(project: string): string | null {
  try {
    return window.localStorage.getItem(lastRoomKey(project));
  } catch {
    return null;
  }
}

function rememberRoom(project: string, id: string) {
  try {
    window.localStorage.setItem(lastRoomKey(project), id);
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만 이어진다.
  }
}

interface HostRow {
  speaker: RoomSpeaker;
  label: string;
  available: boolean;
  loggedIn?: boolean | null;
  hint?: string;
}

interface RoomBody {
  id: string;
  status: RoomStatus;
  running: boolean;
  messages: RoomMessage[];
  title: string | null;
  displayTitle: string;
  kept: boolean;
  members: RoomMember[];
  execution?: RoomExecution | null;
  error?: string;
}

export function RoomPanel({
  project,
  revision,
  openRoom = "",
  onOpenRoom,
  onClose,
  onConsult,
  draftRequest,
  readOnly = false,
}: {
  project: string;
  revision: number;
  openRoom?: string;
  onOpenRoom?: (roomId: string) => void;
  onClose?: () => void;
  onConsult?: (note?: string) => void;
  draftRequest?: { text: string; nonce: number };
  readOnly?: boolean;
}) {
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [agents, setAgents] = useState<RoomMember[]>([]);
  const [roomId, setRoomId] = useState("");
  const [room, setRoom] = useState<RoomBody | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  // + 메뉴는 바깥을 누르면 닫는다. 열어 둔 채면 보내기 버튼을 가린다.
  useEffect(() => {
    if (!dockOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".room-dock-add")) setDockOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [dockOpen]);
  const [roomQuery, setRoomQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [localId, setLocalId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [titleFocus, setTitleFocus] = useState(false);
  const [copied, setCopied] = useState(false);
  const [face, setFace] = useState<"chat" | "llm">("chat");
  const [plusOpen, setPlusOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [projectFiles, setProjectFiles] = useState<string[] | null>(null);
  const [fileQuery, setFileQuery] = useState("");
  const docRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRoom(null);
    setQuickOpen(false);
    setMenuFor(null);
    setDraft("");
    if (openRoom) {
      setRoomId(openRoom);
      rememberRoom(project, openRoom);
      return;
    }
    // 링크로 열지 않았으면 마지막으로 연 방을 잇는다. 처음이거나 그 방이 지워졌으면 가장 최근 방.
    const kept = lastRoom(project);
    setRoomId(kept ?? "");
    let cancelled = false;
    fetch(`/api/rooms?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ rooms?: RoomRow[] }>)
      .then((body) => {
        if (cancelled || !Array.isArray(body.rooms)) return;
        if (kept === "" || (kept && body.rooms.some((row) => row.id === kept))) return;
        const latest = body.rooms[0]?.id ?? "";
        setRoomId(latest);
        if (latest) rememberRoom(project, latest);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, openRoom]);

  useEffect(() => {
    if (draftRequest) setDraft(draftRequest.text);
  }, [draftRequest]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/rooms/hosts")
      .then((res) => res.json() as Promise<{ hosts: HostRow[] }>)
      .then((body) => {
        if (!cancelled && Array.isArray(body.hosts)) setHosts(body.hosts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ agents?: RoomMember[] }>)
      .then((body) => {
        if (!cancelled) setAgents(body.agents ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ rooms: RoomRow[] }>)
      .then((body) => {
        if (!cancelled && Array.isArray(body.rooms)) setRooms(body.rooms);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/room?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(roomId)}`)
      .then(async (res) => {
        const body = (await res.json()) as RoomBody;
        if (cancelled) return;
        if (body.error) setError(body.error);
        else setRoom(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, roomId, revision, tick]);

  useEffect(() => {
    if (!titleFocus) setTitleDraft(room?.displayTitle ?? "");
  }, [room?.displayTitle, roomId, titleFocus]);

  const waiting = room?.running === true || !room?.execution && room?.status === "waiting";
  // 같은 프로젝트의 다른 방에서 LLM이 답하는 중이면 위에 띄우고, 끝날 때까지 목록을 다시 읽는다.
  const busyElsewhere = rooms.filter((row) => row.running && row.id !== roomId);
  const othersBusy = busyElsewhere.length > 0;
  useEffect(() => {
    if (!waiting && !othersBusy) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1500);
    return () => clearInterval(timer);
  }, [waiting, othersBusy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [room?.messages.length]);

  const members = room?.members ?? [];
  // 방을 잠그지 않는다. 예전에 잠긴 방은 열 때 푼다.
  const kept = readOnly;
  const blank = !room?.messages.some((m) => m.role === "user" || m.role === "speaker");

  function show(id: string) {
    setRoomId(id);
    rememberRoom(project, id);
    onOpenRoom?.(id);
  }

  async function cast(next: RoomMember[]) {
    setError(null);
    const res = await fetch("/api/room/cast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, ...(roomId ? { roomId } : {}), members: next }),
    });
    const body = (await res.json()) as { roomId?: string; error?: string };
    if (!res.ok || body.error || !body.roomId) setError(body.error ?? "사람을 부르지 못했다.");
    else show(body.roomId);
    setTick((n) => n + 1);
  }

  async function refreshAgents() {
    try {
      const res = await fetch(`/api/agents?alias=${encodeURIComponent(project)}`);
      const body = (await res.json()) as { agents?: RoomMember[] };
      if (res.ok && body.agents) setAgents(body.agents);
    } catch {
      // 목록을 못 읽으면 들고 있는 목록을 그대로 보여 준다.
    }
  }

  /**
   * Agents 목록 고치기. 화면이 들고 있는 목록은 오래됐을 수 있다(다른 창·모바일·세션이 고쳤을 때).
   * 그래서 서버의 지금 목록을 먼저 읽고, 그 위에 이번 변경만 얹어 저장한다.
   */
  async function saveAgents(change: (fresh: RoomMember[]) => RoomMember[]) {
    setError(null);
    const got = await fetch(`/api/agents?alias=${encodeURIComponent(project)}`);
    const current = (await got.json()) as { agents?: RoomMember[]; error?: string };
    if (!got.ok || !current.agents) {
      setError(current.error ?? "Agents 목록을 읽지 못했다.");
      return;
    }
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, agents: change(current.agents) }),
    });
    const body = (await res.json()) as { agents?: RoomMember[]; error?: string };
    if (!res.ok || body.error || !body.agents) setError(body.error ?? "Agents 목록에 저장하지 못했다.");
    else setAgents(body.agents);
  }

  async function send(text: string, round?: "talk" | "discuss") {
    const line = text.trim();
    if ((!line && !round) || busy || waiting || kept) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, ...(roomId ? { roomId } : {}), text: line, ...(round ? { round } : {}) }),
      });
      const body = (await res.json()) as { roomId?: string; error?: string };
      if (!res.ok || body.error) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setDraft("");
        if (body.roomId) show(body.roomId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결을 확인한 뒤 다시 시도한다.");
    } finally {
      setBusy(false);
      setTick((n) => n + 1);
    }
  }

  async function stopTurn() {
    if (!roomId) return;
    setError(null);
    try {
      const res = await fetch("/api/room/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, roomId }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) setError(body.error ?? `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결을 확인한 뒤 다시 시도한다.");
    } finally {
      setTick((n) => n + 1);
    }
  }

  async function pinMemory(sourceId: string) {
    setError(null);
    setMenuFor(null);
    const got = await fetch(`/api/room?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(sourceId)}`);
    const body = (await got.json()) as RoomBody;
    if (!got.ok || body.error || !body.messages) {
      setError(body.error ?? "기록을 읽지 못했다.");
      return;
    }
    const text = roomMemory(body.messages, body.displayTitle);
    const onto = blank && roomId && roomId !== sourceId ? roomId : undefined;
    const res = await fetch("/api/room/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, ...(onto ? { roomId: onto } : {}), text, sourceId }),
    });
    const pinned = (await res.json()) as { roomId?: string; error?: string };
    if (!res.ok || pinned.error || !pinned.roomId) setError(pinned.error ?? "맥락을 붙이지 못했다.");
    else show(pinned.roomId);
    setTick((n) => n + 1);
  }

  async function removeRoom(id: string) {
    setError(null);
    setMenuFor(null);
    const res = await fetch("/api/room/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, roomId: id }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) {
      setError(body.error ?? "대화를 지우지 못했다.");
      return;
    }
    if (roomId === id) {
      setRoomId("");
      setRoom(null);
      rememberRoom(project, "");
      onOpenRoom?.("");
    }
    setTick((n) => n + 1);
  }

  useEffect(() => {
    if (room?.kept && !readOnly) void keep(false);
  }, [room?.kept, roomId, readOnly]);

  async function keep(next: boolean) {
    if (!roomId) return;
    setError(null);
    const res = await fetch("/api/room/keep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, roomId, kept: next }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) setError(body.error ?? "방 상태를 바꾸지 못했다.");
    setTick((n) => n + 1);
  }

  async function saveTitle() {
    if (!roomId || !room) return;
    if (titleDraft.trim() === room.displayTitle) return;
    const title = titleDraft;
    const res = await fetch("/api/room/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, roomId, title }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) setError(body.error ?? "제목을 바꾸지 못했다.");
    setTick((n) => n + 1);
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#room/${encodeURIComponent(project)}/${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("링크를 복사하지 못했다.");
    }
  }

  async function onPickedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPlusOpen(false);
    const text = await file.text();
    const body = text.trim();
    await send(body ? `첨부 · 문서 「${file.name}」\n${clipAttach(body)}` : `첨부 · 문서 「${file.name}」\n글이 비어 있다.`);
  }

  async function attachProjectFile(file: string) {
    setPlusOpen(false);
    setProjectFiles(null);
    const res = await fetch(`/api/source?alias=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`);
    const body = (await res.json()) as { content?: string; error?: string };
    if (!res.ok || typeof body.content !== "string") {
      setError("이 파일은 글로 읽지 못한다.");
      return;
    }
    await send(`첨부 · 프로젝트 「${file}」\n${clipAttach(body.content)}`);
  }

  function personLabel(member: RoomMember): string {
    if (member.speaker === "local") return member.model.trim() || ROOM_SPEAKER_LABEL.local;
    return member.model.trim() ? `${ROOM_SPEAKER_LABEL[member.speaker]} · ${member.model.trim()}` : ROOM_SPEAKER_LABEL[member.speaker];
  }

  const enabled = members.filter((member) => member.enabled !== false);

  function patchMember(index: number, patch: Partial<RoomMember>, save = false) {
    const next = members.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setRoom((cur) => (cur ? { ...cur, members: next } : cur));
    if (save) {
      void cast(next);
      // Agents 목록에서 부른 Agent(같은 id)면 목록에도 저장해 다른 방에서도 같게 보인다.
      const edited = next[index];
      if (edited && agents.some((agent) => agent.id === edited.id)) {
        const { enabled: _enabled, ...saved } = edited;
        void saveAgents((fresh) => fresh.map((agent) => (agent.id === edited.id ? saved : agent)));
      }
    }
  }

  return (
    <div className="thread room">
      <div className="room-split">
        <div className="room-main">
          <div className="room-switch">
            {room?.running === true ? <span className="room-running" role="img" aria-label="이 방에서 LLM 실행 중" title="이 방에서 LLM 실행 중" /> : null}
            {roomId ? (
              <input
                aria-label="방 제목"
                disabled={readOnly}
                value={titleDraft}
                onFocus={() => setTitleFocus(true)}
                onBlur={() => {
                  setTitleFocus(false);
                  void saveTitle();
                }}
                onChange={(e) => setTitleDraft(e.target.value)}
              />
            ) : (
              <b>프로젝트 대화</b>
            )}
            <div className="room-switch-icons">
              <button
                type="button"
                className={`room-icon${quickOpen ? " is-on" : ""}`}
                aria-label="대화방"
                aria-pressed={quickOpen}
                onClick={() => {
                  setFace("chat");
                  setQuickOpen((open) => !open);
                  setMenuFor(null);
                  setTick((n) => n + 1);
                }}
              >
                <RoomsIcon />
              </button>
              <button
                type="button"
                className={`room-icon${face === "llm" ? " is-on" : ""}`}
                aria-label="LLM"
                aria-pressed={face === "llm"}
                onClick={() => setFace((cur) => (cur === "llm" ? "chat" : "llm"))}
              >
                <LlmIcon />
              </button>
              {onClose ? (
                <button type="button" className="room-icon" aria-label="대화 최소화" onClick={onClose}>
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              ) : null}
            </div>
          </div>

          {othersBusy ? (
            <div className="room-busy" role="status">
              <span className="host-dot" aria-hidden="true" />
              <span>다른 대화방에서 LLM이 일하는 중</span>
              {busyElsewhere.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  title="이 방으로 가기"
                  onClick={() => {
                    setQuickOpen(false);
                    setFace("chat");
                    show(row.id);
                  }}
                >
                  {row.title}
                </button>
              ))}
            </div>
          ) : null}

          {quickOpen ? (
            <div className="room-quick" aria-label="대화방 목록">
              <input aria-label="대화방 검색" placeholder="대화방 검색" value={roomQuery} onChange={(e) => setRoomQuery(e.target.value)} />
              <ul>
                {rooms.filter((row) => row.title.toLowerCase().includes(roomQuery.trim().toLowerCase())).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={row.id === roomId ? "is-on" : ""}
                      onClick={() => {
                        setQuickOpen(false);
                        setFace("chat");
                        show(row.id);
                      }}
                    >
                      <b>{row.running ? <span className="room-running" role="img" aria-label="LLM 실행 중" /> : null}{row.title}</b>
                      <small>{row.running ? "LLM 일하는 중 · " : ""}{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : ""}</small>
                    </button>
                    <button
                      type="button"
                      className="room-more"
                      aria-label={`${row.title} 메뉴`}
                      aria-expanded={menuFor === row.id}
                      onClick={() => setMenuFor((cur) => (cur === row.id ? null : row.id))}
                    >
                      …
                    </button>
                    {menuFor === row.id ? (
                      <div className="room-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => void copyLink(row.id)}>
                          {copied ? "복사됨" : "링크 복사"}
                        </button>
                        <button type="button" role="menuitem" onClick={() => void pinMemory(row.id)}>
                          맥락을 지금 대화에 붙이기
                        </button>
                        <button type="button" role="menuitem" className="is-delete" onClick={() => void removeRoom(row.id)}>
                          삭제
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {rooms.length === 0 ? <p className="thread-empty">이전 대화가 없다.</p> : null}
              <button
                type="button"
                className="flow-btn primary room-quick-new"
                onClick={() => {
                  setRoomId("");
                  setRoom(null);
                  setQuickOpen(false);
                  rememberRoom(project, "");
                  onOpenRoom?.("");
                }}
              >
                새 대화
              </button>
            </div>
          ) : null}

          {face === "chat" ? (
            <>
              <div className="thread-body room-stage">
                {(!roomId || room) && !room?.messages.length && !room?.execution && !waiting ? (
                  <div className="msg room-welcome">안녕하세요. 무엇을 도와드릴까요?</div>
                ) : null}
                {room?.execution ? <RoomExecutionPanel showSetup={false} key={`${project}/${roomId}`} project={project} roomId={roomId} members={members}
                  execution={room?.execution ?? null} waiting={!!waiting} kept={kept} revision={revision}
                  onChanged={() => setTick(n => n + 1)} onConsult={note => onConsult?.(note)} onAddMembers={() => setFace("llm")} /> : null}
                {room?.messages.map((m) => (
                  <RoomLine key={m.seq} message={m} />
                ))}
                {waiting ? <p className="thread-note">{room?.execution ? "운영 실행 처리 중" : enabled.some((m) => m.speaker === "claude-code" || m.speaker === "codex") ? "답하는 중 · 고쳐 달라는 요청이면 직접 고치고 검사한다 (몇 분 걸릴 수 있다)" : "한 바퀴를 말하는 중"}</p> : null}
                <div ref={endRef} />
              </div>
              {readOnly ? <div className="room-compose"><p className="thread-note">조회 전용 연결 · 대화와 실행 기록을 확인한다.</p></div> : room?.execution ? (
                <div className="room-compose"><p className="thread-note">운영 실행은 위의 단계 버튼으로 이어간다. 요구사항 변경은 상담으로 보낸다.</p>{error ? <p className="thread-err">{error}</p> : null}</div>
              ) : (
                <div className="room-compose">
                  {error ? <p className="thread-err">{error}</p> : null}
                  <textarea
                    aria-label="보낼 말"
                    rows={4}
                    value={draft}
                    disabled={waiting}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(draft, "talk"); }
                    }}
                  />
                  <div className="room-compose-tools">
                  <div className="room-attach">
                    <button
                      type="button"
                      className={`room-plus${plusOpen ? " is-on" : ""}`}
                      aria-label="첨부"
                      aria-pressed={plusOpen}
                      aria-expanded={plusOpen}
                      onClick={() => {
                        setPlusOpen((open) => !open);
                        setProjectFiles(null);
                      }}
                    >
                      <PlusIcon />
                    </button>
                    {plusOpen ? (
                      <div className="room-plus-menu" role="menu">
                        <button type="button" onClick={() => docRef.current?.click()}>문서</button>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const url = linkDraft.trim();
                            if (!/^https?:\/\//.test(url)) {
                              setError("링크는 http 로 시작한다.");
                              return;
                            }
                            setLinkDraft("");
                            setPlusOpen(false);
                            void send(`첨부 · 링크\n${url}`);
                          }}
                        >
                          <input aria-label="링크" value={linkDraft} placeholder="https://" onChange={(e) => setLinkDraft(e.target.value)} />
                          <button type="submit">링크</button>
                        </form>
                        <button
                          type="button"
                          onClick={() => {
                            void fetch(`/api/room/files?alias=${encodeURIComponent(project)}`)
                              .then((res) => res.json() as Promise<{ files?: string[]; error?: string }>)
                              .then((body) => setProjectFiles(body.files ?? []));
                          }}
                        >
                          프로젝트 파일
                        </button>
                        {projectFiles ? (
                          <>
                            <input aria-label="파일 경로" value={fileQuery} placeholder="경로" onChange={(e) => setFileQuery(e.target.value)} />
                            <ul>
                              {projectFiles.filter((file) => file.toLowerCase().includes(fileQuery.trim().toLowerCase())).slice(0, 40).map((file) => (
                                <li key={file}>
                                  <button type="button" onClick={() => void attachProjectFile(file)}>{file}</button>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <input ref={docRef} type="file" accept=".txt,.md,.json,.csv,.yaml,.yml,text/plain" hidden onChange={(e) => void onPickedFile(e)} />
                  </div>
                  <div className="room-call-actions">
                    <button type="button" className="flow-btn room-send" disabled={busy || waiting || !draft.trim()} onClick={() => void send(draft)}>기록하기</button>
                    <button type="button" className="flow-btn primary" disabled={busy || waiting || (enabled.length === 0 && !draft.trim())} onClick={() => void (enabled.length === 0 ? send(draft) : send(draft, "talk"))}>보내기</button>
                    <button type="button" className="flow-btn room-stop" disabled={room?.running !== true} onClick={() => void stopTurn()}>중단하기</button>
                  </div>
                  </div>
                </div>
              )}
              <div className="room-dock" aria-label="켜진 LLM">
                {enabled.map((member, index) => (
                  <button
                    key={`${index}-${member.speaker}-${member.model}`}
                    type="button"
                    className="room-chip"
                    style={chipStyle(member)}
                    title={`${personLabel(member)}${member.name?.trim() ? ` · ${member.name.trim()}` : ""}`}
                    onClick={() => setFace("llm")}
                  >
                    {chipFace(member)}
                  </button>
                ))}
                <span className="room-dock-add">
                  <button type="button" className="room-plus is-add" aria-label="LLM 추가" aria-expanded={dockOpen} onClick={() => {
                    if (!dockOpen) void refreshAgents();
                    setDockOpen((cur) => !cur);
                  }}>
                    <PlusIcon />
                  </button>
                  {dockOpen ? (
                    <div className="room-plus-menu room-dock-menu" role="menu">
                      {agents.map((agent) => {
                        const at = members.findIndex((member) => member.id === agent.id || sameAgent(member, agent));
                        const on = at >= 0 && members[at]!.enabled !== false;
                        return (
                          <button
                            key={agent.id ?? `${agent.speaker}-${agent.model}-${agent.name}`}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={on}
                            className="room-dock-agent"
                            disabled={kept || !!waiting}
                            onClick={() => {
                              // 켜면 이 대화에 들어오고(처음이면 Agents 목록에서 복사), 끄면 꺼진 채로 남는다.
                              if (at < 0) void cast([...members, { ...agent, enabled: true }]);
                              else patchMember(at, { enabled: !on }, true);
                            }}
                          >
                            <span className="room-chip" style={chipStyle(agent)}>{chipFace(agent)}</span>
                            {agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker]}
                            <span className={`room-icon room-power${on ? " is-on" : ""}`} aria-hidden="true"><PowerIcon /></span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setDockOpen(false);
                          setFace("llm");
                        }}
                      >
                        새 Agent 등록
                      </button>
                    </div>
                  ) : null}
                </span>
              </div>
            </>
          ) : (
            <LlmFace
              hosts={hosts}
              members={members}
              messages={room?.messages ?? []}
              localId={localId}
              kept={kept}
              waiting={!!waiting || !!room?.execution && !["done", "failed", "consult"].includes(room.execution.phase)}
              onLocalId={setLocalId}
              onPatch={patchMember}
              onRemove={(index) => void cast(members.filter((_, i) => i !== index))}
              onAddAgent={(agent) => void saveAgents((fresh) => [...fresh, agent])}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RoomLine({ message: m }: { message: RoomMessage }) {
  if (m.role === "operation") return <div className={`msg is-operation is-${m.status}`}>
    <span className="msg-meta">{{ consult: "상담 연결", prepare: "실행 배정", act: "수행", check: "검증", deploy: "적용" }[m.stage]} · {{ started: "시작", completed: "완료", failed: "실패", waiting: "대기" }[m.status]}</span>
    {m.text}{m.result !== undefined ? <details><summary>실행 근거</summary><pre>{JSON.stringify(m.result, null, 2)}</pre></details> : null}
  </div>;
  if (m.role === "memory") {
    return (
      <div className="msg is-memory">
        <span className="msg-meta">맥락 · 이전 기록</span>
        {m.text}
      </div>
    );
  }
  if (m.role === "user") {
    const to = m.to ? ` → ${ROOM_SPEAKER_LABEL[m.to]}${m.model ? ` · ${m.model}` : ""}` : "";
    return (
      <div className="msg is-user">
        <span className="msg-meta">나{to}{m.via === "claude-session" ? " · Claude Code 세션에서" : ""}</span>
        {m.text}
      </div>
    );
  }
  if (m.role === "system") {
    return <div className="msg is-system">{m.text}</div>;
  }
  const name = m.speaker === "local" && m.model ? m.model : ROOM_SPEAKER_LABEL[m.speaker];
  return (
    <div className="msg is-host">
      <span className="msg-meta">
        {name}
        {m.speaker !== "local" && m.model ? ` · ${m.model}` : ""}{m.effort ? ` · ${m.effort}` : ""}{m.via === "claude-session" ? " · Claude Code 세션" : ""} · {(m.ms / 1000).toFixed(1)}초
      </span>
      {m.text}
    </div>
  );
}

function memberUsage(member: RoomMember, messages: RoomMessage[]) {
  const lines = messages.filter(
    (m): m is Extract<RoomMessage, { role: "speaker" }> =>
      m.role === "speaker" && m.speaker === member.speaker && m.model === member.model,
  );
  const input = lines.reduce((sum, line) => sum + (line.usage?.input ?? 0), 0);
  const output = lines.reduce((sum, line) => sum + (line.usage?.output ?? 0), 0);
  const known = lines.some((line) => line.usage);
  return {
    calls: lines.length,
    ms: lines.reduce((sum, line) => sum + line.ms, 0),
    chars: lines.reduce((sum, line) => sum + line.text.length, 0),
    input: known ? input : null,
    output: known ? output : null,
  };
}

function LlmFace({
  hosts,
  members,
  messages,
  localId,
  kept,
  waiting,
  onLocalId,
  onPatch,
  onRemove,
  onAddAgent,
}: {
  hosts: HostRow[];
  members: RoomMember[];
  messages: RoomMessage[];
  localId: string;
  kept: boolean;
  waiting: boolean;
  onLocalId: (value: string) => void;
  onPatch: (index: number, patch: Partial<RoomMember>, save?: boolean) => void;
  onRemove: (index: number) => void;
  onAddAgent: (agent: RoomMember) => void;
}) {
  const [speaker, setSpeaker] = useState<RoomSpeaker>("claude-code");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [version, setVersion] = useState("");
  const [effort, setEffort] = useState<"low" | "medium" | "high">("medium");
  const [color, setColor] = useState(CHIP_DEFAULT_COLOR);
  const [image, setImage] = useState("");
  const [iconHtml, setIconHtml] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editAt, setEditAt] = useState<number | null>(null);

  function resetForm() {
    setName("");
    setColor(CHIP_DEFAULT_COLOR);
    setImage("");
    setIconHtml("");
    setRole("");
    setVersion("");
    setEffort("medium");
    if (speaker === "local") onLocalId("");
  }

  const locked = kept || waiting;
  const host = hosts.find((row) => row.speaker === speaker);

  return (
    <div className="room-llm">
      <div className="room-call-pin">
      <section className="room-call is-new">
        <h3>LLM 호출</h3>
        <label>
          사용 가능한 LLM
          <select aria-label="사용 가능한 LLM" value={speaker} disabled={locked} onChange={(e) => setSpeaker(e.target.value as RoomSpeaker)}>
            {hosts.map((row) => (
              <option key={row.speaker} value={row.speaker} disabled={!row.available}>
                {row.label}{row.available ? "" : " · 없음"}
              </option>
            ))}
          </select>
        </label>
        <p className="thread-note">{host?.available ? host.loggedIn === true ? "로그인 연결됨 · 이 Mac에서 호출한다." : host.loggedIn === false ? host.hint : "실행 파일 연결됨 · 계정 또는 로컬 모델 상태는 호출 시 확인한다." : "실행 파일을 찾지 못했다."}</p>
        {speaker === "local" ? (
          <label>
            버전
            <input aria-label="새 LM Studio 모델 id" value={localId} disabled={locked} placeholder="LM Studio 모델 id" onChange={(e) => onLocalId(e.target.value)} />
          </label>
        ) : (
          <div className="room-pair">
            <label>
              버전
              <input aria-label="버전" value={version} disabled={locked} placeholder="모델 이름" onChange={(e) => setVersion(e.target.value)} />
            </label>
            <label>
              강도
              <select aria-label="강도" value={effort} disabled={locked || speaker === "grok"} onChange={(e) => setEffort(e.target.value as "low" | "medium" | "high")}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>
        )}
        <div className="room-pair">
          <label>
            역할명
            <input aria-label="새 역할명" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            아이콘 색
            <span className="room-color">
              <input type="color" aria-label="새 아이콘 색" value={color} disabled={locked} onChange={(e) => setColor(e.target.value)} />
              <span className="room-chip" style={chipStyle({ speaker, model: "", role: "", name: name || "?", color, ...(image ? { image } : {}), ...(iconHtml ? { iconHtml } : {}) })}>{chipFace({ speaker, model: "", role: "", name: name.trim() || "?", ...(image ? { image } : {}), ...(iconHtml ? { iconHtml } : {}) })}</span>
            </span>
          </label>
        </div>
        <label>
          아이콘 이미지
          <IconPick image={image} iconHtml={iconHtml} disabled={locked} onChange={(patch) => { setImage(patch.image ?? ""); setIconHtml(patch.iconHtml ?? ""); }} onError={setFormError} />
        </label>
        {formError ? <p className="thread-err">{formError}</p> : null}
        <label>
          주요 역할
          <textarea aria-label="새 주요 역할" rows={2} value={role} disabled={locked} placeholder="이 사람이 할 일" onChange={(e) => setRole(e.target.value)} />
        </label>
        <RoleAttach disabled={locked} onText={(block) => setRole((cur) => joinRole(cur, block))} />
        <button
          type="button"
          className="flow-btn primary"
          disabled={locked || (host ? !host.available : false) || (speaker === "local" && !localId.trim())}
          onClick={() => {
            const problem = iconProblem({ image, iconHtml });
            if (problem) { setFormError(problem); return; }
            setFormError(null);
            const next: RoomMember = {
              speaker,
              model: speaker === "local" ? localId.trim() : version.trim(),
              role,
              name,
              color,
              ...(image ? { image } : {}),
              ...(iconHtml.trim() ? { iconHtml } : {}),
              ...(speaker === "local" || speaker === "grok" ? {} : { effort }),
            };
            onAddAgent({ ...next, enabled: true });
            resetForm();
          }}
        >
          Agents 목록에 등록
        </button>
      </section>
      </div>
      <h3 className="room-roles-title">이 대화의 LLM</h3>
      <div className="room-roles">
        {members.map((member, index) => {
          const used = memberUsage(member, messages);
          const linked = hosts.find((row) => row.speaker === member.speaker);
          const shown = open === index;
          return (
            <section className={`room-role${member.enabled === false ? " is-off" : ""}`} key={`${index}-${member.speaker}-${member.model}`}>
              <span className="room-chip" style={chipStyle(member)}>{chipFace(member)}</span>
              <b>{member.name?.trim() || ROOM_SPEAKER_LABEL[member.speaker]}</b>
              <button
                type="button"
                className={`room-icon room-power${member.enabled !== false ? " is-on" : ""}`}
                title={member.enabled !== false ? "켜짐 · 누르면 끈다" : "꺼짐 · 누르면 켠다"}
                aria-label="켜기"
                aria-pressed={member.enabled !== false}
                disabled={locked}
                onClick={() => onPatch(index, { enabled: member.enabled === false }, true)}
              >
                <PowerIcon />
              </button>
              <button
                type="button"
                className={`room-icon${shown ? " is-on" : ""}`}
                aria-label="세부 내용"
                aria-expanded={shown}
                onClick={() => setOpen(shown ? null : index)}
              >
                <DetailIcon />
              </button>
              {shown ? (
                <div className="room-role-body">
                  {editAt === index ? (
                    <MemberEditor
                      member={member}
                      disabled={locked}
                      onCancel={() => setEditAt(null)}
                      onSave={(patch) => {
                        onPatch(index, patch, true);
                        setEditAt(null);
                      }}
                    />
                  ) : (
                    <dl>
                      <div><dt>모델</dt><dd>{member.model.trim() || "모델 기본"}{member.effort ? ` · ${member.effort}` : ""}</dd></div>
                      <div><dt>주요 역할</dt><dd className="room-role-text">{member.role.trim() || "없음"}</dd></div>
                    </dl>
                  )}
                  <dl>
                    <div>
                      <dt>연결</dt>
                      <dd>{linked?.loggedIn === true ? "로그인 연결됨" : linked?.loggedIn === false ? linked.hint : linked?.available ? "실행 파일을 찾았다 · 호출 시 연결 확인" : "실행 파일이 없다"}</dd>
                    </div>
                    <div>
                      <dt>호출</dt>
                      <dd>{used.calls}번 · {(used.ms / 1000).toFixed(1)}초 · 받은 글자 {used.chars}</dd>
                    </div>
                    <div>
                      <dt>패킷</dt>
                      <dd>{used.input === null ? "호출 결과에 양이 없다" : `입력 ${used.input} · 출력 ${used.output}`}</dd>
                    </div>
                  </dl>
                  <div className="room-role-actions">
                    <button type="button" className="flow-btn" disabled={locked || editAt === index} onClick={() => setEditAt(index)}>
                      수정
                    </button>
                    <button type="button" className="flow-btn" disabled={locked} onClick={() => onRemove(index)}>
                      빼기
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 등록된 Agent 고치기. 고치는 동안은 저장하지 않고, 「저장」을 누르면 한 번에 반영한다. */
function MemberEditor({ member, disabled, onSave, onCancel }: { member: RoomMember; disabled: boolean; onSave: (patch: Partial<RoomMember>) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<RoomMember>(member);
  const [problem, setProblem] = useState<string | null>(null);
  const label = member.name?.trim() || ROOM_SPEAKER_LABEL[member.speaker];
  const set = (patch: Partial<RoomMember>) => setDraft((cur) => ({ ...cur, ...patch }));
  return (
    <div className="room-member-edit">
      <div className="room-pair">
        <label>
          역할명
          <input aria-label={`${label} 역할명`} value={draft.name ?? ""} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          아이콘 색
          <span className="room-color">
            <input type="color" aria-label={`${label} 아이콘 색`} value={draft.color ?? CHIP_DEFAULT_COLOR} disabled={disabled} onChange={(e) => set({ color: e.target.value })} />
            <span className="room-chip" style={chipStyle({ ...draft, name: draft.name || "?" })}>{chipFace({ ...draft, name: draft.name?.trim() || "?" })}</span>
          </span>
        </label>
      </div>
      <label>
        아이콘 이미지
        <IconPick image={draft.image ?? ""} iconHtml={draft.iconHtml ?? ""} disabled={disabled} onChange={(patch) => set({ image: patch.image || undefined, iconHtml: patch.iconHtml || undefined })} onError={setProblem} />
      </label>
      {draft.speaker === "local" ? (
        <label>
          버전
          <input aria-label="LM Studio 모델 id" value={draft.model} disabled={disabled} onChange={(e) => set({ model: e.target.value })} />
        </label>
      ) : (
        <div className="room-pair">
          <label>
            버전
            <input aria-label={`${label} 버전`} value={draft.model} disabled={disabled} onChange={(e) => set({ model: e.target.value })} />
          </label>
          <label>
            강도
            <select
              aria-label={`${label} 강도`}
              value={draft.effort ?? ""}
              disabled={disabled || draft.speaker === "grok"}
              onChange={(e) => set({ effort: e.target.value ? e.target.value as "low" | "medium" | "high" : undefined })}
            >
              <option value="">모델 기본</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
        </div>
      )}
      <label>
        주요 역할
        <textarea aria-label={`${label} 주요 역할`} rows={4} value={draft.role} disabled={disabled} onChange={(e) => set({ role: e.target.value })} />
      </label>
      <RoleAttach disabled={disabled} onText={(block) => set({ role: joinRole(draft.role, block) })} />
      {problem ? <p className="thread-err">{problem}</p> : null}
      <div className="room-role-actions">
        <button
          type="button"
          className="flow-btn primary"
          disabled={disabled || (draft.speaker === "local" && !draft.model.trim())}
          onClick={() => {
            const found = iconProblem({ image: draft.image, iconHtml: draft.iconHtml });
            if (found) { setProblem(found); return; }
            onSave({ name: draft.name, role: draft.role, model: draft.model, effort: draft.effort, color: draft.color, image: draft.image || undefined, iconHtml: draft.iconHtml?.trim() ? draft.iconHtml : undefined });
          }}
        >
          저장
        </button>
        <button type="button" className="flow-btn" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

type IconPatch = { image?: string; iconHtml?: string };

/** 아이콘: 이미지 주소 · 파일(PNG·SVG 등은 96px로 줄임, .html은 원본 그대로) · HTML 직접 입력. 값은 부모가 들고 있다. */
function IconPick({ image, iconHtml, disabled, onChange, onError }: { image: string; iconHtml: string; disabled: boolean; onChange: (patch: IconPatch) => void; onError: (message: string | null) => void }) {
  const [htmlOpen, setHtmlOpen] = useState(!!iconHtml);
  const fromFile = image.startsWith("data:");
  return (
    <span className="room-icon-pick">
      <span className="room-color">
        <input
          aria-label="아이콘 이미지 주소"
          value={fromFile ? "(파일에서 고른 이미지)" : image}
          disabled={disabled || fromFile || !!iconHtml}
          placeholder="https://… 이미지 주소"
          onChange={(e) => onChange({ image: e.target.value.trim(), iconHtml: "" })}
        />
        <label className="flow-btn room-file">
          파일
          <input
            type="file"
            accept="image/*,.svg,.html,.htm,text/html"
            hidden
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              onError(null);
              if (/\.html?$/i.test(file.name) || file.type === "text/html") {
                file.text().then((text) => { onChange({ image: "", iconHtml: text }); setHtmlOpen(true); }, () => onError("HTML 파일을 읽지 못했다."));
                return;
              }
              shrinkIcon(file).then((data) => onChange({ image: data, iconHtml: "" }), (err: Error) => onError(err.message));
            }}
          />
        </label>
        <button type="button" className={`flow-btn${htmlOpen ? " is-on" : ""}`} disabled={disabled} onClick={() => setHtmlOpen((cur) => !cur)}>HTML</button>
        {image || iconHtml ? <button type="button" className="flow-btn" disabled={disabled} onClick={() => { onChange({ image: "", iconHtml: "" }); setHtmlOpen(false); }}>지우기</button> : null}
      </span>
      {htmlOpen ? (
        <textarea
          aria-label="아이콘 HTML"
          rows={5}
          value={iconHtml}
          disabled={disabled}
          placeholder={'<svg viewBox="0 0 32 32">…</svg> 또는 <div style="…">수</div>'}
          onChange={(e) => onChange({ image: "", iconHtml: e.target.value })}
        />
      ) : null}
    </span>
  );
}

/** 아이콘 값 검사. 문제가 없으면 null. */
function iconProblem(patch: IconPatch): string | null {
  if (patch.image && !/^(https?:\/\/|data:image\/)/.test(patch.image)) return "이미지 주소는 http:// 또는 https:// 로 시작해야 한다.";
  if ((patch.iconHtml ?? "").length > 100_000) return "아이콘 HTML이 너무 길다 (10만 자 이하).";
  return null;
}

function sameAgent(a: RoomMember, b: RoomMember): boolean {
  return a.speaker === b.speaker && a.model.trim() === b.model.trim() && (a.effort ?? "") === (b.effort ?? "") && (a.name?.trim() ?? "") === (b.name?.trim() ?? "");
}

function joinRole(role: string, block: string): string {
  return role.trim() ? `${role.trim()}\n\n${block}` : block;
}

function RoleAttach({ disabled, onText }: { disabled: boolean; onText: (block: string) => void }) {
  const [openMenu, setOpenMenu] = useState(false);
  const [skills, setSkills] = useState<{ slug: string }[] | null>(null);
  const docRef = useRef<HTMLInputElement>(null);

  return (
    <div className="room-attach">
      <button type="button" className="room-plus" aria-label="역할에 붙이기" aria-expanded={openMenu} disabled={disabled} onClick={() => setOpenMenu((cur) => !cur)}>
        <PlusIcon />
      </button>
      {openMenu ? (
        <div className="room-plus-menu" role="menu">
          <button type="button" onClick={() => docRef.current?.click()}>문서</button>
          <button
            type="button"
            onClick={() => {
              void fetch("/api/room/skills")
                .then((res) => res.json() as Promise<{ skills?: { slug: string }[] }>)
                .then((body) => setSkills(body.skills ?? []));
            }}
          >
            스킬
          </button>
          {skills ? (
            <ul>
              {skills.length ? skills.map((skill) => (
                <li key={skill.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      void fetch(`/api/room/skills?slug=${encodeURIComponent(skill.slug)}`)
                        .then((res) => res.json() as Promise<{ text?: string; error?: string }>)
                        .then((body) => {
                          if (!body.text) return;
                          onText(`첨부 · 스킬 「${skill.slug}」\n${clipAttach(body.text)}`);
                          setOpenMenu(false);
                          setSkills(null);
                        });
                    }}
                  >
                    {skill.slug}
                  </button>
                </li>
              )) : <li>스킬이 없다.</li>}
            </ul>
          ) : null}
        </div>
      ) : null}
      <input
        ref={docRef}
        type="file"
        accept=".txt,.md,.json,.csv,.yaml,.yml,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void file.text().then((text) => {
            onText(`첨부 · 문서 「${file.name}」\n${clipAttach(text)}`);
            setOpenMenu(false);
          });
        }}
      />
    </div>
  );
}
