import { useEffect } from "react";
import type { ActionRequest } from "./userAction.js";
import type { WorkspacePlace } from "./workspaceNavigation.js";

/** 비동기로 열린 단계 화면에서도 실제로 조작할 수 있는 첫 위치를 표시한다. */
export function useStageActionCue(request: ActionRequest | undefined, place: WorkspacePlace) {
  useEffect(() => {
    const target = request?.action.target;
    if (target?.kind !== "stage" || target.place !== place) return;
    const root = document.querySelector(".pane");
    if (!root) return;
    const selectors = target.place === "design"
      ? target.designTab === "prd" ? [".prd-sec:not(.is-ok) .prd-actions", ".prd-head button:not(:disabled)"] : [".consult textarea:not(:disabled)", "textarea:not(:disabled)"]
      : [".ex-req.is-proposed .ex-req-head", ".bd-act button:not(:disabled)", ".use-pane button:not(:disabled)"];
    let marked: Element | null = null;
    function update() {
      const next = selectors.flatMap(s => [...root!.querySelectorAll<HTMLElement>(s)]).find(el => el.getClientRects().length > 0) ?? null;
      if (next === marked) return;
      marked?.classList.remove("user-action-pulse"); marked = next;
      marked?.classList.add("user-action-pulse");
      marked?.scrollIntoView({ block: "nearest" });
    }
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled"] });
    update();
    return () => { observer.disconnect(); marked?.classList.remove("user-action-pulse"); };
  }, [request, place]);
}

/** 실행·모델 호출 없이 지금 사람이 해야 할 조작을 대화창에 안내한다. */
export function UserActionGuide({ request, onReturn, onDismiss }: { request: ActionRequest; onReturn: () => void; onDismiss: () => void }) {
  const { action } = request;
  return <section className="user-action-guide" aria-label="지금 할 일 안내" role="status">
    <header><span>지금 하실 일</span><button type="button" onClick={onDismiss} aria-label="할 일 안내 닫기">×</button></header>
    <b>{action.title}</b>
    <p>{action.reason}</p>
    <ol>{action.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <button type="button" className="flow-btn" onClick={onReturn}>해야 할 화면 다시 열기 ↗</button>
  </section>;
}
