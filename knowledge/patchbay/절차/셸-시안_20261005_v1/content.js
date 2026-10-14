// 세 시안이 같은 내용을 쓴다 — practice 프로젝트, 1 설계 「검사 26/26 통과 · 채택 대기」 (실측 2026-10-05).
const STAGES = [
  ["0", "구조", "스캔됨 · 항목 1", "ok"],
  ["1", "설계", "26/26 통과 · 채택 대기", "now"],
  ["2", "구현", "설계 채택 뒤", "lock"],
  ["3", "지식 그래프", "구현 뒤", "lock"],
  ["4", "문서 호출", "지식 그래프 뒤", "lock"],
  ["5", "운영", "구현 뒤", "lock"],
];
const PHASES = [
  ["1.0", "에이전트가 필요한가"], ["1.1", "목적과 완료 조건"], ["1.2", "권한 경계"],
  ["1.3", "정보 경계"], ["1.4", "State — 넷리스트"], ["1.5", "노드와 연결"],
  ["1.6", "문서 의존"], ["1.7", "요구사항 문장"], ["1.8", "평가와 추적 표"],
];
function band(current = "1") {
  return STAGES.map(([n, name, status, tone]) =>
    `<button class="st ${tone}" ${n === current ? 'aria-current="page"' : ""} ${tone === "lock" ? "disabled" : ""}>
       <b><i>${n}</i>${name}</b><small>${status}</small></button>`).join("");
}
function design() {
  return `
  <div class="head">
    <h2>설계</h2><span class="crumb">1단계 · 요구사항을 IR로 적고 검사한다</span>
    <span class="pill ok">검사 26 / 26 통과</span>
    <span class="grow"></span>
    <button class="btn ghost">초안 · 승인본 비교</button>
    <button class="btn primary">이 초안을 채택</button>
  </div>
  <div class="design">
    <ol class="phases">
      ${PHASES.map(([id, t], i) => `<li ${i === 5 ? 'aria-current="true"' : ""}><span class="dot">${i + 1}</span><span><b>${t}</b></span><span class="tick">통과</span></li>`).join("")}
      <li><span class="dot">✓</span><span><b>최종 검사</b><small>아홉 칸이 다 통과했다</small></span><span class="tick">통과</span></li>
    </ol>
    <section class="win">
      <div class="head"><h3>6 · 노드와 연결</h3><span class="pill ok">통과</span><span class="grow"></span><button class="btn">고치기</button></div>
      <p>에이전트가 거치는 단계(노드)와 그 순서(연결)를 적는다.</p>
      <div class="mini"><span class="node">시작</span><span class="edge"></span><span class="node mid">classify · 갈래 판정</span><span class="edge"></span><span class="node">끝</span></div>
      <div>
        <div class="row"><span>노드</span><span>classify — 메모 한 줄을 받아 갈래 하나를 고른다</span></div>
        <div class="row"><span>거절 · 시간 초과</span><span>갈래를 비우고 error 에 이유를 적는다</span></div>
        <div class="row"><span>쓰는 모델</span><span><code>claude-haiku-4-5</code></span></div>
      </div>
      <p class="term"><b>IR</b> — 에이전트 설계를 기계가 검사할 수 있게 적은 파일. <b>채택</b>하면 승인본이 되고 2 구현이 열린다.</p>
    </section>
  </div>`;
}
document.querySelectorAll("[data-band]").forEach((el) => (el.innerHTML = band()));
document.querySelectorAll("[data-design]").forEach((el) => (el.innerHTML = design()));
