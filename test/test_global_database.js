const assert = require('assert');
const { MatchArchive } = require('../electron/match-archive');
const { buildGlobalPlayerDatabase, generatePortalMarkup } = require('../electron/global-database');
const fs = require('fs');
const path = require('path');

console.log('=== Test 1: buildGlobalPlayerDatabase aggregation ===');

const rankedArchive = new MatchArchive(null);
rankedArchive.data = {
  localAccountId: 'acc_local',
  matches: [
    {
      matchId: 'match-ranked-1',
      timestamp: 1759000000000,
      isRanked: true,
      mapLabel: '[Killhouse_Day] Pit Arena',
      team0Name: 'Alpha Squad',
      team1Name: 'Bravo Squad',
      roundCount: 10,
      finalScore: { side0: 7, side1: 3 },
      teams: [
        [
          {
            accountId: 'acc_local',
            name: 'LocalPlayer',
            kills: 10,
            deaths: 4,
            assists: 2,
            damage: 1200,
            teamDamage: 45,
            kast: { kastRounds: 8, roundsCounted: 10 },
            adr: { attackDamageRaw: 600, attackRounds: 5, defenseDamageRaw: 600, defenseRounds: 5 },
            openingDuels: { won: 2, involved: 3 },
            weaponBreakdown: [{ damageSource: 1, label: 'AP-25', kills: 6, headshots: 2, hits: 20, damage: 700 }]
          },
          {
            accountId: 'acc_teammate',
            name: 'FriendlyTeammate',
            kills: 5,
            deaths: 5,
            assists: 4,
            damage: 800,
            kast: { kastRounds: 7, roundsCounted: 10 },
            adr: { attackDamageRaw: 400, attackRounds: 5, defenseDamageRaw: 400, defenseRounds: 5 },
            openingDuels: { won: 1, involved: 2 },
            weaponBreakdown: [{ damageSource: 2, label: 'MAWP', kills: 4, headshots: 3, hits: 8, damage: 600 }]
          }
        ],
        [
          {
            accountId: 'acc_rival',
            name: 'RivalEnemy',
            kills: 6,
            deaths: 8,
            assists: 1,
            damage: 900,
            kast: { kastRounds: 5, roundsCounted: 10 },
            adr: { attackDamageRaw: 450, attackRounds: 5, defenseDamageRaw: 450, defenseRounds: 5 },
            openingDuels: { won: 1, involved: 3 },
            weaponBreakdown: [{ damageSource: 1, label: 'AP-25', kills: 4, headshots: 1, hits: 15, damage: 550 }]
          }
        ]
      ]
    },
    {
      matchId: 'match-ranked-2',
      timestamp: 1759050000000,
      isRanked: true,
      mapLabel: '[Bank] Executive Lounge',
      team0Name: 'Defenders',
      team1Name: 'Attackers',
      roundCount: 12,
      finalScore: { side0: 6, side1: 6 }, // Tie
      teams: [
        [
          {
            accountId: 'acc_local',
            name: 'LocalPlayerRenamed',
            kills: 8,
            deaths: 6,
            assists: 3,
            damage: 1000,
            teamDamage: 15,
            kast: { kastRounds: 8, roundsCounted: 12 },
          }
        ],
        [
          {
            accountId: 'acc_rival',
            name: 'RivalEnemy',
            kills: 9,
            deaths: 7,
            assists: 2,
            damage: 1100,
            kast: { kastRounds: 9, roundsCounted: 12 },
          }
        ]
      ]
    }
  ]
};

const otherArchive = new MatchArchive(null);
otherArchive.data = {
  localAccountId: 'acc_local',
  matches: [
    {
      matchId: 'match-casual-1',
      timestamp: 1759100000000,
      isRanked: false,
      mapLabel: '[Factory] Smelter',
      team0Name: 'Cobalt Team',
      team1Name: 'Crimson Team',
      roundCount: 8,
      finalScore: { side0: 3, side1: 5 }, // Side 1 won
      teams: [
        [
          {
            accountId: 'acc_local',
            name: 'LocalPlayerRenamed',
            kills: 4,
            deaths: 5,
            assists: 1,
            damage: 500,
            kast: { kastRounds: 4, roundsCounted: 8 },
          }
        ],
        [
          {
            accountId: 'acc_casual_pro',
            name: 'CasualPro',
            kills: 10,
            deaths: 2,
            assists: 3,
            damage: 1300,
            kast: { kastRounds: 7, roundsCounted: 8 },
          }
        ]
      ]
    }
  ]
};

const db = buildGlobalPlayerDatabase(rankedArchive, otherArchive);

assert(db, 'Database should be created');
assert.strictEqual(db.meta.totalMatches, 2, 'Total matches should be 2 (ranked only)');
assert.strictEqual(db.meta.rankedMatches, 2, 'Ranked matches should be 2');
assert.strictEqual(db.meta.casualMatches, 0, 'Casual matches should be 0');
assert.strictEqual(db.meta.totalPlayers, 3, 'Total players should be 3 (local, teammate, rival)');
assert(typeof db.lastUpdated === 'string' && db.lastUpdated.length > 0, 'Last updated should be formatted string');

// Verify LocalPlayer is present and has ranked-only stats
const localP = db.players.find((p) => p.accountId === 'acc_local');
assert(localP, 'Local player must be present in global database');
assert.strictEqual(localP.name, 'LocalPlayerRenamed', 'Should carry latest name');
assert(localP.aliases.includes('LocalPlayer'), 'Aliases should include previous name');
assert(localP.aliases.includes('LocalPlayerRenamed'), 'Aliases should include current name');
assert.strictEqual(localP.matches, 2, 'Local player ranked matches should be 2');
assert.strictEqual(localP.wins, 1, 'Local player won match 1');
assert.strictEqual(localP.ties, 1, 'Local player tied match 2');
assert.strictEqual(localP.losses, 0, 'Local player losses should be 0 in ranked');
assert.strictEqual(localP.kills, 18, '10 + 8 = 18 kills in ranked');
assert.strictEqual(localP.deaths, 10, '4 + 6 = 10 deaths in ranked');
assert.strictEqual(localP.assists, 5, '2 + 3 = 5 assists in ranked');
assert.strictEqual(localP.damage, 2200, '1200 + 1000 = 2200 damage in ranked');
assert.strictEqual(localP.teamDamage, 60, '45 + 15 = 60 team damage');
assert.strictEqual(localP.topWeapons[0].damage, 700, 'Weapon damage should be recorded');
assert.strictEqual(localP.roundsCounted, 22, '10 + 12 = 22 rounds in ranked');
assert(localP.dplRating > 0.5, 'DPL rating should be calculated');
assert.strictEqual(db.meta.totalDamage, 5000, 'Total damage across all ranked players');
assert.strictEqual(db.meta.totalTeamDamage, 60, 'Total friendly fire damage across all ranked players');
assert.strictEqual(localP.recentMatches.length, 2, 'Recent matches should only have 2 ranked matches');
assert.strictEqual(localP.recentMatches[0].matchId, 'match-ranked-2', 'Recent matches sorted newest first');
assert.strictEqual(localP.recentMatches[0].matchup, 'Defenders vs Attackers', 'Match name must use team names');
assert.strictEqual(localP.recentMatches[1].matchId, 'match-ranked-1', 'Match 1 is next');
assert.strictEqual(localP.recentMatches[1].matchup, 'Alpha Squad vs Bravo Squad', 'Match name must use team names');
assert(!localP.recentMatches[0].matchup.includes('Bank'), 'Never use map name for match names');
assert(!localP.recentMatches[1].matchup.includes('Killhouse'), 'Never use map name for match names');

// Verify RivalEnemy stats
const rivalP = db.players.find((p) => p.accountId === 'acc_rival');
assert(rivalP, 'Rival player must be present');
assert.strictEqual(rivalP.matches, 2, 'Rival matches should be 2');
assert.strictEqual(rivalP.wins, 0, 'Rival lost match 1');
assert.strictEqual(rivalP.losses, 1, 'Rival lost match 1');
assert.strictEqual(rivalP.ties, 1, 'Rival tied match 2');
assert.strictEqual(rivalP.kills, 15, '6 + 9 = 15 kills');
assert.strictEqual(rivalP.deaths, 15, '8 + 7 = 15 deaths');

// Verify CasualPro (only in casual match) is NOT present in the ranked database export
const casualP = db.players.find((p) => p.accountId === 'acc_casual_pro');
assert.strictEqual(casualP, undefined, 'Casual-only player must NOT be in ranked web database');

console.log('✓ buildGlobalPlayerDatabase accurately aggregates all players and stats (ranked matches only)');

console.log('=== Test 2: generatePortalMarkup HTML & PHP generation ===');

const htmlMarkup = generatePortalMarkup(db, false);
assert(htmlMarkup.includes('<!doctype html>'), 'HTML output should contain doctype');
assert(htmlMarkup.includes('window.GLOBAL_DATABASE = {'), 'HTML output should inline JSON data');
assert(htmlMarkup.includes('DUE<span class="accent">PROCESS</span> LEADERBOARD'), 'HTML output should contain branding');
assert(htmlMarkup.includes('statTotalPlayers'), 'HTML output should contain stat overview IDs');
assert(htmlMarkup.includes('playerModalBackdrop'), 'HTML output should contain player modal');
assert(htmlMarkup.includes('<th>Matchup</th>'), 'HTML output should contain Matchup header');
assert(!htmlMarkup.includes('<th>Map</th>'), 'HTML output must NOT contain Map header');
assert(htmlMarkup.includes('>Damage</th>'), 'HTML output should contain Damage header in weapons table');
assert(htmlMarkup.includes('data-sort="damage"'), 'HTML output should contain sortable Damage column');
assert(htmlMarkup.includes('data-sort="teamDamage"'), 'HTML output should contain sortable FF DMG column');
assert(htmlMarkup.includes('>FF DMG</th>'), 'HTML output should contain FF DMG header in leaderboard');
assert(htmlMarkup.includes('Friendly Fire'), 'HTML output should contain Friendly Fire label in modal');
assert(!htmlMarkup.includes('HS %</th>'), 'HTML output should NOT contain HS % in weapons table');

const phpMarkup = generatePortalMarkup(null, true);
assert(phpMarkup.includes('<?php'), 'PHP output should start with PHP tag');
assert(phpMarkup.includes("$dbFile = __DIR__ . '/database.json';"), 'PHP output should load database.json');
assert(phpMarkup.includes('window.GLOBAL_DATABASE = <?= $dbData'), 'PHP output should echo dbData');
assert(phpMarkup.includes('<!doctype html>'), 'PHP output should contain HTML document');
assert(phpMarkup.includes('<th>Matchup</th>'), 'PHP output should contain Matchup header');
assert(!phpMarkup.includes('<th>Map</th>'), 'PHP output must NOT contain Map header');
assert(phpMarkup.includes('>Damage</th>'), 'PHP output must contain Damage header in weapons table');
assert(phpMarkup.includes('data-sort="damage"'), 'PHP output must contain sortable Damage column');
assert(phpMarkup.includes('data-sort="teamDamage"'), 'PHP output must contain sortable FF DMG column');
assert(phpMarkup.includes('>FF DMG</th>'), 'PHP output must contain FF DMG header in leaderboard');
assert(phpMarkup.includes('Friendly Fire'), 'PHP output must contain Friendly Fire label in modal');
assert(!phpMarkup.includes('HS %</th>'), 'PHP output must NOT contain HS % in weapons table');

console.log('✓ generatePortalMarkup accurately generates both Standalone HTML and PHP portals');

console.log('=== Test 3: web/index.php file integrity ===');
const webIndexPath = path.join(__dirname, '..', 'web', 'index.php');
assert(fs.existsSync(webIndexPath), 'web/index.php must exist');
const webIndexContent = fs.readFileSync(webIndexPath, 'utf8');
assert(webIndexContent.startsWith('<?php'), 'web/index.php must start with <?php');
assert(webIndexContent.includes("$dbFile = __DIR__ . '/database.json';"), 'web/index.php must reference database.json');
assert(webIndexContent.includes('Last Updated:'), 'web/index.php must display Last Updated');
assert(webIndexContent.includes('<th>Matchup</th>'), 'web/index.php must use Matchup header for team names');
assert(!webIndexContent.includes('<th>Map</th>'), 'web/index.php must NOT use Map header for match names');
assert(webIndexContent.includes('>Damage</th>'), 'web/index.php must contain Damage header in weapons table');
assert(webIndexContent.includes('>FF DMG</th>'), 'web/index.php must contain FF DMG header in leaderboard');
assert(!webIndexContent.includes('HS %</th>'), 'web/index.php must NOT contain HS % in weapons table');

console.log('✓ web/index.php file verified successfully');

console.log('=== All Global Player Database tests passed successfully! ===');
