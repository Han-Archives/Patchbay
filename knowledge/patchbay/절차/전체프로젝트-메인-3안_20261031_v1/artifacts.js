/* Fictional generated outputs for the A design study. No file access or API calls. */
const sampleArtifacts = [
  {id:'evaluation-summary',project:'patchbay',title:'v3 평가 결과 요약',kind:'문서',format:'MD',filename:'v3-평가결과.md',version:'v3',status:'검토 중',stage:'Review',time:'12분 전',age:12,description:'평가 결과와 확인할 근거를 정리한 보고서',sections:[
    {title:'이번 결과에서 확인할 것',text:'평가 항목별 결과와 화면 근거를 한곳에 모았습니다. 이 문서는 검토를 기다리는 예시 보고서입니다.'},
    {title:'근거와 연결',text:'각 항목의 실행 기록과 화면 캡처를 함께 확인합니다. 테스트가 통과했더라도 사람의 검토가 끝나기 전에는 승인된 결과로 표시하지 않습니다.'},
    {title:'다음 작업',text:'아직 확인하지 않은 평가 근거를 읽고, 보완이 필요한 항목을 원래 프로젝트에서 검토합니다.'}
  ]},
  {id:'home-study',project:'patchbay',title:'프로젝트 메인 화면 시안',kind:'화면',format:'HTML',filename:'메인화면-3안.html',version:'v1',status:'시안',stage:'설계',time:'30분 전',age:30,description:'전체 현황·오늘 할 일·단계 비교를 살펴보는 화면',image:'comparison.png'},
  {id:'output-requirements',project:'patchbay',title:'결과물 검색과 열람 요구사항',kind:'문서',format:'MD',filename:'결과물-검색-열람.md',version:'v1',status:'초안',stage:'설계',time:'45분 전',age:45,description:'프로젝트 검색, 생성 결과물 열람, 결과물 없는 상태의 동작',sections:[
    {title:'검색',text:'프로젝트 이름과 결과물의 제목·파일명·내용으로 찾습니다. 결과에는 소속 프로젝트와 파일 종류를 함께 보여 줍니다.'},
    {title:'열람',text:'프로젝트 카드에서 생성한 결과물 목록을 열고 문서나 화면을 미리 봅니다. 완료 전에도 생성된 결과물은 볼 수 있으며 초안과 검토 중 상태를 구분합니다.'},
    {title:'결과물이 없는 경우',text:'결과물 보기 버튼을 비활성화하고 아직 결과물이 없다는 이유를 카드에 표시합니다. 결과물이 생성되면 버튼을 사용할 수 있습니다.'}
  ]},
  {id:'search-comparison',project:'document-search',title:'검색 응답 비교 보고서',kind:'문서',format:'MD',filename:'검색응답-비교.md',version:'v2',status:'초안',stage:'테스트',time:'20분 전',age:20,description:'같은 질문에 대한 응답과 출처를 비교한 중간 보고서',sections:[
    {title:'비교 기준',text:'같은 질문으로 검색 응답의 내용과 출처 표시를 비교합니다. 현재 실행이 진행 중이어도 이미 생성한 중간 보고서는 열어 볼 수 있습니다.'},
    {title:'확인할 내용',text:'답변에 문서의 출처가 포함되는지 확인하고, 근거가 없는 문장을 표시합니다.'}
  ]},
  {id:'home-capture',project:'patchbay',title:'A안 메인 화면 캡처',kind:'이미지',format:'PNG',filename:'A안-메인화면.png',version:'v1',status:'시안',stage:'설계',time:'25분 전',age:25,description:'프로젝트 카드와 결과물 보기 버튼을 살펴보는 화면 이미지',image:'a-desktop.png'},
  {id:'meeting-summary',project:'meeting-notes',title:'주간 회의록 요약',kind:'문서',format:'MD',filename:'주간회의-요약.md',version:'v1',status:'검토 중',stage:'Review',time:'1시간 전',age:60,description:'회의의 핵심 논의와 합의한 내용을 정리한 문서',sections:[
    {title:'회의 요약',text:'팀의 이번 주 진행 상황과 다음 주 준비 사항을 정리한 예시 회의록입니다.'},
    {title:'논의한 내용',text:'문서 저장 위치와 구성, 다음 회의에서 확인할 질문을 정리했습니다. 저장 준비본은 검토를 기다리고 있습니다.'}
  ]},
  {id:'meeting-actions',project:'meeting-notes',title:'회의 후속 할 일',kind:'문서',format:'MD',filename:'회의-후속할일.md',version:'v1',status:'초안',stage:'설계',time:'1시간 전',age:62,description:'회의에서 나온 다음 작업과 확인할 질문',sections:[
    {title:'후속 작업',text:'회의록 저장 규칙을 확인하고 문서 폴더의 구성을 검토합니다.'},
    {title:'남은 질문',text:'아직 합의하지 않은 내용은 다음 회의에서 확인합니다.'}
  ]},
  {id:'wiki-outline',project:'personal-wiki',title:'개인 위키 목차',kind:'문서',format:'MD',filename:'개인위키-목차.md',version:'v1',status:'초안',stage:'설계',time:'어제',age:1440,description:'숨긴 프로젝트의 예시 목차',sections:[{title:'목차',text:'숨긴 프로젝트 포함을 켰을 때만 목록과 검색에 나타나는 예시 결과물입니다.'}]}
];

function matchesSearch(text) {
  return String(text).normalize('NFKC').toLocaleLowerCase().includes(state.query.trim().normalize('NFKC').toLocaleLowerCase());
}
function artifactsForProject(id) {
  return sampleArtifacts.filter(a=>a.project===id).sort((a,b)=>a.age-b.age);
}
function filteredArtifacts() {
  return sampleArtifacts.filter(a=>{
    const p=projectById(a.project);
    return p && (state.hidden||!p.hidden) && (state.filter==='all'||p.status===state.filter) &&
      matchesSearch([a.title,a.description,a.filename,a.kind,a.format,p.name,...(a.sections||[]).flatMap(s=>[s.title,s.text])].join(' '));
  }).sort(state.sort==='name'?(a,b)=>a.title.localeCompare(b.title,'ko'):(a,b)=>a.age-b.age);
}
function outputIcon(kind) {
  return `<span class="output-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4M9 12h6M9 16h6"/></svg><small>${esc(kind)}</small></span>`;
}
function projectArtifactAction(p) {
  const count=artifactsForProject(p.id).length;
  return `<div class="card-outputs"><button class="output-button" data-artifacts="${p.id}" ${count?'':`disabled aria-describedby="no-output-${p.id}"`} aria-label="${p.name} 결과물 ${count}개 보기">${outputIcon('')}<span>결과물 보기</span><b>${count}</b><span aria-hidden="true">${count?'↗':'—'}</span></button><small ${count?'':`id="no-output-${p.id}"`}>${count?'Patchbay에서 생성한 문서·화면':'아직 생성된 결과물이 없습니다'}</small></div>`;
}
function artifactCard(a) {
  const p=projectById(a.project);
  return `<article class="output-card" data-output="${a.id}"><div class="output-card-top">${outputIcon(a.format)}<span class="output-state">${a.status}</span></div><button class="output-title" data-artifact="${a.id}">${esc(a.title)}<span aria-hidden="true">↗</span></button><p>${esc(a.description)}</p><div class="output-origin">${icon(p)}<span>${p.name}</span><small>${a.version} · ${a.stage}</small></div><div class="output-card-foot"><span>${a.kind} · ${a.format}</span><time>${a.time}</time></div></article>`;
}
function renderHomeLibrary() {
  const projects=filteredProjects(),outputs=filteredArtifacts(),searching=Boolean(state.query.trim()),isOutputs=state.homeView==='artifacts';
  const title=searching?'검색 결과':isOutputs?'결과물':'프로젝트';
  const count=searching?projects.length+outputs.length:isOutputs?outputs.length:projects.length;
  const controls=`<div class="section-head library-head"><h2>${title}<span class="count">${count}</span></h2><div class="section-actions"><button class="button small" data-home-view="${searching?'projects':isOutputs?'projects':'artifacts'}">${searching?'검색 지우기':isOutputs?'프로젝트 보기':'결과물 모아보기'}</button><label class="check-label"><input id="show-hidden" type="checkbox" ${state.hidden?'checked':''}>숨긴 프로젝트 포함</label><select class="sort-select" id="sort" aria-label="프로젝트와 결과물 정렬"><option value="recent" ${state.sort==='recent'?'selected':''}>최근 기록순</option><option value="name" ${state.sort==='name'?'selected':''}>이름순</option></select></div></div>${filters()}`;
  let body;
  if(searching){
    body=`<p class="library-note">‘${esc(state.query.trim())}’ · 프로젝트 이름, 결과물 제목·파일명·내용에서 찾았습니다.</p>${!count?'<div class="empty"><h2>일치하는 프로젝트나 결과물이 없습니다</h2><p>검색어와 프로젝트 상태 필터를 바꿔 보세요.</p><button class="button small" data-reset>전체 프로젝트 보기</button></div>':`${projects.length?`<div class="result-group"><h3>프로젝트 <span class="count">${projects.length}</span></h3><div class="project-grid">${projects.map(card).join('')}</div></div>`:''}${outputs.length?`<div class="result-group"><h3>결과물 <span class="count">${outputs.length}</span></h3><div class="output-grid">${outputs.map(artifactCard).join('')}</div></div>`:''}`}`;
  }else if(isOutputs){
    body=`<p class="library-note">Patchbay에서 생성한 문서·화면·이미지입니다. 프로젝트의 완료 여부와 관계없이 생성된 결과물을 볼 수 있습니다.</p><div class="output-grid">${outputs.length?outputs.map(artifactCard).join(''):'<div class="empty"><h2>아직 생성된 결과물이 없습니다</h2><p>결과물이 생성되면 이곳에서 찾아볼 수 있습니다.</p><button class="button small" data-home-view="projects">프로젝트 보기</button></div>'}</div>`;
  }else{
    body=`<div class="project-grid">${projects.length?projects.map(card).join(''):empty()}${state.filter==='all'?'<button class="add-card" data-add><span>＋</span><b>새로운 프로젝트 연결</b><small>기존 폴더를 등록하거나 새로 시작합니다</small></button>':''}</div>`;
  }
  return `<section id="project-section" aria-label="프로젝트와 결과물">${controls}${body}</section>`;
}
function openArtifactCollection(projectId,selectedId) {
  const p=projectById(projectId),outputs=artifactsForProject(projectId);
  if(!p||!outputs.length)return;
  const selected=outputs.find(a=>a.id===selectedId)||outputs[0],wasOpen=dialog.open;
  const preview=selected.image?`<figure class="output-image"><img src="${selected.image}" alt="${esc(selected.title)} 예시 미리보기"><figcaption>${selected.format} · 시안용 예시 화면</figcaption></figure>`:
    `<article class="output-document"><div class="eyebrow">PATCHBAY · 생성 문서 예시</div><h3>${esc(selected.title)}</h3><p class="document-lead">${esc(selected.description)}</p>${selected.sections.map(s=>`<section><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p></section>`).join('')}</article>`;
  showDialog(`${p.name} · 결과물`,'GENERATED OUTPUTS / 시안',`<p class="output-viewer-intro">Patchbay에서 생성한 결과물 ${outputs.length}개 · 예시 데이터</p><div class="output-viewer"><nav class="output-list" aria-label="${p.name} 결과물 목록">${outputs.map(a=>`<button data-artifact="${a.id}" aria-pressed="${a.id===selected.id}">${outputIcon(a.format)}<span><b>${esc(a.title)}</b><small>${a.version} · ${a.status} · ${a.time}</small></span></button>`).join('')}</nav><section class="output-preview" aria-label="결과물 미리보기"><header><div><span class="output-state">${selected.status}</span><span class="output-preview-meta">${selected.kind} · ${selected.version} · ${selected.stage}에서 생성</span></div><p>${esc(selected.filename)}</p></header>${preview}</section></div>`);
  dialog.classList.add('artifact-dialog');
  if(wasOpen)dialog.querySelector(`[data-artifact="${selected.id}"]`).focus({preventScroll:true});
}
