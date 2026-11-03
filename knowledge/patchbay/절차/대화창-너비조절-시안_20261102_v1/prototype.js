const workspace=document.querySelector('#workspace'),work=document.querySelector('#work'),chat=document.querySelector('#chat'),splitter=document.querySelector('#splitter'),expand=document.querySelector('#expand'),shade=document.querySelector('#shade');
let desired=360,expanded=false,dragging=false,atLimit=false,returnFocus=null,modeScroll=0;
const MIN_WORK=800,MIN_CHAT=320,MAX_CHAT=640,GUTTER=10;
const cap=()=>Math.min(MAX_CHAT,workspace.clientWidth-MIN_WORK-GUTTER);
const compact=()=>cap()<MIN_CHAT;
function render(){
  document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===(expanded?'expand':atLimit?'wide':'default'))));
  const max=cap(),small=compact(),width=Math.max(MIN_CHAT,Math.min(desired,Math.max(MIN_CHAT,max)));
  workspace.classList.toggle('compact',small);workspace.classList.toggle('expanded',expanded);
  workspace.style.setProperty('--chat-width',width+'px');
  shade.hidden=!expanded;document.querySelector('#expanded-note').hidden=!expanded;
  work.inert=expanded;splitter.tabIndex=expanded||small?-1:0;
  expand.textContent=expanded?'↙':small?'대화 열기':'⤢';expand.setAttribute('aria-label',expanded?'대화 복원':small?'대화 열기':'대화 확대');expand.title=expand.getAttribute('aria-label');
  splitter.setAttribute('aria-valuemax',String(Math.max(MIN_CHAT,max)));splitter.setAttribute('aria-valuenow',String(width));
  splitter.setAttribute('aria-valuetext',`대화 ${Math.round(width)}픽셀, 작업 화면 최소 ${MIN_WORK}픽셀`);
  document.querySelector('#mode-label').textContent=expanded?'대화 확대':small?'작은 화면':'기본 분할';
  document.querySelector('#hint').textContent=expanded?'왼쪽 배치를 더 줄이지 않고 대화를 넓혔습니다.':small?'공간이 부족할 때는 「대화 열기」로 넓게 봅니다.':atLimit?'작업 화면을 위한 최소 공간입니다. 더 넓게 보려면 ⤢ 확대를 누르세요.':'경계선 드래그 · 방향키 조절 · 더블클릭 초기화';
  requestAnimationFrame(()=>{document.querySelector('#work-width').textContent=Math.round(work.getBoundingClientRect().width);document.querySelector('#chat-width').textContent=expanded?Math.round(chat.getBoundingClientRect().width):small?'—':Math.round(chat.getBoundingClientRect().width);});
}
function setExpanded(on){if(on===expanded)return;modeScroll=document.querySelector('#messages').scrollTop;if(on)returnFocus=document.activeElement;expanded=on;render();document.querySelector('#messages').scrollTop=modeScroll;if(on)expand.focus();else(returnFocus?.isConnected?returnFocus:expand).focus({preventScroll:true});}
function resize(value){desired=Math.max(MIN_CHAT,Math.min(MAX_CHAT,value));atLimit=value>=cap();render();}
splitter.addEventListener('pointerdown',e=>{if(expanded||compact())return;dragging=true;splitter.setPointerCapture(e.pointerId);e.preventDefault();});
splitter.addEventListener('pointermove',e=>{if(!dragging)return;const right=workspace.getBoundingClientRect().right;resize(right-e.clientX-GUTTER/2);});
function end(){dragging=false;}splitter.addEventListener('pointerup',end);splitter.addEventListener('pointercancel',end);splitter.addEventListener('lostpointercapture',end);
splitter.addEventListener('dblclick',()=>{desired=360;atLimit=false;render();});
splitter.addEventListener('keydown',e=>{const current=Math.min(desired,cap());if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resize(current+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?40:16));}else if(e.key==='Home'){e.preventDefault();resize(MIN_CHAT);}else if(e.key==='End'){e.preventDefault();resize(cap());}});
expand.addEventListener('click',()=>setExpanded(!expanded));shade.addEventListener('click',()=>setExpanded(false));
document.querySelector('#restore').addEventListener('click',()=>{setExpanded(false);desired=360;atLimit=false;render();});
document.addEventListener('keydown',e=>{if(expanded&&e.key==='Escape'){e.preventDefault();setExpanded(false);}if(expanded&&e.key==='Tab'){const buttons=[...chat.querySelectorAll('button,textarea')].filter(el=>!el.disabled&&el.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(button.dataset.preset==='expand')setExpanded(true);else{setExpanded(false);desired=button.dataset.preset==='wide'?Math.max(MIN_CHAT,cap()):360;atLimit=button.dataset.preset==='wide';render();}}));
document.querySelector('#draft').addEventListener('input',e=>{document.querySelector('#draft-status').textContent=e.target.value?'작성 중 · 확대/복원해도 유지됩니다.':'시안에서는 메시지를 전송하지 않습니다.';});
document.querySelector('#send').addEventListener('click',()=>{document.querySelector('#draft-status').textContent='시안입니다. 입력 내용은 전송되지 않았습니다.';});document.querySelector('#attach').addEventListener('click',()=>{document.querySelector('#draft-status').textContent='첨부 버튼 위치 예시입니다.';});
new ResizeObserver(()=>{if(dragging)return;atLimit=desired>=cap();render();}).observe(workspace);render();
