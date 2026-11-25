(() => {
'use strict';
if (window.__ZEUS_INTERACT_V1__) return;
window.__ZEUS_INTERACT_V1__ = true;

const K={macros:'zeus_macros',history:'zeus_interact_history_v1',check:'zeus_interact_checklist_v1'};
const STEPS=['Confirmar a identificação do solicitante','Entender e registrar o problema','Executar ou orientar a solução','Confirmar se o solicitante conseguiu utilizar','Registrar o resultado e encerrar o atendimento'];
const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)) ?? d}catch(_){return d}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}};
let macros=read(K.macros,null), history=read(K.history,[]), checks=read(K.check,{});
let tab='macros',opened=false,host,root,panel,toast,search,list;
const api=globalThis.chrome?.runtime||globalThis.browser?.runtime;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vars=s=>String(s).replace(/{{data}}/g,new Date().toLocaleDateString('pt-BR')).replace(/{{hora}}/g,new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));

async function defaults(){
 if(Array.isArray(macros))return;
 try{const r=await fetch(api.getURL('assets/default-macros.json'));macros=r.ok?await r.json():[]}
 catch(_){macros=[]}
 write(K.macros,macros);
}
function notice(msg,type){
 if(!toast)return;toast.textContent=msg;toast.dataset.type=type||'info';toast.classList.add('show');
 clearTimeout(notice.t);notice.t=setTimeout(()=>toast.classList.remove('show'),2500);
}
function editor(){
 const frames=[...document.querySelectorAll('iframe')];
 for(const f of frames){
  try{
   const d=f.contentDocument,b=d?.body;
   if(!d||!b)continue;
   const rich=/RichTextArea|richtextarea/i.test((f.className||'')+' '+(f.id||''));
   const editable=d.designMode==='on'||b.isContentEditable||b.contentEditable==='true';
   if(editable&&(rich||b))return {f,d,b};
  }catch(_){}
 }
 const e=document.querySelector('textarea:not([readonly]),[contenteditable="true"]');
 return e?{e}:null;
}
function fireEditorEvents(d,b,text){
 try{b.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))}catch(_){b.dispatchEvent(new Event('input',{bubbles:true}))}
 try{d.dispatchEvent(new Event('input',{bubbles:true}))}catch(_){}
 try{b.dispatchEvent(new Event('change',{bubbles:true}))}catch(_){}
}
function insert(text,title){
 const ed=editor();
 if(!ed){notice('Não encontrei o campo de mensagem. Clique dentro da caixa de texto e tente novamente.','warn');return}
 try{
  if(ed.b){
   const {f,d,b}=ed;
   f.focus();b.focus();
   let sel=d.getSelection();
   if(!sel){notice('O editor não disponibilizou a seleção de texto.','error');return}
   if(!sel.rangeCount){const r=d.createRange();r.selectNodeContents(b);r.collapse(false);sel.addRange(r)}
   // Primeiro tenta a API nativa do editor; valida se o texto realmente apareceu.
   const before=b.innerText||b.textContent||'';
   let inserted=false;
   try{
    const html=String(text).split(/\r?\n/).map(line=>line?line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'<br>').join('<br>');
    d.execCommand('insertHTML',false,html);
    inserted=(b.innerText||b.textContent||'').length>before.length;
   }catch(_){}
   if(!inserted){
    sel=d.getSelection();
    if(!sel.rangeCount){const r=d.createRange();r.selectNodeContents(b);r.collapse(false);sel.addRange(r)}
    const range=sel.getRangeAt(0);range.deleteContents();
    const fragment=d.createDocumentFragment();
    String(text).split(/\r?\n/).forEach((line,i)=>{if(i)fragment.appendChild(d.createElement('br'));fragment.appendChild(d.createTextNode(line))});
    const last=fragment.lastChild;range.insertNode(fragment);
    if(last){range.setStartAfter(last);range.collapse(true);sel.removeAllRanges();sel.addRange(range)}
   }
   fireEditorEvents(d,b,text);
   // GWT pode atualizar o estado interno após o próximo ciclo de eventos.
   setTimeout(()=>{try{fireEditorEvents(d,b,text)}catch(_){}},0);
  }else{
   const e=ed.e;e.focus();
   if(e.tagName==='TEXTAREA'){
    const a=e.selectionStart??e.value.length,z=e.selectionEnd??e.value.length;e.setRangeText(text,a,z,'end');
   }else{
    const d=e.ownerDocument,sel=d.getSelection(),range=d.createRange();
    if(sel?.rangeCount)range.setStart(sel.getRangeAt(0).startContainer,sel.getRangeAt(0).startOffset);
    else{range.selectNodeContents(e);range.collapse(false)}
    range.collapse(true);range.deleteContents();
    String(text).split(/\r?\n/).forEach((line,i)=>{if(i)e.appendChild(d.createElement('br'));e.appendChild(d.createTextNode(line))});
   }
   e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
  }
  history.unshift({title:title||'Texto inserido',text,time:new Date().toISOString()});history=history.slice(0,40);write(K.history,history);
  notice('Texto inserido. Confira o campo de mensagem antes de enviar.','success');
 }catch(e){console.warn('[Zeus] Falha ao inserir macro:',e);notice('Falha ao inserir. O texto não foi enviado.','error')}
}
function renderMacros(){
 const view=panel.querySelector('#view');
 view.innerHTML='<input class="search" id="search" placeholder="Buscar macro..." autocomplete="off"><div class="list" id="list"></div>';
 search=view.querySelector('#search');list=view.querySelector('#list');search.addEventListener('input',drawMacros);drawMacros();
}
function drawMacros(){
 const q=(search.value||'').toLocaleLowerCase('pt-BR');
 const rows=[...(macros||[])].filter(m=>[m.title,m.cat,m.text].join(' ').toLocaleLowerCase('pt-BR').includes(q)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||String(a.cat).localeCompare(String(b.cat),'pt-BR'));
 list.innerHTML='';
 if(!rows.length){list.innerHTML='<div class="empty">Nenhuma macro encontrada.</div>';return}
 rows.forEach(m=>{
  const row=document.createElement('div');row.className='macro';
  const main=document.createElement('div');main.className='main';
  main.innerHTML='<b>'+esc(m.title)+'</b><small>'+esc(m.cat||'Sem categoria')+'</small>';
  main.addEventListener('click',()=>insert(vars(m.text),m.title));
  const fav=document.createElement('button');fav.className='fav';fav.textContent=m.pinned?'★':'☆';fav.title='Alternar favorito';
  fav.addEventListener('click',()=>{m.pinned=!m.pinned;write(K.macros,macros);drawMacros()});
  row.append(main,fav);list.append(row);
 });
}
function renderChecklist(){
 const view=panel.querySelector('#view');const today=new Date().toLocaleDateString('en-CA');
 if(checks.date!==today)checks={date:today,items:{}};
 const done=STEPS.filter((_,i)=>checks.items?.[i]).length;
 view.innerHTML='<div class="progress">'+done+' de '+STEPS.length+' concluídas</div><div class="list" id="checks"></div><button class="action" id="reset">Reiniciar checklist</button>';
 const box=view.querySelector('#checks');
 STEPS.forEach((s,i)=>{const l=document.createElement('label');l.className='check';const c=document.createElement('input');c.type='checkbox';c.checked=!!checks.items[i];const t=document.createElement('span');t.textContent=s;if(c.checked)l.classList.add('done');c.addEventListener('change',()=>{checks.items[i]=c.checked;write(K.check,checks);renderChecklist()});l.append(c,t);box.append(l)});
 view.querySelector('#reset').addEventListener('click',()=>{checks={date:today,items:{}};write(K.check,checks);renderChecklist()});write(K.check,checks);
}
function renderHistory(){
 const view=panel.querySelector('#view');view.innerHTML='<div class="historyhead"><span>'+history.length+' registros</span><button class="action" id="clear">Limpar</button></div><div class="list" id="hist"></div>';
 const box=view.querySelector('#hist');
 if(!history.length)box.innerHTML='<div class="empty">As macros inseridas aparecerão aqui.</div>';
 history.forEach(h=>{const r=document.createElement('div');r.className='histrow';const d=new Date(h.time);r.innerHTML='<b>'+esc(h.title)+'</b><small>'+d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</small><p>'+esc(h.text)+'</p>';box.append(r)});
 view.querySelector('#clear').addEventListener('click',()=>{if(confirm('Limpar histórico?')){history=[];write(K.history,history);renderHistory()}});
}
function render(){
 panel.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='macros')renderMacros();if(tab==='checklist')renderChecklist();if(tab==='history')renderHistory();
}
function toggle(force){opened=typeof force==='boolean'?force:!opened;panel.classList.toggle('open',opened);if(opened){render();if(tab==='macros')setTimeout(()=>search?.focus(),40)}}
function initUI(){
 host=document.createElement('div');host.id='zeus-interact-host';host.style.cssText='position:fixed;z-index:2147483647;right:0;bottom:0';
 root=host.attachShadow({mode:'open'});
 const style=document.createElement('style');
 style.textContent='*{box-sizing:border-box}.launch{position:fixed;right:24px;bottom:24px;width:58px;height:58px;border:0;border-radius:50%;background:linear-gradient(135deg,#1e3a8a,#3976e8);color:white;font-size:25px;cursor:pointer;box-shadow:0 12px 32px #0f172a55;transition:.2s}.launch:hover{transform:translateY(-3px) scale(1.04)}.panel{position:fixed;right:24px;bottom:94px;width:390px;height:min(590px,calc(100vh - 125px));display:none;flex-direction:column;overflow:hidden;border:1px solid #cbd5e1;border-radius:17px;background:#f3f6fb;color:#243247;box-shadow:0 24px 70px #0f172a55;font:13px Segoe UI,Arial,sans-serif}.panel.open{display:flex;animation:pop .18s ease-out}@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:linear-gradient(120deg,#172d62,#315cc0);color:white}.brand{font-size:16px;font-weight:700}.sub{font-size:11px;opacity:.8;margin-top:3px}.close{border:0;border-radius:8px;padding:6px 9px;background:#ffffff22;color:white;cursor:pointer}.tabs{display:flex;gap:5px;padding:10px 12px 0;background:#e5ebf5}.tab{flex:1;border:0;border-radius:8px 8px 0 0;padding:10px 5px;background:transparent;color:#53647b;cursor:pointer;font-weight:600}.tab.active{background:#f3f6fb;color:#315cc0;box-shadow:inset 0 -2px #315cc0}.view{display:flex;flex:1;min-height:0;flex-direction:column;padding:12px}.search{padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:white;color:#243247;outline:none}.list{flex:1;min-height:0;overflow:auto;margin-top:9px;border:1px solid #d9e1ec;border-radius:10px;background:white}.macro{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid #edf1f6}.main{flex:1;cursor:pointer}.main b,.histrow b{display:block;color:#253650}.main small,.histrow small{display:block;margin-top:4px;color:#718096;font-size:11px}.macro:hover{background:#edf3ff}.fav{border:0;background:transparent;color:#d49b27;font-size:18px;cursor:pointer}.empty{padding:22px;text-align:center;color:#718096}.check{display:flex;gap:9px;padding:12px;border-bottom:1px solid #edf1f6;background:white}.check input{accent-color:#315cc0}.check.done span{text-decoration:line-through;color:#8290a3}.progress,.historyhead{font-size:12px;color:#60718a;margin-bottom:8px}.historyhead{display:flex;justify-content:space-between;align-items:center}.histrow{padding:11px 12px;border-bottom:1px solid #edf1f6;background:white}.histrow p{font-size:12px;color:#526178;white-space:pre-wrap;max-height:55px;overflow:hidden;margin:6px 0 0}.action{margin-top:9px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#334155;padding:8px 10px;cursor:pointer}.foot{padding:9px 12px;border-top:1px solid #d9e1ec;color:#718096;font-size:11px}.toast{position:fixed;right:24px;bottom:164px;max-width:340px;padding:11px 14px;border-radius:9px;background:#263449;color:white;box-shadow:0 8px 24px #0f172a44;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;font:13px Segoe UI,Arial}.toast.show{opacity:1;transform:none}.toast[data-type=success]{background:#147a58}.toast[data-type=error]{background:#b93838}.toast[data-type=warn]{background:#986313}@media(max-width:520px){.panel{left:10px;right:10px;width:auto;bottom:82px;height:calc(100vh - 100px)}.launch{right:16px;bottom:16px}}';
 panel=document.createElement('section');panel.className='panel';
 panel.innerHTML='<header class="head"><div><div class="brand">⚡ ZEUS Central</div><div class="sub">Produtividade no atendimento</div></div><button class="close" id="close">✕</button></header><nav class="tabs"><button class="tab active" data-tab="macros">Macros</button><button class="tab" data-tab="checklist">Checklist</button><button class="tab" data-tab="history">Histórico</button></nav><main class="view" id="view"></main><footer class="foot">Alt+Z abrir/fechar · Ctrl+Shift+M buscar · Esc fechar</footer>';
 toast=document.createElement('div');toast.className='toast';
 const launch=document.createElement('button');launch.className='launch';launch.textContent='⚡';launch.title='Abrir Zeus (Alt+Z)';launch.addEventListener('click',()=>toggle());
 panel.querySelector('#close').addEventListener('click',()=>toggle(false));
 panel.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render()}));
 root.append(style,launch,panel,toast);document.body.append(host);
}
function keys(e){
 const key=String(e.key||'').toLowerCase();
 if(e.altKey&&(key==='z'||e.code==='KeyZ')){e.preventDefault();e.stopPropagation();toggle()}
 else if(e.ctrlKey&&e.shiftKey&&(key==='m'||e.code==='KeyM')){e.preventDefault();e.stopPropagation();tab='macros';toggle(true);setTimeout(()=>search?.focus(),40)}
 else if(key==='escape'&&opened){e.preventDefault();toggle(false)}
}
function bindFrameKeys(){
 for(const f of document.querySelectorAll('iframe')){
  try{const d=f.contentDocument;if(d&&!d.__zeusKeysBound){d.addEventListener('keydown',keys,true);d.__zeusKeysBound=true}}catch(_){}
 }
}
async function start(){
 await defaults();if(!document.body)return;initUI();
 document.addEventListener('keydown',keys,true);window.addEventListener('keydown',keys,true);
 bindFrameKeys();
 new MutationObserver(bindFrameKeys).observe(document.documentElement,{childList:true,subtree:true});
 console.info('[Zeus] Central Interact v1.1 carregada');
}
start();
})();