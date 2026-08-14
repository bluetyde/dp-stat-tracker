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
  if (isRankedRecorded || isOtherRecorded) {
    const existingArchive = isRankedRecorded ? rankedArchive : otherArchive;
    if (!existingArchive.isLegacyMatch(matchId)) return false;
  }

  if (!accountId) return false;

  const me = match.players.get(accountId);
  if (!me) return false;

  const finalScore = inferred ? deriveFinalScoreFromRounds(match.roundsByNumber) : match.finalScore;
  if (!finalScore) return false;

  const myScore = me.rosterSide === 0 ? finalScore.side0 : finalScore.side1;
  const oppScore = me.rosterSide === 0 ? finalScore.side1 : finalScore.side0;

  // Always consume this match's share of the map queue, even if it turns
  // out not to be recorded below — otherwise a skipped match's maps would
  // bleed into whichever match comes next (map-tracker.js is a strict FIFO,
  // one entry per round, regardless of whether we keep the match).
  const roundMaps = mapTracker.takeForRounds(match.roundsByNumber.size);

  const stats = computeMatchStats(match);
  const row = [...stats.teams[0], ...stats.teams[1]].find((r) => r.accountId === accountId);
  if (!row) return false;

  const targetArchive = isRankedFinalScore(myScore, oppScore) ? rankedArchive : otherArchive;

  let prevWins0 = 0;
  const mapRoundsDetailed = [];
  const totalRounds = match.roundsByNumber.size;

  for (let r = 1; r <= totalRounds; r++) {
    const roundObj = match.roundsByNumber.get(r);
    const mapInfo = roundMaps[r - 1] ?? { label: 'Unknown Map', tileset: 'Unknown', mapName: 'Unknown' };
    const wins0 = roundObj?.teamBlocks?.[0]?.roundWins ?? prevWins0;
    const winnerSide = wins0 > prevWins0 ? 0 : 1;
    prevWins0 = wins0;

    // Real per-round role, from the actual attackerSide/victimSide on this
    // round's own kill/damage lines — not a guessed "round <= 6" halftime
    // split, which breaks for non-ranked modes with different round counts
    // (see isRankedFinalScore's comment) and doesn't account for which
    // roster side actually started on which role.
    const roleByRosterSide = roundObj ? roundRoleByRosterSide(roundObj) : {};
    const myRole = roleByRosterSide[me.rosterSide];
    const sideRole = myRole === 0 ? 'ATTACK' : myRole === 1 ? 'DEFENSE' : null;

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
    if (attackBlock && typeof attackBlock.outcomeCode === 'number') {
      if (attackBlock.outcomeCode === 1) {
        roundResult = 'defuse';
      } else if (attackBlock.outcomeCode === 2) {
        const attackDeadIds = new Set(
          (roundObj.kills ?? []).filter((k) => attackBlock.members.some((m) => m.entityId === k.victimId)).map((k) => k.victimId)
        );
        const attackSurvivors = attackBlock.members.length - attackDeadIds.size;
        roundResult = attackSurvivors > 0 ? 'save' : 'elimination';
      }
    }

    mapRoundsDetailed.push({
      round: r,
      mapLabel: mapInfo.label,
      tileset: mapInfo.tileset ?? 'Unknown',
      mapName: mapInfo.mapName ?? mapInfo.label,
      winnerSide,
      won: me.rosterSide === winnerSide,
      sideRole,
      roundResult,
    });
  }

  const team0Name = match.team0Name || 'Blue Team';
  const team1Name = match.team1Name || 'Orange Team';

  targetArchive.recordMatch({
    matchId,
    timestamp: Date.now(),
    inferred, // true if no matchEnded event was ever seen for this match — see the doc comment above
    won: myScore > oppScore,
    myScore,
    oppScore,
    team0Name,
    team1Name,
    mapLabel: roundMaps[0]?.label ?? null, // round 1's map represents the match; see map-tracker.js
    mapRounds: mapRoundsDetailed,
    roundMaps: mapRoundsDetailed,
    localAccountId: accountId,
    roundCount: stats.roundCount,
    finalScore, // not perspective-flipped — side0/side1 as reported, for the detail view's team columns
    teams: stats.teams, // FULL scoreboard: { 0: [row, ...], 1: [row, ...] }, every player
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    weaponBreakdown: row.weaponBreakdown,
  });
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

module.exports = { recordCompletedMatch, scanLogFileForCompletedMatches };
