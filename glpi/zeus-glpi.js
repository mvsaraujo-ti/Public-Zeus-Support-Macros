/**
 * Zeus Central — GLPI (formulário "Registre sua Requisição")
 *
 * Preenche o formulário com o rascunho que o usuário preparou no Zeus (aba Resumo → "Abrir no GLPI e preencher").
 *  - Só age quando existe um rascunho recente (até 30 min) guardado localmente pela extensão; depois de usar, apaga.
 *  - Preenche somente: título, descrição e telefone.
 *  - NÃO usa a busca do Sentinela, NÃO escolhe requerente, NÃO marca "atribuir para mim" e NÃO clica em Enviar.
 *  - Nada é enviado para fora do navegador.
 */
(() => {
'use strict';
if (window.__ZEUS_GLPI__) return;
window.__ZEUS_GLPI__ = true;

const CHAVE = 'zeus_glpi_pendente', VALIDADE = 30 * 60 * 1000, LIMITE = 25000;
const arm = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local;
if (!arm) return;

const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setValor(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// acha o campo pelo texto do rótulo (não depende de ids que mudam)
function porRotulo(re) {
  // formulário nativo do GLPI: cada pergunta é um bloco [data-glpi-form-renderer-question] com o título num <h3>
  const sel0 = 'input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=file]), textarea, select';
  for (const b of document.querySelectorAll('[data-glpi-form-renderer-question]')) {
    const tit = b.querySelector('h1, h2, h3, h4, h5, h6, label, legend');
    if (!tit || !re.test(norm(tit.textContent))) continue;
    const el = b.querySelector(sel0);
    if (el || b.querySelector('iframe')) return { el, raiz: b };
  }
  for (const l of document.querySelectorAll('label, legend, .form-label')) {
    if (!re.test(norm(l.textContent))) continue;
    const sel = 'input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=file]), textarea, select';
    if (l.htmlFor) { const el = document.getElementById(l.htmlFor); if (el) return { el, raiz: l.parentElement }; }
    let raiz = l.parentElement;
    for (let i = 0; i < 4 && raiz; i++, raiz = raiz.parentElement) {
      const el = raiz.querySelector(sel);
      if (el || raiz.querySelector('iframe')) return { el, raiz };
    }
  }
  return null;
}

function preencherEditor(raiz, texto) {
  const ifr = raiz.querySelector('iframe.tox-edit-area__iframe, iframe[id$="_ifr"], iframe');
  const body = ifr && ifr.contentDocument && ifr.contentDocument.body;
  if (!body || !(body.classList.contains('mce-content-body') || body.isContentEditable)) return false; // editor ainda não iniciou
  const html = texto.split('\n').map(l => l ? '<p>' + esc(l) + '</p>' : '<p><br></p>').join('');
  body.innerHTML = html;
  try { body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); } catch (_) {}
  try { body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' })); } catch (_) {}
  const ta = raiz.querySelector('textarea');
  if (ta) setValor(ta, html);
  return true;
}

function aviso(linhas, tipo) {
  const d = document.createElement('div');
  d.setAttribute('data-zeus-glpi', '');
  d.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:360px;padding:12px 14px;border-radius:10px;color:#fff;font:13px/1.45 Segoe UI,Arial,sans-serif;box-shadow:0 10px 30px #0006;background:' + (tipo === 'warn' ? '#986313' : '#147a58');
  d.textContent = linhas.join('\n');
  d.style.whiteSpace = 'pre-line';
  d.addEventListener('click', () => d.remove());
  document.body.append(d);
  setTimeout(() => d.remove(), 14000);
}

(async () => {
  let dados;
  try { dados = (await arm.get(CHAVE))[CHAVE]; } catch (_) { return; }
  if (!dados) return;
  if (!dados.criadoEm || Date.now() - dados.criadoEm > VALIDADE) { try { await arm.remove(CHAVE); } catch (_) {} return; }

  const feito = {};
  const t0 = Date.now();
  const passo = async () => {
    // título, telefone e descrição (o requerente e o envio ficam com você)
    if (!feito.titulo && dados.titulo) {
      const c = porRotulo(/^titulo\b/);
      if (c && c.el && c.el.tagName !== 'SELECT') { setValor(c.el, String(dados.titulo).slice(0, 250)); feito.titulo = true; }
    }
    if (!feito.telefone && dados.telefone) {
      const c = porRotulo(/telefone para contato/);
      if (c && c.el) { setValor(c.el, dados.telefone); feito.telefone = true; }
    }
    if (!feito.descricao && dados.descricao) {
      const c = porRotulo(/^descricao/);
      if (c && c.raiz && preencherEditor(c.raiz, String(dados.descricao).slice(0, LIMITE))) feito.descricao = true;
    }
  };

  const esperados = ['titulo', 'descricao'].concat(dados.telefone ? ['telefone'] : []);
  const timer = setInterval(async () => {
    try { await passo(); } catch (_) {}
    const tudo = esperados.every(k => feito[k]);
    if (!tudo && Date.now() - t0 < 25000) return;
    clearInterval(timer);
    try { await arm.remove(CHAVE); } catch (_) {} // uso único
    const nomes = { titulo: 'título', descricao: 'descrição', telefone: 'telefone', matricula: 'matrícula (busca no Sentinela)' };
    const ok = esperados.filter(k => feito[k]).map(k => nomes[k]), falta = esperados.filter(k => !feito[k]).map(k => nomes[k]);
    const linhas = ['Zeus preencheu: ' + (ok.join(', ') || 'nada') + '.'];
    if (falta.length) linhas.push('Não achei: ' + falta.join(', ') + '. Preencha à mão.');
    linhas.push('Escolha o requerente, revise e envie. O Zeus não envia nada.');
    aviso(linhas, falta.length ? 'warn' : 'ok');
  }, 500);
})();
})();
