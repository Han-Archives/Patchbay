/* A-only design study: navigation, content previews and project views. Example data only. */
const homePreferences={favorites:['patchbay','document-search'],layout:'gallery'};
const homeNavigation={project:null,screen:'home',task:null};
// A working local preview demonstrates the launch link without inventing service URLs.
const projectLaunchTargets={patchbay:{href:'index.html#a',label:'Patchbay 메인 화면 · 검토용 실행 화면'}};
const executionCalendar={year:2026,month:10,selected:'2026-11-02'};
// Explicit sample execution records; these are neither commits nor measured activity.
const sampleExecutionDays={
  '2026-10-01':2,'2026-10-03':5,'2026-10-06':3,'2026-10-09':1,'2026-10-14':7,
  '2026-10-18':4,'2026-10-22':6,'2026-10-25':2,'2026-10-28':8,'2026-10-31':5,
  '2026-11-01':7,'2026-11-02':4
};
function uiIcon(name){
  const paths={home:'<path d="m3 10 9-7 9 7v10h-6v-6H9v6H3Z"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',folder:'<path d="M3 6h7l2 3h9v11H3Z"/><path d="M3 6V4h7l2 2h8v3"/>',file:'<path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',check:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 12 3 3 7-7"/>',search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6h4"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',filter:'<path d="M4 6h16M7 12h10M10 18h4"/>'};
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.file}</svg>`;
}
function coverArt(p){
  const drawings={
    patchbay:'<path d="M96 48h38l20-21h38m-38 21 20 24h47"/><rect x="62" y="32" width="39" height="32" rx="9"/><rect x="190" y="12" width="34" height="28" rx="7"/><rect x="208" y="58" width="34" height="28" rx="7"/><circle cx="81" cy="48" r="5"/><path d="m200 26 4 4 9-9m5 51h13m-7-6v12"/>',
    'document-search':'<rect x="84" y="14" width="76" height="76" rx="7"/><path d="M97 31h35M97 42h45M97 54h22M97 66h32"/><circle cx="171" cy="48" r="23"/><path d="m188 65 19 19M159 48h24M171 36v24"/>',
    'research-helper':'<rect x="77" y="25" width="65" height="64" rx="6" transform="rotate(-10 110 50)"/><rect x="115" y="12" width="71" height="75" rx="6"/><path d="M128 29h42M128 40h29M128 65l12-12 12 7 20-16"/><circle cx="201" cy="72" r="10"/><path d="M201 67v5l4 3"/>',
    'work-automation':'<rect x="54" y="32" width="42" height="32" rx="9"/><path d="M97 48h32m0 0V23h35m-35 25v25h35"/><rect x="165" y="10" width="42" height="27" rx="7"/><rect x="165" y="60" width="42" height="27" rx="7"/><path d="m73 39-5 10h12l-5 9m104-36h13m-13 52 4 4 9-9"/>',
    'meeting-notes':'<rect x="82" y="15" width="105" height="70" rx="8"/><path d="M96 32h59M96 45h77M96 58h45M96 71h35"/><rect x="158" y="50" width="60" height="33" rx="7"/><path d="m170 65 6 5 12-12m8 8h11"/>',
    'personal-wiki':'<path d="M82 23q28-13 53 0 26-13 52 0v59q-26-13-52 0-25-13-53 0ZM135 23v59M94 36h27M94 48h27M148 36h25M148 48h25"/>'
  };
  return `<svg viewBox="0 0 280 98" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${drawings[p.id]}</g></svg>`;
}
function homeProjects(){return sampleProjects.filter(p=>state.hidden||!p.hidden);}
function patchbayMark(){return '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11.9 10.4C19.7 10.4 22.7 14.4 22.7 18.6"/><circle cx="9.3" cy="10.4" r="2.6"/><circle cx="9.3" cy="21.6" r="2.6"/><circle cx="22.7" cy="21.6" r="2.6"/></g></svg>';}
function railIcon(name){
  const shapes={home:'<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/>',files:'<path d="M3 7V6a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',plan:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',architecture:'<rect x="3" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="10" width="7" height="5" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/><path d="M6.5 8v8M10 5.5h3.5a1 1 0 0 1 1 1V10"/>',log:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 8 1 1 2-2M13 8h3M8 13h8M8 17h5"/>',graph:'<path d="m8.5 6.5 6-1M8 9l7 7M6 9.5v6M8.5 18h6"/><circle cx="6" cy="7" r="2.5"/><circle cx="17" cy="5" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="17" cy="18" r="2.5"/>',docs:'<path d="M9 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l5 5v3M14 3v5h5"/><circle cx="14" cy="15" r="4"/><path d="m17 18 4 4"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};
  return `<svg class="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">${shapes[name]}</svg>`;
}
function resultScreenButton(p){
  const target=projectLaunchTargets[p.id],label=`${p.name} 실행 화면 열기`,svg='<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-3-9 6-6m-5 0h5v5"/></svg>';
  return target?`<a class="result-screen-button" href="${target.href}" target="_blank" rel="noopener noreferrer" title="${target.label} · 새 탭으로 열기" aria-label="${label} · 새 탭">${svg}</a>`:`<button class="result-screen-button" disabled title="실행 화면 주소가 연결되지 않았습니다" aria-label="${label} · 실행 주소 미연결">${svg}</button>`;
}
function favoriteButton(p){
  const on=homePreferences.favorites.includes(p.id);
  return `<button class="favorite-button" data-favorite="${p.id}" aria-pressed="${on}" aria-label="${p.name} 즐겨찾기 ${on?'해제':'추가'}">${uiIcon('star')}</button>`;
}
function compactOutputButton(p){
  const count=artifactsForProject(p.id).length;
  return `<div class="project-output-action"><button class="output-button" data-artifacts="${p.id}" ${count?'':`disabled aria-describedby="no-output-${p.id}"`} aria-label="${p.name} 결과물 ${count}개 보기">${uiIcon('file')}<span>결과물 보기</span><b>${count}</b><span aria-hidden="true">↗</span></button><small ${count?'':`id="no-output-${p.id}"`}>${count?'문서·화면·이미지':'아직 생성된 결과물이 없습니다'}</small></div>`;
}
function workspaceProjectCard(p){
  const row=homePreferences.layout==='list';
  return `<article class="project-card ${row?'project-row':''}" data-project="${p.id}" style="--cover:${p.bg};--cover-ink:${p.ink}">${row?'':`<div class="project-cover">${coverArt(p)}${favoriteButton(p)}<span class="cover-label">${p.id.toUpperCase().replaceAll('-',' / ')}</span></div>`}<div class="project-card-body"><div class="card-heading">${icon(p)}<div><h3><button class="project-title" data-open="${p.id}" data-destination="${steps[p.stage]}">${p.name}</button></h3><small>${p.description}</small></div>${resultScreenButton(p)}${row?favoriteButton(p):''}</div><div class="project-state-line">${chip(p)}<span>${p.version} <i>·</i> ${steps[p.stage]}</span></div><p class="card-summary">${p.summary}</p>${miniFlow(p)}<div class="project-card-bottom"><time>${uiIcon('clock')}${p.time}</time>${compactOutputButton(p)}</div></div></article>`;
}
function projectGallery(list){
  return `<div class="project-grid ${homePreferences.layout==='list'?'is-list':''}">${list.map(workspaceProjectCard).join('')}</div>`;
}
function workspaceFilters(){
  const projects=homeProjects();
  return `<nav class="filters" aria-label="프로젝트 상태 필터">${[['all','전체'],['turn','내 차례'],['running','실행 중'],['problem','문제 있음']].map(([key,label])=>`<button class="filter" data-filter="${key}" aria-pressed="${state.filter===key}">${key==='all'?'':`<i class="filter-dot ${key}"></i>`}${label}<span>${projects.filter(p=>key==='all'||p.status===key).length}</span></button>`).join('')}</nav>`;
}
function renderWorkspaceLibrary(){
  const searching=Boolean(state.query.trim()),isOutputs=state.homeView==='artifacts',isFavorites=state.homeView==='favorites';
  const projects=filteredProjects().filter(p=>!isFavorites||searching||homePreferences.favorites.includes(p.id)),outputs=filteredArtifacts();
  const all=homeProjects(),allOutputs=sampleArtifacts.filter(a=>all.some(p=>p.id===a.project));
  const toolbar=`<div class="workspace-library-toolbar">${workspaceFilters()}<div class="library-tools"><label class="check-label"><input id="show-hidden" type="checkbox" ${state.hidden?'checked':''}>숨김 포함</label><select id="sort" class="sort-select" aria-label="프로젝트와 결과물 정렬"><option value="recent" ${state.sort==='recent'?'selected':''}>최근 기록순</option><option value="name" ${state.sort==='name'?'selected':''}>이름순</option></select>${isOutputs?'':`<div class="layout-switch" aria-label="프로젝트 표시 방식"><button data-project-layout="gallery" aria-label="갤러리 보기" aria-pressed="${homePreferences.layout==='gallery'}">${uiIcon('grid')}</button><button data-project-layout="list" aria-label="목록 보기" aria-pressed="${homePreferences.layout==='list'}">${uiIcon('list')}</button></div>`}</div></div>`;
  const tabs=`<nav class="library-tabs" aria-label="프로젝트와 결과물 보기">${[['projects','모든 프로젝트',all.length,'folder'],['favorites','즐겨찾기',all.filter(p=>homePreferences.favorites.includes(p.id)).length,'star'],['artifacts','결과물',allOutputs.length,'file']].map(([id,label,count,icon])=>`<button data-home-view="${id}" aria-pressed="${state.homeView===id}">${uiIcon(icon)}${label}<span>${count}</span></button>`).join('')}</nav>`;
  let body;
  if(searching){
    body=`<div class="workspace-search-heading"><div><h2>검색 결과</h2><p>‘${esc(state.query.trim())}’ · 프로젝트와 결과물에서 찾았습니다</p></div><button class="button small" data-home-view="projects">검색 지우기</button></div>${toolbar}${!projects.length&&!outputs.length?'<div class="empty"><h3>일치하는 프로젝트나 결과물이 없습니다</h3><p>다른 검색어를 입력하거나 상태 필터를 바꿔 보세요.</p><button class="button small" data-reset>전체 프로젝트 보기</button></div>':`${projects.length?`<div class="result-group"><h3>프로젝트 <span class="count">${projects.length}</span></h3>${projectGallery(projects)}</div>`:''}${outputs.length?`<div class="result-group"><h3>결과물 <span class="count">${outputs.length}</span></h3><div class="output-grid">${outputs.map(artifactCard).join('')}</div></div>`:''}`}`;
  }else{
    body=`<div class="workspace-library-title"><div><h2>${isOutputs?'결과물 모아보기':'내 프로젝트'}</h2><p>${isOutputs?'Patchbay에서 생성한 문서와 화면을 찾아보세요.':'프로젝트를 열거나, 지금까지 만든 결과물을 살펴보세요.'}</p></div><button class="button small" data-add>＋ 프로젝트 연결</button></div>${tabs}${toolbar}${isOutputs?`<div class="output-grid">${outputs.length?outputs.map(artifactCard).join(''):'<div class="empty"><h3>아직 생성된 결과물이 없습니다</h3><p>현재 필터에 맞는 결과물이 생성되면 이곳에 표시됩니다.</p></div>'}</div>`:projects.length?projectGallery(projects):`<div class="empty"><h3>${isFavorites?'즐겨찾기한 프로젝트가 없습니다':'해당하는 프로젝트가 없습니다'}</h3><p>${isFavorites?'프로젝트 카드의 별표를 눌러 자주 찾는 프로젝트를 모아 보세요.':'프로젝트 상태 필터를 바꿔 보세요.'}</p><button class="button small" data-reset>전체 프로젝트 보기</button></div>`}`;
  }
  return `<section id="project-section" class="workspace-library" aria-label="프로젝트와 결과물">${body}</section>`;
}
function recentPreview(a){
  if(a.id==='home-study')return `<div class="recent-preview preview-workflow"><span class="preview-caption">PROJECT HOME</span><div class="preview-tiny-cards"><i></i><i></i><i></i></div><span class="preview-path">설계 <b>→</b> 구현 <b>→</b> 테스트 <b>→</b> Review</span></div>`;
  return `<div class="recent-preview ${a.id==='meeting-summary'?'preview-meeting':'preview-document'}"><span class="preview-paper"><small>${a.id==='meeting-summary'?'WEEKLY NOTES':'EVALUATION / v3'}</small><b>${a.id==='meeting-summary'?'함께 정리한 다음 단계':'결과를 확인할 차례입니다.'}</b><span class="preview-text-line"></span><span class="preview-text-line short"></span><span class="preview-check">${a.id==='meeting-summary'?'☑ 회의 요약　☐ 후속 작업':'☑ 실행 기록　☐ 근거 검토'}</span></span></div>`;
}
function renderRecentOutputs(){
  return `<section class="recent-section" aria-label="최근 열어본 결과물"><div class="home-section-title"><h2>${uiIcon('clock')}최근 열어본 결과물</h2><button data-home-view="artifacts">모두 보기 ${uiIcon('arrow')}</button></div><div class="recent-strip">${['evaluation-summary','home-study','meeting-summary'].map(id=>{const a=sampleArtifacts.find(a=>a.id===id),p=projectById(a.project);return `<button class="recent-card" data-artifact="${a.id}">${recentPreview(a)}<span class="recent-card-copy"><b>${uiIcon(a.kind==='화면'?'grid':'file')}${a.title}</b><small>${p.name}<span>· ${a.time}</span></small></span></button>`;}).join('')}</div></section>`;
}
function renderHomeAside(){
  const toDo=tasks.filter(t=>t.kind!=='running'&&homeProjects().some(p=>p.id===t.project));
  return `<aside class="home-aside" aria-label="해야 할 일과 코드 실행"><section class="attention-widget" id="home-attention"><div class="home-section-title"><h2><span class="attention-mark">${uiIcon('check')}</span>해야 할 일 <span class="count">${toDo.length}</span></h2><span>프로젝트별</span></div><p class="aside-intro">할 일을 누르면 해당 프로젝트로 이동합니다.</p>${toDo.map(t=>{const p=projectById(t.project);return `<button class="review-item" data-project-screen="tasks" data-project-id="${p.id}" data-task="${t.order}" aria-label="${p.name} 할 일 열기 · ${p.task}">${icon(p)}<span><small>${p.name}</small><b>${p.task}</b><span class="review-tag">${t.reason} <i>· ${p.time}</i></span></span><span class="review-arrow">↗</span></button>`;}).join('')}</section><section class="running-widget"><div class="running-widget-heading"><span class="live-pulse"></span><b>Agent가 작업 중이에요</b><span class="running-tag">1</span></div><div class="running-widget-project">${icon(projectById('document-search'))}<span><b>문서 검색</b><small>검색 응답 비교 테스트</small></span></div><div class="running-route"><span>자료 읽기 ✓</span><i></i><b>응답 비교 중</b></div><button data-project-screen="runs" data-project-id="document-search">실행 기록 보기 ${uiIcon('arrow')}</button></section>${renderExecutionCalendar()}</aside>`;
}
function renderExecutionCalendar(){
  const {year,month,selected}=executionCalendar;
  const prefix=`${year}-${String(month+1).padStart(2,'0')}`,first=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate();
  const records=Object.entries(sampleExecutionDays).filter(([date])=>date.startsWith(prefix));
  const total=records.reduce((sum,[,count])=>sum+count,0),activeDays=records.filter(([,count])=>count>0).length;
  const cells=Array.from({length:first},()=>'<span class="calendar-pad" aria-hidden="true"></span>').join('')+Array.from({length:days},(_,index)=>{
    const day=index+1,date=`${prefix}-${String(day).padStart(2,'0')}`,future=date>'2026-11-02',count=sampleExecutionDays[date]||0;
    return `<button class="calendar-day level-${count===0?0:count<=2?1:count<=4?2:count<=6?3:4}" data-execution-date="${date}" ${future?'disabled':''} aria-pressed="${selected===date}" aria-label="${month+1}월 ${day}일 · ${future?'집계 전':`코드 실행 ${count}회`}" title="${future?'집계 전':`${date} · 코드 실행 ${count}회`}">${day}</button>`;
  }).join('');
  const selectedCount=sampleExecutionDays[selected]||0;
  return `<section class="execution-calendar" aria-label="코드 실행 캘린더"><div class="home-section-title"><h2>${uiIcon('clock')}코드 실행</h2><span>예시</span></div><div class="execution-summary"><strong>${total}<small>회</small></strong><span>${month+1}월 실행 <i>·</i> ${activeDays}일 활동</span></div><div class="calendar-month"><button data-calendar-shift="-1" aria-label="이전 달">‹</button><b>${year}년 ${month+1}월</b><button data-calendar-shift="1" aria-label="다음 달" ${year===2026&&month===10?'disabled':''}>›</button></div><div class="calendar-weekdays" aria-hidden="true">${['일','월','화','수','목','금','토'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div><div class="calendar-legend"><span>적음</span>${[0,1,2,3,4].map(n=>`<i class="level-${n}"></i>`).join('')}<span>많음</span></div><div class="calendar-selected" aria-live="polite"><span>${Number(selected.slice(5,7))}월 ${Number(selected.slice(8))}일</span><b>코드 실행 ${selectedCount}회</b></div><p class="calendar-note">실행 기록 1건 = 1회 · 커밋 수와 별도</p></section>`;
}
function renderWorkspaceHome(){
  if(homeNavigation.project)return renderProjectScreen();
  const searching=Boolean(state.query.trim()),showRecent=!searching&&state.homeView==='projects';
  return `<header class="workspace-welcome"><div><div class="welcome-eyebrow"><span></span>YOUR WORKSPACE</div><h1>Patchbay</h1><p>하던 일을 이어가고, 새로 쌓인 결과를 만나보세요.</p></div><div class="welcome-date">11월 2일 월요일<span>내 차례 <b>2</b><i>·</i> 실행 중 <b>1</b></span></div></header><div class="home-columns"><div class="home-primary">${showRecent?renderRecentOutputs():''}${renderWorkspaceLibrary()}</div>${renderHomeAside()}</div>`;
}
function renderWorkspaceNavigation(){
  const projects=sampleProjects.filter(p=>!p.hidden);
  document.querySelector('.rail').innerHTML=`<button class="workspace-brand" data-home aria-label="Patchbay 메인 화면으로 이동" title="Patchbay 메인 화면"><span class="brand-symbol">${patchbayMark()}</span></button><div id="rail-projects" class="rail-projects">${projects.map(p=>`<button class="rail-pj is-project" data-open="${p.id}" data-destination="대시보드" style="--project-color:${p.bg}" ${homeNavigation.project===p.id?'aria-current="true"':''} aria-label="${p.name} 프로젝트 열기" title="${p.name}">${p.initial}${p.status==='running'||p.status==='problem'?`<i class="rail-dot is-${p.status}" aria-hidden="true"></i>`:''}</button>`).join('')}<button class="rail-pj is-add" data-add aria-label="새 프로젝트" title="새 프로젝트">＋</button><button class="rail-hidden-btn" data-hidden-projects aria-label="숨긴 프로젝트 보기">숨김 1</button></div><div class="rail-divider"></div><nav class="rail-project-tools" aria-label="프로젝트 전체 도구">${[['dashboard','home','메인 화면'],['files','files','폴더 · 문서'],['design','plan','설계'],['architecture','architecture','아키텍처'],['log','log','Log · 진행 기록'],['graph','graph','지식 그래프'],['docs','docs','RAG'],['more','more','추가 기능']].map(([destination,icon,label])=>`<button data-rail-tool="${destination}" title="${label}" aria-label="${label}">${railIcon(icon)}</button>`).join('')}</nav><div class="rail-foot"><button class="rail-hp-group" id="connections" title="LLM 사용량 · 예시" aria-label="LLM 사용량 · 예시"><span>C <i><b style="width:62%"></b></i></span><span>X <i><b style="width:81%"></b></i></span></button><button class="rail-side" data-connection="LangGraph" title="LangGraph 연결 상태 · 예시"><i></i>LG</button><button class="rail-side" data-connection="Neo4j" title="Neo4j 연결 상태 · 예시"><i></i>N4</button><button class="rail-side" data-restart-preview title="서버 다시 켜기 · 시안"><span>↻</span>켜기</button></div>`;
  const p=projectById(homeNavigation.project);
  document.querySelector('.breadcrumb').innerHTML=`<button class="breadcrumb-link" data-home>작업 공간</button><span>/</span>${p?`<span>${p.name}</span><span>/</span><b>${projectScreenLabel(homeNavigation.screen)}</b>`:'<b>홈</b>'}`;
  document.querySelector('#variant-caption').textContent='A · 프로젝트 홈 / 검토 시안';
}
function projectScreenLabel(screen){return {tasks:'할 일',result:'결과',runs:'실행 기록',dashboard:'대시보드',files:'폴더 · 문서',design:'설계',architecture:'아키텍처',log:'Log · 진행 기록',graph:'지식 그래프',docs:'RAG'}[screen]||'대시보드';}
function readHomeRoute(){
  const match=/^#project\/([^/]+)\/(tasks|result|runs|dashboard|files|design|architecture|log|graph|docs)(?:\/([0-9]+))?$/.exec(location.hash);
  homeNavigation.project=match&&projectById(match[1])?match[1]:null;
  homeNavigation.screen=homeNavigation.project?match[2]:'home';homeNavigation.task=homeNavigation.project?match[3]||null:null;
}
function navigateProjectScreen(id,screen='dashboard',task){
  if(!projectById(id))return;
  history.pushState(null,'',`#project/${id}/${screen}${task?`/${task}`:''}`);
  readHomeRoute();render();window.scrollTo(0,0);main.focus({preventScroll:true});
}
function resetHomeRoute(){
  if(homeNavigation.project){history.pushState(null,'','#a');homeNavigation.project=null;homeNavigation.screen='home';homeNavigation.task=null;}
}
function renderProjectScreen(){
  const p=projectById(homeNavigation.project),screen=homeNavigation.screen,outputs=artifactsForProject(p.id),projectTasks=tasks.filter(t=>t.project===p.id);
  const header='<button class="home-return" data-home>← 메인 화면으로</button>';
  const tabs=`<nav class="project-screen-tabs" aria-label="${p.name} 화면">${[['dashboard','대시보드'],['tasks','할 일'],['result','결과'],['runs','실행 기록']].map(([id,label])=>`<button data-project-id="${p.id}" data-project-screen="${id}" aria-current="${id===screen?'page':'false'}">${label}</button>`).join('')}</nav>`;
  let body;
  if(screen==='tasks')body=`<section class="project-task-list" aria-label="${p.name} 할 일">${projectTasks.length?projectTasks.map(t=>`<article class="project-task-detail ${String(t.order)===homeNavigation.task?'is-selected':''}" tabindex="0"><div class="project-task-number">${uiIcon('check')}</div><div><small>할 일 #${t.order} · ${t.reason}</small><h2>${p.task}</h2><p>${t.title}</p><p>${t.description}</p><span class="project-task-status">${t.kind==='running'?'Agent 실행 중':'확인 대기'}</span></div></article>`).join(''):'<div class="empty"><h3>등록된 할 일이 없습니다</h3></div>'}</section>`;
  else if(screen==='result')body=`<section class="project-results"><div class="project-result-heading"><h2>프로젝트 결과</h2><p>이 프로젝트에서 만든 화면과 문서입니다.</p></div><div class="project-launch"><div>${uiIcon('grid')}<span><b>실행 화면</b><small>${projectLaunchTargets[p.id]?projectLaunchTargets[p.id].label:'앱·웹사이트의 실행 주소가 연결되지 않았습니다.'}</small></span></div>${projectLaunchTargets[p.id]?`<a class="button" href="${projectLaunchTargets[p.id].href}" target="_blank" rel="noopener noreferrer">실행 화면 열기 ↗</a>`:'<button class="button" disabled>실행 주소 미연결</button>'}</div>${outputs.length?`<div class="output-grid">${outputs.map(artifactCard).join('')}</div>`:'<div class="empty"><h3>아직 생성된 결과물이 없습니다</h3><p>결과물이 생성되면 이곳에 표시됩니다.</p></div>'}</section>`;
  else if(screen==='runs')body=`<section class="project-task-detail"><div class="project-task-number">${uiIcon('clock')}</div><div><small>실행 기록 · 예시</small><h2>${p.task}</h2><p>${p.latest}</p><p>${p.time} · ${p.status==='running'?'실행 중':'최근 기록'}</p></div></section>`;
  else body=`<section class="project-overview"><h2>${projectScreenLabel(screen)}</h2><p>${p.summary}</p>${miniFlow(p)}<div class="project-overview-actions"><button class="button" data-project-id="${p.id}" data-project-screen="tasks">할 일 열기 ${uiIcon('arrow')}</button><button class="button" data-project-id="${p.id}" data-project-screen="result">결과 열기 ${uiIcon('arrow')}</button></div></section>`;
  return `${header}<header class="project-screen-heading">${icon(p)}<div><small>PROJECT · ${p.version}</small><h1>${p.name}</h1><p>${p.description}</p></div>${chip(p)}</header>${tabs}${body}<p class="project-screen-note">이동 흐름을 확인하는 시안입니다. 표시된 내용은 예시 데이터입니다.</p>`;
}
window.addEventListener('popstate',()=>{if(document.body.classList.contains('workspace-redesign')){readHomeRoute();render();}});
window.addEventListener('hashchange',()=>{if(document.body.classList.contains('workspace-redesign')){readHomeRoute();render();}});
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||target.disabled||!document.body.classList.contains('workspace-redesign'))return;
  if(target.dataset.favorite){const id=target.dataset.favorite;homePreferences.favorites=homePreferences.favorites.includes(id)?homePreferences.favorites.filter(x=>x!==id):[...homePreferences.favorites,id];render();document.querySelector(`[data-favorite="${id}"]`)?.focus({preventScroll:true});document.querySelector('#announcer').textContent='즐겨찾기를 변경했습니다.';}
  if(target.dataset.projectLayout){homePreferences.layout=target.dataset.projectLayout;render();document.querySelector(`[data-project-layout="${homePreferences.layout}"]`).focus({preventScroll:true});}
  if(target.dataset.projectScreen){navigateProjectScreen(target.dataset.projectId,target.dataset.projectScreen,target.dataset.task);}
  if(target.dataset.calendarShift){const next=new Date(executionCalendar.year,executionCalendar.month+Number(target.dataset.calendarShift),1);executionCalendar.year=next.getFullYear();executionCalendar.month=next.getMonth();executionCalendar.selected=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-01`;document.querySelector('.execution-calendar').outerHTML=renderExecutionCalendar();document.querySelector(`[data-calendar-shift="${target.dataset.calendarShift}"]`)?.focus({preventScroll:true});}
  if(target.dataset.executionDate){executionCalendar.selected=target.dataset.executionDate;document.querySelector('.execution-calendar').outerHTML=renderExecutionCalendar();document.querySelector(`[data-execution-date="${executionCalendar.selected}"]`)?.focus({preventScroll:true});}
  if(target.dataset.railTool){const id=homeNavigation.project||'patchbay';if(target.dataset.railTool==='more')showDialog('추가 기능','프로젝트 도구',`<div class="project-overview-actions">${['테스트','기획 문서','구현','배치도'].map(label=>`<button class="button" data-open="${id}" data-destination="${label}">${label} ↗</button>`).join('')}</div>`);else navigateProjectScreen(id,target.dataset.railTool);}
  if(target.dataset.connection)showDialog(`${target.dataset.connection} 연결 상태`,'연결 상태 · 시안','<p>기존 Patchbay 왼쪽 바의 연결 표시를 유지합니다. 이 페이지는 예시 상태입니다.</p>');
  if(target.hasAttribute('data-restart-preview'))showDialog('서버 다시 켜기','기존 왼쪽 바 · 시안','<p>기존 서버 제어 버튼의 위치를 유지한 시안입니다.</p>');
  if(target.hasAttribute('data-hidden-projects'))showDialog('숨긴 프로젝트','프로젝트',`<p>개인 위키</p><button class="button" data-open="personal-wiki" data-destination="대시보드">프로젝트 열기 ↗</button>`);
  if(target.hasAttribute('data-benchmark'))showDialog('홈 화면을 구성한 기준','DESIGN REFERENCES',`<ul class="principles"><li><b><a href="https://www.notion.com/en-gb/help/navigate-with-the-sidebar" target="_blank" rel="noreferrer">Notion · 사이드바</a></b><span>최근 항목과 즐겨찾기를 탐색 메뉴에 모아 자주 찾는 작업으로 빠르게 이동합니다.</span></li><li><b><a href="https://www.notion.com/help/galleries" target="_blank" rel="noreferrer">Notion · 갤러리</a></b><span>내용 미리보기와 프로젝트별 커버로 같은 크기의 카드도 서로 구별할 수 있게 했습니다.</span></li><li><b><a href="https://linear.app/docs/projects" target="_blank" rel="noreferrer">Linear · 프로젝트 보기</a></b><span>갤러리와 목록을 전환하고 프로젝트 상태로 필요한 항목만 살펴봅니다.</span></li><li><b><a href="https://asana.com/features/project-management/home" target="_blank" rel="noreferrer">Asana · Home</a></b><span>최근 결과물, 사람이 확인할 일, 현재 실행 중인 작업을 역할이 다른 영역으로 배치했습니다.</span></li></ul><div class="dialog-notice">구조를 참고해 Patchbay의 프로젝트·Agent·생성 결과물 흐름에 맞춰 재구성한 검토용 시안입니다.</div>`);
});
document.addEventListener('keydown',event=>{
  if(!document.body.classList.contains('workspace-redesign'))return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'&&!dialog.open){event.preventDefault();document.querySelector('#search').focus();}
});
