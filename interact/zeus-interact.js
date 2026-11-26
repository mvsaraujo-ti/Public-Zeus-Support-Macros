/**
 * Zeus Central — Interact TJMA
 *
 * Script único da extensão. Reúne:
 *  - painel flutuante (Macros, Mini Wiki, Configurações);
 *  - tema claro/escuro do Interact com garantia de contraste;
 *  - inserção de macros no editor do Interact SEM enviar a mensagem;
 *  - Mini Wiki com armazenamento local (sem API e sem sincronização).
 *
 * Não altera a lógica de atendimento, de envio de mensagens nem de encerramento de chamadas.
 */
(() => {
'use strict';
if (window.__ZEUS_CENTRAL__) return;
window.__ZEUS_CENTRAL__ = true;

/* ================================================================
   ARMAZENAMENTO E UTILITÁRIOS
================================================================ */
const K = { macros: 'zeus_macros', wiki: 'zeus_interact_wiki_v1', theme: 'zeus_interact_theme_v1', fora: 'zeus_interact_fecharfora_v1' };
const api = globalThis.chrome?.runtime || globalThis.browser?.runtime;

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vars = s => String(s)
  .replace(/{{data}}/g, new Date().toLocaleDateString('pt-BR'))
  .replace(/{{hora}}/g, new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));

let macros = read(K.macros, null);
let articles = read(K.wiki, []);
if (!Array.isArray(articles)) articles = [];
let theme = read(K.theme, 'light') === 'dark' ? 'dark' : 'light';

let tab = 'macros', opened = false;
let host, root, panel, toast, search, list, pageThemeStyle = null;
let wikiCat = 'Todas', wikiQuery = '';

async function defaults() {
  if (Array.isArray(macros)) return;
  try {
    const r = await fetch(api.getURL('assets/default-macros.json'));
    macros = r.ok ? await r.json() : [];
  } catch (_) { macros = []; }
  write(K.macros, macros);
}

function notice(msg, type) {
  if (!toast) return;
  toast.textContent = msg;
  toast.dataset.type = type || 'info';
  toast.classList.add('show');
  clearTimeout(notice.t);
  notice.t = setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ================================================================
   FRAMES, TELA DE ATENDIMENTO E EDITOR DO INTERACT
================================================================ */
function* frames(win = window) {
  yield win;
  for (let i = 0; i < win.frames.length; i++) {
    let f;
    try { f = win.frames[i]; void f.document; } catch (_) { continue; } // frame de outra origem
    yield* frames(f);
  }
}
const ehTopo = w => w.parent === w;

function janelaVisivel(win) {
  for (let w = win; !ehTopo(w); w = w.parent) {
    const f = w.frameElement;
    if (!f) return false;
    const r = f.getBoundingClientRect();
    const cs = w.parent.getComputedStyle(f);
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

function temCampoDeSenhaVisivel() {
  for (const w of frames()) {
    try {
      for (const i of w.document.querySelectorAll('input[type=password]')) {
        const r = i.getBoundingClientRect(), cs = w.getComputedStyle(i);
        if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') return true;
      }
    } catch (_) {}
  }
  return false;
}

// O painel só aparece na tela de atendimento (existe o painel principal e não há campo de senha visível).
function emAtendimento() {
  const p = document.getElementById('pnlTelaPrincipal');
  if (!p) return false;
  const r = p.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  return !temCampoDeSenhaVisivel();
}

const trechos = new WeakMap(); // última posição do cursor em cada editor
function acompanharSelecao(ed) {
  try {
    if (ed.d.__zeusSelecao) return;
    ed.d.__zeusSelecao = true;
    ed.d.addEventListener('selectionchange', () => {
      try {
        const s = ed.d.getSelection();
        if (s?.rangeCount && ed.b.contains(s.getRangeAt(0).commonAncestorContainer)) trechos.set(ed.d, s.getRangeAt(0).cloneRange());
      } catch (_) {}
    });
  } catch (_) {}
}

// Editor de mensagens: documento em modo de edição (RichTextArea do GWT), visível e maior.
// Não usa campos comuns da página (ex.: "Dados Associados") para nunca inserir no lugar errado.
function acharEditor() {
  let melhor = null;
  for (const w of frames()) {
    if (ehTopo(w)) continue;
    try {
      const d = w.document, b = d.body;
      if (!b || !(d.designMode === 'on' || b.isContentEditable)) continue;
      if (!janelaVisivel(w)) continue;
      const r = w.frameElement.getBoundingClientRect();
      if (r.width < 80 || r.height < 25) continue;
      const area = r.width * r.height;
      if (!melhor || area > melhor.area) melhor = { w, d, b, area };
    } catch (_) {}
  }
  if (melhor) acompanharSelecao(melhor);
  return melhor;
}

// O Interact higieniza o HTML do editor. Para não disparar o aviso de "tags inválidas",
// a macro entra apenas como texto puro + <br>, nunca como <div>, <p>, <span> ou atributos.
function paraTextoSimples(bruto) {
  let v = String(bruto ?? '').replace(/\r\n?/g, '\n');
  if (/<\/?(?:p|div|br|span|b|strong|i|em|u|ul|ol|li|a|font|table|tr|td)\b[^>]*>/i.test(v)) {
    // Só as tags de formatação conhecidas viram quebra/texto; qualquer outro "<...>" (ex.: <F5>) é preservado.
    v = v.replace(/<(?!\/?(?:p|div|br|span|b|strong|i|em|u|ul|ol|li|a|font|table|tr|td)\b)/gi, '&lt;');
    const doc = new DOMParser().parseFromString(v, 'text/html');
    doc.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
    doc.querySelectorAll('p,div,li,tr').forEach(n => n.append('\n'));
    v = doc.body.textContent || '';
  }
  return v.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function emitirEventos(alvos, texto) {
  for (const t of alvos) {
    try { t.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: texto })); }
    catch (_) { try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (__) {} }
    try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  }
  try { alvos[0].dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ', code: 'Space' })); } catch (_) {}
}

function inserir(texto, msgOk) {
  const ed = acharEditor();
  if (!ed) { notice('Abra um atendimento e tente novamente: não encontrei a caixa de mensagem.', 'warn'); return false; }
  const plano = paraTextoSimples(texto);
  if (!plano) { notice('Esta macro está vazia.', 'warn'); return false; }
  const { w, d, b } = ed;
  try {
    w.focus(); b.focus();
    const sel = d.getSelection();
    const dentro = r => r && b.contains(r.commonAncestorContainer);
    let r = trechos.get(d);
    if (!dentro(r)) r = sel?.rangeCount && dentro(sel.getRangeAt(0)) ? sel.getRangeAt(0).cloneRange() : null;
    if (!r) { r = d.createRange(); r.selectNodeContents(b); r.collapse(false); }
    r.deleteContents();

    const frag = d.createDocumentFragment();
    let ultimo = null;
    plano.split('\n').forEach((linha, i) => {
      if (i) { ultimo = d.createElement('br'); frag.appendChild(ultimo); }
      if (linha) { ultimo = d.createTextNode(linha); frag.appendChild(ultimo); }
    });
    r.insertNode(frag);
    if (ultimo && ultimo.nodeName === 'BR' && !ultimo.nextSibling) ultimo.after(d.createElement('br'));
    if (ultimo) {
      const c = d.createRange();
      c.setStartAfter(ultimo); c.collapse(true);
      sel.removeAllRanges(); sel.addRange(c);
      trechos.set(d, c.cloneRange());
    }
    emitirEventos([b, d, w], plano); // o GWT sincroniza o editor por esses eventos; nada é enviado
    notice(msgOk || 'Macro inserida no editor. Revise antes de enviar.', 'success');
    return true;
  } catch (err) {
    console.warn('[Zeus] Erro ao inserir macro:', err);
    notice('Não foi possível inserir a macro. Nada foi enviado.', 'error');
    return false;
  }
}

/* ================================================================
   MACROS
================================================================ */
function renderMacros() {
  const view = panel.querySelector('#view');
  view.innerHTML = '<input class="search" id="search" placeholder="Buscar macro..." autocomplete="off"><div class="list" id="list"></div>';
  search = view.querySelector('#search');
  list = view.querySelector('#list');
  search.addEventListener('input', drawMacros);
  drawMacros();
}

function drawMacros() {
  const q = (search.value || '').toLocaleLowerCase('pt-BR');
  const rows = [...(macros || [])]
    .filter(m => [m.title, m.cat, m.text].join(' ').toLocaleLowerCase('pt-BR').includes(q))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(a.cat).localeCompare(String(b.cat), 'pt-BR'));
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<div class="empty">Nenhuma macro encontrada.</div>'; return; }
  rows.forEach(m => {
    const row = document.createElement('div');
    row.className = 'macro';
    const main = document.createElement('div');
    main.className = 'main';
    main.innerHTML = '<b>' + esc(m.title) + '</b><small>' + esc(m.cat || 'Sem categoria') + '</small>';
    main.addEventListener('click', () => inserir(vars(m.text)));
    const fav = document.createElement('button');
    fav.className = 'fav';
    fav.textContent = m.pinned ? '★' : '☆';
    fav.title = 'Alternar favorito';
    fav.addEventListener('click', () => { m.pinned = !m.pinned; write(K.macros, macros); drawMacros(); });
    row.append(main, fav);
    list.append(row);
  });
}

/* ================================================================
   MINI WIKI (somente armazenamento local)
================================================================ */
const wikiCategorias = () => ['Todas', ...new Set(articles.map(a => a.category || 'Geral'))];
function wikiFiltrados() {
  const q = wikiQuery.toLocaleLowerCase('pt-BR');
  return articles
    .filter(a => (wikiCat === 'Todas' || (a.category || 'Geral') === wikiCat) &&
      [a.title, a.category, (a.tags || []).join(' '), a.summary, a.content].join(' ').toLocaleLowerCase('pt-BR').includes(q))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}
const wikiSalvar = () => write(K.wiki, articles);

function renderWiki() {
  const view = panel.querySelector('#view');
  if (!wikiCategorias().includes(wikiCat)) wikiCat = 'Todas';
  view.innerHTML = '';
  const top = document.createElement('div');
  top.className = 'wiki-top';
  top.innerHTML = '<div class="wiki-heading"><div><b>📚 Mini Wiki</b><small>Orientações e soluções para a equipe</small></div><button class="action primary" id="wnew">+ Novo artigo</button></div>' +
    '<input class="search" id="wsearch" placeholder="Buscar sistema, erro ou orientação..." autocomplete="off" value="' + esc(wikiQuery) + '"><div class="wiki-cats"></div>';
  view.append(top);
  const chips = top.querySelector('.wiki-cats');
  wikiCategorias().forEach(c => {
    const b = document.createElement('button');
    b.className = 'wiki-chip' + (c === wikiCat ? ' active' : '');
    b.textContent = c;
    b.addEventListener('click', () => { wikiCat = c; renderWiki(); });
    chips.append(b);
  });
  top.querySelector('#wnew').addEventListener('click', () => editarArtigo());
  top.querySelector('#wsearch').addEventListener('input', e => {
    wikiQuery = e.target.value;
    view.querySelector('.wiki-list')?.replaceWith(wikiLista());
  });
  view.append(wikiLista());
}

function wikiLista() {
  const box = document.createElement('div');
  box.className = 'list wiki-list';
  const rows = wikiFiltrados();
  if (!rows.length) {
    box.innerHTML = articles.length
      ? '<div class="wiki-empty"><div>🔎</div><b>Nada encontrado</b><p>Tente outra palavra ou outra categoria.</p></div>'
      : '<div class="wiki-empty"><div>📖</div><b>Nenhum artigo cadastrado</b><p>Crie orientações sobre sistemas, erros frequentes, acessos e procedimentos.</p><button class="action primary" id="wfirst">Criar primeiro artigo</button></div>';
    box.querySelector('#wfirst')?.addEventListener('click', () => editarArtigo());
    return box;
  }
  rows.forEach(a => {
    const card = document.createElement('article');
    card.className = 'wiki-card';
    const tags = Array.isArray(a.tags) ? a.tags : [];
    card.innerHTML = '<span class="wiki-category">' + esc(a.category || 'Geral') + '</span><h3>' + esc(a.title) + '</h3><p>' +
      esc((a.summary || a.content || '').slice(0, 145)) + '</p><small>' + esc(tags.slice(0, 3).join(' · ')) + (tags.length ? ' · ' : '') + 'Abrir →</small>';
    card.addEventListener('click', () => wikiDetalhe(a.id));
    box.append(card);
  });
  return box;
}

function wikiDetalhe(id) {
  const view = panel.querySelector('#view');
  const a = articles.find(x => x.id === id);
  if (!a) return renderWiki();
  const data = new Date(a.updatedAt || a.createdAt || Date.now()).toLocaleDateString('pt-BR');
  view.innerHTML = '<div class="wiki-detail"><button class="wiki-back" id="wback">← Todos os artigos</button>' +
    '<div class="wiki-actions"><button class="action" id="wedit">Editar</button><button class="action danger" id="wdel">Excluir</button></div>' +
    '<span class="wiki-category">' + esc(a.category || 'Geral') + '</span><h2>' + esc(a.title) + '</h2>' +
    (a.summary ? '<p class="wiki-summary">' + esc(a.summary) + '</p>' : '') +
    '<div class="wiki-content">' + esc(a.content) + '</div>' +
    '<div class="wiki-tags">' + (a.tags || []).map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' +
    '<small class="wiki-date">Atualizado em ' + esc(data) + '</small></div>';
  view.querySelector('#wback').addEventListener('click', renderWiki);
  view.querySelector('#wedit').addEventListener('click', () => editarArtigo(a));
  view.querySelector('#wdel').addEventListener('click', () => {
    if (!confirm('Excluir este artigo?')) return;
    articles = articles.filter(x => x.id !== id);
    wikiSalvar();
    notice('Artigo excluído.', 'success');
    renderWiki();
  });
}

function editarArtigo(a = null) {
  const back = document.createElement('div');
  back.className = 'wiki-modal-back';
  const modal = document.createElement('section');
  modal.className = 'wiki-modal';
  modal.innerHTML = '<header><div><b>' + (a ? 'Editar artigo' : 'Novo artigo') + '</b><small>Conteúdo salvo apenas neste navegador</small></div><button id="wx">✕</button></header>' +
    '<label>Título<input id="wt" maxlength="100" placeholder="Ex.: ABN NUP — erro ao protocolar"></label>' +
    '<div class="wiki-grid"><label>Categoria<input id="wc" maxlength="60" placeholder="Ex.: ABN NUP"></label><label>Palavras-chave<input id="wg" placeholder="acesso, erro, cadastro"></label></div>' +
    '<label>Resumo<textarea id="ws" rows="2" placeholder="Resumo curto (opcional)"></textarea></label>' +
    '<label>Orientação completa<textarea id="wb" rows="9" placeholder="Para quem é, como acessar, passos, erros conhecidos e soluções..."></textarea></label>' +
    '<footer><button class="action" id="wcancel">Cancelar</button><button class="action primary" id="wsave">Salvar artigo</button></footer>';
  root.append(back, modal);
  const close = () => { back.remove(); modal.remove(); };
  back.addEventListener('click', close);
  modal.querySelector('#wx').addEventListener('click', close);
  modal.querySelector('#wcancel').addEventListener('click', close);
  if (a) {
    modal.querySelector('#wt').value = a.title;
    modal.querySelector('#wc').value = a.category || '';
    modal.querySelector('#wg').value = (a.tags || []).join(', ');
    modal.querySelector('#ws').value = a.summary || '';
    modal.querySelector('#wb').value = a.content;
  }
  modal.querySelector('#wsave').addEventListener('click', () => {
    const title = modal.querySelector('#wt').value.trim();
    const content = modal.querySelector('#wb').value.trim();
    if (!title || !content) { notice('Preencha o título e a orientação completa.', 'warn'); return; }
    const agora = new Date().toISOString();
    const dados = {
      title, content,
      category: modal.querySelector('#wc').value.trim() || 'Geral',
      tags: modal.querySelector('#wg').value.split(',').map(x => x.trim()).filter(Boolean),
      summary: modal.querySelector('#ws').value.trim(),
      updatedAt: agora
    };
    if (a) Object.assign(a, dados);
    else articles.push({ id: 'wiki-' + Date.now(), ...dados, createdAt: agora });
    wikiSalvar();
    close();
    wikiCat = 'Todas'; wikiQuery = '';
    renderWiki();
    notice('Artigo salvo neste navegador.', 'success');
  });
  modal.querySelector('#wt').focus();
}

/* ================================================================
   CONFIGURAÇÕES, IMPORTAÇÃO E EXPORTAÇÃO
================================================================ */
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeMacros(data) {
  if (!Array.isArray(data)) throw new Error('O JSON precisa conter uma lista de macros.');
  return data.map((m, i) => {
    if (!m || typeof m !== 'object' || typeof m.title !== 'string' || typeof m.text !== 'string') throw new Error('Macro ' + (i + 1) + ' inválida: informe title e text.');
    return { id: m.id ?? Date.now() + i, title: m.title.trim(), cat: String(m.cat || 'Geral').trim(), text: m.text, pinned: !!m.pinned };
  }).filter(m => m.title && m.text);
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const incoming = normalizeMacros(JSON.parse(await file.text()));
      const replace = confirm('OK: substituir suas macros atuais.\nCancelar: adicionar as macros importadas às atuais.');
      macros = replace ? incoming : [...macros, ...incoming.map(m => ({ ...m, id: Date.now() + Math.random() }))];
      write(K.macros, macros);
      notice(incoming.length + ' macros importadas.', 'success');
      render();
    } catch (e) { notice('Não foi possível importar: ' + e.message, 'error'); }
  };
  input.click();
}

function exportJSON() {
  downloadJSON(macros || [], 'zeus-macros-' + new Date().toISOString().slice(0, 10) + '.json');
  notice('Backup JSON exportado.', 'success');
}

function renderSettings() {
  const view = panel.querySelector('#view');
  view.innerHTML =
    '<section class="setting"><div><b>Aparência do Interact</b><small>O tema é aplicado à página e às áreas internas acessíveis.</small></div><button class="action" id="theme">' + (theme === 'dark' ? '☀️ Usar tema claro' : '🌙 Usar tema escuro') + '</button></section>' +
    '<section class="setting"><div><b>Fechar ao clicar fora</b><small>Fecha o Zeus quando você clica em qualquer lugar do Interact fora dele.</small></div><button class="action" id="fora">' + (fecharFora ? '✅ Ligado' : 'Desligado') + '</button></section>' +
    '<section class="setting"><div><b>Suas macros</b><small>Crie, edite ou remova respostas salvas neste navegador.</small></div><button class="action primary" id="new">+ Nova macro</button></section>' +
    '<div class="list manager" id="manager"></div>' +
    '<section class="setting importtools"><div><b>Backup de macros</b><small>Exporte ou importe um arquivo JSON para compartilhar ou restaurar suas macros.</small></div><div class="toolrow"><button class="action" id="import">Importar JSON</button><button class="action" id="export">Exportar JSON</button></div></section>';
  view.querySelector('#theme').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    write(K.theme, theme);
    applyPageTheme();
    renderSettings();
  });
  view.querySelector('#fora').addEventListener('click', () => { fecharFora = !fecharFora; write(K.fora, fecharFora); renderSettings(); });
  view.querySelector('#new').addEventListener('click', () => openMacroEditor());
  view.querySelector('#import').addEventListener('click', importJSON);
  view.querySelector('#export').addEventListener('click', exportJSON);
  const box = view.querySelector('#manager');
  if (!macros.length) box.innerHTML = '<div class="empty">Nenhuma macro cadastrada.</div>';
  macros.forEach(m => {
    const row = document.createElement('div');
    row.className = 'managerrow';
    const info = document.createElement('div');
    info.className = 'managerinfo';
    info.innerHTML = '<b>' + esc(m.title) + '</b><small>' + esc(m.cat || 'Geral') + '</small>';
    const actions = document.createElement('div');
    actions.className = 'manageractions';
    const edit = document.createElement('button');
    edit.className = 'action'; edit.textContent = 'Editar';
    edit.addEventListener('click', () => openMacroEditor(m));
    const del = document.createElement('button');
    del.className = 'action danger'; del.textContent = 'Excluir';
    del.addEventListener('click', () => {
      if (!confirm('Excluir a macro "' + m.title + '"?')) return;
      macros = macros.filter(x => x.id !== m.id);
      write(K.macros, macros);
      renderSettings();
    });
    actions.append(edit, del);
    row.append(info, actions);
    box.append(row);
  });
}

function openMacroEditor(m = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modalback';
  const modal = document.createElement('section');
  modal.className = 'editmodal';
  modal.innerHTML = '<header><b>' + (m ? 'Editar macro' : 'Nova macro') + '</b><button class="closemodal">✕</button></header>' +
    '<label>Nome<input id="mtitle" maxlength="90" placeholder="Ex.: Saudação inicial"></label>' +
    '<label>Categoria<input id="mcat" maxlength="60" placeholder="Ex.: Saudações"></label>' +
    '<label>Texto da macro<textarea id="mtext" rows="8" placeholder="Digite o texto que será inserido no atendimento"></textarea></label>' +
    '<footer><button class="action cancel">Cancelar</button><button class="action primary save">Salvar macro</button></footer>';
  root.append(overlay, modal);
  const close = () => { overlay.remove(); modal.remove(); };
  overlay.addEventListener('click', close);
  modal.querySelector('.closemodal').addEventListener('click', close);
  modal.querySelector('.cancel').addEventListener('click', close);
  if (m) {
    modal.querySelector('#mtitle').value = m.title;
    modal.querySelector('#mcat').value = m.cat || '';
    modal.querySelector('#mtext').value = m.text;
  }
  modal.querySelector('.save').addEventListener('click', () => {
    const title = modal.querySelector('#mtitle').value.trim();
    const cat = modal.querySelector('#mcat').value.trim() || 'Geral';
    const text = modal.querySelector('#mtext').value;
    if (!title || !text.trim()) { notice('Preencha o nome e o texto da macro.', 'warn'); return; }
    if (m) Object.assign(m, { title, cat, text });
    else macros.push({ id: Date.now(), title, cat, text, pinned: false });
    write(K.macros, macros);
    close();
    render();
    notice('Macro salva com sucesso.', 'success');
  });
}

/* ================================================================
   RESUMO DA CONVERSA
   100% local: lê o texto do chat que está na tela, organiza e extrai dados.
   Nada é enviado para fora do navegador.
================================================================ */
const RE_RODAPE = /^(.{2,90}?)\s+[-–—]\s+(\d{2}:\d{2})$/;
const RE_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const RE_TEL = /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g;
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_MAT = /\bmat(?:r[ií]cula)?\.?\s*[:\-]?\s*(\d{3,9})\b/gi;
const RE_SISTEMA = /^(administrador|sistema|bot|assistente virtual)\b/i;
const RE_CABECALHO = /^(informa[cç][õo]es da chamada|data de entrada|dados associados|tipo\s*:|localiza[cç][ãa]o|matr[ií]cula|grau\s*:|descri[cç][ãa]o\s*:|salvar|cancelar|rolagem autom|enviar|finalizar)/i;
const CHAVES_CHAMADA = ['Data de Entrada', 'Tipo', 'Localização', 'Matrícula', 'Grau', 'Atendimento', 'Descrição', 'Demanda', 'Dados Associados'];

const visivelEl = el => {
  try {
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  } catch (_) { return false; }
};
const aparar = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const unicos = a => [...new Set(a)];

function lado(el, textNode) {
  try {
    if (el.closest('.msgChatAgentMainBox, .msgChatCredentialsSainte')) return 'direita';
    if (el.closest('.msgChatInterlocutorMainBox, .msgChatCredentialsEntrante')) return 'esquerda';
    const d = el.ownerDocument, r = d.createRange();
    r.selectNodeContents(textNode);
    const t = r.getBoundingClientRect();
    if (!t.width) return null;
    let c = el;
    while (c.parentElement && c.getBoundingClientRect().width < Math.max(250, t.width + 60)) c = c.parentElement;
    const cr = c.getBoundingClientRect();
    return (t.left + t.width / 2) > (cr.left + cr.width / 2) ? 'direita' : 'esquerda';
  } catch (_) { return null; }
}

const RE_HORA_SOZINHA = /^\d{2}:\d{2}$/;
const RE_DATA_ENTRADA = /^\d{2}\/\d{2}\/\d{4}[ ,]+\d{2}:\d{2}/;

// Localiza os "rodapés" das mensagens (quem falou e a que horas).
//  modo 1: "Nome - 14:23" numa linha só
//  modo 2: nome e hora em linhas separadas (o traço pode vir do CSS e não entrar no texto)
function acharRodapes(linhas) {
  const res = [];
  linhas.forEach((l, i) => {
    const m = RE_RODAPE.exec(l);
    if (m) res.push({ ini: i, fim: i, nome: m[1].trim(), hora: m[2], modo: 1 });
  });
  if (res.length) return res;

  let comeco = linhas.findIndex(l => RE_DATA_ENTRADA.test(l) || /data de entrada/i.test(l));
  comeco = comeco < 0 ? 0 : comeco + 1; // ignora o relógio e os temporizadores da barra superior
  for (let i = comeco + 1; i < linhas.length; i++) {
    if (!RE_HORA_SOZINHA.test(linhas[i])) continue;
    let nome = linhas[i - 1], ini = i - 1;
    if (/^[-–—]$/.test(nome) && i - 2 > comeco) { nome = linhas[i - 2]; ini = i - 2; }
    nome = nome.replace(/\s*[-–—]\s*$/, '').trim();
    if (!nome || nome.length > 90 || RE_HORA_SOZINHA.test(nome) || RE_CABECALHO.test(nome)) { nome = '(sem nome)'; ini = i; }
    res.push({ ini, fim: i, nome, hora: linhas[i], modo: 2 });
  }
  return res;
}

function coletarConversa() {
  let melhor = null;
  for (const w of frames()) {
    let d, linhas;
    try {
      d = w.document;
      if (!d.body || d.designMode === 'on' || !janelaVisivel(w)) continue;
      linhas = (d.body.innerText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    } catch (_) { continue; }
    const rods = acharRodapes(linhas);
    if (rods.length && (!melhor || rods.length > melhor.rods.length)) melhor = { w, d, linhas, rods };
  }
  if (!melhor) return null;
  const { rods } = melhor, modo = rods[0].modo, n = rods.length;

  // posições (esquerda = cliente, direita = atendente), na mesma ordem dos rodapés
  let rod = [];
  const walker = melhor.d.createTreeWalker(melhor.d.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const no = walker.currentNode, v = no.nodeValue.trim();
    const bate = modo === 1 ? RE_RODAPE.test(v) : RE_HORA_SOZINHA.test(v);
    if (!bate || !no.parentElement || !visivelEl(no.parentElement)) continue;
    rod.push({ el: no.parentElement, lado: lado(no.parentElement, no) });
  }
  if (modo === 2 && rod.length > n) rod = rod.slice(rod.length - n); // os rodapés são os últimos horários soltos da tela
  const casa = modo === 1 ? rod.length === n : rod.length === n;

  const porIni = new Map(rods.map((f, k) => [f.ini, { f, k }]));
  const msgs = [], cab = [];
  let buf = [], final = '';
  for (let i = 0; i < melhor.linhas.length; i++) {
    const hit = porIni.get(i);
    if (!hit) { buf.push(melhor.linhas[i]); continue; }
    const { f, k } = hit;
    let texto;
    if (msgs.length === 0) {
      const col = [];
      for (let j = buf.length - 1; j >= 0 && col.length < 15; j--) {
        if (RE_CABECALHO.test(buf[j]) || (buf[j].includes(' | ') && buf[j].includes(':'))) { cab.push(...buf.slice(0, j + 1)); break; }
        col.unshift(buf[j]);
      }
      if (!cab.length) cab.push(...buf.slice(0, Math.max(0, buf.length - col.length)));
      texto = col.join('\n');
    } else texto = buf.join('\n');
    msgs.push({ nome: f.nome, hora: f.hora, texto: texto.trim(), sistema: RE_SISTEMA.test(f.nome), lado: casa ? rod[k].lado : null });
    buf = [];
    i = f.fim;
  }
  final = buf.join(' ');
  return { msgs, cabecalho: cab, final, casa, rodapes: rod, doc: melhor.d, modo };
}

function papel(m, conv) {
  if (m.sistema) return 'sistema';
  if (m.lado === 'direita') return 'atendente';
  if (m.lado === 'esquerda') return 'cliente';
  return 'indefinido';
}

function dadosDaChamada(cab) {
  const juntas = [];
  for (let i = 0; i < cab.length; i++) {
    let l = cab[i];
    if (/:\s*$/.test(l) && cab[i + 1]) l += ' ' + cab[++i];
    juntas.push(l);
  }
  const txt = juntas.join(' | ');
  const out = [];
  CHAVES_CHAMADA.forEach(k => {
    const re = new RegExp(k.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ /g, '\\s+') + '\\s*:\\s*([^|\\n]+)', 'i');
    const base = txt.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = re.exec(base);
    if (m) {
      const ini = m.index + m[0].length - m[1].length;
      const val = txt.slice(ini, ini + m[1].length).trim();
      if (val) out.push(k + ': ' + aparar(val, 160));
    }
  });
  return out;
}

function extrair(texto) {
  const semCnj = texto.replace(RE_CNJ, ' ');
  const pegar = (re, base) => unicos([...(base ?? texto).matchAll(re)].map(m => (m[1] ?? m[0]).trim()));
  return {
    processos: pegar(RE_CNJ),
    cpfs: pegar(RE_CPF),
    telefones: pegar(RE_TEL, semCnj).filter(x => x.replace(/\D/g, '').length >= 10),
    emails: pegar(RE_EMAIL),
    matriculas: pegar(RE_MAT)
  };
}

const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const capitalizar = t => String(t).toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());

function formatarTelefone(n) {
  const d = String(n).replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return '+55 (' + d.slice(2, 4) + ') ' + d.slice(4, 9) + '-' + d.slice(9);
  if (d.length === 12 && d.startsWith('55')) return '+55 (' + d.slice(2, 4) + ') ' + d.slice(4, 8) + '-' + d.slice(8);
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return d;
}
function separarNome(nome) {
  const m = /^(.+?)\s+[-–—]\s+(\+?\d[\d\s().-]{8,18}\d)$/.exec(String(nome).trim());
  return m ? { nome: m[1].trim(), tel: m[2].replace(/\D/g, '') } : { nome: String(nome).trim(), tel: '' };
}

// No Interact real, "Tipo | Localização | Matrícula | Grau | Demanda | Descrição" fica dentro de uma caixa de texto (textarea),
// que não aparece no texto da página. Lê o valor dela.
function lerCampoDaFicha() {
  let melhor = '';
  for (const w of frames()) {
    try {
      if (!janelaVisivel(w)) continue;
      w.document.querySelectorAll('textarea, input[type=text], input:not([type])').forEach(el => {
        const v = String(el.value || '').trim();
        if (v.length > melhor.length && /(matr[ií]cula|tipo|descri[cç][ãa]o)\s*:/i.test(v) && visivelEl(el)) melhor = v;
      });
    } catch (_) {}
  }
  return melhor;
}
function lerFicha(conv) {
  let txt = lerCampoDaFicha();
  if (!txt) txt = conv.cabecalho.join(' | ');
  const r = { campos: {}, descricao: '' };
  let t = txt.replace(/\s+/g, ' ');
  const d = /descri[cç][ãa]o\s*:\s*/i.exec(t);
  if (d) { r.descricao = t.slice(d.index + d[0].length).replace(/\s*\|?\s*(salvar|cancelar)\b.*$/i, '').trim(); t = t.slice(0, d.index); }
  t.split('|').forEach(seg => {
    const m = /^\s*([A-Za-zÀ-ÿ ]{2,24}?)\s*:\s*(.+?)\s*$/.exec(seg);
    if (m) r.campos[norm(m[1]).trim()] = m[2];
  });
  const entrada = dadosDaChamada(conv.cabecalho).find(x => /^data de entrada/i.test(x));
  if (entrada && !r.campos['data de entrada']) r.campos['data de entrada'] = entrada.replace(/^[^:]+:\s*/, '');
  return r;
}

const CATEGORIAS = [
  { id: 'acesso', nome: 'Acesso / senha', re: /reset|redefin|senha|acesso|login|logar|bloquead|expirad|usuario|nao consigo (entrar|acessar|abrir)/g },
  { id: 'rede', nome: 'Rede / conexão', re: /\brede\b|internet|wi-?fi|conectar|conexao|\bvpn\b|sem sinal/g },
  { id: 'impressora', nome: 'Impressora / scanner', re: /impressor|imprimir|toner|scanner|digitaliz/g },
  { id: 'lentidao', nome: 'Lentidão / travamento', re: /\blent[oa]|travand|travou|congel|demora/g },
  { id: 'instalacao', nome: 'Instalação / atualização', re: /instal|atualiz|software|programa/g },
  { id: 'email', nome: 'E-mail', re: /e-?mail|outlook|caixa de entrada/g },
  { id: 'certificado', nome: 'Certificado / token', re: /certificado|\btoken\b|assinatura digital/g },
  { id: 'equipamento', nome: 'Equipamento', re: /computador|\bpc\b|monitor|teclado|\bmouse\b|notebook|no-?break/g },
  { id: 'sistema', nome: 'Erro em sistema', re: /\berro\b|nao abre|nao carrega|fora do ar|instabil|nao funciona/g }
];
const SISTEMAS = [
  [/\bmenthor\b/i, 'Menthor'], [/\bsentinela\b/i, 'Sentinela'], [/\bpje\b/i, 'PJe'], [/\bprojudi\b/i, 'Projudi'], [/\bSEI\b/, 'SEI'],
  [/\bsisbajud\b/i, 'Sisbajud'], [/\bteams\b/i, 'Teams'], [/\boutlook\b/i, 'Outlook'], [/\bteamviewer\b/i, 'TeamViewer'], [/\banydesk\b/i, 'AnyDesk'],
  [/\bgpj\b/i, 'GPJ'], [/\bvpn\b/i, 'VPN'], [/e-?mail/i, 'E-mail'], [/\bsolar\b/i, 'Solar'], [/\bthemis\b/i, 'Themis'], [/\bbiometria\b/i, 'Biometria'], [/\bdig(?:i)?doc\b/i, 'Digdoc']
];
const ehRuidoDoChat = t => /compartilhando um arquivo|^(aceitar|cancelar)(\s+(aceitar|cancelar))*$/i.test(t.trim());
const ehIdentificacao = t => /\bmat(?:r[ií]cula)?\b\.?\s*:?\s*\d{3,9}/i.test(t);
const ehSaudacao = t => /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|tudo bem\??|e a[ií])[\s!,.?]*$/i.test(t.trim());
const ehAcordo = t => /^(ok|sim|n[aã]o|obrigad[oa]|valeu|certo|beleza|blz|momento|um momento|aguardo)[\s!,.]*$/i.test(t.trim());
const ehSubstantiva = t => t && !ehIdentificacao(t) && !ehSaudacao(t) && !ehAcordo(t) && t.trim().split(/\s+/).length >= 3;

function minutosDesde(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const n = new Date(), d = n.getHours() * 60 + n.getMinutes() - (Number(m[1]) * 60 + Number(m[2]));
  return d >= 0 && d <= 720 ? d : null;
}
const tempoTxt = d => d < 1 ? 'agora' : d < 60 ? 'há ' + d + ' min' : 'há ' + Math.floor(d / 60) + ' h ' + (d % 60) + ' min';

const GLPI_URL = 'https://atendimento.tjma.jus.br/Form/Render/36';
const ehAgradecimento = t => /obrigad|valeu|resolvid|funcionou|deu certo/i.test(t);
const ehAcordoFinal = t => /^(ok|certo|beleza|blz|obrigad[oa]|muito obrigad[oa]|valeu|sim|n[aã]o|momento|um momento|aguardo|tudo bem)([\s.,!]+(ok|certo|obrigad[oa]|valeu|beleza))*[\s.!,]*$/i.test(t);
const limparTexto = t => String(t).replace(/^[\s\[\]{}]+|[\s\[\]{}]+$/g, '').replace(/\s+/g, ' ').trim();
// fala sem informação ("agora q li direito"): começa com marcador de conversa, é curta e não cita nenhum problema
const ehEnchimento = t => /^(agora|entao|então|bom|pois|hum+|ah+|eh|ai|aí)\b/i.test(t) && t.split(/\s+/).length <= 4 && !t.includes('?') && !CATEGORIAS.some(c => (norm(t).match(c.re) || []).length);
const primeiraMaiuscula = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

function analisar(conv) {
  const msgs = conv.msgs;
  let cli = msgs.filter(m => papel(m, conv) === 'cliente'), att = msgs.filter(m => papel(m, conv) === 'atendente');
  if (!cli.length && !att.length) { // sem posições: o primeiro que não é automático é o cliente
    const nomeCli = msgs.find(m => !m.sistema)?.nome;
    cli = msgs.filter(m => m.nome === nomeCli && !m.sistema);
    att = msgs.filter(m => m.nome !== nomeCli && !m.sistema);
  }
  const ficha = lerFicha(conv);
  const textoCli = cli.map(m => m.texto).join('\n');
  // dados identificados vêm só do cliente e do cabeçalho (e-mail ou telefone citado pelo atendente não é do cliente)
  const dados = extrair(textoCli + '\n' + conv.cabecalho.join('\n') + '\n' + Object.values(ficha.campos).join('\n') + '\n' + ficha.descricao);

  const nomeCliente = cli.length ? separarNome(cli[0].nome) : { nome: '', tel: '' };
  const tel = nomeCliente.tel || (dados.telefones[0] || '');
  const whats = /whatsapp/i.test(msgs.map(m => m.texto).join(' '));
  let nomeInformado = '';
  for (const m of cli) {
    const x = /^(.{3,60}?)[\s,.\-]+mat(?:r[ií]cula)?\.?\s*:?\s*\d{3,9}\b/i.exec(m.texto.trim());
    if (x && !/\d/.test(x[1])) { nomeInformado = capitalizar(x[1].trim()); break; }
  }
  const matriculas = unicos([ficha.campos['matricula'], ...dados.matriculas].filter(Boolean).map(x => String(x).trim()));

  // solicitação completa do cliente, sem o ruído (saudações, "ok", matrícula solta, agradecimento)
  let unidade = '';
  const relato = [];
  for (const m of cli) {
    let t = limparTexto(m.texto).replace(/^(ok|certo|beleza|blz)[.,!]\s+/i, '');
    if (!t || ehRuidoDoChat(t) || ehIdentificacao(t) || ehSaudacao(t) || ehAcordoFinal(t) || /^[\W_]*$/.test(t) || ehEnchimento(t)) continue;
    if (/^[A-ZÀ-Ý]{2,10}$/.test(t)) { if (!unidade) unidade = t; continue; } // palavra única em maiúsculas = unidade/lotação informada
    const linha = primeiraMaiuscula(t);
    if (!relato.some(r => norm(r) === norm(linha))) relato.push(linha);
  }

  const baseCli = norm(textoCli + '\n' + ficha.descricao);
  const cats = CATEGORIAS.map(c => ({ c, n: (baseCli.match(c.re) || []).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 2).map(x => x.c);
  let sistemas = unicos(SISTEMAS.filter(([re]) => re.test(textoCli + '\n' + ficha.descricao)).map(([, n]) => n)).filter(n => n !== 'VPN' || !cats.some(c => c.id === 'rede'));
  const citados = [...(textoCli + '\n' + ficha.descricao).matchAll(/\b(?:no|na|do|da|ao|sistema|portal)\s+(?:sistema\s+|portal\s+)?([A-Z][A-Z0-9]{2,})\b/g)].map(m => m[1]).filter(n => !['TJMA', 'CPF', 'CNJ', 'VPN'].includes(n) && n !== unidade);
  citados.forEach(n => { if (!sistemas.some(x => norm(x) === norm(n))) sistemas.push(n); });
  const soRemoto = sistemas.filter(n => !['AnyDesk', 'TeamViewer'].includes(n));
  if (soRemoto.length) sistemas = soRemoto; // AnyDesk/TeamViewer só entram se forem a única menção
  const remoto = /remot|home ?office|em casa|teletrabalho/.test(baseCli);

  const reais = msgs.filter(m => !m.sistema && (cli.includes(m) || att.includes(m)));
  const ultimo = reais[reais.length - 1];
  const textoTudo = msgs.map(m => m.texto).join(' ') + ' ' + conv.final;
  const encerrado = /encerramos este atendimento|atendimento encerrado|inatividade/i.test(textoTudo);
  const papelUlt = ultimo ? (cli.includes(ultimo) ? 'cliente' : 'atendente') : null;
  const agradeceu = papelUlt === 'cliente' && ehAgradecimento(ultimo.texto);

  // pergunta do atendente: só vale se for a última fala dele; respostas = o que o cliente disse depois
  let pergunta = null, respostas = [];
  const ultAtt = [...reais].reverse().find(m => att.includes(m));
  if (ultAtt && /\?\s*$/.test(ultAtt.texto.trim())) { pergunta = ultAtt; respostas = reais.slice(reais.indexOf(ultAtt) + 1).filter(m => cli.includes(m)); }
  const limparAbertura = t => { let x = t; for (let k = 0; k < 3; k++) x = x.replace(/^(ol[aá]|oi+|bom dia|boa tarde|boa noite|ent[aã]o|bem|ah|opa)(?![A-Za-zÀ-ÿ])[\s!,.]*/i, ''); return primeiraMaiuscula(x.trim()); };
  const fraseFinal = t => /[.!?]$/.test(t) ? t : t + '.';
  const reqRe = /gostaria|preciso|precisa|solicit|quero|queria|nao consigo|erro|problema|reset|acesso|ajuda|tentando|aparece|nao abre|nao funciona|falha/;
  let cand = relato.filter(r => reqRe.test(norm(r)));
  if (!cand.length) cand = relato.filter(r => r.split(/\s+/).length >= 3);
  cand = cand.slice(0, cand[0] && cand[0].split(/\s+/).length < 6 ? 2 : 1);
  const pedido = unicos(cand.map(limparAbertura).filter(Boolean).map(fraseFinal));
  if (ficha.descricao) { // o pedido da abertura vale como base; a fala do cliente só entra se trouxer algo novo
    const pal = t => new Set(norm(t).split(/[^a-z0-9]+/).filter(w => w.length >= 4));
    const base = pal(ficha.descricao);
    const novos = pedido.filter(p => { const q = pal(p); let c = 0; q.forEach(w => { if (base.has(w)) c++; }); return !q.size || c / Math.min(q.size, Math.max(base.size, 1)) < 0.5; });
    pedido.length = 0; pedido.push(fraseFinal(primeiraMaiuscula(ficha.descricao)), ...novos);
  }
  const perguntouVpn = att.some(m => /\bvpn\b/i.test(m.texto));

  // o que o atendente orientou (sem a saudação automática)
  const orientacoes = [];
  for (const m of att) {
    const t = limparTexto(m.texto);
    if (!t || ehRuidoDoChat(t) || ehAcordoFinal(t) || /chat iniciado|leia acima|hist[oó]rico de chamada|bem-vindo ao nosso servi[cç]o/i.test(t)) continue;
    orientacoes.push(primeiraMaiuscula(t));
  }
  return { msgs, cli, att, ficha, dados, matriculas, nomeCliente, nomeInformado, tel, whats, cats, sistemas, remoto, relato, pedido, unidade, orientacoes, ultimo, papelUlt, encerrado, agradeceu, pergunta, respostas, perguntouVpn, textoCli, baseCli };
}

function montarResumo(conv, A) {
  A = A || analisar(conv);
  const secoes = [];
  const f = A.ficha.campos;
  const ficha = [];
  ficha.push('Nome: ' + (A.nomeCliente.nome || 'não identificado') + (A.nomeInformado && norm(A.nomeInformado) !== norm(A.nomeCliente.nome) ? ' (informou: ' + A.nomeInformado + ')' : ''));
  if (A.tel) ficha.push('Contato: ' + formatarTelefone(A.tel) + (A.whats ? ' (WhatsApp)' : ''));
  if (A.matriculas.length) ficha.push('Matrícula: ' + A.matriculas.join(', '));
  if (A.unidade) ficha.push('Unidade informada: ' + A.unidade);
  if (f['tipo']) ficha.push('Tipo: ' + aparar(f['tipo'], 60));
  if (f['localizacao']) ficha.push('Localização: ' + aparar(f['localizacao'], 60));
  if (f['grau']) ficha.push('Grau: ' + aparar(f['grau'], 60));
  if (f['demanda']) ficha.push('Demanda: ' + aparar(f['demanda'], 80));
  if (A.dados.emails.length) ficha.push('E-mail: ' + A.dados.emails.join(', '));
  if (A.dados.cpfs.length) ficha.push('CPF: ' + A.dados.cpfs.join(', '));
  if (A.dados.processos.length) ficha.push('Processos: ' + A.dados.processos.join(', '));
  if (f['data de entrada']) ficha.push('Entrada: ' + aparar(f['data de entrada'], 30));
  const nomesAtt = unicos(A.att.map(m => m.nome));
  if (nomesAtt.length) ficha.push('Atendente: ' + nomesAtt.join(', '));
  secoes.push({ titulo: 'Quem é o cliente', itens: ficha });

  const sol = [];
  const refere = unicos([...A.cats.map(c => c.nome), ...A.sistemas]);
  if (refere.length) sol.push('Refere-se a: ' + refere.join(' · '));
  if (A.ficha.descricao) sol.push('Pedido na abertura: ' + aparar(A.ficha.descricao, 220));
  A.relato.forEach(r => sol.push(aparar(r, 260)));
  if (A.remoto) sol.push('Contexto: trabalho remoto (informado pelo cliente)');
  if (!A.relato.length && !A.ficha.descricao) sol.push('O cliente ainda não descreveu o problema.');
  secoes.push({ titulo: 'Solicitação do cliente (filtrada)', itens: sol });

  const sit = [];
  const minutos = A.ultimo ? minutosDesde(A.ultimo.hora) : null;
  if (A.encerrado) sit.push('Encerrado (pelo atendente ou por inatividade)');
  else if (A.agradeceu) sit.push('Em andamento: o cliente agradeceu; provavelmente pode encerrar' + (minutos !== null ? ' (' + tempoTxt(minutos) + ')' : ''));
  else if (A.papelUlt === 'cliente') sit.push('Em andamento: aguardando resposta do atendente' + (minutos !== null ? ' (cliente escreveu ' + tempoTxt(minutos) + ')' : ''));
  else if (A.papelUlt === 'atendente') sit.push('Em andamento: aguardando retorno do cliente' + (minutos !== null ? ' (atendente respondeu ' + tempoTxt(minutos) + ')' : ''));
  else sit.push('Em andamento');
  if (!A.encerrado && A.pergunta) {
    sit.push('Atendente perguntou: “' + aparar(A.pergunta.texto, 120) + '”' + (A.respostas.length ? ' → cliente respondeu: “' + aparar(A.respostas.map(m => limparTexto(m.texto)).join(' / '), 160) + '”' : ' (ainda sem resposta)'));
  }
  secoes.push({ titulo: 'Situação', itens: sit });
  return secoes;
}

// Rascunho do chamado no GLPI: título + descrição com os dados do cliente e a solicitação filtrada.
function dadosGlpi(conv, A, opcoes) {
  const f = A.ficha.campos;
  const nome = A.nomeInformado || A.nomeCliente.nome || '';
  const local = String(A.tel || '').replace(/^55(?=\d{10,11}$)/, '');
  const telefone = local ? formatarTelefone(local) : '';
  const matricula = A.matriculas[0] || '';
  const sistema = A.sistemas.find(n => !['VPN', 'TeamViewer', 'AnyDesk'].includes(n)) || '';
  let titulo = primeiraMaiuscula(aparar((A.pedido[0] || A.relato[0] || 'Atendimento via Interact').replace(/\.$/, ''), 90));
  if (sistema && !norm(titulo).includes(norm(sistema))) titulo = sistema + ' - ' + titulo;

  // descrição = só a demanda (quem é + resumo do pedido), sem a conversa
  const L = [];
  L.push('REQUERENTE');
  L.push('Nome: ' + (nome || 'não identificado'));
  if (matricula) L.push('Matrícula: ' + matricula);
  if (telefone) L.push('Contato: ' + telefone);
  if (A.dados.emails.length) L.push('E-mail: ' + A.dados.emails.join(', '));
  const extras = [f['tipo'] && 'Tipo: ' + f['tipo'], f['localizacao'] && 'Localização: ' + f['localizacao'], A.unidade && 'Unidade: ' + A.unidade].filter(Boolean);
  if (extras.length) L.push(extras.join(' · '));
  L.push('', 'SOLICITAÇÃO');
  const refere = unicos([...A.cats.map(c => c.nome), ...A.sistemas.filter(n => !['AnyDesk', 'TeamViewer'].includes(n))]);
  if (refere.length) L.push('Assunto: ' + refere.join(' · '));
  L.push(A.pedido.length ? A.pedido.join(' ') : 'Não foi possível identificar o pedido na conversa. Descreva aqui.');
  if (A.dados.processos.length) L.push('Processos: ' + A.dados.processos.join(', '));
  if (A.remoto) L.push('Observação: cliente em trabalho remoto.');
  if (opcoes && opcoes.acoes && A.orientacoes.length) { L.push('', 'AÇÕES JÁ REALIZADAS'); A.orientacoes.slice(0, 6).forEach(o => L.push('- ' + aparar(o, 200))); }
  return { titulo, descricao: L.join('\n'), telefone, matricula, requerente: nome };
}

// Sugestões de resposta: regras simples sobre o que foi dito + suas próprias macros. Só insere no editor; nunca envia.
function sugerir(conv, A) {
  const out = [];
  const nome = (A.nomeCliente.nome || A.nomeInformado || '').split(/\s+/)[0] || '';
  const v = nome ? ', ' + nome : '';
  const ass = A.sistemas.filter(n => !['VPN', 'TeamViewer', 'AnyDesk'].includes(n))[0];
  const add = (rot, texto, ehMacro) => { if (texto && !out.some(o => o.texto === texto)) out.push({ rot, texto, macro: !!ehMacro }); };
  const achar = re => (macros || []).find(m => re.test(norm(m.title + ' ' + m.cat)));
  const usar = (rot, re, padrao) => { const m = achar(re); add(m ? rot + ' · ' + m.title : rot, m ? vars(m.text) : padrao, !!m); };
  const ultCli = A.papelUlt === 'cliente' ? A.ultimo.texto : '';

  if (A.encerrado) usar('Encerramento', /encerr/, 'Obrigado pelo contato! Qualquer dúvida, estamos à disposição.');
  else if (A.agradeceu) usar('Encerrar atendimento', /encerr/, 'Fico feliz em ter ajudado' + v + '! Posso encerrar o atendimento?');
  else if (A.papelUlt === 'cliente') {
    if (A.pergunta && /\bvpn\b/i.test(A.pergunta.texto) && A.respostas.length) {
      const r = norm(A.respostas.map(m => m.texto).join(' ')).trim();
      if (/^(nao|n\b|ainda nao|desligad)/.test(r)) add('Pedir para ligar a VPN', 'Por favor, conecte a VPN e tente novamente' + v + '. Me avise se o problema continuar.');
      else add('Seguir após a VPN', 'Certo' + v + '. Vou verificar' + (ass ? ' o seu acesso ao ' + ass : ' o seu caso') + ' agora. Um momento, por favor.');
    }
    add('Pedir um momento', 'Um momento, por favor' + v + '. Vou verificar e já retorno.');
  } else if (A.papelUlt === 'atendente') add('Cobrar retorno', 'Conseguiu testar' + v + '? Fico no aguardo do seu retorno.');

  if (!A.encerrado && !A.att.length) usar('Saudação', /sauda/, 'Olá' + v + '! Em que posso ajudar?');
  if (!A.encerrado && !A.matriculas.length) usar('Pedir dados', /dados|matric/, 'Me informe por gentileza o seu nome, matrícula e um telefone para contato.');
  const tecnico = A.cats.some(c => ['acesso', 'rede', 'sistema', 'lentidao'].includes(c.id));
  if (!A.encerrado && A.remoto && tecnico && !A.perguntouVpn) add('Perguntar sobre a VPN', 'Você está com a VPN ligada?');
  if (!A.encerrado && A.cats.some(c => c.id === 'acesso') && A.matriculas.length) {
    const reset = /reset|redefin|senha/.test(A.baseCli);
    add(reset ? 'Confirmar o reset' : 'Confirmar verificação', (reset ? 'Vou providenciar o reset do seu acesso' : 'Vou verificar o seu acesso') + (ass ? ' ao ' + ass : '') + '. Assim que concluir, aviso por aqui.');
  }
  if (!A.encerrado && (A.cats.some(c => ['rede', 'lentidao', 'sistema', 'equipamento', 'instalacao'].includes(c.id)) || /nao consigo|nao abre|travou/.test(A.baseCli))) usar('Acesso remoto', /remot|teamviewer|anydesk/, 'Para que eu possa realizar o acesso remoto, por gentileza, informe o ID do TeamViewer.');

  // macros suas que combinam com o assunto
  const PARADAS = new Set(['para', 'como', 'esta', 'este', 'voce', 'favor', 'gentileza', 'sobre', 'muito', 'mais', 'aqui', 'pode', 'poder', 'preciso', 'meu', 'minha', 'nao', 'consigo']);
  const palavras = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !PARADAS.has(w)));
  const alvo = palavras(A.baseCli);
  (macros || []).map(m => {
    const t = palavras(m.title + ' ' + m.cat), c = palavras(m.text);
    let sc = 0; alvo.forEach(w => { if (t.has(w)) sc += 3; else if (c.has(w)) sc += 1; });
    return { m, sc };
  }).filter(x => x.sc >= 3).sort((a, b) => b.sc - a.sc).slice(0, 2).forEach(x => add('Macro · ' + x.m.title, vars(x.m.text), true));
  return out.slice(0, 6);
}

const textoDoResumo = secoes => 'RESUMO DO ATENDIMENTO\n\n' + secoes.map(s => s.titulo.toUpperCase() + '\n' + s.itens.map(i => '• ' + i).join('\n')).join('\n\n');
function textoDaConversa(conv) {
  return conv.msgs.map(m => '[' + m.hora + '] ' + m.nome + (papel(m, conv) !== 'indefinido' ? ' (' + papel(m, conv) + ')' : '') + ': ' + m.texto.replace(/\n+/g, ' ')).join('\n');
}

async function copiar(texto, okMsg) {
  try { await navigator.clipboard.writeText(texto); notice(okMsg, 'success'); return; } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    notice(ok ? okMsg : 'Não consegui copiar. Selecione o texto e use Ctrl+C.', ok ? 'success' : 'error');
  } catch (_) { notice('Não consegui copiar. Selecione o texto e use Ctrl+C.', 'error'); }
}

function diagnostico(conv) {
  const cadeia = el => { const o = []; for (let e = el; e && o.length < 7; e = e.parentElement) o.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id.replace(/\d+/g, 'N') : '') + (e.className ? '.' + String(e.className).trim().split(/\s+/).join('.') : '')); return o.join(' < '); };
  return ['modo de leitura: ' + conv.modo, 'rodapés (texto): ' + conv.msgs.length, 'rodapés (elementos visíveis): ' + conv.rodapes.length, 'posições casadas: ' + conv.casa]
    .concat(conv.rodapes.slice(0, 3).map((r, i) => 'rodapé ' + (i + 1) + ' [' + r.lado + ']: ' + cadeia(r.el))).join('\n');
}

const mascarar = s => String(s).replace(/[A-Za-zÀ-ÿ]/g, 'a').replace(/\d/g, '9');
function diagnosticoGeral() {
  const out = ['Zeus Central 1.8.0 · diagnóstico do resumo (letras = a, números = 9; sem conteúdo da conversa)'];
  let n = 0;
  for (const w of frames()) {
    n++;
    try {
      const d = w.document;
      if (!d.body) { out.push('quadro ' + n + ': sem body'); continue; }
      const linhas = (d.body.innerText || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
      const comHora = linhas.filter(l => /\d{1,2}:\d{2}/.test(l));
      out.push('quadro ' + n + (ehTopo(w) ? ' (topo)' : '') + ' · visível: ' + janelaVisivel(w) + ' · linhas: ' + linhas.length + ' · com hora: ' + comHora.length + ' · rodapés válidos: ' + linhas.filter(l => RE_RODAPE.test(l)).length);
      comHora.slice(0, 8).forEach(l => out.push('    ' + aparar(mascarar(l), 70)));
      // contexto ao redor dos horários HH:MM soltos: mostra a ordem das linhas (nome, mensagem, hora)
      let ctx = 0;
      linhas.forEach((l, i) => {
        if (ctx >= 4 || !/^\d{2}:\d{2}$/.test(l)) return;
        ctx++;
        out.push('  contexto do horário #' + ctx + ':');
        for (let j = Math.max(0, i - 3); j <= Math.min(linhas.length - 1, i + 1); j++)
          out.push('    ' + (j === i ? '>> ' : '   ') + aparar(mascarar(linhas[j]), 50) + ' (' + linhas[j].length + ')');
      });
    } catch (e) { out.push('quadro ' + n + ': bloqueado'); }
  }
  return out.join('\n');
}

// Entrega os dados ao formulário do GLPI: ficam só no armazenamento local da extensão, valem por 30 min e são apagados ao preencher.
function abrirGlpi(dados) {
  const arm = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local;
  if (!arm) {
    copiar(dados.descricao, 'Sem acesso ao armazenamento da extensão: descrição copiada. Cole no GLPI.');
    window.open(GLPI_URL, '_blank');
    return;
  }
  let p;
  const { matricula, ...semMatricula } = dados; // a matrícula fica só no texto da descrição; não vai para o campo de busca do GLPI
  try { p = arm.set({ zeus_glpi_pendente: { ...semMatricula, criadoEm: Date.now() } }); } catch (_) { p = null; }
  window.open(GLPI_URL, '_blank'); // abre na hora do clique (senão o navegador pode bloquear)
  Promise.resolve(p).then(() => notice('GLPI aberto. O Zeus vai preencher o formulário; revise antes de enviar.', 'success'))
    .catch(() => { copiar(dados.descricao, 'Não consegui passar os dados ao GLPI: descrição copiada. Cole lá.'); });
}

function renderResumo() {
  const view = panel.querySelector('#view');
  view.innerHTML = '<div class="sum-top"><div><b>📝 Resumo da conversa</b><small>Feito aqui no navegador. Nada é enviado para fora.</small></div><button class="action primary" id="sumgo">Resumir</button></div><div class="sum-body" id="sumbody"></div>';
  const corpo = view.querySelector('#sumbody');
  const rodar = () => {
    const conv = coletarConversa();
    if (!conv || !conv.msgs.length) {
      corpo.innerHTML = '<div class="wiki-empty"><div>💬</div><b>Não encontrei a conversa</b><p>Procurei linhas no formato "Nome - 14:23" na tela e não achei nenhuma. Deixe o atendimento aberto, com mensagens visíveis, e clique em Resumir. Se já estiver assim, o chat pode ter um formato diferente: use o botão abaixo e me envie o resultado.</p><button class="action" id="sumdiag0" title="Copia só a forma do texto (letras viram a, números viram 9)">Copiar diagnóstico</button></div>';
      corpo.querySelector('#sumdiag0').addEventListener('click', () => copiar(diagnosticoGeral(), 'Diagnóstico copiado (sem conteúdo da conversa).'));
      notice('Não encontrei a conversa na tela.', 'warn');
      return;
    }
    notice('Resumo atualizado.', 'success');
    const A = analisar(conv);
    const secoes = montarResumo(conv, A);
    const sugs = sugerir(conv, A);
    corpo.innerHTML = secoes.map(s => '<section class="sum-card"><h4>' + esc(s.titulo) + '</h4><ul>' + s.itens.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></section>').join('') +
      (sugs.length ? '<section class="sum-card"><h4>Sugestões de resposta</h4><div class="sug-nota">Toque para colocar no editor. Revise antes de enviar.</div>' + sugs.map((x, k) => '<button class="sug" data-k="' + k + '"><b>' + esc(x.rot) + '</b><span>' + esc(aparar(x.texto, 140)) + '</span></button>').join('') + '</section>' : '') +
      '<section class="sum-card"><h4>Chamado no GLPI</h4><div class="sug-nota">Descrição enxuta: quem é o cliente e o resumo do pedido (sem a conversa). Edite se precisar.</div><label class="sum-lbl">Título<input class="sum-in" id="glpiTit"></label><label class="sum-chk"><input type="checkbox" id="glpiAcoes"> Incluir o que o atendente já fez</label><label class="sum-lbl">Descrição<textarea class="sum-in" id="glpiDesc" rows="9"></textarea></label><div class="sum-actions"><button class="action primary" id="glpiabrir" title="Abre o formulário de Requisição e preenche título, descrição e telefone. Você escolhe o requerente, revisa e envia.">Abrir no GLPI e preencher</button><button class="action" id="glpicop">Copiar descrição</button></div></section>' +
      '<div class="sum-actions"><button class="action primary" id="sumcopy">Copiar resumo</button><button class="action" id="sumconv">Copiar conversa</button><button class="action" id="sumdiag" title="Copia só nomes de classes e contagens, sem texto da conversa">Diagnóstico</button></div>';
    let G = dadosGlpi(conv, A);
    const inTit = corpo.querySelector('#glpiTit'), inDesc = corpo.querySelector('#glpiDesc'), inAcoes = corpo.querySelector('#glpiAcoes');
    inTit.value = G.titulo; inDesc.value = G.descricao;
    inAcoes.addEventListener('change', () => { G = dadosGlpi(conv, A, { acoes: inAcoes.checked }); inDesc.value = G.descricao; });
    corpo.querySelector('#glpicop').addEventListener('click', () => copiar(inDesc.value, 'Descrição copiada.'));
    corpo.querySelector('#glpiabrir').addEventListener('click', () => abrirGlpi({ ...G, titulo: inTit.value.trim(), descricao: inDesc.value }));
    corpo.querySelectorAll('.sug').forEach(b => b.addEventListener('click', () => inserir(sugs[Number(b.dataset.k)].texto, 'Sugestão inserida no editor. Revise antes de enviar.')));
    corpo.querySelector('#sumcopy').addEventListener('click', () => copiar(textoDoResumo(secoes), 'Resumo copiado.'));
    corpo.querySelector('#sumconv').addEventListener('click', () => copiar(textoDaConversa(conv), 'Conversa copiada.'));
    corpo.querySelector('#sumdiag').addEventListener('click', () => copiar(diagnosticoGeral() + '\n' + diagnostico(conv), 'Diagnóstico copiado (sem texto da conversa).'));
  };
  view.querySelector('#sumgo').addEventListener('click', rodar);
  rodar();
}

/* ================================================================
   PAINEL
================================================================ */
function render() {
  panel.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  panel.querySelector('#view').className = 'view' + (tab === 'settings' ? ' settings' : '');
  if (tab === 'macros') renderMacros();
  if (tab === 'wiki') renderWiki();
  if (tab === 'resumo') renderResumo();
  if (tab === 'settings') renderSettings();
}

let fecharFora = read(K.fora, true) !== false;
// Clique fora do Zeus (na página ou dentro dos quadros do Interact) fecha o painel.
function cliqueFora(e) {
  if (!opened || !fecharFora) return;
  const caminho = typeof e.composedPath === 'function' ? e.composedPath() : [];
  if (caminho.includes(host) || e.target === host) return;
  toggle(false);
}

let ultimoAlternar = 0;
// Alt+Z pode chegar por dois caminhos (tecla na página e comando do navegador): conta uma vez só.
function alternar() {
  const agora = Date.now();
  if (agora - ultimoAlternar < 350) return;
  ultimoAlternar = agora;
  toggle();
}

function toggle(force) {
  opened = typeof force === 'boolean' ? force : !opened;
  panel.classList.toggle('open', opened);
  if (opened) {
    render();
    if (tab === 'macros') setTimeout(() => search?.focus(), 40);
  }
}

/* ================================================================
   TEMA DO INTERACT
================================================================ */
const THEME_DARK = "html,body{background:#20242b!important;color:#d7dce5!important}#pnlTelaPrincipal,.x-panel,.x-panel-body,.x-window,.x-window-mc,.x-tab-panel,.x-tab-panel-body,.x-grid3,.x-grid3-body,.x-grid3-row,.x-tree,.x-tree-node,.x-toolbar,.x-toolbar-ct,.x-form-field,.x-form-text,.x-menu,.x-menu-list,.x-combo-list,.x-border-layout-ct{background-color:#252a32!important;color:#d7dce5!important;border-color:#414854!important}.x-panel-header,.x-tab-strip,.x-tab-strip-top,.x-tab-strip-wrap{background:#303746!important;color:#e2e8f0!important}.x-tab-strip-active,.x-tab-strip-active .x-tab-right,.x-tab-strip-active .x-tab-left,.x-tab-strip-active .x-tab-strip-inner{background:#39465d!important;color:#a9c4ff!important}.x-btn-mc,.x-btn-tl,.x-btn-tr,.x-btn-tc,.x-btn-ml,.x-btn-mr,.x-btn-bl,.x-btn-br,.x-btn-bc{background-color:#303946!important;background-image:none!important;color:#e2e8f0!important;border-color:#4b5665!important}.x-form-text, input,textarea,select{background:#1d232b!important;color:#e2e8f0!important;border-color:#4b5665!important}.x-grid3-row-over,.x-tree-node-over{background:#354153!important}.x-grid3-row-selected{background:#344967!important}.x-grid3-cell-inner,.x-tree-node-anchor,.x-panel-header-text,.x-tab-strip-text{color:#d7dce5!important}iframe.gwt-RichTextArea{background:#252a32!important}#pnlTelaPrincipal .x-panel-body div[style*=\"border-radius\"],#pnlTelaPrincipal .x-panel-body div[style*=\"box-shadow\"]{background:#344154!important;background-image:none!important;color:#f1f5f9!important;border:1px solid #46566b!important}#pnlTelaPrincipal .x-panel-body div[style*=\"border-radius\"] *,#pnlTelaPrincipal .x-panel-body div[style*=\"box-shadow\"] *{color:#f1f5f9!important}#pnlTelaPrincipal .x-panel-body div[style*=\"border-radius\"] span,#pnlTelaPrincipal .x-panel-body div[style*=\"box-shadow\"] span{color:#f1f5f9!important}" + 'html{color-scheme:dark}';
const THEME_LIGHT = "html,body{background:#e8edf5!important;color:#243247!important}.x-panel,.x-panel-body,.x-window,.x-window-mc,.x-tab-panel,.x-tab-panel-body,.x-grid3,.x-grid3-body,.x-grid3-row,.x-tree,.x-tree-node,.x-toolbar,.x-toolbar-ct,.x-form-field,.x-form-text,.x-menu,.x-menu-list,.x-combo-list,.x-border-layout-ct{background-color:#e8edf5!important;color:#243247!important;border-color:#cbd5e1!important}.x-panel-header,.x-tab-strip,.x-tab-strip-top,.x-tab-strip-wrap{background:#dce5f1!important;color:#243247!important}.x-tab-strip-active,.x-tab-strip-active .x-tab-right,.x-tab-strip-active .x-tab-left,.x-tab-strip-active .x-tab-strip-inner{background:#d5e0f2!important;color:#315cc0!important}.x-btn-mc,.x-btn-tl,.x-btn-tr,.x-btn-tc,.x-btn-ml,.x-btn-mr,.x-btn-bl,.x-btn-br,.x-btn-bc{background-color:#f1f4f8!important;background-image:none!important;color:#334155!important;border-color:#cbd5e1!important}.x-form-text,input,textarea,select{background:#f8fafc!important;color:#243247!important;border-color:#cbd5e1!important}.x-grid3-row-over,.x-tree-node-over{background:#dce8f8!important}.x-grid3-row-selected{background:#d3e4fa!important}.x-grid3-cell-inner,.x-tree-node-anchor,.x-panel-header-text,.x-tab-strip-text{color:#243247!important}#pnlTelaPrincipal .x-panel-body div[style*=\"border-radius\"],#pnlTelaPrincipal .x-panel-body div[style*=\"box-shadow\"]{background:#d8e8f8!important;background-image:none!important;color:#18324f!important;border:1px solid #b8cde3!important}#pnlTelaPrincipal .x-panel-body div[style*=\"border-radius\"] *,#pnlTelaPrincipal .x-panel-body div[style*=\"box-shadow\"] *{color:#18324f!important}" + 'html{color-scheme:light}';

const MODERN_CSS = [
  'body,.x-panel-body,.x-form-field,.x-btn button,.x-tab-strip-text,.x-grid3-cell-inner,.x-menu-item,.x-panel-header-text,.x-toolbar{font-family:"Inter","Segoe UI",Roboto,Arial,sans-serif!important}',
  '::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}',
  '::-webkit-scrollbar-thumb{background:#94a3b8aa;border-radius:8px;border:2px solid transparent;background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:#94a3b8;background-clip:content-box}',
  // abas e botões
  '.x-tab-strip-active .x-tab-strip-inner{box-shadow:inset 0 -3px #4f6df0!important;border-radius:8px 8px 0 0!important}',
  '.x-tab-strip-text{font-weight:600!important}',
  '.x-btn-mc,.x-btn-tl,.x-btn-tr,.x-btn-bl,.x-btn-br{border-radius:8px!important}',
  '.x-btn-over .x-btn-mc{filter:brightness(1.08)}',
  '.x-form-text,.x-form-field{border-radius:8px!important}',
  '.x-form-focus{border-color:#4f6df0!important;box-shadow:0 0 0 3px #4f6df033!important}',
  '.x-item-disabled,.x-btn-disabled{opacity:.6!important}',
  // balões
  '[data-zeus-balao]{border-radius:14px!important;box-shadow:0 1px 3px #00000030!important;line-height:1.45}',
  // botões planos (gradiente antigo removido)
  '[data-zeus-flat]{background-image:none!important;border-radius:8px!important;border:1px solid #64748b66!important}',
  // Enviar (principal) e Finalizar (perigo)
  '[data-zeus-role=send],[data-zeus-role=send] *{background-image:none!important;color:#fff!important;text-shadow:none!important}',
  '[data-zeus-role=send],[data-zeus-role=send] .x-btn-mc,[data-zeus-role=send] button{background-color:#3b5bdb!important;border-color:#3b5bdb!important;border-radius:8px!important}',
  '[data-zeus-role=end],[data-zeus-role=end] *{background-image:none!important;color:#fff!important;text-shadow:none!important}',
  '[data-zeus-role=end],[data-zeus-role=end] .x-btn-mc,[data-zeus-role=end] button{background-color:#d1383d!important;border-color:#d1383d!important;border-radius:8px!important}',
  '[data-zeus-role]:hover{filter:brightness(1.1)}'
].join('\n');
const themeCSS = () => (theme === 'dark' ? THEME_DARK : THEME_LIGHT) + MODERN_CSS;

function applyPageTheme() {
  if (!pageThemeStyle) {
    pageThemeStyle = document.getElementById('zeus-page-theme');
    if (!pageThemeStyle) {
      pageThemeStyle = document.createElement('style');
      pageThemeStyle.id = 'zeus-page-theme';
      (document.head || document.documentElement).append(pageThemeStyle);
    }
  }
  const css = themeCSS();
  if (pageThemeStyle.textContent !== css) pageThemeStyle.textContent = css;
  if (panel && panel.dataset.theme !== theme) panel.dataset.theme = theme;

  // Frames do mesmo domínio (chat, editor GWT etc.) recebem o mesmo tema.
  for (const w of frames()) {
    if (ehTopo(w)) continue;
    try {
      const d = w.document;
      if (!d.documentElement) continue;
      let s = d.getElementById('zeus-frame-theme');
      if (!s) { s = d.createElement('style'); s.id = 'zeus-frame-theme'; (d.head || d.documentElement).append(s); }
      if (s.textContent !== css) s.textContent = css;
      if (d.body) {
        const bg = theme === 'dark' ? '#252a32' : '#e8edf5', fg = theme === 'dark' ? '#d7dce5' : '#243247';
        if (d.body.style.background !== bg) d.body.style.background = bg;
        if (d.body.style.color !== fg) d.body.style.color = fg;
      }
    } catch (_) {}
  }
  if (applyPageTheme.ultimo !== theme) {
    applyPageTheme.ultimo = theme;
    resetarContraste();
  }
}

/* ================================================================
   GARANTIA DE CONTRASTE
   Não depende das classes do ExtJS: calcula o contraste real entre o texto e o fundo
   de cada elemento (em todos os frames) e corrige o que ficar abaixo de 4,5:1.
   Nos balões de mensagem, no tema escuro, escurece fundos claros mantendo o matiz
   (assim atendente e cliente continuam distinguíveis).
   O documento do editor de mensagens nunca é tocado, para não alterar o que é enviado.
================================================================ */
const IGNORAR = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION', 'HEAD']);
const SEM_FUNDO = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'HTML', 'OBJECT', 'EMBED']);
const ATTRS = '[data-zeus-ct],[data-zeus-bg],[data-zeus-balao],[data-zeus-flat],[data-zeus-role],[data-zeus-img]';
let vistosFundo = new WeakSet(), vistosTexto = new WeakSet(), vistosBotao = new WeakSet();

function luminancia([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const razao = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
function lerCor(css) {
  const m = css && css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
}
function rgbParaHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslParaRgb(h, s, l) {
  if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const t = x => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return [Math.round(t(h + 1 / 3) * 255), Math.round(t(h) * 255), Math.round(t(h - 1 / 3) * 255)];
}
function fundoEfetivo(el, win) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const c = lerCor(win.getComputedStyle(e).backgroundColor);
    if (c && c.a > 0.5) return c.rgb;
  }
  return null;
}
const editavel = el => !!(el.isContentEditable || el.closest?.('[contenteditable]:not([contenteditable=false])'));
const interativo = el => el.matches('button,input,select,a') || !!el.closest('button,select,.x-btn');
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Tema escuro: todo fundo claro e opaco vira escuro. Contêineres ficam bem escuros; balões
// mantêm o matiz (atendente x cliente) e ficam um pouco mais claros que o fundo da tela.
function escurecerFundo(el, cs) {
  if (SEM_FUNDO.has(el.tagName.toUpperCase()) || 'zeusRole' in el.dataset || el.closest('[data-zeus-role]')) return;
  const bg = lerCor(cs.backgroundColor);
  if (!bg || bg.a < 0.9 || luminancia(bg.rgb) < 0.55) return;
  const balao = (parseFloat(cs.borderTopLeftRadius) || 0) >= 6;
  const [h, s, l] = rgbParaHsl(...bg.rgb);
  const novoL = balao ? Math.max(0.16, l * 0.3) : 0.15 + Math.max(0, l - 0.55) * 0.12;
  const [r, g, b] = hslParaRgb(h, Math.min(s, balao ? 0.55 : 0.3), novoL);
  el.dataset.zeusBg = el.style.getPropertyValue('background-color') || '';
  el.style.setProperty('background-color', 'rgb(' + r + ',' + g + ',' + b + ')', 'important');
}

// Balões de mensagem (elementos arredondados, com fundo e texto) ganham cantos maiores e sombra suave.
function marcarBalao(el, cs) {
  if ('zeusBalao' in el.dataset || SEM_FUNDO.has(el.tagName.toUpperCase()) || interativo(el)) return;
  if (el.closest('.x-tab-strip,.x-toolbar,.x-menu,.x-panel-header,.x-window-header,.x-combo-list')) return;
  if ((parseFloat(cs.borderTopLeftRadius) || 0) < 6) return;
  const bg = lerCor(cs.backgroundColor);
  if (!bg || bg.a < 0.9 || !el.textContent.trim()) return;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 20) return;
  el.dataset.zeusBalao = '';
}

// Botões: "Enviar" vira o botão principal, "Finalizar" o de perigo; botões com gradiente antigo ficam planos.
function modernizarBotoes(win) {
  win.document.querySelectorAll('button,input[type=button],input[type=submit]').forEach(b => {
    if (vistosBotao.has(b) || editavel(b)) return;
    vistosBotao.add(b);
    const rotulo = semAcento(b.tagName === 'INPUT' ? b.value : b.textContent);
    const papel = rotulo === 'enviar' ? 'send' : rotulo === 'finalizar' ? 'end' : null;
    const caixa = b.closest('.x-btn');
    if (papel) (caixa || b).dataset.zeusRole = papel;
    if (!caixa) {
      const img = win.getComputedStyle(b).backgroundImage || '';
      if (img.includes('gradient') && !img.includes('url(')) b.dataset.zeusFlat = '';
    }
  });
}

function ajustarTexto(el, win) {
  const cs = win.getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  const fg = lerCor(cs.color), bg = fundoEfetivo(el, win);
  if (!fg || !bg) return;
  const lb = luminancia(bg);
  if (razao(luminancia(fg.rgb), lb) >= 4.5) return;
  const usarClaro = razao(luminancia([241, 245, 249]), lb) >= razao(luminancia([15, 23, 42]), lb);
  el.dataset.zeusCt = '1';
  el.style.setProperty('color', usarClaro ? '#f1f5f9' : '#0f172a', 'important');
}


// Campos com valor (input/select) não têm nó de texto: o invólucro claro ao redor deles escapava do tema escuro
// (ex.: caixa "Operando/Pausas" no topo). Aqui os invólucros também são escurecidos e o texto do campo é verificado.
const CAMPOS = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=hidden]),select,[role=combobox]';
const cacheImg = new Map(); // url -> 'claro' | 'escuro' | 'pendente'
// Mede se uma imagem de fundo é "clara e opaca" (um painel branco). Ícones transparentes ficam de fora.
function classificarImagem(url) {
  const v = cacheImg.get(url);
  if (v) return v;
  cacheImg.set(url, 'pendente');
  try {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0, 16, 16);
        const px = x.getImageData(0, 0, 16, 16).data;
        let opacos = 0, soma = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { opacos++; soma += luminancia([px[i], px[i + 1], px[i + 2]]); }
        cacheImg.set(url, opacos / 256 > 0.8 && soma / Math.max(1, opacos) > 0.55 ? 'claro' : 'escuro');
      } catch (_) { cacheImg.set(url, 'claro'); } // imagem de outra origem: não dá para medir, prioriza legibilidade
    };
    im.onerror = () => cacheImg.set(url, 'escuro');
    im.src = url;
  } catch (_) { cacheImg.set(url, 'claro'); }
  return 'pendente';
}

function gradienteClaro(img) {
  const cores = [...img.matchAll(/rgba?\(([^)]+)\)/g)].map(m => m[1].split(',').slice(0, 3).map(Number)).filter(c => c.length === 3 && c.every(n => !isNaN(n)));
  if (!cores.length) return false;
  return cores.reduce((s, c) => s + luminancia(c), 0) / cores.length > 0.55;
}

// Retorna 'pendente' enquanto a imagem ainda está sendo medida (o chamador tenta de novo no próximo ciclo).
function limparImagemClara(el, cs, bg) {
  // bg = cor de fundo ORIGINAL (lida antes de escurecer), senão a decisão olharia a cor já alterada
  if (SEM_FUNDO.has(el.tagName.toUpperCase()) || 'zeusRole' in el.dataset || 'zeusImg' in el.dataset || el.closest('[data-zeus-role]')) return;
  const img = cs.backgroundImage || '';
  if (!img || img === 'none') return;
  const r = el.getBoundingClientRect();
  if (r.height > 60 || r.width > 520 || r.height < 12 || r.width < 24) return; // só controles; ícones e painéis grandes ficam
  if (bg && bg.a >= 0.9 && luminancia(bg.rgb) < 0.4) return;
  let claro;
  if (img.includes('url(')) {
    const u = /url\((['"]?)(.*?)\1\)/.exec(img);
    if (!u) return;
    let abs;
    try { abs = new URL(u[2], el.ownerDocument.baseURI).href; } catch (_) { return; }
    const v = classificarImagem(abs);
    if (v === 'pendente') return 'pendente';
    claro = v === 'claro';
  } else claro = gradienteClaro(img);
  if (!claro) return;
  el.dataset.zeusImg = el.style.getPropertyValue('background-image') || '';
  el.style.setProperty('background-image', 'none', 'important');
  if (!bg || bg.a < 0.9) {
    el.dataset.zeusBg = el.style.getPropertyValue('background-color') || '';
    el.style.setProperty('background-color', '#2a313c', 'important');
  }
}
function processarCampos(win) {
  const d = win.document;
  d.querySelectorAll(CAMPOS).forEach(campo => {
    if (editavel(campo)) return;
    let a = campo;
    for (let i = 0; a && a !== d.body && i < 4; i++, a = a.parentElement) {
      if (vistosFundo.has(a)) continue;
      vistosFundo.add(a);
      const cs = win.getComputedStyle(a);
      if (theme === 'dark') {
        const bgOrig = 'zeusBg' in a.dataset ? { rgb: [255, 255, 255], a: 1 } : lerCor(cs.backgroundColor);
        escurecerFundo(a, cs);
        if (limparImagemClara(a, cs, bgOrig) === 'pendente') vistosFundo.delete(a);
      }
    }
    if (!vistosTexto.has(campo)) {
      const cs = win.getComputedStyle(campo);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') { vistosTexto.add(campo); ajustarTexto(campo, win); }
    }
  });
}

function garantirContrasteNoDoc(win) {
  let d;
  try { d = win.document; } catch (_) { return; }
  if (!d.body || d.designMode === 'on' || d.body.isContentEditable) return;
  modernizarBotoes(win);
  processarCampos(win);
  const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode, el = n.parentElement;
    if (!el || !n.nodeValue.trim() || IGNORAR.has(el.tagName) || vistosTexto.has(el) || editavel(el)) continue;
    let a = el, pendente = false;
    for (let i = 0; a && a !== d.body && i < 8; i++, a = a.parentElement) {
      if (vistosFundo.has(a)) continue;
      vistosFundo.add(a);
      const cs = win.getComputedStyle(a);
      marcarBalao(a, cs);
      if (theme === 'dark') {
        const bgOrig = 'zeusBg' in a.dataset ? { rgb: [255, 255, 255], a: 1 } : lerCor(cs.backgroundColor);
        escurecerFundo(a, cs);
        if (limparImagemClara(a, cs, bgOrig) === 'pendente') { vistosFundo.delete(a); pendente = true; }
      }
    }
    if (pendente) continue; // a imagem de fundo ainda está sendo medida: revisita no próximo ciclo
    vistosTexto.add(el);
    if (!el.closest('[data-zeus-role]')) ajustarTexto(el, win);
  }
}

function aplicarContraste() {
  if (document.hidden) return;
  for (const w of frames()) garantirContrasteNoDoc(w);
}

function resetarContraste() {
  vistosFundo = new WeakSet();
  vistosTexto = new WeakSet();
  vistosBotao = new WeakSet();
  for (const w of frames()) {
    try {
      w.document.querySelectorAll(ATTRS).forEach(el => {
        if ('zeusCt' in el.dataset) { el.style.removeProperty('color'); delete el.dataset.zeusCt; }
        if ('zeusBg' in el.dataset) {
          const antigo = el.dataset.zeusBg;
          if (antigo) el.style.setProperty('background-color', antigo); else el.style.removeProperty('background-color');
          delete el.dataset.zeusBg;
        }
        if ('zeusImg' in el.dataset) {
          const antigoImg = el.dataset.zeusImg;
          if (antigoImg) el.style.setProperty('background-image', antigoImg); else el.style.removeProperty('background-image');
          delete el.dataset.zeusImg;
        }
        delete el.dataset.zeusBalao; delete el.dataset.zeusFlat; delete el.dataset.zeusRole;
      });
    } catch (_) {}
  }
}

/* ================================================================
   INTERFACE (Shadow DOM) E ATALHOS
================================================================ */
const PANEL_CSS = "*{box-sizing:border-box}.launch{position:fixed;right:24px;bottom:24px;width:58px;height:58px;border:0;border-radius:50%;background:linear-gradient(135deg,#1e3a8a,#3976e8);color:white;font-size:25px;cursor:pointer;box-shadow:0 12px 32px #0f172a55;transition:.2s}.launch:hover{transform:translateY(-3px) scale(1.04)}.panel{position:fixed;right:24px;bottom:94px;width:390px;height:min(590px,calc(100vh - 125px));display:none;flex-direction:column;overflow:hidden;border:1px solid #cbd5e1;border-radius:17px;background:#f3f6fb;color:#243247;box-shadow:0 24px 70px #0f172a55;font:13px Segoe UI,Arial,sans-serif}.panel.open{display:flex;animation:pop .18s ease-out}@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:linear-gradient(120deg,#172d62,#315cc0);color:white}.brand{font-size:16px;font-weight:700}.sub{font-size:11px;opacity:.8;margin-top:3px}.close{border:0;border-radius:8px;padding:6px 9px;background:#ffffff22;color:white;cursor:pointer}.tabs{display:flex;gap:5px;padding:10px 12px 0;background:#e5ebf5}.tab{flex:1;border:0;border-radius:8px 8px 0 0;padding:10px 5px;background:transparent;color:#53647b;cursor:pointer;font-weight:600}.tab.active{background:#f3f6fb;color:#315cc0;box-shadow:inset 0 -2px #315cc0}.view{display:flex;flex:1;min-height:0;flex-direction:column;padding:12px}.search{padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;background:white;color:#243247;outline:none}.list{flex:1;min-height:0;overflow:auto;margin-top:9px;border:1px solid #d9e1ec;border-radius:10px;background:white}.macro{display:flex;align-items:center;gap:9px;padding:11px 12px;border-bottom:1px solid #edf1f6}.main{flex:1;cursor:pointer}.main b,.histrow b{display:block;color:#253650}.main small,.histrow small{display:block;margin-top:4px;color:#718096;font-size:11px}.macro:hover{background:#edf3ff}.fav{border:0;background:transparent;color:#d49b27;font-size:18px;cursor:pointer}.empty{padding:22px;text-align:center;color:#718096}.check{display:flex;gap:9px;padding:12px;border-bottom:1px solid #edf1f6;background:white}.check input{accent-color:#315cc0}.check.done span{text-decoration:line-through;color:#8290a3}.progress,.historyhead{font-size:12px;color:#60718a;margin-bottom:8px}.historyhead{display:flex;justify-content:space-between;align-items:center}.histrow{padding:11px 12px;border-bottom:1px solid #edf1f6;background:white}.histrow p{font-size:12px;color:#526178;white-space:pre-wrap;max-height:55px;overflow:hidden;margin:6px 0 0}.action{margin-top:9px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#334155;padding:8px 10px;cursor:pointer}.foot{padding:9px 12px;border-top:1px solid #d9e1ec;color:#718096;font-size:11px}.toast{position:fixed;right:24px;bottom:164px;max-width:340px;padding:11px 14px;border-radius:9px;background:#263449;color:white;box-shadow:0 8px 24px #0f172a44;opacity:0;transform:translateY(8px);pointer-events:none;transition:.2s;font:13px Segoe UI,Arial}.toast.show{opacity:1;transform:none}.toast[data-type=success]{background:#147a58}.toast[data-type=error]{background:#b93838}.toast[data-type=warn]{background:#986313}.setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;margin-bottom:9px;border:1px solid #d9e1ec;border-radius:10px;background:white}.setting b{display:block;color:#253650}.setting small{display:block;max-width:230px;margin-top:4px;color:#718096;line-height:1.4}.toolrow{display:flex;gap:6px;flex-wrap:wrap}.manager{flex:1}.managerrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px;border-bottom:1px solid #edf1f6}.managerinfo{min-width:0}.managerinfo b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#253650}.managerinfo small{color:#718096}.manageractions{display:flex;gap:5px}.action.primary{background:#315cc0;color:white;border-color:#315cc0}.action.danger{color:#b93838}.modalback{position:fixed;inset:0;background:#0b173b66;backdrop-filter:blur(3px);z-index:2}.editmodal{position:fixed;z-index:3;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 28px));max-height:85%;overflow:auto;padding:15px;border:1px solid #d9e1ec;border-radius:14px;background:#f7f9fc;box-shadow:0 24px 70px #0f172a55;color:#243247}.editmodal header,.editmodal footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.editmodal header b{font-size:15px}.editmodal header button{border:0;background:#e5ebf5;border-radius:7px;padding:6px 9px}.editmodal label{display:block;margin:10px 0;font-size:12px;font-weight:600;color:#526178}.editmodal input,.editmodal textarea{display:block;width:100%;margin-top:5px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#243247;font:13px Segoe UI,Arial;resize:vertical}.editmodal footer{justify-content:flex-end;margin:14px 0 0}.panel[data-theme=dark]{background:#202833;color:#d7e0ec;border-color:#3b4655}.panel[data-theme=dark] .tabs{background:#252f3c}.panel[data-theme=dark] .tab{color:#aebbd0}.panel[data-theme=dark] .tab.active{background:#303b49;color:#91b4ff;box-shadow:inset 0 -2px #668fff}.panel[data-theme=dark] .search,.panel[data-theme=dark] .list,.panel[data-theme=dark] .setting,.panel[data-theme=dark] .macro,.panel[data-theme=dark] .histrow,.panel[data-theme=dark] .check{background:#252f3b;border-color:#3b4655;color:#d7e0ec}.panel[data-theme=dark] .main b,.panel[data-theme=dark] .histrow b,.panel[data-theme=dark] .setting b,.panel[data-theme=dark] .managerinfo b{color:#e3ebf7}.panel[data-theme=dark] .main small,.panel[data-theme=dark] .histrow small,.panel[data-theme=dark] .setting small,.panel[data-theme=dark] .managerinfo small{color:#9baac0}.panel[data-theme=dark] .macro:hover{background:#303d4d}.panel[data-theme=dark] .action{background:#303b49;border-color:#4a586b;color:#dce6f5}.panel[data-theme=dark] .action.primary{background:#315cc0;color:white}.panel[data-theme=dark] .editmodal{background:#252f3b;color:#e3ebf7}.panel[data-theme=dark] .editmodal input,.panel[data-theme=dark] .editmodal textarea{background:#1b232d;color:#e3ebf7;border-color:#4a586b}.panel[data-theme=dark] .foot{border-color:#3b4655;color:#9baac0}@media(max-width:520px){.panel{left:10px;right:10px;width:auto;bottom:82px;height:calc(100vh - 100px)}.launch{right:16px;bottom:16px}}";
const WIKI_CSS = ".wiki-top{display:flex;flex-direction:column;gap:9px;flex:0 0 auto}.wiki-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.wiki-heading b{font-size:14px;color:#253650}.wiki-heading small{display:block;color:#718096;font-size:11px;margin-top:3px}.wiki-heading .action{margin:0;white-space:nowrap}.wiki-cats{display:flex;gap:6px;overflow:auto;padding:1px 0 4px}.wiki-chip{flex:0 0 auto;border:1px solid #d6dfeb;background:#fff;color:#53647b;border-radius:20px;padding:5px 10px;font-size:11px;cursor:pointer}.wiki-chip.active{background:#e8efff;border-color:#8eabef;color:#315cc0;font-weight:700}.wiki-list{margin-top:9px}.wiki-card{padding:12px;border-bottom:1px solid #edf1f6;cursor:pointer;background:#fff}.wiki-card:hover{background:#f2f6ff}.wiki-card h3{margin:6px 0;color:#253650;font-size:13px}.wiki-card p{margin:6px 0;color:#64748b;font-size:11px;line-height:1.45}.wiki-card small{color:#8794a8;font-size:10px}.wiki-category{display:inline-block;color:#315cc0;background:#eaf0ff;border-radius:5px;padding:3px 7px;font-size:10px;font-weight:700}.wiki-empty{text-align:center;padding:28px 18px;color:#718096}.wiki-empty div{font-size:30px}.wiki-empty b{color:#334155}.wiki-empty p{font-size:11px;line-height:1.5}.wiki-detail{overflow:auto;min-height:0}.wiki-back{border:0;background:transparent;color:#315cc0;font-weight:600;padding:4px 0 12px;cursor:pointer}.wiki-actions{float:right;display:flex;gap:5px}.wiki-detail h2{font-size:18px;line-height:1.3;color:#253650;margin:9px 0}.wiki-summary{color:#64748b;font-size:12px}.wiki-content{white-space:pre-wrap;overflow-wrap:anywhere;color:#34445c;font-size:13px;line-height:1.65;padding:12px 0}.wiki-tags{display:flex;gap:5px;flex-wrap:wrap}.wiki-tags span{background:#edf2f8;color:#64748b;border-radius:5px;padding:4px 7px;font-size:10px}.wiki-date{display:block;color:#94a3b8;margin-top:12px}.wiki-modal-back{position:fixed;inset:0;background:#0b173b77;backdrop-filter:blur(4px);z-index:20}.wiki-modal{position:fixed;z-index:21;left:50%;top:50%;transform:translate(-50%,-50%);width:min(510px,calc(100vw - 28px));max-height:88%;overflow:auto;padding:16px;border:1px solid #d9e1ec;border-radius:14px;background:#f7f9fc;color:#243247;box-shadow:0 24px 70px #0f172a66}.wiki-modal header,.wiki-modal footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.wiki-modal header b{display:block;font-size:15px}.wiki-modal header small{display:block;color:#718096;font-size:11px;margin-top:3px}.wiki-modal header button{border:0;background:#e5ebf5;border-radius:7px;padding:6px 9px}.wiki-modal label{display:block;margin:10px 0;color:#526178;font-size:11px;font-weight:700}.wiki-modal input,.wiki-modal textarea{display:block;width:100%;margin-top:5px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#243247;font:13px Segoe UI,Arial;resize:vertical}.wiki-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.wiki-modal footer{justify-content:flex-end;margin:14px 0 0}\n.panel[data-theme=dark] .wiki-heading b,.panel[data-theme=dark] .wiki-card h3,.panel[data-theme=dark] .wiki-detail h2,.panel[data-theme=dark] .wiki-empty b{color:#edf3fc}.panel[data-theme=dark] .wiki-heading small,.panel[data-theme=dark] .wiki-card p,.panel[data-theme=dark] .wiki-card small,.panel[data-theme=dark] .wiki-summary,.panel[data-theme=dark] .wiki-content,.panel[data-theme=dark] .wiki-date{color:#bdc9da}.panel[data-theme=dark] .wiki-chip,.panel[data-theme=dark] .wiki-card{background:#252f3b;border-color:#3b4655;color:#d7e0ec}.panel[data-theme=dark] .wiki-card:hover{background:#303d4d}.panel[data-theme=dark] .wiki-chip.active{background:#263e68;border-color:#5579c8;color:#d2e0ff}.panel[data-theme=dark] .wiki-category{background:#263e68;color:#d2e0ff}.panel[data-theme=dark] .wiki-tags span{background:#354254;color:#d0d9e7}.panel[data-theme=dark] .wiki-modal{background:#252f3b;color:#e3ebf7;border-color:#3b4655}.panel[data-theme=dark] .wiki-modal header small,.panel[data-theme=dark] .wiki-modal label{color:#c0ccdc}.panel[data-theme=dark] .wiki-modal input,.panel[data-theme=dark] .wiki-modal textarea{background:#1b232d;color:#f1f5f9;border-color:#4a586b}.panel[data-theme=dark] .wiki-modal header button{background:#354254;color:#f1f5f9}\n@media(max-width:520px){.wiki-grid{grid-template-columns:1fr}}";
const LAYOUT_CSS = [
  // Organização do painel: uma única rolagem nas Configurações, cartões que não se sobrepõem.
  '.panel{min-height:0}',
  '.view{overflow-y:auto;overflow-x:hidden}',
  '.view.settings{gap:0}',
  '.view.settings>*{flex:none}',
  '.view.settings .manager{flex:1 1 96px;min-height:96px;max-height:none;margin:0 0 9px}',
  '.view.settings .setting{margin-bottom:9px}',
  '.view.settings .setting small{max-width:none}',
  '.foot{flex:none;position:relative;background:inherit}',
  '.toast{bottom:100px;right:36px;max-width:330px}', // avisos ficam sobre o rodapé, sem cobrir o conteúdo
  '.wiki-detail{flex:1;min-height:0;overflow:auto}',
  '.wiki-list{flex:1;min-height:0}',
  '.manager,.managerrow{background:#fff}',
  '.panel[data-theme=dark] .manager,.panel[data-theme=dark] .managerrow{background:#252f3b;border-color:#3b4655}',
  '.panel[data-theme=dark] .action.danger{color:#ff9b9b}',
  '.panel[data-theme=dark] .fav{color:#e6b44a}',
  '.tab{font-size:12px;padding:10px 3px}',
  '.sum-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;margin-bottom:9px}.sum-top b{display:block;font-size:14px;color:#253650}.sum-top small{display:block;margin-top:3px;color:#718096;font-size:11px}.sum-top .action{margin:0;white-space:nowrap}',
  '.sum-body{flex:1;min-height:0;overflow:auto}.sum-card{padding:10px 12px;margin-bottom:8px;border:1px solid #d9e1ec;border-radius:10px;background:#fff}.sum-card h4{margin:0 0 6px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#315cc0}.sum-card ul{margin:0;padding-left:16px}.sum-card li{margin:3px 0;line-height:1.45;color:#34445c;overflow-wrap:anywhere}',
  '.sum-actions{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:4px}',
  '.sum-chk{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px;color:#526178;cursor:pointer}.sum-chk input{accent-color:#315cc0}',
  '.panel[data-theme=dark] .sum-chk{color:#c0ccdc}',
  '.sum-lbl{display:block;margin:6px 0;font-size:11px;font-weight:700;color:#526178}.sum-in{display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#243247;font:12px Segoe UI,Arial,sans-serif;resize:vertical}',
  '.panel[data-theme=dark] .sum-lbl{color:#c0ccdc}.panel[data-theme=dark] .sum-in{background:#1b232d;color:#f1f5f9;border-color:#4a586b}',
  '.sug-nota{font-size:11px;color:#718096;margin:-2px 0 7px}.sug{display:block;width:100%;text-align:left;margin:0 0 6px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#f7f9fc;color:#243247;cursor:pointer;font:inherit}.sug:hover{background:#e8efff;border-color:#8eabef}.sug b{display:block;font-size:12px;color:#315cc0}.sug span{display:block;margin-top:3px;font-size:12px;line-height:1.4;color:#475569;overflow-wrap:anywhere}',
  '.panel[data-theme=dark] .sug-nota{color:#bdc9da}.panel[data-theme=dark] .sug{background:#2d3948;border-color:#4a586b;color:#e3ebf7}.panel[data-theme=dark] .sug:hover{background:#34445a;border-color:#6d8fe0}.panel[data-theme=dark] .sug b{color:#a9c4ff}.panel[data-theme=dark] .sug span{color:#d0dae8}',
  '.panel[data-theme=dark] .sum-top b{color:#edf3fc}.panel[data-theme=dark] .sum-top small{color:#bdc9da}.panel[data-theme=dark] .sum-card{background:#252f3b;border-color:#3b4655}.panel[data-theme=dark] .sum-card h4{color:#91b4ff}.panel[data-theme=dark] .sum-card li{color:#d7e0ec}',
  '.panel[data-theme=dark] .empty{color:#9baac0}'
].join('\n');

function initUI() {
  host = document.createElement('div');
  host.id = 'zeus-interact-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;right:0;bottom:0;display:none';
  root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS + '\n' + WIKI_CSS + '\n' + LAYOUT_CSS;
  panel = document.createElement('section');
  panel.className = 'panel';
  panel.innerHTML = '<header class="head"><div><div class="brand">⚡ ZEUS Central</div><div class="sub">Produtividade no atendimento</div></div><button class="close" id="close">✕</button></header>' +
    '<nav class="tabs"><button class="tab active" data-tab="macros">Macros</button><button class="tab" data-tab="wiki">Mini Wiki</button><button class="tab" data-tab="resumo">Resumo</button><button class="tab" data-tab="settings">Configurações</button></nav>' +
    '<main class="view" id="view"></main>' +
    '<footer class="foot">Alt+Z abrir/fechar · Ctrl+Shift+M buscar · Esc fechar</footer>';
  toast = document.createElement('div');
  toast.className = 'toast';
  const launch = document.createElement('button');
  launch.className = 'launch';
  launch.textContent = '⚡';
  launch.title = 'Abrir Zeus (Alt+Z)';
  launch.addEventListener('click', () => toggle());
  panel.querySelector('#close').addEventListener('click', () => toggle(false));
  panel.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  root.append(style, launch, panel, toast);
  document.body.append(host);
  panel.dataset.theme = theme;
}

function atalho(e) {
  if (!emAtendimento()) return;
  const key = String(e.key || '').toLowerCase();
  const isZ = key === 'z' || e.code === 'KeyZ';
  const isM = key === 'm' || e.code === 'KeyM';
  if (e.altKey && isZ) {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); alternar();
  } else if (e.ctrlKey && e.shiftKey && isM) {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); tab = 'macros'; toggle(true);
    setTimeout(() => search?.focus(), 40);
  } else if (key === 'escape' && opened) {
    e.preventDefault(); toggle(false);
  }
}

function ligarAtalhosNosFrames() {
  for (const w of frames()) {
    if (ehTopo(w)) continue;
    try {
      const d = w.document;
      if (d && !d.__zeusTeclas) { d.addEventListener('keydown', atalho, true); d.__zeusTeclas = true; }
      if (d && !d.__zeusFora) { d.addEventListener('pointerdown', cliqueFora, true); d.__zeusFora = true; }
    } catch (_) {}
  }
}

// Mostra o painel apenas na tela de atendimento (nunca no login).
function sincronizarVisibilidade() {
  const ok = emAtendimento();
  const alvo = ok ? 'block' : 'none';
  if (host.style.display !== alvo) host.style.display = alvo;
  if (!ok && opened) toggle(false);
}

function manutencao() {
  sincronizarVisibilidade();
  ligarAtalhosNosFrames();
  applyPageTheme();
  aplicarContraste();
}

async function start() {
  await defaults();
  if (!document.body) return;
  initUI();
  document.addEventListener('keydown', atalho, true);
  window.addEventListener('keydown', atalho, true);
  document.addEventListener('pointerdown', cliqueFora, true);
  let t = null;
  const agendar = () => { clearTimeout(t); t = setTimeout(manutencao, 200); };
  new MutationObserver(agendar).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(manutencao, 1500); // mudanças dentro dos frames (novas mensagens) não disparam o observer do topo
  manutencao();
  // Atalho registrado no navegador (manifest.commands): funciona mesmo com o foco dentro de um frame do Interact.
  try {
    api?.onMessage?.addListener(msg => {
      if (msg && msg.type === 'zeus-toggle' && emAtendimento()) alternar();
    });
  } catch (_) {}
  console.info('[Zeus] Central carregada');
}
start();
})();
