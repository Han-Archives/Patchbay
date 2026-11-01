/* Standalone design prototype. All records below are invented examples. No API requests. */
const steps = ['설계', '구현', '테스트', 'Review', '결과'];
const stageIds = ['design', 'build', 'test', 'review', 'result'];
const sampleProjects = [
  { id: 'patchbay', name: 'Patchbay', initial: 'P', bg: '#e5ddee', ink: '#684d81', description: '프로젝트와 Agent 작업을 한곳에서', stage: 3, status: 'turn', statusLabel: '내 차례', version: 'v3', summary: '평가 결과와 근거 검토', next: '평가 항목별 결과와 첨부된 근거를 확인합니다.', latest: '평가 근거가 등록되었습니다.', time: '12분 전', age: 12, task: '평가 결과 검토' },
  { id: 'document-search', name: '문서 검색', initial: '문', bg: '#dde9ed', ink: '#3d687a', description: '문서를 찾고 답변의 출처를 확인', stage: 2, status: 'running', statusLabel: '실행 중', version: 'v2', summary: '검색 응답 비교 테스트 실행 중', next: '실행이 끝나면 답변과 출처를 비교합니다.', latest: '검색 응답 비교를 시작했습니다.', time: '3분 전', age: 3, task: '검색 응답 비교 테스트' },
  { id: 'research-helper', name: '리서치 도우미', initial: '리', bg: '#e1e5d8', ink: '#57673d', description: '자료를 수집하고 근거를 정리', stage: 2, status: 'problem', statusLabel: '문제 있음', version: 'v1', summary: '출처 누락 테스트 2건 확인 필요', next: '실패한 테스트 2건의 근거와 요구사항을 확인합니다.', latest: '출처 누락 테스트가 실패했습니다.', time: '38분 전', age: 38, task: '실패한 테스트 확인' },
  { id: 'work-automation', name: '업무 자동화', initial: '업', bg: '#eae0d4', ink: '#7a6041', description: '반복 업무의 조건과 실행을 연결', stage: 0, status: 'normal', statusLabel: '작성 중', version: 'v1', summary: '반복 작업의 실행 조건 정리', next: '언제 실행하고 언제 멈출지 요구사항에 적습니다.', latest: '자동화할 작업을 정리했습니다.', time: '어제', age: 1440, task: '자동화 조건 작성' },
  { id: 'meeting-notes', name: '회의록 정리', initial: '회', bg: '#e5dfe8', ink: '#70567d', description: '회의 내용을 정리하고 할 일 추출', stage: 3, status: 'turn', statusLabel: '내 차례', version: 'v1', summary: '문서 저장 준비본 검토 대기', next: '준비본의 저장 위치와 문서 구성을 검토합니다.', latest: '문서 저장 준비본이 도착했습니다.', time: '1시간 전', age: 60, task: '회의록 저장 규칙 확인' },
  { id: 'personal-wiki', name: '개인 위키', initial: '개', bg: '#dfdfdf', ink: '#626262', description: '개인 문서와 메모를 연결', stage: 0, status: 'normal', statusLabel: '기록 없음', version: 'v1', summary: '첫 작업 기록을 남겨 보세요', next: '프로젝트 개요를 확인하고 첫 작업을 시작합니다.', latest: '진행 기록 없음', time: '기록 없음', age: 99999, task: '프로젝트 시작', hidden: true },
];
const qs = new URLSearchParams(location.search);
const fromUrl = location.hash.slice(1) || qs.get('variant');
const state = { variant: ['a','b','c'].includes(fromUrl) ? fromUrl : 'a', filter: 'all', query: '', hidden: false, sort: 'recent', focus: 'research-helper', homeView: 'projects' };
const main = document.querySelector('main');
const dialog = document.querySelector('#detail');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projectById = id => sampleProjects.find(p => p.id === id);
const icon = p => `<span class="project-icon" style="--icon-bg:${p.bg};--icon-ink:${p.ink}" aria-hidden="true">${p.initial}</span>`;
const chip = p => `<span class="chip ${p.status === 'normal' ? 'neutral' : p.status}">${p.status === 'running' ? '<span class="status-dot running"></span>' : ''}${p.statusLabel}</span>`;
const visibleProjects = () => sampleProjects.filter(p => (state.hidden || !p.hidden) && matchesSearch([p.name,p.description,p.id].join(' ')));
function filteredProjects() {
  const list = visibleProjects().filter(p => state.filter === 'all' || p.status === state.filter);
  return list.sort(state.sort === 'name' ? (a,b) => a.name.localeCompare(b.name, 'ko') : (a,b) => a.age-b.age);
}
function miniFlow(p) {
  return `<div class="mini-flow" role="img" aria-label="${esc(p.name)}의 예시 단계: ${steps[p.stage]}">${steps.map((label,i) => `${i ? '<span class="mini-arrow" aria-hidden="true">›</span>' : ''}<span class="mini-step ${i<p.stage?'done':i===p.stage?'now':'next'}" style="--stage:var(--${stageIds[i]})">${i<p.stage?'<span aria-hidden="true">✓</span>':''}${label}</span>`).join('')}</div>`;
}
function heading(eyebrow, title, subtitle) {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="date-tag"><b>10월 31일 토요일</b>작업 공간 · 예시</div></div>`;
}
function stats() {
  return `<section class="stats" aria-label="전체 프로젝트 예시 요약">
    <button class="stat" data-filter="all"><span><span class="label">전체 프로젝트</span><span class="sub">숨긴 프로젝트 1개 포함</span></span><strong>6</strong></button>
    <button class="stat purple" data-filter="turn"><span><span class="label">내 차례</span><span class="sub">검토하거나 답할 프로젝트</span></span><strong>2</strong></button>
    <button class="stat" data-filter="running"><span><span class="label">실행 중</span><span class="sub">Agent가 작업하는 프로젝트</span></span><strong>1</strong></button>
    <button class="stat red" data-filter="problem"><span><span class="label">문제 있음</span><span class="sub">실패 원인을 확인할 프로젝트</span></span><strong>1</strong></button>
  </section>`;
}
function filters() {
  return `<nav class="filters" aria-label="프로젝트 상태 필터">${[['all','전체',state.hidden?6:5],['turn','내 차례',2],['running','실행 중',1],['problem','문제 있음',1]].map(([key,label,n]) => `<button class="filter" data-filter="${key}" aria-pressed="${state.filter===key}">${label}<span>${n}</span></button>`).join('')}</nav>`;
}
function controls(title) {
  return `<div class="section-head"><h2>${title}<span class="count">${filteredProjects().length}</span></h2><div class="section-actions"><label class="check-label"><input id="show-hidden" type="checkbox" ${state.hidden?'checked':''}>숨긴 프로젝트 포함</label><select class="sort-select" id="sort" aria-label="프로젝트 정렬"><option value="recent" ${state.sort==='recent'?'selected':''}>최근 기록순</option><option value="name" ${state.sort==='name'?'selected':''}>이름순</option></select></div></div>${filters()}`;
}
function empty() {
  return `<div class="empty"><h2>일치하는 프로젝트가 없습니다</h2><p>검색어나 상태 필터를 바꿔 보세요.</p><button class="button small" data-reset>전체 프로젝트 보기</button></div>`;
}
function card(p) {
  return `<article class="project-card" data-project="${p.id}"><div class="card-heading">${icon(p)}<div><h3>${p.name}</h3><small>${p.version} · ${steps[p.stage]}${p.hidden?' · 숨김':''}</small></div>${chip(p)}</div><p class="card-summary">${p.summary}</p>${miniFlow(p)}${projectArtifactAction(p)}<div class="card-foot"><time>${p.time}</time><button data-open="${p.id}" data-destination="${steps[p.stage]}">프로젝트 열기 ↗</button></div></article>`;
}
function renderA() {
  const p=projectById('patchbay'), searching=Boolean(state.query.trim());
  return `${heading('YOUR WORKSPACE', '모든 프로젝트, 여기서 이어갑니다.', '프로젝트의 현재 상태와 Patchbay에서 만든 결과물을 한곳에서 확인하세요.')}${stats()}
    ${searching?'':`<div class="top-panels"><section class="panel continue-panel" aria-label="최근 작업 이어하기">${icon(p)}<div><div class="eyebrow">이어서 할 작업</div><h2>Patchbay <span class="muted">/</span> 평가 결과 검토</h2><p>최근 열었던 화면 · Review · ${p.time}</p></div><button class="button primary" data-open="patchbay" data-destination="최근 작업 · Review">이어하기 →</button></section>
    <section class="panel attention-panel" aria-label="내가 확인할 일"><div class="panel-title"><h2>내가 확인할 일 <span class="count">2</span></h2><button class="button quiet" data-switch="b">할 일 모아보기 ↗</button></div><div class="attention-row"><span class="status-dot"></span><button data-open="patchbay" data-destination="Review">Patchbay<small>평가 결과와 근거 검토</small></button><span>↗</span></div><div class="attention-row"><span class="status-dot"></span><button data-open="meeting-notes" data-destination="할일 대화방">회의록 정리<small>문서 저장 준비본 검토</small></button><span>↗</span></div></section></div>`}
    ${renderHomeLibrary()}
    <div class="bottom-note"><span>단계는 프로젝트 기록을 기준으로 표시합니다.</span><button class="button quiet" data-switch="c">단계별로 비교하기 →</button></div>`;
}
const tasks = [
  {project:'patchbay',kind:'turn',reason:'평가 결과 확인',title:'이번 판의 평가 결과와 근거를 검토해 주세요.',description:'항목별 결과와 첨부된 화면을 확인할 차례입니다.',action:'Review 열기',destination:'Review',order:1},
  {project:'meeting-notes',kind:'turn',reason:'준비본 검토',title:'회의록을 저장할 위치와 구성을 확인해 주세요.',description:'준비본을 읽고 수정할 점을 해당 대화방에서 정합니다.',action:'준비본 보기',destination:'할일 대화방 · 준비본',order:1},
  {project:'research-helper',kind:'problem',reason:'테스트 실패',title:'답변에서 출처가 빠진 테스트 2건이 있습니다.',description:'실패한 항목과 연결된 요구사항을 함께 확인합니다.',action:'실패 항목 보기',destination:'테스트 · 실패 항목',order:2},
  {project:'work-automation',kind:'next',reason:'다음 작업',title:'반복 업무의 실행 조건을 정리합니다.',description:'자동으로 실행할 조건과 사람이 확인할 조건을 구분합니다.',action:'요구사항 열기',destination:'설계 · 요구사항',order:1},
  {project:'document-search',kind:'running',reason:'Agent 작업 중',title:'검색 응답 비교 테스트를 실행하고 있습니다.',description:'실행이 끝난 뒤 결과를 확인할 수 있습니다.',action:'실행 보기',destination:'대화방 · 실행 기록',order:1},
];
function taskItem(t) {
  const p=projectById(t.project);
  return `<article class="task-item"><div class="task-item-top"><span class="status-dot ${t.kind==='problem'?'red':''}"></span>${p.name}<span> / ${steps[p.stage]}</span><span class="chip ${t.kind==='problem'?'problem':t.kind==='next'?'neutral':''}">${t.reason}</span></div><h3>${t.title}</h3><p>${t.description}</p><div class="task-item-bottom"><span>프로젝트 할일 #${t.order} · ${p.time}</span><button class="button small" data-open="${p.id}" data-destination="${t.destination}">${t.action} ↗</button></div></article>`;
}
function renderB() {
  const rows=tasks.filter(t => visibleProjects().some(p=>p.id===t.project) && (state.filter==='all'?t.kind!=='running':t.kind===state.filter));
  const groups=[['turn','지금 내 차례','검토와 답변이 필요한 일'],['problem','문제를 확인할 일','다음 단계로 가기 전에'],['next','이어서 할 일','프로젝트 안의 할일 순서를 유지'],['running','Agent 실행 중','결과를 기다리고 있는 일']];
  return `${heading('FOCUS ON WHAT’S NEXT', '오늘, 무엇부터 할까요?', '프로젝트마다 흩어진 할 일을 모아 내가 할 일부터 확인합니다.')}${stats()}
    <div class="task-layout"><nav class="task-nav" aria-label="할일 보기"><h2>할일 보기</h2>${[['all','전체 할일',4],['turn','내 차례',2],['problem','문제 있음',1],['next','이어서 할 일',1]].map(([id,label,n])=>`<button data-filter="${id}" aria-pressed="${state.filter===id}">${label}<span>${n}</span></button>`).join('')}<div class="nav-divider"></div><h2>프로젝트 바로가기</h2>${sampleProjects.filter(p=>!p.hidden).map(p=>`<button class="project-link" data-open="${p.id}" data-destination="대시보드">${icon(p)}${p.name}</button>`).join('')}<p>‘오늘’은 첫 화면의 관점입니다.<br>일정이 없는 작업에 마감을 붙이지 않습니다.</p></nav>
    <section class="task-main" aria-label="모아 본 할일">${rows.length?groups.map(([kind,label,note])=>{const list=rows.filter(t=>t.kind===kind);return list.length?`<section class="task-group"><div class="task-group-head"><span class="status-dot ${kind==='problem'?'red':''}"></span><h2>${label}<span class="count">${list.length}</span></h2><p>${note}</p></div>${list.map(taskItem).join('')}</section>`:'';}).join(''):empty()}</section>
    <aside class="task-aside" aria-label="실행과 최근 기록"><section class="panel aside-panel"><div class="live-title"><span class="live-pulse"></span><h2>Agent 작업 중</h2><span class="count">1</span></div><div class="live-project">${icon(projectById('document-search'))}<div><h3>문서 검색</h3><small>검색 응답 비교 테스트</small></div></div><div class="live-track" role="img" aria-label="예시 실행: 자료 읽기 완료, 비교 테스트 실행 중"><i class="done"></i><i class="now"></i><i></i></div><p>비교 테스트 실행 중 · 시작 3분 전</p><button class="button small" data-open="document-search" data-destination="대화방 · 실행 기록">실행 보기 ↗</button></section>
    <section class="panel aside-panel"><h2>최근 변경</h2><ol class="activity"><li><time>12분 전 · Patchbay</time>평가 근거 등록<p>검토할 화면과 작업 기록이 추가되었습니다.</p></li><li><time>38분 전 · 리서치 도우미</time>출처 누락 테스트 실패<p>확인이 필요한 항목 2건</p></li><li><time>1시간 전 · 회의록 정리</time>문서 저장 준비본 도착<p>준비본 검토를 기다리고 있습니다.</p></li></ol></section><section class="aside-panel tip-panel"><p>할 일은 원래 프로젝트의 기록과 연결합니다. 항목을 누르면 해당 프로젝트의 작업 화면을 엽니다.</p></section></aside></div>`;
}
function matrixRow(p) {
  const statusText=p.status==='problem'?'실패 확인':p.status==='running'?'실행 중':p.status==='turn'?'검토 대기':'작성 중';
  return `<div class="matrix-row ${state.focus===p.id?'selected':''}" data-project="${p.id}"><button class="matrix-name" data-focus="${p.id}" aria-pressed="${state.focus===p.id}">${icon(p)}<span><b>${p.name}</b><small>${p.version} · ${p.time}${p.hidden?' · 숨김':''}</small></span></button>${steps.map((s,i)=>`<button class="matrix-cell ${i===0?'first':''} ${i<p.stage?'done':i===p.stage?'now':'next'} ${i===p.stage&&p.status==='problem'?'problem':''}" style="--stage:var(--${stageIds[i]})" data-focus="${p.id}" aria-label="${p.name} ${s} ${i<p.stage?'완료':i===p.stage?statusText:'대기'}"><span class="node"><span class="circle" aria-hidden="true">${i<p.stage?'✓':i===p.stage&&p.status==='problem'?'!':i===p.stage?'●':''}</span><span>${i<p.stage?'완료':i===p.stage?statusText:'대기'}</span></span></button>`).join('')}</div>`;
}
function renderFocus(p) {
  return `<section class="panel focus-panel" aria-label="선택한 프로젝트"><div class="focus-project">${icon(p)}<div><h2>${p.name}</h2><p>${steps[p.stage]} · ${p.statusLabel}</p></div></div><div class="focus-next"><small>다음에 확인할 것</small><p><b>${p.next}</b></p></div><button class="button primary" data-open="${p.id}" data-destination="${steps[p.stage]}">${steps[p.stage]} 열기 ↗</button></section>`;
}
function renderC() {
  const list=filteredProjects();
  const focus=list.find(p=>p.id===state.focus)||list[0];
  return `${heading('PROGRESS ACROSS PROJECTS', '어디까지 왔는지, 나란히 봅니다.', '프로젝트의 현재 단계를 비교하고 막힌 지점에서 작업을 이어갑니다.')}${stats()}${controls('프로젝트 진행')}
    <section class="flow-panel" aria-label="프로젝트별 개발 흐름 비교"><div class="flow-panel-head"><h2>프로젝트별 이번 판 진행</h2><div class="legend"><span><i></i>완료</span><span><i class="now"></i>현재</span><span><i class="next"></i>대기</span></div></div><div class="project-matrix" tabindex="0" aria-label="단계 비교. 작은 화면에서는 좌우로 스크롤할 수 있습니다."><div class="matrix-header"><span>프로젝트</span>${steps.map((label,i)=>`<div class="matrix-stage" style="--stage:var(--${stageIds[i]})">${label}<small>${['요구사항을 정리','실물과 연결','결과를 확인','근거를 검토','승인된 결과'][i]}</small></div>`).join('')}</div>${list.length?list.map(matrixRow).join(''):empty()}</div><div class="flow-bottom"><div class="return-route"><svg viewBox="0 0 100 19" aria-hidden="true"><path d="M98 2v10H3m4-4-4 4 4 4"/></svg><span>Review 반려 → 설계로 돌아가기</span></div><span>가로선은 단계 순서입니다. 프로젝트 간 의존 관계를 뜻하지 않습니다.</span></div></section>
    ${focus?renderFocus(focus):''}<div class="plan-strip"><strong>진행률 대신 확인된 단계와 이유를 보여줍니다.</strong><span>Review 승인 기록이 확인된 경우에만 ‘결과’로 넘어갑니다.</span></div>`;
}
function render() {
  main.innerHTML=state.variant==='a'?renderA():state.variant==='b'?renderB():renderC();
  document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.variant===state.variant)));
  document.querySelector('#variant-caption').textContent={a:'A · 전체 현황형 — 기본 홈 추천',b:'B · 오늘 할 일형 — 작업 처리 중심',c:'C · 단계 비교형 — 프로젝트 진행 비교'}[state.variant];
  document.title=`Patchbay · ${state.variant.toUpperCase()} ${ {a:'전체 현황',b:'오늘 할 일',c:'단계 비교'}[state.variant] } 시안`;
  const search=document.querySelector('#search');
  search.placeholder=state.variant==='a'?'프로젝트·결과물 검색':'프로젝트 검색';
  search.setAttribute('aria-label',state.variant==='a'?'프로젝트와 결과물 검색':'프로젝트 검색');
}
function setVariant(v) {
  if(!['a','b','c'].includes(v)) return;
  state.variant=v;state.filter='all';
  history.replaceState(null,'',`#${v}`);render();
  document.querySelector('#announcer').textContent=`${v.toUpperCase()} 시안으로 전환했습니다.`;
}
function showDialog(title, eyebrow, body, actions='') {
  dialog.classList.remove('artifact-dialog');
  document.querySelector('#detail-content').innerHTML=`<div class="dialog-head"><div><div class="eyebrow">${eyebrow}</div><h2 id="detail-title">${title}</h2></div><button data-close aria-label="닫기">×</button></div><div class="dialog-body">${body}</div><div class="dialog-actions">${actions}<button class="button" data-close>닫기</button></div>`;
  if(!dialog.open)dialog.showModal();
}
function openProject(id,destination='대시보드') {
  const p=projectById(id);if(!p)return;
  showDialog(`${p.name} · ${esc(destination)}`,'PROJECT DESTINATION / 시안',`<p>선택한 항목에서 해당 프로젝트의 작업 화면으로 바로 이동하는 흐름입니다.</p><div class="destination"><span>전체 프로젝트 홈</span><span>→</span><b>${p.name}</b><span>→</span><span>${esc(destination)}</span></div>${miniFlow(p)}<dl class="dialog-facts"><dt>현재 단계</dt><dd>${steps[p.stage]} · ${p.statusLabel}</dd><dt>다음 할 일</dt><dd>${p.next}</dd><dt>최근 기록</dt><dd>${p.latest} · ${p.time}</dd><dt>연결 방식</dt><dd>프로젝트 식별자 + 화면${destination.includes('대화방')?' + 할일과 연결된 대화방 식별자':''}</dd></dl><div class="dialog-notice">이 창은 이동 목적지를 설명하는 시안입니다. 실제 프로젝트를 열거나 작업 상태를 바꾸지 않습니다.</div>`);
}
document.querySelector('#rail-projects').innerHTML=sampleProjects.filter(p=>!p.hidden).map(p=>`<button class="rail-project" data-open="${p.id}" data-destination="대시보드" aria-label="${p.name} 프로젝트 열기" title="${p.name}">${icon(p)}</button>`).join('');
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||target.disabled)return;
  if(target.hasAttribute('data-close')){dialog.close();return;}
  if(target.dataset.variant){setVariant(target.dataset.variant);return;}
  if(target.dataset.switch){setVariant(target.dataset.switch);return;}
  if(target.hasAttribute('data-home')||target.hasAttribute('data-reset')){state.filter='all';state.query='';state.homeView='projects';document.querySelector('#search').value='';render();return;}
  if(target.dataset.homeView){state.homeView=target.dataset.homeView;state.query='';document.querySelector('#search').value='';render();return;}
  if(target.dataset.artifacts){openArtifactCollection(target.dataset.artifacts);return;}
  if(target.dataset.artifact){const a=sampleArtifacts.find(a=>a.id===target.dataset.artifact);if(a)openArtifactCollection(a.project,a.id);return;}
  if(target.hasAttribute('data-filter')){state.filter=target.dataset.filter;render();return;}
  if(target.dataset.open){openProject(target.dataset.open,target.dataset.destination);return;}
  if(target.dataset.focus){state.focus=target.dataset.focus;render();return;}
  if(target.hasAttribute('data-add'))showDialog('프로젝트를 연결합니다','ADD PROJECT / 시안',`<p>현재 등록 화면을 연결해 기존 폴더를 등록하거나 새 프로젝트를 시작합니다.</p><button class="registration-option" data-registration="기존 폴더 등록"><span>▣</span><div><b>기존 폴더 등록</b><small>이미 작업 중인 프로젝트를 Patchbay에 연결합니다.</small></div></button><button class="registration-option" data-registration="새 프로젝트 시작"><span>＋</span><div><b>새 프로젝트 시작</b><small>이름과 폴더를 정하고 기획을 시작합니다.</small></div></button><div class="dialog-notice">시안에서는 폴더를 생성하거나 등록하지 않습니다.</div>`);
  if(target.dataset.registration)showDialog(esc(target.dataset.registration),'ADD PROJECT / 시안',`<div class="destination">홈 → 프로젝트 등록 → ${esc(target.dataset.registration)}</div><p>실제 구현에서는 현재 Patchbay의 AddProjectDialog를 열고, 등록 성공 후 새 프로젝트 대시보드로 이동합니다.</p><div class="dialog-notice">등록 버튼의 이동 흐름을 확인했습니다. 실제 파일이나 등록 정보는 바뀌지 않았습니다.</div>`);
  if(target.id==='open-plan')showDialog('처음 열었을 때의 판단을 돕는 홈','DESIGN PRINCIPLES',`<ul class="principles"><li><b>전체 홈 → 프로젝트 → 작업 화면</b><span>일반 실행은 전체 홈에서 시작하고, 특정 대화방 링크는 해당 프로젝트와 대화방으로 바로 연결합니다.</span></li><li><b>상황 · 내 차례 · 실행 중 · 다음 행동</b><span>프로젝트의 현재 단계와 Agent 실행 여부, 사람이 할 일을 각각 표시합니다.</span></li><li><b>완료에는 확인된 근거가 필요합니다.</b><span>테스트 통과와 Review 승인을 구분합니다. 임의의 완료율이나 추정 마감일은 표시하지 않습니다.</span></li><li><b>동일한 데이터, 서로 다른 첫 질문</b><span>A는 ‘전체 상황’, B는 ‘내가 할 일’, C는 ‘어디까지 왔나’에 먼저 답합니다.</span></li><li><b>현재의 프로젝트 화면과 이어집니다.</b><span>회색 라이트 테마와 단계별 색상을 유지하고, 상세 대화와 작업은 프로젝트를 선택한 뒤 엽니다.</span></li></ul>`,`<a class="button primary" href="comparison.html">3안 비교 보기 ↗</a>`);
  if(target.id==='connections')showDialog('작업 공간 연결 상태','CONNECTIONS / 예시',`<p>LLM·실행기·지식 그래프 연결 상태는 작은 보조 항목으로 둡니다.</p><dl class="dialog-facts"><dt>LLM</dt><dd>예시 · 연결됨</dd><dt>실행기</dt><dd>예시 · 연결됨</dd><dt>지식 그래프</dt><dd>예시 · 연결됨</dd></dl><div class="dialog-notice">현재 서비스에 조회한 값이 아닙니다. 실제 구현에서는 기존 연결 상태 컴포넌트를 재사용합니다.</div>`);
});
document.addEventListener('change',event=>{
  if(event.target.id==='show-hidden'){state.hidden=event.target.checked;render();}
  if(event.target.id==='sort'){state.sort=event.target.value;render();}
});
document.querySelector('#search').addEventListener('input',event=>{state.query=event.target.value;render();});
document.addEventListener('keydown',event=>{
  if(event.key==='/'&&!dialog.open&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){event.preventDefault();document.querySelector('#search').focus();}
});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(['a','b','c'].includes(v))setVariant(v);});
render();
