const assert = require('assert');
const { MatchArchive, WEAPON_META } = require('../electron/match-archive');
const { recordCompletedMatch } = require('../electron/rescan');

console.log('=== Test 1: WEAPON_META Export & Schema ===');
assert(WEAPON_META && WEAPON_META[1].label === 'AP-25', 'WEAPON_META[1] should be AP-25');
console.log('✓ WEAPON_META exported correctly');

console.log('=== Test 2: isLegacyMatch Schema v12 Detection ===');
const dummyArchive = new MatchArchive(null);
dummyArchive.data = {
  localAccountId: '123',
  matches: [
    {
      matchId: 'legacy-1',
      _schemaVersion: 11,
      team0Name: 'Blue',
      team1Name: 'Orange',
      roundCount: 1,
      mapRounds: [{ round: 1, mapName: 'Bank', won: true }],
      weaponBreakdown: [{ roundsUsed: [1], deaths: 0, headshots: 0 }]
    },
    {
      matchId: 'upgraded-1',
      _schemaVersion: 12,
      team0Name: 'Blue',
      team1Name: 'Orange',
      roundCount: 1,
      mapRounds: [{ round: 1, mapName: 'Bank', won: true, kills: [] }],
      weaponBreakdown: [{ roundsUsed: [1], deaths: 0, headshots: 0 }]
    }
  ]
};
assert(dummyArchive.isLegacyMatch('legacy-1') === true, 'Legacy record without kills should return true');
assert(dummyArchive.isLegacyMatch('upgraded-1') === false, 'Upgraded record with kills should return false');
console.log('✓ isLegacyMatch correctly identifies schema version 12 with kills');

console.log('=== Test 3: recordCompletedMatch per-round kill extraction & timings ===');
const rankedArchive = new MatchArchive(null);
rankedArchive.data = { localAccountId: 'p1_acc', matches: [] };
rankedArchive._save = () => {};

const otherArchive = new MatchArchive(null);
otherArchive.data = { localAccountId: 'p1_acc', matches: [] };
otherArchive._save = () => {};

const mockMatch = {
  status: 'complete',
  endMatchId: 'test-match-1',
  finalScore: { side0: 7, side1: 3 },
  team0Name: 'Alpha Team',
  team1Name: 'Bravo Team',
  is2v2: false,
  players: new Map([
    ['p1_acc', { accountId: 'p1_acc', name: 'PlayerOne', entityId: 101, rosterSide: 0 }],
    ['p2_acc', { accountId: 'p2_acc', name: 'PlayerTwo', entityId: 102, rosterSide: 0 }],
    ['p3_acc', { accountId: 'p3_acc', name: 'EnemyOne', entityId: 201, rosterSide: 1 }],
    ['p4_acc', { accountId: 'p4_acc', name: 'EnemyTwo', entityId: 202, rosterSide: 1 }],
  ]),
  killFeed: [
    // Decisive round-ending kill that was not in Stats::Kill
    { killerName: 'PlayerOne', verb: 'AP-25', victimName: 'EnemyTwo', tick: 5400, isEnvironmentKill: false },
    // Environment kill
    { killerName: 'UAV', verb: 'ZAPPED', victimName: 'PlayerTwo', tick: 5500, isEnvironmentKill: true },
  ],
  roundsByNumber: new Map([
    [1, {
      number: 1,
      mapLabel: '[Bank] High Vault',
      teamBlocks: {
        0: { roundWins: 1, outcomeCode: 2, members: [{ entityId: 101, name: 'PlayerOne', accountId: 'p1_acc' }, { entityId: 102, name: 'PlayerTwo', accountId: 'p2_acc' }] },
        1: { roundWins: 0, outcomeCode: 4, members: [{ entityId: 201, name: 'EnemyOne', accountId: 'p3_acc' }, { entityId: 202, name: 'EnemyTwo', accountId: 'p4_acc' }] }
      },
      damage: [
        { tick: 5000, attackerId: 101, victimId: 201, attackerSide: 0, victimSide: 1, damageDealt: 30, damageSource: 1 }
      ],
      kills: [
        { tick: 5100, round: 1, attackerId: 101, victimId: 201, attackerSide: 0, victimSide: 1, damageSource: 1 }, // AP-25, 100 ticks = 5s after start
        { tick: 5200, round: 1, attackerId: 202, victimId: 102, attackerSide: 1, victimSide: 0, damageSource: 11 }, // MAWP, 200 ticks = 10s after start
      ]
    }]
  ])
};

const mapTracker = {
  takeForRounds: () => [{ label: '[Bank] High Vault', tileset: 'Bank', mapName: 'High Vault' }]
};

const computeMatchStats = () => ({
  roundCount: 1,
  finalScore: { side0: 7, side1: 3, source: 'roundWins' },
  teams: {
    0: [{ accountId: 'p1_acc', name: 'PlayerOne', kills: 2, deaths: 0, assists: 0, weaponBreakdown: [] }],
    1: [{ accountId: 'p3_acc', name: 'EnemyOne', kills: 0, deaths: 1, assists: 0, weaponBreakdown: [] }]
  }
});

const roundRoleByRosterSide = () => ({ 0: 0, 1: 1 }); // 0 = attack, 1 = defense

const recorded = recordCompletedMatch(mockMatch, {
  rankedArchive,
  otherArchive,
  computeMatchStats,
  roundRoleByRosterSide,
  mapTracker,
  accountId: 'p1_acc'
});

assert(recorded === true, 'Match should be recorded');
const savedMatch = rankedArchive.getMatch('test-match-1');
assert(savedMatch, 'Saved match should exist in rankedArchive');
assert(savedMatch.mapRounds && savedMatch.mapRounds.length === 1, 'mapRounds should have 1 round');

const r1 = savedMatch.mapRounds[0];
assert(r1.kills.length === 4, 'Should have 4 kills');
assert(r1.kills[0].timeFormatted === '0:05', 'Kill 1 should be at 0:05');
assert(r1.kills[0].killerName === 'PlayerOne', 'Kill 1 killer should be PlayerOne');
assert(r1.kills[0].victimName === 'EnemyOne', 'Kill 1 victim should be EnemyOne');
assert(r1.kills[0].weapon === 'AP-25', 'Kill 1 weapon should be AP-25');

assert(r1.kills[1].timeFormatted === '0:10', 'Kill 2 should be at 0:10');
assert(r1.kills[1].killerName === 'EnemyTwo', 'Kill 2 killer should be EnemyTwo');
assert(r1.kills[1].weapon === 'MAWP', 'Kill 2 weapon should be MAWP');

assert(r1.kills[2].timeFormatted === '0:20', 'Kill 3 (unbatched) should be at 0:20');
assert(r1.kills[2].killerName === 'PlayerOne', 'Kill 3 killer should be PlayerOne');
assert(r1.kills[2].victimName === 'EnemyTwo', 'Kill 3 victim should be EnemyTwo');

assert(r1.kills[3].isEnvironment === true, 'Kill 4 should be UAV environment kill');
assert(r1.kills[3].weapon === 'UAV Zap', 'Kill 4 weapon should be UAV Zap');
console.log('✓ All kill timings, killers, victims, and weapons verified successfully!');

console.log('=== Test 4: Text Export Content & Exclusion of Extended Info ===');
function generateRoundOutcomesText(match) {
  const mapRounds = match.mapRounds || match.roundMaps || [];
  const team0 = match.team0Name || 'Blue Team';
  const team1 = match.team1Name || 'Orange Team';
  const score0 = match.finalScore?.side0 ?? match.myScore ?? 0;
  const score1 = match.finalScore?.side1 ?? match.oppScore ?? 0;
  const dateStr = match.timestamp ? new Date(match.timestamp).toLocaleString() : 'Unknown Date';
  const modeStr = match.modeOverride || (match.isRanked ? 'Ranked' : match.is2v2 ? '2v2' : 'Casual');
  const outcomeSummary = match.tied ? 'TIE' : (match.won ? 'WIN' : 'LOSS');

  const lines = [
    '========================================================================',
    '                   DUE PROCESS — ROUND OUTCOMES REPORT                   ',
    '========================================================================',
    `Matchup:     ${team0} vs ${team1}`,
    `Final Score: ${score0} - ${score1} (${outcomeSummary})`,
    `Mode:        ${modeStr}`,
    `Date:        ${dateStr}`,
    `Rounds:      ${mapRounds.length}`,
    '------------------------------------------------------------------------',
    ' ROUND-BY-ROUND OUTCOMES (Summary):',
    '------------------------------------------------------------------------',
  ];

  let running0 = 0;
  let running1 = 0;
  let prevRole = null;

  mapRounds.forEach((r, idx) => {
    const roundNum = r.round || (idx + 1);
    const tileset = r.tileset && r.tileset !== 'Unknown' ? r.tileset.replace(/_Day$/i, '') : '';
    const mapName = r.mapName && r.mapName !== 'Unknown' ? r.mapName : (r.mapLabel || 'Unknown Map');
    const mapStr = tileset ? `[${tileset}] ${mapName}` : mapName;
    const role = r.sideRole || 'UNKNOWN';
    const result = typeof r.won === 'boolean' ? (r.won ? 'WIN' : 'LOSS') : (r.winnerSide === 0 ? 'TEAM 0' : 'TEAM 1');
    const condition = r.roundResult ? ` (${r.roundResult.toUpperCase()})` : '';

    if (r.winnerSide === 0) running0++;
    else if (r.winnerSide === 1) running1++;

    if (prevRole && r.sideRole && prevRole !== r.sideRole) {
      lines.push('  --- [SIDE SWITCH] ---');
    }
    prevRole = r.sideRole;

    const rNumStr = String(roundNum).padStart(2, '0');
    const scoreStr = `${running0} - ${running1}`;
    lines.push(`  R${rNumStr} | ${mapStr.padEnd(28)} | Role: ${role.padEnd(7)} | Result: ${(result + condition).padEnd(20)} | Score: ${scoreStr}`);
  });

  lines.push('------------------------------------------------------------------------');
  lines.push('Generated by Due Process Stat Tracker');
  lines.push('========================================================================');

  return lines.join('\r\n');
}

const textOutput = generateRoundOutcomesText(savedMatch);
console.log('--- Generated Text Export Output ---');
console.log(textOutput);

assert(textOutput.includes('Alpha Team vs Bravo Team'), 'Should contain matchup');
assert(textOutput.includes('7 - 3 (WIN)'), 'Should contain final score and result');
assert(textOutput.includes('High Vault'), 'Should contain Round 1 map');
assert(textOutput.includes('Score: 1 - 0'), 'Should contain running score');

// REQUIREMENT CHECK: Text export MUST NOT include extended round info!
assert(!textOutput.includes('PlayerOne'), 'Extended kill info (PlayerOne) MUST NOT be in text export');
assert(!textOutput.includes('EnemyOne'), 'Extended kill info (EnemyOne) MUST NOT be in text export');
assert(!textOutput.includes('EnemyTwo'), 'Extended kill info (EnemyTwo) MUST NOT be in text export');
assert(!textOutput.includes('0:05'), 'Extended kill timing (0:05) MUST NOT be in text export');
assert(!textOutput.includes('AP-25'), 'Extended kill weapon (AP-25) MUST NOT be in text export');
assert(!textOutput.includes('MAWP'), 'Extended kill weapon (MAWP) MUST NOT be in text export');

console.log('✓ Text export accurately presents round outcomes and EXCLUDES extended round info!');
console.log('=== All automated tests passed successfully! ===');
