/**
 * manager.js
 * Responsável pelo gerenciamento das macros.
 */

import { saveMacros } from '../core/storage.js';
import { openEditor } from './editor.js';

export function openManager(macros, onUpdate) {
  const modal = document.createElement('div');

  Object.assign(modal.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%,-50%)',
    width: '500px',
    maxHeight: '70vh',
    overflow: 'auto',
    background: '#FFFFFF',
    borderRadius: '14px',
    boxShadow: '0 20px 60px rgba(0,0,0,.3)',
    padding: '20px',
    zIndex: 1000000
  });

  function render() {
    modal.innerHTML = `<h3>Gerenciar Macros</h3>`;

    macros.forEach(m => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.marginBottom = '10px';

      row.innerHTML = `
        <span>${m.title}</span>
        <div>
          <button class="btn-soft">Editar</button>
          <button class="btn-soft">Excluir</button>
        </div>
      `;

      row.querySelector('button:nth-child(1)').onclick = () => {
        openEditor(macros, onUpdate, m);
      };

      row.querySelector('button:nth-child(2)').onclick = () => {
        const index = macros.findIndex(x => x.id === m.id);
        macros.splice(index, 1);
        saveMacros(macros);
        render();
        onUpdate();
      };

      modal.appendChild(row);
    });
  }

  render();
  document.body.appendChild(modal);
}
