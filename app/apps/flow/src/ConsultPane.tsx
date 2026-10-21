import { useEffect, useMemo, useRef, useState } from "react";
import { ROOM_SPEAKER_LABEL, type ArchivedConsult, type ConsultMessage, type ConsultProgress, type ConsultStatus, type ConsultSummary, type PrdSection, type RoomMember } from "@patchbay/core";
import { ChatText } from "./ChatText.js";
import { chipFace, chipStyle } from "./RoomPanel.js";
import { doneTopics, handoffText, stageHandoff, type StageHandoff } from "./consultStage.js";

/**
 * 1 설계 — 상담 (명세 20261006a §12 · 사용자 결정 2026-10-06).
 *
 * 채팅 옆에 요약 패널. 패널은 **호스트가 쓴 글이 아니라** 초안에서 Core가 계산한 것이다(`/api/prd`) —
 * 그래서 패널에 보이는 것과 채택되는 것이 같다. 이 화면은 모델을 부르지 않는다: 보내면 콘솔이 사용자가
 * 머리 줄 오른쪽에서 고른 등록 LLM(Agents 목록 — 사용자 요청 2026-10-17)의 호스트 CLI(Claude Code · Codex)를
 * 같은 세션으로 부르고, 답은 `consult` 이벤트로 온다.
 */

interface HostInfo {
  host: "claude-code" | "codex";
  label: string;
  bin: string | null;
  loggedIn: boolean | null;
  verified: boolean;
  hint: string;
}

interface ConsultBody {
  id: string;
  status: ConsultStatus;
  running: boolean;
  /** 도는 턴의 지금 — 시작 시각 · 하는 일 · 마지막 신호. */
  run: { startedAt: string; activity: string; lastSignalAt: string; steps: number } | null;
  messages: ConsultMessage[];
  meta: { host: string; model: string; agentId?: string } | null;
  /** 끝내서 보관된 대화 — 읽기만 한다. */
  archived?: boolean;
}

interface Attachment {
  id: string;
  title: string;
  kind: "link" | "file" | "image";
  uri: string;
}

interface PrdBody {
  status: "ready" | "none";
  sections?: PrdSection[];
  progress?: ConsultProgress;
  format?: { field: string; count: number }[];
  formatRequest?: string | null;
  checks?: { id: string; what: string; note: string }[];
  checkRequest?: string | null;
}

const SOURCE_LABEL: Record<string, string> = { said: "말함", inferred: "해석", default: "기본값", manual: "직접" };
/** 「요구사항 정리」 — 맞춤법 · 상투어 · 길이는 모델의 일이라 상담자에게 맡긴다 (사용자 요청 2026-10-07). */
export const TIDY_REQUIREMENTS =
  "요구사항을 정리해 줘 — 뜻은 바꾸지 말고 맞춤법을 고치고, 「시스템은」을 빼고, 줄마다 summary(화면에 보이는 25자 안쪽 한 줄)를 붙여. consult_update 는 5줄씩 나눠서.";

/** 상담자는 초안을 Patchbay MCP로 쓴다 — MCP를 붙여 부를 수 있는 Claude Code · Codex Agent만 상담을 맡는다. */
/** 상담을 열 때 이미 끝난 주제 — 「다음 과정으로」를 이 상담에서 새로 끝난 주제로만 내려고 브라우저에 기억한다. */
function stageKey(project: string, consultId: string): string {
  return `patchbay.consultStage.${project}.${consultId}`;
}
function readStageStart(project: string, consultId: string): string[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(stageKey(project, consultId)) ?? "null") as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function writeStageStart(project: string, consultId: string, topics: readonly string[]): void {
  try {
    localStorage.setItem(stageKey(project, consultId), JSON.stringify(topics));
  } catch {
    // 사생활 보호 설정·용량 제한으로 저장할 수 없어도 상담 자체는 계속한다.
  }
}

function canConsult(agent: RoomMember): boolean {
  return agent.speaker === "claude-code" || agent.speaker === "codex";
}

function agentName(agent: RoomMember): string {
  return agent.name?.trim() || ROOM_SPEAKER_LABEL[agent.speaker];
}

/** 이 Agent를 지금 못 부르는 이유. 부를 수 있으면 null. */
function agentProblem(agent: RoomMember, hosts: HostInfo[] | null): string | null {
  if (!canConsult(agent)) return "상담 불가(초안을 쓰는 도구 없음)";
  const info = hosts?.find((h) => h.host === agent.speaker);
  if (!info?.bin) return `${ROOM_SPEAKER_LABEL[agent.speaker]} 실행 파일이 없다`;
  if (info.loggedIn === false) return `${ROOM_SPEAKER_LABEL[agent.speaker]} 로그인 필요`;
  return null;
}

export function ConsultPane({
  project,
  revision,
  onOpenPrd,
  pending,
  onPendingSent,
}: {
  project: string;
  revision: number;
  onOpenPrd: () => void;
  /** PRD 「고쳐 주세요」에서 넘어온 말 — 이 화면이 상담으로 이어 보낸다. `raw` 면 말 그대로 보낸다. */
  pending?: { n: number; note: string; raw?: boolean } | null;
  onPendingSent?: () => void;
}) {
  const [hosts, setHosts] = useState<HostInfo[] | null>(null);
  const [agents, setAgents] = useState<RoomMember[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [list, setList] = useState<ConsultSummary[]>([]);
  const [archivedList, setArchivedList] = useState<ArchivedConsult[]>([]);
  const [consultId, setConsultId] = useState("");
  const [consult, setConsult] = useState<ConsultBody | null>(null);
  const [prd, setPrd] = useState<PrdBody | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [advancingStage, setAdvancingStage] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/consult/hosts")
      .then((res) => res.json() as Promise<{ hosts: HostInfo[] }>)
      .then((body) => setHosts(body.hosts))
      .catch(() => setHosts([]));
  }, []);

  useEffect(() => {
    setConsultId("");
    setConsult(null);
    let cancelled = false;
    fetch(`/api/agents?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ agents?: RoomMember[] }>)
      .then((body) => !cancelled && setAgents(body.agents ?? []))
      .catch(() => !cancelled && setAgents([]));
    return () => {
      cancelled = true;
    };
  }, [project]);

  // 고른 것이 없으면 지금 부를 수 있는 첫 등록 LLM을 고른다. 이어 가는 상담이면 아래에서 그 상담의 LLM으로 바뀐다.
  useEffect(() => {
    if (!agents || hosts === null) return;
    if (agents.some((a) => a.id === agentId)) return;
    setAgentId(agents.find((a) => a.id && !agentProblem(a, hosts))?.id ?? "");
  }, [agents, hosts, agentId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/consult/list?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<{ consults: ConsultSummary[]; archived?: ArchivedConsult[] }>)
      .then((body) => {
        if (cancelled) return;
        setList(body.consults ?? []);
        setArchivedList(body.archived ?? []);
        setConsultId((prev) => prev || body.consults?.[0]?.id || "");
      })
      .catch(() => undefined);
    fetch(`/api/prd?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<PrdBody>)
      .then((body) => !cancelled && setPrd(body))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  useEffect(() => {
    if (!consultId) {
      setConsult(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/consult?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(consultId)}`)
      .then((res) => res.json() as Promise<ConsultBody | { error: string }>)
      .then((body) => {
        if (cancelled) return;
        if ("error" in body) setError(body.error);
        else {
          setConsult(body);
          if (body.meta?.agentId) setAgentId(body.meta.agentId);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, consultId, revision, tick]);

  // 답을 기다리는 동안은 이벤트가 늦어도 보이게 가볍게 다시 읽는다.
  useEffect(() => {
    if (!consult?.running) return;
    const timer = setInterval(() => setTick((n) => n + 1), 2000);
    // 경과 시간은 1초마다 화면에서 센다 — 「멈췄나?」를 사람이 판단할 수 있게.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [consult?.running]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [consult?.messages.length]);

  const busy = Boolean(consult?.running);
  /** 보관된 대화를 보고 있으면 새로 하는 말은 새 상담으로 간다. */
  const viewingArchived = Boolean(consult?.archived);
  const agent = agents?.find((a) => a.id === agentId) ?? null;
  const hostInfo = agent ? hosts?.find((h) => h.host === agent.speaker) : undefined;
  const problem = agent ? agentProblem(agent, hosts) : null;
  const blocked = !agent || Boolean(problem);
  const agentHint =
    agents === null || hosts === null
      ? ""
      : !agents.some(canConsult)
        ? "상담을 맡을 LLM이 없다 — 대화창 「LLM 호출」에서 Claude Code · Codex Agent를 등록한다."
        : !agent
          ? "오른쪽 위에서 상담할 LLM을 고른다."
          : problem
            ? `${agentName(agent)}: ${problem}${hostInfo?.hint ? ` · ${hostInfo.hint}` : ""}`
            : (hostInfo?.hint ?? "");

  // 처음 보는 상담이면 지금 끝난 주제를 시작점으로 둔다.
  const [stageStart, setStageStart] = useState<string[] | null>(null);
  useEffect(() => {
    if (!consultId || !prd?.progress || viewingArchived) return setStageStart(null);
    const saved = readStageStart(project, consultId);
    if (saved) return setStageStart(saved);
    const start = doneTopics(prd.progress);
    writeStageStart(project, consultId, start);
    setStageStart(start);
  }, [project, consultId, prd, viewingArchived]);
  const handoff = busy || viewingArchived ? null : stageHandoff(stageStart, prd?.progress);

  async function send(text: string, prdSection?: number, fresh = false) {
    if (!text.trim() || busy || blocked) return;
    setError(null);
    const res = await fetch("/api/consult/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: project,
        ...(consultId && !viewingArchived && !fresh ? { consultId } : {}),
        text,
        agentId,
        ...(prdSection ? { prdSection } : {}),
        ...(attachments.length ? { attachments: attachments.map((a) => a.id) } : {}),
      }),
    });
    const body = (await res.json()) as { consultId?: string; error?: string };
    if (!res.ok || !body.consultId) {
      setError(body.error ?? "보내지 못했다");
      return;
    }
    setDraft("");
    setAttachments([]);
    // 새 상담이 생겼으면 보낸 때의 진행을 시작점으로 — 첫 답이 주제를 채워도 그 상담에서 끝낸 것으로 센다.
    if (!readStageStart(project, body.consultId)) writeStageStart(project, body.consultId, doneTopics(prd?.progress));
    setConsultId(body.consultId);
    setTick((n) => n + 1);
  }

  /** 대화를 끝낸다 — 보관으로 옮기고, 다음 말은 빈 세션의 새 상담으로. 지운 것은 없다. */
  async function closeConversation() {
    if (!consultId || busy) return;
    setError(null);
    const res = await fetch("/api/consult/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, consultId }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(body.error ?? "끝내지 못했다");
      return;
    }
    setConsultId("");
    setTick((n) => n + 1);
  }

  /** 다음 과정으로 — 지금 대화를 보관하고, 다음 주제를 새 상담에서 잇는다. 매 턴 싣는 대화가 짧아진다. */
  async function goNextStage(h: StageHandoff) {
    if (!consultId || busy || blocked || advancingStage) return;
    setAdvancingStage(true);
    setError(null);
    try {
      const res = await fetch("/api/consult/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, consultId }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? "넘기지 못했다");
        return;
      }
      const prompt = handoffText(h);
      // 보관 뒤 새 상담 시작이 실패해도 이미 끝낸 대화를 다시 끝내려 하지 않게 한다.
      // 이어 갈 말은 입력창에 남겨 사람이 그대로 다시 보낼 수 있다.
      setConsultId("");
      setDraft(prompt);
      setTick((n) => n + 1);
      await send(prompt, undefined, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "넘기지 못했다");
    } finally {
      setAdvancingStage(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name}: 10MB까지 붙일 수 있다.`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const res = await fetch("/api/refs/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, name: file.name, dataBase64: btoa(bin) }),
      });
      const body = (await res.json()) as { ref?: Attachment; error?: string };
      if (body.ref) setAttachments((prev) => [...prev, body.ref!]);
      else setError(body.error ?? "붙이지 못했다");
    }
    setUploading(false);
    setPlusOpen(false);
  }

  async function addLink() {
    const url = linkDraft.trim();
    if (!url) return;
    const res = await fetch("/api/refs/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, url }),
    });
    const body = (await res.json()) as { ref?: Attachment; error?: string };
    if (body.ref) {
      setAttachments((prev) => [...prev, body.ref!]);
      setLinkDraft("");
      setPlusOpen(false);
    } else setError(body.error ?? "링크를 넣지 못했다");
  }

  /** 마지막 사람 말 — 「다시 보내기」가 쓴다. */
  const lastUser = [...(consult?.messages ?? [])].reverse().find((m) => m.role === "user");
  const lastIsFailure = consult?.status === "failed" && !busy;
  const lastSystem = [...(consult?.messages ?? [])].reverse().find((m) => m.role === "system" && m.kind !== "host-switch");

  // PRD에서 「고쳐 주세요」로 넘어온 말은 한 번만 보낸다.
  // 등록 LLM 목록이 늦게 와도 보내도록 목록 · 고른 LLM이 바뀔 때도 본다. 같은 말을 두 번 보내지 않게 보낸 것을 기억한다.
  const sentPending = useRef<typeof pending>(null);
  useEffect(() => {
    if (!pending || busy || blocked || hosts === null || sentPending.current === pending) return;
    sentPending.current = pending;
    const text = pending.raw || pending.note === TIDY_REQUIREMENTS ? pending.note : `PRD ${pending.n}절을 고쳐 주세요: ${pending.note}`;
    void send(text, pending.n || undefined).then(() => onPendingSent?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, hosts, agents, agentId]);

  const summary = useMemo(() => summarize(prd), [prd]);

  function jumpTo(turn?: number) {
    if (turn === undefined) return;
    document.getElementById(`consult-msg-${turn}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return (
    <div className="consult">
      <section className="consult-chat" aria-label="상담">
        <div className="consult-bar">
          <select aria-label="상담 고르기" value={consultId} onChange={(e) => setConsultId(e.target.value)}>
            <option value="">새 상담</option>
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.turns}턴
              </option>
            ))}
            {archivedList.length ? (
              <optgroup label="끝낸 대화 (보관)">
                {archivedList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.turns}턴 · {c.closedAt.slice(5, 10)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          {consult && !viewingArchived && consult.messages.length ? (
            <button
              type="button"
              className="flow-btn"
              onClick={() => void closeConversation()}
              disabled={busy}
              title="이 대화를 보관으로 옮긴다. 설계 초안은 그대로고, 다음 말은 지난 대화를 싣지 않은 새 상담으로 간다."
            >
              대화 끝내기
            </button>
          ) : null}
          <AgentPicker
            agents={agents ?? []}
            hosts={hosts}
            value={agentId}
            open={agentOpen}
            disabled={busy}
            onToggle={() => setAgentOpen((v) => !v)}
            onPick={(id) => {
              setAgentId(id);
              setAgentOpen(false);
            }}
          />
        </div>
        {viewingArchived ? (
          <p className="consult-hint">끝낸 대화 — 보관된 기록이다. 여기서 말하면 새 상담으로 간다. 상담자는 지난 대화를 맥락에 싣지 않고, 필요할 때만 찾아본다.</p>
        ) : null}
        {agentHint ? <p className={`consult-hint${blocked ? " is-bad" : ""}`}>{agentHint}</p> : null}

        <div className="consult-body">
          {!consult || consult.messages.length === 0 ? (
            <div className="consult-empty">
              <b>만들고 싶은 것을 평소 말로 적어 주세요.</b>
              <p>한두 문장이면 됩니다. 상담자가 그 말에 맞춰 하나씩 묻고, 옆 칸에 설계가 자랍니다. 다 차면 PRD로 확인합니다.</p>
              <p className="consult-example">예: 「쌓인 메모를 버그 · 요청 · 질문으로 나누고 이유 한 줄을 붙여 주는 걸 만들고 싶어. 지금은 아침마다 손으로 30분 걸려.」</p>
            </div>
          ) : (
            consult.messages.map((m) => <ConsultLine key={m.seq} message={m} project={project} />)
          )}
          {busy ? <Thinking run={consult?.run ?? null} now={now} /> : null}
          {lastIsFailure && lastSystem ? (
            <div className="consult-retry">
              {lastSystem.role === "system" && lastSystem.kind === "timeout" ? (
                <button type="button" className="flow-btn primary" onClick={() => void send("이어서 해 줘 — 멈춘 곳부터, 짧게 먼저 답하고 나머지는 다음 턴으로.")} disabled={blocked}>
                  이어서
                </button>
              ) : null}
              {lastUser && lastUser.role === "user" ? (
                <button type="button" className="flow-btn" onClick={() => void send(lastUser.text, lastUser.prdSection)} disabled={blocked}>
                  같은 말 다시 보내기
                </button>
              ) : null}
            </div>
          ) : null}
          {handoff ? (
            <div className="consult-next">
              <span>
                「{handoff.done}」 과정을 마쳤다. 다음은 「{handoff.next}」 — 새 상담에서 이어 가면 지난 대화를 다시 싣지 않아 토큰이 덜 든다.
              </span>
              <button type="button" className="flow-btn primary" onClick={() => void goNextStage(handoff)} disabled={blocked || advancingStage}>
                {advancingStage ? "넘어가는 중…" : `「${handoff.next}」로 넘어가기`}
              </button>
            </div>
          ) : null}
          {consult && consult.status === "waiting" && !consult.running ? (
            <p className="consult-hint is-bad">답이 오기 전에 끊겼다 (콘솔이 꺼졌거나 멈췄다). 같은 말을 다시 보내면 된다.</p>
          ) : null}
          <div ref={endRef} />
        </div>

        {attachments.length ? (
          <div className="consult-attach-row" aria-label="붙인 자료">
            {attachments.map((a) => (
              <span key={a.id} className={`consult-chip is-${a.kind}`}>
                <i>{a.kind === "link" ? "링크" : a.kind === "image" ? "이미지" : "파일"}</i> {a.title}
                <button type="button" aria-label={`${a.title} 빼기`} onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form
          className="consult-send"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <div className="consult-plus">
            <button type="button" className="consult-plus-btn" aria-label="자료 붙이기" aria-expanded={plusOpen} onClick={() => setPlusOpen((v) => !v)} disabled={busy}>
              +
            </button>
            {plusOpen ? (
              <div className="consult-plus-menu" role="dialog" aria-label="자료 붙이기">
                <button type="button" className="flow-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? "올리는 중…" : "파일 · 이미지 올리기"}
                </button>
                <small>이미지 · PDF · 문서 · 텍스트, 10MB까지</small>
                <div className="consult-plus-link">
                  <input aria-label="링크" placeholder="https:// — 유튜브 · 웹 문서" value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} />
                  <button type="button" className="flow-btn" onClick={() => void addLink()} disabled={!linkDraft.trim()}>
                    넣기
                  </button>
                </div>
              </div>
            ) : null}
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ""))} />
          </div>
          <textarea
            aria-label="말하기"
            value={draft}
            rows={3}
            placeholder={busy ? "상담자가 답을 쓰는 동안은 기다린다" : "답을 적어 주세요 (⌘↩ 보내기) · 자료는 + 로"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send(draft);
              }
            }}
            disabled={busy}
          />
          <button type="submit" className="flow-btn primary" disabled={busy || blocked || !draft.trim()}>
            보내기
          </button>
        </form>
        {error ? <p className="thread-err">{error}</p> : null}
      </section>

      <aside className="consult-panel" aria-label="상담 요약">
        <div className="consult-topics" title="주제 진행">
          {(prd?.progress?.topics ?? EMPTY_TOPICS).map((t) => (
            <span
              key={t.name}
              className={`consult-topic${t.done ? " is-done" : t.name === prd?.progress?.next ? " is-on" : ""}`}
              title={`${t.name} ${t.filled}/${t.total}`}
            >
              <i />
              <small>{t.name}</small>
            </span>
          ))}
        </div>
        {prd?.format?.length ? (
          <FormatNotice format={prd.format} onFix={() => prd.formatRequest && void send(prd.formatRequest)} disabled={busy || blocked} />
        ) : null}
        {!prd?.format?.length && prd?.checks?.length ? (
          <CheckNotice checks={prd.checks} onFix={() => prd.checkRequest && void send(prd.checkRequest)} disabled={busy || blocked} />
        ) : null}
        <dl className="consult-summary">
          <dt>목표</dt>
          <dd>{summary.goal ? <SourceText line={summary.goal} onJump={jumpTo} /> : <span className="muted">아직</span>}</dd>
          <dt>
            요구사항
            {summary.requirements.length ? (
              <button type="button" className="consult-tidy" onClick={() => void send(TIDY_REQUIREMENTS)} disabled={busy || blocked} title="맞춤법 · 「시스템은」 · 긴 문장을 상담자가 정리한다">
                정리
              </button>
            ) : null}
          </dt>
          <dd>
            {summary.requirements.length ? (
              <ol>
                {summary.requirements.map((line) => (
                  <li key={line.path}>
                    <SourceText line={line} onJump={jumpTo} />
                  </li>
                ))}
              </ol>
            ) : (
              <span className="muted">아직</span>
            )}
          </dd>
          <dt>예시</dt>
          <dd>{summary.examples >= 3 ? `${summary.examples}개 — 충분` : `${summary.examples}/3`}</dd>
          <dt>환경</dt>
          <dd>{summary.env ? <SourceText line={summary.env} onJump={jumpTo} /> : <span className="muted">아직</span>}</dd>
          <dt>아직</dt>
          <dd>
            {!prd?.progress
              ? "일곱 주제 모두 — 상담을 시작하면 채워진다"
              : summary.missingTopics.length
                ? summary.missingTopics.join(" · ")
                : "없음 — PRD로 확인할 차례"}
          </dd>
        </dl>
        <button type="button" className={prd?.progress?.next === null ? "flow-btn primary" : "flow-btn"} onClick={onOpenPrd} disabled={prd?.status !== "ready"}>
          PRD로 확인하기
        </button>
        <p className="consult-legend">
          <span className="src src-said">말함</span> <span className="src src-inferred">해석</span>{" "}
          <span className="src src-default">기본값</span> — 해석 · 기본값은 PRD에서 확인받는다
        </p>
      </aside>
    </div>
  );
}

const EMPTY_TOPICS = ["목표와 요구사항", "사용 시나리오", "환경 설정", "제약과 규칙", "UI와 인터페이스", "보안성 검토", "미비사항"].map((name) => ({
  name,
  filled: 0,
  total: 0,
  missing: [],
  done: false,
}));

function summarize(prd: PrdBody | null) {
  const sections = prd?.sections ?? [];
  const first = sections[0]?.lines.find((l) => l.path === "goal");
  // 패널은 짧게 — 「R1 [항상]」 머리는 PRD에서 본다.
  const requirements = (sections[9]?.lines ?? [])
    .filter((l) => l.path.startsWith("requirements["))
    .map((l) => ({ ...l, text: l.text.replace(/^\S+( · [^—]+)? — /, "") }));
  const examples = (sections[9]?.lines ?? []).filter((l) => l.path.startsWith("evals[")).length;
  const env = sections[6]?.lines.find((l) => l.path.startsWith("environment"));
  const missingTopics = (prd?.progress?.topics ?? []).filter((t) => !t.done).map((t) => t.name);
  return { goal: first, requirements, examples, env, missingTopics };
}

function SourceText({ line, onJump }: { line: { text: string; source: string; turn?: number }; onJump: (turn?: number) => void }) {
  return (
    <button type="button" className="consult-line" onClick={() => onJump(line.turn)} disabled={line.turn === undefined} title={line.turn !== undefined ? "근거가 된 말로 가기" : undefined}>
      <span>{line.text}</span>
      <span className={`src src-${line.source}`}>{SOURCE_LABEL[line.source] ?? line.source}</span>
    </button>
  );
}

function ConsultLine({ message, project }: { message: ConsultMessage; project: string }) {
  if (message.role === "meta") return null;
  if (message.role === "user") {
    return (
      <div id={`consult-msg-${message.seq}`} className="chat-row is-me">
        <div className="chat-bubble is-me">
          <span className="chat-who">나{message.prdSection ? ` · PRD ${message.prdSection}절 고침` : ""}</span>
          <span className="chat-text"><ChatText text={message.text} project={project} /></span>
          {message.attachments?.length ? (
            <span className="chat-attach">
              {message.attachments.map((a) =>
                a.kind === "link" ? (
                  <a key={a.id} href={a.uri} target="_blank" rel="noreferrer" className="consult-chip is-link">
                    <i>링크</i> {a.title}
                  </a>
                ) : a.kind === "image" ? (
                  <a key={a.id} href={refRaw(project, a.id)} target="_blank" rel="noreferrer" title="새 탭에서 열기">
                    <img className="chat-thumb" alt={a.title} src={refRaw(project, a.id)} />
                  </a>
                ) : (
                  <span key={a.id} className="consult-chip is-file">
                    <i>파일</i>
                    <a href={refRaw(project, a.id)} target="_blank" rel="noreferrer" title="새 탭에서 열기">{a.title}</a>
                    <a className="chat-file-get" href={`${refRaw(project, a.id)}&download=1`} download aria-label={`${a.title} 받기`}>받기</a>
                  </span>
                ),
              )}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
  if (message.role === "host") {
    return (
      <div id={`consult-msg-${message.seq}`} className="chat-row is-host">
        <span className="chat-avatar" aria-hidden="true">
          상
        </span>
        <div className="chat-bubble is-host">
          <span className="chat-who">
            상담자 <small>· {message.agentName ? `${message.agentName} · ` : ""}{message.model} · {(message.ms / 1000).toFixed(0)}초</small>
          </span>
          <span className="chat-text">
            <ChatText text={message.text} project={project} bold />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={`chat-system is-${message.kind}`}>
      <b>
        {message.kind === "host-switch"
          ? "호스트 바꿈"
          : message.kind === "closed"
            ? "대화 끝냄 — 보관"
            : message.kind === "timeout"
              ? "멈춤 — 시간 초과"
              : "멈춤 — 실패"}
      </b>
      <span>{message.text}</span>
    </div>
  );
}

/** 상담자가 일하는 중 — 움직이는 표시 · 경과 시간 · 지금 하는 일 · 마지막 신호. 신호가 오래 없으면 그렇다고 말한다. */
function Thinking({ run, now }: { run: ConsultBody["run"]; now: number }) {
  const started = run ? Date.parse(run.startedAt) : now;
  const elapsed = Math.max(0, Math.round((now - started) / 1000));
  const quiet = run ? Math.max(0, Math.round((now - Date.parse(run.lastSignalAt)) / 1000)) : 0;
  const fmt = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`);
  return (
    <div className="chat-row is-host" role="status" aria-live="polite">
      <span className="chat-avatar is-busy" aria-hidden="true">
        상
      </span>
      <div className="chat-thinking">
        <span className="spinner" aria-hidden="true" />
        <span>
          <b>{run?.activity ?? "상담자를 부르는 중"}</b> · {fmt(elapsed)}째
          {run && run.steps > 0 ? ` · ${run.steps}번째 일` : ""}
        </span>
        <small>{quiet >= 45 ? `${fmt(quiet)} 동안 새 신호가 없다 — 모델이 길게 생각하는 중일 수 있다. 300초가 지나면 멈추고 이유를 알린다.` : "살아 있음 — 호스트가 일하는 신호가 오고 있다"}</small>
      </div>
    </div>
  );
}

/** 호스트는 마크다운 굵은 글씨(`**…**`)를 자주 쓴다 — 별표를 그대로 보이지 않고 굵게만 그린다. 그 밖의 마크다운은 글 그대로. */
/** 상담 창 머리 줄 오른쪽 — 등록한 LLM(Agents 목록)을 골라 상담을 맡긴다 (사용자 요청 2026-10-17). */
function AgentPicker({
  agents,
  hosts,
  value,
  open,
  disabled,
  onToggle,
  onPick,
}: {
  agents: RoomMember[];
  hosts: HostInfo[] | null;
  value: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onPick: (id: string) => void;
}) {
  const current = agents.find((a) => a.id === value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onToggle();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onToggle]);
  return (
    <div className="consult-agent" ref={ref}>
      <button
        type="button"
        className="consult-agent-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
        disabled={disabled}
        title="상담을 맡을 등록 LLM"
      >
        {current ? (
          <>
            <span className="room-chip" style={chipStyle(current)}>{chipFace(current)}</span>
            <span className="consult-agent-name">{agentName(current)}</span>
            {current.model ? <small>{current.model}</small> : null}
          </>
        ) : (
          <span className="consult-agent-name">LLM 고르기</span>
        )}
        <span className="consult-agent-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="consult-agent-menu" role="listbox" aria-label="상담할 LLM">
          {agents.length ? (
            agents.map((a) => {
              const problem = agentProblem(a, hosts);
              return (
                <li key={a.id ?? agentName(a)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={a.id === value}
                    className={a.id === value ? "is-on" : ""}
                    disabled={!a.id || Boolean(problem)}
                    onClick={() => a.id && onPick(a.id)}
                  >
                    <span className="room-chip" style={chipStyle(a)}>{chipFace(a)}</span>
                    <span className="consult-agent-text">
                      <b>{agentName(a)}</b>
                      <small>
                        {ROOM_SPEAKER_LABEL[a.speaker]}
                        {a.model ? ` · ${a.model}` : ""}
                        {a.effort ? ` · ${a.effort}` : ""}
                        {problem ? ` — ${problem}` : ""}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="consult-agent-empty">등록된 LLM이 없다 — 대화창 「LLM 호출」에서 등록한다.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function refRaw(project: string, id: string): string {
  return `/api/refs/raw?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`;
}

const FIELD_WORD: Record<string, string> = {
  "evals.kind": "시험 종류", "caps.id": "권한", "tools.caps": "도구 권한", "tools.via": "도구 출처", "nodes.writes": "단계가 채우는 값",
  "nodes.reads": "단계가 읽는 값", state: "들고 다닐 값", models: "모델", "relations.kind": "관계 뜻", "relations.cardinality": "관계 개수",
  competencyQuestions: "답해야 하는 질문", references: "참고 자료", riskLevel: "틀리면 피해", autonomy: "스스로 하는 정도", memory: "기억",
  "environment.location": "도는 곳", "interface.entry": "부르는 곳", "credentials.storedAt": "열쇠 둔 곳", "emits.to": "내보내는 곳",
  "requirements.pattern": "요구사항 모양", "requirements.priority": "우선순위",
};

/** 초안이 설계 형식으로 안 읽힐 때 — 어느 칸이 몇 곳인지, 그리고 상담자에게 고쳐 달라는 버튼 (사용자 질문 2026-10-07). */
export function FormatNotice({ format, onFix, disabled }: { format: { field: string; count: number }[]; onFix: () => void; disabled?: boolean }) {
  const total = format.reduce((n, p) => n + p.count, 0);
  return (
    <div className="format-notice" role="alert">
      <b>설계 형식이 맞지 않는 곳 {total}곳</b>
      <p>이대로는 검사와 채택을 할 수 없다. 정해진 값 자리에 문장이 들어간 곳들이다.</p>
      <ul>
        {format.slice(0, 8).map((p) => (
          <li key={p.field}>
            {FIELD_WORD[p.field] ?? p.field} <span>{p.count}</span>
          </li>
        ))}
        {format.length > 8 ? <li>외 {format.length - 8}칸</li> : null}
      </ul>
      <button type="button" className="flow-btn primary" onClick={onFix} disabled={disabled}>
        형식 맞추기
      </button>
    </div>
  );
}

/** 설계 규칙 검사가 막는 곳 — 사람 말로 + 상담자에게 넘기기 (사용자 요청 2026-10-07). */
export function CheckNotice({ checks, onFix, disabled }: { checks: { id: string; what: string; note: string }[]; onFix: () => void; disabled?: boolean }) {
  return (
    <div className="format-notice is-check" role="alert">
      <b>설계 검사가 막는 곳 {checks.length}개 — 이대로는 채택할 수 없다</b>
      <ul className="check-list">
        {checks.map((c) => (
          <li key={c.id} title={c.note}>
            {c.what}
          </li>
        ))}
      </ul>
      <button type="button" className="flow-btn primary" onClick={onFix} disabled={disabled}>
        검사 맞추기
      </button>
    </div>
  );
}
