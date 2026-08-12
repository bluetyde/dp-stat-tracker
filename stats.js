// Stat computation for a parsed Due Process match (see parser.js).
//
// Pure, no DOM access. Takes a `match` object as produced by
// DueProcessLogParser#getMatches() and returns per-player scoreboard rows.
//
// SEVERAL FORMULAS BELOW ARE BEST-EFFORT / UNCONFIRMED — flagged inline.
// Each row also carries the raw component numbers (not just the final
// percentage/average) specifically so they can be sanity-checked by hand
// against a known match before being trusted.

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
  8: 'Big AK', // TODO: confirm real name
  9: 'LS-45',
  10: 'Nack-11',
  11: 'MAWP',
  12: 'Ingmar-57',
  13: 'Legros',
  14: 'TUB-12', // "Tub?" — TUB-12 is the only Defender primary shotgun on the wiki, fits
  15: 'Auto Shotgun',
  17: 'Mini AK', // TODO: confirm real name
  50: 'Grenade',
  51: 'Molotov Cocktail',
  // 16, 18: not seen yet — no match in either log
};

// --- Tunable constants (UNCONFIRMED — see README notes in this repo) ---
// No assist/trade signal exists anywhere in the log, so these are
// implemented from Stats::Damage / Stats::Kill using a threshold + time
// window, per the spec. Tick rate is not known from the log, so the tick
// windows below are placeholders, not derived from a known tick-rate.
export const DEFAULT_CONFIG = {
  // Minimum damage a teammate must have dealt to the victim, in the window
  // before the kill, to be credited with an assist.
  assistDamageThreshold: 20,
  // How many ticks before the kill an assisting teammate's damage still counts.
  assistTimeWindowTicks: 300,
  // How many ticks after a player's death a teammate's kill on the killer
  // still counts as a "trade" for KAST purposes.
  tradeTimeWindowTicks: 300,
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

    // Damage totals, ADR buckets, weapon breakdown.
    for (const d of round.damage) {
      const accountId = entityToAccount.get(d.attackerId);
      if (!accountId) continue;
      const agg = ensure(accountId);
      agg.damage += d.damageDealt;
      if (d.attackerSide === 0) agg.attackDamage += d.damageDealt;
      else if (d.attackerSide === 1) agg.defenseDamage += d.damageDealt;
      agg.weaponDamage.set(d.damageSource, (agg.weaponDamage.get(d.damageSource) ?? 0) + d.damageDealt);
      agg.weaponHits.set(d.damageSource, (agg.weaponHits.get(d.damageSource) ?? 0) + 1);
    }

    // Kills / deaths.
    for (const k of round.kills) {
      const killerAccount = entityToAccount.get(k.attackerId);
      const victimAccount = entityToAccount.get(k.victimId);
      if (killerAccount) {
        const agg = ensure(killerAccount);
        agg.kills += 1;
        agg.weaponKills.set(k.damageSource, (agg.weaponKills.get(k.damageSource) ?? 0) + 1);
      }
      if (victimAccount) ensure(victimAccount).deaths += 1;
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
      if (killerAccount) kastAccountIds.add(killerAccount);
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

function finalizeRow(agg) {
  const kastPercent = agg.roundsCounted > 0 ? (agg.kastRounds / agg.roundsCounted) * 100 : 0;
  const adrAttack = agg.attackRounds > 0 ? agg.attackDamage / agg.attackRounds : 0;
  const adrDefense = agg.defenseRounds > 0 ? agg.defenseDamage / agg.defenseRounds : 0;

  const weaponBreakdown = [...agg.weaponHits.keys()]
    .map((code) => ({
      damageSource: code,
      label: weaponNames[code] ?? `Weapon #${code}`,
      hits: agg.weaponHits.get(code) ?? 0,
      damage: Math.round(agg.weaponDamage.get(code) ?? 0),
      kills: agg.weaponKills.get(code) ?? 0,
    }))
    .sort((a, b) => b.kills - a.kills || b.damage - a.damage);

  return {
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
    bestWeapon: weaponBreakdown[0] ?? null,
    weaponBreakdown,
  };
}
