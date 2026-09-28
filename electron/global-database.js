const { WEAPON_META, computeDplRating, getGlobalPitStats } = require('./match-archive');

/**
 * Aggregates matches from the Ranked archive into an objective,
 * global player database suitable for public web hosting.
 *
 * It is completely uncentered from the local user: every player's stats,
 * win rates, combat metrics, role splits, and match appearances are calculated
 * universally across recorded ranked matches.
 */
function buildGlobalPlayerDatabase(rankedArchive, otherArchive = null) {
  const rankedMatches = rankedArchive?.data?.matches || (Array.isArray(rankedArchive) ? rankedArchive : []);

  // Deduplicate ranked matches by matchId
  const seenMatchIds = new Set();
  const dedupedMatches = [];

  for (const m of rankedMatches) {
    if (m.isRanked === false) continue;
    if (m.modeOverride && m.modeOverride.toLowerCase() !== 'ranked') continue;
    const id = m.matchId || (m.timestamp ? `match_${m.timestamp}` : null);
    if (id) {
      if (seenMatchIds.has(id)) continue;
      seenMatchIds.add(id);
    }
    dedupedMatches.push({ ...m, isRanked: true });
  }

  // Sort matches chronologically
  dedupedMatches.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const playersMap = new Map();

  for (const match of dedupedMatches) {
    if (!match.teams) continue;

    const team0 = Array.isArray(match.teams) ? (match.teams[0] || []) : (match.teams?.[0] || match.teams?.['0'] || []);
    const team1 = Array.isArray(match.teams) ? (match.teams[1] || []) : (match.teams?.[1] || match.teams?.['1'] || []);

    // Determine final score for side 0 and side 1
    let score0 = null;
    let score1 = null;

    if (match.finalScore && typeof match.finalScore.side0 === 'number' && typeof match.finalScore.side1 === 'number') {
      score0 = match.finalScore.side0;
      score1 = match.finalScore.side1;
    } else if (typeof match.team0Score === 'number' && typeof match.team1Score === 'number') {
      score0 = match.team0Score;
      score1 = match.team1Score;
    } else if (typeof match.myScore === 'number' && typeof match.oppScore === 'number') {
      const localId = rankedArchive?.data?.localAccountId || otherArchive?.data?.localAccountId;
      let meSide = null;
      if (localId) {
        if (team0.some((r) => r.accountId === localId)) meSide = 0;
        else if (team1.some((r) => r.accountId === localId)) meSide = 1;
      }
      if (meSide === 0) {
        score0 = match.myScore;
        score1 = match.oppScore;
      } else if (meSide === 1) {
        score0 = match.oppScore;
        score1 = match.myScore;
      } else {
        score0 = match.won ? match.myScore : match.oppScore;
        score1 = match.won ? match.oppScore : match.myScore;
      }
    }

    const won0 = (score0 !== null && score1 !== null) ? score0 > score1 : false;
    const lost0 = (score0 !== null && score1 !== null) ? score0 < score1 : false;
    const tied0 = (score0 !== null && score1 !== null) ? score0 === score1 : false;

    const won1 = lost0;
    const lost1 = won0;
    const tied1 = tied0;

    const sides = [
      { side: 0, rows: team0, won: won0, lost: lost0, tied: tied0, score: score0, oppScore: score1 },
      { side: 1, rows: team1, won: won1, lost: lost1, tied: tied1, score: score1, oppScore: score0 },
    ];

    for (const { side, rows, won, lost, tied, score: myScore, oppScore } of sides) {
      for (const r of rows) {
        const accountId = r.accountId || (r.name ? `name:${r.name.toLowerCase()}` : null);
        if (!accountId) continue;

        let p = playersMap.get(accountId);
        if (!p) {
          p = {
            accountId,
            name: r.name || 'Unknown',
            aliases: new Set(),
            latestTimestamp: match.timestamp || 0,
            matches: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            damage: 0,
            roundsCounted: 0,
            kastRounds: 0,
            teamDamage: 0,
            attackRounds: 0,
            attackDamage: 0,
            defenseRounds: 0,
            defenseDamage: 0,
            openingDuelsWon: 0,
            openingDuelsInvolved: 0,
            weapons: new Map(),
            recentMatches: [],
          };
          playersMap.set(accountId, p);
        }

        if (r.name) {
          p.aliases.add(r.name);
          if ((match.timestamp || 0) >= p.latestTimestamp) {
            p.name = r.name;
            p.latestTimestamp = match.timestamp || 0;
          }
        }

        p.matches += 1;
        if (won) p.wins += 1;
        else if (lost) p.losses += 1;
        else if (tied) p.ties += 1;

        p.kills += r.kills ?? 0;
        p.deaths += r.deaths ?? 0;
        p.assists += r.assists ?? 0;
        p.damage += r.damage ?? 0;
        p.teamDamage += r.teamDamage ?? 0;

        const matchRounds = r.kast?.roundsCounted ?? match.roundCount ?? 0;
        p.roundsCounted += matchRounds;
        p.kastRounds += r.kast?.kastRounds ?? 0;

        if (r.adr) {
          const atkDmg = r.adr.attackDamageRaw !== undefined
            ? r.adr.attackDamageRaw
            : (r.adr.attack ?? 0) * (r.adr.attackRounds ?? 0);
          p.attackDamage += atkDmg;
          p.attackRounds += r.adr.attackRounds ?? 0;

          const defDmg = r.adr.defenseDamageRaw !== undefined
            ? r.adr.defenseDamageRaw
            : (r.adr.defense ?? 0) * (r.adr.defenseRounds ?? 0);
          p.defenseDamage += defDmg;
          p.defenseRounds += r.adr.defenseRounds ?? 0;
        }

        if (r.openingDuels) {
          p.openingDuelsWon += r.openingDuels.won ?? 0;
          p.openingDuelsInvolved += r.openingDuels.involved ?? 0;
        }

        if (Array.isArray(r.weaponBreakdown)) {
          for (const w of r.weaponBreakdown) {
            const key = w.damageSource !== undefined ? w.damageSource : w.label;
            if (!key) continue;
            const label = (w.damageSource !== undefined && WEAPON_META[w.damageSource]?.label)
              ? WEAPON_META[w.damageSource].label
              : (w.label || `Weapon #${w.damageSource}`);
            const existingW = p.weapons.get(key) ?? {
              label,
              kills: 0,
              headshots: 0,
              hits: 0,
              damage: 0,
            };
            existingW.kills += w.kills ?? 0;
            existingW.headshots += w.headshots ?? 0;
            existingW.hits += w.hits ?? 0;
            existingW.damage += w.damage ?? 0;
            p.weapons.set(key, existingW);
          }
        }

        const matchRating = computeDplRating({
          kills: r.kills ?? 0,
          deaths: r.deaths ?? 0,
          assists: r.assists ?? 0,
          damage: r.damage ?? 0,
          roundsCounted: matchRounds,
          kastRounds: r.kast?.kastRounds ?? 0,
          winRate: tied ? 50 : (won ? 100 : 0),
        });

        const team0 = match.team0Name || 'Blue Team';
        const team1 = match.team1Name || 'Orange Team';
        const matchup = match.matchup || `${team0} vs ${team1}`;

        p.recentMatches.push({
          matchId: match.matchId,
          matchup,
          matchName: matchup,
          team0Name: team0,
          team1Name: team1,
          timestamp: match.timestamp || 0,
          dateFormatted: match.timestamp ? new Date(match.timestamp).toLocaleDateString() : '—',
          isRanked: Boolean(match.isRanked),
          result: tied ? 'TIE' : (won ? 'WIN' : 'LOSS'),
          score: (myScore !== null && oppScore !== null) ? `${myScore} - ${oppScore}` : '—',
          kills: r.kills ?? 0,
          deaths: r.deaths ?? 0,
          assists: r.assists ?? 0,
          damage: r.damage ?? 0,
          rating: matchRating,
        });
      }
    }
  }

  const playersList = [...playersMap.values()].map((p) => {
    const winRate = (p.wins + p.losses) > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 1000) / 10 : 0;
    const kdr = p.deaths > 0 ? Math.round((p.kills / p.deaths) * 100) / 100 : p.kills;
    const kpr = p.roundsCounted > 0 ? Math.round((p.kills / p.roundsCounted) * 100) / 100 : 0;
    const adr = p.roundsCounted > 0 ? Math.round(p.damage / p.roundsCounted) : 0;
    const kast = p.roundsCounted > 0 ? Math.round((p.kastRounds / p.roundsCounted) * 1000) / 10 : 0;
    const dplRating = computeDplRating({
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      damage: p.damage,
      roundsCounted: p.roundsCounted,
      kastRounds: p.kastRounds,
      winRate: winRate || 50,
    });

    const attackAdr = p.attackRounds > 0 ? Math.round(p.attackDamage / p.attackRounds) : 0;
    const defenseAdr = p.defenseRounds > 0 ? Math.round(p.defenseDamage / p.defenseRounds) : 0;
    const duelsPct = p.openingDuelsInvolved > 0 ? Math.round((p.openingDuelsWon / p.openingDuelsInvolved) * 1000) / 10 : null;

    const topWeapons = [...p.weapons.values()]
      .sort((a, b) => b.kills - a.kills || b.damage - a.damage)
      .slice(0, 8);

    const sortedRecentMatches = p.recentMatches
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 15);

    return {
      accountId: p.accountId,
      name: p.name,
      aliases: [...p.aliases],
      matches: p.matches,
      wins: p.wins,
      losses: p.losses,
      ties: p.ties,
      winRate,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      damage: p.damage,
      roundsCounted: p.roundsCounted,
      kdr,
      kpr,
      adr,
      kast,
      dplRating,
      duels: {
        won: p.openingDuelsWon,
        involved: p.openingDuelsInvolved,
        pct: duelsPct,
      },
      roles: {
        attack: { rounds: p.attackRounds, damage: p.attackDamage, adr: attackAdr },
        defense: { rounds: p.defenseRounds, damage: p.defenseDamage, adr: defenseAdr },
      },
      topWeapons,
      recentMatches: sortedRecentMatches,
    };
  });

  // Sort by DPL rating descending by default
  playersList.sort((a, b) => b.dplRating - a.dplRating || b.matches - a.matches || a.name.localeCompare(b.name));

  const now = new Date();
  const lastUpdatedFormatted = now.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  let pitClaims = 0;
  if (typeof rankedArchive?.getPitStats === 'function') {
    pitClaims = rankedArchive.getPitStats()?.totalDeaths || 0;
  } else {
    for (const m of dedupedMatches) {
      for (const r of (m.rounds || [])) {
        for (const k of (r.kills || [])) {
          if (k.damageSource === -2 || k.hazard === 'PIT') pitClaims++;
        }
      }
    }
  }

  return {
    version: '1.0',
    generatedAt: now.toISOString(),
    lastUpdated: lastUpdatedFormatted,
    meta: {
      totalPlayers: playersList.length,
      totalMatches: dedupedMatches.length,
      rankedMatches: dedupedMatches.length,
      casualMatches: 0,
      totalKills: playersList.reduce((sum, p) => sum + p.kills, 0),
      totalDeaths: playersList.reduce((sum, p) => sum + p.deaths, 0),
      pitClaims,
    },
    players: playersList,
  };
}

/**
 * Generates the unified, full-featured web portal code.
 * When `isPhp` is true, generates PHP script (`index.php`) that dynamically loads `database.json`.
 * When `isPhp` is false, generates a self-contained `.html` file with the data inlined.
 */
function generatePortalMarkup(dbData, isPhp = false) {
  const phpPreamble = `<?php
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
?>`;

  const dataScript = isPhp
    ? `<script>window.GLOBAL_DATABASE = <?= $dbData ? json_encode($dbData, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) : 'null' ?>;</script>`
    : `<script>window.GLOBAL_DATABASE = ${JSON.stringify(dbData)};</script>`;

  const initialLastUpdated = isPhp
    ? `<?= htmlspecialchars($lastUpdated) ?>`
    : (dbData?.lastUpdated || 'Recently');

  return `${isPhp ? phpPreamble + '\n' : ''}<!doctype html>
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
        <span>Last Updated: <strong id="lastUpdatedVal">${initialLastUpdated}</strong></span>
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
      <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:12px">
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
                <th class="text-right">HS %</th>
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

${dataScript}

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
    ? \`\${meta.rankedMatches || 0} Ranked / \${meta.casualMatches} Casual\`
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
      tableBody.innerHTML = '<tr><td colspan="12" class="empty-banner">No players match the current search filter.</td></tr>';
      return;
    }

    players.forEach((p, idx) => {
      const tr = document.createElement('tr');
      const rank = idx + 1;
      const rankClass = rank === 1 ? 'rank-top1' : (rank === 2 ? 'rank-top2' : (rank === 3 ? 'rank-top3' : ''));

      const aliasStr = Array.isArray(p.aliases) && p.aliases.length > 1
        ? \`<span class="alias-tag">(aka \${escapeHtml(p.aliases.filter(a => a !== p.name).slice(0, 2).join(', '))})</span>\`
        : '';

      const winRatePct = Math.round(p.winRate || 0);

      tr.innerHTML = \`
        <td class="text-center rank-badge \${rankClass}">\${rank}</td>
        <td>
          <div class="player-name-cell">
            <span>\${escapeHtml(p.name)}</span>
            \${aliasStr}
          </div>
        </td>
        <td class="text-center"><span class="rating-badge">\${p.dplRating.toFixed(2)}</span></td>
        <td>
          <div class="win-bar-wrap">
            <span style="font-weight:600">\${winRatePct}%</span>
            <div class="win-bar-track"><div class="win-bar-fill" style="width:\${winRatePct}%"></div></div>
          </div>
        </td>
        <td class="text-right" style="font-weight:600">\${p.matches}</td>
        <td class="text-center" style="color:var(--text-dim)">\${p.wins} - \${p.losses} - \${p.ties}</td>
        <td class="text-right" style="font-weight:600">\${p.kdr.toFixed(2)}</td>
        <td class="text-right">\${p.adr}</td>
        <td class="text-right">\${p.kast}%</td>
        <td class="text-right" style="color:var(--text-bright)">\${p.kills}</td>
        <td class="text-right" style="color:var(--text-dim)">\${p.deaths}</td>
        <td class="text-right" style="color:var(--text-muted)">\${p.assists}</td>
      \`;

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
      th.textContent = \`\${th.textContent} \${sortAscending ? '▲' : '▼'}\`;
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
    document.getElementById('modalWinRate').textContent = \`\${Math.round(p.winRate || 0)}%\`;
    document.getElementById('modalWlt').textContent = \`\${p.wins}W - \${p.losses}L - \${p.ties}T (\${p.matches} matches)\`;
    document.getElementById('modalKdr').textContent = p.kdr.toFixed(2);
    document.getElementById('modalKdSub').textContent = \`\${p.kills} kills / \${p.deaths} deaths\`;
    document.getElementById('modalAdr').textContent = p.adr;
    document.getElementById('modalKastSub').textContent = \`\${p.kast}% KAST (\${p.roundsCounted} rounds)\`;

    if (p.duels && typeof p.duels.pct === 'number') {
      document.getElementById('modalDuels').textContent = \`\${p.duels.pct}%\`;
      document.getElementById('modalDuelsSub').textContent = \`\${p.duels.won} won / \${p.duels.involved} duels\`;
    } else {
      document.getElementById('modalDuels').textContent = '—';
      document.getElementById('modalDuelsSub').textContent = 'No duels recorded';
    }

    // Role splits
    const atk = p.roles?.attack;
    const def = p.roles?.defense;
    document.getElementById('modalAtkAdr').textContent = atk ? \`\${atk.adr} ADR\` : '0 ADR';
    document.getElementById('modalAtkRounds').textContent = atk ? \`\${atk.rounds} attack rounds played\` : '0 rounds';
    document.getElementById('modalDefAdr').textContent = def ? \`\${def.adr} ADR\` : '0 ADR';
    document.getElementById('modalDefRounds').textContent = def ? \`\${def.rounds} defense rounds played\` : '0 rounds';

    // Weapons
    const weaponsBody = document.getElementById('modalWeaponsBody');
    weaponsBody.innerHTML = '';
    const weapons = p.topWeapons || [];
    if (weapons.length === 0) {
      weaponsBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No weapons recorded</td></tr>';
    } else {
      weapons.forEach((w) => {
        const tr = document.createElement('tr');
        const hsPct = w.hits > 0 ? Math.round((w.headshots / w.hits) * 100) : 0;
        tr.innerHTML = \`
          <td style="font-weight:600">\${escapeHtml(w.label || w.name)}</td>
          <td class="text-right" style="color:var(--accent);font-weight:700">\${w.kills}</td>
          <td class="text-right" style="color:var(--text-dim)">\${hsPct}%</td>
        \`;
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
        tr.innerHTML = \`
          <td>\${escapeHtml(m.matchup || m.matchName || 'Unknown Match')}</td>
          <td class="text-center"><span class="outcome-pill \${outClass}">\${m.result}</span></td>
          <td class="text-center" style="font-weight:600">\${escapeHtml(m.score || '—')}</td>
          <td class="text-right" style="color:var(--text-dim)">\${m.kills}/\${m.deaths}/\${m.assists}</td>
          <td class="text-right" style="color:var(--accent);font-weight:700">\${m.rating ? m.rating.toFixed(2) : '—'}</td>
          <td class="text-right" style="color:var(--text-muted);font-size:11px">\${escapeHtml(m.dateFormatted || '—')}</td>
        \`;
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
</html>`;
}

module.exports = {
  buildGlobalPlayerDatabase,
  generatePortalMarkup,
};
