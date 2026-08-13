// Stat computation for a parsed Due Process match (see parser.js).
//
// Pure, no DOM access. Takes a `match` object as produced by
// DueProcessLogParser#getMatches() and returns per-player scoreboard rows.
//
// Formulations for KAST, assists, trade windows, team damage exclusions,
// and best-weapon selection have been cross-verified 100% exact against
// third-party web (dp-stats.com) reference match outputs.
// Each row also carries the raw component numbers (not just the final
// percentage/average) specifically so they can be inspected and verified.

// --- Weapon name lookup -----------------------------------------------
// `damageSource` in Stats::Kill / Stats::Damage is a numeric code with no
// name in the log. Confirmed mapping supplied by the user; codes 16 and 18
// haven't been seen in any log yet, and 8/17 are unconfirmed guesses (see
// their TODOs). Anything not listed here falls back to "Weapon #<code>".
export const weaponNames = {
  0: 'Dawn',
  1: 'AP-25',
  2: 'BLK-TAR',
  3: 'GAT-9',
  4: 'Gruber-5',
  5: 'PK-57',
  6: 'SAB-R',
  7: 'DL-12',
  8: 'KR82M',
  9: 'LS-45',
  10: 'Nack-11',
  11: 'MAWP',
  12: 'Ingmar-57',
  13: 'Legros',
  14: 'TUB-12',
  15: 'Auto Shotgun',
  17: 'KR82U',
  // Identified from log evidence, not the original community spreadsheet:
  // damage-per-hit landed exactly on Gruber-5's baseDamage (22) across two
  // separate players' full damage logs in the same match, and every hit
  // but one occurred while the attacker was on Defense — matching
  // Gruber-SD's confirmed status as the silenced, Defender-exclusive
  // variant of the Gruber-5 (see dueprocess.fandom.com/wiki/Weapons).
  19: 'Gruber-SD',
  50: 'Grenade',
  51: 'Molotov Cocktail',
};

// --- Full Weapon Metadata (from community spreadsheet & Fandom wiki) ---
export const weaponMeta = {
  0: { label: 'Dawn', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 25, rpm: 460, wikiUrl: 'https://dueprocess.fandom.com/wiki/Dawn', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/a/a2/Dawn.png' },
  1: { label: 'AP-25', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 20, rpm: 600, wikiUrl: 'https://dueprocess.fandom.com/wiki/AP-25', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/4d/AP-25-Logo.png' },
  2: { label: 'BLK-TAR', category: 'Assault Rifle', fireType: 'Semi', baseDamage: 30, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/BLK-TAR', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/d/dd/BLK-Tar.png' },
  3: { label: 'GAT-9', category: 'Handgun', fireType: 'Semi', baseDamage: 20, rpm: 420, wikiUrl: 'https://dueprocess.fandom.com/wiki/Gat-9', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/e/e3/Gat-9.png' },
  4: { label: 'Gruber-5', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 22, rpm: 720, wikiUrl: 'https://dueprocess.fandom.com/wiki/Gruber-5', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/a/a0/Gruber-5.png' },
  5: { label: 'PK-57', category: 'Handgun', fireType: 'Semi', baseDamage: 20, rpm: 410, wikiUrl: 'https://dueprocess.fandom.com/wiki/PK-57', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/40/PK-57-Logo.png' },
  6: { label: 'SAB-R', category: 'Battle Rifle', fireType: 'Semi', baseDamage: 50, rpm: 240, wikiUrl: 'https://dueprocess.fandom.com/wiki/SAB-R', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/9/90/SABR-Logo.png' },
  7: { label: 'DL-12', category: 'Shotgun', fireType: 'Pump', baseDamage: 20, rpm: 60, wikiUrl: 'https://dueprocess.fandom.com/wiki/DL-12', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/c/c2/DL-12.png' },
  8: { label: 'KR82M', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 30, rpm: 540, wikiUrl: 'https://dueprocess.fandom.com/wiki/KR82M', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/8/82/KR-82M.png' },
  9: { label: 'LS-45', category: 'Handgun', fireType: 'Semi', baseDamage: 30, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/LS45', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/e/e6/LS45.png' },
  10: { label: 'Nack-11', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 18, rpm: 1080, wikiUrl: 'https://dueprocess.fandom.com/wiki/Nack-11', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/7/78/Nack-11.png' },
  11: { label: 'MAWP', category: 'Sniper Rifle', fireType: 'Single', baseDamage: 85, rpm: 23, wikiUrl: 'https://dueprocess.fandom.com/wiki/MAWP', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/f/f6/MAWP.png' },
  12: { label: 'Ingmar-57', category: 'Battle Rifle', fireType: 'Auto', baseDamage: 37, rpm: 390, wikiUrl: 'https://dueprocess.fandom.com/wiki/INGMAR-57', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/40/Ingmar.png' },
  13: { label: 'Legros', category: 'Assault Rifle', fireType: 'Semi', baseDamage: 40, rpm: 260, wikiUrl: 'https://dueprocess.fandom.com/wiki/F1-Legros', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/b/b9/F1_Legros.png' },
  14: { label: 'TUB-12', category: 'Shotgun', fireType: 'Pump', baseDamage: 20, rpm: 60, wikiUrl: 'https://dueprocess.fandom.com/wiki/TUB-12', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/b/bf/Tub.png' },
  15: { label: 'Auto Shotgun', category: 'Shotgun', fireType: 'Auto', baseDamage: 20, rpm: 240, wikiUrl: 'https://dueprocess.fandom.com/wiki/Auto_Shotgun', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/4/47/Autoshotgun.png' },
  17: { label: 'KR82U', category: 'Assault Rifle', fireType: 'Auto', baseDamage: 30, rpm: 540, wikiUrl: 'https://dueprocess.fandom.com/wiki/KR82U', imageUrl: 'https://static.wikia.nocookie.net/dueprocess_gamepedia/images/f/fd/KR82U.png' },
  // Same baseDamage/rpm as Gruber-5 (4) — a suppressor doesn't change
  // damage, only sound/recoil. No dedicated wiki page exists yet, hence
  // the generic Weapons-page link and no imageUrl (same pattern as
  // Grenade/Molotov below).
  19: { label: 'Gruber-SD', category: 'Submachine Gun', fireType: 'Auto', baseDamage: 22, rpm: 720, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: null },
  50: { label: 'Grenade', category: 'Explosive', fireType: 'Throwable', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: null },
  51: { label: 'Molotov Cocktail', category: 'Explosive', fireType: 'Throwable', baseDamage: null, rpm: null, wikiUrl: 'https://dueprocess.fandom.com/wiki/Weapons', imageUrl: null },
};

// --- Weapon base (torso) damage, for headshot detection ----------------
export const weaponBaseDamage = Object.fromEntries(
  Object.entries(weaponMeta)
    .filter(([, m]) => m.baseDamage !== null)
    .map(([code, m]) => [code, m.baseDamage])
);

function isHeadshotDamage(damageSource, damageDealt) {
  const base = weaponBaseDamage[damageSource];
  return base !== undefined && damageDealt > base;
}

// --- Tunable KAST & Assist Constants ---
// Cross-referenced against web/dp-stats.com matches: 25 damage assist threshold,
// full-round assist window, and 150-tick (~7.5s) trade window yield 100% exact
// match across all 10 players on reference games.
export const DEFAULT_CONFIG = {
  // Minimum damage a teammate must have dealt to the victim to be credited with an assist.
  assistDamageThreshold: 25,
  // Full-round assist window (matching web/dp-stats behavior)
  assistTimeWindowTicks: Infinity,
  // 150 ticks (~7.5s) trade window (matching web/dp-stats KAST behavior)
  tradeTimeWindowTicks: 150,
};

function roundEntityMap(round, match) {
  const map = new Map();
  for (const side of [0, 1]) {
    const block = round.teamBlocks[side];
    if (block) for (const m of block.members) map.set(m.entityId, m.accountId);
  }
  if (map.size === 0) {
    // Fallback for a round with no Team block on record (e.g. a truncated
    // log): use the match's last-known roster instead of dropping the round.
    for (const p of match.players.values()) map.set(p.entityId, p.accountId);
  }
  return map;
}

// Determines which battlefield role (0 = attack, 1 = defense) each roster
// side played during this round. Roster side ("Team 0"/"Team 1") is fixed
// for the whole match; battlefield role rotates round to round and is only
// visible via attackerSide/victimSide on individual Kill/Damage lines, so
// this reads the first such line involving a member of each roster side.
function roundRoleByRosterSide(round) {
  const role = { 0: undefined, 1: undefined };
  const rosterSideByEntity = new Map();
  for (const side of [0, 1]) {
    const block = round.teamBlocks[side];
    if (block) for (const m of block.members) rosterSideByEntity.set(m.entityId, side);
  }
  const consider = (entityId, sideValue) => {
    const rosterSide = rosterSideByEntity.get(entityId);
    if (rosterSide === undefined) return;
    if (role[rosterSide] === undefined) role[rosterSide] = sideValue;
  };
  for (const k of round.kills) {
    consider(k.attackerId, k.attackerSide);
    consider(k.victimId, k.victimSide);
  }
  for (const d of round.damage) {
    consider(d.attackerId, d.attackerSide);
    consider(d.victimId, d.victimSide);
  }
  return role;
}

function emptyAgg(accountId, known) {
  return {
    accountId,
    name: known?.name ?? accountId,
    rosterSide: known?.rosterSide,
    damage: 0,
    attackDamage: 0,
    defenseDamage: 0,
    attackRounds: 0,
    defenseRounds: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    kastRounds: 0,
    roundsCounted: 0,
    openingWon: 0,
    openingInvolved: 0,
    weaponDamage: new Map(),
    weaponHits: new Map(),
    weaponKills: new Map(),
    weaponDeaths: new Map(), // damageSource -> times this player died to that weapon
    weaponHeadshots: new Map(), // damageSource -> headshot-magnitude hits landed (see isHeadshotDamage)
    weaponRoundsUsed: new Map(), // damageSource -> Set of round numbers this weapon dealt damage or got a kill in
    teamDamage: 0,
  };
}

export function computeMatchStats(match, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const players = new Map();

  const ensure = (accountId) => {
    if (!players.has(accountId)) {
      players.set(accountId, emptyAgg(accountId, match.players.get(accountId)));
    }
    return players.get(accountId);
  };

  // Seed every known player up front so someone who went 0/0 still shows up.
  for (const p of match.players.values()) ensure(p.accountId);

  const roundNumbers = [...match.roundsByNumber.keys()].sort((a, b) => a - b);

  for (const roundNumber of roundNumbers) {
    const round = match.roundsByNumber.get(roundNumber);
    const entityToAccount = roundEntityMap(round, match);
    const roleByRosterSide = roundRoleByRosterSide(round);

    const roundAccountIds = new Set(entityToAccount.values());
    for (const accountId of roundAccountIds) ensure(accountId).roundsCounted += 1;

    // Attack/defense round counts, per roster side's role this round.
    for (const side of [0, 1]) {
      const role = roleByRosterSide[side];
      const block = round.teamBlocks[side];
      if (role === undefined || !block) continue;
      for (const m of block.members) {
        const agg = ensure(m.accountId);
        if (role === 0) agg.attackRounds += 1;
        else if (role === 1) agg.defenseRounds += 1;
      }
    }

    // Damage totals, ADR buckets, weapon breakdown. Both self-damage (a player
    // catching themselves in their own Molotov/grenade) and team damage (hitting
    // a teammate on the same side) are branch-excluded from enemy damage totals
    // / ADR and credited to `teamDamage` (FF DMG).
    for (const d of round.damage) {
      if (d.attackerSide === d.victimSide) {
        const accountId = entityToAccount.get(d.attackerId);
        if (accountId) ensure(accountId).teamDamage += d.damageDealt;
        continue;
      }
      const accountId = entityToAccount.get(d.attackerId);
      if (!accountId) continue;
      const agg = ensure(accountId);
      agg.damage += d.damageDealt;
      if (d.attackerSide === 0) agg.attackDamage += d.damageDealt;
      else if (d.attackerSide === 1) agg.defenseDamage += d.damageDealt;
      agg.weaponDamage.set(d.damageSource, (agg.weaponDamage.get(d.damageSource) ?? 0) + d.damageDealt);
      agg.weaponHits.set(d.damageSource, (agg.weaponHits.get(d.damageSource) ?? 0) + 1);
      if (isHeadshotDamage(d.damageSource, d.damageDealt)) {
        agg.weaponHeadshots.set(d.damageSource, (agg.weaponHeadshots.get(d.damageSource) ?? 0) + 1);
      }
      if (!agg.weaponRoundsUsed.has(d.damageSource)) agg.weaponRoundsUsed.set(d.damageSource, new Set());
      agg.weaponRoundsUsed.get(d.damageSource).add(roundNumber);
    }

    // Kills / deaths. Both sides are present directly on the raw Kill log
    // line (attackerSide/victimSide), so a team kill (friendly fire) is
    // simply attackerSide === victimSide — confirmed against a real match
    // with a "DISHONORABLY DISCHARGED" killfeed line (the game's own
    // team-kill callout) landing on exactly this case. The victim still
    // died either way, so deaths/weaponDeaths are unaffected; only the
    // killer's kill credit is withheld.
    for (const k of round.kills) {
      const killerAccount = entityToAccount.get(k.attackerId);
      const victimAccount = entityToAccount.get(k.victimId);
      const isTeamKill = k.attackerSide === k.victimSide;
      if (killerAccount && !isTeamKill) {
        const agg = ensure(killerAccount);
        agg.kills += 1;
        agg.weaponKills.set(k.damageSource, (agg.weaponKills.get(k.damageSource) ?? 0) + 1);
        if (!agg.weaponRoundsUsed.has(k.damageSource)) agg.weaponRoundsUsed.set(k.damageSource, new Set());
        agg.weaponRoundsUsed.get(k.damageSource).add(roundNumber);
      }
      if (victimAccount) {
        const victimAgg = ensure(victimAccount);
        victimAgg.deaths += 1;
        victimAgg.weaponDeaths.set(k.damageSource, (victimAgg.weaponDeaths.get(k.damageSource) ?? 0) + 1);
      }
    }

    // Assists: teammate damage to the eventual victim, above threshold,
    // within the time window before the kill tick.
    const assistedThisRound = new Set();
    for (const k of round.kills) {
      const candidateDamage = new Map(); // attackerId -> summed damage in window
      for (const d of round.damage) {
        if (d.victimId !== k.victimId) continue;
        if (d.attackerId === k.attackerId) continue;
        if (d.attackerSide !== k.attackerSide) continue; // must be the killer's teammate
        const delta = k.tick - d.tick;
        if (delta < 0 || delta > cfg.assistTimeWindowTicks) continue;
        candidateDamage.set(d.attackerId, (candidateDamage.get(d.attackerId) ?? 0) + d.damageDealt);
      }
      for (const [entityId, dmg] of candidateDamage) {
        if (dmg < cfg.assistDamageThreshold) continue;
        const accountId = entityToAccount.get(entityId);
        if (!accountId) continue;
        ensure(accountId).assists += 1;
        assistedThisRound.add(accountId);
      }
    }

    // KAST: Kill, Assist, Survived, or Traded.
    const survivedAccountIds = new Set(roundAccountIds);
    for (const k of round.kills) {
      const victimAccount = entityToAccount.get(k.victimId);
      if (victimAccount) survivedAccountIds.delete(victimAccount);
    }
    const kastAccountIds = new Set(survivedAccountIds);
    for (const accountId of assistedThisRound) kastAccountIds.add(accountId);
    for (const k of round.kills) {
      const killerAccount = entityToAccount.get(k.attackerId);
      if (killerAccount && k.attackerSide !== k.victimSide) kastAccountIds.add(killerAccount);
    }
    for (const k of round.kills) {
      const victimAccount = entityToAccount.get(k.victimId);
      if (!victimAccount) continue;
      const avenged = round.kills.some((other) => {
        if (other.victimId !== k.attackerId) return false;
        const delta = other.tick - k.tick;
        if (delta < 0 || delta > cfg.tradeTimeWindowTicks) return false;
        return other.attackerSide === k.victimSide; // avenger is on the victim's team
      });
      if (avenged) kastAccountIds.add(victimAccount);
    }
    for (const accountId of kastAccountIds) ensure(accountId).kastRounds += 1;

    // Opening duel: earliest kill this round by tick.
    if (round.kills.length > 0) {
      const opening = [...round.kills].sort((a, b) => a.tick - b.tick)[0];
      const killerAccount = entityToAccount.get(opening.attackerId);
      const victimAccount = entityToAccount.get(opening.victimId);
      if (killerAccount) {
        const agg = ensure(killerAccount);
        agg.openingWon += 1;
        agg.openingInvolved += 1;
      }
      if (victimAccount) ensure(victimAccount).openingInvolved += 1;
    }
  }

  const rows = [...players.values()].map((agg) => finalizeRow(agg));
  const teams = { 0: [], 1: [] };
  for (const row of rows) {
    if (row.rosterSide === 0 || row.rosterSide === 1) teams[row.rosterSide].push(row);
  }
  for (const side of [0, 1]) teams[side].sort((a, b) => b.damage - a.damage);

  return {
    roundCount: roundNumbers.length,
    finalScore: match.finalScore,
    teams,
    config: cfg,
  };
}

// Same "Super C" formula as match-archive.js's computeDplRating (kept in
// sync there — see its doc comment) — this one just feeds it a single
// match's row instead of a summed career/Played-With aggregate. There's no
// win-rate concept for a single row, so winRate stays at computeDplRating's
// own neutral default (1.0x multiplier), same as any other caller that
// doesn't have that context.
export function calculateDplRating(row) {
  const rounds = row.kast?.roundsCounted || row.roundsCounted || 1;
  const kills = row.kills ?? 0;
  const deaths = row.deaths ?? 0;
  const assists = row.assists ?? 0;
  const kpr = kills / rounds;
  const totalDmg = (row.adr?.attackDamageRaw ?? 0) + (row.adr?.defenseDamageRaw ?? 0);
  const adrRounds = (row.adr?.attackRounds ?? 0) + (row.adr?.defenseRounds ?? 0);
  const adr = adrRounds > 0 ? totalDmg / adrRounds : (row.damage ?? 0) / rounds;
  const srv = Math.max(0, (rounds - deaths) / rounds);
  const kastPct = row.kast?.percent ?? 0; // already 0-100, matching computeDplRating's kastPct scale

  const kda = (kills + assists) / Math.max(1, deaths);
  const kdaFactor = kda / 1.5; // 1.5 KDA = 1.0 baseline
  const kastFactor = kastPct / 70; // 70% KAST = 1.0 baseline
  const baseCombat = 0.25 * kdaFactor + 0.25 * kastFactor + 0.20 * kpr + 0.20 * (adr / 100) + 0.10 * srv;
  const winImpact = 0.65 + 0.70 * (50 / 100); // neutral (no per-row win-rate input) — see comment above

  return Math.round(baseCombat * winImpact * 100) / 100;
}

function finalizeRow(agg) {
  const kastPercent = agg.roundsCounted > 0 ? (agg.kastRounds / agg.roundsCounted) * 100 : 0;
  const adrAttack = agg.attackRounds > 0 ? agg.attackDamage / agg.attackRounds : 0;
  const adrDefense = agg.defenseRounds > 0 ? agg.defenseDamage / agg.defenseRounds : 0;

  // Union of weapons the player hit, killed with, or was killed by —
  // "Died By" needs the latter even for a weapon this player never
  // personally fired (see the Weapons tab in the Hub).
  const weaponCodes = new Set([...agg.weaponHits.keys(), ...agg.weaponKills.keys(), ...agg.weaponDeaths.keys()]);
  const weaponBreakdown = [...weaponCodes]
    .map((code) => {
      const meta = weaponMeta[code] ?? { category: 'Other', fireType: 'Unknown', baseDamage: null, rpm: null };
      return {
        damageSource: code,
        label: weaponNames[code] ?? `Weapon #${code}`,
        category: meta.category,
        fireType: meta.fireType,
        baseDamage: meta.baseDamage,
        rpm: meta.rpm,
        hits: agg.weaponHits.get(code) ?? 0,
        damage: Math.round(agg.weaponDamage.get(code) ?? 0),
        kills: agg.weaponKills.get(code) ?? 0,
        deaths: agg.weaponDeaths.get(code) ?? 0,
        // null (not 0) means "no headshot data for this weapon" — see
        // weaponBaseDamage — so the Hub can render "—" instead of a fake 0%.
        headshots: code in weaponBaseDamage ? agg.weaponHeadshots.get(code) ?? 0 : null,
        roundsUsed: agg.weaponRoundsUsed.get(code)?.size ?? 0,
      };
    })
    .sort((a, b) => b.damage - a.damage || b.kills - a.kills);
  // bestWeapon stays scoped to weapons this player actually fired, so a
  // weapon they only ever died to (0 hits, 0 kills) can never end up as
  // their "best" weapon just by being in the union list above.
  const attackedBreakdown = weaponBreakdown.filter((w) => w.hits > 0);

  const row = {
    accountId: agg.accountId,
    name: agg.name,
    rosterSide: agg.rosterSide,
    damage: Math.round(agg.damage),
    adr: {
      attack: Math.round(adrAttack),
      defense: Math.round(adrDefense),
      attackRounds: agg.attackRounds,
      defenseRounds: agg.defenseRounds,
      attackDamageRaw: Math.round(agg.attackDamage),
      defenseDamageRaw: Math.round(agg.defenseDamage),
    },
    kills: agg.kills,
    deaths: agg.deaths,
    assists: agg.assists,
    kast: {
      percent: Math.round(kastPercent),
      kastRounds: agg.kastRounds,
      roundsCounted: agg.roundsCounted,
    },
    openingDuels: {
      won: agg.openingWon,
      involved: agg.openingInvolved,
    },
    teamDamage: Math.round(agg.teamDamage),
    hsPercent: (() => {
      const totalHits = [...agg.weaponHits.values()].reduce((a, b) => a + b, 0);
      const totalHs = [...agg.weaponHeadshots.values()].reduce((a, b) => a + b, 0);
      return totalHits > 0 ? Math.round((totalHs / totalHits) * 100) : null;
    })(),
    bestWeapon: attackedBreakdown[0] ?? null,
    weaponBreakdown,
  };

  row.dplRating = calculateDplRating(row);
  return row;
}
