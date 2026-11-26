// Zeus Central — service worker
// Recebe o atalho registrado no navegador (Alt+Z por padrão) e avisa a aba ativa.
// Isso funciona mesmo quando o foco está dentro de um frame do Interact.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-zeus') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'zeus-toggle' });
  } catch (_) { /* aba sem o Zeus (outra página): ignora */ }
});
