'use strict';
// Recording completed matches into the match archives — shared by:
//   1. main.js's live tailing (as each match completes in real time),
//   2. the startup catch-up scan below (for matches that completed while
//      the app was closed), and
//   3. main.js's confirmed-game-exit handler (inferred completion — see
//      recordCompletedMatch's `inferred` branch).
//
// Two archives, one ranked-score gate deciding which one a match goes to —
// see isRankedFinalScore. Every match that reaches a decisive result gets
// recorded somewhere; nothing is dropped anymore.
//
// IMPORTANT — durability boundary: Due Process rotates its own log file on
// every game launch. The previous session's Player.log is renamed to
// Player-prev.log, and whatever was Player-prev.log before that is deleted.
// So at any moment, at most two sessions of raw log ever exist on disk —
// this means the match archives are the ONLY durable record of anything
// older than that, and the ONLY place a match's full scoreboard survives
// once its source log rotates away. A match that completed two-or-more
// launches ago, that was never scanned into an archive while still
// reachable as Player.log or Player-prev.log, is gone permanently: no log
// data is left anywhere to recover it from. This is exactly why matches
// are recorded immediately (match-archive.js's recordMatch() saves
// synchronously, not batched) and why the startup scan below checks both
// files before live tailing resumes — catching up as early as possible is
// the only chance.

const fs = require('node:fs/promises');
const { MapTracker } = require('./map-tracker');
const { WEAPON_META, mergeArchivedMatches } = require('./match-archive');

/**
 * Record one match into the appropriate archive, if it isn't there yet.
 * Handles two completion cases through this same function, same dedup,
 * same ranked-score gate — deliberately not parallel code paths:
 *
 *   - Normal (default): match.status === 'complete', i.e. a real matchEnded
 *     was seen. matchId comes from match.endMatchId, score from
 *     match.finalScore.
 *   - Inferred (ctx.inferred === true): for a match that will never get a
 *     real matchEnded (the game process exited before the client's own
 *     teardown/matchEnded sequence ran). Only valid for a still-
 *     `in-progress` match; matchId comes from match.liveMatchId (the
 *     Vivox-handshake id — see parser.js — confirmed to be the same id
 *     matchEnded would have reported), and the score is derived fresh from
 *     the match's own Team blocks via ctx.deriveFinalScoreFromRounds
 *     (required when ctx.inferred is true). An inferred match is only ever
 *     recorded once its score is already decisive — a match that exits
 *     mid-round with no decisive result is never recorded, never
 *     fabricated. Recorded entries are tagged `inferred: true` so they're
 *     never indistinguishable from a confirmed completion (same principle
 *     as the weaponNames/ADR-formula flags elsewhere).
 *
 * Once a decisive score exists, isRankedFinalScore decides which of
 * ctx.rankedArchive / ctx.otherArchive the match is recorded into — ranked
 * matches (7-X, 6-6) go to rankedArchive; everything else (unranked, 2v2,
 * Push, whatever else the score shape doesn't match) goes to otherArchive
 * instead of being dropped. Dedup is checked against BOTH archives before
 * doing any work, since a given MatchId only ever belongs to one of them.
 *
 * The FULL scoreboard (both teams, every player — stats.js's
 * computeMatchStats() output) is archived either way, not just the local
 * player's summary row — so a match stays fully viewable after its source
 * log has rotated away.
 *
 * Returns true if newly recorded (into either archive), false if skipped
 * (already recorded, not eligible yet, local player not identifiable, or
 * score not decisive).
 */
function recordCompletedMatch(
  match,
  {
    rankedArchive,
    otherArchive,
    computeMatchStats,
    roundRoleByRosterSide,
    mapTracker,
    accountId,
    inferred = false,
    deriveFinalScoreFromRounds,
  }
) {
  if (inferred) {
    if (match.status !== 'in-progress') return false; // only for a match that's still open when the process exited
  } else if (match.status !== 'complete') {
    return false; // in-progress matches are never recorded via the normal path — nothing to catch up on yet
  }

  const matchId = inferred ? match.liveMatchId : match.endMatchId;
  if (!matchId) return false;

  const isRankedRecorded = rankedArchive.hasRecordedMatch(matchId);
  const isOtherRecorded = otherArchive.hasRecordedMatch(matchId);
  const existingInRanked = rankedArchive.getMatch(matchId);
  const existingInOther = otherArchive.getMatch(matchId);
  const existing = existingInRanked || existingInOther;

  const roundNumbers = [...match.roundsByNumber.keys()].sort((a, b) => a - b);
  const totalRounds = roundNumbers.length;

  if (existing) {
    const existingArchive = existingInRanked ? rankedArchive : otherArchive;
    const isLegacy = existingArchive.isLegacyMatch(matchId);
    const finalExpected = match.finalScore ? (match.finalScore.side0 ?? 0) + (match.finalScore.side1 ?? 0) : 0;
    const isSplitOrPartial =
      (existing.inferred && !inferred) ||
      (existing.roundCount !== totalRounds) ||
      (finalExpected > 0 && (existing.roundCount ?? 0) < finalExpected) ||
      (existing.mapRounds && existing.mapRounds.some((er) => !roundNumbers.includes(er.round)));

    if (!isLegacy && !isSplitOrPartial) return false;
  }

  const finalScore = inferred ? deriveFinalScoreFromRounds(match.roundsByNumber) : match.finalScore;
  if (!finalScore) return false;

  // Always consume this match's share of the map queue, even if it turns
  // out not to be recorded below — otherwise a skipped match's maps would
  // bleed into whichever match comes next (map-tracker.js is a strict FIFO,
  // one entry per round, regardless of whether we keep the match).
  const roundMaps = mapTracker.takeForRounds(totalRounds);

  const stats = computeMatchStats(match);
  const me = accountId ? match.players.get(accountId) : null;
  const row = accountId ? [...stats.teams[0], ...stats.teams[1]].find((r) => r.accountId === accountId) : null;
  const isPlayer = Boolean(me && (me.rosterSide === 0 || me.rosterSide === 1) && row);
  const isSpectator = !isPlayer;

  const myScore = isSpectator ? finalScore.side0 : (me.rosterSide === 0 ? finalScore.side0 : finalScore.side1);
  const oppScore = isSpectator ? finalScore.side1 : (me.rosterSide === 0 ? finalScore.side1 : finalScore.side0);

  const targetArchive = isRankedFinalScore(finalScore.side0, finalScore.side1) ? rankedArchive : otherArchive;
  const is2v2 = match.is2v2 !== undefined
    ? Boolean(match.is2v2)
    : Boolean(typeof roundMaps[0]?.label === 'string' && /(?:^|\W)2v2(?:$|\W)/i.test(roundMaps[0]?.label));

  const firstR = roundNumbers[0] || 1;
  const firstObj = match.roundsByNumber.get(firstR);
  let prevWins0 = 0;
  if (firstObj?.teamBlocks?.[0]?.roundWins !== undefined && firstR > 1) {
    const outcomes = firstObj.teamBlocks[0].RoundOutcomes;
    if (Array.isArray(outcomes) && outcomes.length >= firstR) {
      prevWins0 = outcomes.slice(0, firstR - 1).filter((c) => c === 1 || c === 4).length;
    } else {
      const code = firstObj.teamBlocks[0].outcomeCode;
      const wonFirst = (code === 1 || code === 4);
      prevWins0 = Math.max(0, firstObj.teamBlocks[0].roundWins - (wonFirst ? 1 : 0));
    }
  }
  const mapRoundsDetailed = [];

  // Killfeed lines arrive in real time as a round is played, but that
  // round's own Stats::Kill/Damage only flush as one batch at its end — see
  // parser.js's killFeed comment. So killFeed is stored match-wide, not
  // per-round, and re-associated with the correct round here by tick range
  // instead of trusting when the parser happened to read the line. A
  // round's window runs from its own first known tick up to the next
  // round's first known tick (exclusive), or indefinitely for the last
  // round — covers the "missed final kill lands just after this round's
  // own batch" case without needing to assume any fixed offset.
  const roundTickBounds = new Map();
  for (const r of roundNumbers) {
    const roundObj = match.roundsByNumber.get(r);
    if (!roundObj) continue;
    const ticks = [...roundObj.kills.map((k) => k.tick), ...roundObj.damage.map((d) => d.tick)];
    const hasCombat = ticks.length > 0;
    const minCombat = hasCombat ? Math.min(...ticks) : null;
    const maxCombat = hasCombat ? Math.max(...ticks) : null;
    const hasActionStart = roundObj.actionStartTick !== undefined && roundObj.actionStartTick !== null;
    const validActionStart = hasActionStart && (minCombat === null || roundObj.actionStartTick <= minCombat);
    const start = validActionStart ? roundObj.actionStartTick : (minCombat ?? 0);
    if (hasCombat || hasActionStart) {
      roundTickBounds.set(r, { min: minCombat ?? start, max: maxCombat ?? start, start });
    }
  }
  function killFeedForRound(r) {
    const bounds = roundTickBounds.get(r);
    if (!bounds) return [];
    let nextRoundStart = Infinity;
    for (const n of roundNumbers) {
      if (n <= r) continue;
      const nb = roundTickBounds.get(n);
      if (nb) {
        nextRoundStart = nb.start ?? nb.min;
        break;
      }
    }
    const windowStart = bounds.start ?? bounds.min;
    return match.killFeed.filter((entry) => entry.tick >= windowStart && entry.tick < nextRoundStart);
  }
  const entityNames = new Map([...match.players.values()].map((p) => [p.entityId, p.name?.toUpperCase()]));
  const entityInfo = new Map();
  for (const p of match.players.values()) {
    if (p.entityId !== undefined && p.entityId !== null) {
      entityInfo.set(p.entityId, { name: p.name, side: p.rosterSide, accountId: p.accountId });
    }
  }
  for (const r of roundNumbers) {
    const robj = match.roundsByNumber.get(r);
    if (robj) {
      for (const side of [0, 1]) {
        for (const m of (robj.teamBlocks?.[side]?.members ?? [])) {
          if (m.entityId !== undefined && m.entityId !== null) {
            entityInfo.set(m.entityId, { name: m.name, side, accountId: m.accountId });
          }
        }
      }
    }
  }

  for (let idx = 0; idx < roundNumbers.length; idx++) {
    const r = roundNumbers[idx];
    const roundObj = match.roundsByNumber.get(r);
    const mapInfo = roundMaps[idx] ?? { label: 'Unknown Map', tileset: 'Unknown', mapName: 'Unknown' };
    const wins0 = roundObj?.teamBlocks?.[0]?.roundWins ?? prevWins0;
    const winnerSide = wins0 > prevWins0 ? 0 : 1;
    prevWins0 = wins0;

    // Real per-round role, from the actual attackerSide/victimSide on this
    // round's own kill/damage lines — not a guessed "round <= 6" halftime
    // split, which breaks for non-ranked modes with different round counts
    // (see isRankedFinalScore's comment) and doesn't account for which
    // roster side actually started on which role.
    const roleByRosterSide = roundObj ? roundRoleByRosterSide(roundObj) : {};
    const sideRole = (!isSpectator && me)
      ? (roleByRosterSide[me.rosterSide] === 0 ? 'ATTACK' : roleByRosterSide[me.rosterSide] === 1 ? 'DEFENSE' : null)
      : null;
    const won = (!isSpectator && me) ? (me.rosterSide === winnerSide) : (winnerSide === 0);

    // How the round ended, independent of who won it (winnerSide/won above
    // already cover that). Attacker's own outcomeCode is authoritative: 1 =
    // defused, 2 = didn't defuse. A non-defuse round further splits on
    // whether the attacking side was fully wiped (elimination) or had a
    // survivor when time ran out (save) — verified against real match data:
    // every non-defuse round with 0 attacker survivors was a clean wipe,
    // every one with >=1 survivor was a confirmed save, no exceptions found
    // across 10 sampled rounds. Attacker side isn't necessarily "me" — this
    // describes the round itself, not my personal result in it.
    let roundResult = null;
    const attackRosterSide = roleByRosterSide[0] === 0 ? 0 : roleByRosterSide[1] === 0 ? 1 : null;
    const attackBlock = attackRosterSide === null ? null : roundObj?.teamBlocks?.[attackRosterSide];
    const feedEntries = killFeedForRound(r);
    if (attackBlock && typeof attackBlock.outcomeCode === 'number') {
      if (attackBlock.outcomeCode === 1) {
        roundResult = 'defuse';
      } else if (attackBlock.outcomeCode === 2) {
        const attackDeadIds = new Set(
          (roundObj.kills ?? []).filter((k) => attackBlock.members.some((m) => m.entityId === k.victimId)).map((k) => k.victimId)
        );
        // Stats::Kill is a batch flushed right before the round-end Team
        // block — confirmed live that the round's OWN decisive kill can
        // race that flush and get dropped from it entirely, even though the
        // real-time killfeed (which isn't batched) still recorded it. Left
        // uncaught, that reads as a fake "survivor" and misclassifies an
        // elimination as a save. Cross-reference by name (killfeed has no
        // entityId) for any attacker death Stats::Kill missed.
        const attackNamesById = new Map(attackBlock.members.map((m) => [m.entityId, m.name?.toUpperCase()]));
        for (const entry of feedEntries) {
          for (const [entityId, name] of attackNamesById) {
            if (name && name === entry.victimName?.toUpperCase()) attackDeadIds.add(entityId);
          }
        }
        const attackSurvivors = attackBlock.members.length - attackDeadIds.size;
        roundResult = attackSurvivors > 0 ? 'save' : 'elimination';
      }
    }

    // Local player's own kill count for this specific round — only reliable
    // now that the round-ending kill (the one that can go missing from
    // Stats::Kill entirely, see the killFeedForRound cross-reference above)
    // is checked here too, not just for the attacking side's survivors.
    // De-duplicated by victim name rather than id, since killfeed lines
    // don't carry entityId — safe within one round, since nobody respawns
    // to be killed twice.
    let myKills = 0;
    if (!isSpectator && me) {
      const myKillVictimNames = new Set(
        (roundObj?.kills ?? [])
          .filter((k) => k.attackerId === me.entityId && k.attackerSide !== k.victimSide)
          .map((k) => entityNames.get(k.victimId))
      );
      for (const entry of feedEntries) {
        if (entry.isEnvironmentKill) continue;
        const victimUpper = entry.victimName?.toUpperCase();
        if (entry.killerName?.toUpperCase() === me.name?.toUpperCase() && victimUpper && !myKillVictimNames.has(victimUpper)) {
          myKillVictimNames.add(victimUpper);
        }
      }
      myKills = myKillVictimNames.size;
    }

    // Detailed per-round kill timeline: who kills whom with what, and elapsed timings
    const bounds = roundTickBounds.get(r);
    let startTick = bounds ? (bounds.start ?? bounds.min) : 0;
    if ((!bounds || startTick === undefined || startTick === null) && feedEntries.length > 0) {
      startTick = Math.min(...feedEntries.map((e) => e.tick));
    }

    const roundKills = [];
    const recordedVictimNames = new Set();

    for (const k of (roundObj?.kills ?? [])) {
      const killer = entityInfo.get(k.attackerId);
      const victim = entityInfo.get(k.victimId);
      const killerName = killer?.name || entityNames.get(k.attackerId) || `Player ${k.attackerId}`;
      const victimName = victim?.name || entityNames.get(k.victimId) || `Player ${k.victimId}`;
      const killerSide = k.attackerSide !== undefined ? k.attackerSide : (killer?.side ?? null);
      const victimSide = k.victimSide !== undefined ? k.victimSide : (victim?.side ?? null);
      const weaponCode = k.damageSource;
      const weaponLabel = (weaponCode !== undefined && WEAPON_META[weaponCode]?.label)
        ? WEAPON_META[weaponCode].label
        : (weaponCode !== undefined ? `Weapon #${weaponCode}` : 'Unknown');
      const isTeamKill = killerSide !== null && victimSide !== null && killerSide === victimSide;
      const tick = Number(k.tick);
      const deltaTicks = Math.max(0, tick - startTick);
      const seconds = Math.round(deltaTicks / 20);
      const mins = Math.floor(seconds / 60);
      const secs = String(seconds % 60).padStart(2, '0');
      const timeFormatted = `${mins}:${secs}`;

      roundKills.push({
        tick,
        seconds,
        timeFormatted,
        killerName,
        killerSide,
        victimName,
        victimSide,
        weapon: weaponLabel,
        damageSource: weaponCode,
        isTeamKill,
        isEnvironment: false,
      });
      if (victimName) recordedVictimNames.add(victimName.toUpperCase());
    }

    for (const entry of feedEntries) {
      if (entry.isEnvironmentKill) {
        const tick = Number(entry.tick);
        const deltaTicks = Math.max(0, tick - startTick);
        const seconds = Math.round(deltaTicks / 20);
        const mins = Math.floor(seconds / 60);
        const secs = String(seconds % 60).padStart(2, '0');
        const timeFormatted = `${mins}:${secs}`;
        const victim = [...entityInfo.values()].find((e) => e.name?.toUpperCase() === entry.victimName?.toUpperCase());
        const isPit = Boolean(entry.isPitDeath || entry.killerName?.toUpperCase() === 'PIT' || entry.verb?.toUpperCase() === 'ROASTED');
        roundKills.push({
          tick,
          seconds,
          timeFormatted,
          killerName: entry.killerName,
          killerSide: null,
          victimName: entry.victimName,
          victimSide: victim?.side ?? null,
          weapon: isPit ? 'Pit' : (entry.killerName?.toUpperCase() === 'UAV' ? 'UAV Zap' : (entry.verb || 'Environment')),
          damageSource: null,
          isTeamKill: false,
          isEnvironment: true,
          isPit,
        });
        if (entry.victimName) recordedVictimNames.add(entry.victimName.toUpperCase());
        continue;
      }
      const victimUpper = entry.victimName?.toUpperCase();
      if (victimUpper && !recordedVictimNames.has(victimUpper)) {
        recordedVictimNames.add(victimUpper);
        const killer = [...entityInfo.values()].find((e) => e.name?.toUpperCase() === entry.killerName?.toUpperCase());
        const victim = [...entityInfo.values()].find((e) => e.name?.toUpperCase() === entry.victimName?.toUpperCase());
        const killerSide = killer?.side ?? null;
        const victimSide = victim?.side ?? null;
        const tick = Number(entry.tick);
        const deltaTicks = Math.max(0, tick - startTick);
        const seconds = Math.round(deltaTicks / 20);
        const mins = Math.floor(seconds / 60);
        const secs = String(seconds % 60).padStart(2, '0');
        const timeFormatted = `${mins}:${secs}`;
        let weaponStr = entry.verb || 'Killed';
        const spriteMatch = /name="([^"]+)"/i.exec(weaponStr);
        if (spriteMatch) {
          weaponStr = spriteMatch[1];
        }
        const isPit = Boolean(entry.isPitDeath || entry.killerName?.toUpperCase() === 'PIT' || entry.verb?.toUpperCase() === 'ROASTED');
        roundKills.push({
          tick,
          seconds,
          timeFormatted,
          killerName: entry.killerName,
          killerSide,
          victimName: entry.victimName,
          victimSide,
          weapon: isPit ? 'Pit' : weaponStr,
          damageSource: null,
          isTeamKill: killerSide !== null && victimSide !== null && killerSide === victimSide,
          isEnvironment: isPit,
          isPit,
        });
      }
    }

    roundKills.sort((a, b) => a.tick - b.tick);

    mapRoundsDetailed.push({
      round: r,
      myKills,
      mapLabel: mapInfo.label,
      tileset: mapInfo.tileset ?? 'Unknown',
      mapName: mapInfo.mapName ?? mapInfo.label,
      winnerSide,
      won,
      sideRole,
      roundResult,
      kills: roundKills,
      actionStartTick: roundObj?.actionStartTick ?? null,
    });
  }

  const team0Name = match.team0Name || 'Blue Team';
  const team1Name = match.team1Name || 'Orange Team';

  const defaultTags = is2v2 ? ['2v2'] : (targetArchive === rankedArchive ? ['Ranked'] : ['Casual']);
  const tags = isSpectator ? [...defaultTags, 'Spectated'] : defaultTags;

  const newEntry = {
    matchId,
    timestamp: Date.now(),
    inferred, // true if no matchEnded event was ever seen for this match — see the doc comment above
    won: isSpectator ? false : myScore > oppScore,
    // A 6-6 ranked score is a real, decisive-enough-to-record outcome (see
    // isRankedFinalScore below) but it's neither a win nor a loss — won
    // stays a strict boolean (myScore > oppScore, false here) since that's
    // correct for win-rate/streak/rating math elsewhere, but callers that
    // render a result label need this separate flag to show "TIE" instead
    // of quietly treating a tie as a loss.
    tied: myScore === oppScore,
    is2v2,
    isSpectator,
    myScore,
    oppScore,
    team0Name,
    team1Name,
    mapLabel: roundMaps[0]?.label ?? null, // round 1's map represents the match; see map-tracker.js
    mapRounds: mapRoundsDetailed,
    roundMaps: mapRoundsDetailed,
    localAccountId: isSpectator ? null : accountId,
    roundCount: stats.roundCount,
    finalScore, // not perspective-flipped — side0/side1 as reported, for the detail view's team columns
    teams: stats.teams, // FULL scoreboard: { 0: [row, ...], 1: [row, ...] }, every player
    kills: isSpectator ? 0 : (row?.kills ?? 0),
    deaths: isSpectator ? 0 : (row?.deaths ?? 0),
    assists: isSpectator ? 0 : (row?.assists ?? 0),
    weaponBreakdown: isSpectator ? [] : (row?.weaponBreakdown ?? []),
    tags,
  };

  let entryToRecord = newEntry;
  if (existing) {
    const finalExpected = finalScore ? (finalScore.side0 ?? 0) + (finalScore.side1 ?? 0) : 0;
    const isSplitOrPartial =
      (existing.inferred && !newEntry.inferred) ||
      (existing.roundCount !== newEntry.roundCount) ||
      (finalExpected > 0 && (existing.roundCount ?? 0) < finalExpected) ||
      (existing.mapRounds && existing.mapRounds.some((er) => !roundNumbers.includes(er.round)));

    if (isSplitOrPartial) {
      entryToRecord = mergeArchivedMatches(existing, newEntry);
    }
  }

  const finalTargetArchive = isRankedFinalScore(entryToRecord.finalScore?.side0 ?? 0, entryToRecord.finalScore?.side1 ?? 0)
    ? rankedArchive
    : otherArchive;

  if (finalTargetArchive === rankedArchive) {
    if (existingInOther) otherArchive.deleteMatch(matchId);
    rankedArchive.recordMatch(entryToRecord, { force: true });
  } else {
    if (existingInRanked) rankedArchive.deleteMatch(matchId);
    otherArchive.recordMatch(entryToRecord, { force: true });
  }
  return true;
}

// Ranked Due Process matches are decided at first-to-7 rounds, ending
// either "7-X" (X 0-6) or, if neither side reaches 7, a "6-6" draw. That
// score shape is specific to ranked competitive; other modes — unranked,
// 2v2, Push, etc. — use different round targets/lengths. There's no
// confirmed GameMode code -> mode name mapping to filter on directly (same
// "don't guess" rule as weaponNames in stats.js), so this gates on the
// final score shape instead, which is directly observable and unambiguous
// for this purpose. Matches that don't match this shape aren't dropped —
// see recordCompletedMatch, they're routed to otherArchive instead.
function isRankedFinalScore(myScore, oppScore) {
  if (myScore === 6 && oppScore === 6) return true;
  if (myScore === 7 && oppScore <= 6) return true;
  if (oppScore === 7 && myScore <= 6) return true;
  return false;
}

/**
 * Read `filePath` fully, independently of any live tailing, and record any
 * completed match it contains that isn't already in either archive. Uses a
 * throwaway parser + MapTracker scoped to just this one file — never
 * shares state with main.js's live-tailing parser/mapTracker. A missing
 * file (e.g. no Player-prev.log yet on a first-ever run) is not an error.
 *
 * `allowInferred`: when true, also attempts inferred completion (see
 * recordCompletedMatch) on whatever's left as this scan's own in-progress
 * match, if any. Pass this as true only when the game process is already
 * confirmed not running (main.js checks once at startup) — there's no
 * multi-poll debounce here the way there is for the live path, since a
 * single startup-time check isn't racing against the game still launching.
 */
const path = require('node:path');
const zlib = require('node:zlib');

/**
 * Extract raw text of Player.log from a PKZIP buffer (e.g. LogArchive*.zip).
 */
function readZipLogText(buffer) {
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) === 0x04034b50) {
      const method = buffer.readUInt16LE(offset + 8);
      const compSize = buffer.readUInt32LE(offset + 18);
      const fileNameLen = buffer.readUInt16LE(offset + 26);
      const extraLen = buffer.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + fileNameLen + extraLen;

      let dataBuf;
      if (compSize > 0) {
        dataBuf = buffer.subarray(dataStart, dataStart + compSize);
      } else {
        dataBuf = buffer.subarray(dataStart);
      }

      try {
        let decompressed;
        if (method === 0) {
          decompressed = dataBuf;
        } else if (method === 8) {
          decompressed = zlib.inflateRawSync(dataBuf);
        }
        if (decompressed) {
          return decompressed.toString('utf8');
        }
      } catch {
        // Continue searching if this entry failed
      }
      offset = dataStart + (compSize > 0 ? compSize : 1);
    } else {
      offset++;
    }
  }
  return null;
}

/**
 * Read `filePath` fully, independently of any live tailing, and record any
 * completed match it contains that isn't already in either archive. Uses a
 * throwaway parser + MapTracker scoped to just this one file — never
 * shares state with main.js's live-tailing parser/mapTracker. A missing
 * file (e.g. no Player-prev.log yet on a first-ever run) is not an error.
 *
 * `allowInferred`: when true, also attempts inferred completion (see
 * recordCompletedMatch) on whatever's left as this scan's own in-progress
 * match, if any. Pass this as true only when the game process is already
 * confirmed not running (main.js checks once at startup) — there's no
 * multi-poll debounce here the way there is for the live path, since a
 * single startup-time check isn't racing against the game still launching.
 */
async function scanLogFileForCompletedMatches({
  filePath,
  DueProcessLogParser,
  computeMatchStats,
  roundRoleByRosterSide,
  rankedArchive,
  otherArchive,
  findLocalAccountId,
  deriveFinalScoreFromRounds,
  allowInferred = false,
}) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return { scanned: false, recorded: 0, matchesInFile: 0 };
  }

  const parser = new DueProcessLogParser();
  const mapTracker = new MapTracker();
  parser.feedText(text);
  parser.end();
  mapTracker.feedText(text);

  let accountId = rankedArchive.getLocalAccountId() || otherArchive.getLocalAccountId();
  if (!accountId) {
    accountId = findLocalAccountId(text);
    if (accountId) {
      rankedArchive.setLocalAccountId(accountId);
      otherArchive.setLocalAccountId(accountId);
    }
  }

  let recorded = 0;
  // parser.matches holds only completed matches (an in-progress one lives
  // separately in parser.current).
  for (const match of parser.matches) {
    if (recordCompletedMatch(match, { rankedArchive, otherArchive, computeMatchStats, roundRoleByRosterSide, mapTracker, accountId })) {
      recorded += 1;
    }
  }

  if (allowInferred && parser.current) {
    if (
      recordCompletedMatch(parser.current, {
        rankedArchive,
        otherArchive,
        computeMatchStats,
        roundRoleByRosterSide,
        mapTracker,
        accountId,
        inferred: true,
        deriveFinalScoreFromRounds,
      })
    ) {
      recorded += 1;
    }
  }

  return { scanned: true, recorded, matchesInFile: parser.matches.length };
}

/**
 * Scan a single LogArchive*.zip file for completed matches.
 */
async function scanZipFileForCompletedMatches({
  zipPath,
  DueProcessLogParser,
  computeMatchStats,
  roundRoleByRosterSide,
  rankedArchive,
  otherArchive,
  findLocalAccountId,
  deriveFinalScoreFromRounds,
  allowInferred = false,
}) {
  let buffer;
  try {
    buffer = await fs.readFile(zipPath);
  } catch {
    return { scanned: false, recorded: 0, matchesInFile: 0 };
  }

  const text = readZipLogText(buffer);
  if (!text) return { scanned: false, recorded: 0, matchesInFile: 0 };

  const parser = new DueProcessLogParser();
  const mapTracker = new MapTracker();
  parser.feedText(text);
  parser.end();
  mapTracker.feedText(text);

  let accountId = rankedArchive.getLocalAccountId() || otherArchive.getLocalAccountId();
  if (!accountId) {
    accountId = findLocalAccountId(text);
    if (accountId) {
      rankedArchive.setLocalAccountId(accountId);
      otherArchive.setLocalAccountId(accountId);
    }
  }

  let recorded = 0;
  for (const match of parser.matches) {
    if (recordCompletedMatch(match, { rankedArchive, otherArchive, computeMatchStats, roundRoleByRosterSide, mapTracker, accountId })) {
      recorded += 1;
    }
  }

  if (allowInferred && parser.current) {
    if (
      recordCompletedMatch(parser.current, {
        rankedArchive,
        otherArchive,
        computeMatchStats,
        roundRoleByRosterSide,
        mapTracker,
        accountId,
        inferred: true,
        deriveFinalScoreFromRounds,
      })
    ) {
      recorded += 1;
    }
  }

  return { scanned: true, recorded, matchesInFile: parser.matches.length };
}

/**
 * Find all LogArchive*.zip files in `logDir`, sort by mtime ascending (oldest first),
 * and scan each for completed matches.
 */
async function scanArchiveZipsForCompletedMatches({
  logDir,
  DueProcessLogParser,
  computeMatchStats,
  roundRoleByRosterSide,
  rankedArchive,
  otherArchive,
  findLocalAccountId,
  deriveFinalScoreFromRounds,
  allowInferred = false,
}) {
  let entries;
  try {
    entries = await fs.readdir(logDir);
  } catch {
    return { zipCount: 0, recorded: 0 };
  }

  const zipFiles = entries.filter((name) => name.startsWith('LogArchive') && name.endsWith('.zip'));
  if (zipFiles.length === 0) return { zipCount: 0, recorded: 0 };

  const zipStats = [];
  for (const file of zipFiles) {
    const fullPath = path.join(logDir, file);
    try {
      const stat = await fs.stat(fullPath);
      zipStats.push({ file, fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }
  zipStats.sort((a, b) => a.mtimeMs - b.mtimeMs);

  let totalRecorded = 0;
  for (const item of zipStats) {
    const res = await scanZipFileForCompletedMatches({
      zipPath: item.fullPath,
      DueProcessLogParser,
      computeMatchStats,
      roundRoleByRosterSide,
      rankedArchive,
      otherArchive,
      findLocalAccountId,
      deriveFinalScoreFromRounds,
      allowInferred,
    });
    totalRecorded += res.recorded;
  }

  return { zipCount: zipStats.length, recorded: totalRecorded };
}

module.exports = {
  recordCompletedMatch,
  scanLogFileForCompletedMatches,
  scanZipFileForCompletedMatches,
  scanArchiveZipsForCompletedMatches,
  readZipLogText,
  isRankedFinalScore,
};

