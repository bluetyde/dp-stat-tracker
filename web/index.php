<?php
/**
 * Due Process — Global Player Database Web Portal
 *
 * TO UPDATE STATS:
 * Simply export 'database.json' from your Due Process Stat Tracker and upload it
 * to this same directory. The portal will automatically display the latest stats
 * and update the 'Last Updated' timestamp.
 */
$dbFile = __DIR__ . '/database.json';
$dbData = null;
$lastUpdated = 'Not available';

if (file_exists($dbFile)) {
    $jsonContent = @file_get_contents($dbFile);
    if ($jsonContent !== false) {
        $dbData = json_decode($jsonContent, true);
        if ($dbData && is_array($dbData)) {
            $lastUpdated = $dbData['lastUpdated'] ?? date('M j, Y, g:i A T', filemtime($dbFile));
        }
    }
}
?>
<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Due Process — Global Player Database</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #0d1013;
    --bg-raised: #0f1418;
    --bg-tile: #12171c;
    --bg-sunken: #0a0d10;
    --bg-input: #090c0f;
    --border: #1e262d;
    --border-soft: #232c34;
    --text: #e4eaf0;
    --text-bright: #f2f6fa;
    --text-muted: #6d7b88;
    --text-faint: #5d6b78;
    --text-dim: #9aa7b4;
    --accent: #7fb6e8;
    --accent-bright: #a9d0f4;
    --accent-dim: #4e6d8c;
    --accent-rgb: 127, 182, 232;
    --on-accent: #0d1013;
    --loss: #d1565e;
    --loss-bright: #f0b7bb;
    --loss-rgb: 209, 86, 94;
    --rival: #e28a42;
    --rival-rgb: 226, 138, 66;
    --card-rgb: 9, 12, 15;
    --tint-rgb: 255, 255, 255;
    --font-display: 'Barlow Condensed', system-ui, sans-serif;
    --font-body: 'Barlow', system-ui, sans-serif;
  }

  :root[data-theme="light"] {
    --bg: #f4f6f8;
    --bg-raised: #ffffff;
    --bg-tile: #ebf0f4;
    --bg-sunken: #e2e8ee;
    --bg-input: #ffffff;
    --border: #d2dbe2;
    --border-soft: #c2cdd6;
    --text: #1d252c;
    --text-bright: #0c1115;
    --text-muted: #647380;
    --text-faint: #8595a4;
    --text-dim: #43515e;
    --accent: #206fae;
    --accent-bright: #145588;
    --accent-dim: #5c97c5;
    --accent-rgb: 32, 111, 174;
    --on-accent: #ffffff;
    --loss: #b53841;
    --loss-bright: #8f262e;
    --loss-rgb: 181, 56, 65;
    --card-rgb: 255, 255, 255;
    --tint-rgb: 0, 0, 0;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }

  .container {
    max-width: 1360px;
    margin: 0 auto;
    padding: 32px 24px 64px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  /* Header Branding */
  header.site-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 20px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
  }
  .brand-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .brand-group .name {
    font-family: var(--font-display);
    font-size: 38px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-bright);
    line-height: 1;
  }
  .brand-group .name .accent { color: var(--accent); }
  .brand-group .sub {
    font-family: var(--font-display);
    font-size: 13px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Last Updated pill */
  .last-updated-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(var(--tint-rgb), 0.04);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    padding: 8px 14px;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .last-updated-pill strong { color: var(--text-bright); font-weight: 700; }
  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
  }

  .theme-toggle-btn {
    background: transparent;
    border: 1px solid var(--border-soft);
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 8px 14px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .theme-toggle-btn:hover {
    color: var(--text-bright);
    border-color: var(--accent);
    background: rgba(var(--accent-rgb), 0.08);
  }

  /* Panels & Cards */
  .panel {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    position: relative;
  }
  .corner {
    position: absolute;
    color: var(--text-faint);
    font-family: monospace;
    font-size: 11px;
    line-height: 1;
    pointer-events: none;
    user-select: none;
  }
  .corner.tl { top: 3px; left: 4px; }
  .corner.tr { top: 3px; right: 4px; }
  .corner.bl { bottom: 3px; left: 4px; }
  .corner.br { bottom: 3px; right: 4px; }

  /* Stat Overview Grid */
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  @media (max-width: 860px) {
    .overview-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 520px) {
    .overview-grid { grid-template-columns: 1fr; }
  }
  .stat-tile {
    background: var(--bg-tile);
    border: 1px solid var(--border-soft);
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stat-tile .label {
    font-family: var(--font-display);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .stat-tile .value {
    font-family: var(--font-display);
    font-size: 36px;
    font-weight: 700;
    color: var(--text-bright);
    line-height: 1;
  }
  .stat-tile .sub {
    font-size: 12px;
    color: var(--text-dim);
  }

  /* Filter and Search Bar */
  .controls-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .search-wrapper {
    position: relative;
    flex: 1;
    max-width: 440px;
    min-width: 260px;
  }
  .search-input {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border-soft);
    color: var(--text-bright);
    font-family: var(--font-body);
    font-size: 14px;
    padding: 10px 38px 10px 14px;
    border-radius: 4px;
    outline: none;
    transition: border-color 0.15s ease;
  }
  .search-input:focus {
    border-color: var(--accent);
  }
  .search-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
  }
  .search-clear:hover { color: var(--text-bright); }

  .filter-pills {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pill {
    background: transparent;
    border: 1px solid var(--border-soft);
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 6px 12px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .pill:hover {
    color: var(--text-bright);
    border-color: var(--text-faint);
  }
  .pill.active {
    background: rgba(var(--accent-rgb), 0.12);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .table-summary-info {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: auto;
  }

  /* Main Leaderboard Table */
  .table-responsive {
    overflow-x: auto;
    border: 1px solid var(--border);
    background: var(--bg-raised);
    position: relative;
  }
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    white-space: nowrap;
  }
  table.data-table thead {
    background: var(--bg-sunken);
    border-bottom: 2px solid var(--border);
  }
  table.data-table th {
    padding: 12px 14px;
    text-align: left;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
    cursor: pointer;
    user-select: none;
    transition: color 0.15s ease;
  }
  table.data-table th:hover {
    color: var(--text-bright);
  }
  table.data-table th.sorted {
    color: var(--accent);
  }
  table.data-table th.text-right { text-align: right; }
  table.data-table th.text-center { text-align: center; }

  table.data-table tbody tr {
    border-bottom: 1px solid var(--border-soft);
    cursor: pointer;
    transition: background 0.12s ease;
  }
  table.data-table tbody tr:hover {
    background: rgba(var(--accent-rgb), 0.06);
  }
  table.data-table td {
    padding: 11px 14px;
    color: var(--text);
  }
  table.data-table td.text-right { text-align: right; }
  table.data-table td.text-center { text-align: center; }

  /* Badges & Pills */
  .rating-badge {
    display: inline-block;
    background: rgba(var(--accent-rgb), 0.12);
    border: 1px solid rgba(var(--accent-rgb), 0.35);
    color: var(--accent);
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 3px;
  }
  .rank-badge {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--text-muted);
  }
  .rank-top1 { color: #f59e0b; }
  .rank-top2 { color: #94a3b8; }
  .rank-top3 { color: #d97706; }

  .win-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 80px;
  }
  .win-bar-track {
    height: 3px;
    background: var(--border);
    width: 100%;
    overflow: hidden;
  }
  .win-bar-fill {
    height: 100%;
    background: var(--accent);
  }

  .player-name-cell {
    font-weight: 600;
    color: var(--text-bright);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .alias-tag {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 400;
  }

  /* Empty state */
  .empty-banner {
    padding: 48px 24px;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
  }

  /* Player Dossier Modal */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 1000;
  }
  .modal-backdrop[hidden] { display: none !important; }

  .modal-card {
    background: rgba(var(--card-rgb), 0.98);
    border: 1px solid var(--border);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.8);
    width: 880px;
    max-width: 96vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
  .modal-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }
  .modal-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-bright);
    line-height: 1.1;
  }
  .modal-body {
    padding: 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .close-btn {
    background: transparent;
    border: 1px solid var(--border-soft);
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 13px;
    padding: 6px 14px;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s ease;
  }
  .close-btn:hover {
    color: var(--text-bright);
    border-color: var(--accent);
  }

  .outcome-pill {
    display: inline-block;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 2px;
  }
  .outcome-win { background: rgba(var(--accent-rgb), 0.15); color: var(--accent); border: 1px solid rgba(var(--accent-rgb), 0.35); }
  .outcome-loss { background: rgba(var(--loss-rgb), 0.15); color: var(--loss); border: 1px solid rgba(var(--loss-rgb), 0.35); }
  .outcome-tie { background: rgba(var(--tint-rgb), 0.08); color: var(--text-dim); border: 1px solid var(--border); }
</style>
</head>
<body>
<div class="container">
  <!-- Header -->
  <header class="site-header">
    <div class="brand-group">
      <div class="sub">Due Process · Global Ranked Dossier</div>
      <div class="name">DUE<span class="accent">PROCESS</span> LEADERBOARD</div>
    </div>
    <div class="header-actions">
      <div class="last-updated-pill">
        <span class="live-dot"></span>
        <span>Last Updated: <strong id="lastUpdatedVal"><?= htmlspecialchars($lastUpdated) ?></strong></span>
      </div>
      <button class="theme-toggle-btn" id="themeToggleBtn">Toggle Theme</button>
    </div>
  </header>

  <!-- Server Message / Missing Database Check (for PHP) -->
  <div id="missingDbNotice" class="panel empty-banner" style="display:none;padding:36px;border-color:var(--rival)">
    <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
    <h3 style="margin:0 0 10px;font-family:var(--font-display);font-size:22px;color:var(--rival);text-transform:uppercase">Database File Not Found</h3>
    <p style="margin:0 0 16px;color:var(--text-dim)">
      As the webmaster, export <strong>database.json</strong> from the Due Process Stat Tracker and upload it into this directory.
    </p>
    <div style="font-size:12px;color:var(--text-muted)">Once uploaded, reload this page to see the global leaderboard.</div>
  </div>

  <div id="mainContent" style="display:flex;flex-direction:column;gap:24px">
    <!-- Stat Overview Grid -->
    <section class="overview-grid">
      <div class="panel stat-tile">
        <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
        <div class="label">Total Players</div>
        <div class="value" id="statTotalPlayers" style="color:var(--accent)">0</div>
        <div class="sub" id="statPlayersSub">tracked in database</div>
      </div>
      <div class="panel stat-tile">
        <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
        <div class="label">Matches Recorded</div>
        <div class="value" id="statTotalMatches">0</div>
        <div class="sub" id="statMatchesSub">Ranked Matches</div>
      </div>
      <div class="panel stat-tile">
        <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
        <div class="label">Total Frags</div>
        <div class="value" id="statTotalKills">0</div>
        <div class="sub">confirmed eliminations</div>
      </div>
      <div class="panel stat-tile">
        <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
        <div class="label">Pit Claims 🔥</div>
        <div class="value" id="statPitClaims" style="color:#ff5208">0</div>
        <div class="sub">environmental hazard deaths</div>
      </div>
    </section>

    <!-- Controls Bar -->
    <section class="controls-bar">
      <div class="search-wrapper">
        <input type="text" id="searchInput" class="search-input" placeholder="Search by player name or alias..." autocomplete="off" />
        <button id="searchClearBtn" class="search-clear" style="display:none">&times;</button>
      </div>
      <div class="filter-pills" id="filterPills">
        <button class="pill active" data-min-matches="0">All Players</button>
        <button class="pill" data-min-matches="3">3+ Matches</button>
        <button class="pill" data-min-matches="5">5+ Matches</button>
        <button class="pill" data-min-matches="10">10+ Matches</button>
      </div>
      <div class="table-summary-info">
        Showing <strong id="visibleCount" style="color:var(--text-bright)">0</strong> of <strong id="totalCount" style="color:var(--text-bright)">0</strong> players
      </div>
    </section>

    <!-- Leaderboard Table -->
    <section class="table-responsive panel">
      <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
      <table class="data-table" id="leaderboardTable">
        <thead>
          <tr>
            <th data-sort="rank" class="text-center" style="width:50px">#</th>
            <th data-sort="name">Player</th>
            <th data-sort="dplRating" class="sorted text-center" style="width:110px">DPL Rating ▼</th>
            <th data-sort="winRate" class="text-left" style="width:130px">Win Rate</th>
            <th data-sort="matches" class="text-right" style="width:90px">Matches</th>
            <th class="text-center" style="width:110px">W - L - T</th>
            <th data-sort="kdr" class="text-right" style="width:80px">K/D</th>
            <th data-sort="adr" class="text-right" style="width:80px">ADR</th>
            <th data-sort="kast" class="text-right" style="width:80px">KAST</th>
            <th data-sort="damage" class="text-right" style="width:90px">Damage</th>
            <th data-sort="teamDamage" class="text-right" style="width:80px">FF DMG</th>
            <th data-sort="kills" class="text-right" style="width:80px">Kills</th>
            <th data-sort="deaths" class="text-right" style="width:80px">Deaths</th>
            <th data-sort="assists" class="text-right" style="width:80px">Assists</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </section>
  </div>
</div>

<!-- Player Dossier Modal -->
<div id="playerModalBackdrop" class="modal-backdrop" hidden>
  <div class="modal-card panel">
    <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
    <header class="modal-header">
      <div>
        <div style="font-family:var(--font-display);font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);margin-bottom:2px">Player Dossier</div>
        <h2 id="modalPlayerName" class="modal-title">—</h2>
        <div id="modalPlayerAliases" style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap"></div>
      </div>
      <button id="modalCloseBtn" class="close-btn">CLOSE &times;</button>
    </header>

    <div class="modal-body">
      <!-- Top Stat Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:12px">
        <div class="stat-tile" style="padding:14px">
          <div class="label">DPL Rating</div>
          <div class="value" id="modalRating" style="color:var(--accent);font-size:28px">1.00</div>
          <div class="sub">Combat performance</div>
        </div>
        <div class="stat-tile" style="padding:14px">
          <div class="label">Win Rate</div>
          <div class="value" id="modalWinRate" style="font-size:28px">0%</div>
          <div class="sub" id="modalWlt">0W - 0L - 0T</div>
        </div>
        <div class="stat-tile" style="padding:14px">
          <div class="label">K/D Ratio</div>
          <div class="value" id="modalKdr" style="font-size:28px">0.00</div>
          <div class="sub" id="modalKdSub">0 kills / 0 deaths</div>
        </div>
        <div class="stat-tile" style="padding:14px">
          <div class="label">ADR / KAST</div>
          <div class="value" id="modalAdr" style="font-size:28px">0</div>
          <div class="sub" id="modalKastSub">0% KAST</div>
        </div>
        <div class="stat-tile" style="padding:14px">
          <div class="label">Damage</div>
          <div class="value" id="modalDamage" style="font-size:28px">0</div>
          <div class="sub">total damage done</div>
        </div>
        <div class="stat-tile" style="padding:14px">
          <div class="label">Friendly Fire</div>
          <div class="value" id="modalTeamDamage" style="font-size:28px;color:var(--loss-bright)">0</div>
          <div class="sub">team damage dealt</div>
        </div>
        <div class="stat-tile" style="padding:14px">
          <div class="label">Opening Duels</div>
          <div class="value" id="modalDuels" style="font-size:28px">—</div>
          <div class="sub" id="modalDuelsSub">0 won / 0 total</div>
        </div>
      </div>

      <!-- Attack vs Defense Role Splits -->
      <div class="panel" style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
        <div style="font-family:var(--font-display);font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim)">Role Performance Splits</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>
            <div style="font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--loss-bright);text-transform:uppercase">Attack Role</div>
            <div style="font-family:var(--font-display);font-size:24px;font-weight:700;color:var(--text-bright)" id="modalAtkAdr">0 ADR</div>
            <div style="font-size:12px;color:var(--text-muted)" id="modalAtkRounds">0 rounds played</div>
          </div>
          <div>
            <div style="font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--accent-bright);text-transform:uppercase">Defense Role</div>
            <div style="font-family:var(--font-display);font-size:24px;font-weight:700;color:var(--text-bright)" id="modalDefAdr">0 ADR</div>
            <div style="font-size:12px;color:var(--text-muted)" id="modalDefRounds">0 rounds played</div>
          </div>
        </div>
      </div>

      <!-- Weapons & Matches Split Grid -->
      <div style="display:grid;grid-template-columns:280px 1fr;gap:20px;align-items:start">
        <!-- Top Weapons Table -->
        <div class="panel" style="padding:16px;max-height:360px;overflow-y:auto">
          <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
          <div style="font-family:var(--font-display);font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px">Top Weapons</div>
          <table class="data-table" style="font-size:12px">
            <thead>
              <tr>
                <th>Weapon</th>
                <th class="text-right">Kills</th>
                <th class="text-right">Damage</th>
              </tr>
            </thead>
            <tbody id="modalWeaponsBody"></tbody>
          </table>
        </div>

        <!-- Recent Matches Table -->
        <div class="panel" style="padding:16px;max-height:360px;overflow-y:auto">
          <span class="corner tl">+</span><span class="corner tr">+</span><span class="corner bl">+</span><span class="corner br">+</span>
          <div style="font-family:var(--font-display);font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px">Recent Matches</div>
          <table class="data-table" style="font-size:12px">
            <thead>
              <tr>
                <th>Matchup</th>
                <th class="text-center">Outcome</th>
                <th class="text-center">Score</th>
                <th class="text-right">K/D/A</th>
                <th class="text-right">Rating</th>
                <th class="text-right">Date</th>
              </tr>
            </thead>
            <tbody id="modalMatchesBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</div>

<script>window.GLOBAL_DATABASE = <?= $dbData ? json_encode($dbData, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) : 'null' ?>;</script>

<script>
(function() {
  const db = window.GLOBAL_DATABASE;

  if (!db || !db.players || db.players.length === 0) {
    document.getElementById('missingDbNotice').style.display = 'block';
    document.getElementById('mainContent').style.display = 'none';
    return;
  }

  // Populate metadata
  const meta = db.meta || {};
  document.getElementById('statTotalPlayers').textContent = (meta.totalPlayers || db.players.length).toLocaleString();
  document.getElementById('statTotalMatches').textContent = (meta.totalMatches || 0).toLocaleString();
  document.getElementById('statMatchesSub').textContent = (meta.casualMatches > 0)
    ? `${meta.rankedMatches || 0} Ranked / ${meta.casualMatches} Casual`
    : 'Ranked Matches';
  document.getElementById('statTotalKills').textContent = (meta.totalKills || 0).toLocaleString();
  document.getElementById('statPitClaims').textContent = (meta.pitClaims || 0).toLocaleString();

  let sortColumn = 'dplRating';
  let sortAscending = false;
  let minMatches = 0;
  let searchTerm = '';

  const tableBody = document.getElementById('tableBody');
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  const filterPills = document.querySelectorAll('#filterPills .pill');
  const visibleCountEl = document.getElementById('visibleCount');
  const totalCountEl = document.getElementById('totalCount');

  totalCountEl.textContent = db.players.length.toLocaleString();

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getFilteredPlayers() {
    return db.players.filter((p) => {
      if (p.matches < minMatches) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchName = p.name && p.name.toLowerCase().includes(term);
        const matchAlias = Array.isArray(p.aliases) && p.aliases.some((a) => a.toLowerCase().includes(term));
        if (!matchName && !matchAlias) return false;
      }
      return true;
    });
  }

  function renderTable() {
    const players = getFilteredPlayers();

    players.sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];

      if (sortColumn === 'name') {
        return sortAscending ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      if (typeof valA === 'undefined') valA = 0;
      if (typeof valB === 'undefined') valB = 0;

      if (valA === valB) {
        return b.matches - a.matches;
      }
      return sortAscending ? valA - valB : valB - valA;
    });

    visibleCountEl.textContent = players.length.toLocaleString();
    tableBody.innerHTML = '';

    if (players.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="14" class="empty-banner">No players match the current search filter.</td></tr>';
      return;
    }

    players.forEach((p, idx) => {
      const tr = document.createElement('tr');
      const rank = idx + 1;
      const rankClass = rank === 1 ? 'rank-top1' : (rank === 2 ? 'rank-top2' : (rank === 3 ? 'rank-top3' : ''));

      const aliasStr = Array.isArray(p.aliases) && p.aliases.length > 1
        ? `<span class="alias-tag">(aka ${escapeHtml(p.aliases.filter(a => a !== p.name).slice(0, 2).join(', '))})</span>`
        : '';

      const winRatePct = Math.round(p.winRate || 0);

      tr.innerHTML = `
        <td class="text-center rank-badge ${rankClass}">${rank}</td>
        <td>
          <div class="player-name-cell">
            <span>${escapeHtml(p.name)}</span>
            ${aliasStr}
          </div>
        </td>
        <td class="text-center"><span class="rating-badge">${p.dplRating.toFixed(2)}</span></td>
        <td>
          <div class="win-bar-wrap">
            <span style="font-weight:600">${winRatePct}%</span>
            <div class="win-bar-track"><div class="win-bar-fill" style="width:${winRatePct}%"></div></div>
          </div>
        </td>
        <td class="text-right" style="font-weight:600">${p.matches}</td>
        <td class="text-center" style="color:var(--text-dim)">${p.wins} - ${p.losses} - ${p.ties}</td>
        <td class="text-right" style="font-weight:600">${p.kdr.toFixed(2)}</td>
        <td class="text-right">${p.adr}</td>
        <td class="text-right">${p.kast}%</td>
        <td class="text-right" style="font-weight:600">${(p.damage || 0).toLocaleString()}</td>
        <td class="text-right" style="color:${(p.teamDamage || 0) > 0 ? 'var(--loss-bright)' : 'var(--text-faint)'}">${(p.teamDamage || 0).toLocaleString()}</td>
        <td class="text-right" style="color:var(--text-bright)">${p.kills}</td>
        <td class="text-right" style="color:var(--text-dim)">${p.deaths}</td>
        <td class="text-right" style="color:var(--text-muted)">${p.assists}</td>
      `;

      tr.addEventListener('click', () => openPlayerModal(p));
      tableBody.appendChild(tr);
    });
  }

  // Sorting Handler
  const thElements = document.querySelectorAll('#leaderboardTable th[data-sort]');
  thElements.forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (sortColumn === col) {
        sortAscending = !sortAscending;
      } else {
        sortColumn = col;
        sortAscending = (col === 'name');
      }

      thElements.forEach((el) => {
        el.classList.remove('sorted');
        const text = el.textContent.replace(/[ ▲▼]/g, '');
        el.textContent = text;
      });

      th.classList.add('sorted');
      th.textContent = `${th.textContent} ${sortAscending ? '▲' : '▼'}`;
      renderTable();
    });
  });

  // Search input
  searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    searchClearBtn.style.display = searchTerm ? 'block' : 'none';
    renderTable();
  });
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchTerm = '';
    searchClearBtn.style.display = 'none';
    searchInput.focus();
    renderTable();
  });

  // Filters
  filterPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterPills.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      minMatches = parseInt(btn.getAttribute('data-min-matches'), 10) || 0;
      renderTable();
    });
  });

  // Theme Toggle
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  themeToggleBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
  });

  // Player Modal Logic
  const modalBackdrop = document.getElementById('playerModalBackdrop');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  function openPlayerModal(p) {
    if (!p) return;
    document.getElementById('modalPlayerName').textContent = p.name;

    const aliasesEl = document.getElementById('modalPlayerAliases');
    aliasesEl.innerHTML = '';
    if (Array.isArray(p.aliases) && p.aliases.length > 0) {
      p.aliases.forEach((alias) => {
        const tag = document.createElement('span');
        tag.className = 'pill';
        tag.style.fontSize = '11px';
        tag.style.padding = '2px 8px';
        tag.textContent = alias;
        aliasesEl.appendChild(tag);
      });
    }

    document.getElementById('modalRating').textContent = p.dplRating.toFixed(2);
    document.getElementById('modalWinRate').textContent = `${Math.round(p.winRate || 0)}%`;
    document.getElementById('modalWlt').textContent = `${p.wins}W - ${p.losses}L - ${p.ties}T (${p.matches} matches)`;
    document.getElementById('modalKdr').textContent = p.kdr.toFixed(2);
    document.getElementById('modalKdSub').textContent = `${p.kills} kills / ${p.deaths} deaths`;
    document.getElementById('modalAdr').textContent = p.adr;
    document.getElementById('modalKastSub').textContent = `${p.kast}% KAST (${p.roundsCounted} rounds)`;
    document.getElementById('modalDamage').textContent = (p.damage || 0).toLocaleString();
    document.getElementById('modalTeamDamage').textContent = (p.teamDamage || 0).toLocaleString();

    if (p.duels && typeof p.duels.pct === 'number') {
      document.getElementById('modalDuels').textContent = `${p.duels.pct}%`;
      document.getElementById('modalDuelsSub').textContent = `${p.duels.won} won / ${p.duels.involved} duels`;
    } else {
      document.getElementById('modalDuels').textContent = '—';
      document.getElementById('modalDuelsSub').textContent = 'No duels recorded';
    }

    // Role splits
    const atk = p.roles?.attack;
    const def = p.roles?.defense;
    document.getElementById('modalAtkAdr').textContent = atk ? `${atk.adr} ADR` : '0 ADR';
    document.getElementById('modalAtkRounds').textContent = atk ? `${atk.rounds} attack rounds played` : '0 rounds';
    document.getElementById('modalDefAdr').textContent = def ? `${def.adr} ADR` : '0 ADR';
    document.getElementById('modalDefRounds').textContent = def ? `${def.rounds} defense rounds played` : '0 rounds';

    // Weapons
    const weaponsBody = document.getElementById('modalWeaponsBody');
    weaponsBody.innerHTML = '';
    const weapons = p.topWeapons || [];
    if (weapons.length === 0) {
      weaponsBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No weapons recorded</td></tr>';
    } else {
      weapons.forEach((w) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="font-weight:600">${escapeHtml(w.label || w.name)}</td>
          <td class="text-right" style="color:var(--accent);font-weight:700">${w.kills}</td>
          <td class="text-right" style="color:var(--text-bright);font-weight:600">${(w.damage || 0).toLocaleString()}</td>
        `;
        weaponsBody.appendChild(tr);
      });
    }

    // Recent Matches
    const matchesBody = document.getElementById('modalMatchesBody');
    matchesBody.innerHTML = '';
    const recent = p.recentMatches || [];
    if (recent.length === 0) {
      matchesBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No matches recorded</td></tr>';
    } else {
      recent.forEach((m) => {
        const tr = document.createElement('tr');
        const outClass = m.result === 'WIN' ? 'outcome-win' : (m.result === 'LOSS' ? 'outcome-loss' : 'outcome-tie');
        tr.innerHTML = `
          <td>${escapeHtml(m.matchup || m.matchName || 'Unknown Match')}</td>
          <td class="text-center"><span class="outcome-pill ${outClass}">${m.result}</span></td>
          <td class="text-center" style="font-weight:600">${escapeHtml(m.score || '—')}</td>
          <td class="text-right" style="color:var(--text-dim)">${m.kills}/${m.deaths}/${m.assists}</td>
          <td class="text-right" style="color:var(--accent);font-weight:700">${m.rating ? m.rating.toFixed(2) : '—'}</td>
          <td class="text-right" style="color:var(--text-muted);font-size:11px">${escapeHtml(m.dateFormatted || '—')}</td>
        `;
        matchesBody.appendChild(tr);
      });
    }

    modalBackdrop.hidden = false;
  }

  function closeModal() {
    modalBackdrop.hidden = true;
  }

  modalCloseBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalBackdrop.hidden) closeModal();
  });

  renderTable();
})();
</script>
</body>
</html>