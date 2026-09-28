const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DueProcessLogParser } = require('../parser');
const { computeMatchStats, roundRoleByRosterSide } = require('../stats');
const { recordCompletedMatch, isRankedFinalScore } = require('../electron/rescan');
const { MatchArchive } = require('../electron/match-archive');
const { MapTracker } = require('../electron/map-tracker');

console.log('=== Test Spectator Matches ===');

// Setup temporary archives
const tempDir = path.join(__dirname, 'temp_spectator_test');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
const rankedFile = path.join(tempDir, 'ranked_matches.json');
const otherFile = path.join(tempDir, 'other_matches.json');
if (fs.existsSync(rankedFile)) fs.unlinkSync(rankedFile);
if (fs.existsSync(otherFile)) fs.unlinkSync(otherFile);

const rankedArchive = new MatchArchive(rankedFile);
const otherArchive = new MatchArchive(otherFile);
const mapTracker = new MapTracker();

const localUserAccountId = '76561198104524823'; // Local user (spectator)
rankedArchive.setLocalAccountId(localUserAccountId);
otherArchive.setLocalAccountId(localUserAccountId);

// 1. First record a real player match for baseline lifetime stats
const playerMatch = {
  status: 'complete',
  liveMatchId: 'match-player-1',
  endMatchId: 'match-player-1',
  is2v2: false,
  team0Name: 'My Team',
  team1Name: 'Opponent Team',
  finalScore: { side0: 7, side1: 4 },
  players: new Map([
    [localUserAccountId, { accountId: localUserAccountId, entityId: 10, rosterSide: 0, name: 'Naidru' }],
    ['enemy-1', { accountId: 'enemy-1', entityId: 20, rosterSide: 1, name: 'Enemy1' }],
  ]),
  killFeed: [],
  roundsByNumber: new Map([
    [1, {
      round: 1,
      kills: [
        { attackerId: 10, attackerSide: 0, victimId: 20, victimSide: 1, damageSource: 1, tick: 100 }
      ],
      damage: [
        { attackerId: 10, attackerSide: 0, victimId: 20, victimSide: 1, damage: 100, damageSource: 1, tick: 100 }
      ],
      teamBlocks: {
        0: { roundWins: 1, outcomeCode: 1, members: [{ entityId: 10, name: 'Naidru', accountId: localUserAccountId }] },
        1: { roundWins: 0, outcomeCode: 2, members: [{ entityId: 20, name: 'Enemy1', accountId: 'enemy-1' }] },
      }
    }]
  ])
};

const recordedPlayer = recordCompletedMatch(playerMatch, {
  rankedArchive,
  otherArchive,
  computeMatchStats,
  roundRoleByRosterSide,
  mapTracker,
  accountId: localUserAccountId,
});
assert.strictEqual(recordedPlayer, true, 'Player match should record');

const baselineLifetime = rankedArchive.getLifetimeStats();
assert.strictEqual(baselineLifetime.matchesRecorded, 1);
assert.strictEqual(baselineLifetime.totalKills, 1);
assert.strictEqual(baselineLifetime.wins, 1);
assert.strictEqual(baselineLifetime.losses, 0);
assert.strictEqual(baselineLifetime.winRate, 100);
assert.strictEqual(baselineLifetime.bestWinStreak, 1);
console.log('✓ Baseline player match recorded with 1 kill, 1 win');

// 2. Now record a spectated match where Naidru is on Team 2 (or not on 0 or 1)
const spectatedMatch = {
  status: 'complete',
  liveMatchId: 'match-spec-1',
  endMatchId: 'match-spec-1',
  is2v2: false,
  team0Name: 'Team Alpha',
  team1Name: 'Team Bravo',
  finalScore: { side0: 7, side1: 5 },
  players: new Map([
    [localUserAccountId, { accountId: localUserAccountId, entityId: 99, rosterSide: 2, name: 'Naidru' }],
    ['player-a1', { accountId: 'player-a1', entityId: 101, rosterSide: 0, name: 'AlphaOne' }],
    ['player-b1', { accountId: 'player-b1', entityId: 201, rosterSide: 1, name: 'BravoOne' }],
  ]),
  killFeed: [
    { tick: 200, killerName: 'AlphaOne', victimName: 'BravoOne', verb: 'Killed', isEnvironmentKill: false }
  ],
  roundsByNumber: new Map([
    [1, {
      round: 1,
      kills: [
        { attackerId: 101, attackerSide: 0, victimId: 201, victimSide: 1, damageSource: 5, tick: 200 }
      ],
      damage: [
        { attackerId: 101, attackerSide: 0, victimId: 201, victimSide: 1, damage: 100, damageSource: 5, tick: 200 }
      ],
      teamBlocks: {
        0: { roundWins: 1, outcomeCode: 1, members: [{ entityId: 101, name: 'AlphaOne', accountId: 'player-a1' }] },
        1: { roundWins: 0, outcomeCode: 2, members: [{ entityId: 201, name: 'BravoOne', accountId: 'player-b1' }] },
      }
    }]
  ])
};

const recordedSpec = recordCompletedMatch(spectatedMatch, {
  rankedArchive,
  otherArchive,
  computeMatchStats,
  roundRoleByRosterSide,
  mapTracker,
  accountId: localUserAccountId,
});
assert.strictEqual(recordedSpec, true, 'Spectated match should record successfully');
console.log('✓ Spectated match successfully recorded');

// 3. Verify spectated match presence and isolation in MatchArchive
const recent = rankedArchive.getRecentMatches(10);
assert.strictEqual(recent.length, 2, 'Recent matches should show both matches');
const specEntry = recent.find((m) => m.matchId === 'match-spec-1');
assert.ok(specEntry, 'Spectated match found in getRecentMatches');
assert.strictEqual(specEntry.isSpectator, true, 'isSpectator flag should be true');
assert.strictEqual(specEntry.won, false, 'won flag should be false for spectator');
assert.strictEqual(specEntry.kills, 0, 'spectator kills should be 0');
assert.ok(specEntry.tags.includes('Spectated'), 'tags should include Spectated');
console.log('✓ Spectated match in getRecentMatches has isSpectator: true, tags, won: false');

// 4. Verify full match retrieval (detail view data)
const fullMatch = rankedArchive.getMatch('match-spec-1');
assert.ok(fullMatch, 'getMatch retrieves full spectated match');
assert.strictEqual(fullMatch.teams[0].length, 1, 'Team 0 has 1 player');
assert.strictEqual(fullMatch.teams[1].length, 1, 'Team 1 has 1 player');
assert.strictEqual(fullMatch.localAccountId, null, 'localAccountId is null for spectator');
console.log('✓ Full spectated match detail contains complete 2-team scoreboard and null localAccountId');

// 5. Verify personal stats isolation
const postLifetime = rankedArchive.getLifetimeStats();
assert.strictEqual(postLifetime.matchesRecorded, 1, 'Career matchesRecorded should remain 1 (ignoring spectator match)');
assert.strictEqual(postLifetime.totalKills, 1, 'Career kills should remain 1');
assert.strictEqual(postLifetime.wins, 1, 'Career wins should remain 1');
assert.strictEqual(postLifetime.losses, 0, 'Career losses should remain 0');
assert.strictEqual(postLifetime.winRate, 100, 'Career winRate should remain 100%');
assert.strictEqual(postLifetime.bestWinStreak, 1, 'Career win streak should remain 1');
assert.strictEqual(postLifetime.killsPerMatch, 1, 'Kills per match should remain 1');
console.log('✓ getLifetimeStats() and _streaks() are 100% isolated from spectated match');

// 6. Verify weapons isolation
const weapons = rankedArchive.getWeaponStats();
const weapon5 = weapons.find((w) => w.damageSource === 5);
assert.strictEqual(weapon5.kills, 0, 'Weapon 5 (used by AlphaOne in spectated match) should have 0 kills for local user');
const trend = rankedArchive.getRecentKillsTrend(10);
assert.deepStrictEqual(trend, [1], 'Kills trend sparkline ignores spectated match');
console.log('✓ getWeaponStats() and getRecentKillsTrend() ignore spectated match');

// 7. Verify Played With isolation
const playedWith = rankedArchive.getPlayedWithStats();
assert.strictEqual(playedWith.length, 1, 'Played with only contains enemy-1 from player match');
assert.strictEqual(playedWith[0].accountId, 'enemy-1');
assert.strictEqual(playedWith.find((p) => p.accountId === 'player-a1'), undefined, 'AlphaOne not in playedWith');
console.log('✓ getPlayedWithStats() ignores players from spectated matches');

// 8. Verify isLegacyMatch
assert.strictEqual(rankedArchive.isLegacyMatch('match-spec-1'), false, 'Spectated match is not legacy match');
console.log('✓ isLegacyMatch returns false for spectated match');

// 9. Verify CSV Export
const csv = rankedArchive.exportCsv();
assert.ok(csv.includes('SPEC,7,5'), 'CSV export includes SPEC result for spectated match');
console.log('✓ exportCsv includes SPEC row for spectated match');

// Cleanup
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {}

console.log('=== All spectator match tests passed successfully! ===');
