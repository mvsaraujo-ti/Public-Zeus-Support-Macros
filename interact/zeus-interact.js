(() => {
'use strict';
if (window.__ZEUS_INTERACT_V1__) return;
window.__ZEUS_INTERACT_V1__ = true;

const K={macros:'zeus_macros',history:'zeus_interact_history_v1',theme:'zeus_interact_theme_v1'};

const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)) ?? d}catch(_){return d}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}};
let macros=read(K.macros,null), history=read(K.history,[]), theme=read(K.theme,'light');
let tab='macros',opened=false,host,root,panel,toast,search,list; let pageThemeStyle=null;
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
let rememberedEditor=null;
const savedRanges=new WeakMap();
function editor(){
 const candidates=[...document.querySelectorAll('iframe')].map(f=>{
  try{
   const d=f.contentDocument||f.contentWindow?.document,b=d?.body;
   if(!d||!b)return null;
   const sig=((f.id||'')+' '+(f.className||'')).toLowerCase();
   const rich=sig.includes('richtextarea')||sig.includes('richtext');
   const editable=d.designMode?.toLowerCase()==='on'||b.isContentEditable||b.contentEditable==='true'||rich;
   if(!editable)return null;
   const rect=f.getBoundingClientRect(),style=getComputedStyle(f);
   const visible=rect.width>80&&rect.height>25&&style.display!=='none'&&style.visibility!=='hidden';
   return visible?{kind:'frame',f,d,b,area:rect.width*rect.height}:null;
  }catch(_){return null}
 }).filter(Boolean).sort((a,b)=>b.area-a.area);
 if(candidates.length){
  const chosen=candidates[0];
  rememberedEditor=chosen;
  try{
   if(!chosen.d.__zeusRangeTracking){
    chosen.d.addEventListener('selectionchange',()=>{
     try{const s=chosen.d.getSelection();if(s?.rangeCount&&chosen.b.contains(s.getRangeAt(0).commonAncestorContainer))savedRanges.set(chosen.d,s.getRangeAt(0).cloneRange())}catch(_){}
    });
    chosen.d.__zeusRangeTracking=true;
   }
  }catch(_){}
  return chosen;
 }
 const e=document.querySelector('textarea:not([readonly]),[contenteditable="true"],[contenteditable=""],.x-form-field');
 if(e&&(/^(TEXTAREA|INPUT)$/.test(e.tagName)||e.isContentEditable))return {kind:'element',e};
 return rememberedEditor;
}
function emitEditorEvents(targets,text){
 for(const target of targets.filter(Boolean)){
  try{target.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:text}))}
  catch(_){try{target.dispatchEvent(new Event('input',{bubbles:true,composed:true}))}catch(__){}}
  try{target.dispatchEvent(new Event('change',{bubbles:true,composed:true}))}catch(_){}
 }
}
function insert(text,title){
 const ed=editor();
 if(!ed){notice('Não localizei o editor. Clique uma vez na caixa de mensagem e tente novamente.','warn');return}
 const value=String(text??'');
 try{
  if(ed.kind==='frame'){
   const {f,d,b}=ed;
   f.contentWindow.focus();f.focus();b.focus();
   let inserted=false;
   const before=b.innerHTML;
   // Primeiro tenta o mecanismo nativo do editor GWT, preservando a seleção anterior.
   try{
    const sel=d.getSelection(),remembered=savedRanges.get(d);
    if(remembered&&b.contains(remembered.commonAncestorContainer)){sel.removeAllRanges();sel.addRange(remembered)}
    else if(!sel?.rangeCount||!b.contains(sel.getRangeAt(0).commonAncestorContainer)){
     const r=d.createRange();r.selectNodeContents(b);r.collapse(false);sel?.removeAllRanges();sel?.addRange(r);
    }
    inserted=!!d.execCommand('insertText',false,value);
   }catch(_){}
   // Fallback determinístico: inserir texto no cursor salvo ou no final do editor.
   if(!inserted||b.innerHTML===before){
    const sel=d.getSelection();let range;
    const remembered=savedRanges.get(d);
    if(remembered&&b.contains(remembered.commonAncestorContainer))range=remembered.cloneRange();
    else if(sel?.rangeCount&&b.contains(sel.getRangeAt(0).commonAncestorContainer))range=sel.getRangeAt(0).cloneRange();
    else{range=d.createRange();range.selectNodeContents(b);range.collapse(false)}
    range.deleteContents();
    const fragment=d.createDocumentFragment();
    value.split(/\r?\n/).forEach((line,i)=>{if(i)fragment.appendChild(d.createElement('br'));if(line)fragment.appendChild(d.createTextNode(line))});
    const marker=d.createElement('span');marker.setAttribute('data-zeus-cursor','');marker.appendChild(d.createTextNode('\u200b'));fragment.appendChild(marker);
    range.insertNode(fragment);
    const caret=d.createRange();caret.setStart(marker.firstChild,1);caret.collapse(true);
    sel?.removeAllRanges();sel?.addRange(caret);savedRanges.set(d,caret.cloneRange());marker.removeAttribute('data-zeus-cursor');
   }
   // GWT sincroniza o RichTextArea por eventos de teclado/input.
   emitEditorEvents([b,d,f.contentWindow],value);
   ['keyup','input','change'].forEach(type=>{try{b.dispatchEvent(new Event(type,{bubbles:true}))}catch(_){}});
   try{b.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:' ',code:'Space'}))}catch(_){}
   if(b.innerHTML===before&&value){notice('O editor não aceitou a inserção. Clique dentro da caixa de mensagem e tente novamente.','error');return}
  }else{
   const e=ed.e;e.focus();
   if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){
    const a=e.selectionStart??e.value.length,z=e.selectionEnd??e.value.length;e.setRangeText(value,a,z,'end');
   }else{
    const d=e.ownerDocument,sel=d.getSelection(),r=d.createRange();
    if(sel?.rangeCount&&e.contains(sel.getRangeAt(0).commonAncestorContainer))r.setStart(sel.getRangeAt(0).startContainer,sel.getRangeAt(0).startOffset);
    else{r.selectNodeContents(e);r.collapse(false)}
    r.deleteContents();const node=d.createTextNode(value);r.insertNode(node);r.setStartAfter(node);r.collapse(true);sel?.removeAllRanges();sel?.addRange(r);
   }
   emitEditorEvents([e],value);
  }
  history.unshift({title:title||'Texto inserido',text:value,time:new Date().toISOString()});
  history=history.slice(0,40);write(K.history,history);
  notice('Macro inserida no editor. Revise antes de enviar.','success');
 }catch(err){console.warn('[Zeus] Erro ao inserir macro:',err);notice('Não foi possível inserir a macro. Nada foi enviado.','error')}
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
function renderHistory(){
 const view=panel.querySelector('#view');view.innerHTML='<div class="historyhead"><span>'+history.length+' registros</span><button class="action" id="clear">Limpar</button></div><div class="list" id="hist"></div>';
 const box=view.querySelector('#hist');
 if(!history.length)box.innerHTML='<div class="empty">As macros inseridas aparecerão aqui.</div>';
 history.forEach(h=>{const r=document.createElement('div');r.className='histrow';const d=new Date(h.time);r.innerHTML='<b>'+esc(h.title)+'</b><small>'+d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</small><p>'+esc(h.text)+'</p>';box.append(r)});
 view.querySelector('#clear').addEventListener('click',()=>{if(confirm('Limpar histórico?')){history=[];write(K.history,history);renderHistory()}});
}
function render(){
 panel.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 if(tab==='macros')renderMacros();
 if(tab==='history')renderHistory();
 if(tab==='settings')renderSettings();
}
function downloadJSON(data,filename){
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function normalizeMacros(data){
 if(!Array.isArray(data))throw new Error('O JSON precisa conter uma lista de macros.');
 return data.map((m,i)=>{
  if(!m||typeof m!=='object'||typeof m.title!=='string'||typeof m.text!=='string')throw new Error('Macro '+(i+1)+' inválida: informe title e text.');
  return {id:m.id??Date.now()+i,title:m.title.trim(),cat:String(m.cat||'Geral').trim(),text:m.text,pinned:!!m.pinned};
 }).filter(m=>m.title&&m.text);
}
function importJSON(){
 const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
 input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{
  const parsed=JSON.parse(await file.text());const incoming=normalizeMacros(parsed);
  const replace=confirm('OK: substituir suas macros atuais.\nCancelar: adicionar as macros importadas às atuais.');
  macros=replace?incoming:[...macros,...incoming.map(m=>({...m,id:Date.now()+Math.random()}))];
  write(K.macros,macros);notice(incoming.length+' macros importadas.','success');render();
 }catch(e){notice('Não foi possível importar: '+e.message,'error')}};
 input.click();
}
function exportJSON(){
 downloadJSON(macros||[],'zeus-macros-'+new Date().toISOString().slice(0,10)+'.json');
 notice('Backup JSON exportado.','success');
}
function renderSettings(){
 const view=panel.querySelector('#view');
 view.innerHTML='<section class="setting"><div><b>Aparência do Interact</b><small>O tema será aplicado à página e às áreas internas acessíveis.</small></div><button class="action" id="theme">'+(theme==='dark'?'☀️ Usar tema claro':'🌙 Usar tema escuro')+'</button></section>'+
 '<section class="setting"><div><b>Suas macros</b><small>Crie, edite ou remova respostas salvas neste navegador.</small></div><button class="action primary" id="new">+ Nova macro</button></section>'+
 '<div class="list manager" id="manager"></div>'+
 '<section class="setting importtools"><div><b>Backup de macros</b><small>Exporte ou importe um arquivo JSON para compartilhar ou restaurar suas macros.</small></div><div class="toolrow"><button class="action" id="import">Importar JSON</button><button class="action" id="export">Exportar JSON</button></div></section>';
 view.querySelector('#theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';write(K.theme,theme);applyPageTheme();renderSettings()});
 view.querySelector('#new').addEventListener('click',()=>openMacroEditor());
 view.querySelector('#import').addEventListener('click',importJSON);
 view.querySelector('#export').addEventListener('click',exportJSON);
 const box=view.querySelector('#manager');
 if(!macros.length)box.innerHTML='<div class="empty">Nenhuma macro cadastrada.</div>';
 macros.forEach(m=>{
  const row=document.createElement('div');row.className='managerrow';
  const info=document.createElement('div');info.className='managerinfo';
  info.innerHTML='<b>'+esc(m.title)+'</b><small>'+esc(m.cat||'Geral')+'</small>';
  const actions=document.createElement('div');actions.className='manageractions';
  const edit=document.createElement('button');edit.className='action';edit.textContent='Editar';
  edit.addEventListener('click',()=>openMacroEditor(m));
  const del=document.createElement('button');del.className='action danger';del.textContent='Excluir';
  del.addEventListener('click',()=>{if(!confirm('Excluir a macro "'+m.title+'"?'))return;macros=macros.filter(x=>x.id!==m.id);write(K.macros,macros);renderSettings()});
  actions.append(edit,del);row.append(info,actions);box.append(row);
 });
}
function openMacroEditor(m=null){
 const overlay=document.createElement('div');overlay.className='modalback';
 const modal=document.createElement('section');modal.className='editmodal';
 modal.innerHTML='<header><b>'+(m?'Editar macro':'Nova macro')+'</b><button class="closemodal">✕</button></header><label>Nome<input id="mtitle" maxlength="90" placeholder="Ex.: Saudação inicial"></label><label>Categoria<input id="mcat" maxlength="60" placeholder="Ex.: Saudações"></label><label>Texto da macro<textarea id="mtext" rows="8" placeholder="Digite o texto que será inserido no atendimento"></textarea></label><footer><button class="action cancel">Cancelar</button><button class="action primary save">Salvar macro</button></footer>';
 root.append(overlay,modal);
 const close=()=>{overlay.remove();modal.remove()};
 overlay.addEventListener('click',close);modal.querySelector('.closemodal').addEventListener('click',close);modal.querySelector('.cancel').addEventListener('click',close);
 if(m){modal.querySelector('#mtitle').value=m.title;modal.querySelector('#mcat').value=m.cat||'';modal.querySelector('#mtext').value=m.text}
 modal.querySelector('.save').addEventListener('click',()=>{
  const title=modal.querySelector('#mtitle').value.trim(),cat=modal.querySelector('#mcat').value.trim()||'Geral',textValue=modal.querySelector('#mtext').value;
  if(!title||!textValue.trim()){notice('Preencha o nome e o texto da macro.','warn');return}
  if(m)Object.assign(m,{title,cat,text:textValue});else macros.push({id:Date.now(),title,cat,text:textValue,pinned:false});
  write(K.macros,macros);close();render();notice('Macro salva com sucesso.','success');
 });
}
function toggle(force){opened=typeof force==='boolean'?force:!opened;panel.classList.toggle('open',opened);if(opened){render();if(tab==='macros')setTimeout(()=>search?.focus(),40)}}
function themeCSS(){
 return theme==='dark'?String.raw`html,body{background:#20242b!important;color:#d7dce5!important}#pnlTelaPrincipal,.x-panel,.x-panel-body,.x-window,.x-window-mc,.x-tab-panel,.x-tab-panel-body,.x-grid3,.x-grid3-body,.x-grid3-row,.x-tree,.x-tree-node,.x-toolbar,.x-toolbar-ct,.x-form-field,.x-form-text,.x-menu,.x-menu-list,.x-combo-list,.x-border-layout-ct{background-color:#252a32!important;color:#d7dce5!important;border-color:#414854!important}.x-panel-header,.x-tab-strip,.x-tab-strip-top,.x-tab-strip-wrap{background:#303746!important;color:#e2e8f0!important}.x-tab-strip-active,.x-tab-strip-active .x-tab-right,.x-tab-strip-active .x-tab-left,.x-tab-strip-active .x-tab-strip-inner{background:#39465d!important;color:#a9c4ff!important}.x-btn-mc,.x-btn-tl,.x-btn-tr,.x-btn-tc,.x-btn-ml,.x-btn-mr,.x-btn-bl,.x-btn-br,.x-btn-bc{background-color:#303946!important;background-image:none!important;color:#e2e8f0!important;border-color:#4b5665!important}.x-form-text, input,textarea,select{background:#1d232b!important;color:#e2e8f0!important;border-color:#4b5665!important}.x-grid3-row-over,.x-tree-node-over{background:#354153!important}.x-grid3-row-selected{background:#344967!important}.x-grid3-cell-inner,.x-tree-node-anchor,.x-panel-header-text,.x-tab-strip-text{color:#d7dce5!important}iframe.gwt-RichTextArea{background:#252a32!important}`:
 String.raw`html,body{background:#e8edf5!important;color:#243247!important}.x-panel,.x-panel-body,.x-window,.x-window-mc,.x-tab-panel,.x-tab-panel-body,.x-grid3,.x-grid3-body,.x-grid3-row,.x-tree,.x-tree-node,.x-toolbar,.x-toolbar-ct,.x-form-field,.x-form-text,.x-menu,.x-menu-list,.x-combo-list,.x-border-layout-ct{background-color:#e8edf5!important;color:#243247!important;border-color:#cbd5e1!important}.x-panel-header,.x-tab-strip,.x-tab-strip-top,.x-tab-strip-wrap{background:#dce5f1!important;color:#243247!important}.x-tab-strip-active,.x-tab-strip-active .x-tab-right,.x-tab-strip-active .x-tab-left,.x-tab-strip-active .x-tab-strip-inner{background:#d5e0f2!important;color:#315cc0!important}.x-btn-mc,.x-btn-tl,.x-btn-tr,.x-btn-tc,.x-btn-ml,.x-btn-mr,.x-btn-bl,.x-btn-br,.x-btn-bc{background-color:#f1f4f8!important;background-image:none!important;color:#334155!important;border-color:#cbd5e1!important}.x-form-text,input,textarea,select{background:#f8fafc!important;color:#243247!important;border-color:#cbd5e1!important}.x-grid3-row-over,.x-tree-node-over{background:#dce8f8!important}.x-grid3-row-selected{background:#d3e4fa!important}.x-grid3-cell-inner,.x-tree-node-anchor,.x-panel-header-text,.x-tab-strip-text{color:#243247!important}`;
}
function applyPageTheme(){
 if(!pageThemeStyle){pageThemeStyle=document.getElementById('zeus-page-theme');if(!pageThemeStyle){pageThemeStyle=document.createElement('style');pageThemeStyle.id='zeus-page-theme';(document.head||document.documentElement).append(pageThemeStyle)}}
 const css=themeCSS();if(pageThemeStyle.textContent!==css)pageThemeStyle.textContent=css;
 if(panel)panel.dataset.theme=theme;
 // O documento do editor GWT fica em iframe same-origin; aplicar sem observar mutations de estilo.
 document.querySelectorAll('iframe').forEach(frame=>{try{const d=frame.contentDocument;if(!d||!d.documentElement)return;let s=d.getElementById('zeus-frame-theme');if(!s){s=d.createElement('style');s.id='zeus-frame-theme';(d.head||d.documentElement).append(s)}const frameCss=themeCSS();if(s.textContent!==frameCss)s.textContent=frameCss;if(d.body){d.body.style.background=theme==='dark'?'#252a32':'#e8edf5';d.body.style.color=theme==='dark'?'#d7dce5':'#243247'}}catch(_){}});
}
function initUI(){
 host=document.createElement('div');host.id='zeus-interact-host';host.style.cssText='position:fixed;z-index:2147483647;right:0;bottom:0';
 root=host.attachShadow({mode:'open'});
 const style=document.createElement('style');
 style.textContent='*{box-sizing:border-box}.launch{position:fixed;right:24px;bottom:24px;width:58px;height:58px;border:0;border-radius:50%;background:linear-gradient(135deg,#1e3a8a,#3976e8);color:white;font-size:25px;cursor:pointer;box-shadow:0 12px 32px #0f172a55;transition:.2s}.launch:hover{transform:translateY(-3px) scale(1.04)}.panel{position:fixed;right:24px;bottom:94px;width:390px;height:min(590px,calc(100vh - 125px));display:none;flex-direction:column;overflow:hidden;border:1px solid #cbd5e1;border-radius:17px;background:#f3f6fb;color:#243247;box-shadow:0 24px 70px #0f172a55;font:13px Segoe UI,Arial,sans-serif}.panel.open{display:flex;animation:pop .18s ease-out}@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:linear-gradient(120deg,#172d62,#315cc0);color:white}.brand{font-size:16px;font-weight:700}.sub{font-size:11px;opacity:.8;margin-top:3px}.close{border:0;border-radius:8px;padding:6px 9px;background:#ffffff22;color:white;cursor:pointer}.tabs{display:flex;gap:5px;padding:10px 12px 0;background:#e5ebf5}.tab{flex:1;border:0;border-radius:8px 8px 0 0;padding:10px 5px;background:transparent;color:#53647b;cursor:pointer;font-weight:600}.tab.active{background:#f3f6fb;color:#315cc0;box-shadow:inset 0 -2px #315cc0}.view{display:flex;flex:1;min-height:0;flex-direction:column;padding:12px}.search{padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:white;color:#243247;outline:none}.list{flex:1;min-height:0;overflow:auto;margin-top:9px;border:1px solid #d9e1ec;border-radius:10px;background:white}.macro{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid #edf1f6}.main{flex:1;cursor:pointer}.main b,.histrow b{display:block;color:#253650}.main small,.histrow small{display:block;margin-top:4px;color:#718096;font-size:11px}.macro:hover{background:#edf3ff}.fav{border:0;background:transparent;color:#d49b27;font-size:18px;cursor:pointer}.empty{padding:22px;text-align:center;color:#718096}.check{display:flex;gap:9px;padding:12px;border-bottom:1px solid #edf1f6;background:white}.check input{accent-color:#315cc0}.check.done span{text-decoration:line-through;color:#8290a3}.progress,.historyhead{font-size:12px;color:#60718a;margin-bottom:8px}.historyhead{display:flex;justify-content:space-between;align-items:center}.histrow{padding:11px 12px;border-bottom:1px solid #edf1f6;background:white}.histrow p{font-size:12px;color:#526178;white-space:pre-wrap;max-height:55px;overflow:hidden;margin:6px 0 0}.action{margin-top:9px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#334155;padding:8px 10px;cursor:pointer}.foot{padding:9px 12px;border-top:1px solid #d9e1ec;color:#718096;font-size:11px}.toast{position:fixed;right:24px;bottom:164px;max-width:340px;padding:11px 14px;border-radius:9px;background:#263449;color:white;box-shadow:0 8px 24px #0f172a44;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;font:13px Segoe UI,Arial}.toast.show{opacity:1;transform:none}.toast[data-type=success]{background:#147a58}.toast[data-type=error]{background:#b93838}.toast[data-type=warn]{background:#986313}.setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;margin-bottom:9px;border:1px solid #d9e1ec;border-radius:10px;background:white}.setting b{display:block;color:#253650}.setting small{display:block;max-width:230px;margin-top:4px;color:#718096;line-height:1.4}.toolrow{display:flex;gap:6px;flex-wrap:wrap}.manager{flex:1}.managerrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px;border-bottom:1px solid #edf1f6}.managerinfo{min-width:0}.managerinfo b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#253650}.managerinfo small{color:#718096}.manageractions{display:flex;gap:5px}.action.primary{background:#315cc0;color:white;border-color:#315cc0}.action.danger{color:#b93838}.modalback{position:fixed;inset:0;background:#0b173b66;backdrop-filter:blur(3px);z-index:2}.editmodal{position:fixed;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 28px));max-height:85%;overflow:auto;padding:15px;border:1px solid #d9e1ec;border-radius:14px;background:#f7f9fc;box-shadow:0 24px 70px #0f172a55;color:#243247}.editmodal header,.editmodal footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.editmodal header b{font-size:15px}.editmodal header button{border:0;background:#e5ebf5;border-radius:7px;padding:6px 9px}.editmodal label{display:block;margin:10px 0;font-size:12px;font-weight:600;color:#526178}.editmodal input,.editmodal textarea{display:block;width:100%;margin-top:5px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#243247;font:13px Segoe UI,Arial;resize:vertical}.editmodal footer{justify-content:flex-end;margin:14px 0 0}.panel[data-theme=dark]{background:#202833;color:#d7e0ec;border-color:#3b4655}.panel[data-theme=dark] .tabs{background:#252f3c}.panel[data-theme=dark] .tab{color:#aebbd0}.panel[data-theme=dark] .tab.active{background:#303b49;color:#91b4ff;box-shadow:inset 0 -2px #668fff}.panel[data-theme=dark] .search,.panel[data-theme=dark] .list,.panel[data-theme=dark] .setting,.panel[data-theme=dark] .macro,.panel[data-theme=dark] .histrow,.panel[data-theme=dark] .check{background:#252f3b;border-color:#3b4655;color:#d7e0ec}.panel[data-theme=dark] .main b,.panel[data-theme=dark] .histrow b,.panel[data-theme=dark] .setting b,.panel[data-theme=dark] .managerinfo b{color:#e3ebf7}.panel[data-theme=dark] .main small,.panel[data-theme=dark] .histrow small,.panel[data-theme=dark] .setting small,.panel[data-theme=dark] .managerinfo small{color:#9baac0}.panel[data-theme=dark] .macro:hover{background:#303d4d}.panel[data-theme=dark] .action{background:#303b49;border-color:#4a586b;color:#dce6f5}.panel[data-theme=dark] .action.primary{background:#315cc0;color:white}.panel[data-theme=dark] .editmodal{background:#252f3b;color:#e3ebf7}.panel[data-theme=dark] .editmodal input,.panel[data-theme=dark] .editmodal textarea{background:#1b232d;color:#e3ebf7;border-color:#4a586b}.panel[data-theme=dark] .foot{border-color:#3b4655;color:#9baac0}@media(max-width:520px){.panel{left:10px;right:10px;width:auto;bottom:82px;height:calc(100vh - 100px)}.launch{right:16px;bottom:16px}}';
 panel=document.createElement('section');panel.className='panel';
 panel.innerHTML='<header class="head"><div><div class="brand">⚡ ZEUS Central</div><div class="sub">Produtividade no atendimento</div></div><button class="close" id="close">✕</button></header><nav class="tabs"><button class="tab active" data-tab="macros">Macros</button><button class="tab" data-tab="history">Histórico</button><button class="tab" data-tab="settings">Configurações</button></nav><main class="view" id="view"></main><footer class="foot">Alt+Z abrir/fechar · Ctrl+Shift+M buscar · Esc fechar</footer>';
 toast=document.createElement('div');toast.className='toast';
 const launch=document.createElement('button');launch.className='launch';launch.textContent='⚡';launch.title='Abrir Zeus (Alt+Z)';launch.addEventListener('click',()=>toggle());
 panel.querySelector('#close').addEventListener('click',()=>toggle(false));
 panel.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.tab;render()}));
 root.append(style,launch,panel,toast);document.body.append(host);panel.dataset.theme=theme;applyPageTheme();
}
function handleShortcut(e){
 const key=String(e.key||'').toLowerCase();
 const isZ=key==='z'||e.code==='KeyZ'||e.keyCode===90;
 const isM=key==='m'||e.code==='KeyM'||e.keyCode===77;
 if(e.altKey&&isZ){
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();toggle();
 }else if(e.ctrlKey&&e.shiftKey&&isM){
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation?.();tab='macros';toggle(true);setTimeout(()=>search?.focus(),40);
 }else if(key==='escape'&&opened){
  e.preventDefault();toggle(false);
 }
}
function keys(e){handleShortcut(e)}
function bindFrameKeys(){
 applyPageTheme();
 for(const f of document.querySelectorAll('iframe')){
  try{
   const d=f.contentWindow?.document||f.contentDocument;
   if(d&&!d.__zeusKeysBound){
    d.addEventListener('keydown',handleShortcut,true);
    d.__zeusKeysBound=true;
   }
  }catch(_){}
 } 
}
async function start(){
 await defaults();if(!document.body)return;initUI();
 document.addEventListener('keydown',handleShortcut,true);window.addEventListener('keydown',handleShortcut,true);
 bindFrameKeys();
 new MutationObserver(bindFrameKeys).observe(document.documentElement,{childList:true,subtree:true});
 applyPageTheme();console.info('[Zeus] Central Interact v1.2 carregada');
}
start();
})();