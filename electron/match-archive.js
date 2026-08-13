'use strict';
// Full-match archive for the local player — replaces the earlier
// store.js/lifetime-stats.json design, which only kept summary numbers
// (K-D-A, map, score) per match and discarded the rest of the scoreboard
// once totals were extracted. This keeps the COMPLETE computeMatchStats()
// output for every match: every player, both teams, every column — so a
// match's full scoreboard can still be viewed after its source Player.log
// has rotated away and is gone for good (see the durability note below).
//
// Plain JSON file on disk via plain Node `fs` — no Electron APIs. Portable
// to a future Overwolf overlay the same way store.js was.
//

// TOTALS DESIGN CHOICE: lifetime totals (kills/deaths/wins/losses/etc.) are
// computed by SUMMING this.data.matches on every read — nothing is cached
// to disk. The earlier store.js kept a separate running `totals` object
// incremented alongside `history`, updated in lockstep by convention; that
// convention is exactly the kind of thing a future code path could forget
// to honor (a bug, a manual edit to the file, a partial write) and silently
// drift from the real match list. Deriving totals fresh from the match list
// makes that class of bug structurally impossible — there is no second
// value that could ever disagree with the source of truth, because there
// isn't a second value. At personal-use scale (hundreds of matches, not
// millions) summing on load costs microseconds, so there's no real
// performance argument for caching it.
//
// DURABILITY: same boundary as before — Due Process keeps only two log
// sessions on disk (Player.log, Player-prev.log), rotating one out
// permanently on every game launch. This archive is the only durable
// record of anything older than that, which is exactly why recordMatch()
// still saves synchronously and immediately, never batched.

const fs = require('node:fs');
const path = require('node:path');

const MAX_MATCHES = 1000;

const WEAPON_META = {
  0: { label: 'Dawn', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 25, rpm: 460, wikiUrl: 'https://dueprocess.fandom.com/wiki/Dawn', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/a/a2/Dawn.png' },
  1: { label: 'AP-25', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 20, rpm: 600, wikiUrl: 'https://dueprocess.fandom.com/wiki/AP-25', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/4d/AP-25-Logo.png' },
  2: { label: 'BLK-TAR', category: 'Assault Rifle', fireType: 'Semi', baseDamage: 30, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/BLK-TAR', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/d/dd/BLK-Tar.png' },
  3: { label: 'GAT-9', category: 'Handgun', fireType: 'Semi', baseDamage: 20, rpm: 420, wikiUrl: 'https://dueprocess.fandom.com/wiki/Gat-9', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/e/e3/Gat-9.png' },
  4: { label: 'Gruber-5', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 22, rpm: 720, wikiUrl: 'https://dueprocess.fandom.com/wiki/Gruber-5', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/a/a0/Gruber-5.png' },
  5: { label: 'PK-57', category: 'Handgun', fireType: 'Semi', baseDamage: 20, rpm: 410, wikiUrl: 'https://dueprocess.fandom.com/wiki/PK-57', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/40/PK-57-Logo.png' },
  6: { label: 'SAB-R', category: 'Battle Rifle', fireType: 'Semi', baseDamage: 50, rpm: 240, wikiUrl: 'https://dueprocess.fandom.com/wiki/SAB-R', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/9/90/SABR-Logo.png' },
  7: { label: 'DL-12', category: 'Shotgun', fireType: 'Pump', baseDamage: 20, rpm: 60, wikiUrl: 'https://dueprocess.fandom.com/wiki/DL-12', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/c/c2/DL-12.png' },
  8: { label: 'KR82M', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 30, rpm: 540, wikiUrl: 'https://dueprocess.fandom.com/wiki/KR82M', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/8/82/KR-82M.png' },
  9: { label: 'LS-45', category: 'Handgun', fireType: 'Semi', baseDamage: 30, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/LS45', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/e/e6/LS45.png' },
  10: { label: 'Nack-11', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 18, rpm: 1080, wikiUrl: 'https://dueprocess.fandom.com/wiki/Nack-11', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/7/78/Nack-11.png' },
  11: { label: 'MAWP', category: 'Sniper Rifle', fireType: 'Single', baseDamage: 85, rpm: 23, wikiUrl: 'https://dueprocess.fandom.com/wiki/MAWP', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/f/f6/MAWP.png' },
  12: { label: 'Ingmar-57', category: 'Battle Rifle', fireType: 'Auto', baseDamage: 37, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/INGMAR-57', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/40/Ingmar.png' },
  13: { label: 'Legros', category: 'Assault Rifle', fireType: 'Semi', baseDamage: 40, rpm: 260, wikiUrl: 'https://dueprocess.fandom.com/wiki/F1-Legros', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/b/b9/F1_Legros.png' },
  14: { label: 'TUB-12', category: 'Shotgun', fireType: 'Pump', baseDamage: 20, rpm: 60, wikiUrl: 'https://dueprocess.fandom.com/wiki/TUB-12', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/b/bf/Tub.png' },
  15: { label: 'Auto Shotgun', category: 'Shotgun', fireType: 'Auto', baseDamage: 20, rpm: 240, wikiUrl: 'https://dueprocess.fandom.com/wiki/Auto_Shotgun', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/47/Autoshotgun.png' },
  17: { label: 'KR82U', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 30, rpm: 540, wikiUrl: 'https://dueprocess.fandom.com/wiki/KR82U', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/f/fd/KR82U.png' },
  // Same baseDamage/rpm as Gruber-5 (4), kept in sync with stats.js's
  // weaponMeta — see that file's comment for how this was identified from
  // log evidence (a suppressor doesn't change damage, only sound/recoil).
  19: { label: 'Gruber-SD', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 22, rpm: 720, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: null },
  50: { label: 'Grenade', category: 'Explosive', fireType: 'Throwable', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: null },
  51: { label: 'Molotov Cocktail', category: 'Explosive', fireType: 'Throwable', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: null },
};

function emptyData() {
  return {
    version: 1,
    localAccountId: null,
    matches: [], // most-recent-last; see recordMatch() for shape
  };
}

class MatchArchive {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...emptyData(), ...parsed };
    } catch {
      return emptyData();
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Write-then-rename so a crash mid-write can't corrupt the archive.
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  getLocalAccountId() {
    return this.data.localAccountId;
  }

  setLocalAccountId(accountId) {
    if (this.data.localAccountId === accountId) return;
    this.data.localAccountId = accountId;
    this._save();
  }

  hasRecordedMatch(matchId) {
    return this.data.matches.some((m) => m.matchId === matchId);
  }

  /**
   * Whether an already-archived match is missing fields a newer schema
   * version added (roundsUsed/deaths/headshots on weaponBreakdown entries,
   * structured mapRounds, team0Name/team1Name) — used by recordMatch() to
   * let a rescan silently upgrade an old entry in place, but only when the
   * match is still reachable in the raw log to reprocess (see
   * rescan.js's dedup gate, which calls this before skipping an already-
   * recorded match).
   */
  isLegacyMatch(matchId) {
    const m = this.getMatch(matchId);
    if (!m) return false;
    const rounds = m.mapRounds || m.roundMaps;
    if (!rounds || !Array.isArray(rounds) || rounds.length < (m.roundCount ?? 1) || typeof rounds[0] === 'string' || !m.team0Name) return true;
    return (m.weaponBreakdown ?? []).some((w) => w.roundsUsed === undefined || w.deaths === undefined || w.headshots === undefined);
  }

  /**
   * Record one full match. `entry` shape:
   *   {
   *     matchId, timestamp, inferred,
   *     won, myScore, oppScore,             // local-player-perspective convenience fields
   *     mapLabel, roundMaps,
   *     localAccountId,                     // which accountId in `teams` is "you"
   *     roundCount, finalScore,             // finalScore: { side0, side1, source } — not perspective-flipped
   *     teams,                              // { 0: [row, ...], 1: [row, ...] } — FULL scoreboard, every player
   *     kills, deaths, assists, weaponBreakdown,  // local player's, denormalized for getTopWeapons()/getRecentKillsTrend()
   *   }
   * `teams` should be exactly stats.js's computeMatchStats() output for
   * this match — not trimmed down — so the match-detail view has everything
   * it needs without depending on the raw log still being on disk.
   *
   * If `entry.matchId` is already archived, it's left untouched UNLESS
   * isLegacyMatch() says it's missing newer fields — in that case it's
   * overwritten with the freshly computed `entry` (see isLegacyMatch's doc
   * comment).
   */
  recordMatch(entry) {
    const existingIndex = this.data.matches.findIndex((m) => m.matchId === entry.matchId);
    if (existingIndex !== -1) {
      if (this.isLegacyMatch(entry.matchId)) {
        this.data.matches[existingIndex] = entry;
        this._save();
      }
      return;
    }

    this.data.matches.push(entry);
    if (this.data.matches.length > MAX_MATCHES) {
      this.data.matches.splice(0, this.data.matches.length - MAX_MATCHES);
    }

    this._save();
  }

  /** Full archived record for one match (for the match-detail view), or null. */
  getMatch(matchId) {
    return this.data.matches.find((m) => m.matchId === matchId) ?? null;
  }

  /**
   * `accountId`'s display name as last seen in an archived match's `teams`
   * data, most recent match first, or null if `accountId` never appears.
   * Durable fallback for the Hub's Career Overview name: the live parser
   * only knows a name once this session's tailing has fed it, which can be
   * well after the Hub's first render (or never, if nothing new got
   * recorded this boot) — this works immediately, from disk, every time.
   */
  getPlayerName(accountId) {
    for (let i = this.data.matches.length - 1; i >= 0; i -= 1) {
      const teams = this.data.matches[i].teams;
      const row = teams[0].find((r) => r.accountId === accountId) ?? teams[1].find((r) => r.accountId === accountId);
      if (row) return row.name;
    }
    return null;
  }

  /**
   * Remove one match by MatchId. Returns true if something was actually
   * removed. Totals need no separate update — see the file-level note,
   * they're summed fresh from this.data.matches on every read.
   *
   * BEHAVIOR TO BE AWARE OF: hasRecordedMatch()/dedup only ever looks at
   * what's currently in this.data.matches. Deleting an entry makes that
   * MatchId "unseen" again from the archive's point of view — if the same
   * match is still reachable in Player.log or Player-prev.log the next time
   * a scan runs (live tailing or the startup catch-up scan), it WILL be
   * re-recorded. This is a deliberate consequence of dedup being
   * archive-state-based rather than a separate permanent ledger, not a bug
   * — flagged here, and in main.js's delete handler, rather than silently
   * relied on or silently guarded against.
   */
  deleteMatch(matchId) {
    const index = this.data.matches.findIndex((m) => m.matchId === matchId);
    if (index === -1) return false;
    this.data.matches.splice(index, 1);
    this._save();
    return true;
  }

  /** Career totals + derived rates for the Hub's stat tiles — see the file-level note on why these are summed, not cached. */
  getLifetimeStats() {
    let kills = 0;
    let deaths = 0;
    let assists = 0;
    let wins = 0;
    let losses = 0;
    // damage/kast aren't denormalized on the match entry the way
    // kills/deaths/assists are (see recordMatch's doc comment) — only
    // present inside the full teams scoreboard, so the local player's own
    // row has to be looked up there per match, same source
    // getPlayedWithStats() reads for every OTHER player's rating inputs.
    let damage = 0;
    let roundsCounted = 0;
    let kastRounds = 0;
    for (const m of this.data.matches) {
      kills += m.kills;
      deaths += m.deaths;
      assists += m.assists;
      if (m.won) wins += 1;
      else losses += 1;

      const myRow = m.teams?.[0]?.find((r) => r.accountId === m.localAccountId) ?? m.teams?.[1]?.find((r) => r.accountId === m.localAccountId);
      if (myRow) {
        damage += myRow.damage ?? 0;
        roundsCounted += myRow.kast?.roundsCounted ?? 0;
        kastRounds += myRow.kast?.kastRounds ?? 0;
      }
    }
    const matchesRecorded = this.data.matches.length;
    const kdr = deaths > 0 ? kills / deaths : kills;
    const totalDecided = wins + losses;
    const winRate = totalDecided > 0 ? (wins / totalDecided) * 100 : 0;
    const killsPerMatch = matchesRecorded > 0 ? kills / matchesRecorded : 0;
    const adr = roundsCounted > 0 ? damage / roundsCounted : 0;
    const kastPct = roundsCounted > 0 ? Math.round((kastRounds / roundsCounted) * 100) : 0;
    const { bestWinStreak, worstLossStreak } = this._streaks();
    return {
      totalKills: kills,
      totalDeaths: deaths,
      totalAssists: assists,
      kdr: round2(kdr),
      wins,
      losses,
      winRate: Math.round(winRate),
      matchesRecorded,
      killsPerMatch: round1(killsPerMatch),
      bestWinStreak,
      worstLossStreak,
      // adr/kast: same per-round inputs the dplRating below is built from —
      // exposed here too so a consumer (the Player Quick Reference modal's
      // self-view) can show them without recomputing anything.
      adr: Math.round(adr),
      kast: kastPct,
      // Same formula/scale as every other player's DPL Rating in Played
      // With — see computeDplRating's doc comment — just fed the local
      // player's own summed stats instead of a Played With aggregate.
      dplRating: computeDplRating({ kills, deaths, assists, damage, roundsCounted, kastRounds, winRate }),
    };
  }

  _streaks() {
    let bestWinStreak = 0;
    let worstLossStreak = 0;
    let curWin = 0;
    let curLoss = 0;
    for (const m of this.data.matches) {
      if (m.won) {
        curWin += 1;
        curLoss = 0;
      } else {
        curLoss += 1;
        curWin = 0;
      }
      bestWinStreak = Math.max(bestWinStreak, curWin);
      worstLossStreak = Math.max(worstLossStreak, curLoss);
    }
    return { bestWinStreak, worstLossStreak };
  }

  /**
   * Most recent matches first, for the Hub's Recent Matches list.
   */
  getRecentMatches(limit = 8) {
    return [...this.data.matches]
      .reverse()
      .slice(0, limit)
      .map((m) => ({
        matchId: m.matchId,
        timestamp: m.timestamp,
        won: m.won,
        myScore: m.myScore,
        oppScore: m.oppScore,
        team0Name: m.team0Name ?? 'Blue Team',
        team1Name: m.team1Name ?? 'Orange Team',
        matchup: `${m.team0Name || 'Blue Team'} vs ${m.team1Name || 'Orange Team'}`,
        mapLabel: m.mapLabel,
        mapRounds: m.mapRounds,
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        inferred: m.inferred,
      }));
  }

  /**
   * Lifetime per-weapon stats for the Hub's Weapons tab — kills, deaths
   * ("died by"), headshots/HS%, and kills-per-round-used — summed across
   * every archived match's local-player weaponBreakdown.
   */
  getWeaponStats() {
    const byCode = new Map();
    for (const match of this.data.matches) {
      for (const w of match.weaponBreakdown ?? []) {
        const meta = WEAPON_META[w.damageSource] ?? { label: w.label, category: w.category ?? 'Other', fireType: w.fireType ?? 'Unknown', baseDamage: w.baseDamage ?? null, rpm: w.rpm ?? null };
        const label = meta.label ?? w.label;
        const existing = byCode.get(w.damageSource) ?? {
          damageSource: w.damageSource,
          label: label === 'Big AK' ? 'KR82M' : label === 'Mini AK' ? 'KR82U' : label,
          category: w.category ?? meta.category,
          fireType: w.fireType ?? meta.fireType,
          baseDamage: w.baseDamage ?? meta.baseDamage,
          rpm: w.rpm ?? meta.rpm,
          wikiUrl: meta.wikiUrl ?? `https://dueprocess.fandom.com/wiki/${encodeURIComponent(label)}`,
          imageUrl: meta.imageUrl ?? null,
          kills: 0,
          deaths: 0,
          hits: 0,
          headshots: null,
          roundsUsed: 0,
        };
        existing.kills += w.kills;
        existing.deaths += w.deaths ?? 0;
        existing.hits += w.hits;
        existing.roundsUsed += w.roundsUsed ?? 0;
        if (w.headshots !== null && w.headshots !== undefined) {
          existing.headshots = (existing.headshots ?? 0) + w.headshots;
        }
        byCode.set(w.damageSource, existing);
      }
    }
    return [...byCode.values()]
      .map((w) => ({
        ...w,
        hsPercent: w.headshots !== null && w.hits > 0 ? Math.round((w.headshots / w.hits) * 100) : null,
        killsPerRound: w.roundsUsed > 0 ? round2(w.kills / w.roundsUsed) : 0,
      }))
      .sort((a, b) => b.kills - a.kills);
  }

  /** Lifetime kills/damage aggregated by weapon, most kills first (local player's weapons only). */
  getTopWeapons(limit = 4) {
    const byCode = new Map();
    for (const match of this.data.matches) {
      for (const w of match.weaponBreakdown ?? []) {
        if (w.hits === 0 && w.kills === 0) continue;
        const existing = byCode.get(w.damageSource) ?? {
          damageSource: w.damageSource,
          label: w.label,
          kills: 0,
          damage: 0,
        };
        existing.kills += w.kills;
        existing.damage += w.damage;
        byCode.set(w.damageSource, existing);
      }
    }
    return [...byCode.values()].sort((a, b) => b.kills - a.kills || b.damage - a.damage).slice(0, limit);
  }

  /** Kills for the last `limit` matches, oldest first (for a trend sparkline). */
  getRecentKillsTrend(limit = 12) {
    return this.data.matches.slice(-limit).map((m) => m.kills);
  }

  /**
   * Aggregates player performance for all players seen across archived matches
   * keyed by stable `accountId`.
   */
  getPlayedWithStats() {
    const localId = this.data.localAccountId;
    const byAccount = new Map();

    for (const match of this.data.matches) {
      if (!match.teams) continue;

      // Determine local player's side in this match
      let mySide = null;
      if (localId) {
        if (match.teams[0]?.some((r) => r.accountId === localId)) mySide = 0;
        else if (match.teams[1]?.some((r) => r.accountId === localId)) mySide = 1;
      }

      for (const side of [0, 1]) {
        const rows = match.teams[side] ?? [];
        const isMyTeam = mySide !== null ? side === mySide : side === 0;

        for (const r of rows) {
          if (r.accountId === localId) continue; // Skip local player

          const existing = byAccount.get(r.accountId) ?? {
            accountId: r.accountId,
            latestName: r.name,
            matchesTogether: 0,
            winsTogether: 0,
            lossesTogether: 0,
            matchesAgainst: 0,
            winsAgainst: 0,
            lossesAgainst: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            damage: 0,
            roundsCounted: 0,
            kastRounds: 0,
          };

          existing.latestName = r.name; // Keep most recent name
          existing.kills += r.kills ?? 0;
          existing.deaths += r.deaths ?? 0;
          existing.assists += r.assists ?? 0;
          existing.damage += r.damage ?? 0;
          existing.roundsCounted += r.kast?.roundsCounted ?? match.roundCount ?? 0;
          existing.kastRounds += r.kast?.kastRounds ?? 0;

          if (isMyTeam) {
            existing.matchesTogether += 1;
            if (match.won) existing.winsTogether += 1;
            else existing.lossesTogether += 1;
          } else {
            existing.matchesAgainst += 1;
            if (match.won) existing.winsAgainst += 1; // local player won against them
            else existing.lossesAgainst += 1;
          }

          byAccount.set(r.accountId, existing);
        }
      }
    }

    return [...byAccount.values()]
      .map((p) => {
        const totalMatches = p.matchesTogether + p.matchesAgainst;
        const winRateTogether = p.matchesTogether > 0 ? Math.round((p.winsTogether / p.matchesTogether) * 100) : 0;
        const winRateAgainst = p.matchesAgainst > 0 ? Math.round((p.winsAgainst / p.matchesAgainst) * 100) : 0;
        const kdr = p.deaths > 0 ? p.kills / p.deaths : p.kills;
        const adr = p.roundsCounted > 0 ? p.damage / p.roundsCounted : 0;
        const kastPct = p.roundsCounted > 0 ? Math.round((p.kastRounds / p.roundsCounted) * 100) : 0;
        const playerWins = p.winsTogether + p.lossesAgainst;
        const overallWinRate = totalMatches > 0 ? (playerWins / totalMatches) * 100 : 50;
        const dplRating = computeDplRating({
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          damage: p.damage,
          roundsCounted: p.roundsCounted,
          kastRounds: p.kastRounds,
          winRate: overallWinRate,
        });

        return {
          ...p,
          totalMatches,
          winRateTogether,
          winRateAgainst,
          kdr: round2(kdr),
          adr: Math.round(adr),
          kast: kastPct,
          dplRating,
        };
      })
      .sort((a, b) => b.totalMatches - a.totalMatches);
  }

  /**
   * Single player lookup by accountId for quick reference modal.
   */
  getSinglePlayedWith(accountId) {
    return this.getPlayedWithStats().find((p) => p.accountId === accountId) ?? null;
  }

  saveMapNote(mapName, note) {
    if (!this.data.mapNotes) this.data.mapNotes = {};
    this.data.mapNotes[mapName] = note;
    this._save();
  }

  /**
   * Structured quick-tags per map layout (e.g. "Sniper", "Door Needed" —
   * see hub-renderer.js's MAP_TAGS for the current fixed set) —
   * sibling to mapNotes above, same keyed-by-mapName shape, same
   * save-whole-value-on-every-call pattern. `tags` is the full replacement
   * array for this map, not a single tag to add/remove — the caller
   * (hub-renderer.js) always sends the complete currently-selected set.
   */
  saveMapTags(mapName, tags) {
    if (!this.data.mapTags) this.data.mapTags = {};
    this.data.mapTags[mapName] = tags;
    this._save();
  }

  /**
   * Per-map layout, tileset, and every-round map stats breakdown across all archived matches.
   */
  getMapStats() {
    const byTileset = new Map();
    const byMapName = new Map();
    const everyMap = [];

    const parseTilesetFromLabel = (label) => {
      if (!label) return 'Unknown';
      const m = /^\[([^\]]+)\]/.exec(label);
      return m ? m[1].replace(/_Day$/i, '') : 'Unknown';
    };

    const mapNotes = this.data.mapNotes || {};
    const mapTags = this.data.mapTags || {};

    for (const match of this.data.matches) {
      const team0 = match.team0Name || 'Blue Team';
      const team1 = match.team1Name || 'Orange Team';
      const matchup = `${team0} vs ${team1}`;

      const rawRounds = match.mapRounds || match.roundMaps;
      let rounds = Array.isArray(rawRounds) && rawRounds.length > 0 ? rawRounds : null;

      // Fallback for legacy match records where mapRounds is missing: create 1 map entry from mapLabel
      if (!rounds && match.mapLabel) {
        rounds = [{ mapLabel: match.mapLabel, tileset: parseTilesetFromLabel(match.mapLabel), mapName: match.mapLabel, won: match.won, round: 1 }];
      }

      if (!rounds) continue;

      for (let i = 0; i < rounds.length; i++) {
        const item = rounds[i];
        let mapLabel = 'Unknown Map';
        let tileset = 'Unknown';
        let mapName = 'Unknown Map';
        let won = match.won;
        let roundNum = i + 1;

        if (typeof item === 'string') {
          mapLabel = item;
          tileset = parseTilesetFromLabel(item);
          mapName = item.replace(/^\[[^\]]+\]\s*/, '');
        } else if (item && typeof item === 'object') {
          mapLabel = item.mapLabel ?? 'Unknown Map';
          tileset = item.tileset && item.tileset !== 'Unknown' ? item.tileset.replace(/_Day$/i, '') : parseTilesetFromLabel(mapLabel);
          mapName = item.mapName ?? mapLabel.replace(/^\[[^\]]+\]\s*/, '');
          won = item.won ?? match.won;
          roundNum = item.round ?? (i + 1);
        }

        const cleanTileset = tileset.replace(/_Day$/i, '');
        const cleanMapName = mapName.replace(/^\[[^\]]+\]\s*/, '').replace(/_Day$/i, '');

        const entry = {
          matchId: match.matchId,
          timestamp: match.timestamp,
          round: roundNum,
          mapLabel,
          mapName: cleanMapName,
          tileset: cleanTileset,
          matchup,
          won,
        };

        everyMap.push(entry);

        const existingT = byTileset.get(cleanTileset) ?? {
          tileset: cleanTileset,
          rounds: 0,
          wins: 0,
          losses: 0,
        };
        existingT.rounds += 1;
        if (won) existingT.wins += 1;
        else existingT.losses += 1;
        byTileset.set(cleanTileset, existingT);

        const existingM = byMapName.get(cleanMapName) ?? {
          mapName: cleanMapName,
          tileset: cleanTileset,
          timesPlayed: 0,
          wins: 0,
          losses: 0,
          note: mapNotes[cleanMapName] || '',
          tags: mapTags[cleanMapName] || [],
          history: [],
        };
        existingM.timesPlayed += 1;
        if (won) existingM.wins += 1;
        else existingM.losses += 1;
        existingM.history.push(entry);
        byMapName.set(cleanMapName, existingM);
      }
    }

    const tilesetSummary = [...byTileset.values()]
      .map((t) => ({
        ...t,
        winRate: t.rounds > 0 ? Math.round((t.wins / t.rounds) * 100) : 0,
      }))
      .sort((a, b) => b.rounds - a.rounds);

    const mapSummary = [...byMapName.values()]
      .map((m) => ({
        ...m,
        winRate: m.timesPlayed > 0 ? Math.round((m.wins / m.timesPlayed) * 100) : 0,
      }))
      .sort((a, b) => b.timesPlayed - a.timesPlayed || b.wins - a.wins);

    return {
      everyMap: [...everyMap].reverse(), // most recent round maps first
      mapSummary,
      tilesetSummary,
    };
  }

  /**
   * Export all match history as CSV text.
   *
   * WeaponBreakdown column format: a single quoted field containing
   * "label:hits/kills" pairs separated by ";" (e.g. "AP-25:12/3;BLK-TAR:5/1"),
   * covering only weapons the local player actually fired that match
   * (hits > 0 or kills > 0) — matches match.weaponBreakdown, the same data
   * the match-detail view's weapons tab reads.
   */
  exportCsv() {
    const header = 'MatchID,Timestamp,Result,MyScore,OppScore,Team0Name,Team1Name,Map,Kills,Deaths,Assists,WeaponBreakdown,Inferred\n';
    const rows = this.data.matches.map((m) => {
      const date = new Date(m.timestamp).toISOString();
      const res = m.won ? 'WIN' : 'LOSS';
      const map = csvField(m.mapLabel ?? '');
      const team0 = csvField(m.team0Name ?? 'Blue Team');
      const team1 = csvField(m.team1Name ?? 'Orange Team');
      const weapons = (m.weaponBreakdown ?? [])
        .filter((w) => w.hits > 0 || w.kills > 0)
        .map((w) => `${w.label}:${w.hits}/${w.kills}`)
        .join(';');
      return `${m.matchId},${date},${res},${m.myScore},${m.oppScore},${team0},${team1},${map},${m.kills},${m.deaths},${m.assists},${csvField(weapons)},${m.inferred ? 'TRUE' : 'FALSE'}`;
    });
    return header + rows.join('\n');
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function csvField(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// The one place the DPL-style rating formula is computed — used by both
// getPlayedWithStats() (rating for every OTHER player seen in a match) and
// getLifetimeStats() (the local player's own rating, fed their own summed
// kills/deaths/assists/damage/roundsCounted/kastRounds/winRate). Same formula
// either way, so the two numbers stay directly comparable on the same scale.
//
// Super C Formula with KDA & KAST Buff + Win Rate Multiplier:
// 1. Base Combat: 25% KDA, 25% KAST, 20% KPR, 20% ADR, 10% Survival
// 2. Win Impact Multiplier: 0.65 + 0.70 * (WinRate / 100) (range 0.65x - 1.35x)
function computeDplRating({ kills, deaths, assists = 0, damage, roundsCounted, kastRounds, winRate = 50 }) {
  if (roundsCounted <= 0) return 1.0;
  const kpr = kills / roundsCounted;
  const adr = damage / roundsCounted;
  const srv = Math.max(0, (roundsCounted - deaths) / roundsCounted);
  const kastPct = Math.round((kastRounds / roundsCounted) * 100);

  const kda = (kills + assists) / Math.max(1, deaths);
  const kdaFactor = kda / 1.5; // 1.5 KDA = 1.0 baseline
  const kastFactor = kastPct / 70; // 70% KAST = 1.0 baseline

  const baseCombat = 0.25 * kdaFactor + 0.25 * kastFactor + 0.20 * kpr + 0.20 * (adr / 100) + 0.10 * srv;
  const winImpact = 0.65 + 0.70 * (winRate / 100);

  return Math.round(baseCombat * winImpact * 100) / 100;
}

module.exports = { MatchArchive };
