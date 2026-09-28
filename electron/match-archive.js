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
  0: { label: 'Dawn', category: 'LMG', fireType: 'Auto', baseDamage: 25, rpm: 460, wikiUrl: 'https://dueprocess.fandom.com/wiki/Dawn', imageUrl: 'assets/weapons/dawn.png' },
  1: { label: 'AP-25', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 20, rpm: 600, wikiUrl: 'https://dueprocess.fandom.com/wiki/AP-25', imageUrl: 'assets/weapons/ap-25.png' },
  2: { label: 'BLK-TAR', category: 'Battle Rifle', fireType: 'Semi', baseDamage: 30, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/BLK-TAR', imageUrl: 'assets/weapons/blk-tar.png' },
  3: { label: 'GAT-9', category: 'Handgun', fireType: 'Semi', baseDamage: 20, rpm: 420, wikiUrl: 'https://dueprocess.fandom.com/wiki/Gat-9', imageUrl: 'assets/weapons/gat-9.png' },
  4: { label: 'Gruber-5', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 22, rpm: 720, wikiUrl: 'https://dueprocess.fandom.com/wiki/Gruber-5', imageUrl: 'assets/weapons/gruber-5.png' },
  5: { label: 'PK-57', category: 'Handgun', fireType: 'Semi', baseDamage: 20, rpm: 410, wikiUrl: 'https://dueprocess.fandom.com/wiki/PK-57', imageUrl: 'assets/weapons/pk-57.png' },
  6: { label: 'SAB-R', category: 'Sniper Rifle', fireType: 'Semi', baseDamage: 50, rpm: 240, wikiUrl: 'https://dueprocess.fandom.com/wiki/SAB-R', imageUrl: 'assets/weapons/sab-r.png' },
  7: { label: 'DL-12', category: 'Shotgun', fireType: 'Pump', baseDamage: 20, rpm: 60, wikiUrl: 'https://dueprocess.fandom.com/wiki/DL-12', imageUrl: 'assets/weapons/dl-12.png' },
  8: { label: 'KR82M', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 30, rpm: 540, wikiUrl: 'https://dueprocess.fandom.com/wiki/KR82M', imageUrl: 'assets/weapons/kr82m.png' },
  9: { label: 'LS-45', category: 'Handgun', fireType: 'Semi', baseDamage: 30, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/LS45', imageUrl: 'assets/weapons/ls-45.png' },
  10: { label: 'Nack-11', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 18, rpm: 1080, wikiUrl: 'https://dueprocess.fandom.com/wiki/Nack-11', imageUrl: 'assets/weapons/nack-11.png' },
  11: { label: 'MAWP', category: 'Sniper Rifle', fireType: 'Single', baseDamage: 85, rpm: 23, wikiUrl: 'https://dueprocess.fandom.com/wiki/MAWP', imageUrl: 'assets/weapons/mawp.png' },
  12: { label: 'Ingmar-57', category: 'Battle Rifle', fireType: 'Auto', baseDamage: 37, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/INGMAR-57', imageUrl: 'assets/weapons/ingmar-57.png' },
  13: { label: 'Legros', category: 'Battle Rifle', fireType: 'Semi', baseDamage: 40, rpm: 260, wikiUrl: 'https://dueprocess.fandom.com/wiki/F1-Legros', imageUrl: 'assets/weapons/legros.png' },
  14: { label: 'TUB-12', category: 'Shotgun', fireType: 'Pump', baseDamage: 20, rpm: 60, wikiUrl: 'https://dueprocess.fandom.com/wiki/TUB-12', imageUrl: 'assets/weapons/tub-12.png' },
  15: { label: 'Auto Shotgun', category: 'Shotgun', fireType: 'Auto', baseDamage: 20, rpm: 240, wikiUrl: 'https://dueprocess.fandom.com/wiki/Auto_Shotgun', imageUrl: 'assets/weapons/auto-shotgun.png' },
  16: { label: 'Short Shotgun', category: 'Shotgun', fireType: 'Unknown', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: 'assets/weapons/short-shotgun.png' },
  17: { label: 'KR82U', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 30, rpm: 540, wikiUrl: 'https://dueprocess.fandom.com/wiki/KR82U', imageUrl: 'assets/weapons/kr82u.png' },
  // Same baseDamage/rpm as Gruber-5 (4), kept in sync with stats.js's
  // weaponMeta — see that file's comment for how this was identified from
  // log evidence (a suppressor doesn't change damage, only sound/recoil).
  19: { label: 'Gruber-SD', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 22, rpm: 720, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: 'assets/weapons/gruber-sd.png' },
  50: { label: 'Grenade', category: 'Throwable', fireType: 'Throwable', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: 'assets/weapons/frag.png' },
  51: { label: 'Molotov Cocktail', category: 'Throwable', fireType: 'Throwable', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: 'assets/weapons/molotov.png' },
  150: { label: 'Door Charge', category: 'Equipment', fireType: 'Breach Charge', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Door_Charge', imageUrl: 'assets/weapons/doorcharge.png' },
  151: { label: 'Wall Charge', category: 'Equipment', fireType: 'Breach Charge', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Wall_Charge', imageUrl: 'assets/weapons/wallcharge.png' },
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
      const data = { ...emptyData(), ...parsed };
      this._ensureRowFields(data);
      return data;
    } catch {
      return emptyData();
    }
  }

  _ensureRowFields(data) {
    if (!data.matches || !Array.isArray(data.matches)) return;
    for (const m of data.matches) {
      if (!m.teams) continue;
      for (const side of [0, 1]) {
        for (const r of m.teams[side] || []) {
          if (r.teamDamage === undefined) r.teamDamage = 0;
          if (Array.isArray(r.weaponBreakdown)) {
            r.weaponBreakdown.sort((a, b) => (b.healthPercentScore ?? 0) - (a.healthPercentScore ?? 0) || b.damage - a.damage || b.kills - a.kills);
            const fired = r.weaponBreakdown.filter((w) => w.hits > 0);
            r.bestWeapon = fired[0] ?? null;
          }
          if (r.hsPercent === undefined) {
            const breakdown = r.weaponBreakdown ?? [];
            const totalHits = breakdown.reduce((sum, w) => sum + (w.hits ?? 0), 0);
            const totalHs = breakdown.reduce((sum, w) => sum + (w.headshots ?? 0), 0);
            r.hsPercent = totalHits > 0 ? Math.round((totalHs / totalHits) * 100) : null;
          }
        }
      }
      if (!Array.isArray(m.tags)) {
        const is2v2 = m.is2v2 || (typeof m.mapLabel === 'string' && /(?:^|\W)2v2(?:$|\W)/i.test(m.mapLabel));
        if (is2v2) {
          m.tags = ['2v2'];
        } else if (this.filePath && this.filePath.includes('other')) {
          m.tags = ['Casual'];
        } else {
          m.tags = ['Ranked'];
        }
      }
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
    if (!m._schemaVersion || m._schemaVersion < 12) return true;
    const rounds = m.mapRounds || m.roundMaps;
    if (!rounds || !Array.isArray(rounds) || rounds.length < (m.roundCount ?? 1) || typeof rounds[0] === 'string' || !m.team0Name) return true;
    if (rounds.some((r) => r && typeof r === 'object' && r.kills === undefined)) return true;
    if (rounds.some((r) => r && typeof r === 'object' && Array.isArray(r.kills) && r.kills.length > 0 && r.kills[0].seconds === 0 && r.kills[0].tick > 1000)) return true;
    if (m.isSpectator) return false;
    if (m.roundCount && m.finalScore && m.roundCount < ((m.finalScore.side0 ?? 0) + (m.finalScore.side1 ?? 0))) return true;
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
  recordMatch(entry, { force = false } = {}) {
    const existingIndex = this.data.matches.findIndex((m) => m.matchId === entry.matchId);
    if (existingIndex !== -1) {
      const existing = this.data.matches[existingIndex];
      const shouldUpdate =
        force ||
        this.isLegacyMatch(entry.matchId) ||
        (existing.inferred && !entry.inferred) ||
        ((entry.roundCount ?? 0) > (existing.roundCount ?? 0));
      if (shouldUpdate) {
        this.data.matches[existingIndex] = { ...entry, _schemaVersion: 12 };
        this._save();
      }
      return;
    }

    this.data.matches.push({ ...entry, _schemaVersion: 12 });
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

  /**
   * Update one match record in-place by MatchId (e.g. tags or mode override).
   */
  updateMatch(matchId, patch) {
    const match = this.data.matches.find((m) => m.matchId === matchId);
    if (!match) return false;
    Object.assign(match, patch);
    this._save();
    return true;
  }

  /**
   * Move one match record to another MatchArchive instance (e.g. between
   * rankedArchive and otherArchive) and apply optional field patches.
   */
  transferMatchTo(matchId, targetArchive, patch = {}) {
    const index = this.data.matches.findIndex((m) => m.matchId === matchId);
    if (index === -1) return false;
    const [match] = this.data.matches.splice(index, 1);
    Object.assign(match, patch);
    targetArchive.data.matches.push(match);
    targetArchive.data.matches.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    if (!targetArchive.data.localAccountId && match.localAccountId) {
      targetArchive.data.localAccountId = match.localAccountId;
    }
    this._save();
    targetArchive._save();
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
    let matchesRecorded = 0;
    for (const m of this.data.matches) {
      if (m.isSpectator) continue;
      matchesRecorded += 1;
      kills += m.kills;
      deaths += m.deaths;
      assists += m.assists;
      // A tie (6-6 ranked, see isRankedFinalScore) is neither a win nor a
      // loss — excluded from both tallies entirely, not counted as a loss,
      // so it doesn't silently drag down winRate (and therefore dplRating).
      // Fallback for records predating the `tied` field: derive it from the
      // scores that have always been stored.
      const tied = m.tied ?? m.myScore === m.oppScore;
      if (!tied) {
        if (m.won) wins += 1;
        else losses += 1;
      }

      const myRow = m.teams?.[0]?.find((r) => r.accountId === m.localAccountId) ?? m.teams?.[1]?.find((r) => r.accountId === m.localAccountId);
      if (myRow) {
        damage += myRow.damage ?? 0;
        roundsCounted += myRow.kast?.roundsCounted ?? 0;
        kastRounds += myRow.kast?.kastRounds ?? 0;
      }
    }
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
      if (m.isSpectator) continue;
      const tied = m.tied ?? m.myScore === m.oppScore;
      if (tied) {
        // Breaks whatever streak was active without itself extending
        // either — a tie isn't a win, but it isn't a loss either.
        curWin = 0;
        curLoss = 0;
        continue;
      }
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
      .map((m) => {
        const is2v2 = m.is2v2 !== undefined
          ? Boolean(m.is2v2)
          : Boolean(typeof m.mapLabel === 'string' && /(?:^|\W)2v2(?:$|\W)/i.test(m.mapLabel));
        const isSpectator = Boolean(m.isSpectator);
        return {
          matchId: m.matchId,
          timestamp: m.timestamp,
          won: m.won,
          tied: m.tied ?? m.myScore === m.oppScore,
          is2v2,
          isSpectator,
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
          tags: Array.isArray(m.tags) ? m.tags : (isSpectator ? ['Spectated'] : (is2v2 ? ['2v2'] : (this.filePath && this.filePath.includes('other') ? ['Casual'] : ['Ranked']))),
          modeOverride: m.modeOverride ?? null,
        };
      });
  }

  /**
   * Lifetime per-weapon stats for the Hub's Weapons tab — kills, deaths
   * ("died by"), headshots/HS%, and kills-per-round-used — summed across
   * every archived match's local-player weaponBreakdown.
   */
  getWeaponStats() {
    const byCode = new Map();
    for (const match of this.data.matches) {
      if (match.isSpectator) continue;
      for (const w of match.weaponBreakdown ?? []) {
        const meta = WEAPON_META[w.damageSource] ?? { label: w.label, category: w.category ?? 'Other', fireType: w.fireType ?? 'Unknown', baseDamage: w.baseDamage ?? null, rpm: w.rpm ?? null };
        const label = meta.label ?? w.label;
        const existing = byCode.get(w.damageSource) ?? {
          damageSource: w.damageSource,
          label: label === 'Big AK' ? 'KR82M' : label === 'Mini AK' ? 'KR82U' : label,
          category: meta.category ?? (w.category === 'Explosive' ? 'Throwable' : w.category),
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

    // Populate all known weapons from WEAPON_META so unused weapons are included
    if (this.data.matches.length > 0) {
      for (const [codeStr, meta] of Object.entries(WEAPON_META)) {
        const code = Number(codeStr);
        if (!byCode.has(code)) {
          byCode.set(code, {
            damageSource: code,
            label: meta.label,
            category: meta.category,
            fireType: meta.fireType,
            baseDamage: meta.baseDamage,
            rpm: meta.rpm,
            wikiUrl: meta.wikiUrl ?? `https://dueprocess.fandom.com/wiki/${encodeURIComponent(meta.label)}`,
            imageUrl: meta.imageUrl ?? null,
            kills: 0,
            deaths: 0,
            hits: 0,
            headshots: null,
            roundsUsed: 0,
            unused: true,
          });
        }
      }
    }

    return [...byCode.values()]
      .map((w) => {
        const unused = Boolean(w.unused || ((w.roundsUsed || 0) === 0 && (w.hits || 0) === 0 && (w.kills || 0) === 0));
        return {
          ...w,
          unused,
          hsPercent: !unused && w.headshots !== null && w.hits > 0 ? Math.round((w.headshots / w.hits) * 100) : null,
          killsPerRound: !unused && w.roundsUsed > 0 ? round2(w.kills / w.roundsUsed) : 0,
        };
      })
      .sort((a, b) => {
        if (a.unused !== b.unused) return a.unused ? 1 : -1;
        if (a.unused) return a.label.localeCompare(b.label);
        return b.kills - a.kills;
      });
  }

  /** Lifetime kills/damage aggregated by weapon, most kills first (local player's weapons only). */
  getTopWeapons(limit = 4) {
    const byCode = new Map();
    for (const match of this.data.matches) {
      if (match.isSpectator) continue;
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
    return this.data.matches.filter((m) => !m.isSpectator).slice(-limit).map((m) => m.kills);
  }

  /**
   * Aggregates player performance for all players seen across archived matches
   * keyed by stable `accountId`.
   */
  getPlayedWithStats() {
    const localId = this.data.localAccountId;
    const byAccount = new Map();

    for (const match of this.data.matches) {
      if (match.isSpectator || !match.teams) continue;

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

          // A tie is excluded from these win-rate counters entirely (not
          // counted as a loss for either side) — same reasoning as
          // getLifetimeStats' wins/losses tally, so a teammate's/rival's
          // DPL rating below isn't dragged down by a match nobody lost.
          const tied = match.tied ?? match.myScore === match.oppScore;
          if (!tied) {
            if (isMyTeam) {
              existing.matchesTogether += 1;
              if (match.won) existing.winsTogether += 1;
              else existing.lossesTogether += 1;
            } else {
              existing.matchesAgainst += 1;
              if (match.won) existing.winsAgainst += 1; // local player won against them
              else existing.lossesAgainst += 1;
            }
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

  /**
   * Comprehensive historical profile for a single player by accountId.
   * Aggregates combat metrics, attack vs defense splits, opening duels,
   * weapon breakdown, and mutual match history.
   */
  getFullPlayerProfile(accountId, { isRanked = true } = {}) {
    const localId = this.data.localAccountId;
    const isSelf = !!localId && accountId === localId;
    let latestName = null;
    let totalMatches = 0;
    let matchesTogether = 0;
    let winsTogether = 0;
    let lossesTogether = 0;
    let matchesAgainst = 0;
    let winsAgainst = 0;
    let lossesAgainst = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalTies = 0;

    let kills = 0;
    let deaths = 0;
    let assists = 0;
    let damage = 0;
    let roundsCounted = 0;
    let kastRounds = 0;
    let teamDamage = 0;

    let attackDamage = 0;
    let attackRounds = 0;
    let defenseDamage = 0;
    let defenseRounds = 0;

    let duelsWon = 0;
    let duelsInvolved = 0;

    let totalHits = 0;
    let totalHeadshots = 0;

    const weaponMap = new Map();
    const matchHistory = [];

    const checkIs2v2 = (m) => {
      if (!m) return false;
      return m.is2v2 !== undefined
        ? Boolean(m.is2v2)
        : Boolean(typeof m.mapLabel === 'string' && /(?:^|\W)2v2(?:$|\W)/i.test(m.mapLabel));
    };

    for (const match of this.data.matches) {
      if (match.isSpectator && isSelf) continue;
      if (!match.teams) continue;

      let playerRow = null;
      let playerSide = null;
      for (const side of [0, 1]) {
        const found = (match.teams[side] || []).find((r) => r.accountId === accountId);
        if (found) {
          playerRow = found;
          playerSide = side;
          break;
        }
      }

      if (!playerRow) continue;

      totalMatches += 1;
      if (playerRow.name) latestName = playerRow.name;

      let mySide = null;
      if (localId) {
        if (match.teams[0]?.some((r) => r.accountId === localId)) mySide = 0;
        else if (match.teams[1]?.some((r) => r.accountId === localId)) mySide = 1;
      }

      const isTeammate = mySide !== null && playerSide === mySide;
      const isOpponent = mySide !== null && playerSide !== mySide;

      const tied = match.tied ?? match.myScore === match.oppScore;
      if (tied) {
        totalTies += 1;
      } else {
        if (isSelf) {
          if (match.won) totalWins += 1;
          else totalLosses += 1;
        } else if (isTeammate) {
          matchesTogether += 1;
          if (match.won) winsTogether += 1;
          else lossesTogether += 1;
        } else if (isOpponent) {
          matchesAgainst += 1;
          if (match.won) winsAgainst += 1;
          else lossesAgainst += 1;
        }
      }

      kills += playerRow.kills ?? 0;
      deaths += playerRow.deaths ?? 0;
      assists += playerRow.assists ?? 0;
      damage += playerRow.damage ?? 0;
      teamDamage += playerRow.teamDamage ?? 0;

      const matchRounds = playerRow.kast?.roundsCounted ?? match.roundCount ?? 0;
      roundsCounted += matchRounds;
      kastRounds += playerRow.kast?.kastRounds ?? 0;

      if (playerRow.adr) {
        const atkDmg = playerRow.adr.attackDamageRaw !== undefined
          ? playerRow.adr.attackDamageRaw
          : (playerRow.adr.attack ?? 0) * (playerRow.adr.attackRounds ?? 0);
        attackDamage += atkDmg;
        attackRounds += playerRow.adr.attackRounds ?? 0;

        const defDmg = playerRow.adr.defenseDamageRaw !== undefined
          ? playerRow.adr.defenseDamageRaw
          : (playerRow.adr.defense ?? 0) * (playerRow.adr.defenseRounds ?? 0);
        defenseDamage += defDmg;
        defenseRounds += playerRow.adr.defenseRounds ?? 0;
      }

      if (playerRow.openingDuels) {
        duelsWon += playerRow.openingDuels.won ?? 0;
        duelsInvolved += playerRow.openingDuels.involved ?? 0;
      }

      if (Array.isArray(playerRow.weaponBreakdown)) {
        for (const w of playerRow.weaponBreakdown) {
          totalHits += w.hits ?? 0;
          totalHeadshots += w.headshots ?? 0;

          const key = w.damageSource ?? w.label;
          const cur = weaponMap.get(key) ?? {
            damageSource: w.damageSource,
            label: (w.damageSource !== undefined && WEAPON_META[w.damageSource]?.label) ? WEAPON_META[w.damageSource].label : (w.label || `Weapon #${w.damageSource}`),
            category: (w.damageSource !== undefined && WEAPON_META[w.damageSource]?.category) ? WEAPON_META[w.damageSource].category : (w.category || 'Unknown'),
            fireType: (w.damageSource !== undefined && WEAPON_META[w.damageSource]?.fireType) ? WEAPON_META[w.damageSource].fireType : (w.fireType || 'Auto'),
            kills: 0,
            deaths: 0,
            hits: 0,
            headshots: 0,
            damage: 0,
            roundsUsed: 0,
          };
          cur.kills += w.kills ?? 0;
          cur.deaths += w.deaths ?? 0;
          cur.hits += w.hits ?? 0;
          cur.headshots += w.headshots ?? 0;
          cur.damage += w.damage ?? 0;
          cur.roundsUsed += w.roundsUsed ?? 0;
          weaponMap.set(key, cur);
        }
      }

      const team0 = match.team0Name || 'Blue Team';
      const team1 = match.team1Name || 'Orange Team';
      const matchup = `${team0} vs ${team1}`;

      let playerWon = false;
      let playerTied = tied;
      if (mySide !== null) {
        if (isTeammate || isSelf) {
          playerWon = !!match.won;
        } else if (isOpponent) {
          playerWon = !match.won && !tied;
        }
      } else {
        const pScore = playerSide === 0 ? match.team0Score ?? match.myScore : match.team1Score ?? match.oppScore;
        const oScore = playerSide === 0 ? match.team1Score ?? match.oppScore : match.team0Score ?? match.myScore;
        playerWon = pScore > oScore;
        playerTied = pScore === oScore;
      }

      matchHistory.push({
        matchId: match.matchId,
        timestamp: match.timestamp,
        matchup,
        mapLabel: match.mapLabel || 'Unknown Map',
        isRanked,
        is2v2: checkIs2v2(match),
        won: match.won,
        tied: playerTied,
        playerWon,
        myScore: match.myScore,
        oppScore: match.oppScore,
        isTeammate,
        isOpponent,
        isSelf,
        kills: playerRow.kills ?? 0,
        deaths: playerRow.deaths ?? 0,
        assists: playerRow.assists ?? 0,
        damage: playerRow.damage ?? 0,
        hsPercent: playerRow.hsPercent ?? null,
        dplRating: playerRow.dplRating ?? 1.0,
      });
    }

    if (totalMatches === 0) return null;

    matchHistory.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    const winRateTogether = matchesTogether > 0 ? Math.round((winsTogether / matchesTogether) * 100) : 0;
    const winRateAgainst = matchesAgainst > 0 ? Math.round((winsAgainst / matchesAgainst) * 100) : 0;
    const kdr = deaths > 0 ? kills / deaths : kills;
    const adr = roundsCounted > 0 ? damage / roundsCounted : 0;
    const kastPct = roundsCounted > 0 ? Math.round((kastRounds / roundsCounted) * 100) : 0;

    const playerWins = isSelf ? totalWins : (winsTogether + lossesAgainst);
    const relevantMatches = isSelf ? (totalWins + totalLosses) : (matchesTogether + matchesAgainst);
    const overallWinRate = relevantMatches > 0 ? (playerWins / relevantMatches) * 100 : 50;

    const dplRating = computeDplRating({
      kills,
      deaths,
      assists,
      damage,
      roundsCounted,
      kastRounds,
      winRate: overallWinRate,
    });

    const attackAdr = attackRounds > 0 ? Math.round(attackDamage / attackRounds) : 0;
    const defenseAdr = defenseRounds > 0 ? Math.round(defenseDamage / defenseRounds) : 0;

    const openingDuelRate = duelsInvolved > 0 ? Math.round((duelsWon / duelsInvolved) * 100) : 0;
    const hsPercent = totalHits > 0 ? Math.round((totalHeadshots / totalHits) * 100) : 0;

    const weapons = [...weaponMap.values()]
      .map((w) => ({
        ...w,
        hsPercent: w.hits > 0 ? Math.round((w.headshots / w.hits) * 100) : 0,
        kpr: w.roundsUsed > 0 ? round2(w.kills / w.roundsUsed) : round2(w.kills),
      }))
      .sort((a, b) => b.kills - a.kills || b.damage - a.damage);

    return {
      accountId,
      name: latestName || `Player #${accountId.slice(-4)}`,
      isSelf,
      totalMatches,
      matchesTogether,
      winsTogether,
      lossesTogether,
      winRateTogether,
      matchesAgainst,
      winsAgainst,
      lossesAgainst,
      winRateAgainst,
      totalWins,
      totalLosses,
      totalTies,
      overallWinRate: Math.round(overallWinRate),
      kills,
      deaths,
      assists,
      kdr: round2(kdr),
      damage,
      adr: Math.round(adr),
      roundsCounted,
      kast: kastPct,
      dplRating,
      teamDamage,
      attackAdr,
      attackDamage,
      attackRounds,
      defenseAdr,
      defenseDamage,
      defenseRounds,
      openingDuels: {
        won: duelsWon,
        involved: duelsInvolved,
        winRate: openingDuelRate,
      },
      headshots: {
        hits: totalHits,
        headshots: totalHeadshots,
        hsPercent,
      },
      weapons,
      matchHistory,
    };
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
      if (match.isSpectator) continue;
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

        // Real per-round role, recorded by rescan.js from the round's own
        // attackerSide/victimSide data (see stats.js's roundRoleByRosterSide).
        // Not derivable here after the fact — round-count-per-half varies by
        // game mode (see rescan.js's isRankedFinalScore comment), so there's
        // no safe guess for matches recorded before this field existed.
        const sideRole = item && typeof item === 'object' ? item.sideRole ?? null : null;

        const entry = {
          matchId: match.matchId,
          timestamp: match.timestamp,
          round: roundNum,
          mapLabel,
          mapName: cleanMapName,
          tileset: cleanTileset,
          matchup,
          won,
          sideRole,
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
          attackRounds: 0,
          attackWins: 0,
          defenseRounds: 0,
          defenseWins: 0,
          note: mapNotes[cleanMapName] || '',
          tags: mapTags[cleanMapName] || [],
          history: [],
        };
        existingM.timesPlayed += 1;
        if (won) existingM.wins += 1;
        else existingM.losses += 1;

        // Map-agnostic: every round with a known role tells you about BOTH
        // sides of the map, not just whichever one you happened to be on.
        // A round you defended and lost is exactly as much evidence about
        // how attacks fare on this map as a round you attacked and won —
        // the opponent's attack succeeded either way. Counting only your
        // own role's rounds understates attack/defense win rate on any map
        // you rarely played one particular side of, even though you have
        // plenty of indirect data about it from the other side's rounds.
        if (sideRole === 'ATTACK') {
          existingM.attackRounds += 1;
          existingM.defenseRounds += 1;
          if (won) existingM.attackWins += 1;
          else existingM.defenseWins += 1;
        } else if (sideRole === 'DEFENSE') {
          existingM.defenseRounds += 1;
          existingM.attackRounds += 1;
          if (won) existingM.defenseWins += 1;
          else existingM.attackWins += 1;
        }

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
        attackWinRate: m.attackRounds > 0 ? Math.round((m.attackWins / m.attackRounds) * 100) : 0,
        defenseWinRate: m.defenseRounds > 0 ? Math.round((m.defenseWins / m.defenseRounds) * 100) : 0,
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
      const tied = m.tied ?? m.myScore === m.oppScore;
      const res = m.isSpectator ? 'SPEC' : (tied ? 'TIE' : m.won ? 'WIN' : 'LOSS');
      const map = csvField(m.mapLabel ?? '');
      const team0 = csvField(m.team0Name ?? 'Blue Team');
      const team1 = csvField(m.team1Name ?? 'Orange Team');
      const weapons = (m.weaponBreakdown ?? [])
        .filter((w) => w.hits > 0 || w.kills > 0)
        .map((w) => `${w.label}:${w.hits}/${w.kills}`)
        .join(';');
      const kills = m.isSpectator ? '' : m.kills;
      const deaths = m.isSpectator ? '' : m.deaths;
      const assists = m.isSpectator ? '' : m.assists;
      return `${m.matchId},${date},${res},${m.myScore},${m.oppScore},${team0},${team1},${map},${kills},${deaths},${assists},${csvField(weapons)},${m.inferred ? 'TRUE' : 'FALSE'}`;
    });
    return header + rows.join('\n');
  }

  /**
   * Aggregate environmental hazard deaths caused by the Pit ("PIT ROASTED <player>")
   * across all matches in this archive.
   */
  getPitStats(localPlayerName) {
    let totalDeaths = 0;
    let selfDeaths = 0;
    const victimCounts = new Map();
    const claims = [];

    const localUpper = localPlayerName ? localPlayerName.toUpperCase() : null;
    const localId = this.getLocalAccountId();

    for (const match of this.data.matches) {
      if (!Array.isArray(match.mapRounds)) continue;
      const matchMapLabel = match.mapLabel || 'Unknown Map';
      match.mapRounds.forEach((mr, idx) => {
        if (!Array.isArray(mr.kills)) return;
        const roundNum = mr.round ?? mr.roundNumber ?? (idx + 1);
        for (const k of mr.kills) {
          const killerUpper = (k.killerName || '').toUpperCase();
          const weaponUpper = (k.weapon || '').toUpperCase();
          const isPit = Boolean(
            k.isPit ||
            killerUpper === 'PIT' ||
            killerUpper.includes('PIT') ||
            weaponUpper === 'ROASTED' ||
            weaponUpper === 'PIT'
          );
          if (!isPit) continue;

          totalDeaths += 1;
          const victim = k.victimName || 'Unknown';
          const victimUpper = victim.toUpperCase();
          const existing = victimCounts.get(victimUpper);
          if (existing) {
            existing.count += 1;
          } else {
            victimCounts.set(victimUpper, {
              name: victim,
              count: 1,
            });
          }

          let isSelf = localUpper ? (victimUpper === localUpper) : false;
          if (!isSelf && localId && Array.isArray(match.teams)) {
            const myRow = match.teams[0]?.find((r) => r.accountId === localId) ?? match.teams[1]?.find((r) => r.accountId === localId);
            if (myRow && myRow.name && myRow.name.toUpperCase() === victimUpper) {
              isSelf = true;
            }
          }
          if (isSelf) {
            selfDeaths += 1;
          }

          const seconds = typeof k.seconds === 'number' ? k.seconds : 0;
          const timeFormatted = k.timeFormatted || `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
          const is2v2 = match.is2v2 !== undefined
            ? Boolean(match.is2v2)
            : Boolean(typeof match.mapLabel === 'string' && /(?:^|\W)2v2(?:$|\W)/i.test(match.mapLabel));
          const isSpectator = Boolean(match.isSpectator);
          const mode = match.modeOverride || (isSpectator ? 'Spectator' : (is2v2 ? '2v2' : (this.filePath && this.filePath.includes('other') ? 'Casual' : 'Ranked')));

          claims.push({
            matchId: match.matchId,
            timestamp: match.timestamp,
            roundNumber: roundNum,
            victimName: victim,
            victimSide: k.victimSide,
            isSelf,
            timeFormatted,
            mapLabel: mr.mapLabel || matchMapLabel,
            mapName: mr.mapName || 'Unknown',
            tileset: mr.tileset || 'Unknown',
            mode,
          });
        }
      });
    }

    const victims = [...victimCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    claims.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return {
      totalDeaths,
      selfDeaths,
      otherDeaths: totalDeaths - selfDeaths,
      topVictim: victims[0] || null,
      victims,
      claims,
    };
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

function isRankedFinalScore(myScore, oppScore) {
  if (myScore === 6 && oppScore === 6) return true;
  if (myScore === 7 && oppScore <= 6) return true;
  if (oppScore === 7 && myScore <= 6) return true;
  return false;
}

function mergeWeaponBreakdowns(wb1 = [], wb2 = []) {
  const map = new Map();
  for (const w of wb1 || []) {
    const key = w.damageSource !== undefined ? w.damageSource : w.label;
    map.set(key, { ...w });
  }
  for (const w of wb2 || []) {
    const key = w.damageSource !== undefined ? w.damageSource : w.label;
    if (!map.has(key)) {
      map.set(key, { ...w });
    } else {
      const cur = map.get(key);
      cur.hits = (cur.hits || 0) + (w.hits || 0);
      cur.damage = (cur.damage || 0) + (w.damage || 0);
      cur.kills = (cur.kills || 0) + (w.kills || 0);
      cur.deaths = (cur.deaths || 0) + (w.deaths || 0);
      if (typeof w.headshots === 'number') cur.headshots = (cur.headshots || 0) + w.headshots;
      if (typeof w.roundsUsed === 'number') cur.roundsUsed = (cur.roundsUsed || 0) + w.roundsUsed;
      if (typeof w.healthPercentScore === 'number') cur.healthPercentScore = (cur.healthPercentScore || 0) + w.healthPercentScore;
    }
  }
  return [...map.values()];
}

function mergeTeams(teams1 = {}, teams2 = {}) {
  const mergedTeams = { 0: [], 1: [] };
  for (const side of [0, 1]) {
    const list1 = teams1[side] || [];
    const list2 = teams2[side] || [];
    const playerMap = new Map();
    const getPlayerKey = (p) => p.accountId || p.name || '';
    for (const p of list1) {
      const key = getPlayerKey(p);
      playerMap.set(key, { ...p, weaponBreakdown: [...(p.weaponBreakdown || [])] });
    }
    for (const p of list2) {
      const key = getPlayerKey(p);
      if (!playerMap.has(key)) {
        playerMap.set(key, { ...p, weaponBreakdown: [...(p.weaponBreakdown || [])] });
      } else {
        const existing = playerMap.get(key);
        existing.kills = (existing.kills || 0) + (p.kills || 0);
        existing.deaths = (existing.deaths || 0) + (p.deaths || 0);
        existing.assists = (existing.assists || 0) + (p.assists || 0);
        existing.damage = (existing.damage || 0) + (p.damage || 0);
        existing.attackDamage = (existing.attackDamage || 0) + (p.attackDamage || 0);
        existing.defenseDamage = (existing.defenseDamage || 0) + (p.defenseDamage || 0);
        existing.attackRounds = (existing.attackRounds || 0) + (p.attackRounds || 0);
        existing.defenseRounds = (existing.defenseRounds || 0) + (p.defenseRounds || 0);
        existing.roundsCounted = (existing.roundsCounted || 0) + (p.roundsCounted || 0);
        existing.kastRounds = (existing.kastRounds || 0) + (p.kastRounds || 0);
        existing.openingWon = (existing.openingWon || 0) + (p.openingWon || 0);
        existing.openingInvolved = (existing.openingInvolved || 0) + (p.openingInvolved || 0);
        existing.teamDamage = (existing.teamDamage || 0) + (p.teamDamage || 0);

        existing.adr = existing.roundsCounted > 0 ? Number((existing.damage / existing.roundsCounted).toFixed(1)) : 0;
        existing.kdr = existing.deaths > 0 ? Number((existing.kills / existing.deaths).toFixed(2)) : Number((existing.kills || 0).toFixed(2));
        existing.kast = existing.roundsCounted > 0 ? Number(((existing.kastRounds / existing.roundsCounted) * 100).toFixed(1)) : 0;
        existing.weaponBreakdown = mergeWeaponBreakdowns(existing.weaponBreakdown, p.weaponBreakdown);
      }
    }
    mergedTeams[side] = [...playerMap.values()];
  }
  return mergedTeams;
}

function mergeMapRounds(olderRounds = [], newerRounds = []) {
  if (!olderRounds.length) return newerRounds;
  if (!newerRounds.length) return olderRounds;

  const olderMax = Math.max(...olderRounds.map((r) => r.round || 0));
  const newerMin = Math.min(...newerRounds.map((r) => r.round || 0));

  let adjustedNewer = newerRounds;
  if (newerMin <= olderMax && olderRounds.length > 0) {
    const isSameFirstRound =
      newerRounds[0]?.mapLabel === olderRounds[0]?.mapLabel &&
      (newerRounds[0]?.kills?.length === olderRounds[0]?.kills?.length);
    if (!isSameFirstRound) {
      adjustedNewer = newerRounds.map((r, idx) => ({
        ...r,
        round: olderRounds.length + idx + 1,
      }));
    }
  }

  const byRound = new Map();
  for (const r of olderRounds) byRound.set(r.round, r);
  for (const r of adjustedNewer) {
    const existing = byRound.get(r.round);
    if (!existing || (Array.isArray(r.kills) && r.kills.length > (existing.kills?.length || 0)) || !existing.sideRole) {
      byRound.set(r.round, r);
    }
  }

  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

function mergeArchivedMatches(entry1, entry2) {
  if (!entry1) return entry2;
  if (!entry2) return entry1;

  let older = entry1;
  let newer = entry2;

  if (entry1.timestamp > entry2.timestamp) {
    older = entry2;
    newer = entry1;
  }

  const completing = (!newer.inferred && entry1 !== entry2) ? newer : (!older.inferred ? older : newer);
  const mergedRounds = mergeMapRounds(older.mapRounds || older.roundMaps || [], newer.mapRounds || newer.roundMaps || []);
  const mergedTeams = mergeTeams(older.teams, newer.teams);

  const localAccountId = older.localAccountId || newer.localAccountId || null;
  const isSpectator = Boolean(older.isSpectator && newer.isSpectator);
  const is2v2 = Boolean(older.is2v2 || newer.is2v2);
  const inferred = Boolean(older.inferred && newer.inferred);

  let finalScore = completing.finalScore || newer.finalScore || older.finalScore;
  const sumFinal = (s) => (s ? (s.side0 || 0) + (s.side1 || 0) : 0);
  if (sumFinal(newer.finalScore) > sumFinal(finalScore)) finalScore = newer.finalScore;
  if (sumFinal(older.finalScore) > sumFinal(finalScore)) finalScore = older.finalScore;

  let won = completing.won;
  let tied = completing.tied;
  let myScore = completing.myScore;
  let oppScore = completing.oppScore;

  let kills = (older.kills || 0) + (newer.kills || 0);
  let deaths = (older.deaths || 0) + (newer.deaths || 0);
  let assists = (older.assists || 0) + (newer.assists || 0);
  let weaponBreakdown = mergeWeaponBreakdowns(older.weaponBreakdown, newer.weaponBreakdown);

  if (localAccountId && !isSpectator) {
    const side0Player = mergedTeams[0]?.find((p) => p.accountId === localAccountId);
    const side1Player = mergedTeams[1]?.find((p) => p.accountId === localAccountId);
    const meSide = side0Player ? 0 : (side1Player ? 1 : null);
    const meRow = side0Player || side1Player;
    if (meRow) {
      kills = meRow.kills;
      deaths = meRow.deaths;
      assists = meRow.assists;
      weaponBreakdown = meRow.weaponBreakdown || [];
    }
    if (meSide !== null && finalScore) {
      myScore = meSide === 0 ? finalScore.side0 : finalScore.side1;
      oppScore = meSide === 0 ? finalScore.side1 : finalScore.side0;
      won = myScore > oppScore;
      tied = myScore === oppScore;
    }
  }

  const rawTags = [...(older.tags || []), ...(newer.tags || [])];
  const uniqueTags = [...new Set(rawTags)];
  const isRanked = isRankedFinalScore(finalScore?.side0 ?? 0, finalScore?.side1 ?? 0);
  let tags = uniqueTags;
  if (isRanked) {
    tags = tags.filter((t) => t.toLowerCase() !== 'casual');
    if (!tags.some((t) => t.toLowerCase() === 'ranked') && !is2v2) tags.push('Ranked');
  } else if (!is2v2) {
    tags = tags.filter((t) => t.toLowerCase() !== 'ranked');
    if (!tags.some((t) => t.toLowerCase() === 'casual')) tags.push('Casual');
  }

  return {
    matchId: entry1.matchId || entry2.matchId,
    timestamp: Math.min(older.timestamp || Date.now(), newer.timestamp || Date.now()),
    inferred,
    won,
    tied,
    is2v2,
    isSpectator,
    myScore,
    oppScore,
    team0Name: completing.team0Name || newer.team0Name || older.team0Name || 'Blue Team',
    team1Name: completing.team1Name || newer.team1Name || older.team1Name || 'Orange Team',
    mapLabel: older.mapLabel || newer.mapLabel || mergedRounds[0]?.mapLabel || null,
    roundCount: mergedRounds.length,
    finalScore,
    teams: mergedTeams,
    localAccountId,
    kills,
    deaths,
    assists,
    weaponBreakdown,
    mapRounds: mergedRounds,
    roundMaps: mergedRounds,
    tags,
    modeOverride: completing.modeOverride || newer.modeOverride || older.modeOverride || undefined,
    _schemaVersion: 12,
  };
}

function cleanupSplitMatches(rankedArchive, otherArchive) {
  if (!rankedArchive || !otherArchive) return 0;
  let mergedCount = 0;

  // 1. Check for matches split across ranked and other archives
  const otherMatches = [...(otherArchive.data?.matches || [])];
  for (const mOther of otherMatches) {
    const mRanked = rankedArchive.getMatch(mOther.matchId);
    if (mRanked) {
      const merged = mergeArchivedMatches(mOther, mRanked);
      const isRanked = isRankedFinalScore(merged.finalScore?.side0 ?? 0, merged.finalScore?.side1 ?? 0);
      if (isRanked) {
        otherArchive.deleteMatch(mOther.matchId);
        rankedArchive.recordMatch(merged, { force: true });
      } else {
        rankedArchive.deleteMatch(mRanked.matchId);
        otherArchive.recordMatch(merged, { force: true });
      }
      mergedCount += 1;
    }
  }

  // 2. Check for duplicate/split matches within rankedArchive
  const rankedById = new Map();
  for (const m of [...(rankedArchive.data?.matches || [])]) {
    if (!rankedById.has(m.matchId)) {
      rankedById.set(m.matchId, [m]);
    } else {
      rankedById.get(m.matchId).push(m);
    }
  }
  for (const [mid, list] of rankedById) {
    if (list.length > 1) {
      let merged = list[0];
      for (let i = 1; i < list.length; i++) {
        merged = mergeArchivedMatches(merged, list[i]);
      }
      rankedArchive.deleteMatch(mid);
      rankedArchive.recordMatch(merged, { force: true });
      mergedCount += 1;
    }
  }

  // 3. Check for duplicate/split matches within otherArchive
  const otherById = new Map();
  for (const m of [...(otherArchive.data?.matches || [])]) {
    if (!otherById.has(m.matchId)) {
      otherById.set(m.matchId, [m]);
    } else {
      otherById.get(m.matchId).push(m);
    }
  }
  for (const [mid, list] of otherById) {
    if (list.length > 1) {
      let merged = list[0];
      for (let i = 1; i < list.length; i++) {
        merged = mergeArchivedMatches(merged, list[i]);
      }
      otherArchive.deleteMatch(mid);
      otherArchive.recordMatch(merged, { force: true });
      mergedCount += 1;
    }
  }

  return mergedCount;
}

/**
 * Combine Pit hazard deaths across both ranked and other/casual archives.
 */
function getGlobalPitStats(rankedArchive, otherArchive, localPlayerName) {
  const ranked = rankedArchive ? rankedArchive.getPitStats(localPlayerName) : { totalDeaths: 0, selfDeaths: 0, otherDeaths: 0, topVictim: null, victims: [], claims: [] };
  const other = otherArchive ? otherArchive.getPitStats(localPlayerName) : { totalDeaths: 0, selfDeaths: 0, otherDeaths: 0, topVictim: null, victims: [], claims: [] };

  const totalDeaths = ranked.totalDeaths + other.totalDeaths;
  const selfDeaths = ranked.selfDeaths + other.selfDeaths;
  const otherDeaths = totalDeaths - selfDeaths;

  const victimMap = new Map();
  for (const v of [...ranked.victims, ...other.victims]) {
    const key = v.name.toUpperCase();
    const existing = victimMap.get(key);
    if (existing) {
      existing.count += v.count;
    } else {
      victimMap.set(key, { name: v.name, count: v.count });
    }
  }
  const victims = [...victimMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const allClaims = [...ranked.claims, ...other.claims].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return {
    totalDeaths,
    selfDeaths,
    otherDeaths,
    topVictim: victims[0] || null,
    victims,
    claims: allClaims,
    rankedTotal: ranked.totalDeaths,
    otherTotal: other.totalDeaths,
  };
}

module.exports = {
  MatchArchive,
  WEAPON_META,
  isRankedFinalScore,
  mergeWeaponBreakdowns,
  mergeTeams,
  mergeMapRounds,
  mergeArchivedMatches,
  cleanupSplitMatches,
  getGlobalPitStats,
  computeDplRating,
};
