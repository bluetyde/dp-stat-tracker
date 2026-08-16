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

// The Hub owns the only toggle UI; this window just stays in sync with
// whatever it last set (see main.js's 'theme:set' broadcast). Initial value
// is already applied by the inline <script> in <head>, before this file
// even loads — this only handles a LATER change while the overlay is open.
window.themeAPI.onChange((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
});

// Player click-through to the Hub's Player Quick Reference modal. Delegated
// on the container (attached once) rather than per-row like hub-renderer.js's
// attachPlayerClickHandlers, since render() above rebuilds `.player-row`
// elements on every parser update (sub-second cadence during a live match) —
// delegation means new rows are covered automatically without re-attaching
// listeners on every render. Each row already carries data-account-id from
// scoreboard-view.js.
teamsEl.addEventListener('click', (e) => {
  const row = e.target.closest('.player-row');
  if (!row || !row.dataset.accountId) return;
  window.overlayAPI.openPlayerDetail(row.dataset.accountId);
});
