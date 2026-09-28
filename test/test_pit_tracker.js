const assert = require('assert');
const { MatchArchive, getGlobalPitStats } = require('../electron/match-archive');
const { recordCompletedMatch } = require('../electron/rescan');

async function runTests() {
  console.log('=== Test 1: Parser detection of PIT / ROASTED hazard kills ===');
  const parserModule = await import('../parser.js');
  const { DueProcessLogParser } = parserModule;

  const parser = new DueProcessLogParser();
  const sampleLog = [
    'VivoxChat:: joining match channel test-match-pit',
    'Levels:: Loading game level and background ,[Killhouse_Day] Pit Test [12345] (),killhouse_day level set killhouse_day',
    'Latest client data with skip for 10: 1000, previous tick 950 0',
    'KillLogUI :: Entry :: <color=#FF083AEB><noparse>PIT</noparse></color> ROASTED <color=#27DBFFFF><noparse>UnluckyVictim</noparse></color> @ 1500',
    'KillLogUI :: Entry :: <color=#FF083AEB><noparse>pit</noparse></color> roasted <color=#27DBFFFF><noparse>SecondVictim</noparse></color> @ 1600',
    'KillLogUI :: Entry :: <color=#FF083AEB><noparse>UAV</noparse></color> ZAPPED <color=#27DBFFFF><noparse>ThirdVictim</noparse></color> @ 1700',
    'KillLogUI :: Entry :: <color=#27DBFFFF><noparse>Shooter</noparse></color> KILLED <color=#FF083AEB><noparse>FourthVictim</noparse></color> @ 1800',
  ];

  parser.feedText(sampleLog.join('\n'));
  parser.end();

  const feed = parser.current.killFeed;
  assert.strictEqual(feed.length, 4, 'Should parse 4 kill feed entries');

  const pitEntry1 = feed[0];
  assert.strictEqual(pitEntry1.killerName, 'PIT');
  assert.strictEqual(pitEntry1.verb, 'ROASTED');
  assert.strictEqual(pitEntry1.victimName, 'UnluckyVictim');
  assert.strictEqual(pitEntry1.isEnvironmentKill, true, 'PIT should be marked as environment kill');
  assert.strictEqual(pitEntry1.isPitDeath, true, 'PIT should be marked as pit death');

  const pitEntry2 = feed[1];
  assert.strictEqual(pitEntry2.isEnvironmentKill, true, 'Lower-case pit roasted should be environment kill');
  assert.strictEqual(pitEntry2.isPitDeath, true, 'Lower-case pit roasted should be pit death');

  const uavEntry = feed[2];
  assert.strictEqual(uavEntry.isEnvironmentKill, true, 'UAV should be environment kill');
  assert.strictEqual(Boolean(uavEntry.isPitDeath), false, 'UAV should NOT be pit death');

  const normalEntry = feed[3];
  assert.strictEqual(Boolean(normalEntry.isEnvironmentKill), false, 'Player kill should not be environment kill');
  assert.strictEqual(Boolean(normalEntry.isPitDeath), false, 'Player kill should not be pit death');

  console.log('✓ Parser accurately identified Pit and UAV environmental hazard entries');

  console.log('=== Test 2: recordCompletedMatch Pit attribution & round kill tracking ===');
  const rankedArchive = new MatchArchive(null);
  rankedArchive.data = { localAccountId: 'acc_local', matches: [] };
  rankedArchive._save = () => {};

  const otherArchive = new MatchArchive(null);
  otherArchive.data = { localAccountId: 'acc_local', matches: [] };
  otherArchive._save = () => {};

  const mockMatch = {
    status: 'complete',
    endMatchId: 'pit-test-match-1',
    finalScore: { side0: 7, side1: 3 },
    team0Name: 'Alpha Team',
    team1Name: 'Bravo Team',
    is2v2: false,
    players: new Map([
      ['acc_local', { accountId: 'acc_local', name: 'LocalHero', entityId: 101, rosterSide: 0 }],
      ['acc_teammate', { accountId: 'acc_teammate', name: 'Friendly', entityId: 102, rosterSide: 0 }],
      ['acc_enemy1', { accountId: 'acc_enemy1', name: 'EnemyOne', entityId: 201, rosterSide: 1 }],
      ['acc_enemy2', { accountId: 'acc_enemy2', name: 'EnemyTwo', entityId: 202, rosterSide: 1 }],
    ]),
    killFeed: [
      {
        killerName: 'LocalHero',
        verb: 'KILLED',
        victimName: 'EnemyOne',
        tick: 1400,
        isEnvironmentKill: false,
        isPitDeath: false,
      },
      {
        killerName: 'PIT',
        verb: 'ROASTED',
        victimName: 'EnemyTwo',
        tick: 1600,
        isEnvironmentKill: true,
        isPitDeath: true,
      },
    ],
    actionStartTicks: [1000],
    roundsByNumber: new Map([
      [1, {
        number: 1,
        mapLabel: '[Killhouse_Day] Pit Arena',
        teamBlocks: {
          0: { roundWins: 1, outcomeCode: 1, members: [{ entityId: 101, name: 'LocalHero', accountId: 'acc_local' }, { entityId: 102, name: 'Friendly', accountId: 'acc_teammate' }] },
          1: { roundWins: 0, outcomeCode: 5, members: [{ entityId: 201, name: 'EnemyOne', accountId: 'acc_enemy1' }, { entityId: 202, name: 'EnemyTwo', accountId: 'acc_enemy2' }] }
        },
        damage: [
          { tick: 1400, attackerId: 101, victimId: 201, attackerSide: 0, victimSide: 1, damageDealt: 100, damageSource: 1 }
        ],
        kills: [
          { tick: 1400, round: 1, attackerId: 101, victimId: 201, attackerSide: 0, victimSide: 1, damageSource: 1 }
        ]
      }]
    ]),
  };

  const mapTracker = {
    takeForRounds: () => [{ label: '[Killhouse_Day] Pit Arena', tileset: 'killhouse_day', mapName: 'Pit Arena' }]
  };

  const computeMatchStats = () => ({
    roundCount: 1,
    finalScore: { side0: 7, side1: 3, source: 'roundWins' },
    teams: {
      0: [{ accountId: 'acc_local', name: 'LocalHero', kills: 1, deaths: 0, assists: 0, weaponBreakdown: [] }],
      1: [{ accountId: 'acc_enemy1', name: 'EnemyOne', kills: 0, deaths: 1, assists: 0, weaponBreakdown: [] }]
    }
  });

  const recorded = recordCompletedMatch(mockMatch, {
    rankedArchive,
    otherArchive,
    computeMatchStats,
    roundRoleByRosterSide: () => ({ 0: 0, 1: 1 }),
    mapTracker,
    accountId: 'acc_local'
  });

  assert.strictEqual(rankedArchive.data.matches.length, 1, 'Match should be recorded');
  const savedMatch = rankedArchive.data.matches[0];
  const round1 = savedMatch.mapRounds[0];
  assert.strictEqual(round1.kills.length, 2, 'Round should have 2 kills recorded (1 gun, 1 pit)');

  const gunKill = round1.kills[0];
  assert.strictEqual(gunKill.killerName, 'LocalHero');
  assert.strictEqual(gunKill.weapon, 'AP-25');
  assert.strictEqual(Boolean(gunKill.isPit), false);

  const pitKill = round1.kills[1];
  assert.strictEqual(pitKill.killerName, 'PIT');
  assert.strictEqual(pitKill.victimName, 'EnemyTwo');
  assert.strictEqual(pitKill.weapon, 'Pit');
  assert.strictEqual(pitKill.isEnvironment, true);
  assert.strictEqual(pitKill.isPit, true);

  console.log('✓ recordCompletedMatch correctly recorded Pit hazard kill in round kills timeline');

  console.log('=== Test 3: MatchArchive.prototype.getPitStats ===');
  // Add a second match with a self-death to the pit and repeated enemy death
  const mockMatch2 = {
    matchId: 'pit-test-match-2',
    timestamp: Date.now() - 10000,
    isRanked: true,
    mapLabel: 'Killhouse_Day',
    teams: [
      [{ accountId: 'acc_local', name: 'LocalHero' }],
      [{ accountId: 'acc_enemy2', name: 'EnemyTwo' }],
    ],
    mapRounds: [
      {
        round: 1,
        mapLabel: 'Pit Arena',
        mapName: 'Killhouse_Day',
        tileset: 'killhouse_day',
        kills: [
          {
            killerName: 'PIT',
            victimName: 'LocalHero',
            victimSide: 0,
            weapon: 'Pit',
            isPit: true,
            isEnvironment: true,
            seconds: 45,
            timeFormatted: '0:45',
          },
          {
            killerName: 'PIT',
            victimName: 'EnemyTwo',
            victimSide: 1,
            weapon: 'Pit',
            isPit: true,
            isEnvironment: true,
            seconds: 60,
            timeFormatted: '1:00',
          },
        ],
      },
    ],
  };
  rankedArchive.data.matches.push(mockMatch2);

  const stats = rankedArchive.getPitStats('LocalHero');
  assert.strictEqual(stats.totalDeaths, 3, 'Should have 3 total Pit deaths (1 in match 1, 2 in match 2)');
  assert.strictEqual(stats.selfDeaths, 1, 'LocalHero should have 1 self death');
  assert.strictEqual(stats.otherDeaths, 2, 'Others should have 2 deaths');
  assert.strictEqual(stats.topVictim.name, 'EnemyTwo', 'EnemyTwo died twice, should be top victim');
  assert.strictEqual(stats.topVictim.count, 2, 'EnemyTwo count should be 2');
  assert.strictEqual(stats.claims.length, 3, 'Should list 3 claims');
  assert.strictEqual(stats.claims[0].victimName, 'EnemyTwo');

  console.log('✓ MatchArchive.prototype.getPitStats properly aggregates Pit stats and leaderboards');

  console.log('=== Test 4: getGlobalPitStats multi-archive aggregation ===');
  // Create an Other/Casual match with a Pit death
  const mockOtherMatch = {
    matchId: 'pit-casual-match-1',
    timestamp: Date.now(),
    isRanked: false,
    mapLabel: 'Factory',
    teams: [
      [{ accountId: 'acc_local', name: 'LocalHero' }],
      [{ accountId: 'acc_enemy3', name: 'EnemyThree' }],
    ],
    mapRounds: [
      {
        round: 1,
        mapLabel: 'Furnace',
        mapName: 'Factory',
        tileset: 'factory',
        kills: [
          {
            killerName: 'PIT',
            victimName: 'EnemyThree',
            victimSide: 1,
            weapon: 'Pit',
            isPit: true,
            isEnvironment: true,
            seconds: 30,
            timeFormatted: '0:30',
          },
        ],
      },
    ],
  };
  otherArchive.data.matches.push(mockOtherMatch);

  const globalStats = getGlobalPitStats(rankedArchive, otherArchive, 'LocalHero');
  assert.strictEqual(globalStats.totalDeaths, 4, 'Global should have 4 Pit deaths across ranked + casual');
  assert.strictEqual(globalStats.selfDeaths, 1, 'Global self deaths should be 1');
  assert.strictEqual(globalStats.otherDeaths, 3, 'Global other deaths should be 3');
  assert.strictEqual(globalStats.rankedTotal, 3, 'Ranked total should be 3');
  assert.strictEqual(globalStats.otherTotal, 1, 'Other total should be 1');
  assert.strictEqual(globalStats.topVictim.name, 'EnemyTwo');
  assert.strictEqual(globalStats.topVictim.count, 2);
  assert.strictEqual(globalStats.victims.length, 3, 'Victims should be EnemyTwo (2), EnemyThree (1), LocalHero (1)');
  assert.strictEqual(globalStats.claims.length, 4, 'Global claims list should have 4 records');

  console.log('✓ getGlobalPitStats accurately merged stats across ranked and other archives');
  console.log('=== All Pit Tracker tests passed successfully! ===');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
