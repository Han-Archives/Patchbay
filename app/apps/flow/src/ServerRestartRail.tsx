import { useEffect, useState } from "react";

type Phase = { kind: "idle" } | { kind: "building" } | { kind: "restarting" } | { kind: "error"; message: string; output?: string };

/**
 * 레일 아래 「서버 다시 켜기」 (사용자 결정 2026-10-26, A안 — 서버가 교대).
 * 누르면 화면 안에서 한 번 더 고르고, 새 서버가 뜨면(pid가 바뀌면) 화면을 새로고침한다.
 * 조회 전용 연결이거나 이 실행 방식에서 다시 켤 수 없으면 보이지 않는다.
 */
export function ServerRestartRail({ readOnly }: { readOnly: boolean }) {
  const [server, setServer] = useState<{ pid: number; canRestart: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    fetch("/api/server", { cache: "no-store" }).then(res => res.ok ? res.json() : null).then(setServer).catch(() => setServer(null));
  }, []);
  if (readOnly || !server?.canRestart) return null;

  const waitForNewServer = async (oldPid: number) => {
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const next = await (await fetch("/api/server", { cache: "no-store" })).json() as { pid?: number };
        if (next.pid && next.pid !== oldPid) { window.location.reload(); return; }
      } catch {
        // 교대 중에는 잠깐 응답이 없다.
      }
    }
    setPhase({ kind: "error", message: "새 서버가 60초 안에 응답하지 않습니다. 터미널에서 서버 상태를 확인해 주세요." });
  };

  const restart = async (build: boolean) => {
    setPhase(build ? { kind: "building" } : { kind: "restarting" });
    try {
      const res = await fetch("/api/server/restart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ build }) });
      const body = await res.json() as { error?: string; output?: string; pid?: number };
      if (!res.ok) { setPhase({ kind: "error", message: body.error ?? "다시 켜지 못했습니다.", ...(body.output ? { output: body.output } : {}) }); return; }
      setPhase({ kind: "restarting" });
      await waitForNewServer(body.pid ?? server.pid);
    } catch {
      setPhase({ kind: "error", message: "서버에 연결하지 못했습니다." });
    }
  };

  const working = phase.kind === "building" || phase.kind === "restarting";
  return (
    <>
      <button type="button" className={`rail-side rail-restart${open ? " is-on" : ""}`} title="서버 다시 켜기" aria-expanded={open} onClick={() => setOpen(prev => !prev)}>
        <span aria-hidden="true">↻</span>RS
      </button>
      {open ? (
        <aside className="hp-popover server-restart-pop" role="dialog" aria-label="서버 다시 켜기">
          <div className="hp-pop-head">
            <div className="hp-pop-title">
              <b>서버 다시 켜기</b>
              <small>같은 설정으로 새 서버를 띄우고 지금 서버를 끕니다.</small>
            </div>
          </div>
          <div className="server-restart-body">
            {phase.kind === "building" ? <p>빌드하는 중입니다. 1~2분 걸릴 수 있습니다. 실패하면 서버는 그대로 둡니다.</p>
              : phase.kind === "restarting" ? <p>다시 켜는 중입니다. 새 서버가 뜨면 화면이 저절로 새로고침됩니다.</p>
              : <p>코드를 고쳤으면 「빌드하고 다시 켜기」를 고릅니다. LLM이 일하는 중이면 거절됩니다.</p>}
            {phase.kind === "error" ? (
              <div className="server-restart-error" role="alert">
                <b>{phase.message}</b>
                {phase.output ? <pre>{phase.output}</pre> : null}
              </div>
            ) : null}
            <div className="server-restart-actions">
              <button type="button" className="flow-btn primary" disabled={working} onClick={() => void restart(true)}>빌드하고 다시 켜기</button>
              <button type="button" className="flow-btn" disabled={working} onClick={() => void restart(false)}>그냥 다시 켜기</button>
              <button type="button" className="flow-btn" disabled={working} onClick={() => { setOpen(false); setPhase({ kind: "idle" }); }}>닫기</button>
            </div>
          </div>
        </aside>
      ) : null}
    </>
  );
}
