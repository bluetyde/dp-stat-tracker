'use strict';
// Lifetime stats store for the local player.
//
// Plain JSON file on disk via plain Node `fs` — no Electron APIs. The host
// app (this Electron app today, potentially an Overwolf overlay later)
// just needs to hand it a file path; everything else is portable.
//
// Written to once per COMPLETED match (on matchEnded), not per round, so a
// match that's still in progress never partially double-counts. recordMatch()
// saves to disk synchronously and immediately — never batched, never
// deferred to shutdown — because this store is the ONLY durable record: Due
// Process keeps just two sessions of raw log on disk (Player.log and
// Player-prev.log), rotating one out permanently on every game launch. A
// completed match that wasn't scanned into this store before its log data
// aged out past Player-prev.log cannot be recovered from anywhere. See
// rescan.js for the startup catch-up scan that reads both files before live
// tailing resumes, to minimize that window.

const fs = require('node:fs');
const path = require('node:path');

const MAX_HISTORY = 300;

function emptyData() {
  return {
    version: 1,
    localAccountId: null,
    totals: { kills: 0, deaths: 0, assists: 0, wins: 0, losses: 0, matchesRecorded: 0 },
    recordedMatchIds: [],
    history: [], // most-recent-last; see recordMatch() for shape
  };
}

class LifetimeStatsStore {
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
    // Write-then-rename so a crash mid-write can't corrupt the store.
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
    return this.data.recordedMatchIds.includes(matchId);
  }

  /**
   * Record one completed match. `entry` shape:
   *   { matchId, timestamp, won, myScore, oppScore, mapLabel, roundMaps,
   *     kills, deaths, assists, weaponBreakdown, inferred }
   * `kills`/`deaths`/`assists` and `weaponBreakdown` should come straight
   * from stats.js's computeMatchStats() row for the local player — not
   * recomputed here.
   *
   * `inferred` (boolean): true if this match never had a real matchEnded
   * event — recorded instead from its last known round score once the game
   * process exited (see rescan.js/main.js). Stored explicitly, not left for
   * the UI to infer, so a consumer of this file can't mistake it for a
   * confirmed completion — same principle as stats.js's weaponNames
   * placeholders and ADR-formula flag.
   */
  recordMatch(entry) {
    if (this.hasRecordedMatch(entry.matchId)) return;

    const t = this.data.totals;
    t.kills += entry.kills;
    t.deaths += entry.deaths;
    t.assists += entry.assists;
    if (entry.won) t.wins += 1;
    else t.losses += 1;
    t.matchesRecorded += 1;

    this.data.recordedMatchIds.push(entry.matchId);
    this.data.history.push(entry);
    if (this.data.history.length > MAX_HISTORY) {
      this.data.history.splice(0, this.data.history.length - MAX_HISTORY);
    }

    this._save();
  }

  /** Career totals + derived rates for the Hub's stat tiles. */
  getLifetimeStats() {
    const t = this.data.totals;
    const kdr = t.deaths > 0 ? t.kills / t.deaths : t.kills;
    const totalMatches = t.wins + t.losses;
    const winRate = totalMatches > 0 ? (t.wins / totalMatches) * 100 : 0;
    const killsPerMatch = t.matchesRecorded > 0 ? t.kills / t.matchesRecorded : 0;
    const { bestWinStreak, worstLossStreak } = this._streaks();
    return {
      totalKills: t.kills,
      totalDeaths: t.deaths,
      totalAssists: t.assists,
      kdr: round2(kdr),
      wins: t.wins,
      losses: t.losses,
      winRate: Math.round(winRate),
      matchesRecorded: t.matchesRecorded,
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
    for (const m of this.data.history) {
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

  /** Most recent matches first, for the Hub's Recent Matches list. */
  getRecentMatches(limit = 8) {
    return [...this.data.history].reverse().slice(0, limit);
  }

  /** Lifetime kills/damage aggregated by weapon, most kills first. */
  getTopWeapons(limit = 4) {
    const byCode = new Map();
    for (const match of this.data.history) {
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
    return this.data.history.slice(-limit).map((m) => m.kills);
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { LifetimeStatsStore };
