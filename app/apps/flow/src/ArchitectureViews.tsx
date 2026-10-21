import { useEffect, useState } from "react";
import { ArchitecturePane } from "./ArchitecturePane.js";
import type { AdapterStatus } from "./shellContract.js";
import { ArchitectureStructurePane } from "./ArchitectureStructurePane.js";

/**
 * 아키텍처 칸 — 세 장을 바꿔 본다 (R3.4, 배치 조사 2026-10-17). 실행은 구조의 자식이 아니다: 이번 실행에서 어디가 돌았나를 보는 장이다.
 * 구조는 무엇이 있고 어디에 저장되나, 흐름은 한 일이 어떻게 처리되어 저장되나.
 */
const TABS = [
  { id: "run", label: "실행", hint: "이번 실행에서 어디가 돌았나" },
  { id: "structure", label: "구조", hint: "무엇이 있고 어디에 저장되나" },
  { id: "flow", label: "흐름", hint: "한 일이 어떻게 처리되어 저장되나" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function ArchitectureViews({ project, revision = 0, onOpenStage, onLangGraphStatus }: {
  project: string; revision?: number; onOpenStage: (id: "design") => void; onLangGraphStatus?: (status: AdapterStatus) => void;
}) {
  const [tab, setTab] = useState<Tab>("run");
  useEffect(() => { setTab("run"); }, [project]);
  return <div className="arch-views">
    <nav className="arch-tabs" aria-label="아키텍처 장">
      {TABS.map(item => <button key={item.id} type="button" aria-pressed={tab === item.id} title={item.hint} onClick={() => setTab(item.id)}>{item.label}<small>{item.hint}</small></button>)}
    </nav>
    {tab === "run"
      ? <ArchitecturePane project={project} revision={revision} onOpenStage={onOpenStage} {...(onLangGraphStatus ? { onLangGraphStatus } : {})} />
      : <ArchitectureStructurePane project={project} revision={revision} tab={tab} onTab={setTab} onOpenRun={() => setTab("run")} />}
  </div>;
}
