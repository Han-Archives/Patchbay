import { stageMeta, type StageId, type StageTone, type WorkspaceProject } from "./workspaceContract.js";

const TONE_LABEL: Record<StageTone, string> = {
  done: "지남",
  now: "지금",
  blocked: "막힘",
  locked: "잠김",
};

/**
 * 현황 — 이 프로젝트에서 다음에 할 일 하나와 프로젝트의 사실.
 *
 * 프로젝트 카드 줄과 단계 길은 두지 않는다. 프로젝트는 레일이, 단계 상태는 위의 띠가
 * 이미 말한다 — 여기서 또 말하면 같은 상태 문장이 한 화면에 다섯 번 나온다 (디자인 개편 걷기 04).
 */
export function WorkspaceHome({
  projects,
  selected,
  onOpenStage,
  onHide,
}: {
  projects: WorkspaceProject[];
  selected: string;
  onOpenStage: (id: StageId) => void;
  /** 레일에서 숨기기 — 등록은 그대로 둔다. */
  onHide?: (alias: string) => void;
}) {
  const current = projects.find((p) => p.alias === selected) ?? projects[0];
  if (!current) {
    return (
      <div className="empty">
        <h2>등록된 프로젝트가 없습니다</h2>
        <p>왼쪽 「+」로 폴더를 등록한다.</p>
      </div>
    );
  }

  const now = current.stages.find((s) => s.id === current.current)!;
  const meta = stageMeta(current.current);

  return (
    <div className="ws-home">
      <h2>현황</h2>
      <section className="ws-detail">
        <div className={`card ws-next is-${now.tone}`}>
          <span className="sec-title">다음 할 일</span>
          <b>
            {meta.num} {meta.label}
          </b>
          <p>{now.next}</p>
          {now.detail ? <p className="small muted">{now.detail}</p> : null}
          <button type="button" className="flow-btn primary" onClick={() => onOpenStage(current.current)}>
            {meta.label} 열기
          </button>
        </div>
        <div className="card ws-facts">
          <span className="sec-title">이 프로젝트</span>
          <div>
            <span>이름</span>
            <span>
              {current.name ?? current.alias}
              {current.name ? <code className="muted"> {current.alias}</code> : null}
            </span>
          </div>
          <div>
            <span>폴더</span>
            <code>{current.path}</code>
          </div>
          <div>
            <span>최근</span>
            {current.latest ? (
              <span>
                {current.latest.summary}
                {current.latest.step ? ` · ${current.latest.step}` : ""}
              </span>
            ) : (
              <span className="muted">진행 기록 없음</span>
            )}
          </div>
          <div>
            <span>상태</span>
            <span>{TONE_LABEL[now.tone]}</span>
          </div>
          {onHide ? (
            <button type="button" className="flow-btn ws-hide" onClick={() => onHide(current.alias)}>
              레일에서 숨기기
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
