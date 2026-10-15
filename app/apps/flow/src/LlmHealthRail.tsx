import { useEffect, useRef, useState } from "react";
import type {
  LlmProviderHealth,
  LlmQuotaPreset,
  LlmQuotaProvider,
  LlmQuotaSnapshot,
  ProviderCap,
} from "@patchbay/core";

const PRESET_LABELS: { id: LlmQuotaPreset; title: string; sub: string }[] = [
  { id: "pro", title: "Pro / Plus", sub: "기본 구독" },
  { id: "max5x", title: "Max 5x", sub: "권장 기본값" },
  { id: "max20x", title: "Max 20x", sub: "대용량 구독" },
  { id: "custom", title: "직접 입력", sub: "사용자 지정" },
];

const DEFAULT_SNAPSHOT: LlmQuotaSnapshot = {
  preset: "max5x",
  caps: {
    "claude-code": { sessionTokens: 220_000, weeklyTokens: 2_000_000 },
    codex: { sessionTokens: 150_000, weeklyTokens: 1_000_000 },
  },
  providers: [
    {
      provider: "claude-code",
      code: "CL",
      label: "Claude Code",
      sub: "claude · opus / sonnet",
      estimated: true,
      hpPct: null,
      tone: "ok",
      session: { usedTokens: 0, inputTokens: 0, outputTokens: 0, capTokens: 220_000, remainingPct: null, tone: "ok", turns: 0, recoverInMinutes: null },
      weekly: { usedTokens: 0, inputTokens: 0, outputTokens: 0, capTokens: 2_000_000, remainingPct: null, tone: "ok", turns: 0, costUsd: 0 },
      exhausted: null,
    },
    {
      provider: "codex",
      code: "CX",
      label: "Codex CLI",
      sub: "codex · gpt-5.4 / o3",
      estimated: false,
      hpPct: 100,
      tone: "ok",
      session: { usedTokens: 0, inputTokens: 0, outputTokens: 0, capTokens: 150_000, remainingPct: 100, tone: "ok", turns: 0, recoverInMinutes: null },
      weekly: { usedTokens: 0, inputTokens: 0, outputTokens: 0, capTokens: 1_000_000, remainingPct: 100, tone: "ok", turns: 0, costUsd: 0 },
      exhausted: null,
    },
  ],
  updatedAt: "",
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatRecoverTime(minutes: number | null): string {
  if (minutes === null) return "사용 없음";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}시간 ${m}분 뒤 회복` : `${m}분 뒤 회복`;
}

function toneLabel(p: LlmProviderHealth): string {
  if (p.exhausted || p.hpPct === 0) return `HP 0% · 고갈`;
  if (p.hpPct === null) return "사용량만 · 서버 사용률 없음";
  if (p.tone === "warn") return `HP ${p.hpPct}% · 주의`;
  return `HP ${p.hpPct}% · 양호`;
}

export function LlmHealthRail({
  revision,
  readOnly,
}: {
  revision: number;
  readOnly: boolean;
}) {
  const [snapshot, setSnapshot] = useState<LlmQuotaSnapshot>(DEFAULT_SNAPSHOT);
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("hp") === "open",
  );
  const [tab, setTab] = useState<"status" | "config">("status");
  const [draftCaps, setDraftCaps] = useState<Record<LlmQuotaProvider, ProviderCap>>(DEFAULT_SNAPSHOT.caps);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/llm-quota", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as LlmQuotaSnapshot;
          if (!cancelled && Array.isArray(body.providers)) {
            setSnapshot(body);
            setDraftCaps(body.caps);
          }
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [revision]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function selectPreset(preset: LlmQuotaPreset) {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/llm-quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preset === "custom" ? { preset: "custom", caps: draftCaps } : { preset }),
      });
      if (res.ok) {
        const body = (await res.json()) as LlmQuotaSnapshot;
        setSnapshot(body);
        setDraftCaps(body.caps);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomCaps() {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/llm-quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: "custom", caps: draftCaps }),
      });
      if (res.ok) {
        const body = (await res.json()) as LlmQuotaSnapshot;
        setSnapshot(body);
        setDraftCaps(body.caps);
      }
    } finally {
      setBusy(false);
    }
  }

  async function recoverProvider(provider: LlmQuotaProvider) {
    if (readOnly || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/llm-quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recover", provider }),
      });
      if (res.ok) {
        const body = (await res.json()) as LlmQuotaSnapshot;
        setSnapshot(body);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rail-hp-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`rail-hp-group${open ? " is-open" : ""}`}
        aria-label="LLM 구독 체력 상태"
        aria-expanded={open}
        title="LLM 구독 체력 상태 (클릭하여 상세 보기)"
        onClick={() => setOpen((prev) => !prev)}
      >
        {snapshot.providers.map((item) => (
          <div key={item.provider} className={`rail-hp-row is-${item.hpPct === null ? "est" : item.tone}`}>
            <div className="rail-hp-head">
              <b>{item.code}</b>
              <span>{item.hpPct === null ? formatTokens(item.session.usedTokens) : `${item.hpPct}%`}</span>
            </div>
            {/* 퍼센트를 모르는 공급자는 막대 대신 5시간 사용량만 보인다. */}
            {item.hpPct === null ? <small className="rail-hp-est">5h 사용</small> : <div className="hp-track" aria-hidden="true">
              <div className={`hp-fill is-${item.tone}`} style={{ width: `${item.hpPct}%` }} />
            </div>}
          </div>
        ))}
      </button>

      {open ? (
        <aside className="hp-popover" role="dialog" aria-label="LLM 구독 체력 상태">
          <div className="hp-pop-head">
            <div className="hp-pop-title">
              <b>LLM 구독 체력</b>
              <small>5시간 세션 · 7일 주간 잔여량</small>
            </div>
            <div className="hp-tabs" role="tablist" aria-label="LLM 체력 창 보기">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "status"}
                className={tab === "status" ? "is-on" : ""}
                onClick={() => setTab("status")}
              >
                체력 상태
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "config"}
                className={tab === "config" ? "is-on" : ""}
                onClick={() => setTab("config")}
              >
                체력통 설정
              </button>
            </div>
          </div>

          {tab === "status" ? (
            <div className="hp-pop-body">
              {snapshot.providers.map((p) => {
                const sessionRemaining = Math.max(0, p.session.capTokens - p.session.usedTokens);
                const weeklyRemaining = Math.max(0, p.weekly.capTokens - p.weekly.usedTokens);
                return (
                  <article key={p.provider} className={`hp-card${p.exhausted ? " is-exhausted" : ""}`}>
                    <div className="hp-card-top">
                      <div className="hp-provider">
                        <span className={`hp-badge-code is-${p.tone}`}>{p.code}</span>
                        <div className="hp-provider-name">
                          <b>{p.label}</b>
                          <small>{p.sub}</small>
                        </div>
                      </div>
                      <span className={`hp-status-pill is-${p.tone}`}>{toneLabel(p)}</span>
                    </div>

                    <div className="hp-meter">
                      <div className="hp-meter-label">
                        <span>5시간 세션 {p.session.remainingPct === null ? "사용량" : "체력"} ({formatRecoverTime(p.session.recoverInMinutes)})</span>
                        <b>
                          {p.session.remainingPct === null
                            ? `사용 ${formatTokens(p.session.usedTokens)}`
                            : p.session.usedTokens > p.session.capTokens && p.session.remainingPct > 0
                              ? `${p.session.remainingPct}% · 사용 ${formatTokens(p.session.usedTokens)} (서버 한도)`
                              : `${p.session.remainingPct}% · ${formatTokens(sessionRemaining)} / ${formatTokens(p.session.capTokens)}`}
                        </b>
                      </div>
                      {p.session.remainingPct === null ? null : <div className="hp-bar-lg">
                        <div className={`hp-fill is-${p.session.tone}`} style={{ width: `${p.session.remainingPct}%` }} />
                      </div>}
                    </div>

                    <div className="hp-meter">
                      <div className="hp-meter-label">
                        <span>7일 주간 {p.weekly.remainingPct === null ? "사용량" : "체력"} ({p.weekly.turns}턴 호출)</span>
                        <b>
                          {p.weekly.remainingPct === null
                            ? `사용 ${formatTokens(p.weekly.usedTokens)}`
                            : p.weekly.usedTokens > p.weekly.capTokens && p.weekly.remainingPct > 0
                              ? `${p.weekly.remainingPct}% · 사용 ${formatTokens(p.weekly.usedTokens)} (서버 한도)`
                              : `${p.weekly.remainingPct}% · ${formatTokens(weeklyRemaining)} / ${formatTokens(p.weekly.capTokens)}`}
                        </b>
                      </div>
                      {p.weekly.remainingPct === null ? null : <div className="hp-bar-lg">
                        <div className={`hp-fill is-${p.weekly.tone}`} style={{ width: `${p.weekly.remainingPct}%` }} />
                      </div>}
                    </div>

                    {p.estimated && !p.exhausted ? (
                      <p className="hp-est-note">아직 Claude Code 상태줄에서 사용률을 받지 못해 사용량만 보입니다. Claude Code를 한 번 쓰면 남은 % 로 바뀝니다.</p>
                    ) : null}

                    {p.exhausted ? (
                      <div className="hp-exhaust-banner">
                        <span>
                          호스트 한도 도달{p.exhausted.resetHint ? ` · ${p.exhausted.resetHint} 회복` : ""}
                        </span>
                        {!readOnly ? (
                          <button type="button" disabled={busy} onClick={() => void recoverProvider(p.provider)}>
                            수동 회복
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="hp-pop-body">
              <div className="hp-preset-row">
                {PRESET_LABELS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={readOnly || busy}
                    className={`hp-preset-btn${snapshot.preset === item.id ? " is-on" : ""}`}
                    onClick={() => void selectPreset(item.id)}
                  >
                    <b>{item.title}</b>
                    <small>{item.sub}</small>
                  </button>
                ))}
              </div>

              <div className="hp-cap-table">
                {/* Claude는 체력통으로 % 를 매기지 않는다 (상태줄 사용률만 쓴다). */}
                {snapshot.providers.filter((p) => p.provider !== "claude-code").map((p) => {
                  const cap = draftCaps[p.provider] ?? p.session;
                  return (
                    <div key={p.provider} className="hp-cap-row">
                      <div>
                        <b>{p.label}</b>
                        <small className="hp-cap-sub">{p.code}</small>
                      </div>
                      <label className="hp-cap-field">
                        <span>5시간 세션 체력통</span>
                        <input
                          type="number"
                          min={1000}
                          step={5000}
                          disabled={readOnly || busy}
                          value={cap.sessionTokens}
                          onChange={(e) => {
                            const val = Math.max(1000, Number(e.target.value) || 1000);
                            setDraftCaps((prev) => ({
                              ...prev,
                              [p.provider]: { ...prev[p.provider], sessionTokens: val },
                            }));
                          }}
                        />
                      </label>
                      <label className="hp-cap-field">
                        <span>7일 주간 체력통</span>
                        <input
                          type="number"
                          min={5000}
                          step={50000}
                          disabled={readOnly || busy}
                          value={cap.weeklyTokens}
                          onChange={(e) => {
                            const val = Math.max(5000, Number(e.target.value) || 5000);
                            setDraftCaps((prev) => ({
                              ...prev,
                              [p.provider]: { ...prev[p.provider], weeklyTokens: val },
                            }));
                          }}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              {!readOnly ? (
                <div className="hp-cap-actions">
                  <small>직접 수정한 토큰 한도는 작업 공간(`llm-quota.json`)에 저장됩니다.</small>
                  <button type="button" className="flow-btn primary" disabled={busy} onClick={() => void saveCustomCaps()}>
                    적용
                  </button>
                </div>
              ) : null}
            </div>
          )}

          <div className="hp-pop-foot">
            <span>세션·주간 중 더 낮은 비율을 레일 대표 체력으로 표시</span>
            <button type="button" className="hp-pop-close" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
