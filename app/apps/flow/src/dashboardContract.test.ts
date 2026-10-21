import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (name: string) => fs.readFileSync(path.join(here, name), "utf8");
describe("프로젝트 첫 화면 대시보드 계약", () => {
  it("프로젝트를 고를 때 항상 대시보드로 돌아가고 이어하기만 마지막 작업 위치를 연다", () => {
    const app = source("App.tsx");
    expect(app).toMatch(/function pickProject\(alias: string\)[\s\S]*setPlace\("dashboard"\)/);
    expect(app).toMatch(/function continueWork\(action: ResumeAction\)[\s\S]*setPlace\(action\.location\.place\)/);
  });
  it("대시보드 한 화면에 워크플로·태스크·이력을 두고 데스크톱 바깥 스크롤을 막는다", () => {
    const pane = source("DashboardPane.tsx"), css = source("console.css");
    expect(pane).toContain("<ProjectCycleFlow"); expect(pane).toContain("<CycleTaskTable"); expect(pane).toContain("<TodoPane"); expect(pane).toContain("<DashboardHistory");
    expect(css).toMatch(/@media\(min-width:901px\)[\s\S]*\.main-shell\.is-dashboard\{[^}]*overflow:hidden/);
    expect(css).toMatch(/\.main-shell\.is-dashboard>\.main-dashboard-grid\{[^}]*overflow:hidden/);
  });
});

describe("개요 문서 우선·6개 섹션 대체", () => {
  it("개요 버튼은 문서 API를 우선하고 없으면 설계 초안의 여섯 섹션을 보인다", () => {
    const pane = source("DashboardPane.tsx");
    expect(pane).toContain('onClick={() => chooseMain("overview")}>개요</button>');
    expect(pane).toContain('fetch(`/api/overview?alias=${encodeURIComponent(project)}`)');
    expect(pane).toContain("overview ? <OverviewDocument");
    for (const title of ["목적과 대상", "성공 기준", "범위", "구조 · LangGraph", "흐름과 결정", "산출물 · 역할 · 도구"]) {
      expect(pane).toContain(title);
    }
  });
});
