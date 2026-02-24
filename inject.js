(function () {
  'use strict';

  if (document.getElementById('interact-floating-btn')) return;

  const STORAGE_KEY = 'zeus_macros';
  let MACROS = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

  const save = () =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MACROS));

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
      success: '#10b981',
      error: '#ef4444',
      info: '#3b82f6'
    };

    const t = document.createElement('div');
    t.className = 'zeus-toast';
    t.style.background = colors[type];
    t.textContent = msg;
    document.body.appendChild(t);

    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => t.remove(), 2000);
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
     STYLES
  ===================== */
  function injectStyles() {
    if (document.getElementById('zeus-style')) return;

    const s = document.createElement('style');
    s.id = 'zeus-style';
    s.textContent = `
      * { box-sizing: border-box; }

      #zeus-panel {
        position: fixed;
        bottom: 90px;
        right: 24px;
        width: 380px;
        height: 500px;
        background: rgba(255,255,255,.97);
        backdrop-filter: blur(12px);
        border-radius: 18px;
        box-shadow: 0 25px 60px rgba(0,0,0,.35);
        font-family: 'Segoe UI', sans-serif;
        display: none;
        flex-direction: column;
        overflow: hidden;
        z-index: 999999;
        animation: fadeIn .2s ease-out;
      }

      #zeus-header {
        background: linear-gradient(135deg,#1e3a8a,#2563eb);
        color:#fff;
        padding:14px;
        display:flex;
        justify-content:space-between;
        align-items:center;
      }

      #zeus-body {
        display:flex;
        flex-direction:column;
        flex:1;
        min-height:0;
        padding:14px;
      }

      #zeus-list {
        flex:1;
        min-height:0;
        overflow-y:auto;
        margin-top:8px;
        border-radius:12px;
        background:#fff;
        border:1px solid #e5e7eb;
      }

      .macro-row {
        padding:12px;
        border-bottom:1px solid #f1f1f1;
        cursor:pointer;
        display:flex;
        justify-content:space-between;
        align-items:center;
        transition:background .2s;
      }

      .macro-row:hover { background:#f3f4f6; }

      .macro-row.pinned { background:#fff7ed; }

      .pin { cursor:pointer; font-size:16px; }

      button {
        border:none;
        border-radius:10px;
        padding:7px 10px;
        cursor:pointer;
        font-size:12px;
        transition:.2s;
      }

      .btn-soft { background:#eef2ff; }
      .btn-soft:hover { background:#e0e7ff; }

      .btn-primary {
        background:#2563eb;
        color:#fff;
      }
      .btn-primary:hover { background:#1e40af; }

      .zeus-toast {
        position:fixed;
        bottom:100px;
        right:24px;
        color:#fff;
        padding:10px 14px;
        border-radius:8px;
        font-size:13px;
        opacity:0;
        transform:translateY(10px);
        transition:.2s;
        z-index:9999999;
      }

      .zeus-toast.show {
        opacity:1;
        transform:translateY(0);
      }

      .zeus-overlay {
        position:fixed;
        inset:0;
        background:rgba(0,0,0,.45);
        backdrop-filter:blur(2px);
        z-index:1000000;
        animation:fadeIn .15s ease;
      }

      .zeus-modal {
        position:fixed;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%) scale(.98);
        width:540px;
        max-height:80vh;
        background:#fff;
        border-radius:18px;
        box-shadow:0 30px 70px rgba(0,0,0,.45);
        display:flex;
        flex-direction:column;
        overflow:hidden;
        z-index:1000001;
        animation:modalIn .2s ease forwards;
      }

      @keyframes fadeIn {
        from { opacity:0 }
        to { opacity:1 }
      }

      @keyframes modalIn {
        to { transform:translate(-50%,-50%) scale(1); }
      }
    `;
    document.head.appendChild(s);
  }

  /* =====================
     STATE
  ===================== */
  let panel, list, searchI, filterI;
  let manageModal = null;
  let overlay = null;
  let opened = false;

  function orderedMacros() {
    return [...MACROS].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned - a.pinned;
      if (a.cat !== b.cat) return a.cat.localeCompare(b.cat);
      return a.title.localeCompare(b.title);
    });
  }

  function render() {
    const q = searchI.value.toLowerCase();
    const cat = filterI.value;
    list.innerHTML = '';

    const cats = [...new Set(MACROS.map(m => m.cat))];
    filterI.innerHTML =
      `<option value="">Todas</option>` +
      cats.map(c => `<option ${c === cat ? 'selected' : ''}>${c}</option>`).join('');

    orderedMacros()
      .filter(m =>
        (!cat || m.cat === cat) &&
        (m.title + m.text).toLowerCase().includes(q)
      )
      .forEach(m => {
        const row = document.createElement('div');
        row.className = `macro-row ${m.pinned ? 'pinned' : ''}`;

        const left = document.createElement('div');
        left.innerHTML = `<strong>${m.title}</strong><br><small>${m.cat}</small>`;

        const pin = document.createElement('span');
        pin.className = 'pin';
        pin.textContent = m.pinned ? '📌' : '📍';

        pin.onclick = (e) => {
          e.stopPropagation();
          m.pinned = !m.pinned;
          save();
          render();
        };

        row.appendChild(left);
        row.appendChild(pin);

        row.onclick = () =>
          navigator.clipboard.writeText(applyVars(m.text))
            .then(() => toast('Macro copiada', 'success'));

        list.appendChild(row);
      });
  }

  /* =====================
     GERENCIADOR
  ===================== */
  function openManager() {
    if (manageModal) return;

    overlay = document.createElement('div');
    overlay.className = 'zeus-overlay';
    overlay.onclick = closeManager;

    manageModal = document.createElement('div');
    manageModal.className = 'zeus-modal';

    manageModal.innerHTML = `
      <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);
                  color:#fff;padding:14px;
                  display:flex;justify-content:space-between;">
        <strong>Gerenciar macros</strong>
        <span id="closeManage" style="cursor:pointer">✕</span>
      </div>
      <div id="manage-list" style="flex:1;overflow:auto;"></div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(manageModal);

    manageModal.querySelector('#closeManage').onclick = closeManager;

    renderManager();
  }

  function closeManager() {
    if (manageModal) manageModal.remove();
    if (overlay) overlay.remove();
    manageModal = null;
    overlay = null;
  }

  function renderManager() {
    const ml = manageModal.querySelector('#manage-list');
    ml.innerHTML = '';

    orderedMacros().forEach(m => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.padding = '12px';
      row.style.borderBottom = '1px solid #eee';

      row.innerHTML = `
        <div>
          <strong>${m.title}</strong><br>
          <small>${m.cat}</small>
        </div>
        <div>
          <button class="btn-soft">✏️</button>
          <button class="btn-soft">🗑️</button>
        </div>
      `;

      row.querySelector('button:nth-child(1)').onclick =
        () => openEditor(m);

      row.querySelector('button:nth-child(2)').onclick = () => {
        if (!confirm('Remover macro?')) return;
        MACROS = MACROS.filter(x => x.id !== m.id);
        save();
        render();
        renderManager();
      };

      ml.appendChild(row);
    });
  }

  /* =====================
     EDITOR
  ===================== */
  function openEditor(m = null) {
    closeManager();

    const overlayEd = document.createElement('div');
    overlayEd.className = 'zeus-overlay';

    const modal = document.createElement('div');
    modal.className = 'zeus-modal';

    modal.innerHTML = `
      <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);
                  color:#fff;padding:14px;">
        <strong>${m ? 'Editar macro' : 'Nova macro'}</strong>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:8px;">
        <input id="etitle" placeholder="Título">
        <input id="ecat" placeholder="Categoria">
        <textarea id="etext" style="height:150px"></textarea>
        <div style="text-align:right;margin-top:8px;">
          <button class="btn-soft" id="cancelEd">Cancelar</button>
          <button class="btn-primary" id="saveEd">Salvar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEd);
    document.body.appendChild(modal);

    if (m) {
      modal.querySelector('#etitle').value = m.title;
      modal.querySelector('#ecat').value = m.cat;
      modal.querySelector('#etext').value = m.text;
    }

    modal.querySelector('#cancelEd').onclick = () => {
      overlayEd.remove();
      modal.remove();
    };

    modal.querySelector('#saveEd').onclick = () => {
      if (m) {
        m.title = modal.querySelector('#etitle').value;
        m.cat = modal.querySelector('#ecat').value;
        m.text = modal.querySelector('#etext').value;
      } else {
        MACROS.push({
          id: Date.now(),
          title: modal.querySelector('#etitle').value,
          cat: modal.querySelector('#ecat').value,
          text: modal.querySelector('#etext').value,
          pinned: false
        });
      }

      save();
      render();
      overlayEd.remove();
      modal.remove();
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
      if (!i.files.length) return;

      downloadJSON(MACROS, `zeus-backup-${today()}.json`);

      const r = new FileReader();
      r.onload = () => {
        MACROS = JSON.parse(r.result);
        save();
        render();
        toast('Macros importadas', 'success');
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
     PANEL
  ===================== */
  function createPanel() {
    if (panel) return;

    injectStyles();

    panel = document.createElement('div');
    panel.id = 'zeus-panel';

    panel.innerHTML = `
      <div id="zeus-header">
        <strong>⚡ Zeus Macros</strong>
        <span id="close-zeus" style="cursor:pointer">✕</span>
      </div>

      <div id="zeus-body">
        <input id="search" placeholder="Buscar macro...">
        <select id="filter" style="margin-top:6px"></select>
        <div id="zeus-list"></div>

        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn-soft" id="manage">Gerenciar</button>
          <button class="btn-soft" id="import">Importar</button>
          <button class="btn-soft" id="export">Exportar</button>
        </div>

        <button class="btn-primary" id="add" style="margin-top:8px">
          + Nova macro
        </button>
      </div>
    `;

    document.body.appendChild(panel);

    list = panel.querySelector('#zeus-list');
    searchI = panel.querySelector('#search');
    filterI = panel.querySelector('#filter');

    searchI.oninput = render;
    filterI.onchange = render;

    panel.querySelector('#close-zeus').onclick =
      () => panel.style.display = 'none';

    panel.querySelector('#manage').onclick = openManager;
    panel.querySelector('#import').onclick = importJSON;
    panel.querySelector('#export').onclick = exportJSON;
    panel.querySelector('#add').onclick = () => openEditor();

    render();
  }

  function togglePanel() {
    createPanel();
    opened = !opened;
    panel.style.display = opened ? 'flex' : 'none';
  }

  /* =====================
     FLOAT BUTTON
  ===================== */
  const btn = document.createElement('div');
  btn.id = 'interact-floating-btn';
  btn.textContent = '⚡';
  Object.assign(btn.style, {
    position:'fixed',
    bottom:'24px',
    right:'24px',
    width:'58px',
    height:'58px',
    borderRadius:'50%',
    background:'linear-gradient(135deg,#1e3a8a,#2563eb)',
    color:'#fff',
    display:'flex',
    alignItems:'center',
    justifyContent:'center',
    fontSize:'22px',
    cursor:'pointer',
    boxShadow:'0 15px 40px rgba(0,0,0,.4)',
    zIndex:999999
  });

  btn.onclick = togglePanel;
  document.body.appendChild(btn);

})();
