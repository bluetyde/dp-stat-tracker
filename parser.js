// Due Process Player.log parser.
//
// Pure, dependency-free, no DOM access — safe to import from a browser page
// or reuse later inside an Overwolf overlay that tails a growing log file.
//
// Usage (one-shot):
//   const parser = new DueProcessLogParser();
//   parser.feedText(fullFileText);
//   parser.end();
//   const matches = parser.getMatches();
//
// Usage (incremental / tailing a live file):
//   const parser = new DueProcessLogParser();
//   parser.feedText(newlyAppendedBytes);   // call again each time the file grows
//   const matches = parser.getMatches();   // includes the in-progress match

const TEAM_MARKER = { 0: 'Stats :: Team 0 :: ', 1: 'Stats :: Team 1 :: ' };
const KILL_MARKER = 'Stats :: Kill :: ';
const DAMAGE_MARKER = 'Stats :: Damage :: ';
const KILLFEED_MARKER = 'KillLogUI :: Entry :: ';

// Confirmed against real data to carry the SAME id matchEnded eventually
// reports (unlike matchStarted's JSON MatchId, which can differ — see the
// match-open comment below) — and it arrives early, well before a match's
// own Team/Kill/Damage lines. That makes it the one reliable match
// identifier available for a match that never gets a real matchEnded at
// all (see main.js's inferred-completion handling for why that happens).
const VIVOX_MATCH_START_RE = /VivoxChatClient::HandleMatchStart\(\s*([0-9a-fA-F-]+)\s*\)/;

// Killer/victim names are usually wrapped in <noparse>, but non-player
// "killers" like UAV are not (see isEnvironmentKill below), so both the
// opening and closing noparse tags are optional here.
const KILLFEED_RE =
  /^KillLogUI :: Entry :: <color=(#[0-9A-Fa-f]+)>(?:<noparse>)?(.*?)(?:<\/noparse>)?<\/color> (.+?) <color=(#[0-9A-Fa-f]+)>(?:<noparse>)?(.*?)(?:<\/noparse>)?<\/color> @ (\d+)\s*$/;

// Matches lines like: Levels:: Loading game level and background ,[Dome] Mendicant Hound [-1073089108] (),dome level set dome
const LEVEL_LOAD_RE = /Levels:: Loading game level and background\s*,\s*\[(.*?)\]\s*(.*?)\s*\[/i;

function extractJsonObject(line, marker) {
  const idx = line.indexOf(marker);
  if (idx === -1) return null;
  try {
    return JSON.parse(line.slice(idx + marker.length));
  } catch {
    return null;
  }
}

// GECNet messages appear either bare ({"type":"matchEnded",...}) or wrapped
// ("Received GECNet message {"type":"matchEnded",...}"). The interesting
// payload is itself JSON-encoded a second time inside the "data" field.
function extractGecNetPayload(line, typeName) {
  if (line.indexOf(`"type":"${typeName}"`) === -1) return null;
  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let outer;
  try {
    outer = JSON.parse(line.slice(start, end + 1));
  } catch {
    return null;
  }
  if (outer.type !== typeName) return null;
  if (typeof outer.data !== 'string') return outer.data ?? null;
  try {
    return JSON.parse(outer.data);
  } catch {
    return null;
  }
}

function newRound(number, mapLabel = null) {
  return {
    number,
    mapLabel,
    teamBlocks: { 0: null, 1: null },
    kills: [],
    damage: [],
    killFeed: [],
  };
}

function newMatch() {
  return {
    status: 'in-progress',
    liveMatchId: null, // from VivoxChatClient::HandleMatchStart; see main.js's inferred-completion handling
    endMatchId: null,
    matchEndedPayload: null,
    lastScoreUpdate: null,
    finalScore: null, // { side0, side1, source: 'roundWins' | 'matchEndedPayload' }
    team0Name: null,
    team1Name: null,
    players: new Map(), // accountId -> { accountId, name, entityId, rosterSide, iconUrl }
    roundsByNumber: new Map(), // roundNumber -> round
  };
}

export function deriveFinalScoreFromRounds(roundsByNumber) {
  let bestRound = -1;
  for (const [n, round] of roundsByNumber) {
    if (round.teamBlocks[0] && round.teamBlocks[1]) bestRound = Math.max(bestRound, n);
  }
  if (bestRound === -1) return null;
  const round = roundsByNumber.get(bestRound);
  return {
    side0: round.teamBlocks[0].roundWins,
    side1: round.teamBlocks[1].roundWins,
    source: 'roundWins',
  };
}

export class DueProcessLogParser {
  constructor() {
    this.matches = []; // completed matches, in the order matchEnded was seen
    this.current = null; // in-progress match, or null between matches
    this._sawMatchStarted = false;
    this._pendingLiveMatchId = null; // captured pre-match-open; see feedLine's Vivox handling
    this._pendingMapLabel = null;
    this._pendingTeam0Name = null;
    this._pendingTeam1Name = null;
    this._tail = ''; // buffered partial line, for incremental/streaming input
  }

  /** Feed a chunk of raw log text. For live-tailing, pass only newly appended bytes. */
  feedText(text) {
    const combined = this._tail + text;
    const lines = combined.split(/\r?\n/);
    this._tail = lines.pop() ?? '';
    for (const line of lines) this.feedLine(line);
  }

  /** Flush a trailing partial line (call once the source is fully read). */
  end() {
    if (this._tail) {
      this.feedLine(this._tail);
      this._tail = '';
    }
  }

  feedLine(line) {
    if (!line) return;

    const startPayload = extractGecNetPayload(line, 'matchStarted');
    if (startPayload) {
      this._sawMatchStarted = true;
      this._pendingTeam0Name = startPayload.Team1Name ?? null;
      this._pendingTeam1Name = startPayload.Team2Name ?? null;
      if (this.current) {
        this.current.team0Name = this._pendingTeam0Name;
        this.current.team1Name = this._pendingTeam1Name;
      }
    }

    // This line reliably arrives before a match's own Team/Kill/Damage
    // lines — often before this.current even opens — so it's captured
    // unconditionally here rather than inside the current-match dispatch
    // below, and attached to whichever match ends up owning it (this one,
    // if already open; the next one to open, otherwise).
    const vivoxMatch = VIVOX_MATCH_START_RE.exec(line);
    if (vivoxMatch) {
      this._pendingLiveMatchId = vivoxMatch[1];
      if (this.current && !this.current.liveMatchId) {
        this.current.liveMatchId = vivoxMatch[1];
      }
    }

    const levelMatch = LEVEL_LOAD_RE.exec(line);
    if (levelMatch) {
      this._pendingMapLabel = `[${levelMatch[1].trim()}] ${levelMatch[2].trim()}`;
    }

    if (this.current === null) {
      // BUG FIX: this used to open the match only on the first Team 0
      // block. But that block is a round-END summary (RoundOutcomes has
      // length 1 the first time it appears) — round 1's own Kill/Damage/
      // KillFeed lines are logged BEFORE it, while the match was still
      // closed, and were silently dropped every single time. Verified
      // against a real completed match: round 1 held zero kills and zero
      // damage entries even though the raw log had one Kill line for that
      // round — this cost every match's round 1 entirely (damage, K/D/A,
      // KAST, opening duels, and ADR's attack/defense role detection, which
      // itself depends on round 1 having any Kill/Damage line to read a
      // side from). Fix: open on the first Team/Kill/Damage/KillFeed line
      // seen after matchStarted, whichever comes first — for round 1 that's
      // now its own Kill/Damage lines, so nothing before them is missed.
      //
      // The matchStarted JSON message itself still isn't used for the
      // MatchId — it can carry a MatchId that doesn't match the eventual
      // matchEnded MatchId (observed in sample data — the backend can
      // reassign the id once the real match begins) — so MatchId is not
      // used for boundary detection, only ordering.
      const isMatchEvidence =
        line.indexOf(TEAM_MARKER[0]) !== -1 ||
        line.indexOf(TEAM_MARKER[1]) !== -1 ||
        line.indexOf(KILL_MARKER) !== -1 ||
        line.indexOf(DAMAGE_MARKER) !== -1 ||
        line.indexOf(KILLFEED_MARKER) !== -1;
      if (this._sawMatchStarted && isMatchEvidence) {
        this.current = newMatch();
        this.current.liveMatchId = this._pendingLiveMatchId;
        this.current.team0Name = this._pendingTeam0Name;
        this.current.team1Name = this._pendingTeam1Name;
        this._pendingLiveMatchId = null;
        this._sawMatchStarted = false;
      } else {
        return;
      }
    }

    if (line.indexOf(TEAM_MARKER[0]) !== -1) {
      this._handleTeamBlock(0, line);
      return;
    }
    if (line.indexOf(TEAM_MARKER[1]) !== -1) {
      this._handleTeamBlock(1, line);
      return;
    }
    if (line.indexOf(KILL_MARKER) !== -1) {
      const obj = extractJsonObject(line, KILL_MARKER);
      if (obj) this._round(obj.round).kills.push(obj);
      return;
    }
    if (line.indexOf(DAMAGE_MARKER) !== -1) {
      const obj = extractJsonObject(line, DAMAGE_MARKER);
      if (obj) this._round(obj.round).damage.push(obj);
      return;
    }
    if (line.indexOf(KILLFEED_MARKER) !== -1) {
      const m = KILLFEED_RE.exec(line);
      if (m) {
        const [, , killerName, verb, , victimName, tick] = m;
        this._latestRound().killFeed.push({
          killerName,
          verb,
          victimName,
          tick: Number(tick),
          // e.g. "UAV ZAPPED <player>" — a non-player kill, not attributable
          // to any player's stat line.
          isEnvironmentKill: killerName.toUpperCase() === 'UAV',
        });
      }
      return;
    }

    const endedPayload = extractGecNetPayload(line, 'matchEnded');
    if (endedPayload) {
      this._finalizeMatch(endedPayload);
      return;
    }

    const scorePayload = extractGecNetPayload(line, 'updateMatchScore');
    if (scorePayload && this.current) {
      this.current.lastScoreUpdate = {
        attackerScore: scorePayload.AttackerScore,
        defenderScore: scorePayload.DefenderScore,
      };
    }
  }

  _round(number) {
    const rounds = this.current.roundsByNumber;
    if (!rounds.has(number)) rounds.set(number, newRound(number, this._pendingMapLabel));
    return rounds.get(number);
  }

  // Kill-feed lines don't carry a round number, so file them under whichever
  // round is currently open (the highest round number seen so far).
  _latestRound() {
    const rounds = this.current.roundsByNumber;
    if (rounds.size === 0) return this._round(1);
    let max = -Infinity;
    for (const n of rounds.keys()) if (n > max) max = n;
    return rounds.get(max);
  }

  _handleTeamBlock(side, line) {
    const obj = extractJsonObject(line, TEAM_MARKER[side]);
    if (!obj || !Array.isArray(obj.RoundOutcomes) || !Array.isArray(obj.Members)) return;

    const roundNumber = obj.RoundOutcomes.length;
    const round = this._round(roundNumber);
    const existing = round.teamBlocks[side];

    const block = {
      side,
      killScore: obj.KillScore,
      roundWins: obj.RoundWins,
      // Last element of RoundOutcomes is this round's own result code for
      // this side — confirmed against "Bomb DEFUSED" log lines: 1 = this
      // side defused (attacker win), 5 = opponent defused (defender loss).
      // Non-defuse rounds use 2 (attacker loss) / 4 (defender win) — see
      // computeMatchStats-adjacent round-result classification in rescan.js
      // for how attacker-survivor-count further splits those into a full
      // elimination vs. a save (attacker ran out of time with a survivor).
      outcomeCode: obj.RoundOutcomes[obj.RoundOutcomes.length - 1],
      members: obj.Members.map((m) => ({
        entityId: m.EntityId,
        name: m.Name,
        accountId: m.AccountId,
        iconUrl: m.IconURL,
        teamKillsThisMatch: m.TeamKillsThisMatch,
        teamKillReprimands: m.TeamKillReprimands,
      })),
    };

    // The client re-emits a Team block with everything zeroed out while a
    // match is tearing down (observed right after the real final block, same
    // round number). Keep whichever block has the higher RoundWins so that
    // teardown noise doesn't clobber the real final score.
    if (!existing || block.roundWins >= existing.roundWins) {
      round.teamBlocks[side] = block;
    }

    for (const m of obj.Members) {
      this.current.players.set(m.AccountId, {
        accountId: m.AccountId,
        name: m.Name,
        entityId: m.EntityId,
        rosterSide: side,
        iconUrl: m.IconURL,
      });
    }
  }

  _finalizeMatch(endedPayload) {
    if (!this.current) return;
    const match = this.current;
    match.status = 'complete';
    match.endMatchId = endedPayload.MatchId ?? null;
    match.matchEndedPayload = {
      attackerScore: endedPayload.AttackerScore,
      defenderScore: endedPayload.DefenderScore,
    };
    match.finalScore = this._deriveFinalScore(match);
    this.matches.push(match);
    this.current = null;
  }

  // Prefer RoundWins from the last round's Team blocks over matchEnded's
  // AttackerScore/DefenderScore: in sample data matchEnded's score was one
  // round stale (its last updateMatchScore, not the just-finished round).
  _deriveFinalScore(match) {
    const fromRounds = deriveFinalScoreFromRounds(match.roundsByNumber);
    if (fromRounds) return fromRounds;
    if (match.matchEndedPayload) {
      return {
        side0: match.matchEndedPayload.attackerScore,
        side1: match.matchEndedPayload.defenderScore,
        source: 'matchEndedPayload',
      };
    }
    return null;
  }

  /**
   * Every match seen so far: completed matches plus the in-progress one (if
   * any), with a freshly computed finalScore so a UI can show a match while
   * it's still being played.
   */
  getMatches() {
    const list = [...this.matches];
    if (this.current) {
      list.push({ ...this.current, finalScore: this._deriveFinalScore(this.current) });
    }
    return list;
  }
}
