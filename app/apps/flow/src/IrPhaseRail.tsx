import { useState, type ReactNode } from "react";
import { phaseOf, type IrCellGuide } from "./irContract.js";

/**
 * 1단계의 칸을 위에서 아래로 내려가는 프로세스로 그린다.
 *
 * 칸은 순서가 있다 — 1.0이 「모델이 필요하다」를 내면 1.2·1.3·1.5가 따라 움직인다.
 * 격자로 펼치면 그 순서가 안 보인다. 누른 Phase의 창은 이 목록 **옆**에 열고,
 * 목록 자체는 접지 않는다: 어디까지 왔는지가 창을 여는 동안에도 보여야 한다.
 * 폭이 좁으면 창이 목록 아래로 내려간다.
 */

export type PhaseTone = "ok" | "declared" | "partial" | "empty" | "fail" | "invalid" | "unknown" | "locked";

export interface PhaseStep {
  /** 명세의 칸 번호 (1.0 ~ 1.9). */
  id: string;
  label: string;
  tone: PhaseTone;
  status: string;
  detail?: ReactNode;
}

export function PhaseRail({
  steps,
  selected,
  onSelect,
  guides,
  children,
}: {
  steps: PhaseStep[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** 칸마다 묻는 말과 예시. 칸 이름 아래 질문 한 줄, 「예시」를 누르면 본보기가 열린다. */
  guides?: Record<string, IrCellGuide>;
  /** 누른 Phase의 창. 목록 옆 칸에 놓인다. */
  children?: ReactNode;
}) {
  const [exampleOf, setExampleOf] = useState<string | null>(null);
  return (
    <div className="phase">
      <p className="phase-legend">
        설계도의 칸입니다. <b>0</b>은 다루는 것들(맨 아래 층)이고 1~9가 그 위에 섭니다. 설문으로 만든 뒤 여기서 검사 결과를 보고 직접 고칠 수 있습니다.
      </p>
      <div className="phase-layout">
        <ol className="phase-rail">
          {steps.map((step) => {
            const phase = phaseOf(step.id);
            const open = selected === step.id;
            const guide = guides?.[step.id];
            const showing = exampleOf === step.id;
            return (
              <li key={step.id} className={`phase-step is-${step.tone}${open ? " is-open" : ""}`}>
                <button
                  type="button"
                  className="phase-btn"
                  data-cell={step.id}
                  aria-expanded={open}
                  title={`명세의 칸 번호 ${step.id}`}
                  onClick={() => onSelect(open ? null : step.id)}
                >
                  {/* 번호는 동그라미 하나만 — 「Phase 6 · 1.5」 두 겹 번호를 줄였다 (디자인 개편 걷기 10). */}
                  <span className="phase-dot" aria-hidden="true">
                    {phase ?? "✓"}
                  </span>
                  <span className="phase-body">
                    <span className="phase-head">
                      {phase !== null ? null : <b className="phase-name">최종 검사</b>}
                      <span className="phase-label">{step.label}</span>
                      <span className="phase-status">{step.status}</span>
                    </span>
                    {guide ? <span className="phase-ask">{guide.ask}</span> : null}
                    {step.detail ? <span className="phase-detail">{step.detail}</span> : null}
                  </span>
                </button>
                {guide ? (
                  <button
                    type="button"
                    className="phase-ex-btn"
                    aria-expanded={showing}
                    aria-label={`${step.label} 예시`}
                    onClick={() => setExampleOf(showing ? null : step.id)}
                  >
                    예시
                  </button>
                ) : null}
                {guide && showing ? <CellExample guide={guide} /> : null}
              </li>
            );
          })}
        </ol>
        <div className="phase-side">{children}</div>
      </div>
    </div>
  );
}

/** 프로세스 옆에 열리는 창의 틀. */
export function PhaseWindow({
  id,
  label,
  guide,
  actions,
  onClose,
  children,
}: {
  id: string;
  label: string;
  guide?: IrCellGuide;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const phase = phaseOf(id);
  const [showExample, setShowExample] = useState(false);
  return (
    <section className="phase-window" data-window={id}>
      <header className="phase-window-head">
        <b>{phase !== null ? `${phase} · ${label}` : `최종 검사 · ${label}`}</b>
        <span className="ir-grow" />
        {guide ? (
          <button type="button" className="flow-btn" aria-expanded={showExample} onClick={() => setShowExample((v) => !v)}>
            {showExample ? "예시 닫기" : "예시 보기"}
          </button>
        ) : null}
        {actions}
        <button type="button" className="flow-btn phase-close" aria-label="닫기" title="닫기" onClick={onClose}>
          ×
        </button>
      </header>
      {guide ? <p className="cell-edit-ask">{guide.ask}</p> : null}
      {guide && showExample ? <CellExample guide={guide} /> : null}
      {children}
    </section>
  );
}

/**
 * 한 칸의 본보기 — 왜 묻나, 이렇게 적는다, 그리고 가상 에이전트 「메모 갈래 나누기」로 적은 예.
 * Phase 목록의 「예시」와 칸 편집기의 「예시 보기」가 같은 것을 그린다.
 */
export function CellExample({ guide }: { guide: IrCellGuide }) {
  return (
    <div className="phase-example">
      <p className="phase-example-why">{guide.why}</p>
      <ul className="phase-example-how">
        {guide.how.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="phase-example-tag">예 · 메모 갈래 나누기 (가상 에이전트)</p>
      <dl className="phase-example-lines">
        {guide.example.map((line) => (
          <div key={line.label}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
