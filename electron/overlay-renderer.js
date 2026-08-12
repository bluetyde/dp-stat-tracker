// Overlay window renderer. Plain script (no ES module, no Node access) —
// receives already-computed scoreboard data over IPC via preload.js's
// window.overlayAPI; never touches fs or parses anything itself. Team
// rendering itself lives in scoreboard-view.js, shared with the Hub's
// match-detail view.

const teamsEl = document.getElementById('teams');
const emptyEl = document.getElementById('empty');
const mapLabelEl = document.getElementById('mapLabel');
const roundLabelEl = document.getElementById('roundLabel');
const hotkeyHintEl = document.getElementById('hotkeyHint');

function formatHotkeyDisplay(hk) {
  if (!hk) return 'Ctrl+Shift+Y';
  return hk
    .replace(/CommandOrControl/i, 'Ctrl')
    .replace(/Control/i, 'Ctrl');
}

function render(data) {
  if (data && data.overlayHotkey && hotkeyHintEl) {
    hotkeyHintEl.textContent = `${formatHotkeyDisplay(data.overlayHotkey)} to hide`;
  }

  if (!data || !data.teams || (data.teams[0].length === 0 && data.teams[1].length === 0)) {
    teamsEl.hidden = true;
    emptyEl.hidden = false;
    mapLabelEl.textContent = '';
    roundLabelEl.textContent = '';
    return;
  }

  teamsEl.hidden = false;
  emptyEl.hidden = true;
  renderScoreboardTeams(teamsEl, data);

  mapLabelEl.textContent = data.currentMap ?? '';
  const roundText = `Round ${data.roundCount}${data.status === 'in-progress' ? ' · Live' : ' · Final'}`;
  roundLabelEl.textContent = roundText;
}

window.overlayAPI.onUpdate(render);
