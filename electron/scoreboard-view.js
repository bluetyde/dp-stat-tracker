// Shared team-scoreboard rendering — the visual design pulled from Claude
// Design's "Overlay Scoreboard.dc.html" (same language dp-stats.com uses:
// two team columns, round-win badges, corner-tick dark theme). Used by both
// the live overlay (overlay-renderer.js, driven by IPC) and the Hub's
// match-detail view (hub-renderer.js, driven by an archived match record) —
// one rendering implementation, not two layouts that could drift apart.
//
// Plain script (no ES module, no Node access) — include via <script src>
// before the caller's own renderer script. Depends on the `.scoreboard-teams`
// / `.team-col` / `.team-head` / `.player-row` / etc. classes in theme.css.

function scoreboardEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getRowDplRating(row) {
  if (row && row.dplRating !== undefined && row.dplRating !== null && !isNaN(row.dplRating)) {
    return Number(row.dplRating);
  }
  if (!row) return null;
  const rounds = row.kast?.roundsCounted ?? 0;
  if (rounds <= 0) return null;
  const kpr = (row.kills ?? 0) / rounds;
  const adr = (row.damage ?? 0) / rounds;
  const srv = Math.max(0, (rounds - (row.deaths ?? 0)) / rounds);
  const kastPct = row.kast?.percent ?? 0;
  const kda = ((row.kills ?? 0) + (row.assists ?? 0)) / Math.max(1, row.deaths ?? 0);
  const kdaFactor = kda / 1.5;
  const kastFactor = kastPct / 70;
  const baseCombat = 0.25 * kdaFactor + 0.25 * kastFactor + 0.20 * kpr + 0.20 * (adr / 100) + 0.10 * srv;
  const winImpact = 0.65 + 0.70 * 0.50;
  return Math.round(baseCombat * winImpact * 100) / 100;
}

function renderScoreboardTeamColumn(teamIndex, label, roundWins, rows, localAccountId) {
  const col = document.createElement('div');
  col.className = 'team-col';

  const head = document.createElement('div');
  head.className = `team-head team-${teamIndex}`;
  head.innerHTML = `<span class="badge">${roundWins ?? '?'}</span><span class="team-label">${label}</span>`;
  col.appendChild(head);

  const colHead = document.createElement('div');
  colHead.className = 'col-head-row';
  colHead.innerHTML = `<span>Name</span><span class="num">DMG</span><span class="num">ADR</span><span class="ctr">K-D-A</span><span class="num">KAST</span><span class="num">HS %</span><span class="num">FF DMG</span><span class="ctr">OP DUEL</span><span class="wpn">Best Wpn</span>`;
  col.appendChild(colHead);

  for (const row of [...rows].sort((a, b) => b.damage - a.damage)) {
    const el = document.createElement('div');
    el.className = 'player-row' + (row.accountId === localAccountId ? ' is-you' : '');
    // Inert data attribute, not a behavior — the overlay never reads it.
    // Lets a Hub-context caller (see hub-renderer.js's
    // attachPlayerClickHandlers) wire up player-name clicks after the fact
    // without this shared file needing to know whether it's rendering into
    // the live overlay or a Hub view.
    el.dataset.accountId = row.accountId;
    const bestWeapon = row.bestWeapon ? row.bestWeapon.label : '—';
    const hsText = row.hsPercent !== null && row.hsPercent !== undefined ? `${row.hsPercent}%` : '—';
    const ffVal = row.teamDamage ?? 0;
    const ffClass = ffVal > 0 ? 'ff-alert' : 'dim';

    const dplVal = getRowDplRating(row);
    let dplTagHtml = '';
    if (dplVal !== null) {
      const tierClass = dplVal >= 1.2 ? 'dpl-tag--high' : dplVal >= 0.9 ? 'dpl-tag--mid' : 'dpl-tag--low';
      dplTagHtml = `<span class="played-with-tag dpl-tag ${tierClass}" title="Match DPL Rating: ${dplVal.toFixed(2)}">${dplVal.toFixed(2)}</span>`;
    }

    // .name-text is a nested span, not just the name string directly inside
    // .name, so the DPL rating tag (a sibling of .name-text, not a child)
    // gets its own truncation unit — see theme.css's .player-row .name comment.
    el.innerHTML = `
      <span class="name"><span class="name-text">${scoreboardEscapeHtml(row.name)}</span>${dplTagHtml}</span>
      <span class="num">${row.damage}</span>
      <span class="num">${row.adr.attack}-${row.adr.defense}</span>
      <span class="ctr">${row.kills}-${row.deaths}-${row.assists}</span>
      <span class="num dim">${row.kast.percent}%</span>
      <span class="num dim">${hsText}</span>
      <span class="num ${ffClass}">${ffVal}</span>
      <span class="ctr dim">${row.openingDuels.won}/${row.openingDuels.involved}</span>
      <span class="wpn">${scoreboardEscapeHtml(bestWeapon)}</span>
    `;
    col.appendChild(el);
  }

  return col;
}

/**
 * Renders both team columns into `container` (an element with class
 * `scoreboard-teams`, or that this function will populate directly).
 * `data`: { finalScore: {side0, side1}, teams: {0: [row,...], 1: [row,...]}, localAccountId? }
 */
function renderScoreboardTeams(container, data) {
  container.innerHTML = '';
  container.appendChild(
    renderScoreboardTeamColumn(0, 'Team 1', data.finalScore?.side0, data.teams[0], data.localAccountId)
  );
  container.appendChild(
    renderScoreboardTeamColumn(1, 'Team 2', data.finalScore?.side1, data.teams[1], data.localAccountId)
  );
}
