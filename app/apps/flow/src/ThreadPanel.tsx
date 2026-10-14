import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreadMessage, ThreadStatus, ThreadSummary } from "@patchbay/core";

/**
 * 대화 칸 — 그래프에 말을 넣고, 노드가 멈추면 호스트 모델의 답을 기다리고, 끝난 답에 👍 · 👎를 단다.
 * 대화 하나 = LangGraph `thread_id` 하나 = `threads/<thread_id>.jsonl` 하나 (사용자 결정 2026-10-05).
 *
 * 이 칸은 모델을 부르지 않는다. 멈춘 요청은 IDE의 호스트 모델이 MCP(`list_pending_requests` →
 * `answer_request`)로 답하고, 콘솔이 같은 thread_id로 재개한다. 화면은 그 파일을 그릴 뿐이다.
 */

interface ThreadsBody {
  threads: ThreadSummary[];
  pending: number;
}

interface ThreadBody {
  threadId: string;
  status: ThreadStatus;
  messages: ThreadMessage[];
  broken: { line: number; error: string }[];
}

interface Assistant {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<ThreadStatus, string> = {
  empty: "빈 대화",
  sent: "보냄",
  waiting: "호스트 답 기다림",
  resuming: "재개 중",
  done: "끝남",
  failed: "실패",
};

/** IDE의 호스트에게 줄 한 줄 — 복사해서 붙이면 된다. */
const HOST_PROMPT = "Patchbay MCP의 list_pending_requests 로 대기 요청을 읽고, 각각 answer_request 로 답해 줘.";

export function ThreadPanel({ project, revision }: { project: string; revision: number }) {
  const [list, setList] = useState<ThreadsBody | null>(null);
  const [threadId, setThreadId] = useState<string>("");
  const [thread, setThread] = useState<ThreadBody | null>(null);
  const [assistants, setAssistants] = useState<Assistant[] | null>(null);
  const [assistantId, setAssistantId] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThreadId("");
    setThread(null);
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/threads?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<ThreadsBody>)
      .then((body) => {
        if (!cancelled && Array.isArray(body.threads)) setList(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/flow")
      .then((res) => res.json() as Promise<{ status?: string; assistants?: Assistant[] }>)
      .then((body) => {
        if (cancelled) return;
        const found = body.status === "connected" ? (body.assistants ?? []) : [];
        setAssistants(found);
        setAssistantId((prev) => prev || found[0]?.id || "");
      })
      .catch(() => !cancelled && setAssistants([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!threadId) {
      setThread(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/thread?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(threadId)}`)
      .then(async (res) => {
        const body = (await res.json()) as ThreadBody | { error: string };
        if (cancelled) return;
        if ("error" in body) setError(body.error);
        else {
          setThread(body);
          if (body.messages.length) {
            const graph = body.messages.find((m) => m.role === "graph");
            if (graph && graph.role === "graph") setAssistantId(graph.assistantId);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, threadId, revision, tick]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread?.messages.length]);

  const feedbackOf = useMemo(() => {
    const map = new Map<number, "up" | "down">();
    for (const m of thread?.messages ?? []) if (m.role === "feedback") map.set(m.target, m.value);
    return map;
  }, [thread]);
  /** 답(또는 시간 초과)이 붙은 멈춤 — 더는 기다리는 중이 아니다. */
  const closed = useMemo(() => {
    const set = new Set<number>();
    for (const m of thread?.messages ?? []) if (m.role === "host" || m.role === "system") set.add(m.replyTo);
    return set;
  }, [thread]);

  const locked = thread?.status === "waiting" || thread?.status === "resuming";
  const connected = (assistants?.length ?? 0) > 0;

  async function send() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/thread/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project, threadId: threadId || undefined, assistantId, text: draft }),
      });
      const body = (await res.json()) as { threadId?: string; error?: string };
      if (!res.ok || body.error) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setDraft("");
        if (body.threadId) setThreadId(body.threadId);
      }
    } finally {
      setBusy(false);
      setTick((n) => n + 1);
    }
  }

  async function feedback(target: number, value: "up" | "down") {
    await fetch("/api/thread/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, threadId, target, value }),
    });
    setTick((n) => n + 1);
  }

  return (
    <div className="thread">
      <div className="thread-bar">
        <select aria-label="대화 고르기" value={threadId} onChange={(e) => setThreadId(e.target.value)}>
          <option value="">+ 새 대화</option>
          {(list?.threads ?? []).map((t) => (
            <option key={t.threadId} value={t.threadId}>
              {t.title} · {STATUS_LABEL[t.status]}
            </option>
          ))}
        </select>
        {list?.pending ? <span className="thread-pending" title="호스트의 답을 기다리는 대화">대기 {list.pending}</span> : null}
      </div>

      <div className="thread-body">
        {!threadId ? (
          <p className="thread-empty">
            그래프에 말을 넣으면 대화가 시작된다. 노드가 멈추면 IDE의 호스트 모델이 답하고, 같은 thread_id로 이어진다.
          </p>
        ) : null}
        {thread?.messages.map((m) => (
          <Message key={m.seq} message={m} closed={closed.has(m.seq)} feedback={feedbackOf.get(m.seq)} onFeedback={feedback} />
        ))}
        {thread?.broken.length ? <p className="thread-err">읽지 못한 줄 {thread.broken.length}개 — 파일에 남아 있다</p> : null}
        {thread?.status === "waiting" ? <HostHint /> : null}
        <div ref={endRef} />
      </div>

      <div className="thread-input">
        {error ? <p className="thread-err">{error}</p> : null}
        {!connected ? (
          <p className="thread-note">LangGraph가 꺼져 있다 — 그래프가 있는 레포에서 <code>langgraph dev</code> 를 켠다.</p>
        ) : (
          <select aria-label="그래프" value={assistantId} disabled={Boolean(threadId)} onChange={(e) => setAssistantId(e.target.value)}>
            {(assistants ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                그래프 · {a.name}
              </option>
            ))}
          </select>
        )}
        <textarea
          aria-label="보낼 말"
          rows={3}
          value={draft}
          placeholder={locked ? "호스트의 답을 기다리는 중" : "예: Q12 오답 — 고른 답 B, 정답 D"}
          disabled={locked || !connected}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <button type="button" className="flow-btn primary" disabled={busy || locked || !connected || !draft.trim()} onClick={() => void send()}>
          {busy ? "그래프 실행 중" : "보내기"}
        </button>
      </div>
    </div>
  );
}

function Message({
  message: m,
  closed,
  feedback,
  onFeedback,
}: {
  message: ThreadMessage;
  closed: boolean;
  feedback?: "up" | "down";
  onFeedback: (target: number, value: "up" | "down") => void;
}) {
  if (m.role === "feedback") return null;
  if (m.role === "user") return <div className="msg is-user">{m.text}</div>;
  if (m.role === "system") return <div className="msg is-system">시간 초과 — {m.text}</div>;
  if (m.role === "host") {
    return (
      <div className={`msg is-host${m.outcome === "refused" ? " is-refused" : ""}`}>
        <span className="msg-meta">
          호스트{m.model ? ` · ${m.model}` : ""}
          {m.ms !== undefined ? ` · ${(m.ms / 1000).toFixed(1)}초` : ""}
          {m.outcome === "refused" ? " · 거절" : ""}
        </span>
        {m.text}
        <Rate seq={m.seq} feedback={feedback} onFeedback={onFeedback} />
      </div>
    );
  }
  if (m.status === "waiting") {
    return (
      <div className={`msg is-waiting${closed ? " is-closed" : ""}`}>
        <span className="msg-meta">
          {m.nodeId ?? "노드"} 가 멈췄다 ·{" "}
          {closed
            ? "아래 답으로 이어졌다"
            : `호스트의 답을 기다린다${m.deadlineAt ? ` · 한도 ${new Date(m.deadlineAt).toLocaleTimeString()}` : ""}`}
        </span>
        <details>
          <summary>요청 보기</summary>
          <pre>{JSON.stringify(m.request, null, 2)}</pre>
        </details>
      </div>
    );
  }
  return (
    <div className={`msg is-graph${m.status === "error" ? " is-error" : ""}`}>
      <span className="msg-meta">그래프{m.nodeId ? ` · ${m.nodeId}` : ""}{m.status === "error" ? " · 오류" : ""}</span>
      {m.text}
      {m.status === "success" ? <Rate seq={m.seq} feedback={feedback} onFeedback={onFeedback} /> : null}
    </div>
  );
}

function Rate({
  seq,
  feedback,
  onFeedback,
}: {
  seq: number;
  feedback?: "up" | "down";
  onFeedback: (target: number, value: "up" | "down") => void;
}) {
  return (
    <span className="msg-rate">
      <button type="button" aria-pressed={feedback === "up"} aria-label="좋음" onClick={() => onFeedback(seq, "up")}>
        👍
      </button>
      <button type="button" aria-pressed={feedback === "down"} aria-label="나쁨" onClick={() => onFeedback(seq, "down")}>
        👎
      </button>
    </span>
  );
}

function HostHint() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="thread-hint">
      <b>IDE의 호스트 모델에게 시킨다</b>
      <p>Cursor · Claude Code 등에서 아래 한 줄을 보내면, 호스트가 요청을 읽고 답을 붙인다. 답이 붙으면 여기서 이어진다.</p>
      <code>{HOST_PROMPT}</code>
      <button
        type="button"
        className="flow-btn"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(HOST_PROMPT)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? "복사했다" : "복사"}
      </button>
    </div>
  );
}
