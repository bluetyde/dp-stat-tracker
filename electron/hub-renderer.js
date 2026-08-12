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
  ranked: document.getElementById('rankedHistoryView'),
  other: document.getElementById('otherHistoryView'),
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
}

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
    const inferredBadge = m.inferred
      ? '<span class="inferred-badge" title="No matchEnded event was ever seen for this match — the game process exited before the client\'s normal end-of-match log sequence ran. Recorded from the last known round score instead.">INFERRED</span>'
      : '';
    const sourceBadge = opts.tagSource
      ? `<span class="source-badge source-badge--${m.source}">${m.source === 'ranked' ? 'RANKED' : 'OTHER'}</span>`
      : '';
    tr.innerHTML = `
      <td class="${resultClass}" style="letter-spacing:.1em">${resultText}</td>
      <td>${escapeHtml(m.mapLabel ?? '—')}${sourceBadge}${inferredBadge}</td>
      <td style="text-align:center"><span class="${m.won ? '' : 'result-loss'}">${m.myScore}</span> – <span class="${m.won ? 'result-win' : ''}">${m.oppScore}</span></td>
      <td style="text-align:center">${m.kills} - ${m.deaths} - ${m.assists}</td>
      <td style="text-align:right;font-family:var(--font-body);font-size:11px;color:var(--text-muted)">${timeAgo(m.timestamp)}</td>
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
