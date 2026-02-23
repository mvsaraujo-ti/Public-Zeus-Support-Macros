(function () {
  'use strict';

  if (document.getElementById('interact-floating-btn')) return;

  const STORAGE_KEY = 'zeus_macros';
  const LAST_BACKUP_KEY = 'zeus_last_backup';

  let MACROS = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

  const save = () =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MACROS));

  /* =====================
     UTIL
  ===================== */
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function applyVars(text) {
    const d = new Date();
    return text
      .replace(/{{data}}/g, d.toLocaleDateString())
      .replace(/{{hora}}/g, d.toLocaleTimeString().slice(0, 5));
  }

  function toast(msg, type = 'info') {
    const colors = {
      success: '#16a34a',
      error: '#dc2626',
      info: '#2563eb'
    };

    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '100px',
      right: '24px',
      background: colors[type],
      color: '#fff',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '12px',
      zIndex: 999999
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* =====================
     BACKUP DIÁRIO
  ===================== */
  function dailyBackup() {
    const last = localStorage.getItem(LAST_BACKUP_KEY);
    if (last === today()) return;

    downloadJSON(MACROS, `zeus-backup-${today()}.json`);
    localStorage.setItem(LAST_BACKUP_KEY, today());
  }

  dailyBackup();

  /* =====================
     STATE
  ===================== */
  let panel, list, searchI, filterI;
  let editorPopup = null;
  let managePopup = null;
  let opened = false;

  /* =====================
     ORDERING
  ===================== */
  function orderedMacros() {
    return [...MACROS].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned - a.pinned;
      if (a.cat !== b.cat) return a.cat.localeCompare(b.cat);
      return a.title.localeCompare(b.title);
    });
  }

  /* =====================
     PANEL
  ===================== */
  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      bottom: '90px',
      right: '24px',
      width: '340px',
      height: '430px',
      background: '#f4f6f9',
      borderRadius: '12px',
      boxShadow: '0 18px 40px rgba(0,0,0,.35)',
      fontFamily: 'Arial',
      zIndex: 999999,
      display: 'none'
    });

    panel.innerHTML = `
      <div style="background:#2563eb;color:#fff;padding:10px;
                  border-radius:12px 12px 0 0;
                  display:flex;justify-content:space-between">
        <strong>Zeus Macros</strong>
        <span id="close" style="cursor:pointer">✕</span>
      </div>

      <div style="padding:10px;height:calc(100% - 48px);
                  display:flex;flex-direction:column">
        <input id="search" placeholder="Buscar macro…" style="margin-bottom:6px">
        <select id="filter" style="margin-bottom:6px"></select>

        <div id="list" style="flex:1;overflow:auto;background:#fff;
                              border-radius:8px;border:1px solid #e5e7eb"></div>

        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn-soft" id="manage">⚙ Gerenciar</button>
          <button class="btn-soft" id="import">⬆ Importar</button>
          <button class="btn-soft" id="export">⬇ Exportar</button>
        </div>

        <button class="btn-primary" id="add" style="margin-top:8px">
          + Nova macro
        </button>
      </div>
    `;

    document.body.appendChild(panel);
    injectStyles();
    bindPanel();
    render();
  }

  function injectStyles() {
    if (document.getElementById('zeus-style')) return;
    const s = document.createElement('style');
    s.id = 'zeus-style';
    s.textContent = `
      * { box-sizing:border-box; }
      .btn-soft { background:#eef2ff;border:1px solid #c7d2fe;
                  border-radius:6px;padding:6px;font-size:12px;cursor:pointer; }
      .btn-primary { background:#2563eb;color:#fff;border:none;
                     border-radius:8px;padding:8px;cursor:pointer; }
      .macro-row.pinned { background:#fff7ed; }
      .pin { cursor:pointer; margin-right:6px; }
    `;
    document.head.appendChild(s);
  }

  /* =====================
     RENDER
  ===================== */
  function render() {
    const q = searchI.value.toLowerCase();
    const cat = filterI.value;

    list.innerHTML = '';
    const cats = [...new Set(MACROS.map(m => m.cat))];
    filterI.innerHTML = `<option value="">Todas</option>` +
      cats.map(c => `<option ${c === cat ? 'selected' : ''}>${c}</option>`).join('');

    orderedMacros()
      .filter(m =>
        (!cat || m.cat === cat) &&
        (m.title + m.text).toLowerCase().includes(q)
      )
      .forEach(m => {
        const d = document.createElement('div');
        d.className = `macro-row ${m.pinned ? 'pinned' : ''}`;
        d.style.padding = '8px';
        d.style.borderBottom = '1px solid #eee';

        d.innerHTML = `
          <span class="pin">${m.pinned ? '📌' : '📍'}</span>
          <strong>${m.title}</strong><br>
          <small>${m.cat}</small>
        `;

        d.querySelector('.pin').onclick = e => {
          e.stopPropagation();
          m.pinned = !m.pinned;
          save();
          render();
        };

        d.onclick = () =>
          navigator.clipboard.writeText(applyVars(m.text))
            .then(() => toast('Resposta copiada', 'success'));

        list.appendChild(d);
      });
  }

  /* =====================
     GERENCIADOR
  ===================== */
  function openManager() {
    if (managePopup) return;

    managePopup = document.createElement('div');
    Object.assign(managePopup.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%,-50%)',
      width: '520px',
      maxHeight: '80vh',
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 20px 50px rgba(0,0,0,.4)',
      zIndex: 1000001,
      overflow: 'auto'
    });

    managePopup.innerHTML = `
      <div style="background:#2563eb;color:#fff;padding:12px;
                  display:flex;justify-content:space-between">
        <strong>Gerenciar macros</strong>
        <span id="closeManage" style="cursor:pointer">✕</span>
      </div>
      <div id="manage-list"></div>
    `;

    managePopup.querySelector('#closeManage').onclick = () => {
      managePopup.remove();
      managePopup = null;
    };

    document.body.appendChild(managePopup);
    renderManager();
  }

  function renderManager() {
    const ml = managePopup.querySelector('#manage-list');
    ml.innerHTML = '';

    orderedMacros().forEach(m => {
      const r = document.createElement('div');
      r.style.display = 'flex';
      r.style.justifyContent = 'space-between';
      r.style.padding = '8px';
      r.style.borderBottom = '1px solid #eee';

      r.innerHTML = `
        <div>
          <span class="pin">${m.pinned ? '📌' : '📍'}</span>
          <strong>${m.title}</strong><br>
          <small>${m.cat}</small>
        </div>
        <div>
          <button>✏️</button>
          <button>🗑️</button>
        </div>
      `;

      r.querySelector('.pin').onclick = () => {
        m.pinned = !m.pinned;
        save();
        render();
        renderManager();
      };

      r.querySelector('button:nth-child(1)').onclick = () => openEditor(m);

      r.querySelector('button:nth-child(2)').onclick = () => {
        if (!confirm('Remover macro?')) return;
        MACROS = MACROS.filter(x => x.id !== m.id);
        save();
        render();
        renderManager();
      };

      ml.appendChild(r);
    });
  }

  /* =====================
     EDITOR
  ===================== */
  function openEditor(m = null) {
    if (editorPopup) editorPopup.remove();

    editorPopup = document.createElement('div');
    Object.assign(editorPopup.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%,-50%)',
      width: '520px',
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 20px 50px rgba(0,0,0,.4)',
      zIndex: 1000002
    });

    editorPopup.innerHTML = `
      <div style="background:#2563eb;color:#fff;padding:12px">
        <strong>${m ? 'Editar macro' : 'Nova macro'}</strong>
      </div>
      <div style="padding:14px">
        <label>Título</label><input id="etitle" style="width:100%">
        <label>Categoria</label><input id="ecat" style="width:100%">
        <label>Texto</label>
        <textarea id="etext" style="width:100%;height:160px"></textarea>
        <div style="margin-top:10px;text-align:right">
          <button id="closeEd">Fechar</button>
          <button id="saveEd">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(editorPopup);

    if (m) {
      editorPopup.querySelector('#etitle').value = m.title;
      editorPopup.querySelector('#ecat').value = m.cat;
      editorPopup.querySelector('#etext').value = m.text;
    }

    editorPopup.querySelector('#closeEd').onclick = () => editorPopup.remove();
    editorPopup.querySelector('#saveEd').onclick = () => {
      if (m) {
        m.title = editorPopup.querySelector('#etitle').value;
        m.cat = editorPopup.querySelector('#ecat').value;
        m.text = editorPopup.querySelector('#etext').value;
      } else {
        MACROS.push({
          id: Date.now(),
          title: editorPopup.querySelector('#etitle').value,
          cat: editorPopup.querySelector('#ecat').value,
          text: editorPopup.querySelector('#etext').value,
          pinned: false
        });
      }
      save();
      render();
      if (managePopup) renderManager();
      editorPopup.remove();
    };
  }

  /* =====================
     IMPORT / EXPORT
  ===================== */
  function importJSON() {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.json';
    i.onchange = () => {
      const r = new FileReader();
      r.onload = () => {
        MACROS = JSON.parse(r.result);
        save();
        render();
      };
      r.readAsText(i.files[0]);
    };
    i.click();
  }

  function exportJSON() {
    downloadJSON(MACROS, `zeus-macros-${today()}.json`);
    toast('Macros exportadas', 'success');
  }

  /* =====================
     BIND
  ===================== */
  function bindPanel() {
    list = panel.querySelector('#list');
    searchI = panel.querySelector('#search');
    filterI = panel.querySelector('#filter');

    panel.querySelector('#add').onclick = () => openEditor();
    panel.querySelector('#manage').onclick = openManager;
    panel.querySelector('#import').onclick = importJSON;
    panel.querySelector('#export').onclick = exportJSON;
    panel.querySelector('#close').onclick = () => panel.style.display = 'none';

    searchI.oninput = render;
    filterI.onchange = render;
  }

  function togglePanel() {
    createPanel();
    opened = !opened;
    panel.style.display = opened ? 'block' : 'none';
  }

  /* =====================
     FLOAT BUTTON
  ===================== */
  const btn = document.createElement('div');
  btn.id = 'interact-floating-btn';
  btn.textContent = '💬';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '52px',
    height: '52px',
    borderRadius: '50%',
    background: '#2563eb',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    cursor: 'pointer',
    zIndex: 999999
  });
  btn.onclick = togglePanel;
  document.body.appendChild(btn);

})();
