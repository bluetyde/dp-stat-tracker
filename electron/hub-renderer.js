// Hub window renderer. Plain script (no ES module, no Node access) —
// receives already-computed lifetime stats over IPC via preload.js's
// window.hubAPI; never touches fs or the archives directly.

const playerNameEl = document.getElementById('playerName');
const appVersionLabelEl = document.getElementById('appVersionLabel');
const playerAvatarEl = document.getElementById('playerAvatar');
const playerRatingBadgeEl = document.getElementById('playerRatingBadge');
const playerRatingEl = document.getElementById('playerRating');
const emptyHubEl = document.getElementById('emptyHub');
const statGridEl = document.getElementById('statGrid');
const detailColsEl = document.getElementById('detailCols');
const recentMatchesBody = document.getElementById('recentMatchesBody');
const topWeaponsEl = document.getElementById('topWeapons');
const sparklineEl = document.getElementById('sparkline');
const sparklineAvgEl = document.getElementById('sparklineAvg');

// Pit Tracker DOM Elements
const pitHeaderBadgeEl = document.getElementById('pitHeaderBadge');
const pitHeaderCountEl = document.getElementById('pitHeaderCount');
const pitTrackerCardEl = document.getElementById('pitTrackerCard');
const pitHomeCountEl = document.getElementById('pitHomeCount');
const pitTopVictimEl = document.getElementById('pitTopVictim');
const pitSelfCountEl = document.getElementById('pitSelfCount');

const pitDetailBackdrop = document.getElementById('pitDetailBackdrop');
const pitDetailCloseBtn = document.getElementById('pitDetailClose');
const pitModalTotalEl = document.getElementById('pitModalTotal');
const pitModalTopVictimEl = document.getElementById('pitModalTopVictim');
const pitModalTopVictimSubEl = document.getElementById('pitModalTopVictimSub');
const pitModalSelfDeathsEl = document.getElementById('pitModalSelfDeaths');
const pitModalSelfSubEl = document.getElementById('pitModalSelfSub');
const pitModalMatchCountEl = document.getElementById('pitModalMatchCount');
const pitModalModeSubEl = document.getElementById('pitModalModeSub');
const pitVictimsTableBody = document.getElementById('pitVictimsTableBody');
const pitClaimsTableBody = document.getElementById('pitClaimsTableBody');

// ---------------------------------------------------------------------
// Theme toggle — data-theme on <html> is already applied by the inline
// <script> in hub.html's <head> (before theme.css is even parsed, to avoid
// a flash of the wrong palette). This just keeps the sidebar buttons'
// .active state in sync and wires clicks through to main.js, which
// persists the choice and pushes it to the overlay window too (see
// theme-store.js / preload.js's themeAPI) — plain localStorage wouldn't
// reach the overlay's separate renderer process.
// ---------------------------------------------------------------------

const themeToggleButtons = [...document.querySelectorAll('#themeToggle [data-theme-choice]')];

function applyThemeButtonState(theme) {
  for (const btn of themeToggleButtons) {
    btn.classList.toggle('active', btn.dataset.themeChoice === theme);
  }
}

applyThemeButtonState(window.themeAPI.getInitial());

for (const btn of themeToggleButtons) {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeChoice;
    document.documentElement.setAttribute('data-theme', theme);
    applyThemeButtonState(theme);
    window.themeAPI.set(theme);
  });
}

window.themeAPI.onChange((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeButtonState(theme);
});

// ---------------------------------------------------------------------
// Keybind Settings (Overlay & Map Capture: recorder, persistence & status feedback)
// ---------------------------------------------------------------------

const overlayHotkeyBtn = document.getElementById('overlayHotkeyBtn');
const overlayHotkeyResetBtn = document.getElementById('overlayHotkeyResetBtn');
const overlayHotkeyStatus = document.getElementById('overlayHotkeyStatus');

const mapCaptureHotkeyBtn = document.getElementById('mapCaptureHotkeyBtn');
const mapCaptureHotkeyResetBtn = document.getElementById('mapCaptureHotkeyResetBtn');
const mapCaptureHotkeyStatus = document.getElementById('mapCaptureHotkeyStatus');

let recordingTarget = null; // 'overlay' | 'mapCapture' | null
let currentOverlayHotkey = 'Control+Shift+Y';
let currentMapCaptureHotkey = 'Control+Shift+M';

let overlayStatusTimer = null;
let mapCaptureStatusTimer = null;

function formatHotkeyDisplay(hk) {
  if (!hk) return 'None';
  return hk
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function showHotkeyStatus(target, message, isError = false) {
  const statusEl = target === 'mapCapture' ? mapCaptureHotkeyStatus : overlayHotkeyStatus;
  if (!statusEl) return;
  if (target === 'mapCapture') {
    clearTimeout(mapCaptureStatusTimer);
  } else {
    clearTimeout(overlayStatusTimer);
  }
  statusEl.textContent = message;
  statusEl.className = 'keybind-status' + (isError ? ' keybind-status--error' : ' keybind-status--success');
  statusEl.hidden = false;
  const timer = setTimeout(() => {
    statusEl.hidden = true;
  }, isError ? 5000 : 3000);
  if (target === 'mapCapture') {
    mapCaptureStatusTimer = timer;
  } else {
    overlayStatusTimer = timer;
  }
}

function updateHotkeyButtonDisplay(target, hk) {
  const btn = target === 'mapCapture' ? mapCaptureHotkeyBtn : overlayHotkeyBtn;
  if (btn) {
    btn.textContent = formatHotkeyDisplay(hk);
  }
}

function cancelHotkeyRecording() {
  if (!recordingTarget) return;
  const prevTarget = recordingTarget;
  recordingTarget = null;
  if (prevTarget === 'overlay' && overlayHotkeyBtn) {
    overlayHotkeyBtn.classList.remove('recording');
    updateHotkeyButtonDisplay('overlay', currentOverlayHotkey);
  } else if (prevTarget === 'mapCapture' && mapCaptureHotkeyBtn) {
    mapCaptureHotkeyBtn.classList.remove('recording');
    updateHotkeyButtonDisplay('mapCapture', currentMapCaptureHotkey);
  }
}

function startHotkeyRecording(target) {
  cancelHotkeyRecording();
  recordingTarget = target;
  const btn = target === 'mapCapture' ? mapCaptureHotkeyBtn : overlayHotkeyBtn;
  const statusEl = target === 'mapCapture' ? mapCaptureHotkeyStatus : overlayHotkeyStatus;
  if (btn) {
    btn.classList.add('recording');
    btn.textContent = 'Press keys...';
  }
  if (statusEl) statusEl.hidden = true;
}

// Convert a DOM KeyboardEvent into an Electron Accelerator string
function domEventToAccelerator(e) {
  const modifiers = [];
  if (e.ctrlKey) modifiers.push('Control');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Super');

  let key = e.key;

  // If only a modifier was pressed, preview without finalizing
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return null;
  }

  // Normalize special keys
  if (/^F\d{1,2}$/i.test(key)) {
    key = key.toUpperCase();
  } else if (key === ' ' || e.code === 'Space') {
    key = 'Space';
  } else if (key === '`' || e.code === 'Backquote') {
    key = '`';
  } else if (key === 'Escape') {
    return 'Escape';
  } else if (key.length === 1) {
    key = key.toUpperCase();
  } else {
    // Map common navigation/editing keys
    const nameMap = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Enter: 'Return',
      Delete: 'Delete',
      Insert: 'Insert',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
      Tab: 'Tab',
      Backspace: 'Backspace',
    };
    if (nameMap[key]) {
      key = nameMap[key];
    } else {
      return null;
    }
  }

  // Guard: non-function keys (letters, numbers, etc.) must have at least one modifier
  const isFunctionKey = /^F\d{1,2}$/i.test(key);
  if (!isFunctionKey && modifiers.length === 0) {
    return { error: 'Letter/number keys require at least one modifier (Ctrl, Alt, or Shift).' };
  }

  return { accelerator: [...modifiers, key].join('+') };
}

// Button click handlers
overlayHotkeyBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (recordingTarget === 'overlay') {
    cancelHotkeyRecording();
  } else {
    startHotkeyRecording('overlay');
  }
});

overlayHotkeyResetBtn?.addEventListener('click', async () => {
  cancelHotkeyRecording();
  if (window.settingsAPI?.resetOverlayHotkey) {
    const resp = await window.settingsAPI.resetOverlayHotkey();
    if (resp && resp.success) {
      currentOverlayHotkey = resp.hotkey;
      updateHotkeyButtonDisplay('overlay', resp.hotkey);
      showHotkeyStatus('overlay', 'Reset to default (Ctrl+Shift+Y)');
    } else {
      showHotkeyStatus('overlay', resp?.error || 'Failed to reset keybind.', true);
    }
  }
});

mapCaptureHotkeyBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (recordingTarget === 'mapCapture') {
    cancelHotkeyRecording();
  } else {
    startHotkeyRecording('mapCapture');
  }
});

mapCaptureHotkeyResetBtn?.addEventListener('click', async () => {
  cancelHotkeyRecording();
  if (window.settingsAPI?.resetMapCaptureHotkey) {
    const resp = await window.settingsAPI.resetMapCaptureHotkey();
    if (resp && resp.success) {
      currentMapCaptureHotkey = resp.hotkey;
      updateHotkeyButtonDisplay('mapCapture', resp.hotkey);
      showHotkeyStatus('mapCapture', 'Reset to default (Ctrl+Shift+M)');
    } else {
      showHotkeyStatus('mapCapture', resp?.error || 'Failed to reset keybind.', true);
    }
  }
});

// Window keydown listener for recording either hotkey
window.addEventListener('keydown', async (e) => {
  if (!recordingTarget) return;

  e.preventDefault();
  e.stopPropagation();

  const target = recordingTarget;
  const btn = target === 'mapCapture' ? mapCaptureHotkeyBtn : overlayHotkeyBtn;

  if (e.key === 'Escape') {
    cancelHotkeyRecording();
    showHotkeyStatus(target, 'Keybind change canceled.');
    return;
  }

  const result = domEventToAccelerator(e);
  if (!result) {
    // Just modifier pressed — preview held modifiers
    const held = [];
    if (e.ctrlKey) held.push('Ctrl');
    if (e.altKey) held.push('Alt');
    if (e.shiftKey) held.push('Shift');
    if (e.metaKey) held.push('Win');
    if (btn) btn.textContent = held.length > 0 ? `${held.join(' + ')} + ...` : 'Press keys...';
    return;
  }

  if (result.error) {
    showHotkeyStatus(target, result.error, true);
    return;
  }

  const newAccelerator = result.accelerator;
  recordingTarget = null;
  if (btn) {
    btn.classList.remove('recording');
    btn.textContent = 'Applying...';
  }

  if (target === 'overlay') {
    if (window.settingsAPI?.setOverlayHotkey) {
      const resp = await window.settingsAPI.setOverlayHotkey(newAccelerator);
      if (resp && resp.success) {
        currentOverlayHotkey = resp.hotkey;
        updateHotkeyButtonDisplay('overlay', resp.hotkey);
        showHotkeyStatus('overlay', 'Keybind updated successfully!');
      } else {
        updateHotkeyButtonDisplay('overlay', currentOverlayHotkey);
        showHotkeyStatus('overlay', resp?.error || 'Failed to register keybind.', true);
      }
    } else {
      updateHotkeyButtonDisplay('overlay', currentOverlayHotkey);
    }
  } else if (target === 'mapCapture') {
    if (window.settingsAPI?.setMapCaptureHotkey) {
      const resp = await window.settingsAPI.setMapCaptureHotkey(newAccelerator);
      if (resp && resp.success) {
        currentMapCaptureHotkey = resp.hotkey;
        updateHotkeyButtonDisplay('mapCapture', resp.hotkey);
        showHotkeyStatus('mapCapture', 'Keybind updated successfully!');
      } else {
        updateHotkeyButtonDisplay('mapCapture', currentMapCaptureHotkey);
        showHotkeyStatus('mapCapture', resp?.error || 'Failed to register keybind.', true);
      }
    } else {
      updateHotkeyButtonDisplay('mapCapture', currentMapCaptureHotkey);
    }
  }
});

// Click outside cancel
window.addEventListener('click', (e) => {
  if (recordingTarget) {
    const isOverlayBtn = e.target.closest('#overlayHotkeyBtn');
    const isMapCaptureBtn = e.target.closest('#mapCaptureHotkeyBtn');
    if (!isOverlayBtn && !isMapCaptureBtn) {
      cancelHotkeyRecording();
    }
  }
});

// Initialize hotkeys on startup
if (window.settingsAPI?.getOverlayHotkey) {
  window.settingsAPI.getOverlayHotkey().then((res) => {
    if (res && res.hotkey) {
      currentOverlayHotkey = res.hotkey;
      updateHotkeyButtonDisplay('overlay', res.hotkey);
    }
  });
}

if (window.settingsAPI?.onOverlayHotkeyChanged) {
  window.settingsAPI.onOverlayHotkeyChanged((newHotkey) => {
    currentOverlayHotkey = newHotkey;
    updateHotkeyButtonDisplay('overlay', newHotkey);
  });
}

if (window.settingsAPI?.getMapCaptureHotkey) {
  window.settingsAPI.getMapCaptureHotkey().then((res) => {
    if (res && res.hotkey) {
      currentMapCaptureHotkey = res.hotkey;
      updateHotkeyButtonDisplay('mapCapture', res.hotkey);
    }
  });
}

if (window.settingsAPI?.onMapCaptureHotkeyChanged) {
  window.settingsAPI.onMapCaptureHotkeyChanged((newHotkey) => {
    currentMapCaptureHotkey = newHotkey;
    updateHotkeyButtonDisplay('mapCapture', newHotkey);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(timestamp) {
  const diffMs = Date.now() - timestamp;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ---------------------------------------------------------------------
// Nav / view switching — homeView / rankedHistoryView / otherHistoryView
// are toggled via the native `hidden` attribute (see hub.html: none of the
// three carries an unconditional author `display` rule, so there's nothing
// to override `[hidden]{display:none}` the way #matchDetailBackdrop's own
// `display:flex` once did — that bug isn't reintroduced here by simply
// never adding one). Nav highlighting is a separate `.active` class swap,
// not a show/hide toggle, so it doesn't carry the same risk.
// ---------------------------------------------------------------------

const views = {
  home: document.getElementById('homeView'),
  liveMatch: document.getElementById('liveMatchView'),
  ranked: document.getElementById('rankedHistoryView'),
  other: document.getElementById('otherHistoryView'),
  weapons: document.getElementById('weaponsView'),
  playedWith: document.getElementById('playedWithView'),
  maps: document.getElementById('mapsView'),
  settings: document.getElementById('settingsView'),
};
const navItems = [...document.querySelectorAll('.nav-item[data-view]')];
let currentView = 'home';
let latestHubData = null; // re-render target when switching into a history view without waiting for the next push

function switchView(view) {
  if (!views[view]) return;
  currentView = view;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  for (const item of navItems) item.classList.toggle('active', item.dataset.view === view);

  // Close open modals when switching tabs
  const mhBackdrop = document.getElementById('mapHistoryBackdrop');
  if (mhBackdrop) mhBackdrop.hidden = true;
  const pdBackdrop = document.getElementById('playerDetailBackdrop');
  if (pdBackdrop) pdBackdrop.hidden = true;
  const pfpBackdrop = document.getElementById('playerFullProfileBackdrop');
  if (pfpBackdrop) pfpBackdrop.hidden = true;
  const mdBackdrop = document.getElementById('matchDetailBackdrop');
  if (mdBackdrop) mdBackdrop.hidden = true;

  if (view === 'ranked') fetchAndRenderHistory('ranked');
  if (view === 'other') fetchAndRenderHistory('other');
  if (view === 'playedWith') renderPlayedWithTable();
  if (view === 'maps') renderMapsTable();
  if (view === 'liveMatch') renderLiveMatch();
}

for (const item of navItems) {
  item.addEventListener('click', () => switchView(item.dataset.view));
}

let rankedHistoryMatches = [];
let rankedFilterTag = 'all';
let rankedSearchQuery = '';

let otherHistoryMatches = [];
let otherFilterTag = 'all';
let otherSearchQuery = '';

function applyMatchFilters(matches, filterTag, searchQuery) {
  let list = matches;
  if (filterTag && filterTag !== 'all') {
    const target = filterTag.toLowerCase();
    list = list.filter((m) => {
      const tags = (m.tags || []).map((t) => String(t).toLowerCase());
      if (tags.includes(target)) return true;
      if (target === 'ranked' && m.source === 'ranked') return true;
      if (target === '2v2' && (m.source === '2v2' || m.is2v2)) return true;
      return false;
    });
  }
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = list.filter((m) => {
      const matchup = (m.matchup || `${m.team0Name || ''} vs ${m.team1Name || ''}`).toLowerCase();
      const mapLabel = (m.mapLabel || '').toLowerCase();
      const tags = (m.tags || []).join(' ').toLowerCase();
      return matchup.includes(q) || mapLabel.includes(q) || tags.includes(q);
    });
  }
  return list;
}

function renderFilterPills(containerEl, matches, activeTag, onSelect) {
  if (!containerEl) return;
  const tagCounts = new Map();
  for (const m of matches) {
    const tags = Array.isArray(m.tags) && m.tags.length > 0
      ? m.tags
      : (m.source === 'ranked' ? ['Ranked'] : (m.is2v2 ? ['2v2'] : ['Casual']));
    for (const t of tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }

  containerEl.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = `cat-pill ${activeTag === 'all' ? 'active' : ''}`;
  allBtn.textContent = `All (${matches.length})`;
  allBtn.addEventListener('click', () => onSelect('all'));
  containerEl.appendChild(allBtn);

  for (const [tag, count] of tagCounts) {
    const btn = document.createElement('button');
    btn.className = `cat-pill ${activeTag.toLowerCase() === tag.toLowerCase() ? 'active' : ''}`;
    btn.textContent = `${tag} (${count})`;
    btn.addEventListener('click', () => onSelect(tag));
    containerEl.appendChild(btn);
  }
}

function updateFilteredHistoryTable(kind) {
  const bodyEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryBody' : 'otherHistoryBody');
  const filterTagsEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryFilterTags' : 'otherHistoryFilterTags');
  const currentList = kind === 'ranked' ? rankedHistoryMatches : otherHistoryMatches;
  const activeTag = kind === 'ranked' ? rankedFilterTag : otherFilterTag;
  const activeQuery = kind === 'ranked' ? rankedSearchQuery : otherSearchQuery;

  if (filterTagsEl) {
    for (const btn of filterTagsEl.querySelectorAll('.cat-pill')) {
      const isAll = btn.textContent.startsWith('All');
      if (activeTag === 'all') {
        btn.classList.toggle('active', isAll);
      } else {
        btn.classList.toggle('active', !isAll && btn.textContent.toLowerCase().startsWith(activeTag.toLowerCase()));
      }
    }
  }

  const filtered = applyMatchFilters(currentList, activeTag, activeQuery);
  renderMatchRows(bodyEl, filtered, { tagSource: true });
}

async function fetchAndRenderHistory(kind) {
  const matches = kind === 'ranked' ? await window.hubAPI.getRankedHistory() : await window.hubAPI.getOtherHistory();
  const emptyEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryEmpty' : 'otherHistoryEmpty');
  const panelEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryPanel' : 'otherHistoryPanel');
  const filterBarEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryFilterBar' : 'otherHistoryFilterBar');
  const filterTagsEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryFilterTags' : 'otherHistoryFilterTags');
  const searchInputEl = document.getElementById(kind === 'ranked' ? 'rankedHistorySearch' : 'otherHistorySearch');

  const hasAny = matches.length > 0;
  emptyEl.hidden = hasAny;
  panelEl.hidden = !hasAny;
  if (filterBarEl) filterBarEl.hidden = !hasAny;

  if (kind === 'ranked') {
    rankedHistoryMatches = matches.map((m) => ({ ...m, source: 'ranked' }));
  } else {
    otherHistoryMatches = matches.map((m) => ({ ...m, source: m.is2v2 ? '2v2' : 'other' }));
  }

  const currentList = kind === 'ranked' ? rankedHistoryMatches : otherHistoryMatches;

  if (hasAny) {
    const availableTags = new Set(currentList.flatMap((m) => m.tags || []).map((t) => t.toLowerCase()));
    if (kind === 'ranked') {
      if (rankedFilterTag !== 'all' && !availableTags.has(rankedFilterTag.toLowerCase())) {
        rankedFilterTag = 'all';
      }
    } else {
      if (otherFilterTag !== 'all' && !availableTags.has(otherFilterTag.toLowerCase())) {
        otherFilterTag = 'all';
      }
    }
    const activeTag = kind === 'ranked' ? rankedFilterTag : otherFilterTag;

    renderFilterPills(filterTagsEl, currentList, activeTag, (newTag) => {
      if (kind === 'ranked') rankedFilterTag = newTag;
      else otherFilterTag = newTag;
      updateFilteredHistoryTable(kind);
    });

    if (searchInputEl && !searchInputEl.dataset.bound) {
      searchInputEl.dataset.bound = 'true';
      searchInputEl.addEventListener('input', (e) => {
        if (kind === 'ranked') rankedSearchQuery = e.target.value;
        else otherSearchQuery = e.target.value;
        updateFilteredHistoryTable(kind);
      });
    }

    updateFilteredHistoryTable(kind);
  } else {
    const bodyEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryBody' : 'otherHistoryBody');
    if (bodyEl) bodyEl.innerHTML = '';
  }
}

// ---------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------

function render(data) {
  latestHubData = data;
  playerNameEl.textContent = data.playerName || '—';
  if (data.appVersion) appVersionLabelEl.textContent = `Tracker v${data.appVersion}`;

  const hasRanked = !!(data.lifetime && data.lifetime.matchesRecorded > 0);

  // DPL Rating badge — same computeDplRating() formula/scale as every
  // Played With row (see match-archive.js's getLifetimeStats()), so it's
  // ranked-only, gated the same way the stat tiles below already are.
  playerRatingBadgeEl.hidden = !hasRanked;
  if (hasRanked) playerRatingEl.textContent = data.lifetime.dplRating.toFixed(2);

  loadAvatarInto(playerAvatarEl, data.localAccountId);

  const rankedMatches = data.recentMatches ?? [];
  const otherMatches = data.otherMatches ?? [];
  const hasAny = rankedMatches.length > 0 || otherMatches.length > 0;

  emptyHubEl.hidden = hasAny;
  statGridEl.hidden = !hasRanked; // ranked-only, unchanged
  detailColsEl.hidden = !hasAny; // unified feed shows for either archive having data

  if (hasRanked) {
    const l = data.lifetime;
    document.getElementById('statKills').textContent = l.totalKills.toLocaleString();
    document.getElementById('statKillsSub').textContent = `${l.killsPerMatch} per match`;
    document.getElementById('statDeaths').textContent = l.totalDeaths.toLocaleString();
    document.getElementById('statKdr').textContent = l.kdr.toFixed(2);
    document.getElementById('statWins').textContent = l.wins.toLocaleString();
    document.getElementById('statWinsSub').textContent = `Best streak ${l.bestWinStreak}`;
    document.getElementById('statLosses').textContent = l.losses.toLocaleString();
    document.getElementById('statLossesSub').textContent = `Worst streak ${l.worstLossStreak}`;
    document.getElementById('statWinRate').innerHTML = `${l.winRate}<span style="font-size:26px;color:var(--accent-dim)">%</span>`;
    document.getElementById('statWinRateBar').style.width = `${l.winRate}%`;

    renderTopWeapons(data.topWeapons);
    renderSparkline(data.killsTrend);
  }

  if (hasAny) {
    // Unified feed: merge both archives' capped recent lists, tag each row
    // with where it came from, sort by recency, keep the top 8 — same cap
    // the two lists already came in at individually.
    const tagged = [
      ...rankedMatches.map((m) => ({ ...m, source: 'ranked' })),
      ...otherMatches.map((m) => ({ ...m, source: m.is2v2 ? '2v2' : 'other' })),
    ];
    tagged.sort((a, b) => b.timestamp - a.timestamp);
    renderMatchRows(recentMatchesBody, tagged.slice(0, 8), { tagSource: true });
  }

  // Keep whichever history view is currently open live too, same as Home,
  // rather than only refreshing on the next manual switch-in.
  if (currentView === 'ranked' || currentView === 'other') {
    fetchAndRenderHistory(currentView);
  }

  if (currentView === 'maps') renderMapsTable();
  if (currentView === 'liveMatch') renderLiveMatch();

  // Unlike ranked/other history, weaponStats and playedWith/playedWithStats
  // ride along on every regular hub:update push (their output is small —
  // bounded by distinct weapon codes / players encountered, not match
  // count) — so there's no on-demand fetch here, just a re-render from
  // whatever's already in `data`. Kept live and current in the DOM even
  // while their views are hidden, same reasoning as the stat tiles. (Today,
  // a delete can only ever be triggered from Home/History/match-detail —
  // never while Weapons/Played With/Maps is the active view — so this
  // mainly guards against that changing later, not a currently-reachable
  // staleness path.)
  renderWeaponsTable();
  renderPlayedWithTable();
  renderPitTracker(data.pitStats);
  refreshWebDbStats();
}

// ---------------------------------------------------------------------
// The Pit — Global Hazard Death Tracker
// ---------------------------------------------------------------------

function renderPitTracker(pitStats) {
  if (!pitStats) return;
  const total = pitStats.totalDeaths || 0;
  const self = pitStats.selfDeaths || 0;
  const topVictim = pitStats.topVictim;

  if (pitHeaderCountEl) {
    pitHeaderCountEl.textContent = self.toLocaleString();
  }
  if (pitHomeCountEl) {
    pitHomeCountEl.textContent = total.toLocaleString();
  }
  if (pitTopVictimEl) {
    pitTopVictimEl.textContent = topVictim ? `${topVictim.name} (${topVictim.count})` : 'None';
  }
  if (pitSelfCountEl) {
    pitSelfCountEl.textContent = `You: ${self}`;
  }

  if (pitModalTotalEl) pitModalTotalEl.textContent = total.toLocaleString();
  if (pitModalTopVictimEl) pitModalTopVictimEl.textContent = topVictim ? topVictim.name : '—';
  if (pitModalTopVictimSubEl) pitModalTopVictimSubEl.textContent = topVictim ? `${topVictim.count} ${topVictim.count === 1 ? 'claim' : 'claims'}` : 'No claims';
  if (pitModalSelfDeathsEl) pitModalSelfDeathsEl.textContent = self.toLocaleString();
  const selfPct = total > 0 ? Math.round((self / total) * 100) : 0;
  if (pitModalSelfSubEl) pitModalSelfSubEl.textContent = `${selfPct}% of claims`;

  const matchIds = new Set((pitStats.claims || []).map((c) => c.matchId));
  if (pitModalMatchCountEl) pitModalMatchCountEl.textContent = matchIds.size.toLocaleString();
  if (pitModalModeSubEl) pitModalModeSubEl.textContent = `${pitStats.rankedTotal || 0} Ranked / ${pitStats.otherTotal || 0} Other`;

  renderPitTables(pitStats);
}

function renderPitTables(pitStats) {
  if (!pitVictimsTableBody || !pitClaimsTableBody) return;
  pitVictimsTableBody.innerHTML = '';
  pitClaimsTableBody.innerHTML = '';

  const victims = pitStats?.victims || [];
  if (victims.length === 0) {
    pitVictimsTableBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);font-style:italic">No victims claimed yet.</td></tr>';
  } else {
    victims.forEach((v) => {
      const tr = document.createElement('tr');
      tr.className = 'pit-victim-row';
      tr.title = 'Click to view player stats';
      tr.innerHTML = `
        <td style="font-weight:600;color:var(--text-bright)">${escapeHtml(v.name)}</td>
        <td style="text-align:right;color:#ff5208;font-weight:700">${v.count}</td>
      `;
      tr.addEventListener('click', () => {
        closePitDetail();
        const player = (latestHubData?.playedWithStats || []).find((p) => p.name?.toUpperCase() === v.name?.toUpperCase());
        if (player?.accountId) {
          openPlayerDetail(player.accountId);
        }
      });
      pitVictimsTableBody.appendChild(tr);
    });
  }

  const claims = pitStats?.claims || [];
  if (claims.length === 0) {
    pitClaimsTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);font-style:italic">No Pit claims recorded.</td></tr>';
  } else {
    claims.forEach((c) => {
      const tr = document.createElement('tr');
      tr.className = 'pit-claim-row';
      const dateStr = c.timestamp ? new Date(c.timestamp).toLocaleDateString() : '—';
      const selfTag = c.isSelf ? '<span style="font-size:9px;background:rgba(255,82,8,0.2);color:#ff5208;border:1px solid rgba(255,82,8,0.4);border-radius:2px;padding:1px 4px;margin-left:6px">YOU</span>' : '';
      tr.innerHTML = `
        <td style="font-weight:600;color:var(--text-bright)">${escapeHtml(c.victimName)}${selfTag}</td>
        <td style="color:var(--text)">${escapeHtml(c.mapLabel || 'Unknown')}</td>
        <td style="text-align:center;color:var(--text-dim)">Round ${c.roundNumber || 1}</td>
        <td style="text-align:center"><span class="cat-pill" style="font-size:9px;padding:1px 5px">${escapeHtml(c.mode || 'Ranked')}</span></td>
        <td style="text-align:right;color:var(--text-dim);font-size:11px">${dateStr}</td>
      `;
      tr.title = 'Click to open match details';
      tr.addEventListener('click', () => {
        closePitDetail();
        if (c.matchId) {
          openMatchDetail(c.matchId);
        }
      });
      pitClaimsTableBody.appendChild(tr);
    });
  }
}

function openPitDetail() {
  if (!pitDetailBackdrop) return;
  if (latestHubData?.pitStats) {
    renderPitTracker(latestHubData.pitStats);
  }
  pitDetailBackdrop.hidden = false;
}

function closePitDetail() {
  if (!pitDetailBackdrop) return;
  pitDetailBackdrop.hidden = true;
}

if (pitHeaderBadgeEl) pitHeaderBadgeEl.addEventListener('click', openPitDetail);
if (pitTrackerCardEl) pitTrackerCardEl.addEventListener('click', openPitDetail);
if (pitDetailCloseBtn) pitDetailCloseBtn.addEventListener('click', closePitDetail);
if (pitDetailBackdrop) {
  pitDetailBackdrop.addEventListener('click', (e) => {
    if (e.target === pitDetailBackdrop) closePitDetail();
  });
}

// ---------------------------------------------------------------------
// Live Match & Prediction
// ---------------------------------------------------------------------

const liveMatchEmptyEl = document.getElementById('liveMatchEmpty');
const liveMatchContentEl = document.getElementById('liveMatchContent');
const liveMatchTeamsEl = document.getElementById('liveMatchTeams');

function renderLiveMatch() {
  const liveMatch = latestHubData?.liveMatch;
  const hasLive = !!(liveMatch && liveMatch.teams && (liveMatch.teams[0]?.length > 0 || liveMatch.teams[1]?.length > 0));

  liveMatchEmptyEl.hidden = hasLive;
  liveMatchContentEl.hidden = !hasLive;
  if (!hasLive) return;

  const pred = liveMatch.prediction;
  if (pred) {
    let predictionSummary = '';
    if (pred.isConcluded) {
      if (pred.isTie) {
        predictionSummary = `MATCH TIED · ${pred.roundsWon0} - ${pred.roundsWon1}`;
      } else {
        const wonTeam0 = pred.roundsWon0 > pred.roundsWon1;
        predictionSummary = `MATCH DECIDED · ${wonTeam0 ? 'BLUE' : 'ORANGE'} TEAM WON (${pred.roundsWon0} - ${pred.roundsWon1})`;
      }
    } else if (pred.team0WinChance === 50) {
      const scoreCtx = (pred.roundsWon0 > 0 || pred.roundsWon1 > 0) ? ` [${pred.roundsWon0} - ${pred.roundsWon1}]` : '';
      predictionSummary = `EVEN MATCHUP · 50% / 50% CHANCE${scoreCtx}`;
    } else {
      const winnerName = pred.predictedWinner === 0 ? 'BLUE' : 'ORANGE';
      const chance = pred.predictedWinner === 0 ? pred.team0WinChance : pred.team1WinChance;
      const scoreCtx = (pred.roundsWon0 > 0 || pred.roundsWon1 > 0) ? ` [${pred.roundsWon0} - ${pred.roundsWon1}]` : '';
      predictionSummary = `${winnerName} TEAM HAS A ${chance}% CHANCE OF WINNING${scoreCtx}`;
    }
    const predWinnerEl = document.getElementById('predictionWinnerText');
    if (predWinnerEl) predWinnerEl.textContent = predictionSummary;
    const blueAvgRatingEl = document.getElementById('blueAvgRating');
    if (blueAvgRatingEl) blueAvgRatingEl.textContent = (pred.avgRating0 ?? 1.0).toFixed(2);
    const orangeAvgRatingEl = document.getElementById('orangeAvgRating');
    if (orangeAvgRatingEl) orangeAvgRatingEl.textContent = (pred.avgRating1 ?? 1.0).toFixed(2);
    const predBarTeam0El = document.getElementById('predictionBarTeam0');
    if (predBarTeam0El) predBarTeam0El.style.width = `${pred.team0WinChance}%`;
  }

  renderScoreboardTeams(liveMatchTeamsEl, {
    finalScore: liveMatch.finalScore,
    teams: liveMatch.teams,
    localAccountId: latestHubData?.localAccountId,
  });

  attachPlayerClickHandlers(liveMatchTeamsEl);
}

// Wires up click-to-open-Player-Quick-Reference on a scoreboard already
// rendered by scoreboard-view.js's renderScoreboardTeams(). Deliberately a
// separate pass over the DOM afterward, not built into scoreboard-view.js
// itself — that file is shared with the live overlay (overlay-renderer.js),
// which should never open a Hub-only modal mid-game. Only ever called from
// Hub-side code (this file), so the overlay is untouched by construction —
// no runtime "which window am I in" check needed anywhere.
//
// Selectors here must match scoreboard-view.js's actual output: each row is
// `.player-row` with a `data-account-id` attribute (added there
// specifically to support this), and the name is `span.name`.
function attachPlayerClickHandlers(container) {
  container.querySelectorAll('.player-row').forEach((row) => {
    const accountId = row.dataset.accountId;
    if (!accountId) return;

    const nameEl = row.querySelector('.name');
    if (nameEl && !nameEl.classList.contains('player-name-link')) {
      nameEl.classList.add('player-name-link');
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayerDetail(accountId);
      });
    }
  });
}

// ---------------------------------------------------------------------
// Maps View
// ---------------------------------------------------------------------

const mapsEmptyEl = document.getElementById('mapsEmpty');
const mapsContentEl = document.getElementById('mapsContent');
const mapsPanelEl = document.getElementById('mapsPanel');
const mapsBodyEl = document.getElementById('mapsBody');
const mapsTableEl = document.getElementById('mapsTable');
const mapsTilesetGrid = document.getElementById('mapsTilesetGrid');
const mapTilesetFiltersEl = document.getElementById('mapTilesetFilters');
const mapHistoryBackdrop = document.getElementById('mapHistoryBackdrop');
const mhMapTitle = document.getElementById('mhMapTitle');
const mhTilesetBadge = document.getElementById('mhTilesetBadge');
const mhBody = document.getElementById('mhBody');
const mhCloseBtn = document.getElementById('mhCloseBtn');
const mhLayoutPicture = document.getElementById('mhLayoutPicture');

let selectedMapTileset = 'all';
let mapSortKey = 'timesPlayed';
let mapSortDir = 'desc';

// Fixed quick-tag set for the Maps tab's per-map pill selector — additive
// to the free-text Notes field (mapNotes), not a replacement. Persisted
// separately as match-archive.js's mapTags, same keyed-by-mapName shape.
const MAP_TAGS = ['Sniper', 'Defense-Heavy', 'Offense-Heavy', 'Good W-Charge', 'Nade Needed', 'Door Needed'];

// saveMapTags does a synchronous full-archive rewrite (see its doc comment
// in match-archive.js) — debounced per map so clicking several pills in a
// row (a normal way to tag a map right after a match) collapses into one
// write instead of one blocking rewrite per click. Keyed by mapName since
// different rows can be tagged independently without their debounces
// interfering with each other.
const mapTagsSaveTimers = new Map();
function debouncedSaveMapTags(mapName, tags) {
  clearTimeout(mapTagsSaveTimers.get(mapName));
  mapTagsSaveTimers.set(mapName, setTimeout(() => {
    mapTagsSaveTimers.delete(mapName);
    window.hubAPI?.saveMapTags?.(mapName, tags);
  }, 400));
}

let mapSearchQuery = '';
const mapSearchInput = document.getElementById('mapSearchInput');
mapSearchInput?.addEventListener('input', (e) => {
  mapSearchQuery = e.target.value;
  renderMapsTable();
});

function renderMapsTable() {
  const mapData = latestHubData?.mapStats ?? { mapSummary: [], tilesetSummary: [], everyMap: [] };
  const mapSummary = mapData.mapSummary ?? [];
  const tilesetSummary = mapData.tilesetSummary ?? [];

  const hasAny = mapSummary.length > 0;
  mapsEmptyEl.hidden = hasAny;
  mapsContentEl.hidden = !hasAny;
  if (!hasAny) return;

  // --- Render Tileset Summary Tiles ---
  mapsTilesetGrid.innerHTML = '';
  for (const t of tilesetSummary) {
    if (t.tileset.toLowerCase() === 'unknown') continue; // Hide Unknown tileset tile from summary grid
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    const tilesetLabel = t.tileset.replace(/_Day$/i, '');
    tile.innerHTML = `
      <div class="stat-label">${escapeHtml(tilesetLabel)}</div>
      <div class="stat-value">${t.winRate}%</div>
      <div class="stat-sub">${t.wins}W - ${t.losses}L (${t.rounds} rounds)</div>
    `;
    mapsTilesetGrid.appendChild(tile);
  }

  // --- Filter and Sort Map Summary Table ---
  let filtered = mapSummary.filter((m) => m.mapName.toLowerCase() !== 'unknown' && m.tileset.toLowerCase() !== 'unknown');
  if (selectedMapTileset !== 'all') {
    filtered = filtered.filter((m) => m.tileset.toLowerCase() === selectedMapTileset.toLowerCase());
  }
  if (mapSearchQuery.trim()) {
    const q = mapSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(
      (m) => m.mapName.toLowerCase().includes(q) || m.tileset.toLowerCase().includes(q) || (m.note && m.note.toLowerCase().includes(q))
    );
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = a[mapSortKey];
    const bv = b[mapSortKey];
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return mapSortDir === 'asc' ? cmp : -cmp;
  });

  mapsBodyEl.innerHTML = '';
  for (const m of sorted) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.title = 'Click to view played rounds history for this map layout';

    const winClass = m.winRate >= 50 ? 'result-win' : 'result-loss';

    tr.innerHTML = `
      <td style="font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text-bright)">
        ${escapeHtml(m.mapName)}
      </td>
      <td style="text-align:center">
        <span class="source-badge source-badge--ranked">${escapeHtml(m.tileset)}</span>
      </td>
      <td style="text-align:center;font-weight:600">
        ${m.timesPlayed} Played <span style="font-size:12px;color:var(--text-muted)">(${m.wins}W - ${m.losses}L)</span>
      </td>
      <td style="text-align:center;font-family:var(--font-display);font-weight:700" class="${winClass}">
        ${m.winRate}%
      </td>
      <td style="text-align:left" onclick="event.stopPropagation()">
        <input type="text" class="map-note-input" data-mapname="${escapeHtml(m.mapName)}" value="${escapeHtml(m.note || '')}" placeholder="Add custom notes..." style="background:rgba(0,0,0,0.3);border:1px solid var(--border);color:var(--text-bright);font-family:var(--font-body);font-size:12px;padding:5px 9px;border-radius:2px;width:92%;outline:none" />
        <div class="map-tag-pills" data-mapname="${escapeHtml(m.mapName)}">
          ${MAP_TAGS.map((t) => `<button type="button" class="map-tag-pill${(m.tags || []).includes(t) ? ' active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
        </div>
      </td>
    `;

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.map-note-input') || e.target.closest('.map-tag-pills')) return;
      openMapHistory(m);
    });

    const noteInput = tr.querySelector('.map-note-input');
    if (noteInput) {
      const handleSave = () => {
        const newNote = noteInput.value.trim();
        if (window.hubAPI?.saveMapNote) {
          window.hubAPI.saveMapNote(m.mapName, newNote);
        }
      };
      noteInput.addEventListener('change', handleSave);
      noteInput.addEventListener('blur', handleSave);
    }

    // Tag pills auto-save the same way the notes input does — no separate
    // "confirm" step, just persist on interaction (a click here, change/blur
    // for the text input above), debounced per map (see
    // debouncedSaveMapTags). Always sends the full currently-active tag
    // set for this map, not a single add/remove delta — see
    // match-archive.js's saveMapTags doc comment.
    const tagPillsEl = tr.querySelector('.map-tag-pills');
    tagPillsEl?.querySelectorAll('.map-tag-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        pill.classList.toggle('active');
        const selected = [...tagPillsEl.querySelectorAll('.map-tag-pill.active')].map((p) => p.dataset.tag);
        debouncedSaveMapTags(m.mapName, selected);
      });
    });

    mapsBodyEl.appendChild(tr);
  }

  // Active header sorting arrows
  for (const th of mapsTableEl.querySelectorAll('th[data-mapsort]')) {
    th.classList.toggle('sort-active', th.dataset.mapsort === mapSortKey);
    th.querySelector('.sort-arrow')?.remove();
    if (th.dataset.mapsort === mapSortKey) {
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = mapSortDir === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
    }
  }
}

function openMapHistory(m) {
  mhMapTitle.textContent = m.mapName;

  mhLayoutPicture.hidden = true;
  mhLayoutPicture.src = '';
  window.hubAPI?.getMapLayoutPicture?.(m.tileset, m.mapName).then((url) => {
    if (!url) return;
    mhLayoutPicture.src = url;
    mhLayoutPicture.hidden = false;
  });

  const atkWr = m.attackWinRate !== undefined ? m.attackWinRate : 0;
  const defWr = m.defenseWinRate !== undefined ? m.defenseWinRate : 0;
  mhTilesetBadge.innerHTML = `
    <span>${escapeHtml(m.tileset)} · ${m.timesPlayed} Played (${m.wins}W - ${m.losses}L) · ${m.winRate}% WR</span>
    <span class="role-badge role-badge--attack" style="margin-left:8px">⚔️ ATK ${atkWr}% WR</span>
    <span class="role-badge role-badge--defense" style="margin-left:4px">🛡️ DEF ${defWr}% WR</span>
  `;
  
  mhBody.innerHTML = '';
  for (const h of m.history ?? []) {
    const tr = document.createElement('tr');
    const resultClass = h.won ? 'result-win' : 'result-loss';
    const resultText = h.won ? 'WIN' : 'LOSS';
    const role = (h.sideRole || '').toUpperCase();
    const roleBadgeClass = role === 'ATTACK' ? 'role-badge--attack' : role === 'DEFENSE' ? 'role-badge--defense' : 'role-badge--unknown';
    const roleText = role === 'ATTACK' ? '⚔️ ATTACK' : role === 'DEFENSE' ? '🛡️ DEFENSE' : '— UNKNOWN';

    tr.innerHTML = `
      <td style="font-family:var(--font-display);font-size:14px;font-weight:600;color:var(--text-bright)">
        ${escapeHtml(h.matchup)}
      </td>
      <td style="text-align:center;font-size:13px;color:var(--text-muted)">
        Round ${h.round}
      </td>
      <td style="text-align:center">
        <span class="role-badge ${roleBadgeClass}">${roleText}</span>
      </td>
      <td style="text-align:center" class="${resultClass}">
        <span style="font-weight:700;letter-spacing:.08em">${resultText}</span>
      </td>
    `;
    mhBody.appendChild(tr);
  }
  mapHistoryBackdrop.hidden = false;
}

mhCloseBtn?.addEventListener('click', () => {
  mapHistoryBackdrop.hidden = true;
});
mapHistoryBackdrop?.addEventListener('click', (e) => {
  if (e.target === mapHistoryBackdrop) mapHistoryBackdrop.hidden = true;
});

// Click the Map Layout History thumbnail to view it full-size.
const mapPictureLightboxBackdrop = document.getElementById('mapPictureLightboxBackdrop');
const mapPictureLightboxImg = document.getElementById('mapPictureLightboxImg');
mhLayoutPicture?.addEventListener('click', () => {
  if (mhLayoutPicture.hidden || !mhLayoutPicture.src) return;
  mapPictureLightboxImg.src = mhLayoutPicture.src;
  mapPictureLightboxBackdrop.hidden = false;
});
mapPictureLightboxBackdrop?.addEventListener('click', () => {
  mapPictureLightboxBackdrop.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !mapPictureLightboxBackdrop.hidden) mapPictureLightboxBackdrop.hidden = true;
});

// Map layout screenshot: preview/confirm popup pushed from main.js's
// captureMapScreenshot() (MAP_SCREENSHOT_HOTKEY), plus a small toast for the
// non-actionable notices (already captured, no map detected, capture failed).
const mapScreenshotPreviewBackdrop = document.getElementById('mapScreenshotPreviewBackdrop');
const mapScreenshotPreviewTitle = document.getElementById('mapScreenshotPreviewTitle');
const mapScreenshotPreviewImg = document.getElementById('mapScreenshotPreviewImg');
const mapScreenshotSaveBtn = document.getElementById('mapScreenshotSaveBtn');
const mapScreenshotRetryBtn = document.getElementById('mapScreenshotRetryBtn');
const mapScreenshotCancelBtn = document.getElementById('mapScreenshotCancelBtn');
const mapScreenshotToast = document.getElementById('mapScreenshotToast');

window.hubAPI?.onMapScreenshotPreview?.(({ tileset, mapName, dataUrl }) => {
  mapScreenshotPreviewTitle.textContent = `[${tileset}] ${mapName}`;
  mapScreenshotPreviewImg.src = dataUrl;
  mapScreenshotPreviewBackdrop.hidden = false;
});

let mapScreenshotToastTimer = null;
window.hubAPI?.onMapScreenshotNotice?.(({ kind, message }) => {
  mapScreenshotToast.textContent = message;
  mapScreenshotToast.className = kind === 'error' ? 'toast--error' : '';
  mapScreenshotToast.hidden = false;
  clearTimeout(mapScreenshotToastTimer);
  mapScreenshotToastTimer = setTimeout(() => {
    mapScreenshotToast.hidden = true;
  }, 4000);
});

mapScreenshotSaveBtn?.addEventListener('click', () => {
  window.hubAPI?.confirmMapScreenshot?.();
  mapScreenshotPreviewBackdrop.hidden = true;
});
mapScreenshotRetryBtn?.addEventListener('click', () => {
  window.hubAPI?.retryMapScreenshot?.();
  // Left open — a fresh hub:map-screenshot-preview follows shortly and
  // repopulates the image; closing here would just flash the backdrop.
});
mapScreenshotCancelBtn?.addEventListener('click', () => {
  window.hubAPI?.cancelMapScreenshot?.();
  mapScreenshotPreviewBackdrop.hidden = true;
});

// Category filter clicks
mapTilesetFiltersEl?.querySelectorAll('.cat-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    mapTilesetFiltersEl.querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    selectedMapTileset = pill.dataset.mapcat;
    renderMapsTable();
  });
});

// Table sorting header clicks
mapsTableEl?.querySelectorAll('th[data-mapsort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.mapsort;
    if (mapSortKey === key) {
      mapSortDir = mapSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      mapSortKey = key;
      mapSortDir = 'desc';
    }
    renderMapsTable();
  });
});

// ---------------------------------------------------------------------
// Played With View
// ---------------------------------------------------------------------

const playedWithEmptyEl = document.getElementById('playedWithEmpty');
const playedWithContentEl = document.getElementById('playedWithContent');
const playedWithBodyEl = document.getElementById('playedWithBody');
const playedWithTableEl = document.getElementById('playedWithTable');
const playedWithCategoryFiltersEl = document.getElementById('playedWithCategoryFilters');
const playedWithSearchInputEl = document.getElementById('playedWithSearchInput');

const pwTotalPlayersEl = document.getElementById('pwTotalPlayers');
const pwTopTeammateEl = document.getElementById('pwTopTeammate');
const pwTopTeammateSubEl = document.getElementById('pwTopTeammateSub');
const pwTopTeammateAvatarEl = document.getElementById('pwTopTeammateAvatar');
const pwTopRivalEl = document.getElementById('pwTopRival');
const pwTopRivalSubEl = document.getElementById('pwTopRivalSub');
const pwTopRivalAvatarEl = document.getElementById('pwTopRivalAvatar');
const pwAvgWinRateEl = document.getElementById('pwAvgWinRate');

// Same hub:get-steam-avatar path (and main-process-side accountId
// validation — see isValidSteamAccountId/buildSteamProfileUrl in main.js)
// every other avatar in this app already goes through. `imgEl` starts
// hidden via the `hidden` attribute in hub.html (no inline `display`
// fighting it — see the #weaponsContent-class bug fixed earlier this
// project); only revealed once a real URL comes back.
function loadAvatarInto(imgEl, accountId) {
  imgEl.hidden = true;
  if (!window.hubAPI?.getSteamAvatar || !accountId) return;
  window.hubAPI.getSteamAvatar(accountId).then((avatarUrl) => {
    if (avatarUrl) {
      imgEl.src = avatarUrl;
      imgEl.hidden = false;
    }
  });
}

let selectedPwCategory = 'all';
let pwSearchQuery = '';
let pwSortKey = 'totalMatches';
let pwSortDir = 'desc';

function renderPlayedWithTable() {
  const playedWithList = latestHubData?.playedWithStats ?? latestHubData?.playedWith ?? [];
  const hasAny = playedWithList.length > 0;
  playedWithEmptyEl.hidden = hasAny;
  playedWithContentEl.hidden = !hasAny;
  if (!hasAny) return;

  pwTotalPlayersEl.textContent = playedWithList.length;

  const topTeammate = [...playedWithList].sort((a, b) => b.matchesTogether - a.matchesTogether)[0];
  if (topTeammate && topTeammate.matchesTogether > 0) {
    pwTopTeammateEl.textContent = topTeammate.latestName;
    pwTopTeammateSubEl.textContent = `${topTeammate.matchesTogether}g · ${topTeammate.winRateTogether}% WR`;
    loadAvatarInto(pwTopTeammateAvatarEl, topTeammate.accountId);
  } else {
    pwTopTeammateEl.textContent = '—';
    pwTopTeammateSubEl.textContent = '0 games';
    pwTopTeammateAvatarEl.hidden = true;
  }

  const topRival = [...playedWithList].sort((a, b) => b.matchesAgainst - a.matchesAgainst)[0];
  if (topRival && topRival.matchesAgainst > 0) {
    pwTopRivalEl.textContent = topRival.latestName;
    pwTopRivalSubEl.textContent = `${topRival.matchesAgainst}g · ${topRival.winRateAgainst}% WR`;
    loadAvatarInto(pwTopRivalAvatarEl, topRival.accountId);
  } else {
    pwTopRivalEl.textContent = '—';
    pwTopRivalSubEl.textContent = '0 games';
    pwTopRivalAvatarEl.hidden = true;
  }

  const teamGames = playedWithList.filter((p) => p.matchesTogether > 0);
  const totalTeamGames = teamGames.reduce((acc, p) => acc + p.matchesTogether, 0);
  const totalTeamWins = teamGames.reduce((acc, p) => acc + p.winsTogether, 0);
  const overallTeamWr = totalTeamGames > 0 ? Math.round((totalTeamWins / totalTeamGames) * 100) : 0;
  pwAvgWinRateEl.textContent = `${overallTeamWr}%`;

  let filtered = playedWithList;
  if (selectedPwCategory === 'teammates') {
    filtered = filtered.filter((p) => p.matchesTogether > 0);
  } else if (selectedPwCategory === 'rivals') {
    filtered = filtered.filter((p) => p.matchesAgainst > 0);
  }

  if (pwSearchQuery.trim()) {
    const q = pwSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(
      (p) => p.latestName.toLowerCase().includes(q) || String(p.accountId).includes(q)
    );
  }

  const sorted = [...filtered].sort((a, b) => {
    let av = a[pwSortKey];
    let bv = b[pwSortKey];
    if (pwSortKey === 'relation') {
      av = a.matchesTogether >= a.matchesAgainst ? 'Teammate' : 'Rival';
      bv = b.matchesTogether >= b.matchesAgainst ? 'Teammate' : 'Rival';
    }
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return pwSortDir === 'asc' ? cmp : -cmp;
  });

  playedWithBodyEl.innerHTML = '';
  for (const p of sorted) {
    const tr = document.createElement('tr');

    const isTeammate = p.matchesTogether >= p.matchesAgainst;
    const badgeText = isTeammate ? `Duo (${p.matchesTogether}g)` : `Rival (${p.matchesAgainst}g)`;
    const badgeClass = isTeammate ? 'source-badge--ranked' : 'source-badge--inferred';

    tr.innerHTML = `
      <td>
        <div style="font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--text-bright);display:flex;align-items:center;gap:10px">
          <img class="pw-row-avatar" data-accountid="${p.accountId}" src="" alt="" style="width:28px;height:28px;border-radius:4px;object-fit:cover;background:rgba(255,255,255,0.05);border:1px solid var(--border-soft);display:none" />
          <span>${escapeHtml(p.latestName)}</span>
          <span style="font-size:11px;font-family:var(--font-body);color:var(--text-muted)">(${p.accountId.slice(-4)})</span>
        </div>
      </td>
      <td style="text-align:center"><span class="source-badge ${badgeClass}">${badgeText}</span></td>
      <td style="text-align:center;color:var(--accent);font-weight:600">${p.matchesTogether > 0 ? `${p.winsTogether}W - ${p.lossesTogether}L` : '—'}</td>
      <td style="text-align:center;font-weight:600">${p.matchesTogether > 0 ? `${p.winRateTogether}%` : '—'}</td>
      <td style="text-align:center;color:var(--rival);font-weight:600">${p.matchesAgainst > 0 ? `${p.winsAgainst}W - ${p.lossesAgainst}L` : '—'}</td>
      <td style="text-align:center;font-weight:600">${p.matchesAgainst > 0 ? `${p.winRateAgainst}%` : '—'}</td>
      <td style="text-align:center;font-family:var(--font-display);font-weight:700;color:var(--accent-bright)">${p.dplRating.toFixed(2)}</td>
      <td style="text-align:right">
        <button class="pw-steam-btn" data-accountid="${p.accountId}" style="background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-family:var(--font-display);font-size:11px;padding:4px 8px;cursor:pointer">STEAM ↗</button>
      </td>
    `;

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.pw-steam-btn')) {
        e.stopPropagation();
        const accountId = e.target.closest('.pw-steam-btn').dataset.accountid;
        window.hubAPI.openSteamProfile(accountId);
        return;
      }
      openPlayerDetail(p.accountId);
    });

    playedWithBodyEl.appendChild(tr);

    if (window.hubAPI?.getSteamAvatar && p.accountId) {
      window.hubAPI.getSteamAvatar(p.accountId).then((avatarUrl) => {
        if (avatarUrl) {
          const img = tr.querySelector(`.pw-row-avatar[data-accountid="${p.accountId}"]`);
          if (img) {
            img.src = avatarUrl;
            img.style.display = 'block';
          }
        }
      });
    }
  }

  for (const th of playedWithTableEl.querySelectorAll('th[data-pwsort]')) {
    th.classList.toggle('sort-active', th.dataset.pwsort === pwSortKey);
    th.querySelector('.sort-arrow')?.remove();
    if (th.dataset.pwsort === pwSortKey) {
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = pwSortDir === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
    }
  }
}

playedWithCategoryFiltersEl?.querySelectorAll('.cat-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    playedWithCategoryFiltersEl.querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    selectedPwCategory = pill.dataset.pwcat;
    renderPlayedWithTable();
  });
});

playedWithSearchInputEl?.addEventListener('input', (e) => {
  pwSearchQuery = e.target.value;
  renderPlayedWithTable();
});

playedWithTableEl?.querySelectorAll('th[data-pwsort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.pwsort;
    if (pwSortKey === key) {
      pwSortDir = pwSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      pwSortKey = key;
      pwSortDir = 'desc';
    }
    renderPlayedWithTable();
  });
});

// ---------------------------------------------------------------------
// Player Quick Reference Modal
// ---------------------------------------------------------------------

const playerDetailBackdrop = document.getElementById('playerDetailBackdrop');
const pdName = document.getElementById('pdName');
const pdAccountId = document.getElementById('pdAccountId');
const pdRating = document.getElementById('pdRating');
const pdKdr = document.getElementById('pdKdr');
const pdKdaSub = document.getElementById('pdKdaSub');
const pdAdr = document.getElementById('pdAdr');
const pdKastSub = document.getElementById('pdKastSub');
const pdTeammateText = document.getElementById('pdTeammateText');
const pdOpponentText = document.getElementById('pdOpponentText');
const pdHistoryKicker = document.getElementById('pdHistoryKicker');
const pdTeammateLabel = document.getElementById('pdTeammateLabel');
const pdOpponentLabel = document.getElementById('pdOpponentLabel');
const pdAvatar = document.getElementById('pdAvatar');

let currentPdAccountId = null;

async function openPlayerDetail(accountId) {
  currentPdAccountId = accountId;
  if (pdAvatar) {
    pdAvatar.src = '';
    pdAvatar.hidden = true;
  }

  // getPlayedWithStats()/getSinglePlayedWith() deliberately exclude the
  // local player (match-archive.js: "Skip local player" — that aggregation
  // is "who you've played with/against", which doesn't include yourself).
  // Clicking your own name (e.g. the .is-you row in a match-detail
  // scoreboard) used to fall through to the "unknown player" branch below
  // and show all zeros — not an error, but not YOUR actual stats either.
  // Route the self-case to the already-computed lifetime totals instead.
  const isSelf = !!latestHubData?.localAccountId && accountId === latestHubData.localAccountId;

  if (isSelf) {
    const l = latestHubData.lifetime ?? {};
    pdName.textContent = latestHubData.playerName || `Player #${accountId.slice(-4)}`;
    pdAccountId.textContent = `Steam ID: ${accountId}`;
    pdRating.textContent = (l.dplRating ?? 1).toFixed(2);
    pdKdr.textContent = (l.kdr ?? 0).toFixed(2);
    pdKdaSub.textContent = `${l.totalKills ?? 0}K - ${l.totalDeaths ?? 0}D - ${l.totalAssists ?? 0}A`;
    pdAdr.textContent = l.adr ?? 0;
    pdKastSub.textContent = `${l.kast ?? 0}% KAST`;
    // "History with you" / "As Teammate" / "As Opponent" don't mean
    // anything relative to yourself — relabeled to a plain career record
    // instead of showing that framing with zeros.
    pdHistoryKicker.textContent = 'Career record';
    pdTeammateLabel.textContent = 'Record';
    pdTeammateText.textContent = `${l.wins ?? 0}W - ${l.losses ?? 0}L`;
    pdOpponentLabel.textContent = 'Win Rate';
    pdOpponentText.textContent = `${l.winRate ?? 0}%`;
  } else {
    pdHistoryKicker.textContent = 'History with you';
    pdTeammateLabel.textContent = 'As Teammate';
    pdOpponentLabel.textContent = 'As Opponent';

    const p = await window.hubAPI.getPlayerDetail(accountId);
    if (!p) {
      pdName.textContent = `Player #${accountId.slice(-4)}`;
      pdAccountId.textContent = `Steam ID: ${accountId}`;
      pdRating.textContent = '1.00';
      pdKdr.textContent = '0.00';
      pdKdaSub.textContent = '0 - 0 - 0';
      pdAdr.textContent = '0';
      pdKastSub.textContent = '0% KAST';
      pdTeammateText.textContent = '0g · 0% WR';
      pdOpponentText.textContent = '0g · 0% WR';
    } else {
      pdName.textContent = p.latestName || p.accountId;
      pdAccountId.textContent = `Steam ID: ${p.accountId}`;
      pdRating.textContent = p.dplRating.toFixed(2);
      pdKdr.textContent = p.kdr.toFixed(2);
      pdKdaSub.textContent = `${p.kills}K - ${p.deaths}D - ${p.assists}A`;
      pdAdr.textContent = p.adr;
      pdKastSub.textContent = `${p.kast}% KAST`;
      pdTeammateText.textContent = `${p.matchesTogether}g · ${p.winRateTogether}% WR`;
      pdOpponentText.textContent = `${p.matchesAgainst}g · ${p.winRateAgainst}% WR`;
    }
  }

  playerDetailBackdrop.hidden = false;

  if (window.hubAPI?.getSteamAvatar && accountId) {
    window.hubAPI.getSteamAvatar(accountId).then((avatarUrl) => {
      if (avatarUrl && pdAvatar && currentPdAccountId === accountId) {
        pdAvatar.src = avatarUrl;
        pdAvatar.hidden = false;
      }
    });
  }
}

const pdViewFullBtn = document.getElementById('pdViewFullBtn');
const pdSteamBtn = document.getElementById('pdSteamBtn');
const pdCloseBtn = document.getElementById('pdCloseBtn');

pdViewFullBtn?.addEventListener('click', () => {
  if (currentPdAccountId) {
    openFullPlayerProfile(currentPdAccountId);
  }
});

pdSteamBtn?.addEventListener('click', () => {
  if (currentPdAccountId) {
    window.hubAPI.openSteamProfile(currentPdAccountId);
  }
});

pdCloseBtn?.addEventListener('click', () => {
  playerDetailBackdrop.hidden = true;
});
playerDetailBackdrop?.addEventListener('click', (e) => {
  if (e.target === playerDetailBackdrop) playerDetailBackdrop.hidden = true;
});

// ---------------------------------------------------------------------
// Player Full Profile Modal
// ---------------------------------------------------------------------

const playerFullProfileBackdrop = document.getElementById('playerFullProfileBackdrop');
const pfpAvatar = document.getElementById('pfpAvatar');
const pfpKicker = document.getElementById('pfpKicker');
const pfpName = document.getElementById('pfpName');
const pfpAccountId = document.getElementById('pfpAccountId');
const pfpSteamBtn = document.getElementById('pfpSteamBtn');
const pfpCloseBtn = document.getElementById('pfpCloseBtn');

const pfpRating = document.getElementById('pfpRating');
const pfpRatingSub = document.getElementById('pfpRatingSub');
const pfpKdr = document.getElementById('pfpKdr');
const pfpKdaSub = document.getElementById('pfpKdaSub');
const pfpAdr = document.getElementById('pfpAdr');
const pfpKastSub = document.getElementById('pfpKastSub');
const pfpRecordLabel1 = document.getElementById('pfpRecordLabel1');
const pfpRecordVal1 = document.getElementById('pfpRecordVal1');
const pfpRecordSub1 = document.getElementById('pfpRecordSub1');
const pfpRecordLabel2 = document.getElementById('pfpRecordLabel2');
const pfpRecordVal2 = document.getElementById('pfpRecordVal2');
const pfpRecordSub2 = document.getElementById('pfpRecordSub2');

const pfpSideRoundsSub = document.getElementById('pfpSideRoundsSub');
const pfpAttackAdr = document.getElementById('pfpAttackAdr');
const pfpAtkBar = document.getElementById('pfpAtkBar');
const pfpDefenseAdr = document.getElementById('pfpDefenseAdr');
const pfpDefBar = document.getElementById('pfpDefBar');

const pfpOpeningDuelRate = document.getElementById('pfpOpeningDuelRate');
const pfpOpeningDuelSub = document.getElementById('pfpOpeningDuelSub');
const pfpTotalDamage = document.getElementById('pfpTotalDamage') || document.getElementById('pfpHeadshotRate');
const pfpDamageSub = document.getElementById('pfpDamageSub') || document.getElementById('pfpHeadshotSub');
const pfpHeadshotRate = pfpTotalDamage;
const pfpHeadshotSub = pfpDamageSub;
const pfpTeamDamage = document.getElementById('pfpTeamDamage');

const pfpWeaponsBody = document.getElementById('pfpWeaponsBody');
const pfpHistoryTitle = document.getElementById('pfpHistoryTitle');
const pfpHistoryCount = document.getElementById('pfpHistoryCount');
const pfpMatchesBody = document.getElementById('pfpMatchesBody');

let currentPfpAccountId = null;

async function openFullPlayerProfile(accountId) {
  currentPfpAccountId = accountId;

  // Close the quick reference card so modals don't stack awkwardly
  if (playerDetailBackdrop) playerDetailBackdrop.hidden = true;

  if (pfpAvatar) {
    pfpAvatar.src = '';
    pfpAvatar.hidden = true;
  }

  const profile = await window.hubAPI.getFullPlayerProfile(accountId);

  if (!profile) {
    pfpName.textContent = `Player #${accountId.slice(-4)}`;
    pfpAccountId.textContent = `Steam ID: ${accountId}`;
    pfpKicker.textContent = 'Player Dossier';
    pfpRating.textContent = '1.00';
    pfpRatingSub.textContent = 'Estimated skill';
    pfpKdr.textContent = '0.00';
    pfpKdaSub.textContent = '0K - 0D - 0A';
    pfpAdr.textContent = '0';
    pfpKastSub.textContent = '0% KAST';
    pfpRecordLabel1.textContent = 'Teammate Record';
    pfpRecordVal1.textContent = '0g · 0% WR';
    pfpRecordSub1.textContent = '0W - 0L';
    pfpRecordLabel2.textContent = 'Opponent Record';
    pfpRecordVal2.textContent = '0g · 0% WR';
    pfpRecordSub2.textContent = '0W - 0L';

    pfpSideRoundsSub.textContent = '0 Attack / 0 Defense Rnds';
    pfpAttackAdr.textContent = '0 ADR';
    if (pfpAtkBar) pfpAtkBar.style.width = '0%';
    pfpDefenseAdr.textContent = '0 ADR';
    if (pfpDefBar) pfpDefBar.style.width = '0%';

    pfpOpeningDuelRate.textContent = '0%';
    pfpOpeningDuelSub.textContent = '0 won / 0 duels';
    pfpTotalDamage.textContent = '0';
    pfpDamageSub.textContent = '0 ADR';
    pfpTeamDamage.textContent = '0';

    pfpWeaponsBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:16px">No weapon data recorded for this player</td></tr>';
    pfpHistoryTitle.textContent = 'Mutual Match History';
    pfpHistoryCount.textContent = '0 matches';
    pfpMatchesBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:16px">No mutual matches recorded</td></tr>';
  } else {
    pfpName.textContent = profile.name;
    pfpAccountId.textContent = `Steam ID: ${profile.accountId}`;
    pfpKicker.textContent = profile.isSelf ? 'Career Dossier' : 'Player Dossier';

    pfpRating.textContent = profile.dplRating.toFixed(2);
    pfpRatingSub.textContent = profile.isSelf ? 'Career Rating' : 'Estimated skill';
    pfpKdr.textContent = profile.kdr.toFixed(2);
    pfpKdaSub.textContent = `${profile.kills}K - ${profile.deaths}D - ${profile.assists}A`;
    pfpAdr.textContent = profile.adr;
    pfpKastSub.textContent = `${profile.kast}% KAST`;

    if (profile.isSelf) {
      pfpRecordLabel1.textContent = 'Career Record';
      pfpRecordVal1.textContent = `${profile.totalWins}W - ${profile.totalLosses}L`;
      pfpRecordSub1.textContent = `${profile.overallWinRate}% Win Rate`;
      pfpRecordLabel2.textContent = 'Total Matches';
      pfpRecordVal2.textContent = `${profile.totalMatches} matches`;
      pfpRecordSub2.textContent = `${profile.totalTies} tied`;
      pfpHistoryTitle.textContent = 'Personal Match History';
    } else {
      pfpRecordLabel1.textContent = 'Teammate Record';
      pfpRecordVal1.textContent = `${profile.matchesTogether}g · ${profile.winRateTogether}% WR`;
      pfpRecordSub1.textContent = `${profile.winsTogether}W - ${profile.lossesTogether}L`;
      pfpRecordLabel2.textContent = 'Opponent Record';
      pfpRecordVal2.textContent = `${profile.matchesAgainst}g · ${profile.winRateAgainst}% WR`;
      pfpRecordSub2.textContent = `${profile.winsAgainst}W - ${profile.lossesAgainst}L`;
      pfpHistoryTitle.textContent = 'Mutual Match History';
    }

    // Side ADR
    pfpSideRoundsSub.textContent = `${profile.attackRounds} Attack / ${profile.defenseRounds} Defense Rnds`;
    pfpAttackAdr.textContent = `${profile.attackAdr} ADR`;
    pfpDefenseAdr.textContent = `${profile.defenseAdr} ADR`;

    const maxAdr = Math.max(profile.attackAdr, profile.defenseAdr, 150);
    if (pfpAtkBar) pfpAtkBar.style.width = `${Math.min(100, Math.round((profile.attackAdr / maxAdr) * 100))}%`;
    if (pfpDefBar) pfpDefBar.style.width = `${Math.min(100, Math.round((profile.defenseAdr / maxAdr) * 100))}%`;

    // Opening Duels & Headshots & FF
    pfpOpeningDuelRate.textContent = `${profile.openingDuels.winRate}%`;
    pfpOpeningDuelSub.textContent = `${profile.openingDuels.won} won / ${profile.openingDuels.involved} duels`;
    pfpTotalDamage.textContent = (profile.damage ?? 0).toLocaleString();
    pfpDamageSub.textContent = `${profile.adr ?? 0} ADR`;
    pfpTeamDamage.textContent = profile.teamDamage.toLocaleString();

    // Weapons
    if (!profile.weapons || profile.weapons.length === 0) {
      pfpWeaponsBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:16px">No weapon data recorded for this player</td></tr>';
    } else {
      pfpWeaponsBody.innerHTML = profile.weapons.map((w) => {
        return `<tr>
          <td style="font-weight:600;color:var(--text-bright)">${escapeHtml(w.label)}</td>
          <td style="color:var(--text-muted)">${escapeHtml(w.category)}</td>
          <td style="text-align:right;font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--text-bright)">${w.kills}</td>
          <td style="text-align:right;color:var(--text-dim)">${w.damage.toLocaleString()}</td>
          <td style="text-align:right;color:var(--text-dim)">${w.kpr.toFixed(2)}</td>
          <td style="text-align:right;color:var(--text-dim)">${w.hits}</td>
          <td style="text-align:right;font-weight:600;color:var(--text-bright)">${w.hsPercent}%</td>
        </tr>`;
      }).join('');
    }

    // Match History
    pfpHistoryCount.textContent = `${profile.matchHistory.length} matches`;
    if (!profile.matchHistory || profile.matchHistory.length === 0) {
      pfpMatchesBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:16px">No mutual matches recorded</td></tr>';
    } else {
      pfpMatchesBody.innerHTML = profile.matchHistory.map((m) => {
        let resultBadge = '';
        if (m.tied) {
          resultBadge = '<span class="pfp-result-badge pfp-result-badge--tie">TIE</span>';
        } else if (m.playerWon) {
          resultBadge = '<span class="pfp-result-badge pfp-result-badge--win">WON</span>';
        } else {
          resultBadge = '<span class="pfp-result-badge pfp-result-badge--loss">LOST</span>';
        }

        let modeBadge = '';
        if (m.is2v2) {
          modeBadge = '<span class="source-badge source-badge--2v2" style="font-size:10px;padding:1px 5px">2v2</span>';
        } else if (m.isRanked) {
          modeBadge = '<span class="source-badge source-badge--ranked" style="font-size:10px;padding:1px 5px">RANKED</span>';
        } else {
          modeBadge = '<span class="source-badge source-badge--other" style="font-size:10px;padding:1px 5px">OTHER</span>';
        }

        let relText = 'Self';
        let relColor = 'var(--text-dim)';
        if (!m.isSelf) {
          if (m.isTeammate) {
            relText = 'Teammate';
            relColor = 'var(--accent)';
          } else if (m.isOpponent) {
            relText = 'Opponent';
            relColor = 'var(--rival)';
          } else {
            relText = 'Observed';
            relColor = 'var(--text-muted)';
          }
        }

        const scoreText = (m.myScore !== undefined && m.oppScore !== undefined) ? `${m.myScore} - ${m.oppScore}` : '—';
        const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

        return `<tr class="pfp-match-row" data-match-id="${escapeHtml(m.matchId)}" title="Click to view match scoreboard">
          <td>${resultBadge}</td>
          <td>${modeBadge}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(m.matchup)} (${escapeHtml(m.mapLabel)})">
            <span style="color:var(--text-bright);font-weight:600">${escapeHtml(m.matchup)}</span>
            <span style="font-size:11px;color:var(--text-muted);display:block">${escapeHtml(m.mapLabel)}</span>
          </td>
          <td style="text-align:center;font-weight:600;font-size:11px;color:${relColor}">${relText}</td>
          <td style="text-align:center;font-family:var(--font-display);font-weight:700">${scoreText}</td>
          <td style="text-align:right;font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--text-bright)">${m.kills} - ${m.deaths} - ${m.assists}</td>
          <td style="text-align:right;color:var(--text-dim)">${m.damage.toLocaleString()}</td>
          <td style="text-align:right;font-size:11px;color:var(--text-muted)">${dateStr}</td>
        </tr>`;
      }).join('');

      pfpMatchesBody.querySelectorAll('.pfp-match-row').forEach((row) => {
        row.addEventListener('click', () => {
          const matchId = row.dataset.matchId;
          if (matchId) {
            playerFullProfileBackdrop.hidden = true;
            openMatchDetail(matchId);
          }
        });
      });
    }
  }

  playerFullProfileBackdrop.hidden = false;

  if (window.hubAPI?.getSteamAvatar && accountId) {
    window.hubAPI.getSteamAvatar(accountId).then((avatarUrl) => {
      if (avatarUrl && pfpAvatar && currentPfpAccountId === accountId) {
        pfpAvatar.src = avatarUrl;
        pfpAvatar.hidden = false;
      }
    });
  }
}

function closeFullPlayerProfile() {
  if (playerFullProfileBackdrop) {
    playerFullProfileBackdrop.hidden = true;
  }
  currentPfpAccountId = null;
}

pfpSteamBtn?.addEventListener('click', () => {
  if (currentPfpAccountId) {
    window.hubAPI.openSteamProfile(currentPfpAccountId);
  }
});

pfpCloseBtn?.addEventListener('click', closeFullPlayerProfile);
playerFullProfileBackdrop?.addEventListener('click', (e) => {
  if (e.target === playerFullProfileBackdrop) closeFullPlayerProfile();
});

// CSV Export Handlers — one download helper shared by Home's export button
// (ranked, unchanged behavior) and the Ranked/Other History views' buttons.
async function triggerCsvDownload(which, filenamePrefix) {
  const csvText = await window.hubAPI.exportCsv(which);
  if (!csvText) return;
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenamePrefix}-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
  triggerCsvDownload(undefined, 'due-process-match-history');
});
document.getElementById('exportRankedHistoryCsvBtn')?.addEventListener('click', () => {
  triggerCsvDownload('ranked', 'due-process-ranked-history');
});
document.getElementById('exportOtherHistoryCsvBtn')?.addEventListener('click', () => {
  triggerCsvDownload('other', 'due-process-other-history');
});

// ---------------------------------------------------------------------
// Web Database Export (database.json, standalone .html, index.php)
// ---------------------------------------------------------------------

const exportWebDbBtn = document.getElementById('exportWebDbBtn');
const exportDbModalBackdrop = document.getElementById('exportDbModalBackdrop');
const exportDbModalClose = document.getElementById('exportDbModalClose');
const modalExportJsonBtn = document.getElementById('modalExportJsonBtn');
const modalExportHtmlBtn = document.getElementById('modalExportHtmlBtn');
const modalExportPhpBtn = document.getElementById('modalExportPhpBtn');
const modalDbSummary = document.getElementById('modalDbSummary');
const modalDbLastUpdated = document.getElementById('modalDbLastUpdated');

const settingsExportJsonBtn = document.getElementById('settingsExportJsonBtn');
const settingsExportHtmlBtn = document.getElementById('settingsExportHtmlBtn');
const settingsExportPhpBtn = document.getElementById('settingsExportPhpBtn');
const settingsOpenWebFolderBtn = document.getElementById('settingsOpenWebFolderBtn');
const settingsDbPlayerCount = document.getElementById('settingsDbPlayerCount');
const settingsDbMatchCount = document.getElementById('settingsDbMatchCount');

async function refreshWebDbStats() {
  try {
    const db = await window.hubAPI?.getGlobalDatabase?.();
    if (!db) return;
    const playersCount = db.players?.length || 0;
    const matchesCount = db.meta?.totalMatches || 0;

    if (modalDbSummary) {
      modalDbSummary.textContent = `${playersCount.toLocaleString()} players · ${matchesCount.toLocaleString()} ranked matches`;
    }
    if (modalDbLastUpdated) {
      modalDbLastUpdated.textContent = `Last updated: ${db.lastUpdated || 'Just now'}`;
    }
    if (settingsDbPlayerCount) {
      settingsDbPlayerCount.textContent = playersCount.toLocaleString();
    }
    if (settingsDbMatchCount) {
      settingsDbMatchCount.textContent = matchesCount.toLocaleString();
    }
  } catch (err) {
    console.error('Failed to fetch global database stats:', err);
  }
}

function openExportDbModal() {
  if (!exportDbModalBackdrop) return;
  refreshWebDbStats();
  exportDbModalBackdrop.hidden = false;
}

function closeExportDbModal() {
  if (!exportDbModalBackdrop) return;
  exportDbModalBackdrop.hidden = true;
}

async function triggerWebDbExport(type, triggerBtn) {
  const origText = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.textContent = 'Exporting...';
    triggerBtn.disabled = true;
  }

  try {
    // Attempt Electron native save dialog
    if (window.hubAPI?.saveWebDatabaseFile) {
      const res = await window.hubAPI.saveWebDatabaseFile(type);
      if (res && res.success) {
        if (triggerBtn) triggerBtn.textContent = 'Saved ✓';
        setTimeout(() => {
          if (triggerBtn) {
            triggerBtn.textContent = origText;
            triggerBtn.disabled = false;
          }
        }, 2000);
        return;
      } else if (res && res.canceled) {
        if (triggerBtn) {
          triggerBtn.textContent = origText;
          triggerBtn.disabled = false;
        }
        return;
      }
    }

    // Fallback: browser blob download
    const exportData = await window.hubAPI?.exportWebDatabase?.();
    if (!exportData) throw new Error('No export data received');

    let filename = 'database.json';
    let mime = 'application/json;charset=utf-8;';
    let content = exportData.json;

    if (type === 'html') {
      filename = 'players_database.html';
      mime = 'text/html;charset=utf-8;';
      content = exportData.html;
    } else if (type === 'php') {
      filename = 'index.php';
      mime = 'text/plain;charset=utf-8;';
      content = exportData.php;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (triggerBtn) {
      triggerBtn.textContent = 'Downloaded ✓';
      setTimeout(() => {
        triggerBtn.textContent = origText;
        triggerBtn.disabled = false;
      }, 2000);
    }
  } catch (err) {
    console.error('Export failed:', err);
    if (triggerBtn) {
      triggerBtn.textContent = 'Failed ⚠';
      setTimeout(() => {
        triggerBtn.textContent = origText;
        triggerBtn.disabled = false;
      }, 2000);
    }
  }
}

if (exportWebDbBtn) exportWebDbBtn.addEventListener('click', openExportDbModal);
if (exportDbModalClose) exportDbModalClose.addEventListener('click', closeExportDbModal);
if (exportDbModalBackdrop) {
  exportDbModalBackdrop.addEventListener('click', (e) => {
    if (e.target === exportDbModalBackdrop) closeExportDbModal();
  });
}

if (modalExportJsonBtn) modalExportJsonBtn.addEventListener('click', (e) => triggerWebDbExport('json', e.currentTarget));
if (modalExportHtmlBtn) modalExportHtmlBtn.addEventListener('click', (e) => triggerWebDbExport('html', e.currentTarget));
if (modalExportPhpBtn) modalExportPhpBtn.addEventListener('click', (e) => triggerWebDbExport('php', e.currentTarget));

if (settingsExportJsonBtn) settingsExportJsonBtn.addEventListener('click', (e) => triggerWebDbExport('json', e.currentTarget));
if (settingsExportHtmlBtn) settingsExportHtmlBtn.addEventListener('click', (e) => triggerWebDbExport('html', e.currentTarget));
if (settingsExportPhpBtn) settingsExportPhpBtn.addEventListener('click', (e) => triggerWebDbExport('php', e.currentTarget));
if (settingsOpenWebFolderBtn) settingsOpenWebFolderBtn.addEventListener('click', () => window.hubAPI?.openWebFolder?.());

// ---------------------------------------------------------------------
// Weapons — ranked-only lifetime per-weapon stats (see match-archive.js's
// getWeaponStats()). Headshots/HS% are null for a weapon stats.js has no
// base-damage reference for (explosives, unidentified codes) — rendered as
// "—" rather than a fake 0%, see stats.js's weaponBaseDamage comment.
// ---------------------------------------------------------------------

const weaponsBody = document.getElementById('weaponsBody');
const weaponsEmptyEl = document.getElementById('weaponsEmpty');
const weaponsContentEl = document.getElementById('weaponsContent');
const weaponsTable = document.getElementById('weaponsTable');
const weaponSearchInput = document.getElementById('weaponSearchInput');
const categoryFiltersEl = document.getElementById('categoryFilters');

let weaponSortKey = 'kills';
let weaponSortDir = 'desc';
let selectedCategory = 'all';
let searchFilterQuery = '';

function renderWeaponsTable() {
  const weapons = latestHubData?.weaponStats ?? [];
  const hasAny = weapons.length > 0;
  weaponsEmptyEl.hidden = hasAny;
  weaponsContentEl.hidden = !hasAny;
  if (!hasAny) return;

  // --- Render Summary Tiles ---
  const totalKills = weapons.reduce((acc, w) => acc + w.kills, 0);
  const totalHits = weapons.reduce((acc, w) => acc + (w.hits ?? 0), 0);
  const totalHeadshots = weapons.reduce((acc, w) => acc + (w.headshots ?? 0), 0);

  const topByKills = [...weapons].sort((a, b) => b.kills - a.kills)[0];
  const topByDeaths = [...weapons].sort((a, b) => b.deaths - a.deaths)[0];

  document.getElementById('weaponTotalKills').textContent = totalKills.toLocaleString();

  if (topByKills && topByKills.kills > 0) {
    document.getElementById('weaponTopName').textContent = topByKills.label;
    document.getElementById('weaponTopSub').textContent = `${topByKills.kills} kills`;
  } else {
    document.getElementById('weaponTopName').textContent = '—';
    document.getElementById('weaponTopSub').textContent = '0 kills';
  }

  document.getElementById('weaponOverallHs').textContent = totalHeadshots.toLocaleString();
  const overallHsPct = totalHits > 0 ? Math.round((totalHeadshots / totalHits) * 100) : 0;
  document.getElementById('weaponOverallHsSub').textContent = `${overallHsPct}% hit accuracy`;

  if (topByDeaths && topByDeaths.deaths > 0) {
    document.getElementById('weaponDeadliestName').textContent = topByDeaths.label;
    document.getElementById('weaponDeadliestSub').textContent = `${topByDeaths.deaths} deaths`;
  } else {
    document.getElementById('weaponDeadliestName').textContent = '—';
    document.getElementById('weaponDeadliestSub').textContent = '0 deaths';
  }

  // --- Filter by Category & Search Query ---
  let filtered = weapons;
  if (selectedCategory !== 'all') {
    filtered = filtered.filter((w) => {
      const cat = (w.category ?? '').toLowerCase();
      const sel = selectedCategory.toLowerCase();
      if ((sel === 'throwable' || sel === 'throwables') && (cat.includes('throwable') || cat.includes('explosive'))) return true;
      return cat.includes(sel);
    });
  }
  if (searchFilterQuery.trim()) {
    const q = searchFilterQuery.trim().toLowerCase();
    filtered = filtered.filter((w) => w.label.toLowerCase().includes(q) || (w.category ?? '').toLowerCase().includes(q));
  }

  // --- Sort Weapons ---
  const sorted = [...filtered].sort((a, b) => {
    if (a.unused !== b.unused) {
      return a.unused ? 1 : -1;
    }
    if (a.unused) {
      return a.label.localeCompare(b.label);
    }
    const av = a[weaponSortKey];
    const bv = b[weaponSortKey];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return weaponSortDir === 'asc' ? cmp : -cmp;
  });

  const maxKills = Math.max(...weapons.map((w) => w.kills), 1);

  weaponsBody.innerHTML = '';
  if (sorted.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;padding:30px;color:var(--text-muted)">No weapons matching current filter.</td>`;
    weaponsBody.appendChild(tr);
  } else {
    for (const w of sorted) {
      const tr = document.createElement('tr');
      if (w.unused) {
        tr.className = 'weapon-row--unused';
      }
      const hs = w.headshots === null || w.unused ? '<span class="no-data">—</span>' : w.headshots;
      const hsPct = w.hsPercent === null || w.unused ? '<span class="no-data">—</span>' : `<span class="hs-badge">${w.hsPercent}%</span>`;
      const killsPct = w.unused ? 0 : Math.round((w.kills / maxKills) * 100);
      const kprDisplay = w.unused ? '<span class="no-data">—</span>' : w.killsPerRound.toFixed(2);
      const unusedBadge = w.unused ? '<span class="weapon-unused-pill">UNUSED</span>' : '';
      const killsDisplay = w.unused
        ? `<span class="no-data" style="font-family:var(--font-display);font-size:15px;color:var(--text-faint)">—</span>`
        : `<span style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--accent)">${w.kills}</span>`;
      const deathsDisplay = w.unused && w.deaths === 0
        ? '<span class="no-data">—</span>'
        : `<span style="font-family:var(--font-display);font-size:16px;font-weight:600;color:${w.deaths > 0 ? 'var(--loss)' : 'var(--text-muted)'}">${w.deaths}</span>`;

      const specsList = [];
      if (w.fireType && w.fireType !== 'Unknown') specsList.push(w.fireType);
      if (w.rpm) specsList.push(`${w.rpm} RPM`);
      if (w.baseDamage) specsList.push(`${w.baseDamage} DMG`);
      const specsStr = specsList.length > 0 ? specsList.join(' · ') : 'Standard Weapon';
      const wikiUrl = w.wikiUrl || `https://dueprocess.fandom.com/wiki/${encodeURIComponent(w.label)}`;
      const imgHtml = w.imageUrl
        ? `<img src="${w.imageUrl}" alt="${escapeHtml(w.label)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex';" style="width:68px;height:38px;object-fit:contain;background:rgba(0,0,0,0.35);padding:2px;border:1px solid var(--border-soft);border-radius:3px"><div style="display:none;width:68px;height:38px;background:rgba(255,255,255,0.03);border:1px solid var(--border-soft);align-items:center;justify-content:center;color:var(--text-faint);font-size:10px;font-family:var(--font-display)">WPN</div>`
        : `<div style="width:68px;height:38px;background:rgba(255,255,255,0.03);border:1px solid var(--border-soft);display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:10px;font-family:var(--font-display)">WPN</div>`;

      tr.innerHTML = `
        <td>
          <div style="display:flex;align-items:center;gap:14px;padding:4px 0">
            <a href="${wikiUrl}" class="weapon-wiki-btn" data-wikiurl="${wikiUrl}" title="View ${escapeHtml(w.label)} on Fandom Wiki ↗" style="display:block;cursor:pointer;transition:transform 0.15s ease">
              ${imgHtml}
            </a>
            <div class="weapon-cell">
              <div>
                <span class="weapon-cat">${escapeHtml((w.category ?? 'WEAPON').toUpperCase())}</span>
                ${unusedBadge}
              </div>
              <a href="${wikiUrl}" class="weapon-wiki-btn" data-wikiurl="${wikiUrl}" title="View ${escapeHtml(w.label)} on Fandom Wiki ↗" style="color:var(--text-bright);text-decoration:none">
                <span class="weapon-title" style="color:var(--text-bright);font-weight:700">${escapeHtml(w.label)} <span style="font-size:11px;color:var(--accent);margin-left:2px">↗</span></span>
              </a>
              <span class="weapon-specs">${escapeHtml(specsStr)}</span>
            </div>
          </div>
        </td>
        <td style="text-align:center">
          <div class="kills-col">
            ${killsDisplay}
            <div class="kills-bar"><span style="width:${killsPct}%"></span></div>
          </div>
        </td>
        <td style="text-align:center">${deathsDisplay}</td>
        <td style="text-align:center;font-family:var(--font-display);font-size:15px">${hs}</td>
        <td style="text-align:center">${hsPct}</td>
        <td style="text-align:center;font-family:var(--font-display);font-size:15px;font-weight:600">${kprDisplay}</td>
      `;

      tr.querySelectorAll('.weapon-wiki-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetUrl = btn.dataset.wikiurl;
          if (targetUrl && window.hubAPI?.openExternal) {
            window.hubAPI.openExternal(targetUrl);
          }
        });
      });

      weaponsBody.appendChild(tr);
    }
  }

  for (const th of weaponsTable.querySelectorAll('th[data-sort]')) {
    th.classList.toggle('sort-active', th.dataset.sort === weaponSortKey);
    th.querySelector('.sort-arrow')?.remove();
    if (th.dataset.sort === weaponSortKey) {
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = weaponSortDir === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
    }
  }
}

for (const th of weaponsTable.querySelectorAll('th[data-sort]')) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (weaponSortKey === key) {
      weaponSortDir = weaponSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      weaponSortKey = key;
      weaponSortDir = 'desc';
    }
    renderWeaponsTable();
  });
}

categoryFiltersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.cat-pill');
  if (!btn) return;
  selectedCategory = btn.dataset.cat;
  categoryFiltersEl.querySelectorAll('.cat-pill').forEach((el) => el.classList.toggle('active', el === btn));
  renderWeaponsTable();
});

weaponSearchInput.addEventListener('input', (e) => {
  searchFilterQuery = e.target.value;
  renderWeaponsTable();
});

function getBadgeClassForTag(tag) {
  const lower = String(tag).toLowerCase();
  if (lower === 'ranked') return 'ranked';
  if (lower === '2v2') return '2v2';
  if (lower === 'scrim') return 'scrim';
  if (lower === 'tournament') return 'tournament';
  if (lower === 'casual') return 'casual';
  if (lower === 'spectated') return 'spectated';
  return 'custom';
}

// Shared by Home's unified feed and both History views — same row shape
// (result/map/score/K-D-A/played/delete) everywhere; Home and Other History
// tag rows with badges for their assigned tags.
function renderMatchRows(tbody, matches, opts = {}) {
  tbody.innerHTML = '';
  for (const m of matches) {
    const tr = document.createElement('tr');
    tr.dataset.matchId = m.matchId;
    tr.title = 'Click for the full scoreboard';
    const resultClass = m.isSpectator ? 'result-spectate' : (m.tied ? 'result-tie' : m.won ? 'result-win' : 'result-loss');
    const resultText = m.isSpectator ? 'SPEC' : (m.tied ? 'TIE' : m.won ? 'WIN' : 'LOSS');
    const matchTags = Array.isArray(m.tags) && m.tags.length > 0
      ? m.tags
      : (m.isSpectator ? ['Spectated'] : (m.source === 'ranked' ? ['Ranked'] : (m.is2v2 ? ['2v2'] : ['Casual'])));
    const sourceBadge = (opts.tagSource || matchTags.length > 0)
      ? matchTags.map((tag) => `<span class="source-badge source-badge--${getBadgeClassForTag(tag)}">${escapeHtml(String(tag).toUpperCase())}</span>`).join('')
      : '';
    const myScoreClass = m.isSpectator ? '' : (m.tied ? '' : m.won ? '' : 'result-loss');
    const oppScoreClass = m.isSpectator ? '' : (m.tied ? '' : m.won ? 'result-win' : '');
    const kdaDisplay = m.isSpectator ? '—' : `${m.kills} - ${m.deaths} - ${m.assists}`;
    tr.innerHTML = `
      <td class="${resultClass}" style="letter-spacing:.1em">${resultText}</td>
      <td>${escapeHtml(m.matchup || `${m.team0Name || 'Blue Team'} vs ${m.team1Name || 'Orange Team'}`)}${sourceBadge}</td>
      <td style="text-align:center"><span class="${myScoreClass}">${m.myScore}</span> – <span class="${oppScoreClass}">${m.oppScore}</span></td>
      <td style="text-align:center;white-space:nowrap;font-family:var(--font-display);font-weight:600;min-width:90px">${kdaDisplay}</td>
      <td style="text-align:right;font-family:var(--font-body);font-size:11px;color:var(--text-muted);white-space:nowrap">${timeAgo(m.timestamp)}</td>
      <td style="text-align:center"><button class="delete-match-btn" title="Delete this match" aria-label="Delete this match">&times;</button></td>
    `;
    tr.addEventListener('click', () => openMatchDetail(m.matchId));
    tr.querySelector('.delete-match-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger the row's open-detail click
      const matchup = m.matchup || `${m.team0Name || 'Blue Team'} vs ${m.team1Name || 'Orange Team'}`;
      confirmAndDeleteMatch(m.matchId, matchup);
    });
    tbody.appendChild(tr);
  }
}

async function confirmAndDeleteMatch(matchId, matchup) {
  const label = matchup ? ` (${matchup})` : '';
  const ok = window.confirm(`Delete this match${label}? This can't be undone.`);
  if (!ok) return false;
  await window.hubAPI.deleteMatch(matchId);
  // No manual re-render call needed for Home/stat data: main.js's delete
  // handler pushes a fresh hub:update (totals/lists re-derived from the
  // archive) on success, and render() above re-fetches whichever history
  // view is currently open. If the deleted row was IN a history view,
  // that re-fetch picks up the removal too.
  return true;
}

// ---------------------------------------------------------------------
// Match-detail view — click-through from any of the three match lists.
// Reads the full archived record for that one match (see match-archive.js
// / rescan.js) via IPC and renders it with scoreboard-view.js, the same
// team-scoreboard renderer the live overlay uses. Works even after the
// source Player.log has rotated away, since the whole point of archiving
// full data is not depending on the raw log surviving.
// ---------------------------------------------------------------------

const matchDetailBackdrop = document.getElementById('matchDetailBackdrop');
const matchDetailTeams = document.getElementById('matchDetailTeams');
const matchDetailMeta = document.getElementById('matchDetailMeta');
const matchDetailExportTextBtn = document.getElementById('matchDetailExportText');
const matchDetailExportImageBtn = document.getElementById('matchDetailExportImage');
const matchDetailRoundTimelinePanel = document.getElementById('matchDetailRoundTimelinePanel');
const matchDetailRoundTitle = document.getElementById('matchDetailRoundTitle');
const matchDetailRoundScoreBadge = document.getElementById('matchDetailRoundScoreBadge');
const matchDetailPrevRoundBtn = document.getElementById('matchDetailPrevRoundBtn');
const matchDetailNextRoundBtn = document.getElementById('matchDetailNextRoundBtn');
const matchDetailRoundKillList = document.getElementById('matchDetailRoundKillList');

let matchDetailCurrentId = null;
let matchDetailCurrentMatchup = null;
let matchDetailCurrentMatch = null;
let matchDetailSelectedRoundIndex = 0;
let matchDetailRoundCards = [];

const TILESET_ICONS = {
  factory: 'assets/tilesets/factory.webp',
  killhouse: 'assets/tilesets/killhouse.webp',
  killhouse_day: 'assets/tilesets/killhouse.webp',
  bank: 'assets/tilesets/bank.webp',
  cstore: 'assets/tilesets/cstore.webp',
  dome: 'assets/tilesets/dome.webp',
  killdome: 'assets/tilesets/dome.webp',
};

function getTilesetIconPath(tileset) {
  if (!tileset) return null;
  const key = tileset.toLowerCase().replace(/_day$/i, '');
  return TILESET_ICONS[key] || TILESET_ICONS[tileset.toLowerCase()] || null;
}

async function openMatchDetail(matchId) {
  const match = await window.hubAPI.getMatchDetail(matchId);
  if (!match) return; // shouldn't happen (row came from an archive itself), but don't render a broken panel if it does

  matchDetailCurrentId = matchId;
  matchDetailCurrentMatchup = match.matchup || `${match.team0Name || 'Blue Team'} vs ${match.team1Name || 'Orange Team'}`;
  matchDetailCurrentMatch = match;
  matchDetailRoundCards = [];

  const matchDetailMapContainer = document.getElementById('matchDetailMapContainer');
  if (matchDetailMapContainer) {
    matchDetailMapContainer.innerHTML = '';
    const mapRounds = match.mapRounds || match.roundMaps || [];
    const totalRounds = match.roundCount || mapRounds.length || 9;

    // Halftime/side-switch happens whenever this player's role flips —
    // Ranked BO12 swaps sides every 3 rounds, not once at round 6 — a
    // defense-starting player's roles run ddd|aaa|aaa|ddd (rounds 7-9 keep
    // the round 4-6 role; the map set changes there, the side doesn't), so
    // there are two side-switch points in a full match, at 3/4 and 9/10, not
    // one. Other modes differ again (see rescan.js's isRankedFinalScore
    // comment), so this is found from the actual per-round sideRole data
    // rather than assumed at any fixed round. If no round in this match
    // carries sideRole (older archive record, recorded before that field
    // existed), no dividers are drawn rather than guessing.
    const switchIndices = new Set();
    for (let i = 1; i < mapRounds.length; i++) {
      const prevRole = mapRounds[i - 1]?.sideRole;
      const curRole = mapRounds[i]?.sideRole;
      if (prevRole && curRole && prevRole !== curRole) switchIndices.add(i);
    }

    const roundLayoutKey = (r) => {
      if (typeof r === 'string') return r.replace(/_Day$/i, '');
      if (r && typeof r === 'object') {
        const tileset = r.tileset && r.tileset !== 'Unknown' ? r.tileset.replace(/_Day$/i, '') : null;
        const mapName = r.mapName && r.mapName !== 'Unknown' ? r.mapName : null;
        return tileset || mapName ? `${tileset ?? ''}|${mapName ?? ''}` : null;
      }
      return null;
    };
    // Map change is a separate event from a role switch, and NOT the same
    // as "this round's map differs from the previous round's" — within a
    // block the 3 maps repeat, but not necessarily in the same fixed order
    // each half: one real match went Dome,CStore,Killhouse,Dome,CStore,
    // Killhouse (positional A,B,C,A,B,C repeat), another went Factory,
    // CStore,Factory,CStore,Bank,Bank (paired, not a strict rotation) — a
    // "does round i match round i-3" comparison breaks on the second shape.
    // What both share: a block uses exactly 3 distinct maps before a new
    // one starts. So this tracks the *set* of distinct maps seen since the
    // last confirmed block start, and marks a new block when a round's map
    // isn't in that set once it's already collected 3 — order-independent,
    // verified against both real match shapes above.
    const mapChangeIndices = new Set();
    let blockMaps = new Set();
    for (let i = 0; i < mapRounds.length; i++) {
      const key = roundLayoutKey(mapRounds[i]);
      if (!key) continue; // missing data — don't count it, but don't reset the block either
      if (blockMaps.size >= 3 && !blockMaps.has(key)) {
        mapChangeIndices.add(i);
        blockMaps = new Set();
      }
      blockMaps.add(key);
    }

    // Fallback for legacy archived matches whose later rounds' data is
    // permanently gone (source log rotated away before the relevant fixes
    // existed) — round 7's map/role isn't derivable, so the loops above
    // can't detect a transition that did happen. Ranked's map-set swap at
    // round 6/7 and role swaps at 3/4 and 9/10 are confirmed structural
    // facts (verified against real match data, not a guess the way
    // round <= 6 "halftime" was), so they're asserted here specifically as
    // fallbacks — only for confirmed-ranked matches, only at these three
    // known points, only when there wasn't real data to derive them from,
    // and never overriding real data that says otherwise.
    if (match.isRanked) {
      if (mapRounds.length > 6 && !mapChangeIndices.has(6) && !roundLayoutKey(mapRounds[6])) {
        mapChangeIndices.add(6);
      }
      for (const idx of [3, 9]) {
        if (mapRounds.length > idx && !switchIndices.has(idx) && !mapRounds[idx - 1]?.sideRole && !mapRounds[idx]?.sideRole) {
          switchIndices.add(idx);
        }
      }
    }

    for (let i = 0; i < totalRounds; i++) {
      const roundNum = i + 1;

      // Both can apply at the same boundary (e.g. a mode whose map rotation
      // and role rotation cadence happen to line up) — render whichever do,
      // rather than picking one.
      if (mapChangeIndices.has(i)) {
        const divider = document.createElement('div');
        divider.className = 'map-change-divider';
        divider.title = 'Map Change';
        matchDetailMapContainer.appendChild(divider);
      }
      if (switchIndices.has(i)) {
        const divider = document.createElement('div');
        divider.className = 'halftime-divider';
        divider.title = 'Side Switch';
        matchDetailMapContainer.appendChild(divider);
      }

      const r = mapRounds[i];
      // No plausible-looking default here — a missing tileset/mapName means
      // the data genuinely wasn't captured for this round (see the map-line
      // interleaving/watcher-timing gap this was investigated for), and
      // showing e.g. a Dome icon would misrepresent that as real data.
      let tileset = null;
      let mapName = null;
      let isWon = match.won;
      let roundResult = null;
      let myKills = null;

      if (typeof r === 'string') {
        const tm = /^\[([^\]]+)\]/.exec(r);
        if (tm) tileset = tm[1];
        mapName = r.replace(/^\[[^\]]+\]\s*/, '');
      } else if (r && typeof r === 'object') {
        if (r.tileset && r.tileset !== 'Unknown') tileset = r.tileset;
        if (r.mapName && r.mapName !== 'Unknown') mapName = r.mapName;
        if (typeof r.won === 'boolean') isWon = r.won;
        roundResult = r.roundResult ?? null;
        myKills = typeof r.myKills === 'number' ? r.myKills : null;
      }

      if (match.isSpectator && r && typeof r === 'object' && r.winnerSide !== undefined && r.winnerSide !== null) {
        isWon = r.winnerSide === 0;
      }

      const tilesetClean = tileset ? tileset.replace(/_Day$/i, '') : null;
      const card = document.createElement('div');
      const resultClass = isWon ? 'match-map-card--win' : 'match-map-card--loss';
      // Save = the attacking side had a survivor when a non-defuse round
      // ended (didn't get fully wiped, didn't defuse in time either) — see
      // rescan.js's roundResult classification. Shown as a spiky/star shape
      // instead of the normal rounded square; older archive records without
      // roundResult (recorded before this field existed) just get the
      // normal shape rather than a guess.
      const isSave = roundResult === 'save';
      card.className = `match-map-card ${resultClass}${isSave ? ' match-map-card--save' : ''}`;
      const winnerName = (r && typeof r === 'object' && r.winnerSide === 1) ? (match.team1Name || 'Orange Team') : (match.team0Name || 'Blue Team');
      const resultSuffix = match.isSpectator ? `${winnerName} WON` : (isWon ? 'WIN' : 'LOSS');
      const saveSuffix = isSave ? ' — SAVE' : '';
      card.title = tilesetClean
        ? `Round ${roundNum}: [${tilesetClean}] ${mapName ?? ''} (${resultSuffix}${saveSuffix})`
        : `Round ${roundNum}: Unknown map (${resultSuffix}${saveSuffix})`;

      const iconSrc = tilesetClean ? getTilesetIconPath(tilesetClean) : null;
      const iconHtml = iconSrc
        ? `<img class="match-map-card__icon" src="${iconSrc}" alt="R${roundNum}" />`
        : `<span style="font-size:10px;font-weight:700">${tilesetClean ? escapeHtml(tilesetClean.slice(0, 2)) : '?'}</span>`;

      card.innerHTML = iconHtml;
      const roundIdx = i;
      card.addEventListener('click', () => selectMatchDetailRound(roundIdx, match));
      matchDetailRoundCards.push(card);

      // Your own kill count for this round, shown as small reticle marks
      // above the card — only reliable now that the round-ending kill
      // (previously sometimes missing from Stats::Kill entirely, same gap
      // roundResult above corrects for) is cross-referenced against the
      // real-time killfeed too. Older archive records without myKills
      // (recorded before this field existed) just show no marks rather
      // than a guess.
      const column = document.createElement('div');
      column.className = 'round-column';
      const marksRow = document.createElement('div');
      marksRow.className = 'round-kill-marks';
      if (myKills !== null && myKills > 0) {
        marksRow.title = `${myKills} kill${myKills === 1 ? '' : 's'} this round`;
        for (let k = 0; k < myKills; k++) {
          const mark = document.createElement('span');
          mark.className = 'round-kill-mark';
          marksRow.appendChild(mark);
        }
      }
      column.appendChild(marksRow);
      column.appendChild(card);
      matchDetailMapContainer.appendChild(column);
    }
  }

  if (matchDetailPrevRoundBtn) {
    matchDetailPrevRoundBtn.onclick = () => selectMatchDetailRound(matchDetailSelectedRoundIndex - 1, match);
  }
  if (matchDetailNextRoundBtn) {
    matchDetailNextRoundBtn.onclick = () => selectMatchDetailRound(matchDetailSelectedRoundIndex + 1, match);
  }
  if (matchDetailExportTextBtn) {
    matchDetailExportTextBtn.onclick = () => exportRoundOutcomesText(match);
  }
  if (matchDetailExportImageBtn) {
    matchDetailExportImageBtn.onclick = () => exportRoundOutcomesImage(match);
  }
  selectMatchDetailRound(0, match);

function updateMatchDetailMeta(match) {
  const modeClass = match.isRanked ? 'ranked' : match.is2v2 ? '2v2' : 'other';
  const modeText = match.modeOverride ? match.modeOverride.toUpperCase() : (match.isRanked ? 'RANKED' : match.is2v2 ? '2v2' : 'OTHER');
  const spectatorBadge = match.isSpectator ? '<span class="source-badge source-badge--spectated" style="margin-left:0;margin-right:6px">SPECTATED</span>' : '';
  const inferredNote = match.inferred ? ' · INFERRED (no matchEnded seen)' : '';
  matchDetailMeta.innerHTML = `${spectatorBadge}<span class="source-badge source-badge--${modeClass}" style="margin-left:0;margin-right:6px">${modeText}</span>${match.roundCount} rounds${inferredNote}`;
}

function renderMatchDetailTags(match) {
  const container = document.getElementById('matchDetailTagsList');
  if (!container) return;
  container.innerHTML = '';

  const tags = Array.isArray(match.tags) ? match.tags : [];

  for (const tag of tags) {
    const pill = document.createElement('span');
    pill.className = 'match-tag-pill active';
    pill.innerHTML = `${escapeHtml(tag)}<span class="match-tag-pill-remove" title="Remove tag">&times;</span>`;
    pill.querySelector('.match-tag-pill-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const updated = tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
        match.tags = updated;
        await window.hubAPI.setMatchTags(match.matchId, updated);
        renderMatchDetailTags(match);
        if (currentView === 'ranked' || currentView === 'other') fetchAndRenderHistory(currentView);
      } catch (err) {
        console.error('Failed to remove tag:', err);
      }
    });
    container.appendChild(pill);
  }

  const PRESET_QUICK_TAGS = ['Spectated', 'Scrim', 'Tournament', 'Warmup', 'Casual', 'Custom'];
  for (const preset of PRESET_QUICK_TAGS) {
    if (tags.some((t) => t.toLowerCase() === preset.toLowerCase())) continue;
    const pill = document.createElement('span');
    pill.className = 'match-tag-pill match-tag-pill--preset';
    pill.textContent = `+ ${preset}`;
    pill.addEventListener('click', async () => {
      try {
        const updated = [...tags, preset];
        match.tags = updated;
        await window.hubAPI.setMatchTags(match.matchId, updated);
        renderMatchDetailTags(match);
        if (currentView === 'ranked' || currentView === 'other') fetchAndRenderHistory(currentView);
      } catch (err) {
        console.error('Failed to add preset tag:', err);
      }
    });
    container.appendChild(pill);
  }
}

  const modeSelect = document.getElementById('matchDetailModeSelect');
  if (modeSelect) {
    const currentMode = match.modeOverride || (match.isRanked ? 'Ranked' : match.is2v2 ? '2v2' : 'Casual');
    const matchedOption = [...modeSelect.options].find((opt) => opt.value.toLowerCase() === currentMode.toLowerCase());
    if (matchedOption) {
      modeSelect.value = matchedOption.value;
    } else {
      modeSelect.value = currentMode;
    }
    modeSelect.onchange = async () => {
      const newMode = modeSelect.value;
      try {
        const ok = await window.hubAPI.setMatchMode(matchDetailCurrentId, newMode);
        if (ok) {
          match.isRanked = newMode.toLowerCase() === 'ranked';
          match.is2v2 = newMode.toLowerCase() === '2v2';
          match.modeOverride = newMode;
          if (!match.tags) match.tags = [];
          const cleanOldModeTags = match.tags.filter((t) => {
            const low = t.toLowerCase();
            return low !== 'ranked' && low !== 'casual' && low !== 'other' && low !== '2v2' && low !== 'scrim' && low !== 'custom' && low !== 'tournament';
          });
          match.tags = [newMode, ...cleanOldModeTags];
          renderMatchDetailTags(match);
          updateMatchDetailMeta(match);
          if (currentView === 'ranked' || currentView === 'other') {
            await fetchAndRenderHistory(currentView);
          }
        }
      } catch (err) {
        console.error('Failed to set match mode:', err);
      }
    };
  }

  const tagInput = document.getElementById('matchDetailTagInput');
  const addTagBtn = document.getElementById('matchDetailAddTagBtn');
  const handleAddTag = async () => {
    if (!tagInput || !tagInput.value.trim() || !matchDetailCurrentId) return;
    const newTag = tagInput.value.trim();
    tagInput.value = '';
    try {
      const tags = Array.isArray(match.tags) ? match.tags : [];
      if (!tags.some((t) => t.toLowerCase() === newTag.toLowerCase())) {
        const updated = [...tags, newTag];
        match.tags = updated;
        await window.hubAPI.setMatchTags(matchDetailCurrentId, updated);
        renderMatchDetailTags(match);
        if (currentView === 'ranked' || currentView === 'other') fetchAndRenderHistory(currentView);
      }
    } catch (err) {
      console.error('Failed to add custom tag:', err);
    }
  };
  if (addTagBtn) addTagBtn.onclick = handleAddTag;
  if (tagInput) {
    tagInput.onkeydown = (e) => {
      if (e.key === 'Enter') handleAddTag();
    };
  }

  renderMatchDetailTags(match);
  updateMatchDetailMeta(match);

  renderScoreboardTeams(matchDetailTeams, {
    finalScore: match.finalScore,
    teams: match.teams,
    localAccountId: match.localAccountId,
  });
  // Same click-to-open-Player-Quick-Reference wiring the Live Match tab
  // already uses (see attachPlayerClickHandlers's doc comment) — reused
  // as-is rather than building a second modal for match-detail specifically.
  attachPlayerClickHandlers(matchDetailTeams);
  matchDetailBackdrop.hidden = false;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showHubToast(message, kind = 'info') {
  if (!mapScreenshotToast) return;
  mapScreenshotToast.textContent = message;
  mapScreenshotToast.className = kind === 'error' ? 'toast--error' : '';
  mapScreenshotToast.hidden = false;
  clearTimeout(mapScreenshotToastTimer);
  mapScreenshotToastTimer = setTimeout(() => {
    mapScreenshotToast.hidden = true;
  }, 4000);
}

function selectMatchDetailRound(roundIndex, match) {
  const mapRounds = match?.mapRounds || match?.roundMaps || [];
  const totalRounds = match?.roundCount || mapRounds.length || 0;
  if (totalRounds <= 0) {
    if (matchDetailRoundTimelinePanel) matchDetailRoundTimelinePanel.hidden = true;
    return;
  }
  if (matchDetailRoundTimelinePanel) matchDetailRoundTimelinePanel.hidden = false;
  if (roundIndex < 0) roundIndex = 0;
  if (roundIndex >= totalRounds) roundIndex = totalRounds - 1;
  matchDetailSelectedRoundIndex = roundIndex;

  // Highlight active round card
  matchDetailRoundCards.forEach((c, idx) => {
    if (c) c.classList.toggle('is-active', idx === roundIndex);
  });

  // Prev / Next button states
  if (matchDetailPrevRoundBtn) matchDetailPrevRoundBtn.disabled = roundIndex <= 0;
  if (matchDetailNextRoundBtn) matchDetailNextRoundBtn.disabled = roundIndex >= totalRounds - 1;

  const r = mapRounds[roundIndex];
  if (!r) {
    if (matchDetailRoundTitle) matchDetailRoundTitle.textContent = `ROUND ${roundIndex + 1}`;
    if (matchDetailRoundKillList) matchDetailRoundKillList.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-style:italic;font-size:12px">No data for this round.</div>';
    return;
  }

  let tileset = r.tileset && r.tileset !== 'Unknown' ? r.tileset.replace(/_Day$/i, '') : null;
  let mapName = r.mapName && r.mapName !== 'Unknown' ? r.mapName : (r.mapLabel || 'Unknown Map');
  if (typeof r === 'string') {
    const tm = /^\[([^\]]+)\]/.exec(r);
    if (tm) tileset = tm[1];
    mapName = r.replace(/^\[[^\]]+\]\s*/, '');
  }
  const roundNum = r.round || (roundIndex + 1);
  const roleText = r.sideRole ? ` · ${r.sideRole}` : '';
  const winnerName = (r && typeof r === 'object' && r.winnerSide === 1) ? (match?.team1Name || 'Orange Team') : (match?.team0Name || 'Blue Team');
  const resultText = match?.isSpectator
    ? (r.winnerSide !== undefined && r.winnerSide !== null ? ` · ${winnerName} WON` : '')
    : (typeof r.won === 'boolean' ? (r.won ? ' · WIN' : ' · LOSS') : '');
  const conditionText = r.roundResult ? ` (${r.roundResult.toUpperCase()})` : '';

  if (matchDetailRoundTitle) {
    const mapPart = tileset ? `[${tileset.toUpperCase()}] ${mapName.toUpperCase()}` : mapName.toUpperCase();
    matchDetailRoundTitle.textContent = `ROUND ${roundNum} · ${mapPart}${roleText}${resultText}${conditionText}`;
  }

  // Running score up to this round
  let score0 = 0;
  let score1 = 0;
  for (let i = 0; i <= roundIndex && i < mapRounds.length; i++) {
    const mr = mapRounds[i];
    if (mr && mr.winnerSide === 0) score0++;
    else if (mr && mr.winnerSide === 1) score1++;
  }
  if (matchDetailRoundScoreBadge) {
    matchDetailRoundScoreBadge.textContent = `Running Score: ${score0} - ${score1}`;
  }

  // Populate Kill timeline
  if (matchDetailRoundKillList) {
    matchDetailRoundKillList.innerHTML = '';
    const kills = r.kills;
    if (!kills) {
      matchDetailRoundKillList.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-style:italic;font-size:12px">No kill timeline recorded for this round (older archive record).</div>';
      return;
    }
    if (kills.length === 0) {
      matchDetailRoundKillList.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-style:italic;font-size:12px">No kills occurred in this round.</div>';
      return;
    }

    kills.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'round-kill-row';

      // Time stamps removed from kill feed per user request

      const killerEl = document.createElement('span');
      killerEl.className = `round-kill-actor ${k.isPit ? 'round-kill-actor--pit' : (k.killerSide === 0 ? 'round-kill-actor--side0' : k.killerSide === 1 ? 'round-kill-actor--side1' : '')}`;
      killerEl.textContent = k.killerName || (k.isPit ? 'PIT' : 'Unknown');
      row.appendChild(killerEl);

      const weaponEl = document.createElement('span');
      weaponEl.className = 'round-kill-weapon';
      weaponEl.textContent = k.weapon || (k.isPit ? 'Pit' : 'Killed');
      row.appendChild(weaponEl);

      const arrowEl = document.createElement('span');
      arrowEl.className = 'round-kill-arrow';
      arrowEl.textContent = '➔';
      row.appendChild(arrowEl);

      const victimEl = document.createElement('span');
      victimEl.className = `round-kill-actor ${k.victimSide === 0 ? 'round-kill-actor--side0' : k.victimSide === 1 ? 'round-kill-actor--side1' : ''}`;
      victimEl.textContent = k.victimName || 'Unknown';
      row.appendChild(victimEl);

      if (k.isTeamKill) {
        const tkBadge = document.createElement('span');
        tkBadge.className = 'round-kill-badge round-kill-badge--tk';
        tkBadge.textContent = 'TEAM KILL';
        row.appendChild(tkBadge);
      }
      if (k.isPit) {
        const pitBadge = document.createElement('span');
        pitBadge.className = 'round-kill-badge round-kill-badge--pit';
        pitBadge.textContent = 'PIT CLAIM';
        row.appendChild(pitBadge);
      } else if (k.isEnvironment) {
        const envBadge = document.createElement('span');
        envBadge.className = 'round-kill-badge round-kill-badge--env';
        envBadge.textContent = 'ENV';
        row.appendChild(envBadge);
      }

      matchDetailRoundKillList.appendChild(row);
    });
  }
}

async function exportRoundOutcomesText(match) {
  if (!match) return;
  const mapRounds = match.mapRounds || match.roundMaps || [];
  const team0 = match.team0Name || 'Blue Team';
  const team1 = match.team1Name || 'Orange Team';
  const score0 = match.finalScore?.side0 ?? match.myScore ?? 0;
  const score1 = match.finalScore?.side1 ?? match.oppScore ?? 0;
  const dateStr = match.timestamp ? new Date(match.timestamp).toLocaleString() : 'Unknown Date';
  const modeStr = match.modeOverride || (match.isRanked ? 'Ranked' : match.is2v2 ? '2v2' : 'Casual');
  const outcomeSummary = match.isSpectator ? 'SPECTATED' : (match.tied ? 'TIE' : (match.won ? 'WIN' : 'LOSS'));

  const lines = [
    '========================================================================',
    '                   DUE PROCESS — ROUND OUTCOMES REPORT                   ',
    '========================================================================',
    `Matchup:     ${team0} vs ${team1}`,
    `Final Score: ${score0} - ${score1} (${outcomeSummary})`,
    `Mode:        ${modeStr}`,
    `Date:        ${dateStr}`,
    `Rounds:      ${mapRounds.length}`,
    '------------------------------------------------------------------------',
    ' ROUND-BY-ROUND OUTCOMES (Summary):',
    '------------------------------------------------------------------------',
  ];

  let running0 = 0;
  let running1 = 0;
  let prevRole = null;

  mapRounds.forEach((r, idx) => {
    const roundNum = r.round || (idx + 1);
    const tileset = r.tileset && r.tileset !== 'Unknown' ? r.tileset.replace(/_Day$/i, '') : '';
    const mapName = r.mapName && r.mapName !== 'Unknown' ? r.mapName : (r.mapLabel || 'Unknown Map');
    const mapStr = tileset ? `[${tileset}] ${mapName}` : mapName;
    const role = r.sideRole || (match.isSpectator ? 'N/A' : 'UNKNOWN');
    const winnerName = r.winnerSide === 1 ? team1 : team0;
    const result = match.isSpectator
      ? `${winnerName} WON`
      : (typeof r.won === 'boolean' ? (r.won ? 'WIN' : 'LOSS') : (r.winnerSide === 0 ? 'TEAM 0' : 'TEAM 1'));
    const condition = r.roundResult ? ` (${r.roundResult.toUpperCase()})` : '';

    if (r.winnerSide === 0) running0++;
    else if (r.winnerSide === 1) running1++;

    if (prevRole && r.sideRole && prevRole !== r.sideRole) {
      lines.push('  --- [SIDE SWITCH] ---');
    }
    prevRole = r.sideRole;

    const rNumStr = String(roundNum).padStart(2, '0');
    const scoreStr = `${running0} - ${running1}`;
    lines.push(`  R${rNumStr} | ${mapStr.padEnd(28)} | Role: ${role.padEnd(7)} | Result: ${(result + condition).padEnd(20)} | Score: ${scoreStr}`);
  });

  lines.push('------------------------------------------------------------------------');
  lines.push('Generated by Due Process Stat Tracker');
  lines.push('========================================================================');

  const textContent = lines.join('\r\n');

  try {
    await navigator.clipboard.writeText(textContent);
  } catch (err) {
    console.warn('Clipboard writeText failed:', err);
  }

  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
  const filename = `round-outcomes-${(match.matchId || 'match').slice(0, 8)}.txt`;
  downloadBlob(blob, filename);

  showHubToast(`Round outcomes copied to clipboard & downloaded as ${filename}`);
}

async function exportRoundOutcomesImage(match) {
  if (!match) return;
  const mapRounds = match.mapRounds || match.roundMaps || [];
  const totalRounds = mapRounds.length;
  if (totalRounds === 0) return;

  const team0 = match.team0Name || 'Blue Team';
  const team1 = match.team1Name || 'Orange Team';
  const score0 = match.finalScore?.side0 ?? match.myScore ?? 0;
  const score1 = match.finalScore?.side1 ?? match.oppScore ?? 0;
  const dateStr = match.timestamp ? new Date(match.timestamp).toLocaleDateString() : 'Unknown Date';
  const modeStr = (match.modeOverride || (match.isRanked ? 'Ranked' : match.is2v2 ? '2v2' : 'Casual')).toUpperCase();
  const outcomeSummary = match.tied ? 'TIE' : (match.won ? 'WIN' : 'LOSS');

  const canvasWidth = 1000;
  const cardsPerRow = 6;
  const numRows = Math.ceil(totalRounds / cardsPerRow);
  const cardWidth = 142;
  const cardHeight = 150;
  const gapX = 14;
  const gapY = 16;
  const startX = 36;
  const startY = 160;
  const canvasHeight = startY + numRows * (cardHeight + gapY) + 70;

  const canvas = document.createElement('canvas');
  const dpr = 2;
  canvas.width = canvasWidth * dpr;
  canvas.height = canvasHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#0d1013';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  for (let x = 20; x < canvasWidth; x += 25) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
  for (let y = 20; y < canvasHeight; y += 25) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#222c38';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, canvasWidth - 32, canvasHeight - 32);
  ctx.fillStyle = '#7fb6e8';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('+', 12, 22);
  ctx.fillText('+', canvasWidth - 24, 22);
  ctx.fillText('+', 12, canvasHeight - 12);
  ctx.fillText('+', canvasWidth - 24, canvasHeight - 12);

  ctx.fillStyle = '#7fb6e8';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('DUE PROCESS STAT TRACKER · ROUND OUTCOMES', 36, 48);

  ctx.fillStyle = '#f0f4f8';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(`${team0} vs ${team1}`, 36, 80);

  let metaX = 36;
  const drawPill = (text, bg, fg, border) => {
    ctx.font = 'bold 11px sans-serif';
    const textWidth = ctx.measureText(text).width;
    const pillW = textWidth + 16;
    ctx.fillStyle = bg;
    ctx.fillRect(metaX, 96, pillW, 22);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(metaX, 96, pillW, 22);
    }
    ctx.fillStyle = fg;
    ctx.fillText(text, metaX + 8, 111);
    metaX += pillW + 10;
  };

  drawPill(modeStr, 'rgba(127, 182, 232, 0.15)', '#7fb6e8', 'rgba(127, 182, 232, 0.4)');
  const resBg = outcomeSummary === 'WIN' ? 'rgba(34, 197, 94, 0.18)' : outcomeSummary === 'LOSS' ? 'rgba(209, 86, 94, 0.18)' : 'rgba(255, 255, 255, 0.1)';
  const resFg = outcomeSummary === 'WIN' ? '#22c55e' : outcomeSummary === 'LOSS' ? '#d1565e' : '#cbd5e1';
  drawPill(`FINAL: ${score0} - ${score1} (${outcomeSummary})`, resBg, resFg);
  drawPill(`${totalRounds} ROUNDS`, 'rgba(255, 255, 255, 0.05)', '#94a3b8');
  drawPill(dateStr, 'rgba(255, 255, 255, 0.05)', '#64748b');

  ctx.strokeStyle = '#1e2630';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, 134);
  ctx.lineTo(canvasWidth - 36, 134);
  ctx.stroke();

  let r0 = 0;
  let r1 = 0;
  mapRounds.forEach((r, idx) => {
    const col = idx % cardsPerRow;
    const row = Math.floor(idx / cardsPerRow);
    const x = startX + col * (cardWidth + gapX);
    const y = startY + row * (cardHeight + gapY);

    if (r.winnerSide === 0) r0++;
    else if (r.winnerSide === 1) r1++;

    const isWin = Boolean(r.won);
    const isSave = r.roundResult === 'save';
    const borderColor = isWin ? '#22c55e' : '#d1565e';
    const cardBg = isWin ? 'rgba(34, 197, 94, 0.08)' : 'rgba(209, 86, 94, 0.08)';

    ctx.fillStyle = cardBg;
    ctx.fillRect(x, y, cardWidth, cardHeight);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, cardWidth, cardHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`ROUND ${r.round || (idx + 1)}`, x + 10, y + 22);

    const tileset = r.tileset && r.tileset !== 'Unknown' ? r.tileset.replace(/_Day$/i, '') : '';
    const mapName = r.mapName && r.mapName !== 'Unknown' ? r.mapName : (r.mapLabel || 'Map');
    ctx.fillStyle = '#7fb6e8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(tileset ? `[${tileset}]` : '', x + 10, y + 42);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '10px sans-serif';
    const trimmedMap = mapName.length > 17 ? mapName.slice(0, 16) + '…' : mapName;
    ctx.fillText(trimmedMap, x + 10, y + 56);

    const role = (r.sideRole || 'UNKNOWN').toUpperCase();
    const roleColor = role === 'ATTACK' ? '#f4848d' : role === 'DEFENSE' ? '#84c0f4' : '#94a3b8';
    ctx.fillStyle = roleColor;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(role, x + 10, y + 78);

    const resText = (isWin ? 'WIN' : 'LOSS') + (isSave ? ' · SAVE' : (r.roundResult ? ` · ${r.roundResult.toUpperCase()}` : ''));
    ctx.fillStyle = isWin ? '#22c55e' : '#d1565e';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(resText, x + 10, y + 102);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x + 1, y + cardHeight - 32, cardWidth - 2, 31);
    ctx.strokeStyle = '#1e2630';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + cardHeight - 32, cardWidth - 2, 31);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`Score: ${r0} - ${r1}`, x + 10, y + cardHeight - 12);
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '10px sans-serif';
  ctx.fillText(`Due Process Stat Tracker · Generated on ${new Date().toLocaleString()}`, 36, canvasHeight - 24);

  canvas.toBlob(async (blob) => {
    if (!blob) return;

    try {
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch (err) {
      console.warn('Clipboard write image failed:', err);
    }

    const filename = `round-outcomes-${(match.matchId || 'match').slice(0, 8)}.png`;
    downloadBlob(blob, filename);

    showHubToast(`Round outcomes image copied to clipboard & downloaded as ${filename}`);
  }, 'image/png');
}

function closeMatchDetail() {
  matchDetailBackdrop.hidden = true;
  matchDetailCurrentId = null;
  matchDetailCurrentMatchup = null;
  matchDetailCurrentMatch = null;
  matchDetailRoundCards = [];
}

// Single delegated listener on the backdrop — never on #matchDetailClose
// directly — so closing keeps working regardless of how the panel's
// content gets rebuilt later. #matchDetailClose itself is currently never
// destroyed (it's outside the subtree renderScoreboardTeams replaces), but
// delegation removes that as a way for this to ever break.
matchDetailBackdrop.addEventListener('click', async (e) => {
  if (e.target.closest('#matchDetailDelete')) {
    if (!matchDetailCurrentId) return;
    const deleted = await confirmAndDeleteMatch(matchDetailCurrentId, matchDetailCurrentMatchup);
    if (deleted) {
      closeMatchDetail();
    }
    return;
  }
  if (e.target === matchDetailBackdrop || e.target.closest('#matchDetailClose')) {
    closeMatchDetail();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (exportDbModalBackdrop && !exportDbModalBackdrop.hidden) {
      closeExportDbModal();
      return;
    }
    if (pitDetailBackdrop && !pitDetailBackdrop.hidden) {
      closePitDetail();
      return;
    }
    if (playerFullProfileBackdrop && !playerFullProfileBackdrop.hidden) {
      closeFullPlayerProfile();
      return;
    }
    if (playerDetailBackdrop && !playerDetailBackdrop.hidden) {
      playerDetailBackdrop.hidden = true;
      return;
    }
    if (matchDetailBackdrop && !matchDetailBackdrop.hidden) {
      closeMatchDetail();
      return;
    }
  }
});

function renderTopWeapons(weapons) {
  // Keep the 4 corner tick marks, drop any previously rendered rows.
  topWeaponsEl.querySelectorAll('.weapon-row').forEach((el) => el.remove());
  if (weapons.length === 0) {
    const none = document.createElement('div');
    none.style.cssText = 'font-size:12px;color:var(--text-muted)';
    none.textContent = 'No weapon data yet.';
    none.className = 'weapon-row';
    topWeaponsEl.appendChild(none);
    return;
  }
  const maxKills = Math.max(...weapons.map((w) => w.kills), 1);
  for (const w of weapons) {
    const row = document.createElement('div');
    row.className = 'weapon-row';
    const pct = Math.round((w.kills / maxKills) * 100);
    row.innerHTML = `
      <div class="top"><span class="wname">${escapeHtml(w.label)}</span><span class="wkills">${w.kills} K</span></div>
      <div class="weapon-bar"><span style="width:${pct}%"></span></div>
    `;
    topWeaponsEl.appendChild(row);
  }
}

function renderSparkline(trend) {
  sparklineEl.innerHTML = '';
  if (trend.length === 0) {
    sparklineAvgEl.textContent = '';
    return;
  }
  const max = Math.max(...trend, 1);
  const avg = trend.reduce((a, b) => a + b, 0) / trend.length;
  for (const kills of trend) {
    const bar = document.createElement('span');
    const heightPct = Math.max(6, Math.round((kills / max) * 100));
    bar.style.height = `${heightPct}%`;
    bar.style.background = kills >= avg ? 'var(--accent)' : 'var(--border-soft)';
    sparklineEl.appendChild(bar);
  }
  sparklineAvgEl.textContent = `avg ${(Math.round(avg * 10) / 10).toFixed(1)}`;
}

// Live Steam player count for the game itself — separate from the archive
// refresh above (window.hubAPI.requestRefresh), fetched fresh on load and
// on every manual refresh click rather than cached, since the whole point
// is an up-to-date number. Hides itself on failure instead of showing a
// stale or fake value.
const playerCountBadge = document.getElementById('playerCountBadge');
const playerCountEl = document.getElementById('playerCount');
function refreshPlayerCount() {
  window.hubAPI?.getPlayerCount?.().then((count) => {
    if (typeof count !== 'number') {
      playerCountBadge.hidden = true;
      return;
    }
    playerCountEl.textContent = count.toLocaleString();
    playerCountBadge.hidden = false;
  });
}

document.getElementById('refreshBtn').addEventListener('click', () => {
  window.hubAPI.requestRefresh();
  refreshPlayerCount();
});

window.hubAPI.onUpdate(render);
window.hubAPI.requestRefresh();
refreshPlayerCount();

// Overlay click-through (see overlay-renderer.js / main.js's
// 'overlay:open-player-detail'). The modal is a backdrop over whatever's
// currently showing, so it opens in place — no need to force-switch views.
window.hubAPI.onShowPlayerDetail((accountId) => {
  openPlayerDetail(accountId);
});
