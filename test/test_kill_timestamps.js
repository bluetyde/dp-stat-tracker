const assert = require('assert');
const { MatchArchive } = require('../electron/match-archive');
const { recordCompletedMatch } = require('../electron/rescan');

async function runTests() {
  console.log('=== Test 1: Parser actionStartTick extraction from log stream ===');
  const parserModule = await import('../parser.js');
  const { DueProcessLogParser } = parserModule;

  const parser = new DueProcessLogParser();
  const sampleLog = [
    'VivoxChat:: joining match channel test-match-timing',
    'Levels:: Loading game level and background ,[Killhouse_Day] Test Map [12345] (),killhouse_day level set killhouse_day',
    // Planning phase skips and drawing
    'Latest client data with skip for 10: 1000, previous tick 950 0',
    'Adding draw head item input event',
    'Latest client data with skip for 10: 1200, previous tick 1000 0',
    // Action phase begins with lock break
    'Latest client data with skip for 10: 2000, previous tick 1200 0',
    "Couldn't find particle pool for DES_LockBreak",
    // Combat begins 20 seconds later (400 ticks later: 2400)
    'KillLogUI :: Entry :: <color=#27DBFFFF><noparse>KillerPlayer</noparse></color> WASTED <color=#FF083AEB><noparse>VictimPlayer</noparse></color> @ 2400',
    // Round ends with stats flush
    'Stats :: Damage :: {"round":1,"tick":2400,"attackerId":10,"attackerSide":0,"victimId":20,"victimSide":1,"damageSource":1,"damageDealt":100.0}',
    'Stats :: Kill :: {"round":1,"tick":2400,"attackerId":10,"attackerSide":0,"victimId":20,"victimSide":1,"damageSource":1}',
    'Stats :: Team 0 :: {"Side":0,"KillScore":1,"RoundWins":1,"RoundOutcomes":[1],"Members":[{"ConnectionId":1,"UserId":0,"EntityId":10,"Name":"KillerPlayer","AccountId":"p1"}]}',
    'Stats :: Team 1 :: {"Side":1,"KillScore":0,"RoundWins":0,"RoundOutcomes":[5],"Members":[{"ConnectionId":2,"UserId":0,"EntityId":20,"Name":"VictimPlayer","AccountId":"p2"}]}',
    // Round 2 begins: tests GSM transition without lock break (like Bank)
    'Levels:: Loading game level and background ,[Bank] Test Bank [67890] (),bank level set bank',
    'Latest client data with skip for 10: 3000, previous tick 2400 0',
    'Merging gsms with different tickstamps, are you sure about this?',
    'Latest client data with skip for 10: 4000, previous tick 3000 0',
    // Combat 30 seconds later (600 ticks: 4600)
    'KillLogUI :: Entry :: <color=#27DBFFFF><noparse>KillerPlayer</noparse></color> WASTED <color=#FF083AEB><noparse>VictimPlayer</noparse></color> @ 4600',
    'Stats :: Kill :: {"round":2,"tick":4600,"attackerId":10,"attackerSide":0,"victimId":20,"victimSide":1,"damageSource":2}',
    'Stats :: Team 0 :: {"Side":0,"KillScore":2,"RoundWins":2,"RoundOutcomes":[1,1],"Members":[{"ConnectionId":1,"UserId":0,"EntityId":10,"Name":"KillerPlayer","AccountId":"p1"}]}',
    'Stats :: Team 1 :: {"Side":1,"KillScore":0,"RoundWins":0,"RoundOutcomes":[5,5],"Members":[{"ConnectionId":2,"UserId":0,"EntityId":20,"Name":"VictimPlayer","AccountId":"p2"}]}',
    '{"type":"matchEnded","data":"{\\"MatchId\\":\\"test-match-timing\\",\\"Team1Squads\\":[],\\"Team2Squads\\":[]}"}'
  ].join('\n');

  parser.feedText(sampleLog);
  parser.end();

  const matches = parser.getMatches();
  assert.strictEqual(matches.length, 1, 'Should have 1 completed match');
  const m = matches[0];

  const r1 = m.roundsByNumber.get(1);
  assert(r1, 'Round 1 should exist');
  assert.strictEqual(r1.actionStartTick, 2000, 'Round 1 action start should be 2000 via LockBreak');

  const r2 = m.roundsByNumber.get(2);
  assert(r2, 'Round 2 should exist');
  assert.strictEqual(r2.actionStartTick, 4000, 'Round 2 action start should be 4000 via GSM');
  console.log('✓ Parser accurately detected action start ticks from both LockBreak and GSM transitions');

  console.log('=== Test 2: recordCompletedMatch uses actionStartTick and avoids 0s kill timestamps ===');
  const rankedArchive = new MatchArchive(null);
  rankedArchive.data = { localAccountId: 'p1', matches: [] };
  rankedArchive._save = () => {};
  const otherArchive = new MatchArchive(null);
  otherArchive.data = { localAccountId: 'p1', matches: [] };
  otherArchive._save = () => {};

  const computeMatchStats = () => ({
    roundCount: 2,
    finalScore: { side0: 2, side1: 0, source: 'roundWins' },
    teams: {
      0: [{ accountId: 'p1', name: 'KillerPlayer', kills: 2, deaths: 0, assists: 0, weaponBreakdown: [] }],
      1: [{ accountId: 'p2', name: 'VictimPlayer', kills: 0, deaths: 2, assists: 0, weaponBreakdown: [] }]
    }
  });

  const mapTracker = {
    takeForRounds: () => [
      { label: '[Killhouse_Day] Test Map', tileset: 'Killhouse_Day', mapName: 'Test Map' },
      { label: '[Bank] Test Bank', tileset: 'Bank', mapName: 'Test Bank' }
    ]
  };

  const recorded = recordCompletedMatch(m, {
    rankedArchive,
    otherArchive,
    computeMatchStats,
    roundRoleByRosterSide: () => ({ 0: 0, 1: 1 }),
    mapTracker,
    accountId: 'p1'
  });

  assert.strictEqual(recorded, true, 'Match should be recorded');
  const saved = otherArchive.getMatch('test-match-timing');
  assert(saved, 'Saved match should be in otherArchive');
  assert.strictEqual(saved.mapRounds.length, 2, 'Should have 2 map rounds');

  // Round 1: actionStart = 2000, kill at 2400 (400 ticks / 20 = 20s -> 0:20)
  const round1Kills = saved.mapRounds[0].kills;
  assert.strictEqual(round1Kills.length, 1, 'Round 1 should have 1 kill');
  assert.strictEqual(round1Kills[0].seconds, 20, 'Round 1 kill seconds should be 20');
  assert.strictEqual(round1Kills[0].timeFormatted, '0:20', 'Round 1 kill timeFormatted should be 0:20 (not 0:00!)');

  // Round 2: actionStart = 4000, kill at 4600 (600 ticks / 20 = 30s -> 0:30)
  const round2Kills = saved.mapRounds[1].kills;
  assert.strictEqual(round2Kills.length, 1, 'Round 2 should have 1 kill');
  assert.strictEqual(round2Kills[0].seconds, 30, 'Round 2 kill seconds should be 30');
  assert.strictEqual(round2Kills[0].timeFormatted, '0:30', 'Round 2 kill timeFormatted should be 0:30 (not 0:00!)');
  console.log('✓ Kill timestamps accurately reflect elapsed action time (0:20 and 0:30) instead of 0:00');

  console.log('=== Test 3: isLegacyMatch detects and flags matches with 0s kills at tick > 1000 ===');
  const testArchive = new MatchArchive(null);
  testArchive.data = {
    localAccountId: 'p1',
    matches: [
      {
        matchId: 'clean-match',
        _schemaVersion: 12,
        team0Name: 'A',
        team1Name: 'B',
        roundCount: 1,
        mapRounds: [{ round: 1, mapName: 'Bank', kills: [{ tick: 2400, seconds: 20, timeFormatted: '0:20' }] }],
        weaponBreakdown: [{ roundsUsed: [1], deaths: 0, headshots: 0 }]
      },
      {
        matchId: 'buggy-match',
        _schemaVersion: 12,
        team0Name: 'A',
        team1Name: 'B',
        roundCount: 1,
        mapRounds: [{ round: 1, mapName: 'Bank', kills: [{ tick: 2400, seconds: 0, timeFormatted: '0:00' }] }],
        weaponBreakdown: [{ roundsUsed: [1], deaths: 0, headshots: 0 }]
      }
    ]
  };

  assert.strictEqual(testArchive.isLegacyMatch('clean-match'), false, 'Clean match should not be legacy');
  assert.strictEqual(testArchive.isLegacyMatch('buggy-match'), true, 'Buggy match with 0s kill at tick 2400 should be marked legacy');
  console.log('✓ isLegacyMatch correctly detects buggy 0s kill timestamps for automatic upgrade');
  console.log('=== All kill timestamp tests passed successfully! ===');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
