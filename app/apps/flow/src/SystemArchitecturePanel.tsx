/** 시안의 책임과 피드백을 고정된 단계·영역으로 읽기 쉽게 보여준다. */
export function SystemArchitecturePanel() {
  const lanes = [
    { title: "01 상담 · 설계", tone: "plan", steps: [["사용자 요구", "목표와 제약 확인"], ["상담 · Plan", "요구 판단과 완료 기준"], ["PRD 검토 · 채택", "사람이 승인하고 버전 확정"]], record: "상담 기록 · 질문 / 결정 / 출처" },
    { title: "02 구현 · 테스트", tone: "test", steps: [["구현 연결", "승인본으로 그래프 준비"], ["테스트 리더 · 작업자", "승인 범위 안에서 작업 배정"], ["Act → Check → Deploy", "실행 · 검증 · 배포"]], record: "테스트 기록 · 실행 / 시험 / 배포 근거" },
    { title: "03 공급자 · 조회", tone: "provider", steps: [["모델 호출", "상담과 테스트의 정책·세션 분리"], ["Claude · Codex · Grok · 로컬", "지원 설정과 권한에 따라 연결"], ["조회 · 알림", "PC·모바일 / MCP / 메신저"]], record: "원본별 권한 검사 · 기록은 참조로 연결" },
  ];
  return <div className="ordered-process" aria-label="상담부터 테스트까지 프로젝트 프로세스"><div className="ordered-process-lanes">{lanes.map(l => <section key={l.title} className={`process-lane is-${l.tone}`}><h4>{l.title}</h4><ol>{l.steps.map(([title, text], i) => <li key={title}><span>{i + 1}</span><div><b>{title}</b><small>{text}</small></div></li>)}</ol><p>{l.record}</p></section>)}</div><div className="process-handoff"><span>상담에서 승인한 설계 → 구현·테스트의 기준</span><span>상담·테스트 → 공급자 호출과 결과 반환</span></div><footer className="process-feedback"><b>↶ 피드백</b><span>구현 오류 → 실행 단계</span><span>요구 변경 → 상담</span><span>기록 평가 → 기능 개선</span></footer></div>;
}
