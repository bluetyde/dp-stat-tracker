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
   */
  recordMatch(entry) {
    if (this.hasRecordedMatch(entry.matchId)) return;

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
    for (const m of this.data.matches) {
      kills += m.kills;
      deaths += m.deaths;
      assists += m.assists;
      if (m.won) wins += 1;
      else losses += 1;
    }
    const matchesRecorded = this.data.matches.length;
    const kdr = deaths > 0 ? kills / deaths : kills;
    const totalDecided = wins + losses;
    const winRate = totalDecided > 0 ? (wins / totalDecided) * 100 : 0;
    const killsPerMatch = matchesRecorded > 0 ? kills / matchesRecorded : 0;
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
   * Deliberately trimmed (no `teams`/`roundMaps`/`weaponBreakdown`) — the
   * list payload goes out over IPC on every hub update, and full scoreboards
   * for every row would be wasted bandwidth. Click-through fetches the full
   * record on demand via getMatch().
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
        mapLabel: m.mapLabel,
        kills: m.kills,
        deaths: m.deaths,
        assists: m.assists,
        inferred: m.inferred,
      }));
  }

  /** Lifetime kills/damage aggregated by weapon, most kills first (local player's weapons only). */
  getTopWeapons(limit = 4) {
    const byCode = new Map();
    for (const match of this.data.matches) {
      for (const w of match.weaponBreakdown ?? []) {
        const existing = byCode.get(w.damageSource) ?? { damageSource: w.damageSource, label: w.label, kills: 0, damage: 0 };
        existing.kills += w.kills;
        existing.damage += w.damage;
        byCode.set(w.damageSource, existing);
      }
    }
    return [...byCode.values()].sort((a, b) => b.kills - a.kills).slice(0, limit);
  }

  /** Kills for the last `limit` matches, oldest first (for a trend sparkline). */
  getRecentKillsTrend(limit = 12) {
    return this.data.matches.slice(-limit).map((m) => m.kills);
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { MatchArchive };
