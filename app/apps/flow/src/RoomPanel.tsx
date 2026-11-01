import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { shortLabel } from "./shortLabel.js";
import {
  ROOM_MODE_ICONS,
  ROOM_SPEAKER_LABEL,
  roomMemory,
  type RoomMember,
  type RoomMessage,
  type RoomMode,
  type RoomModeExecution,
  type RoomModeIcon,
  type RoomSpeaker,
  type RoomStatus,
  type RoomSummary,
  type RoomExecution,
} from "@patchbay/core";
import { TodoPreparationReview } from "./TodoPreparationPanel.js";
import { RoomExecutionPanel } from "./RoomExecutionPanel.js";
import { ChatText } from "./ChatText.js";
import { RoomQuestionCard } from "./RoomQuestionCard.js";
import { splitQuestions } from "./roomQuestions.js";
import { UserActionGuide } from "./UserActionGuide.js";
import type { ActionRequest } from "./userAction.js";
import { isChatImage, projectFileHref, refImageHref } from "./chatLinks.js";
import {
  buildComposedMessage,
  clipAttach,
  filterProjectFiles,
  filterRulesAndSkills,
  makeStagedDoc,
  makeStagedImage,
  makeStagedLink,
  makeStagedProjectFile,
  makeStagedRuleOrSkill,
  type RuleSkillRow,
  type StagedAttachment,
} from "./roomComposer.js";

function RoomCenterDialog({
  title,
  subtitle,
  className = "",
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`todo-modal room-center-modal ${className}`.trim()}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="room-modal-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <small className="room-modal-sub">{subtitle}</small> : null}
        </div>
        <button type="button" className="room-modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </header>
      <div className="room-modal-body">{children}</div>
    </dialog>
  );
}

function roomRequestError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
    ? "Patchbay 서버에 연결할 수 없습니다. 입력 내용은 유지됩니다. 연결이 복구되면 다시 눌러주세요."
    : message;
}

async function roomJson<T>(response: Response, label: string): Promise<T> {
  let body: T & { error?: string };
  try { body = await response.json(); }
  catch { throw new Error(`${label}을 불러오지 못했습니다 (HTTP ${response.status}). 다시 확인해주세요.`); }
  if (!response.ok || body.error) throw new Error(body.error ?? `${label}을 불러오지 못했습니다 (HTTP ${response.status}).`);
  return body;
}

const CHIP: Record<RoomSpeaker, { mark: string; color: string }> = {
  "claude-code": { mark: "Cla", color: "#3d6fe0" },
  codex: { mark: "Co", color: "#e08a2f" },
  grok: { mark: "Gr", color: "#5b6fd6" },
  local: { mark: "Lo", color: "#3d6fe0" },
};

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

function ModeTriggerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="5.5" cy="4.5" r="1.5" fill="var(--fill)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.5" cy="8" r="1.5" fill="var(--fill)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6.5" cy="11.5" r="1.5" fill="var(--fill)" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ModeIcon({ icon }: { icon?: RoomModeIcon }) {
  switch (icon) {
    case "report":
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 1.8h6.2L13 5.1v9.1a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z" />
          <path d="M9.5 1.8v3.5H13M5.2 8h5.6M5.2 10.6h5.6M5.2 13h3.4" />
        </svg>
      );
    case "planning":
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="3.2" cy="3.5" r="1.6" />
          <circle cx="3.2" cy="12.5" r="1.6" />
          <circle cx="12.8" cy="8" r="1.6" />
          <path d="M4.8 3.5h3a2 2 0 0 1 2 2v2.5h1.4M4.8 12.5h3a2 2 0 0 0 2-2V8" />
        </svg>
      );
    case "design":
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2.2" width="12" height="11.6" rx="1.8" />
          <path d="M2 6h12M6.5 6v7.8" />
          <circle cx="10.3" cy="10" r="1.5" />
        </svg>
      );
    case "study":
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3.6c-1.6-1.1-3.8-1.3-6-.8v9.5c2.2-.5 4.4-.3 6 .8 1.6-1.1 3.8-1.3 6-.8V2.8c-2.2-.5-4.4-.3-6 .8Z" />
          <path d="M8 3.6v9.5" />
        </svg>
      );
    case "coding":
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.2 4.8 1.8 8l3.4 3.2M10.8 4.8 14.2 8l-3.4 3.2M9.2 3.2 6.8 12.8" />
        </svg>
      );
    case "debug":
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7.2" cy="7.2" r="4.6" />
          <path d="m10.6 10.6 3.4 3.4M7.2 4.8v4.8M4.8 7.2h4.8" />
        </svg>
      );
    case "discuss":
    default:
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3.2h7.5a1.3 1.3 0 0 1 1.3 1.3v3.5a1.3 1.3 0 0 1-1.3 1.3H5.2L2.6 11.5V9.3H2A1.3 1.3 0 0 1 .7 8V4.5A1.3 1.3 0 0 1 2 3.2Z" />
          <path d="M7.5 6.8h6.5a1.2 1.2 0 0 1 1.2 1.2v3.2a1.2 1.2 0 0 1-1.2 1.2h-.8v2l-2.2-2H7.5a1.2 1.2 0 0 1-1.2-1.2V8" />
        </svg>
      );
  }
}

const MODE_ICON_LABEL: Record<RoomModeIcon, string> = {
  discuss: "토의",
  report: "보고서",
  planning: "플래닝",
  design: "디자인",
  study: "스터디",
  coding: "코딩",
  debug: "디버그",
};

const MODE_EXEC_LABEL: Record<RoomModeExecution, string> = {
  read: "읽기",
  edit: "문서",
  apply: "실행",
};

function modeFace(mode: Pick<RoomMode, "name" | "icon" | "image" | "iconHtml">): ReactNode {
  if (mode.iconHtml?.trim()) return <iframe className="room-chip-img room-chip-html" sandbox="" srcDoc={iconDoc(mode.iconHtml)} title="" tabIndex={-1} aria-hidden="true" />;
  if (mode.image) return <img className="room-chip-img" src={mode.image} alt="" />;
  if (mode.icon) return <ModeIcon icon={mode.icon} />;
  const first = mode.name.trim();
  return first ? Array.from(first)[0]! : <ModeIcon icon="discuss" />;
}

function modeStyle(mode: Pick<RoomMode, "color" | "image" | "iconHtml">): CSSProperties {
  if (mode.image || mode.iconHtml?.trim()) return { padding: 0, overflow: "hidden", width: 36, minWidth: 36, flex: "none" };
  const color = mode.color ?? CHIP_DEFAULT_COLOR;
  return { background: color, borderColor: color, color: "#fff" };
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
export function chipFace(member: RoomMember): ReactNode {
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
export function chipStyle(member: RoomMember): CSSProperties | undefined {
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
  modeId?: string | null;
  preparationStatus?: string;
  preparationWarning?: string;
  execution?: RoomExecution | null;
  /** 이 방이 맡은 미완료 할일. 있으면 「완료」로 끝낸다. */
  todo?: { id: string; title: string } | null;
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
  actionRequest,
  onReturnToAction,
  onDismissAction,
}: {
  project: string;
  revision: number;
  openRoom?: string;
  onOpenRoom?: (roomId: string) => void;
  onClose?: () => void;
  onConsult?: (note?: string) => void;
  draftRequest?: { text: string; nonce: number };
  readOnly?: boolean;
  actionRequest?: ActionRequest;
  onReturnToAction?: () => void;
  onDismissAction?: () => void;
}) {
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [agents, setAgents] = useState<RoomMember[]>([]);
  const [modes, setModes] = useState<RoomMode[]>([]);
  const [roomId, setRoomId] = useState("");
  const [room, setRoom] = useState<RoomBody | null>(null);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);
  const [attachingImage, setAttachingImage] = useState(false);
  const [roomsLoadError, setRoomsLoadError] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [llmTab, setLlmTab] = useState<"agent" | "mode">("agent");
  // + 메뉴와 모드 메뉴는 모달로 열리므로 RoomCenterDialog가 닫기를 처리한다.
  const [roomQuery, setRoomQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [localId, setLocalId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [titleFocus, setTitleFocus] = useState(false);
  const [copied, setCopied] = useState(false);
  const [face, setFace] = useState<"chat" | "llm">("chat");
  const [preparationView, setPreparationView] = useState(true);
  useEffect(() => { setPreparationView(true); }, [project, roomId]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusTab, setPlusTab] = useState<"upload" | "files" | "rules" | "link">("upload");
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [projectFiles, setProjectFiles] = useState<string[] | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [ruleList, setRuleList] = useState<RuleSkillRow[] | null>(null);
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleFilter, setRuleFilter] = useState<"all" | "규칙" | "스킬">("all");
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [agentQuery, setAgentQuery] = useState("");
  const [modeQuery, setModeQuery] = useState("");
  const docRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const guidedTodo = actionRequest?.action.target.kind === "todo" && actionRequest.action.target.roomId === roomId && !!room?.todo && !room.running;
  const visibleGuide = actionRequest && (actionRequest.action.target.kind !== "todo" || guidedTodo) ? actionRequest : undefined;
  useEffect(() => {
    if (!actionRequest) return;
    setFace("chat"); setQuickOpen(false); setPreparationView(true);
  }, [actionRequest]);

  useEffect(() => {
    setRoom(null);
    setRooms([]);
    setRoomLoadError(null);
    setRoomsLoadError(null);
    setQuickOpen(false);
    setPlusOpen(false);
    setDockOpen(false);
    setModeMenuOpen(false);
    setStaged([]);
    setMenuFor(null);
    setDraft("");
    // 위에서 비운 방 · 목록을 다시 읽는다. 열려던 방이 이미 보던 방이면 roomId가 그대로라 읽기가 다시 돌지 않아 빈 칸으로 남았다
    // (Tasks 「대화창 열기」, 2026-10-26).
    setTick((n) => n + 1);
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
      .then((res) => roomJson<{ rooms?: RoomRow[] }>(res, "대화 목록"))
      .then((body) => {
        if (cancelled || !Array.isArray(body.rooms)) return;
        if (kept === "" || (kept && body.rooms.some((row) => row.id === kept))) return;
        const latest = body.rooms[0]?.id ?? "";
        setRoomId(latest);
        if (latest) rememberRoom(project, latest);
      })
      .catch(reason => { if (!cancelled) setRoomsLoadError(roomRequestError(reason)); });
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
    fetch(`/api/modes?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ modes?: RoomMode[] }>)
      .then((body) => {
        if (!cancelled && Array.isArray(body.modes)) setModes(body.modes);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms?alias=${encodeURIComponent(project)}`)
      .then((res) => roomJson<{ rooms: RoomRow[] }>(res, "대화 목록"))
      .then((body) => {
        if (!Array.isArray(body.rooms)) throw new Error("대화 목록의 응답 형식이 올바르지 않습니다.");
        if (!cancelled) { setRooms(body.rooms); setRoomsLoadError(null); }
      })
      .catch(reason => { if (!cancelled) setRoomsLoadError(roomRequestError(reason)); });
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setRoomLoadError(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/room?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(roomId)}`)
      .then(res => roomJson<RoomBody>(res, "대화 내용"))
      .then(body => {
        if (body.id !== roomId || !Array.isArray(body.messages)) throw new Error("대화 내용의 응답 형식이 올바르지 않습니다.");
        if (cancelled) return;
        setRoom(body);
        setRoomLoadError(null);
      })
      .catch(reason => { if (!cancelled) setRoomLoadError(roomRequestError(reason)); });
    return () => {
      cancelled = true;
    };
  }, [project, roomId, revision, tick]);

  useEffect(() => {
    if (!titleFocus) setTitleDraft(room?.displayTitle ?? "");
  }, [room?.displayTitle, roomId, titleFocus]);

  const waiting = !roomLoadError && room?.running === true;
  // 같은 프로젝트의 다른 방에서 LLM이 답하는 중이면 위에 띄우고, 끝날 때까지 목록을 다시 읽는다.
  const busyElsewhere = roomsLoadError ? [] : rooms.filter((row) => row.running && row.id !== roomId);
  const othersBusy = busyElsewhere.length > 0;
  useEffect(() => {
    if (!waiting && !othersBusy && !roomLoadError && !roomsLoadError) return;
    const timer = setInterval(() => setTick((n) => n + 1), roomLoadError || roomsLoadError ? 5000 : 1500);
    return () => clearInterval(timer);
  }, [waiting, othersBusy, roomLoadError, roomsLoadError]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [room?.messages.length]);

  const members = room?.members ?? [];
  // 방을 잠그지 않는다. 예전에 잠긴 방은 열 때 푼다.
  const kept = readOnly;
  const blank = !room?.messages.some((m) => m.role === "user" || m.role === "speaker");

  function show(id: string) {
    if (guidedTodo && id !== roomId) onDismissAction?.();
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

  async function refreshModes() {
    try {
      const res = await fetch(`/api/modes?alias=${encodeURIComponent(project)}`);
      const body = (await res.json()) as { modes?: RoomMode[] };
      if (res.ok && body.modes) setModes(body.modes);
    } catch {
      // 목록을 못 읽으면 들고 있는 목록을 그대로 보여 준다.
    }
  }

  async function saveModes(change: (fresh: RoomMode[]) => RoomMode[]) {
    setError(null);
    const got = await fetch(`/api/modes?alias=${encodeURIComponent(project)}`);
    const current = (await got.json()) as { modes?: RoomMode[]; error?: string };
    if (!got.ok || !current.modes) {
      setError(current.error ?? "모드 목록을 읽지 못했다.");
      return;
    }
    const res = await fetch("/api/modes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, modes: change(current.modes) }),
    });
    const body = (await res.json()) as { modes?: RoomMode[]; error?: string };
    if (!res.ok || body.error || !body.modes) setError(body.error ?? "모드 목록에 저장하지 못했다.");
    else setModes(body.modes);
  }

  async function selectMode(nextModeId: string | null) {
    if (kept || waiting) return;
    setError(null);
    const res = await fetch("/api/room/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, ...(roomId ? { roomId } : {}), modeId: nextModeId }),
    });
    const body = (await res.json()) as { roomId?: string; modeId?: string | null; members?: RoomMember[]; error?: string };
    if (!res.ok || body.error || !body.roomId) {
      setError(body.error ?? "모드를 바꾸지 못했다.");
    } else {
      setRoom((cur) => (cur ? { ...cur, modeId: body.modeId ?? null, ...(body.members ? { members: body.members } : {}) } : cur));
      show(body.roomId);
    }
    setTick((n) => n + 1);
  }

  function stageItems(items: StagedAttachment[]) {
    setStaged((cur) => {
      const map = new Map(cur.map((item) => [item.id, item]));
      for (const item of items) map.set(item.id, item);
      return [...map.values()];
    });
  }

  function removeStaged(id: string) {
    setStaged((cur) => cur.filter((item) => item.id !== id));
  }

  // `answer` 는 「질문」 칸의 답이다 — 입력창에 적던 말 · 첨부는 그대로 둔다. Send 단추처럼 켜진 사람이 있으면 대화도 시작한다.
  async function send(text: string, round?: "talk" | "discuss", answer = false) {
    const line = answer ? text : buildComposedMessage(text, staged);
    if ((!line && !round) || busy || waiting || kept || roomLoadError) return;
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
        if (!answer) {
          setDraft("");
          setStaged([]);
        }
        if (guidedTodo) onDismissAction?.();
        if (body.roomId) show(body.roomId);
      }
    } catch (err) {
      setError(roomRequestError(err));
    } finally {
      setBusy(false);
      setTick((n) => n + 1);
    }
  }

  // 할일 「완료」 — 서버가 완료 안내 · 다음 할일 링크를 남긴 뒤 할일을 완료로 옮긴다.
  async function completeTodo() {
    if (!roomId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/room/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alias: project, roomId }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) setError(body.error ?? `HTTP ${res.status}`);
      else if (guidedTodo) onDismissAction?.();
    } catch (err) {
      setError(roomRequestError(err));
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
      setError(roomRequestError(err));
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

  async function stageLocalFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length || busy || waiting || kept || readOnly || roomLoadError || attachingImage) return;
    setError(null);
    const added: StagedAttachment[] = [];
    for (const file of files) {
      if (isChatImage(file.name)) {
        if (file.size > 10 * 1024 * 1024) {
          setError(`${file.name}: 사진은 10MB까지 붙일 수 있습니다.`);
          continue;
        }
        setAttachingImage(true);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const response = await fetch("/api/refs/file", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ alias: project, name: file.name, dataBase64: btoa(binary) }),
          });
          const result = await roomJson<{ ref?: { id: string } }>(response, "사진");
          if (!result.ref?.id) throw new Error("사진을 저장하지 못했습니다.");
          const href = refImageHref(project, result.ref.id);
          added.push(makeStagedImage(file.name, href, `img:${result.ref.id}`));
        } catch (cause) {
          setError(roomRequestError(cause));
        } finally {
          setAttachingImage(false);
        }
      } else {
        try {
          const text = await file.text();
          added.push(makeStagedDoc(file.name, text, `doc:${file.name}:${file.size}`));
        } catch {
          setError(`${file.name} 파일을 읽지 못했습니다.`);
        }
      }
    }
    if (added.length) {
      stageItems(added);
      setPlusOpen(false);
    }
  }

  async function onPickedFile(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) return;
    const picked = Array.from(files);
    event.target.value = "";
    await stageLocalFiles(picked);
  }

  function loadModalData(nextTab?: "upload" | "files" | "rules" | "link") {
    const tab = nextTab ?? plusTab;
    if (tab === "files" && projectFiles === null) {
      void fetch(`/api/room/files?alias=${encodeURIComponent(project)}`)
        .then((res) => res.json() as Promise<{ files?: string[]; error?: string }>)
        .then((body) => setProjectFiles(body.files ?? []))
        .catch(() => setProjectFiles([]));
    }
    if (tab === "rules" && ruleList === null) {
      void fetch(`/api/rules?alias=${encodeURIComponent(project)}`)
        .then((res) => res.json() as Promise<{ rules?: { name: string; description: string; apply?: "always" | "request" }[]; skills?: { name: string; description: string; scope?: "project" | "studio" }[] }>)
        .then((body) =>
          setRuleList([
            ...(body.rules ?? []).map((row) => ({ kind: "규칙" as const, ...row })),
            ...(body.skills ?? []).map((row) => ({ kind: "스킬" as const, ...row })),
          ]),
        )
        .catch(() => setRuleList([]));
    }
  }

  async function previewProjectFile(file: string) {
    setPreviewPath(file);
    setPreviewContent(null);
    if (isChatImage(file)) return;
    try {
      const res = await fetch(`/api/source?alias=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`);
      const body = (await res.json()) as { content?: string; error?: string };
      setPreviewContent(res.ok && typeof body.content === "string" ? clipAttach(body.content) : (body.error ?? "이 파일은 글로 읽지 못합니다."));
    } catch {
      setPreviewContent("미리보기를 불러오지 못했습니다.");
    }
  }

  async function stageSelectedProjectFiles(paths: string[]) {
    if (!paths.length) return;
    setError(null);
    const items: StagedAttachment[] = [];
    for (const file of paths) {
      if (isChatImage(file)) {
        items.push(makeStagedProjectFile(file));
        continue;
      }
      const res = await fetch(`/api/source?alias=${encodeURIComponent(project)}&path=${encodeURIComponent(file)}`);
      const body = (await res.json()) as { content?: string; error?: string };
      if (!res.ok || typeof body.content !== "string") {
        setError(`${file}: 이 파일은 글로 읽지 못합니다.`);
        continue;
      }
      items.push(makeStagedProjectFile(file, body.content));
    }
    if (items.length) {
      stageItems(items);
      setSelectedFiles([]);
      setPlusOpen(false);
    }
  }

  function stageSelectedRules(ids: string[]) {
    if (!ruleList || !ids.length) return;
    const items = ruleList
      .filter((row) => ids.includes(`${row.kind}:${row.name}`))
      .map((row) => makeStagedRuleOrSkill(row));
    if (items.length) {
      stageItems(items);
      setSelectedRuleIds([]);
      setPlusOpen(false);
    }
  }

  function personLabel(member: RoomMember): string {
    if (member.speaker === "local") return member.model.trim() || ROOM_SPEAKER_LABEL.local;
    return member.model.trim() ? `${ROOM_SPEAKER_LABEL[member.speaker]} · ${member.model.trim()}` : ROOM_SPEAKER_LABEL[member.speaker];
  }

  const enabled = members.filter((member) => member.enabled !== false);
  const currentMode = room?.modeId ? modes.find((m) => m.id === room.modeId) ?? null : null;

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
    <div className={`thread room${room?.preparationStatus ? " is-prepared-room" : ""}`}>
      <div className="room-split">
        <div className="room-main">
          <div className="room-switch">
            {room?.running === true ? <span className="room-running" role="img" aria-label="이 방에서 LLM 실행 중" title="이 방에서 LLM 실행 중" /> : null}
            {roomId ? (
              <input
                aria-label="방 제목"
                disabled={readOnly}
                title={titleDraft}
                // 머리가 좁아 7글자가 넘으면 「...」로 — 눌러 고칠 때는 전체를 보인다.
                value={titleFocus ? titleDraft : shortLabel(titleDraft)}
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
                      className={`${row.id === roomId ? "is-on" : ""}${row.preparationStatus ? " is-prepared-room" : ""}`}
                      onClick={() => {
                        setQuickOpen(false);
                        setFace("chat");
                        show(row.id);
                      }}
                    >
                      <b>{row.running ? <span className="room-running" role="img" aria-label="LLM 실행 중" /> : null}{row.title}</b>
                      <small>{row.preparationStatus ? "미리 준비 · " : ""}{row.running ? "LLM 일하는 중 · " : ""}{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : ""}</small>
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
              {room?.preparationStatus ? <div className="prep-room-tabs" role="group" aria-label="준비 대화 보기"><button type="button" className={preparationView ? "is-on" : ""} aria-pressed={preparationView} onClick={() => setPreparationView(true)}>준비 결과</button><button type="button" className={!preparationView ? "is-on" : ""} aria-pressed={!preparationView} onClick={() => setPreparationView(false)}>대화 기록</button></div> : null}
              <div className="thread-body room-stage">
                {roomLoadError || roomsLoadError ? <p className="thread-err" role="alert">{roomLoadError ?? roomsLoadError} 현재 실행 상태를 확인할 수 없습니다. <button type="button" className="flow-btn" onClick={() => setTick(n => n + 1)}>다시 확인</button></p> : null}
                {room?.preparationWarning ? <p className="thread-note" role="status">{room.preparationWarning}</p> : null}
                {room?.preparationStatus && preparationView ? <TodoPreparationReview key={`${project}/${roomId}`} project={project} roomId={roomId} readOnly={readOnly || !!room?.kept} guided={guidedTodo} onDecision={onDismissAction} /> : <>
                {(!roomId || room) && !room?.messages.length && !room?.execution && !waiting ? (
                  <div className="msg room-welcome">안녕하세요. 무엇을 도와드릴까요?</div>
                ) : null}
                {room?.execution ? <RoomExecutionPanel showSetup={false} key={`${project}/${roomId}`} project={project} roomId={roomId} members={members}
                  execution={room?.execution ?? null} waiting={!!waiting} kept={kept} revision={revision}
                  guided={guidedTodo} onChanged={() => { setTick(n => n + 1); if (guidedTodo) onDismissAction?.(); }} onConsult={note => onConsult?.(note)} onAddMembers={() => setFace("llm")} /> : null}
                {room?.messages.map((m, i, all) => (
                  <RoomLine key={m.seq} message={m} project={project}
                    onAnswer={i === all.length - 1 && !readOnly && !kept && !waiting && !busy ? (text) => void send(text, enabled.length === 0 ? undefined : "talk", true) : undefined} />
                ))}
                {waiting ? <p className="thread-note">{room?.execution ? "테스트 실행 처리 중" : enabled.some((m) => m.speaker === "claude-code" || m.speaker === "codex") ? "답하는 중 · 고쳐 달라는 요청이면 직접 고치고 검사한다 (몇 분 걸릴 수 있다)" : "한 바퀴를 말하는 중"}</p> : null}
                <div ref={endRef} />
                </>}
              </div>
              {visibleGuide && (!waiting || visibleGuide.action.target.kind !== "todo") ? <UserActionGuide request={visibleGuide} onReturn={() => onReturnToAction?.()} onDismiss={() => onDismissAction?.()} /> : null}
              {room?.preparationStatus && preparationView ? <div className="room-compose"><p className="thread-note">준비 결과에서 산출물을 확인하고 승인·수정·보류할 수 있습니다. 준비 과정은 대화 기록에 남습니다.</p></div> : readOnly ? <div className="room-compose"><p className="thread-note">조회 전용 연결 · 대화와 실행 기록을 확인한다.</p></div> : room?.execution ? (
                <div className="room-compose"><p className="thread-note">테스트 실행은 위의 단계 버튼으로 이어간다. 요구사항 변경은 상담으로 보낸다.</p>{error ? <p className="thread-err">{error}</p> : null}</div>
              ) : (
                <div className="room-compose">
                  {room?.todo ? (
                    <div className="room-todo">
                      <span title={room.todo.title}>할일 · {room.todo.title}</span>
                      <button type="button" className="flow-btn" disabled={busy || !!waiting} onClick={() => void completeTodo()}>완료</button>
                    </div>
                  ) : null}
                  {staged.length > 0 ? (
                    <div className="room-staged-row" aria-label="첨부 대기 항목">
                      {staged.map((item) => (
                        <span key={item.id} className={`room-staged-chip is-${item.kind}`} title={item.title}>
                          {item.kind === "image" ? (
                            <img className="room-staged-thumb" src={item.href} alt="" />
                          ) : item.kind === "file" && item.isImage ? (
                            <img className="room-staged-thumb" src={projectFileHref(project, item.path)} alt="" />
                          ) : (
                            <i className="room-staged-badge">
                              {item.kind === "doc"
                                ? "문서"
                                : item.kind === "link"
                                  ? "링크"
                                  : item.kind === "file"
                                    ? "파일"
                                    : item.kind === "rule"
                                      ? "규칙"
                                      : "스킬"}
                            </i>
                          )}
                          <span className="room-staged-name">{item.title}</span>
                          <button
                            type="button"
                            className="room-staged-remove"
                            aria-label={`${item.title} 첨부 빼기`}
                            onClick={() => removeStaged(item.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {error ? <p className="thread-err">{error}</p> : null}
                  <textarea
                    aria-label="보낼 말"
                    className={guidedTodo && !waiting ? "user-action-pulse" : undefined}
                    rows={4}
                    value={draft}
                    disabled={waiting}
                    placeholder={staged.length > 0 ? "첨부한 자료와 함께 보낼 말을 적어 주세요 (비워 두고 바로 보낼 수도 있습니다)" : undefined}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={(e) => {
                      const files = Array.from(e.clipboardData?.files ?? []);
                      if (files.some((f) => isChatImage(f.name) || f.type.startsWith("image/"))) {
                        e.preventDefault();
                        void stageLocalFiles(
                          files.map((f, idx) =>
                            isChatImage(f.name) ? f : new File([f], `붙여넣은-이미지-${idx + 1}.png`, { type: f.type || "image/png" }),
                          ),
                        );
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(draft, "talk"); }
                    }}
                  />
                  <div className="room-compose-tools">
                  <div className="room-attach">
                    <button
                      type="button"
                      className={`room-plus${plusOpen || staged.length > 0 ? " is-on" : ""}`}
                      aria-label="첨부"
                      title="자료 · 파일 · 규칙/스킬 · 링크 추가"
                      disabled={attachingImage}
                      aria-pressed={plusOpen}
                      aria-expanded={plusOpen}
                      onClick={() => {
                        const next = !plusOpen;
                        setPlusOpen(next);
                        if (next) loadModalData(plusTab);
                      }}
                    >
                      <PlusIcon />
                    </button>
                    {plusOpen ? (
                      <RoomCenterDialog
                        title="대화 자료 · 맥락 추가"
                        subtitle="선택한 항목은 입력창 위에 담기며, 메시지와 함께 한 번에 전송됩니다."
                        className="room-attach-modal"
                        onClose={() => setPlusOpen(false)}
                      >
                        <div className="room-modal-tabs" role="tablist" aria-label="첨부 종류">
                          <button
                            type="button"
                            role="tab"
                            aria-selected={plusTab === "upload"}
                            className={`room-modal-tab${plusTab === "upload" ? " is-on" : ""}`}
                            onClick={() => { setPlusTab("upload"); loadModalData("upload"); }}
                          >
                            문서 · 사진
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={plusTab === "files"}
                            className={`room-modal-tab${plusTab === "files" ? " is-on" : ""}`}
                            onClick={() => { setPlusTab("files"); loadModalData("files"); }}
                          >
                            프로젝트 파일
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={plusTab === "rules"}
                            className={`room-modal-tab${plusTab === "rules" ? " is-on" : ""}`}
                            onClick={() => { setPlusTab("rules"); loadModalData("rules"); }}
                          >
                            규칙 · 스킬
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={plusTab === "link"}
                            className={`room-modal-tab${plusTab === "link" ? " is-on" : ""}`}
                            onClick={() => { setPlusTab("link"); loadModalData("link"); }}
                          >
                            웹 링크
                          </button>
                        </div>

                        {plusTab === "upload" ? (
                          <div
                            className={`room-dropzone${dragOver ? " is-dragover" : ""}`}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={(e) => {
                              e.preventDefault();
                              setDragOver(false);
                              if (e.dataTransfer?.files?.length) void stageLocalFiles(e.dataTransfer.files);
                            }}
                          >
                            <div className="room-dropzone-body">
                              <b>컴퓨터에서 문서나 사진을 끌어다 놓거나 선택하세요</b>
                              <p>지원 형식: 텍스트 · 마크다운 · JSON · YAML · CSV · 이미지(PNG, JPG, GIF, WEBP, SVG · 최대 10MB)</p>
                              <button
                                type="button"
                                className="flow-btn primary"
                                disabled={busy || waiting || attachingImage}
                                onClick={() => docRef.current?.click()}
                              >
                                {attachingImage ? "사진 올리는 중…" : "파일 · 사진 선택하기"}
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {plusTab === "files" ? (
                          <div className="room-modal-section">
                            <div className="room-modal-search-bar">
                              <input
                                aria-label="파일 경로"
                                value={fileQuery}
                                placeholder="파일 이름이나 폴더 경로로 검색 (예: RoomPanel, 기획, .md)"
                                onChange={(e) => setFileQuery(e.target.value)}
                              />
                              {selectedFiles.length > 0 ? (
                                <span className="room-modal-count">{selectedFiles.length}개 선택됨</span>
                              ) : null}
                            </div>
                            <div className="room-file-picker-split">
                              <ul className="room-modal-list" aria-label="프로젝트 파일 목록">
                                {projectFiles === null ? (
                                  <li className="room-modal-empty">파일 목록을 불러오는 중…</li>
                                ) : filterProjectFiles(projectFiles, fileQuery).length === 0 ? (
                                  <li className="room-modal-empty">조건에 맞는 프로젝트 파일이 없습니다.</li>
                                ) : (
                                  filterProjectFiles(projectFiles, fileQuery).map((file) => {
                                    const checked = selectedFiles.includes(file);
                                    const parts = file.split("/");
                                    const base = parts.pop() ?? file;
                                    const dir = parts.join("/");
                                    return (
                                      <li key={file} className={`room-modal-item${checked ? " is-selected" : ""}${previewPath === file ? " is-previewing" : ""}`}>
                                        <label className="room-modal-check">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() =>
                                              setSelectedFiles((cur) => (checked ? cur.filter((x) => x !== file) : [...cur, file]))
                                            }
                                          />
                                          <span className="room-modal-item-text">
                                            <b>{base}</b>
                                            {dir ? <small>{dir}</small> : <small>루트 폴더</small>}
                                          </span>
                                        </label>
                                        <div className="room-modal-item-actions">
                                          <button type="button" className="flow-btn" onClick={() => void previewProjectFile(file)}>
                                            미리보기
                                          </button>
                                          <button type="button" className="flow-btn primary" onClick={() => void stageSelectedProjectFiles([file])}>
                                            담기
                                          </button>
                                        </div>
                                      </li>
                                    );
                                  })
                                )}
                              </ul>
                              {previewPath ? (
                                <aside className="room-file-preview" aria-label="파일 미리보기">
                                  <header>
                                    <b>{previewPath}</b>
                                    <button type="button" className="flow-btn" onClick={() => { setPreviewPath(null); setPreviewContent(null); }}>
                                      닫기
                                    </button>
                                  </header>
                                  {isChatImage(previewPath) ? (
                                    <img src={projectFileHref(project, previewPath)} alt={previewPath} className="room-preview-img" />
                                  ) : (
                                    <pre>{previewContent ?? "불러오는 중…"}</pre>
                                  )}
                                </aside>
                              ) : null}
                            </div>
                            <footer className="room-modal-footer">
                              <small>원하는 파일을 여러 개 체크한 뒤 한 번에 담거나, 오른쪽 「담기」를 누르세요.</small>
                              <div className="room-modal-footer-actions">
                                <button type="button" className="flow-btn" onClick={() => setPlusOpen(false)}>
                                  취소
                                </button>
                                <button
                                  type="button"
                                  className="flow-btn primary"
                                  disabled={selectedFiles.length === 0}
                                  onClick={() => void stageSelectedProjectFiles(selectedFiles)}
                                >
                                  선택한 파일 담기 ({selectedFiles.length})
                                </button>
                              </div>
                            </footer>
                          </div>
                        ) : null}

                        {plusTab === "rules" ? (
                          <div className="room-modal-section">
                            <div className="room-modal-search-bar">
                              <input
                                aria-label="규칙 또는 스킬 검색"
                                value={ruleQuery}
                                placeholder="규칙 · 스킬 이름이나 설명으로 검색 (예: task-clarity, briefing, intent)"
                                onChange={(e) => setRuleQuery(e.target.value)}
                              />
                              <div className="room-filter-pills" role="group" aria-label="종류 필터">
                                {(["all", "규칙", "스킬"] as const).map((kind) => (
                                  <button
                                    key={kind}
                                    type="button"
                                    className={`room-filter-pill${ruleFilter === kind ? " is-on" : ""}`}
                                    aria-pressed={ruleFilter === kind}
                                    onClick={() => setRuleFilter(kind)}
                                  >
                                    {kind === "all" ? "전체" : kind}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <ul className="room-modal-list is-cards" aria-label="규칙 · 스킬 목록">
                              {ruleList === null ? (
                                <li className="room-modal-empty">규칙 · 스킬 목록을 불러오는 중…</li>
                              ) : filterRulesAndSkills(ruleList, ruleQuery, ruleFilter).length === 0 ? (
                                <li className="room-modal-empty">저장된 규칙 · 스킬이 없습니다.</li>
                              ) : (
                                filterRulesAndSkills(ruleList, ruleQuery, ruleFilter).map((row) => {
                                  const key = `${row.kind}:${row.name}`;
                                  const checked = selectedRuleIds.includes(key);
                                  return (
                                    <li key={key} className={`room-modal-card-item${checked ? " is-selected" : ""}`}>
                                      <label className="room-modal-check">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() =>
                                            setSelectedRuleIds((cur) => (checked ? cur.filter((x) => x !== key) : [...cur, key]))
                                          }
                                        />
                                        <span className="room-modal-item-text">
                                          <span className="room-modal-title-row">
                                            <span className={`room-badge is-${row.kind === "규칙" ? "rule" : "skill"}`}>{row.kind}</span>
                                            <b>{row.name}</b>
                                            {row.apply === "always" ? <span className="room-badge is-subtle">항상 적용</span> : null}
                                            {row.scope === "studio" ? <span className="room-badge is-subtle">공용</span> : null}
                                          </span>
                                          <small>{row.description || "설명이 등록되지 않았습니다."}</small>
                                        </span>
                                      </label>
                                      <button
                                        type="button"
                                        className="flow-btn primary"
                                        onClick={() => {
                                          stageItems([makeStagedRuleOrSkill(row)]);
                                          setPlusOpen(false);
                                        }}
                                      >
                                        담기
                                      </button>
                                    </li>
                                  );
                                })
                              )}
                            </ul>
                            <footer className="room-modal-footer">
                              <small>규칙 · 스킬을 담고 메시지를 보내면 서버가 해당 본문을 프롬프트에 함께 넣어 전달합니다.</small>
                              <div className="room-modal-footer-actions">
                                <button type="button" className="flow-btn" onClick={() => setPlusOpen(false)}>
                                  취소
                                </button>
                                <button
                                  type="button"
                                  className="flow-btn primary"
                                  disabled={selectedRuleIds.length === 0}
                                  onClick={() => stageSelectedRules(selectedRuleIds)}
                                >
                                  선택한 항목 담기 ({selectedRuleIds.length})
                                </button>
                              </div>
                            </footer>
                          </div>
                        ) : null}

                        {plusTab === "link" ? (
                          <form
                            className="room-modal-section room-link-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const built = makeStagedLink(linkDraft);
                              if (!built.ok) {
                                setError(built.error);
                                return;
                              }
                              setError(null);
                              stageItems([built.item]);
                              setLinkDraft("");
                              setPlusOpen(false);
                            }}
                          >
                            <label className="room-link-field">
                              <span>참고할 웹 주소 (URL)</span>
                              <input
                                aria-label="링크"
                                value={linkDraft}
                                placeholder="https://example.com/docs/..."
                                onChange={(e) => setLinkDraft(e.target.value)}
                              />
                            </label>
                            <p className="thread-note">문서 주소나 참고 링크를 입력창에 담아 메시지와 함께 전달합니다.</p>
                            <footer className="room-modal-footer">
                              <span />
                              <div className="room-modal-footer-actions">
                                <button type="button" className="flow-btn" onClick={() => setPlusOpen(false)}>
                                  취소
                                </button>
                                <button type="submit" className="flow-btn primary" disabled={!linkDraft.trim()}>
                                  링크 담기
                                </button>
                              </div>
                            </footer>
                          </form>
                        ) : null}
                      </RoomCenterDialog>
                    ) : null}
                    <input ref={docRef} type="file" multiple accept=".txt,.md,.json,.csv,.yaml,.yml,text/plain,.png,.jpg,.jpeg,.gif,.webp,.svg" hidden onChange={(e) => void onPickedFile(e)} />
                  </div>
                  <div className="room-call-actions">
                    <button type="button" className="flow-btn room-send" disabled={busy || waiting || attachingImage || !!roomLoadError || (!draft.trim() && staged.length === 0)} onClick={() => void send(draft)}>Record</button>
                    <button type="button" className="flow-btn room-stop" disabled={room?.running !== true} onClick={() => void stopTurn()}>Stop</button>
                    {/* 보내기는 맨 오른쪽 (사용자 요청 2026-10-16) */}
                    <button type="button" className="flow-btn primary room-submit" disabled={busy || waiting || attachingImage || !!roomLoadError || (enabled.length === 0 && !draft.trim() && staged.length === 0)} onClick={() => void (enabled.length === 0 ? send(draft) : send(draft, "talk"))}>Send</button>
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
                    onClick={() => {
                      setLlmTab("agent");
                      setFace("llm");
                    }}
                  >
                    {chipFace(member)}
                  </button>
                ))}
                {currentMode ? (
                  <>
                    {enabled.length > 0 ? <span className="room-dock-sep" aria-hidden="true" /> : null}
                    <button
                      type="button"
                      className="room-chip is-mode-chip"
                      style={modeStyle(currentMode)}
                      aria-label={`현재 모드 ${currentMode.name} 해제`}
                      title={`${currentMode.name} (${MODE_EXEC_LABEL[currentMode.execution]}) · 누르면 해제`}
                      disabled={kept || !!waiting}
                      onClick={() => void selectMode(null)}
                    >
                      {modeFace(currentMode)}
                    </button>
                  </>
                ) : null}
                <div className="room-dock-controls">
                  <span className="room-dock-add">
                    <button type="button" className="room-plus is-add" aria-label="LLM 추가" title="참여 LLM 선택 · 관리" aria-expanded={dockOpen} onClick={() => {
                      if (!dockOpen) void refreshAgents();
                      setModeMenuOpen(false);
                      setDockOpen((cur) => !cur);
                    }}>
                      <PlusIcon />
                    </button>
                    {dockOpen ? (
                      <RoomCenterDialog
                        title="이 대화의 참여 LLM 선택"
                        subtitle="켜 둔 순서대로 한 바퀴씩 말하거나 작업을 수행합니다."
                        className="room-agent-modal"
                        onClose={() => setDockOpen(false)}
                      >
                        <div className="room-modal-search-bar">
                          <input
                            aria-label="LLM 검색"
                            value={agentQuery}
                            placeholder="이름 · 공급자 · 모델 · 역할로 검색"
                            onChange={(e) => setAgentQuery(e.target.value)}
                          />
                          <span className="room-modal-count">활성 {enabled.length}명</span>
                        </div>
                        <ul className="room-modal-list is-cards" aria-label="등록된 LLM 목록">
                          {agents.length === 0 ? (
                            <li className="room-modal-empty">등록된 Agent가 없습니다. 아래 「새 Agent 등록」으로 추가해 주세요.</li>
                          ) : (
                            agents
                              .filter((agent) => {
                                const q = agentQuery.trim().toLowerCase();
                                if (!q) return true;
                                const hay = `${agent.name ?? ""} ${ROOM_SPEAKER_LABEL[agent.speaker]} ${agent.model} ${agent.role}`.toLowerCase();
                                return hay.includes(q);
                              })
                              .map((agent) => {
                                const at = members.findIndex((member) => member.id === agent.id || sameAgent(member, agent));
                                const on = at >= 0 && members[at]!.enabled !== false;
                                return (
                                  <li key={agent.id ?? `${agent.speaker}-${agent.model}-${agent.name}`} className={`room-modal-card-item${on ? " is-selected" : ""}`}>
                                    <button
                                      type="button"
                                      role="menuitemcheckbox"
                                      aria-checked={on}
                                      className="room-dock-agent room-modal-agent-btn"
                                      disabled={kept || !!waiting}
                                      onClick={() => {
                                        if (at < 0) void cast([...members, { ...agent, enabled: true }]);
                                        else patchMember(at, { enabled: !on }, true);
                                      }}
                                    >
                                      <span className="room-chip" style={chipStyle(agent)}>{chipFace(agent)}</span>
                                      <span className="room-modal-item-text">
                                        <span className="room-modal-title-row">
                                          <b>{agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker]}</b>
                                          <span className="room-badge is-subtle">{ROOM_SPEAKER_LABEL[agent.speaker]}{agent.model ? ` · ${agent.model}` : ""}{agent.effort ? ` · ${agent.effort}` : ""}</span>
                                        </span>
                                        <small>{agent.role.trim() || "역할 설명 없음"}</small>
                                      </span>
                                      <span className={`room-icon room-power${on ? " is-on" : ""}`} aria-hidden="true"><PowerIcon /></span>
                                    </button>
                                  </li>
                                );
                              })
                          )}
                        </ul>
                        <footer className="room-modal-footer">
                          <button
                            type="button"
                            className="flow-btn"
                            onClick={() => {
                              setDockOpen(false);
                              setLlmTab("agent");
                              setFace("llm");
                            }}
                          >
                            새 Agent 등록 · 상세 설정
                          </button>
                          <div className="room-modal-footer-actions">
                            <button type="button" className="flow-btn primary" onClick={() => setDockOpen(false)}>
                              확인
                            </button>
                          </div>
                        </footer>
                      </RoomCenterDialog>
                    ) : null}
                  </span>
                  <span className="room-dock-mode">
                    <button
                      type="button"
                      className={`room-plus is-mode${currentMode ? " is-active" : ""}`}
                      style={currentMode ? { background: currentMode.color ?? CHIP_DEFAULT_COLOR, borderColor: currentMode.color ?? CHIP_DEFAULT_COLOR, color: "#fff" } : undefined}
                      aria-label="모드"
                      aria-expanded={modeMenuOpen}
                      title={currentMode ? `모드 · ${currentMode.name} (${MODE_EXEC_LABEL[currentMode.execution]})` : "모드"}
                      onClick={() => {
                        if (!modeMenuOpen) {
                          void refreshModes();
                          void refreshAgents();
                        }
                        setDockOpen(false);
                        setModeMenuOpen((cur) => !cur);
                      }}
                    >
                      {currentMode ? modeFace(currentMode) : <ModeTriggerIcon />}
                    </button>
                    {modeMenuOpen ? (
                      <RoomCenterDialog
                        title="대화 작업 모드 선택"
                        subtitle="모드를 고르면 권한(읽기·문서·실행)과 규약, 지정된 LLM 조합이 함께 적용됩니다."
                        className="room-mode-modal"
                        onClose={() => setModeMenuOpen(false)}
                      >
                        <div className="room-modal-search-bar">
                          <input
                            aria-label="모드 검색"
                            value={modeQuery}
                            placeholder="모드 이름이나 규약으로 검색"
                            onChange={(e) => setModeQuery(e.target.value)}
                          />
                          {currentMode ? (
                            <button type="button" className="flow-btn" disabled={kept || !!waiting} onClick={() => void selectMode(null)}>
                              모드 해제 ({currentMode.name})
                            </button>
                          ) : null}
                        </div>
                        <ul className="room-modal-list is-cards" aria-label="모드 목록">
                          {modes
                            .filter((mode) => {
                              const q = modeQuery.trim().toLowerCase();
                              if (!q) return true;
                              return `${mode.name} ${mode.prompt}`.toLowerCase().includes(q);
                            })
                            .map((mode) => {
                              const on = room?.modeId === mode.id;
                              const bound = (mode.agentIds ?? [])
                                .map((id) => agents.find((a) => a.id === id) ?? members.find((m) => m.id === id))
                                .filter((a): a is RoomMember => Boolean(a))
                                .map((a) => a.name?.trim() || ROOM_SPEAKER_LABEL[a.speaker])
                                .join(" → ");
                              return (
                                <li key={mode.id} className={`room-modal-card-item${on ? " is-selected" : ""}`}>
                                  <button
                                    type="button"
                                    role="menuitemcheckbox"
                                    aria-checked={on}
                                    className={`room-dock-agent room-dock-mode-item room-modal-agent-btn${on ? " is-on" : ""}`}
                                    disabled={kept || !!waiting}
                                    onClick={() => {
                                      void selectMode(on ? null : mode.id);
                                      setModeMenuOpen(false);
                                    }}
                                  >
                                    <span className="room-chip" style={modeStyle(mode)}>{modeFace(mode)}</span>
                                    <span className="room-mode-item-body room-modal-item-text">
                                      <span className="room-modal-title-row">
                                        <b>{mode.name}</b>
                                        <span className={`room-mode-exec is-${mode.execution}`}>{MODE_EXEC_LABEL[mode.execution]}</span>
                                      </span>
                                      <small>참여 LLM: {bound || "현재 대화방에 켜진 LLM 유지"}</small>
                                      {mode.prompt.trim() ? <small className="room-mode-prompt-preview">{mode.prompt.trim()}</small> : null}
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                        </ul>
                        <footer className="room-modal-footer">
                          <button
                            type="button"
                            className="flow-btn"
                            onClick={() => {
                              setModeMenuOpen(false);
                              setLlmTab("mode");
                              setFace("llm");
                            }}
                          >
                            새 모드 추가 · 편집
                          </button>
                          <div className="room-modal-footer-actions">
                            <button type="button" className="flow-btn primary" onClick={() => setModeMenuOpen(false)}>
                              닫기
                            </button>
                          </div>
                        </footer>
                      </RoomCenterDialog>
                    ) : null}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <LlmFace
              hosts={hosts}
              members={members}
              agents={agents}
              modes={modes}
              activeModeId={room?.modeId ?? null}
              tab={llmTab}
              messages={room?.messages ?? []}
              localId={localId}
              kept={kept}
              waiting={!!waiting || !!room?.execution && !["done", "failed", "consult"].includes(room.execution.phase)}
              onTab={setLlmTab}
              onLocalId={setLocalId}
              onPatch={patchMember}
              onRemove={(index) => void cast(members.filter((_, i) => i !== index))}
              onAddAgent={(agent) => void saveAgents((fresh) => [...fresh, agent])}
              onAddMode={(mode) => void saveModes((fresh) => [...fresh, mode])}
              onPatchMode={(id, patch) => void saveModes((fresh) => fresh.map((row) => (row.id === id ? { ...row, ...patch } : row)))}
              onRemoveMode={(id) => {
                if (room?.modeId === id) void selectMode(null);
                void saveModes((fresh) => fresh.filter((row) => row.id !== id));
              }}
              onSelectMode={(id) => void selectMode(room?.modeId === id ? null : id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RoomLine({ message: m, project, onAnswer }: { message: RoomMessage; project: string; onAnswer?: (text: string) => void }) {
  if (m.role === "operation") return <div className={`msg is-operation is-${m.status}`}>
    <span className="msg-meta">{{ consult: "상담 연결", prepare: "실행 배정", act: "수행", check: "검증", deploy: "적용" }[m.stage]} · {{ started: "시작", completed: "완료", failed: "실패", waiting: "대기" }[m.status]}</span>
    <ChatText text={m.text} project={project} />{m.result !== undefined ? <details><summary>실행 근거</summary><pre>{JSON.stringify(m.result, null, 2)}</pre></details> : null}
  </div>;
  if (m.role === "memory") {
    return (
      <div className="msg is-memory">
        <span className="msg-meta">맥락 · 이전 기록</span>
        <ChatText text={m.text} project={project} />
      </div>
    );
  }
  if (m.role === "user") {
    const to = m.to ? ` → ${ROOM_SPEAKER_LABEL[m.to]}${m.model ? ` · ${m.model}` : ""}` : "";
    return (
      <div className="msg is-user">
        <span className="msg-meta">
          나{to}{m.via === "claude-session" ? " · Claude Code 세션에서" : ""}
          {m.modeName || m.modeIcon ? (
            <span
              className="room-msg-mode"
              style={{ background: m.modeColor ?? CHIP_DEFAULT_COLOR }}
              title={m.modeName ? `모드 · ${m.modeName}` : "모드"}
              aria-label={m.modeName ? `모드 ${m.modeName}` : "모드"}
            >
              <ModeIcon icon={m.modeIcon} />
            </span>
          ) : null}
        </span>
        <ChatText text={m.text} project={project} />
      </div>
    );
  }
  if (m.role === "system") {
    return (
      <div className={`msg is-system${m.kind === "done" ? " is-done" : ""}`}>
        <ChatText text={m.text} project={project} />
        {m.kind === "done" && m.next ? <a className="msg-next" href={`#room/${encodeURIComponent(project)}/${encodeURIComponent(m.next.roomId)}`}>다음 할일 대화 열기 →</a> : null}
      </div>
    );
  }
  const name = m.speaker === "local" && m.model ? m.model : ROOM_SPEAKER_LABEL[m.speaker];
  const asked = splitQuestions(m.text);
  return (
    <div className="msg is-host">
      <span className="msg-meta">
        {name}
        {m.speaker !== "local" && m.model ? ` · ${m.model}` : ""}{m.effort ? ` · ${m.effort}` : ""}{m.via === "claude-session" ? " · Claude Code 세션" : ""} · {(m.ms / 1000).toFixed(1)}초
      </span>
      {asked.text ? <ChatText text={asked.text} project={project} bold /> : null}
      {asked.questions.length ? <RoomQuestionCard key={m.seq} questions={asked.questions} onAnswer={onAnswer} /> : null}
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
  agents,
  modes,
  activeModeId,
  tab,
  messages,
  localId,
  kept,
  waiting,
  onTab,
  onLocalId,
  onPatch,
  onRemove,
  onAddAgent,
  onAddMode,
  onPatchMode,
  onRemoveMode,
  onSelectMode,
}: {
  hosts: HostRow[];
  members: RoomMember[];
  agents: RoomMember[];
  modes: RoomMode[];
  activeModeId: string | null;
  tab: "agent" | "mode";
  messages: RoomMessage[];
  localId: string;
  kept: boolean;
  waiting: boolean;
  onTab: (tab: "agent" | "mode") => void;
  onLocalId: (value: string) => void;
  onPatch: (index: number, patch: Partial<RoomMember>, save?: boolean) => void;
  onRemove: (index: number) => void;
  onAddAgent: (agent: RoomMember) => void;
  onAddMode: (mode: RoomMode) => void;
  onPatchMode: (id: string, patch: Partial<RoomMode>) => void;
  onRemoveMode: (id: string) => void;
  onSelectMode: (id: string) => void;
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

  const [modeName, setModeName] = useState("");
  const [modeIcon, setModeIcon] = useState<RoomModeIcon>("discuss");
  const [modeColor, setModeColor] = useState("#6d5efc");
  const [modeImage, setModeImage] = useState("");
  const [modeIconHtml, setModeIconHtml] = useState("");
  const [modeExec, setModeExec] = useState<RoomModeExecution>("read");
  const [modeAgents, setModeAgents] = useState<string[]>([]);
  const [modePrompt, setModePrompt] = useState("");
  const [modeError, setModeError] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<string | null>(null);
  const [editModeId, setEditModeId] = useState<string | null>(null);

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

  function resetModeForm() {
    setModeName("");
    setModeIcon("discuss");
    setModeColor("#6d5efc");
    setModeImage("");
    setModeIconHtml("");
    setModeExec("read");
    setModeAgents([]);
    setModePrompt("");
    setModeError(null);
  }

  const locked = kept || waiting;
  const host = hosts.find((row) => row.speaker === speaker);
  const previewMode: RoomMode = {
    id: "preview",
    name: modeName || "모드",
    icon: modeIcon,
    color: modeColor,
    execution: modeExec,
    prompt: modePrompt,
    ...(modeImage ? { image: modeImage } : {}),
    ...(modeIconHtml ? { iconHtml: modeIconHtml } : {}),
  };

  return (
    <div className="room-llm">
      <div className="room-call-pin">
        <section className="room-call is-new">
          <div className="room-call-tabs" role="tablist" aria-label="호출 또는 모드 추가">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agent"}
              className={`room-call-tab${tab === "agent" ? " is-on" : ""}`}
              onClick={() => onTab("agent")}
            >
              LLM 호출
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mode"}
              className={`room-call-tab${tab === "mode" ? " is-on" : ""}`}
              onClick={() => onTab("mode")}
            >
              모드 추가
            </button>
          </div>
          {tab === "agent" ? (
            <>
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
            </>
          ) : (
            <>
              <div className="room-pair">
                <label>
                  모드 이름
                  <input aria-label="새 모드 이름" value={modeName} disabled={locked} placeholder="예: 플래닝 · 아키텍처 점검" onChange={(e) => setModeName(e.target.value)} />
                </label>
                <label>
                  아이콘 색
                  <span className="room-color">
                    <input type="color" aria-label="새 모드 아이콘 색" value={modeColor} disabled={locked} onChange={(e) => setModeColor(e.target.value)} />
                    <span className="room-chip" style={modeStyle(previewMode)}>{modeFace(previewMode)}</span>
                  </span>
                </label>
              </div>
              <div className="room-pair">
                <label>
                  모드 아이콘
                  <div className="room-icon-grid" role="group" aria-label="모드 아이콘 선택">
                    {ROOM_MODE_ICONS.map((iconKey) => (
                      <button
                        key={iconKey}
                        type="button"
                        className={`room-icon-pick-btn${modeIcon === iconKey ? " is-on" : ""}`}
                        aria-label={MODE_ICON_LABEL[iconKey]}
                        aria-pressed={modeIcon === iconKey}
                        title={MODE_ICON_LABEL[iconKey]}
                        disabled={locked}
                        onClick={() => setModeIcon(iconKey)}
                      >
                        <ModeIcon icon={iconKey} />
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  작업 권한
                  <select aria-label="새 모드 작업 권한" value={modeExec} disabled={locked} onChange={(e) => setModeExec(e.target.value as RoomModeExecution)}>
                    <option value="read">읽기 · 분석/토의</option>
                    <option value="edit">수정 · 문서/파일 작성</option>
                    <option value="apply">실행 · 수정 + 검증</option>
                  </select>
                </label>
              </div>
              <label>
                아이콘 이미지 (선택)
                <IconPick image={modeImage} iconHtml={modeIconHtml} disabled={locked} onChange={(patch) => { setModeImage(patch.image ?? ""); setModeIconHtml(patch.iconHtml ?? ""); }} onError={setModeError} />
              </label>
              <label>
                참여 LLM 조합 (선택 · 비우면 현재 대화방에 켜진 LLM 유지)
                <div className="room-agent-picks" role="group" aria-label="모드 참여 LLM">
                  {agents.map((agent) => {
                    const aid = agent.id ?? "";
                    if (!aid) return null;
                    const order = modeAgents.indexOf(aid);
                    const picked = order >= 0;
                    return (
                      <button
                        key={aid}
                        type="button"
                        className={`room-agent-pick${picked ? " is-on" : ""}`}
                        aria-pressed={picked}
                        disabled={locked}
                        onClick={() => setModeAgents((cur) => (picked ? cur.filter((id) => id !== aid) : [...cur, aid]))}
                      >
                        <span className="room-chip" style={chipStyle(agent)}>{chipFace(agent)}</span>
                        <span>{agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker]}</span>
                        {picked ? <small className="room-agent-order">{order + 1}</small> : null}
                      </button>
                    );
                  })}
                </div>
              </label>
              {modeError ? <p className="thread-err">{modeError}</p> : null}
              <label>
                모드 규약 (절차 · 산출물 형식)
                <textarea aria-label="새 모드 규약" rows={3} value={modePrompt} disabled={locked} placeholder="참여 LLM들이 따를 진행 순서와 출력 형식" onChange={(e) => setModePrompt(e.target.value)} />
              </label>
              <RoleAttach disabled={locked} onText={(block) => setModePrompt((cur) => joinRole(cur, block))} />
              <button
                type="button"
                className="flow-btn primary"
                disabled={locked || !modeName.trim()}
                onClick={() => {
                  const problem = iconProblem({ image: modeImage, iconHtml: modeIconHtml });
                  if (problem) { setModeError(problem); return; }
                  setModeError(null);
                  const id = `mode-${Date.now().toString(36)}`;
                  onAddMode({
                    id,
                    name: modeName.trim(),
                    icon: modeIcon,
                    color: modeColor,
                    execution: modeExec,
                    prompt: modePrompt,
                    ...(modeAgents.length ? { agentIds: modeAgents } : {}),
                    ...(modeImage ? { image: modeImage } : {}),
                    ...(modeIconHtml.trim() ? { iconHtml: modeIconHtml } : {}),
                  });
                  resetModeForm();
                }}
              >
                모드 목록에 등록
              </button>
            </>
          )}
        </section>
      </div>
      {tab === "agent" ? (
        <>
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
        </>
      ) : (
        <>
          <h3 className="room-roles-title">등록된 모드</h3>
          <div className="room-roles">
            {modes.map((mode) => {
              const isOn = activeModeId === mode.id;
              const shown = openMode === mode.id;
              const boundNames = (mode.agentIds ?? [])
                .map((id) => agents.find((a) => a.id === id) ?? members.find((m) => m.id === id))
                .filter((a): a is RoomMember => Boolean(a))
                .map((a) => a.name?.trim() || ROOM_SPEAKER_LABEL[a.speaker])
                .join(" → ");
              return (
                <section className={`room-role${isOn ? "" : " is-off"}`} key={mode.id}>
                  <span className="room-chip" style={modeStyle(mode)}>{modeFace(mode)}</span>
                  <b>{mode.name}</b>
                  <span className={`room-mode-exec is-${mode.execution}`}>{MODE_EXEC_LABEL[mode.execution]}</span>
                  <button
                    type="button"
                    className={`room-icon room-power${isOn ? " is-on" : ""}`}
                    title={isOn ? "이 대화에서 사용 중 · 누르면 해제" : "이 대화의 모드로 선택"}
                    aria-label={`${mode.name} 모드 켜기`}
                    aria-pressed={isOn}
                    disabled={locked}
                    onClick={() => onSelectMode(mode.id)}
                  >
                    <PowerIcon />
                  </button>
                  <button
                    type="button"
                    className={`room-icon${shown ? " is-on" : ""}`}
                    aria-label="세부 내용"
                    aria-expanded={shown}
                    onClick={() => setOpenMode(shown ? null : mode.id)}
                  >
                    <DetailIcon />
                  </button>
                  {shown ? (
                    <div className="room-role-body">
                      {editModeId === mode.id ? (
                        <ModeEditor
                          mode={mode}
                          agents={agents}
                          disabled={locked}
                          onCancel={() => setEditModeId(null)}
                          onSave={(patch) => {
                            onPatchMode(mode.id, patch);
                            setEditModeId(null);
                          }}
                        />
                      ) : (
                        <dl>
                          <div><dt>권한</dt><dd>{MODE_EXEC_LABEL[mode.execution]}</dd></div>
                          <div><dt>참여 LLM</dt><dd>{boundNames || "현재 대화방에 켜진 LLM 유지"}</dd></div>
                          <div><dt>규약</dt><dd className="room-role-text">{mode.prompt.trim() || "없음"}</dd></div>
                        </dl>
                      )}
                      <div className="room-role-actions">
                        <button type="button" className="flow-btn" disabled={locked || editModeId === mode.id} onClick={() => setEditModeId(mode.id)}>
                          수정
                        </button>
                        <button type="button" className="flow-btn" disabled={locked} onClick={() => onRemoveMode(mode.id)}>
                          빼기
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ModeEditor({
  mode,
  agents,
  disabled,
  onSave,
  onCancel,
}: {
  mode: RoomMode;
  agents: RoomMember[];
  disabled: boolean;
  onSave: (patch: Partial<RoomMode>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RoomMode>(mode);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<RoomMode>) => setDraft((cur) => ({ ...cur, ...patch }));
  const pickedIds = draft.agentIds ?? [];
  return (
    <div className="room-member-edit">
      <div className="room-pair">
        <label>
          모드 이름
          <input aria-label={`${mode.name} 모드 이름`} value={draft.name} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          아이콘 색
          <span className="room-color">
            <input type="color" aria-label={`${mode.name} 아이콘 색`} value={draft.color ?? CHIP_DEFAULT_COLOR} disabled={disabled} onChange={(e) => set({ color: e.target.value })} />
            <span className="room-chip" style={modeStyle(draft)}>{modeFace(draft)}</span>
          </span>
        </label>
      </div>
      <div className="room-pair">
        <label>
          모드 아이콘
          <div className="room-icon-grid" role="group" aria-label={`${mode.name} 아이콘`}>
            {ROOM_MODE_ICONS.map((iconKey) => (
              <button
                key={iconKey}
                type="button"
                className={`room-icon-pick-btn${(draft.icon ?? "discuss") === iconKey ? " is-on" : ""}`}
                aria-label={MODE_ICON_LABEL[iconKey]}
                aria-pressed={(draft.icon ?? "discuss") === iconKey}
                disabled={disabled}
                onClick={() => set({ icon: iconKey })}
              >
                <ModeIcon icon={iconKey} />
              </button>
            ))}
          </div>
        </label>
        <label>
          작업 권한
          <select aria-label={`${mode.name} 작업 권한`} value={draft.execution} disabled={disabled} onChange={(e) => set({ execution: e.target.value as RoomModeExecution })}>
            <option value="read">읽기 · 분석/토의</option>
            <option value="edit">수정 · 문서/파일 작성</option>
            <option value="apply">실행 · 수정 + 검증</option>
          </select>
        </label>
      </div>
      <label>
        아이콘 이미지
        <IconPick image={draft.image ?? ""} iconHtml={draft.iconHtml ?? ""} disabled={disabled} onChange={(patch) => set({ image: patch.image || undefined, iconHtml: patch.iconHtml || undefined })} onError={setProblem} />
      </label>
      <label>
        참여 LLM 조합
        <div className="room-agent-picks" role="group" aria-label={`${mode.name} 참여 LLM`}>
          {agents.map((agent) => {
            const aid = agent.id ?? "";
            if (!aid) return null;
            const order = pickedIds.indexOf(aid);
            const picked = order >= 0;
            return (
              <button
                key={aid}
                type="button"
                className={`room-agent-pick${picked ? " is-on" : ""}`}
                aria-pressed={picked}
                disabled={disabled}
                onClick={() => set({ agentIds: picked ? pickedIds.filter((id) => id !== aid) : [...pickedIds, aid] })}
              >
                <span className="room-chip" style={chipStyle(agent)}>{chipFace(agent)}</span>
                <span>{agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker]}</span>
                {picked ? <small className="room-agent-order">{order + 1}</small> : null}
              </button>
            );
          })}
        </div>
      </label>
      <label>
        모드 규약
        <textarea aria-label={`${mode.name} 모드 규약`} rows={4} value={draft.prompt} disabled={disabled} onChange={(e) => set({ prompt: e.target.value })} />
      </label>
      <RoleAttach disabled={disabled} onText={(block) => set({ prompt: joinRole(draft.prompt, block) })} />
      {problem ? <p className="thread-err">{problem}</p> : null}
      <div className="room-role-actions">
        <button
          type="button"
          className="flow-btn primary"
          disabled={disabled || !draft.name.trim()}
          onClick={() => {
            const found = iconProblem({ image: draft.image, iconHtml: draft.iconHtml });
            if (found) { setProblem(found); return; }
            onSave({
              name: draft.name.trim(),
              icon: draft.icon,
              color: draft.color,
              execution: draft.execution,
              prompt: draft.prompt,
              agentIds: draft.agentIds?.length ? draft.agentIds : undefined,
              image: draft.image || undefined,
              iconHtml: draft.iconHtml?.trim() ? draft.iconHtml : undefined,
            });
          }}
        >
          저장
        </button>
        <button type="button" className="flow-btn" onClick={onCancel}>취소</button>
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
  const [tab, setTab] = useState<"doc" | "skill">("doc");
  const [skills, setSkills] = useState<{ slug: string }[] | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const docRef = useRef<HTMLInputElement>(null);

  function loadSkills() {
    if (skills !== null) return;
    void fetch("/api/room/skills")
      .then((res) => res.json() as Promise<{ skills?: { slug: string }[] }>)
      .then((body) => setSkills(body.skills ?? []))
      .catch(() => setSkills([]));
  }

  return (
    <div className="room-attach">
      <button
        type="button"
        className="room-plus"
        aria-label="역할에 붙이기"
        title="문서 또는 공용 스킬 본문을 역할에 붙이기"
        aria-expanded={openMenu}
        disabled={disabled}
        onClick={() => {
          const next = !openMenu;
          setOpenMenu(next);
          if (next) loadSkills();
        }}
      >
        <PlusIcon />
      </button>
      {openMenu ? (
        <RoomCenterDialog
          title="역할 · 규약에 자료 붙이기"
          subtitle="문서나 공용 스킬의 본문을 현재 역할/규약 입력란 끝에 덧붙입니다."
          className="room-role-modal"
          onClose={() => setOpenMenu(false)}
        >
          <div className="room-modal-tabs" role="tablist" aria-label="역할 자료 종류">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "doc"}
              className={`room-modal-tab${tab === "doc" ? " is-on" : ""}`}
              onClick={() => setTab("doc")}
            >
              문서 파일
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "skill"}
              className={`room-modal-tab${tab === "skill" ? " is-on" : ""}`}
              onClick={() => { setTab("skill"); loadSkills(); }}
            >
              공용 스킬
            </button>
          </div>
          {tab === "doc" ? (
            <div className="room-dropzone">
              <div className="room-dropzone-body">
                <b>역할·규약에 포함할 텍스트/마크다운 문서를 선택하세요</b>
                <p>지원 형식: .txt, .md, .json, .csv, .yaml, .yml</p>
                <button type="button" className="flow-btn primary" onClick={() => docRef.current?.click()}>
                  문서 파일 선택
                </button>
              </div>
            </div>
          ) : (
            <div className="room-modal-section">
              <div className="room-modal-search-bar">
                <input
                  aria-label="스킬 검색"
                  value={skillQuery}
                  placeholder="스킬 이름 검색"
                  onChange={(e) => setSkillQuery(e.target.value)}
                />
              </div>
              <ul className="room-modal-list is-cards" aria-label="공용 스킬 목록">
                {skills === null ? (
                  <li className="room-modal-empty">스킬을 불러오는 중…</li>
                ) : skills.filter((s) => s.slug.toLowerCase().includes(skillQuery.trim().toLowerCase())).length === 0 ? (
                  <li className="room-modal-empty">스킬이 없습니다.</li>
                ) : (
                  skills
                    .filter((s) => s.slug.toLowerCase().includes(skillQuery.trim().toLowerCase()))
                    .map((skill) => (
                      <li key={skill.slug} className="room-modal-card-item">
                        <span className="room-modal-item-text">
                          <span className="room-modal-title-row">
                            <span className="room-badge is-skill">스킬</span>
                            <b>{skill.slug}</b>
                          </span>
                        </span>
                        <button
                          type="button"
                          className="flow-btn primary"
                          onClick={() => {
                            void fetch(`/api/room/skills?slug=${encodeURIComponent(skill.slug)}`)
                              .then((res) => res.json() as Promise<{ text?: string; error?: string }>)
                              .then((body) => {
                                if (!body.text) return;
                                onText(`첨부 · 스킬 「${skill.slug}」\n${clipAttach(body.text)}`);
                                setOpenMenu(false);
                              });
                          }}
                        >
                          붙이기
                        </button>
                      </li>
                    ))
                )}
              </ul>
            </div>
          )}
        </RoomCenterDialog>
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
