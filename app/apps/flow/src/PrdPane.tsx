import { useEffect, useState } from "react";
import type { Architecture, PrdReviewStatus, PrdSection } from "@patchbay/core";
import { ArchPanel } from "./ArchPanel.js";
import { CheckNotice, FormatNotice, TIDY_REQUIREMENTS } from "./ConsultPane.js";

/**
 * 1 설계 — PRD 검토 (명세 20261006a §14).
 *
 * PRD는 초안에서 Core가 결정적으로 그린다. 사람은 절마다 「맞아요 / 고쳐 주세요」를 누르고, 고칠 말은
 * 상담으로 이어 간다. 내용이 바뀐 절은 저절로 「확인 전」으로 돌아간다(절 지문). 11절이 모두 맞아요이고
 * 검사가 통과해야 채택 버튼이 켜진다.
 */

interface PrdBody {
  status: "ready" | "none";
  error?: string;
  sections?: PrdSection[];
  review?: PrdReviewStatus;
  architecture?: Architecture;
  format?: { field: string; count: number }[];
  formatRequest?: string | null;
  checks?: { id: string; what: string; note: string }[];
  checkRequest?: string | null;
}

const SOURCE_LABEL: Record<string, string> = { said: "말함", inferred: "해석", default: "기본값", manual: "직접" };

export function PrdPane({
  project,
  revision,
  onFix,
  onGoBuild,
}: {
  project: string;
  revision: number;
  /** 「고쳐 주세요」의 말을 상담으로 넘긴다. `raw` 면 말 그대로. */
  onFix: (n: number, note: string, raw?: boolean) => void;
  onGoBuild: () => void;
}) {
  const [prd, setPrd] = useState<PrdBody | null>(null);
  const [fixing, setFixing] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState<{ passed: boolean; failed: string[] } | null>(null);
  /** 초안이 승인본과 같으면 채택해도 버전 번호만 바뀐다 — 버튼을 끈다. */
  const [sameAsApproved, setSameAsApproved] = useState(false);
  const [adoptNote, setAdoptNote] = useState<string | null>(null);
  const [adopted, setAdopted] = useState(false);
  const [onlyToCheck, setOnlyToCheck] = useState(false);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  function openSection(n: number) {
    document.getElementById(`prd-sec-${n}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setFlash(n);
    window.setTimeout(() => setFlash((cur) => (cur === n ? null : cur)), 1600);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/prd?alias=${encodeURIComponent(project)}`)
      .then((res) => res.json() as Promise<PrdBody>)
      .then((body) => !cancelled && setPrd(body))
      .catch(() => undefined);
    fetch(`/api/ir?alias=${encodeURIComponent(project)}&source=proposed`)
      .then((res) => res.json() as Promise<{ status?: string; passed?: boolean; checks?: { id: string; ok: boolean | null }[]; diff?: { identical?: boolean } | null }>)
      .then((body) => {
        if (cancelled) return;
        setSameAsApproved(body.diff?.identical === true);
        // 초안이 아직 IR 형식이 아니면(drafting) 검사를 돌릴 수 없다 — 채택도 없다.
        setChecks(
          body.status === "ready" && Array.isArray(body.checks)
            ? { passed: body.passed === true, failed: body.checks.filter((c) => c.ok === false).map((c) => c.id) }
            : { passed: false, failed: ["초안이 아직 설계도 형식이 아니다"] },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project, revision, tick]);

  async function mark(n: number, state: "ok" | "fix", text?: string) {
    const res = await fetch("/api/prd/mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project, n, state, ...(text ? { note: text } : {}) }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setAdoptNote(body.error ?? "표시하지 못했다");
      return;
    }
    if (state === "fix" && text) onFix(n, text);
    setFixing(null);
    setNote("");
    setTick((t) => t + 1);
  }

  async function adopt() {
    setAdoptNote(null);
    const res = await fetch("/api/ir/adopt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: project }),
    });
    const body = (await res.json()) as { ok?: boolean; version?: number; error?: string };
    if (res.ok && body.ok) {
      setAdopted(true);
      setAdoptNote(`채택했다 — v${body.version}`);
    } else setAdoptNote(body.error ?? "채택하지 못했다");
  }

  if (!prd) return <p className="muted">불러오는 중…</p>;
  if (prd.status !== "ready" || !prd.sections || !prd.review) {
    return (
      <div className="prd-empty">
        <b>아직 초안이 없습니다.</b>
        <p>상담을 시작하면 초안이 생기고, 여기서 PRD로 확인합니다.</p>
      </div>
    );
  }

  const review = prd.review;
  const okCount = review.sections.filter((s) => s.state === "ok").length;
  const canAdopt = review.allOk && checks?.passed === true && !sameAsApproved;

  return (
    <div className="prd-layout">
    <div className="prd">
      <header className="prd-head">
        <div>
          <h2>PRD 초안</h2>
          <p className="muted">
            {okCount} / {prd.sections.length}절 확인 · 검사 {checks ? (checks.passed ? "통과" : `막힘 ${checks.failed.length}`) : "—"}
          </p>
        </div>
        <label className="prd-filter">
          <input type="checkbox" checked={onlyToCheck} onChange={(e) => setOnlyToCheck(e.target.checked)} /> 해석 · 기본값 줄만
        </label>
        <button type="button" className="flow-btn primary" disabled={!canAdopt || adopted} onClick={() => void adopt()}>
          채택
        </button>
      </header>
      {sameAsApproved && !adopted ? <p className="prd-gate is-done">이 초안은 이미 채택한 판과 같다 — 상담에서 고치면 다시 채택할 수 있다.</p> : null}
      {prd.format?.length ? <FormatNotice format={prd.format} onFix={() => prd.formatRequest && onFix(0, prd.formatRequest, true)} /> : null}
      {!prd.format?.length && prd.checks?.length ? <CheckNotice checks={prd.checks} onFix={() => prd.checkRequest && onFix(0, prd.checkRequest, true)} /> : null}
      {!canAdopt && !adopted && !sameAsApproved ? (
        <p className="prd-gate">
          {!review.allOk ? "11절이 모두 「맞아요」여야 채택할 수 있다. " : ""}
          {checks && !checks.passed && !prd.checks?.length ? `검사가 막는다: ${checks.failed.join(", ")} — 설계도와 검사 탭에서 본다.` : ""}
        </p>
      ) : null}
      {adoptNote ? (
        <p className="ir-note">
          {adoptNote}
          {adopted ? (
            <button type="button" className="flow-btn" onClick={onGoBuild}>
              2 구현으로
            </button>
          ) : null}
        </p>
      ) : null}

      {prd.sections.map((section) => {
        const state = review.sections.find((s) => s.n === section.n);
        const lines = onlyToCheck ? section.lines.filter((l) => l.source === "inferred" || l.source === "default") : section.lines;
        return (
          <section key={section.n} id={`prd-sec-${section.n}`} className={`prd-sec is-${state?.state ?? "pending"}${flash === section.n ? " is-flash" : ""}`}>
            <div className="prd-sec-head">
              <h3>
                <i>{section.n}</i> {section.title}
                <small>{section.gates.join(" · ")}</small>
              </h3>
              <span className="prd-state">
                {state?.state === "ok" ? "맞아요" : state?.state === "fix" ? "고침 요청" : state?.stale ? "바뀜 — 다시 확인" : "확인 전"}
              </span>
            </div>
            <ul>
              {lines.map((line, i) => (
                <li key={`${line.path}-${i}`} className={`prd-line src-row-${line.source}`}>
                  <span className={`src src-${line.source}`}>{SOURCE_LABEL[line.source] ?? line.source}</span>
                  <span>
                    {line.text}
                    {line.detail ? (
                      <>
                        {" "}
                        <button type="button" className="prd-more" onClick={() => setOpenDetail((cur) => (cur === line.path ? null : line.path))}>
                          {openDetail === line.path ? "원문 접기" : "원문"}
                        </button>
                        {openDetail === line.path ? <span className="prd-detail">{line.detail}</span> : null}
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
              {lines.length === 0 ? <li className="muted">확인할 해석 · 기본값 줄이 없다</li> : null}
            </ul>
            {state?.note && state.state === "fix" ? <p className="prd-note">고칠 것: {state.note}</p> : null}
            {fixing === section.n ? (
              <form
                className="prd-fix"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mark(section.n, "fix", note);
                }}
              >
                <input aria-label="무엇을 고칠까요" value={note} onChange={(e) => setNote(e.target.value)} placeholder="무엇을 고칠지 한 줄 — 상담으로 갑니다" autoFocus />
                <button type="submit" className="flow-btn primary" disabled={!note.trim()}>
                  상담으로 보내기
                </button>
                <button type="button" className="flow-btn" onClick={() => setFixing(null)}>
                  취소
                </button>
              </form>
            ) : (
              <div className="prd-actions">
                {section.n === 10 && section.lines.some((l) => l.path.startsWith("requirements[")) ? (
                  <button type="button" className="flow-btn" onClick={() => onFix(10, TIDY_REQUIREMENTS)} title="맞춤법 · 「시스템은」 · 긴 문장을 상담자가 정리한다">
                    요구사항 정리
                  </button>
                ) : null}
                <button type="button" className="flow-btn" onClick={() => void mark(section.n, "ok")} disabled={state?.state === "ok"}>
                  맞아요
                </button>
                <button type="button" className="flow-btn" onClick={() => setFixing(section.n)}>
                  고쳐 주세요
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
    <aside className="prd-arch" aria-label="아키텍처">
      <div className="prd-arch-head">
        <h3>아키텍처</h3>
        <small>PRD와 같은 초안에서 그린다</small>
      </div>
      <ArchPanel architecture={prd.architecture ?? { blocks: [], links: [] }} onOpenSection={openSection} />
    </aside>
    </div>
  );
}
