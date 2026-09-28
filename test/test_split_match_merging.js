const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  MatchArchive,
  mergeWeaponBreakdowns,
  mergeTeams,
  mergeMapRounds,
  mergeArchivedMatches,
  cleanupSplitMatches,
  isRankedFinalScore,
} = require('../electron/match-archive');
const { recordCompletedMatch } = require('../electron/rescan');

async function runSplitMatchTests() {
  console.log('=== Test 1: mergeWeaponBreakdowns ===');
  const wb1 = [
    { damageSource: 1, label: 'AP-25', hits: 10, damage: 200, kills: 2, deaths: 1, headshots: 1, roundsUsed: 2, healthPercentScore: 2.0 },
    { damageSource: 4, label: 'Gruber-5', hits: 5, damage: 110, kills: 1, deaths: 0, headshots: 0, roundsUsed: 1, healthPercentScore: 1.0 },
  ];
  const wb2 = [
    { damageSource: 1, label: 'AP-25', hits: 8, damage: 160, kills: 1, deaths: 1, headshots: 1, roundsUsed: 1, healthPercentScore: 1.6 },
    { damageSource: 11, label: 'MAWP', hits: 1, damage: 85, kills: 1, deaths: 0, headshots: 1, roundsUsed: 1, healthPercentScore: 1.0 },
  ];
  const mergedWb = mergeWeaponBreakdowns(wb1, wb2);
  assert.strictEqual(mergedWb.length, 3, 'Should have 3 unique weapons');
  const ap25 = mergedWb.find((w) => w.damageSource === 1);
  assert.strictEqual(ap25.hits, 18);
  assert.strictEqual(ap25.damage, 360);
  assert.strictEqual(ap25.kills, 3);
  assert.strictEqual(ap25.deaths, 2);
  assert.strictEqual(ap25.headshots, 2);
  assert.strictEqual(ap25.roundsUsed, 3);
  console.log('✓ mergeWeaponBreakdowns correctly summed stats');

  console.log('=== Test 2: mergeTeams ===');
  const teams1 = {
    0: [{ accountId: 'p1', name: 'AlphaPlayer', kills: 6, deaths: 5, assists: 2, damage: 600, roundsCounted: 8, kastRounds: 6, weaponBreakdown: wb1 }],
    1: [{ accountId: 'p2', name: 'BravoPlayer', kills: 5, deaths: 6, assists: 1, damage: 500, roundsCounted: 8, kastRounds: 5, weaponBreakdown: [] }],
  };
  const teams2 = {
    0: [{ accountId: 'p1', name: 'AlphaPlayer', kills: 4, deaths: 2, assists: 1, damage: 400, roundsCounted: 4, kastRounds: 4, weaponBreakdown: wb2 }],
    1: [{ accountId: 'p2', name: 'BravoPlayer', kills: 2, deaths: 4, assists: 0, damage: 250, roundsCounted: 4, kastRounds: 2, weaponBreakdown: [] }],
  };
  const mergedTeams = mergeTeams(teams1, teams2);
  const p1 = mergedTeams[0].find((p) => p.accountId === 'p1');
  assert.strictEqual(p1.kills, 10);
  assert.strictEqual(p1.deaths, 7);
  assert.strictEqual(p1.assists, 3);
  assert.strictEqual(p1.damage, 1000);
  assert.strictEqual(p1.roundsCounted, 12);
  assert.strictEqual(p1.kastRounds, 10);
  assert.strictEqual(p1.adr, Number((1000 / 12).toFixed(1)));
  assert.strictEqual(p1.kdr, Number((10 / 7).toFixed(2)));
  console.log('✓ mergeTeams correctly combined player rows and recomputed ADR/KDR');

  console.log('=== Test 3: mergeMapRounds ===');
  const roundsPart1 = [
    { round: 1, mapLabel: '[Dome] Map1', mapName: 'Map1', won: true, kills: [{ killerName: 'p1', victimName: 'p2' }] },
    { round: 2, mapLabel: '[Bank] Map2', mapName: 'Map2', won: false, kills: [] },
  ];
  // Reconnecting session had round numbers 1, 2 due to separate session numbering
  const roundsPart2Offset = [
    { round: 1, mapLabel: '[Factory] Map3', mapName: 'Map3', won: true, kills: [{ killerName: 'p1', victimName: 'p2' }] },
    { round: 2, mapLabel: '[Killhouse] Map4', mapName: 'Map4', won: true, kills: [] },
  ];
  const mergedRounds = mergeMapRounds(roundsPart1, roundsPart2Offset);
  assert.strictEqual(mergedRounds.length, 4, 'Should have 4 contiguous rounds');
  assert.strictEqual(mergedRounds[0].round, 1);
  assert.strictEqual(mergedRounds[1].round, 2);
  assert.strictEqual(mergedRounds[2].round, 3);
  assert.strictEqual(mergedRounds[3].round, 4);
  assert.strictEqual(mergedRounds[2].mapName, 'Map3');
  assert.strictEqual(mergedRounds[3].mapName, 'Map4');
  console.log('✓ mergeMapRounds correctly concatenated and renumbered rounds');

  console.log('=== Test 4: mergeArchivedMatches ===');
  const part1 = {
    matchId: 'crash-match-guid-1',
    timestamp: 1000000,
    inferred: true,
    won: false,
    tied: false,
    is2v2: false,
    isSpectator: false,
    myScore: 4,
    oppScore: 4,
    team0Name: 'Alpha Team',
    team1Name: 'Bravo Team',
    mapLabel: '[Dome] Map1',
    roundCount: 2,
    finalScore: { side0: 4, side1: 4 },
    teams: teams1,
    localAccountId: 'p1',
    kills: 6,
    deaths: 5,
    assists: 2,
    weaponBreakdown: wb1,
    mapRounds: roundsPart1,
    roundMaps: roundsPart1,
    tags: ['Casual'],
  };
  const part2 = {
    matchId: 'crash-match-guid-1',
    timestamp: 1060000,
    inferred: false,
    won: true,
    tied: false,
    is2v2: false,
    isSpectator: false,
    myScore: 7,
    oppScore: 5,
    team0Name: 'Alpha Team',
    team1Name: 'Bravo Team',
    mapLabel: '[Factory] Map3',
    roundCount: 2,
    finalScore: { side0: 7, side1: 5 },
    teams: teams2,
    localAccountId: 'p1',
    kills: 4,
    deaths: 2,
    assists: 1,
    weaponBreakdown: wb2,
    mapRounds: roundsPart2Offset,
    roundMaps: roundsPart2Offset,
    tags: ['Ranked'],
  };
  const fullMerged = mergeArchivedMatches(part1, part2);
  assert.strictEqual(fullMerged.matchId, 'crash-match-guid-1');
  assert.strictEqual(fullMerged.timestamp, 1000000, 'Timestamp should be the earlier start time');
  assert.strictEqual(fullMerged.inferred, false, 'Completed match should remove inferred flag');
  assert.strictEqual(fullMerged.won, true);
  assert.strictEqual(fullMerged.myScore, 7);
  assert.strictEqual(fullMerged.oppScore, 5);
  assert.strictEqual(fullMerged.kills, 10);
  assert.strictEqual(fullMerged.deaths, 7);
  assert.strictEqual(fullMerged.assists, 3);
  assert.strictEqual(fullMerged.roundCount, 4);
  assert(fullMerged.tags.includes('Ranked'));
  assert(!fullMerged.tags.includes('Casual'), 'Should remove Casual tag when final score is Ranked');
  console.log('✓ mergeArchivedMatches created unified complete match record');

  console.log('=== Test 5: cleanupSplitMatches between archives ===');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-split-test-'));
  const rankedArch = new MatchArchive(path.join(tempDir, 'match-archive.json'));
  const otherArch = new MatchArchive(path.join(tempDir, 'other-matches-archive.json'));

  otherArch.recordMatch(part1);
  rankedArch.recordMatch(part2);
  assert(otherArch.hasRecordedMatch('crash-match-guid-1'));
  assert(rankedArch.hasRecordedMatch('crash-match-guid-1'));

  const mergedCount = cleanupSplitMatches(rankedArch, otherArch);
  assert.strictEqual(mergedCount, 1, 'Should merge 1 split match');
  assert.strictEqual(otherArch.hasRecordedMatch('crash-match-guid-1'), false, 'Duplicate in otherArchive must be deleted');
  assert.strictEqual(rankedArch.hasRecordedMatch('crash-match-guid-1'), true, 'Merged match must remain in rankedArchive');
  const savedInRanked = rankedArch.getMatch('crash-match-guid-1');
  assert.strictEqual(savedInRanked.roundCount, 4);
  assert.strictEqual(savedInRanked.kills, 10);
  assert.strictEqual(savedInRanked.inferred, false);
  console.log('✓ cleanupSplitMatches successfully consolidated split match across archives');

  console.log('=== Test 6: recordCompletedMatch merges with existing partial match ===');
  // Suppose part1 is in otherArch (e.g. from crash exit)
  otherArch.recordMatch(part1);
  rankedArch.deleteMatch('crash-match-guid-1');

  const incomingMatch = {
    status: 'complete',
    endMatchId: 'crash-match-guid-1',
    finalScore: { side0: 7, side1: 5 },
    team0Name: 'Alpha Team',
    team1Name: 'Bravo Team',
    players: new Map([
      ['p1', { accountId: 'p1', name: 'AlphaPlayer', rosterSide: 0, entityId: 10 }],
      ['p2', { accountId: 'p2', name: 'BravoPlayer', rosterSide: 1, entityId: 20 }],
    ]),
    roundsByNumber: new Map([
      [3, {
        round: 3,
        kills: [{ attackerId: 10, attackerSide: 0, victimId: 20, victimSide: 1, damageSource: 1, tick: 7000 }],
        damage: [{ attackerId: 10, attackerSide: 0, victimId: 20, victimSide: 1, damageSource: 1, tick: 7000, damage: 100 }],
        teamBlocks: {
          0: { roundWins: 6, outcomeCode: 1, members: [{ entityId: 10, name: 'AlphaPlayer', accountId: 'p1' }] },
          1: { roundWins: 5, outcomeCode: 2, members: [{ entityId: 20, name: 'BravoPlayer', accountId: 'p2' }] },
        },
      }],
      [4, {
        round: 4,
        kills: [{ attackerId: 10, attackerSide: 0, victimId: 20, victimSide: 1, damageSource: 1, tick: 8000 }],
        damage: [{ attackerId: 10, attackerSide: 0, victimId: 20, victimSide: 1, damageSource: 1, tick: 8000, damage: 100 }],
        teamBlocks: {
          0: { roundWins: 7, outcomeCode: 1, members: [{ entityId: 10, name: 'AlphaPlayer', accountId: 'p1' }] },
          1: { roundWins: 5, outcomeCode: 2, members: [{ entityId: 20, name: 'BravoPlayer', accountId: 'p2' }] },
        },
      }],
    ]),
    killFeed: [],
  };

  const computeMatchStatsMock = () => ({
    roundCount: 2,
    finalScore: { side0: 7, side1: 5, source: 'roundWins' },
    teams: {
      0: [{ accountId: 'p1', name: 'AlphaPlayer', kills: 2, deaths: 0, assists: 0, weaponBreakdown: [] }],
      1: [{ accountId: 'p2', name: 'BravoPlayer', kills: 0, deaths: 2, assists: 0, weaponBreakdown: [] }],
    },
  });

  const mapTrackerMock = {
    takeForRounds: () => [
      { label: '[Factory] Map3', tileset: 'Factory', mapName: 'Map3' },
      { label: '[Killhouse] Map4', tileset: 'Killhouse', mapName: 'Map4' },
    ],
  };

  const rec = recordCompletedMatch(incomingMatch, {
    rankedArchive: rankedArch,
    otherArchive: otherArch,
    computeMatchStats: computeMatchStatsMock,
    roundRoleByRosterSide: () => ({ 0: 0, 1: 1 }),
    mapTracker: mapTrackerMock,
    accountId: 'p1',
  });

  assert.strictEqual(rec, true, 'Should record and merge');
  assert.strictEqual(otherArch.hasRecordedMatch('crash-match-guid-1'), false, 'Should be removed from otherArchive');
  assert.strictEqual(rankedArch.hasRecordedMatch('crash-match-guid-1'), true, 'Should be merged into rankedArchive');
  const finalSaved = rankedArch.getMatch('crash-match-guid-1');
  assert.strictEqual(finalSaved.roundCount, 4);
  assert.strictEqual(finalSaved.kills, 8); // 6 from part1 + 2 from incoming
  console.log('✓ recordCompletedMatch seamlessly merged incoming continuation into existing archive');

  // Cleanup temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
  console.log('=== All split match merging tests passed successfully! ===');
}

runSplitMatchTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
