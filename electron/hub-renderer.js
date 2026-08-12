// Hub window renderer. Plain script (no ES module, no Node access) —
// receives already-computed lifetime stats over IPC via preload.js's
// window.hubAPI; never touches fs or the archives directly.

const playerNameEl = document.getElementById('playerName');
const emptyHubEl = document.getElementById('emptyHub');
const statGridEl = document.getElementById('statGrid');
const detailColsEl = document.getElementById('detailCols');
const recentMatchesBody = document.getElementById('recentMatchesBody');
const topWeaponsEl = document.getElementById('topWeapons');
const sparklineEl = document.getElementById('sparkline');
const sparklineAvgEl = document.getElementById('sparklineAvg');

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
};
const navItems = [...document.querySelectorAll('.nav-item[data-view]')];
let currentView = 'home';
let latestHubData = null; // re-render target when switching into a history view without waiting for the next push

function switchView(view) {
  if (!views[view]) return;
  currentView = view;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  for (const item of navItems) item.classList.toggle('active', item.dataset.view === view);
  if (view === 'ranked') fetchAndRenderHistory('ranked');
  if (view === 'other') fetchAndRenderHistory('other');
  if (view === 'playedWith') renderPlayedWithTable();
  if (view === 'maps') renderMapsTable();
  if (view === 'liveMatch') renderLiveMatch();
}

for (const item of navItems) {
  item.addEventListener('click', () => switchView(item.dataset.view));
}

async function fetchAndRenderHistory(kind) {
  const matches = kind === 'ranked' ? await window.hubAPI.getRankedHistory() : await window.hubAPI.getOtherHistory();
  const emptyEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryEmpty' : 'otherHistoryEmpty');
  const panelEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryPanel' : 'otherHistoryPanel');
  const bodyEl = document.getElementById(kind === 'ranked' ? 'rankedHistoryBody' : 'otherHistoryBody');
  const hasAny = matches.length > 0;
  emptyEl.hidden = hasAny;
  panelEl.hidden = !hasAny;
  if (hasAny) renderMatchRows(bodyEl, matches);
}

// ---------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------

function render(data) {
  latestHubData = data;
  playerNameEl.textContent = data.playerName || '—';

  const hasRanked = !!(data.lifetime && data.lifetime.matchesRecorded > 0);
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
      ...otherMatches.map((m) => ({ ...m, source: 'other' })),
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

  // Unlike ranked/other history, weaponStats rides along on every regular
  // hub:update push (main.js's rankedArchive.getWeaponStats() output is
  // small — bounded by the number of distinct weapon codes, not match
  // count) — so there's no on-demand fetch here, just a re-render from
  // whatever's already in `data`. Kept live and current in the DOM even
  // while the Weapons view is hidden, same reasoning as the stat tiles.
  renderWeaponsTable();
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
    const winnerName = pred.predictedWinner === 0 ? 'BLUE' : 'ORANGE';
    const chance = pred.predictedWinner === 0 ? pred.team0WinChance : pred.team1WinChance;
    document.getElementById('predictionWinnerText').textContent = `${winnerName} TEAM HAS A ${chance}% CHANCE OF WINNING`;
    document.getElementById('blueAvgRating').textContent = pred.avgRating0.toFixed(2);
    document.getElementById('orangeAvgRating').textContent = pred.avgRating1.toFixed(2);
    document.getElementById('predictionBarTeam0').style.width = `${pred.team0WinChance}%`;
  }

  renderScoreboardTeams(liveMatchTeamsEl, {
    finalScore: liveMatch.finalScore,
    teams: liveMatch.teams,
    localAccountId: latestHubData?.playerName,
  });

  attachPlayerClickHandlers(liveMatchTeamsEl);
}

function attachPlayerClickHandlers(container) {
  const playedWithMap = new Map((latestHubData?.playedWith ?? []).map((p) => [p.accountId, p]));

  container.querySelectorAll('.scoreboard-row').forEach((row) => {
    const accountId = row.dataset.accountId;
    if (!accountId) return;

    const nameEl = row.querySelector('.player-name') || row.querySelector('td:nth-child(2)');
    if (nameEl && !nameEl.querySelector('.played-with-tag')) {
      nameEl.classList.add('player-name-link');
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayerDetail(accountId);
      });

      const pw = playedWithMap.get(accountId);
      if (pw) {
        const tag = document.createElement('span');
        if (pw.matchesTogether > 0) {
          tag.className = 'played-with-tag played-with-tag--teammate';
          tag.textContent = `Teammate (${pw.matchesTogether}g · ${pw.winRateTogether}%)`;
        } else if (pw.matchesAgainst > 0) {
          tag.className = 'played-with-tag played-with-tag--rival';
          tag.textContent = `Rival (${pw.matchesAgainst}g · ${pw.winRateAgainst}%)`;
        }
        nameEl.appendChild(tag);
      }
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

let selectedMapTileset = 'all';
let mapSortKey = 'timesPlayed';
let mapSortDir = 'desc';

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
  let filtered = mapSummary;
  if (selectedMapTileset !== 'all') {
    filtered = filtered.filter((m) => m.tileset.toLowerCase() === selectedMapTileset.toLowerCase());
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
      </td>
    `;

    tr.addEventListener('click', (e) => {
      if (e.target.closest('.map-note-input')) return;
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
  mhTilesetBadge.textContent = `${m.tileset} · ${m.timesPlayed} Played (${m.wins}W - ${m.losses}L) · ${m.winRate}% Win Rate`;
  
  mhBody.innerHTML = '';
  for (const h of m.history ?? []) {
    const tr = document.createElement('tr');
    const resultClass = h.won ? 'result-win' : 'result-loss';
    const resultText = h.won ? 'WIN' : 'LOSS';
    tr.innerHTML = `
      <td style="font-family:var(--font-display);font-size:14px;font-weight:600;color:var(--text-bright)">
        ${escapeHtml(h.matchup)}
      </td>
      <td style="text-align:center;font-size:13px;color:var(--text-muted)">
        Round ${h.round}
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
const pwTopRivalEl = document.getElementById('pwTopRival');
const pwTopRivalSubEl = document.getElementById('pwTopRivalSub');
const pwAvgWinRateEl = document.getElementById('pwAvgWinRate');

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
  } else {
    pwTopTeammateEl.textContent = '—';
    pwTopTeammateSubEl.textContent = '0 games';
  }

  const topRival = [...playedWithList].sort((a, b) => b.matchesAgainst - a.matchesAgainst)[0];
  if (topRival && topRival.matchesAgainst > 0) {
    pwTopRivalEl.textContent = topRival.latestName;
    pwTopRivalSubEl.textContent = `${topRival.matchesAgainst}g · ${topRival.winRateAgainst}% WR`;
  } else {
    pwTopRivalEl.textContent = '—';
    pwTopRivalSubEl.textContent = '0 games';
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
      <td style="text-align:center;color:#e28a42;font-weight:600">${p.matchesAgainst > 0 ? `${p.winsAgainst}W - ${p.lossesAgainst}L` : '—'}</td>
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
const pdAvatar = document.getElementById('pdAvatar');

let currentPdAccountId = null;

async function openPlayerDetail(accountId) {
  currentPdAccountId = accountId;
  if (pdAvatar) {
    pdAvatar.src = '';
    pdAvatar.hidden = true;
  }
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

pdSteamBtn?.addEventListener('click', () => {
  if (currentPdAccountId) {
    window.hubAPI.openSteamProfile(currentPdAccountId);
  }
});

document.getElementById('pdCloseBtn')?.addEventListener('click', () => {
  playerDetailBackdrop.hidden = true;
});
playerDetailBackdrop?.addEventListener('click', (e) => {
  if (e.target === playerDetailBackdrop) playerDetailBackdrop.hidden = true;
});

// CSV Export Handler
document.getElementById('exportCsvBtn')?.addEventListener('click', async () => {
  const csvText = await window.hubAPI.exportCsv();
  if (!csvText) return;
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `due-process-match-history-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

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
    filtered = filtered.filter((w) => (w.category ?? '').toLowerCase().includes(selectedCategory.toLowerCase()));
  }
  if (searchFilterQuery.trim()) {
    const q = searchFilterQuery.trim().toLowerCase();
    filtered = filtered.filter((w) => w.label.toLowerCase().includes(q) || (w.category ?? '').toLowerCase().includes(q));
  }

  // --- Sort Weapons ---
  const sorted = [...filtered].sort((a, b) => {
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
      const hs = w.headshots === null ? '<span class="no-data">—</span>' : w.headshots;
      const hsPct = w.hsPercent === null ? '<span class="no-data">—</span>' : `<span class="hs-badge">${w.hsPercent}%</span>`;
      const killsPct = Math.round((w.kills / maxKills) * 100);

      const specsList = [];
      if (w.fireType && w.fireType !== 'Unknown') specsList.push(w.fireType);
      if (w.rpm) specsList.push(`${w.rpm} RPM`);
      if (w.baseDamage) specsList.push(`${w.baseDamage} DMG`);
      const specsStr = specsList.length > 0 ? specsList.join(' · ') : 'Standard Weapon';
      const wikiUrl = w.wikiUrl || `https://dueprocess.fandom.com/wiki/${encodeURIComponent(w.label)}`;
      const imgHtml = w.imageUrl
        ? `<img src="${w.imageUrl}" alt="${escapeHtml(w.label)}" style="width:68px;height:38px;object-fit:contain;background:rgba(0,0,0,0.35);padding:2px;border:1px solid var(--border-soft);border-radius:3px">`
        : `<div style="width:68px;height:38px;background:rgba(255,255,255,0.03);border:1px solid var(--border-soft);display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:10px;font-family:var(--font-display)">WPN</div>`;

      tr.innerHTML = `
        <td>
          <div style="display:flex;align-items:center;gap:14px;padding:4px 0">
            <a href="${wikiUrl}" class="weapon-wiki-btn" data-wikiurl="${wikiUrl}" title="View ${escapeHtml(w.label)} on Fandom Wiki ↗" style="display:block;cursor:pointer;transition:transform 0.15s ease">
              ${imgHtml}
            </a>
            <div class="weapon-cell">
              <span class="weapon-cat">${escapeHtml((w.category ?? 'WEAPON').toUpperCase())}</span>
              <a href="${wikiUrl}" class="weapon-wiki-btn" data-wikiurl="${wikiUrl}" title="View ${escapeHtml(w.label)} on Fandom Wiki ↗" style="color:var(--text-bright);text-decoration:none">
                <span class="weapon-title" style="color:var(--text-bright);font-weight:700">${escapeHtml(w.label)} <span style="font-size:11px;color:var(--accent);margin-left:2px">↗</span></span>
              </a>
              <span class="weapon-specs">${escapeHtml(specsStr)}</span>
            </div>
          </div>
        </td>
        <td style="text-align:center">
          <div class="kills-col">
            <span style="font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--accent)">${w.kills}</span>
            <div class="kills-bar"><span style="width:${killsPct}%"></span></div>
          </div>
        </td>
        <td style="text-align:center;font-family:var(--font-display);font-size:16px;font-weight:600;color:${w.deaths > 0 ? 'var(--loss)' : 'var(--text-muted)'}">${w.deaths}</td>
        <td style="text-align:center;font-family:var(--font-display);font-size:15px">${hs}</td>
        <td style="text-align:center">${hsPct}</td>
        <td style="text-align:center;font-family:var(--font-display);font-size:15px;font-weight:600">${w.killsPerRound.toFixed(2)}</td>
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

// Shared by Home's unified feed and both History views — same row shape
// (result/map/score/K-D-A/played/delete) everywhere; only Home tags rows
// with a RANKED/OTHER badge (opts.tagSource), since the two History views
// are already scoped to one archive each.
function renderMatchRows(tbody, matches, opts = {}) {
  tbody.innerHTML = '';
  for (const m of matches) {
    const tr = document.createElement('tr');
    tr.dataset.matchId = m.matchId;
    tr.title = 'Click for the full scoreboard';
    const resultClass = m.won ? 'result-win' : 'result-loss';
    const resultText = m.won ? 'WIN' : 'LOSS';
    const sourceBadge = opts.tagSource
      ? `<span class="source-badge source-badge--${m.source}">${m.source === 'ranked' ? 'RANKED' : 'OTHER'}</span>`
      : '';
    tr.innerHTML = `
      <td class="${resultClass}" style="letter-spacing:.1em">${resultText}</td>
      <td>${escapeHtml(m.matchup || `${m.team0Name || 'Blue Team'} vs ${m.team1Name || 'Orange Team'}`)}${sourceBadge}</td>
      <td style="text-align:center"><span class="${m.won ? '' : 'result-loss'}">${m.myScore}</span> – <span class="${m.won ? 'result-win' : ''}">${m.oppScore}</span></td>
      <td style="text-align:center;white-space:nowrap;font-family:var(--font-display);font-weight:600;min-width:90px">${m.kills} - ${m.deaths} - ${m.assists}</td>
      <td style="text-align:right;font-family:var(--font-body);font-size:11px;color:var(--text-muted);white-space:nowrap">${timeAgo(m.timestamp)}</td>
      <td style="text-align:center"><button class="delete-match-btn" title="Delete this match" aria-label="Delete this match">&times;</button></td>
    `;
    tr.addEventListener('click', () => openMatchDetail(m.matchId));
    tr.querySelector('.delete-match-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger the row's open-detail click
      confirmAndDeleteMatch(m.matchId, m.mapLabel);
    });
    tbody.appendChild(tr);
  }
}

async function confirmAndDeleteMatch(matchId, mapLabel) {
  const label = mapLabel ? ` on ${mapLabel}` : '';
  const ok = window.confirm(`Delete this match${label}? This can't be undone.`);
  if (!ok) return;
  await window.hubAPI.deleteMatch(matchId);
  // No manual re-render call needed for Home/stat data: main.js's delete
  // handler pushes a fresh hub:update (totals/lists re-derived from the
  // archive) on success, and render() above re-fetches whichever history
  // view is currently open. If the deleted row was IN a history view,
  // that re-fetch picks up the removal too.
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
const matchDetailMap = document.getElementById('matchDetailMap');
const matchDetailMeta = document.getElementById('matchDetailMeta');
let matchDetailCurrentId = null;

async function openMatchDetail(matchId) {
  const match = await window.hubAPI.getMatchDetail(matchId);
  if (!match) return; // shouldn't happen (row came from an archive itself), but don't render a broken panel if it does

  matchDetailCurrentId = matchId;
  matchDetailMap.textContent = match.mapLabel ?? '';
  const inferredNote = match.inferred ? ' · INFERRED (no matchEnded seen)' : '';
  matchDetailMeta.textContent = `${match.roundCount} rounds${inferredNote}`;
  renderScoreboardTeams(matchDetailTeams, {
    finalScore: match.finalScore,
    teams: match.teams,
    localAccountId: match.localAccountId,
  });
  matchDetailBackdrop.hidden = false;
}

function closeMatchDetail() {
  matchDetailBackdrop.hidden = true;
  matchDetailCurrentId = null;
}

// Single delegated listener on the backdrop — never on #matchDetailClose
// directly — so closing keeps working regardless of how the panel's
// content gets rebuilt later. #matchDetailClose itself is currently never
// destroyed (it's outside the subtree renderScoreboardTeams replaces), but
// delegation removes that as a way for this to ever break.
matchDetailBackdrop.addEventListener('click', async (e) => {
  if (e.target.closest('#matchDetailDelete')) {
    if (!matchDetailCurrentId) return;
    const ok = window.confirm("Delete this match? This can't be undone.");
    if (ok) {
      await window.hubAPI.deleteMatch(matchDetailCurrentId);
      closeMatchDetail();
    }
    return;
  }
  if (e.target === matchDetailBackdrop || e.target.closest('#matchDetailClose')) {
    closeMatchDetail();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !matchDetailBackdrop.hidden) closeMatchDetail();
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
    bar.style.background = kills >= avg ? 'var(--accent)' : '#2b353f';
    sparklineEl.appendChild(bar);
  }
  sparklineAvgEl.textContent = `avg ${(Math.round(avg * 10) / 10).toFixed(1)}`;
}

document.getElementById('refreshBtn').addEventListener('click', () => {
  window.hubAPI.requestRefresh();
});

window.hubAPI.onUpdate(render);
window.hubAPI.requestRefresh();
