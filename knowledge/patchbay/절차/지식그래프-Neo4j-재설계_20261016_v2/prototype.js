const options = [
  {id:'a',name:'지식 구축·검토',title:'A · 문서에서 검토 가능한 지식 만들기',desc:'원문과 관계 후보를 비교하고 검토 상태와 반영 상태를 확인합니다.',result:'관계 후보, 원문 근거, 승인 이력. 첫 구현으로 추천합니다.',route:['자료 선택','관계 후보','근거 검토','그래프 반영'],limit:'첫 범위는 선택한 텍스트 문서·대화입니다. 자동 병합·PDF·벡터 검색은 후속입니다.'},
  {id:'b',name:'관계 탐색',title:'B · 연결의 이유를 따라가는 지식 지도',desc:'하나의 개체에서 시작해 관계를 좁히고 연결별 원문을 확인합니다.',result:'검색·홉 확장·관계 선택·근거 열기. 일상적인 기본 화면에 적합합니다.',route:['개체 검색','범위 선택','연결 선택','근거 확인'],limit:'기본은 승인·최신·반영 완료 관계입니다. 후보·개정 근거는 따로 켜서 비교합니다.'},
  {id:'c',name:'근거 답변',title:'C · 질문에 답하고 사용한 근거 보여주기',desc:'관계 경로와 원문이 어떻게 답변에 쓰였는지 확인합니다.',result:'인용 답변, 사용한 관계, 근거 부족·반영 대기 안내.',route:['질문','개체·문단 검색','승인 관계','인용 답변'],limit:'GraphRAG — 관계와 원문을 함께 검색해 답하는 방식. 문서 검색 기준선과 비교한 뒤 채택합니다.'},
  {id:'d',name:'그래프 분석',title:'D · 검토된 지식에서 구조와 주제 발견하기',desc:'관계의 분포를 살피고 분석 조건과 결과의 의미를 검토합니다.',result:'주제별 군집·연결의 중심·분석 조건이 담긴 보고서.',route:['분석 범위','관계 투영','분석 실행','해석 검토'],limit:'후속 확장입니다. GDS 설치·호환성과 충분한 검토 자료가 필요합니다. 아래 수치는 별도 표본의 가상 결과입니다.'}
];
const initialClaims = () => [
  {id:'uses',from:'patchbay',to:'neo4j',kind:'USES',verb:'사용한다',review:'pending',source:'current',line:'8줄',quote:'Patchbay는 관계를 탐색할 때 Neo4j를 사용한다.'},
  {id:'query',from:'neo4j',to:'cypher',kind:'QUERIED_WITH',verb:'조회 언어',review:'approved',source:'current',line:'9줄',quote:'Neo4j의 데이터는 Cypher로 조회한다.'},
  {id:'retrieve',from:'graphrag',to:'neo4j',kind:'USES',verb:'사용한다',review:'approved',source:'current',line:'12줄',quote:'이 예시의 GraphRAG는 관계 검색에 Neo4j를 사용한다.'},
  {id:'cite',from:'graphrag',to:'evidence',kind:'USES',verb:'사용한다',review:'approved',source:'current',line:'14줄',quote:'이 예시의 GraphRAG 답변에는 원문 출처를 인용한다.'}
];
const entities = {
  patchbay:{name:'Patchbay',kind:'소프트웨어',x:100,y:155},
  neo4j:{name:'Neo4j',kind:'데이터베이스',x:300,y:155},
  cypher:{name:'Cypher',kind:'질의 언어',x:510,y:75},
  graphrag:{name:'GraphRAG',kind:'검색·답변 방식',x:510,y:250},
  evidence:{name:'출처 인용',kind:'답변 기능',x:290,y:290}
};
const state = {seq:0,appliedSeq:0,projectionFailed:false,tab:'a',claims:initialClaims(),claim:'uses',selected:'neo4j',hops:'1',query:'',answer:'',algo:'community',includePending:false};
const $ = s => document.querySelector(s);
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const claim = () => state.claims.find(c=>c.id===state.claim);
const eligible = c => c.review==='approved' && c.source==='current' && state.seq===state.appliedSeq;
const projectionState = () => state.seq===state.appliedSeq?'synced':state.projectionFailed?'failed':'pending';
const reviewLabel = c => ({pending:'검토 대기',approved:'검토 승인',rejected:'기각',withdrawn:'철회'})[c.review];
const sourceLabel = c => c.source==='current'?'최신 근거':'원문 개정 · 재검토';
const projectionLabel = c => state.seq===state.appliedSeq && c.review==='pending'?'후보 · 기본 그래프 제외':({pending:'그래프 반영 대기',synced:'그래프 반영 완료',failed:'그래프 반영 실패'})[projectionState()];
const title = c => `${entities[c.from].name} → ${c.verb} → ${entities[c.to].name}`;
function chips(c){return `<div class="chipbar"><span class="${c.review==='approved'?'good':''}">${reviewLabel(c)}</span><span class="${c.source==='current'?'good':''}">${sourceLabel(c)}</span><span class="${projectionState()==='synced'?'good':''}">${projectionLabel(c)}</span></div>`;}
function render(){
  $('.tabs').innerHTML=options.map(o=>`<button class="tab" role="tab" id="tab-${o.id}" aria-selected="${state.tab===o.id}" aria-controls="workspace" tabindex="${state.tab===o.id?'0':'-1'}" data-tab="${o.id}"><strong><em>${o.id.toUpperCase()}</em>${o.name}</strong><span>${({a:'원문 → 후보 → 검토',b:'개체 → 연결 → 근거',c:'질문 → 관계 → 답변',d:'범위 → 분석 → 해석'})[o.id]}</span></button>`).join('');
  const o=options.find(o=>o.id===state.tab);
  $('#option-title').textContent=o.title; $('#option-desc').textContent=o.desc; $('#option-result').textContent=o.result;
  $('#option-route').innerHTML=o.route.map(s=>`<span>${escape(s)}</span>`).join(' → '); $('#option-limit').textContent=o.limit;
  $('#workspace').setAttribute('aria-labelledby','tab-'+state.tab);
  $('#workspace').innerHTML=({a:buildA,b:buildB,c:buildC,d:buildD})[state.tab]();
}
function buildA(){
  const c=claim();
  const note=c.source!=='current'?'승인 이력은 그대로 보존합니다. 바뀐 원문에서 다시 검토하기 전까지 이 근거를 검색에 사용하지 않습니다.':c.review==='approved'?projectionState()==='synced'?'승인과 그래프 반영이 끝났습니다. B의 기본 탐색과 C의 답변에서 사용할 수 있습니다.':projectionState()==='failed'?'승인 기록은 저장되어 있습니다. 같은 작업 ID로 그래프 반영만 다시 시도합니다.':'승인 기록은 저장됐고 그래프 반영을 기다립니다. 아직 답변 근거로 사용하지 않습니다.':c.review==='rejected'?'기각 이력은 남기고 기본 탐색·답변에서 제외합니다.':'원문과 관계를 대조한 뒤 승인하거나 기각합니다.';
  return `<div class="grid-a"><aside class="panel"><h3>선택한 자료</h3><div class="doc">그래프 설계 예시.md<br><small>v2 · 4개 문단 · 가상 자료</small></div><div class="statline"><span><b>4</b>관계</span><span><b>${state.claims.filter(eligible).length}</b>사용 가능</span></div><div class="claim-list">${state.claims.map(x=>`<button data-claim="${x.id}" aria-pressed="${state.claim===x.id}">${escape(title(x))}<br><small>${reviewLabel(x)} · ${x.source==='current'?'최신':'개정'}</small></button>`).join('')}</div></aside><section class="panel"><div class="meta">문서 본문에서 만든 관계 후보</div><h2>이 연결의 근거를 확인하세요</h2><p class="projection-cursor">검토 기록 ${state.seq} · 그래프 반영 ${state.appliedSeq}</p><div class="candidate"><div class="triple"><span class="entity">${entities[c.from].name}</span><span class="predicate">${c.kind}<br>${c.verb} →</span><span class="entity">${entities[c.to].name}</span></div>${chips(c)}<small>근거 1개의 검토·현재성과 프로젝트 전체의 반영 상태를 보여줍니다.</small></div><div class="buttons"><button class="approve" data-review="approved" ${c.source!=='current'||c.review==='approved'?'disabled':''}>근거 확인 · 승인</button><button data-review="rejected" ${c.review==='rejected'?'disabled':''}>기각</button><button data-action="stale" ${c.source!=='current'?'disabled':''}>원문 개정 상황</button></div>${state.seq!==state.appliedSeq?`<div class="buttons" style="margin-top:12px"><button class="primary" data-action="sync">${projectionState()==='failed'?'그래프 반영 재시도':'그래프 반영 완료 보기'}</button><button data-action="fail" ${projectionState()==='failed'?'disabled':''}>반영 실패 상황</button></div>`:''}<p class="feedback" aria-live="polite">${note}</p><small>이름이 같은 개체는 중복 후보로 표시하고 자동으로 합치지 않습니다.</small></section><aside class="panel"><h3>근거 문단</h3><small>그래프 설계 예시.md · v2 · ${c.line}</small><div class="quote">${c.quote}</div><button data-evidence="${c.id}">원문 위치 열기</button><p style="margin-top:16px">검토 승인은 “이 원문이 이 주장을 뒷받침함”을 확인한 기록입니다. 주장 자체가 사실임을 보증하지 않습니다.</p></aside></div>`;
}
function visibleGraph(analysis=false){
  let edges=state.claims.filter(c=>analysis||eligible(c)||state.includePending);
  let ids=new Set([state.selected]); let frontier=new Set([state.selected]);
  const steps=analysis?4:Number(state.hops);
  for(let i=0;i<steps;i++){
    const next=new Set();
    for(const c of edges){if(frontier.has(c.from)){ids.add(c.to);next.add(c.to);}if(frontier.has(c.to)){ids.add(c.from);next.add(c.from);}}
    frontier=next;
  }
  if(analysis) ids=new Set(Object.keys(entities));
  edges=edges.filter(c=>ids.has(c.from)&&ids.has(c.to));
  return {edges,ids};
}
function graph(analysis=false){
  const {edges,ids}=visibleGraph(analysis);
  return `<svg class="graph" viewBox="${analysis?'0 0 660 360':(()=>{const pts=[...ids].map(id=>entities[id]);const x=Math.min(...pts.map(n=>n.x))-90,y=Math.min(...pts.map(n=>n.y))-65,w=Math.max(...pts.map(n=>n.x))-x+90,h=Math.max(...pts.map(n=>n.y))-y+65;return `${x} ${y} ${Math.max(w,240)} ${Math.max(h,180)}`;})()}" role="group" aria-label="가상 의미 그래프"><defs><marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="#6984a5"/></marker></defs>${edges.map(c=>{const a=entities[c.from],b=entities[c.to],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);const sx=a.x+dx/len*64,sy=a.y+dy/len*28,tx=b.x-dx/len*64,ty=b.y-dy/len*28;return `<path class="edge ${!analysis&&!eligible(c)?'pending':''} ${c.id===state.claim?'selected':''}" d="M${sx} ${sy}L${tx} ${ty}" marker-end="url(#arr)" data-edge="${c.id}" aria-label="${escape(title(c))}"/><text class="edge-label" x="${(a.x+b.x)/2-25}" y="${(a.y+b.y)/2-13}">${c.verb}</text>`;}).join('')}${[...ids].map(id=>{const n=entities[id];return `<g class="node ${id===state.selected?'selected ':''}${analysis&&['graphrag','evidence'].includes(id)?'topic':''}" role="button" tabindex="0" aria-label="${n.name} 상세" data-node="${id}"><rect x="${n.x-59}" y="${n.y-23}" width="118" height="46" rx="10"/><text x="${n.x}" y="${n.y+5}">${n.name}</text></g>`;}).join('')}</svg>`;
}
function buildB(){
  const {edges}=visibleGraph(); const c=edges.find(x=>x.id===state.claim)||edges[0];
  return `${state.seq!==state.appliedSeq?'<p class="feedback">그래프 반영 대기 · '+(state.seq-state.appliedSeq)+'건. 최신 검토가 반영될 때까지 기본 탐색과 답변을 기다립니다.</p>':''}<div class="toolbar"><label>개체 찾기 <input id="entity-search" value="${escape(state.query)}" placeholder="Neo4j, Cypher 등"></label><button data-action="find">찾기</button><label>확장 범위 <select id="hops"><option value="1" ${state.hops==='1'?'selected':''}>1홉 · 직접 연결</option><option value="2" ${state.hops==='2'?'selected':''}>2홉 · 주변 맥락</option></select></label><label class="check"><input type="checkbox" id="include-pending" ${state.includePending?'checked':''}>후보·기각·개정·반영 대기도 보기</label></div><div class="graph-grid"><section class="panel"><h3>${entities[state.selected].name}에서 ${state.hops}홉 · 연결 ${edges.length}개</h3>${graph()}<div class="legend"><span>실선 · 사용 가능한 관계</span><span>점선 · 후보 / 기각 / 개정 / 반영 대기</span></div><div class="claim-list">${edges.map(x=>`<button data-edge="${x.id}" aria-pressed="${c?.id===x.id}">${escape(title(x))}</button>`).join('')}</div>${edges.length?'':'<p class="empty">사용 가능한 연결이 없습니다. A에서 검토하거나 대기 관계를 켜세요.</p>'}</section><aside class="panel"><h3>선택한 연결의 근거</h3>${c?`<div class="path">${escape(title(c))}</div>${chips(c)}<p style="margin:12px 0">그래프 설계 예시.md<br>v2 · ${c.line}</p><button data-evidence="${c.id}">이 연결의 원문 열기</button><p style="margin-top:18px">표시된 연결의 근거만 엽니다. 대기 관계는 답변·분석에 사용하지 않습니다.</p>`:'<p>선택한 개체의 근거 있는 연결부터 모아 주세요.</p>'}</aside></div>`;
}
function buildC(){
  const needUses=state.answer.includes('Patchbay'); const needed=state.claims.filter(c=>c.id==='query'||(needUses&&c.id==='uses')); const ready=needed.every(eligible); const known=/Neo4j|조회/.test(state.answer);
  const body=!state.answer?'<p class="muted">질문 예시를 선택하면 답변과 사용한 근거가 나타납니다.</p>':`<div class="answer"><h3>${!known?'근거 부족':ready?'근거를 바탕으로 한 예시 답변':'아직 사용할 수 없는 근거가 있습니다'}</h3><p>${!known?'이 예시 자료에는 답할 근거가 없습니다. 관련 자료를 추가하거나 질문 범위를 바꿔 주세요.':!ready?'검토 대기·원문 개정·그래프 반영 대기 중인 근거가 있습니다. A에서 상태를 확인한 뒤 다시 질문하세요.':`${needUses?'이 예시에서 Patchbay는 Neo4j로 관계를 탐색합니다. <button class="citation" data-evidence="uses">[1] 근거</button><br>':''}Neo4j 데이터는 Cypher로 조회합니다. <button class="citation" data-evidence="query">[${needUses?'2':'1'}] 근거</button>`}</p><div class="query-flow"><span>개체·문단 검색</span>→<span>승인·최신·반영 완료 관계</span>→<span>근거 원문</span>→<span>답변 / 근거 부족</span></div><small>입력에서 예시를 선택하는 고정 시안입니다. 자유 질문의 정확성을 검증하거나 LLM을 호출하지 않습니다.</small></div>`;
  return `<div class="question-layout"><section class="panel"><div class="meta">GraphRAG · 관계와 원문을 함께 검색해 답하는 방식</div><h2 style="margin-bottom:16px">무엇이 궁금한가요?</h2><form class="question-form" id="ask-form"><input name="question" aria-label="그래프에 질문" value="${escape(state.answer)}" placeholder="질문 예시를 선택하세요"><button class="primary" type="submit">근거로 답하기</button></form><div class="suggestions"><button data-question="Neo4j는 어떤 언어로 조회하나요?">Neo4j 조회 언어</button><button data-question="Patchbay는 Neo4j를 어떻게 사용하나요?">Patchbay와 Neo4j</button><button data-question="올해 운영 비용은 얼마인가요?">자료에 없는 질문</button></div>${body}</section><aside class="panel"><h3>${state.answer&&known?'이 질문에 필요한 근거':'근거를 확인하는 방식'}</h3>${state.answer&&known?needed.map(c=>`<div class="path">${escape(title(c))}</div>${chips(c)}<button data-evidence="${c.id}">${c.line} 원문</button>`).join(''):'<p>검토되지 않은 관계는 답변의 근거로 쓰지 않습니다. 부족하거나 상충하는 근거는 따로 표시합니다.</p>'}</aside></div>`;
}
function buildD(){
  const community=state.algo==='community';
  return `<div class="analysis-layout"><aside class="panel"><h3>분석 조건 · 가상 표본</h3><label for="algorithm">분석 방법</label><select id="algorithm"><option value="community" ${community?'selected':''}>커뮤니티 · 함께 묶이는 주제</option><option value="centrality" ${!community?'selected':''}>중심성 · 연결의 중심</option></select><p>별도 승인 표본 v1<br>개체 5개 · 관계 4개<br>USES · QUERIED_WITH<br>관계 방향을 무시한 투영<br>가중치 없음</p><p style="margin-top:15px">A~C와 별개인 분석 예시입니다. GDS 계산은 수행하지 않습니다.</p></aside><section class="panel"><div class="meta">분석 결과 표시 방식 · 가상 수치</div><h2>${community?'함께 묶이는 주제':'연결 구조의 중심'}</h2>${graph(true)}<div class="legend"><span>파랑 · 데이터·질의</span><span>초록 · 검색·근거</span></div></section><aside class="panel"><h3>${community?'군집 결과 · 예시':'중심성 순위 · 예시'}</h3>${community?'<div class="metric"><b>주제 A</b><small>Patchbay · Neo4j · Cypher</small></div><div class="metric"><b>주제 B</b><small>GraphRAG · 출처 인용</small></div>':'<div class="metric">Neo4j · 예시 0.42<div class="bar"><i style="width:84%"></i></div></div><div class="metric">GraphRAG · 예시 0.31<div class="bar"><i style="width:62%"></i></div></div><div class="metric">Cypher · 예시 0.14<div class="bar"><i style="width:28%"></i></div></div>'}<p>중심성이 높아도 참인 주장이나 사업 중요도를 뜻하지 않습니다. 데이터 범위·알고리즘·설정과 함께 해석합니다.</p></aside></div>`;
}
let evidenceOpener;
function openEvidence(id,opener){const c=state.claims.find(x=>x.id===id);if(!c)return;evidenceOpener=opener;$('#evidence small').textContent=`그래프 설계 예시.md · v2 · ${c.line} · 가상 근거`;$('#evidence .quote').textContent=c.quote;$('#evidence').hidden=false;$('#evidence [data-close]').focus();}
function closeEvidence(){$('#evidence').hidden=true;if(evidenceOpener?.isConnected)evidenceOpener.focus();}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-tab],[data-review],[data-action],[data-evidence],[data-close],[data-node],[data-edge],[data-claim],[data-question],#reset'); if(!t)return;
  if(t.dataset.tab){state.tab=t.dataset.tab;render();$('#tab-'+state.tab).focus();}
  else if(t.dataset.claim){state.claim=t.dataset.claim;render();}
  else if(t.dataset.edge){state.claim=t.dataset.edge;render();}
  else if(t.dataset.review){const c=claim();c.review=t.dataset.review;state.seq++;state.projectionFailed=false;render();}
  else if(t.dataset.action==='stale'){claim().source='stale';state.seq++;state.projectionFailed=false;render();}
  else if(t.dataset.action==='sync'){state.appliedSeq=state.seq;state.projectionFailed=false;render();}
  else if(t.dataset.action==='fail'){state.projectionFailed=true;render();}
  else if(t.dataset.action==='find'){state.query=$('#entity-search').value;const match=Object.keys(entities).find(k=>entities[k].name.toLowerCase().includes(state.query.trim().toLowerCase()));if(match){state.selected=match;render();}else{$('#entity-search').setCustomValidity('예시 개체가 없습니다. Neo4j 또는 Cypher로 검색하세요.');$('#entity-search').reportValidity();}}
  else if(t.hasAttribute('data-evidence'))openEvidence(t.dataset.evidence,t);
  else if(t.hasAttribute('data-close'))closeEvidence();
  else if(t.dataset.node){state.selected=t.dataset.node;render();}
  else if(t.dataset.question){state.answer=t.dataset.question;render();}
  else if(t.id==='reset'){Object.assign(state,{seq:0,appliedSeq:0,projectionFailed:false,claims:initialClaims(),claim:'uses',selected:'neo4j',hops:'1',query:'',answer:'',algo:'community',includePending:false});render();}
});
document.addEventListener('input',e=>{if(e.target.id==='entity-search')e.target.setCustomValidity('');});
document.addEventListener('change',e=>{if(e.target.id==='hops')state.hops=e.target.value;else if(e.target.id==='algorithm')state.algo=e.target.value;else if(e.target.id==='include-pending')state.includePending=e.target.checked;else return;render();});
document.addEventListener('submit',e=>{if(e.target.id==='ask-form'){e.preventDefault();state.answer=new FormData(e.target).get('question').trim();render();}});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('#evidence').hidden)closeEvidence();
  if(e.target.matches('[data-node]')&&['Enter',' '].includes(e.key)){e.preventDefault();state.selected=e.target.dataset.node;render();}
  if(e.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();let i=options.findIndex(o=>o.id===e.target.dataset.tab);i=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;state.tab=options[i].id;render();$('#tab-'+state.tab).focus();}
  if(!$('#evidence').hidden&&e.key==='Tab'){e.preventDefault();$('#evidence [data-close]').focus();}
});
render();
