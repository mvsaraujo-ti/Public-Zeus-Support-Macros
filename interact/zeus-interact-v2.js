(() => {
'use strict';
if (window.__ZEUS_CENTRAL_V2__) return;
window.__ZEUS_CENTRAL_V2__ = true;
const KEY='zeus_interact_wiki_v1';
const $=(r,s)=>r?.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=()=>{try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[]}catch(_){return []}};
let articles=read(),category='Todas',query='';
const ctx=()=>{const host=document.getElementById('zeus-interact-host'),sr=host?.shadowRoot;return {host,sr,panel:$('.panel',sr),view:$('#view',sr)}};
function note(msg,type='info'){const {sr}=ctx(),t=$('.toast',sr);if(!t)return;t.textContent=msg;t.dataset.type=type;t.classList.add('show');clearTimeout(note.t);note.t=setTimeout(()=>t.classList.remove('show'),2400)}
function cats(){return ['Todas',...new Set(articles.map(a=>a.category||'Geral'))]}
function filtered(){const q=query.toLocaleLowerCase('pt-BR');return articles.filter(a=>(category==='Todas'||(a.category||'Geral')===category)&&[a.title,a.category,a.tags,a.summary,a.content].join(' ').toLocaleLowerCase('pt-BR').includes(q)).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'))}
function render(){
 const {sr,view}=ctx();if(!sr||!view)return;
 const tab=[...sr.querySelectorAll('.tab')].find(x=>x.dataset.tab==='history');
 if(tab)tab.textContent='Mini Wiki';
 view.innerHTML='';
 const top=document.createElement('div');top.className='wiki-top';
 top.innerHTML='<div class="wiki-heading"><div><b>📚 Mini Wiki</b><small>Orientações e soluções para a equipe</small></div><button class="action primary" id="wnew">+ Novo artigo</button></div><input class="search" id="wsearch" placeholder="Buscar sistema, erro ou orientação..." value="'+esc(query)+'"><div class="wiki-cats"></div>';
 view.append(top);
 const chips=$('.wiki-cats',top);
 cats().forEach(c=>{const b=document.createElement('button');b.className='wiki-chip'+(c===category?' active':'');b.textContent=c;b.onclick=()=>{category=c;render()};chips.append(b)});
 $('#wnew',top).onclick=()=>edit();
 $('#wsearch',top).oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;const old=$('.wiki-list',view);if(old)old.replaceWith(list());const input=$('#wsearch',view);if(input){input.focus();input.setSelectionRange(pos,pos)}};
 view.append(list());
}
function list(){
 const box=document.createElement('div');box.className='list wiki-list';const rows=filtered();
 if(!rows.length){box.innerHTML='<div class="wiki-empty"><div>📖</div><b>Nenhum artigo cadastrado</b><p>Crie orientações sobre sistemas, erros frequentes, acessos e procedimentos.</p><button class="action primary" id="wfirst">Criar primeiro artigo</button></div>';$('#wfirst',box).onclick=()=>edit();return box}
 rows.forEach(a=>{const card=document.createElement('article');card.className='wiki-card';const tags=Array.isArray(a.tags)?a.tags:[];card.innerHTML='<span class="wiki-category">'+esc(a.category||'Geral')+'</span><h3>'+esc(a.title)+'</h3><p>'+esc((a.summary||a.content).slice(0,145))+'</p><small>'+esc(tags.slice(0,3).join(' · '))+'　·　Abrir →</small>';card.onclick=()=>detail(a.id);box.append(card)});
 return box;
}
function detail(id){
 const {view}=ctx(),a=articles.find(x=>x.id===id);if(!a||!view)return;
 view.innerHTML='<div class="wiki-detail"><button class="wiki-back" id="wback">← Todos os artigos</button><div class="wiki-actions"><button class="action" id="wedit">Editar</button><button class="action danger" id="wdel">Excluir</button></div><span class="wiki-category">'+esc(a.category||'Geral')+'</span><h2>'+esc(a.title)+'</h2>'+(a.summary?'<p class="wiki-summary">'+esc(a.summary)+'</p>':'')+'<div class="wiki-content">'+esc(a.content).replace(/\n/g,'<br>')+'</div><div class="wiki-tags">'+(a.tags||[]).map(t=>'<span>'+esc(t)+'</span>').join('')+'</div><small class="wiki-date">Atualizado em '+new Date(a.updatedAt||a.createdAt).toLocaleDateString('pt-BR')+'</small></div>';
 $('#wback',view).onclick=render;$('#wedit',view).onclick=()=>edit(a);
 $('#wdel',view).onclick=()=>{if(!confirm('Excluir este artigo?'))return;articles=articles.filter(x=>x.id!==id);save();note('Artigo excluído.','success');render()};
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(articles))}catch(_){}}
function edit(a=null){
 const {sr}=ctx();if(!sr)return;
 const back=document.createElement('div');back.className='wiki-modal-back';
 const modal=document.createElement('section');modal.className='wiki-modal';
 modal.innerHTML='<header><div><b>'+(a?'Editar artigo':'Novo artigo')+'</b><small>Conteúdo salvo neste navegador nesta versão</small></div><button id="wx">✕</button></header><label>Título<input id="wt" maxlength="100" placeholder="Ex.: ABN NUP — erro ao protocolar"></label><div class="wiki-grid"><label>Categoria<input id="wc" placeholder="Ex.: ABN NUP"></label><label>Palavras-chave<input id="wg" placeholder="acesso, erro, cadastro"></label></div><label>Resumo<textarea id="ws" rows="2" placeholder="Resumo curto (opcional)"></textarea></label><label>Orientação completa<textarea id="wb" rows="9" placeholder="Para quem é, como acessar, passos, erros conhecidos e soluções..."></textarea></label><footer><button class="action" id="wcancel">Cancelar</button><button class="action primary" id="wsave">Salvar artigo</button></footer>';
 sr.append(back,modal);const close=()=>{back.remove();modal.remove()};back.onclick=close;$('#wx',modal).onclick=close;$('#wcancel',modal).onclick=close;
 if(a){$('#wt',modal).value=a.title;$('#wc',modal).value=a.category||'';$('#wg',modal).value=(a.tags||[]).join(', ');$('#ws',modal).value=a.summary||'';$('#wb',modal).value=a.content}
 $('#wsave',modal).onclick=()=>{const title=$('#wt',modal).value.trim(),content=$('#wb',modal).value.trim();if(!title||!content){note('Preencha título e orientação completa.','warn');return}const now=new Date().toISOString(),data={title,content,category:$('#wc',modal).value.trim()||'Geral',tags:$('#wg',modal).value.split(',').map(x=>x.trim()).filter(Boolean),summary:$('#ws',modal).value.trim(),updatedAt:now};if(a)Object.assign(a,data);else articles.push({id:'wiki-'+Date.now(),...data,createdAt:now});save();close();category='Todas';query='';render();note('Artigo salvo neste navegador.','success')};
 $('#wt',modal).focus();
}
function addStyles(sr){
 if($('#zeus-v2-style',sr))return;
 const s=document.createElement('style');s.id='zeus-v2-style';
 s.textContent=[
 '.wiki-top{display:flex;flex-direction:column;gap:9px;flex:0 0 auto}.wiki-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.wiki-heading b{font-size:14px;color:#253650}.wiki-heading small{display:block;color:#718096;font-size:11px;margin-top:3px}.wiki-heading .action{margin:0;white-space:nowrap}.wiki-cats{display:flex;gap:6px;overflow:auto;padding:1px 0 4px}.wiki-chip{flex:0 0 auto;border:1px solid #d6dfeb;background:#fff;color:#53647b;border-radius:20px;padding:5px 10px;font-size:11px;cursor:pointer}.wiki-chip.active{background:#e8efff;border-color:#8eabef;color:#315cc0;font-weight:700}.wiki-list{margin-top:9px}.wiki-card{padding:12px;border-bottom:1px solid #edf1f6;cursor:pointer;background:#fff}.wiki-card:hover{background:#f2f6ff}.wiki-card h3{margin:6px 0;color:#253650;font-size:13px}.wiki-card p{margin:6px 0;color:#64748b;font-size:11px;line-height:1.45}.wiki-card small{color:#8794a8;font-size:10px}.wiki-category{display:inline-block;color:#315cc0;background:#eaf0ff;border-radius:5px;padding:3px 7px;font-size:10px;font-weight:700}.wiki-empty{text-align:center;padding:28px 18px;color:#718096}.wiki-empty div{font-size:30px}.wiki-empty b{color:#334155}.wiki-empty p{font-size:11px;line-height:1.5}.wiki-detail{overflow:auto;min-height:0}.wiki-back{border:0;background:transparent;color:#315cc0;font-weight:600;padding:4px 0 12px;cursor:pointer}.wiki-actions{float:right;display:flex;gap:5px}.wiki-detail h2{font-size:18px;line-height:1.3;color:#253650;margin:9px 0}.wiki-summary{color:#64748b;font-size:12px}.wiki-content{white-space:pre-wrap;overflow-wrap:anywhere;color:#34445c;font-size:13px;line-height:1.65;padding:12px 0}.wiki-tags{display:flex;gap:5px;flex-wrap:wrap}.wiki-tags span{background:#edf2f8;color:#64748b;border-radius:5px;padding:4px 7px;font-size:10px}.wiki-date{display:block;color:#94a3b8;margin-top:12px}.wiki-modal-back{position:fixed;inset:0;background:#0b173b77;backdrop-filter:blur(4px);z-index:20}.wiki-modal{position:fixed;z-index:21;left:50%;top:50%;transform:translate(-50%,-50%);width:min(510px,calc(100vw - 28px));max-height:88%;overflow:auto;padding:16px;border:1px solid #d9e1ec;border-radius:14px;background:#f7f9fc;color:#243247;box-shadow:0 24px 70px #0f172a66}.wiki-modal header,.wiki-modal footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.wiki-modal header b{display:block;font-size:15px}.wiki-modal header small{display:block;color:#718096;font-size:11px;margin-top:3px}.wiki-modal header button{border:0;background:#e5ebf5;border-radius:7px;padding:6px 9px}.wiki-modal label{display:block;margin:10px 0;color:#526178;font-size:11px;font-weight:700}.wiki-modal input,.wiki-modal textarea{display:block;width:100%;margin-top:5px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#243247;font:13px Segoe UI,Arial;resize:vertical}.wiki-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.wiki-modal footer{justify-content:flex-end;margin:14px 0 0}',
 '.panel[data-theme=dark] .wiki-heading b,.panel[data-theme=dark] .wiki-card h3,.panel[data-theme=dark] .wiki-detail h2,.panel[data-theme=dark] .wiki-empty b{color:#edf3fc}.panel[data-theme=dark] .wiki-heading small,.panel[data-theme=dark] .wiki-card p,.panel[data-theme=dark] .wiki-card small,.panel[data-theme=dark] .wiki-summary,.panel[data-theme=dark] .wiki-content,.panel[data-theme=dark] .wiki-date{color:#bdc9da}.panel[data-theme=dark] .wiki-chip,.panel[data-theme=dark] .wiki-card{background:#252f3b;border-color:#3b4655;color:#d7e0ec}.panel[data-theme=dark] .wiki-card:hover{background:#303d4d}.panel[data-theme=dark] .wiki-chip.active{background:#263e68;border-color:#5579c8;color:#d2e0ff}.panel[data-theme=dark] .wiki-category{background:#263e68;color:#d2e0ff}.panel[data-theme=dark] .wiki-tags span{background:#354254;color:#d0d9e7}.panel[data-theme=dark] .wiki-modal{background:#252f3b;color:#e3ebf7;border-color:#3b4655}.panel[data-theme=dark] .wiki-modal header small,.panel[data-theme=dark] .wiki-modal label{color:#c0ccdc}.panel[data-theme=dark] .wiki-modal input,.panel[data-theme=dark] .wiki-modal textarea{background:#1b232d;color:#f1f5f9;border-color:#4a586b}.panel[data-theme=dark] .wiki-modal header button{background:#354254;color:#f1f5f9}',
 '@media(max-width:520px){.wiki-grid{grid-template-columns:1fr}}'
 ].join('\n');
 sr.append(s);
}
function contrast(root=document){
 const selector='#pnlTelaPrincipal div[style*="border-radius"],#pnlTelaPrincipal div[style*="box-shadow"]';
 root.querySelectorAll?.(selector).forEach(b=>{
  if(!b.textContent?.trim()||b.closest('#zeus-interact-host'))return;
  let bg=getComputedStyle(b).backgroundColor;
  if(!bg||bg==='rgba(0, 0, 0, 0)')bg=getComputedStyle(b.parentElement||b).backgroundColor;
  const m=bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  const lum=m?(0.2126*+m[1]+0.7152*+m[2]+0.0722*+m[3]):220;
  const color=lum>150?'#17324f':'#f8fafc';
  [b,...b.querySelectorAll('*')].forEach(el=>{if(el.style.getPropertyValue('color')!==color||el.style.getPropertyPriority('color')!=='important')el.style.setProperty('color',color,'important')});
 });
}
function insertTextSafe(raw){
 let value=String(raw??'');
 if(/<\/?(?:p|div|br|span|b|strong|i|em|u|ul|ol|li|a|font|table|tr|td)\b[^>]*>/i.test(value)){
  const d=new DOMParser().parseFromString(value,'text/html');
  d.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));
  d.querySelectorAll('p,div,li,tr').forEach(n=>n.append('\n'));
  value=(d.body.textContent||'').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 }
 for(const f of document.querySelectorAll('iframe')){
  try{
   const d=f.contentDocument,b=d?.body,sig=((f.id||'')+' '+(f.className||'')).toLowerCase();
   if(!d||!b||!(sig.includes('richtext')||d.designMode?.toLowerCase()==='on'||b.isContentEditable))continue;
   f.contentWindow.focus();b.focus();const sel=d.getSelection();let r;
   if(sel?.rangeCount&&b.contains(sel.getRangeAt(0).commonAncestorContainer))r=sel.getRangeAt(0).cloneRange();else{r=d.createRange();r.selectNodeContents(b);r.collapse(false)}
   r.deleteContents();const frag=d.createDocumentFragment();value.split(/\r?\n/).forEach((line,i)=>{if(i)frag.appendChild(d.createElement('br'));if(line)frag.appendChild(d.createTextNode(line))});r.insertNode(frag);
   const caret=d.createRange();caret.selectNodeContents(b);caret.collapse(false);sel?.removeAllRanges();sel?.addRange(caret);
   [b,d,f.contentWindow].forEach(t=>{try{t.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}))}catch(_){try{t.dispatchEvent(new Event('input',{bubbles:true}))}catch(__){}}try{t.dispatchEvent(new Event('change',{bubbles:true}))}catch(_){}});
   note('Macro inserida como texto simples. Revise antes de enviar.','success');return true;
  }catch(_){}
 }
 note('Clique dentro da caixa de mensagem e tente novamente.','warn');return false;
}
function bind(){
 const {sr,panel,view}=ctx();if(!sr||!panel||!view)return;
 addStyles(sr);
 const tab=[...sr.querySelectorAll('.tab')].find(x=>x.dataset.tab==='history');
 if(tab){
  tab.textContent='Mini Wiki';
  if(!tab.dataset.wikiBound){tab.dataset.wikiBound='1';tab.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();sr.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===tab));render()},true)}
 }
 if(tab?.classList.contains('active')&&!view.querySelector('.wiki-top,.wiki-detail'))render();
 const list=$('#view .list',sr);
 if(list&&!list.dataset.safeInsert){list.dataset.safeInsert='1';list.addEventListener('click',e=>{const main=e.target.closest('.macro .main');if(!main)return;const title=$('b',main)?.textContent?.trim();let macros=[];try{macros=JSON.parse(localStorage.getItem('zeus_macros')||'[]')}catch(_){}const m=macros.find(x=>x.title===title);if(!m)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();insertTextSafe(m.text)},true)}
 contrast(document);document.querySelectorAll('iframe').forEach(f=>{try{if(f.contentDocument)contrast(f.contentDocument)}catch(_){}});
}
function start(){
 const observer=new MutationObserver(()=>{const {sr}=ctx();if(sr)bind()});
 observer.observe(document.documentElement,{childList:true,subtree:true});
 [200,700,1500,3000].forEach(ms=>setTimeout(bind,ms));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();