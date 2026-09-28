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

const TEAM_MARKER = { 0: 'Stats :: Team 0 :: ', 1: 'Stats :: Team 1 :: ', 2: 'Stats :: Team 2 :: ' };
const KILL_MARKER = 'Stats :: Kill :: ';
const DAMAGE_MARKER = 'Stats :: Damage :: ';
const KILLFEED_MARKER = 'KillLogUI :: Entry :: ';

// Confirmed against real data to carry the SAME id matchEnded eventually
// reports (unlike matchStarted's JSON MatchId, which can differ — see the
// match-open comment below) — and it arrives early, well before a match's
// own Team/Kill/Damage lines. That makes it the one reliable match
// identifier available for a match that never gets a real matchEnded at
// all (see main.js's inferred-completion handling for why that happens).
// Supports both VivoxChatClient::HandleMatchStart and VivoxChat:: joining match channel.
const VIVOX_MATCH_START_RE =
  /(?:VivoxChatClient::HandleMatchStart\(\s*|VivoxChat:: joining match channel\s+)([0-9a-fA-F-]+)/;

// Killer/victim names are usually wrapped in <noparse>, but non-player
// "killers" like UAV are not (see isEnvironmentKill below), so both the
// opening and closing noparse tags are optional here.
const KILLFEED_RE =
  /^KillLogUI :: Entry :: <color=(#[0-9A-Fa-f]+)>(?:<noparse>)?(.*?)(?:<\/noparse>)?<\/color> (.+?) <color=(#[0-9A-Fa-f]+)>(?:<noparse>)?(.*?)(?:<\/noparse>)?<\/color> @ (\d+)\s*$/;

// Matches lines like: Levels:: Loading game level and background ,[Dome] Mendicant Hound [-1073089108] (),dome level set dome
const LEVEL_LOAD_RE = /Levels:: Loading game level and background\s*,\s*\[(.*?)\]\s*(.*?)\s*\[/i;

const CLIENT_SKIP_RE = /Latest client data with skip for \d+: (\d+)/;
const LOCK_BREAK_MARKER = "Couldn't find particle pool for DES_LockBreak";
const GSM_MERGE_MARKER = 'Merging gsms with different tickstamps';
const LOCAL_UID_RE = /Client UID set to \d+ \((\d+)\)/;

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
    actionStartTick: null,
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
    is2v2: false,
    players: new Map(), // accountId -> { accountId, name, entityId, rosterSide, iconUrl }
    roundsByNumber: new Map(), // roundNumber -> round
    // Match-level, not per-round — see the killfeed-handling comment below
    // for why a round can't be determined at push time.
    killFeed: [],
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
    this._pendingIs2v2 = false;
    this._tail = ''; // buffered partial line, for incremental/streaming input

    this._activeRoundNumber = 1;
    this._lastSeenTick = null;
    this._roundLevelLoadSeen = new Map();
    this._roundActionStarts = new Map();
    this._roundGsmCandidates = new Map();
    this._pendingGsmTick = false;
    this._localAccountId = null;
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

  _isPayloadRelevant(payload) {
    if (!payload) return false;
    if (this._localAccountId) {
      const t1 = payload.Team1Members;
      const t2 = payload.Team2Members;
      const spec = payload.Spectators;
      const hasMembers = Array.isArray(t1) || Array.isArray(t2) || Array.isArray(spec);
      if (hasMembers) {
        const inT1 = Array.isArray(t1) && t1.includes(this._localAccountId);
        const inT2 = Array.isArray(t2) && t2.includes(this._localAccountId);
        const inSpec = Array.isArray(spec) && spec.includes(this._localAccountId);
        if (!inT1 && !inT2 && !inSpec) return false;
      }
    }
    if (this.current && this.current.liveMatchId && payload.MatchId && payload.MatchId !== this.current.liveMatchId) {
      return false;
    }
    if (!this.current && this._pendingLiveMatchId && payload.MatchId && payload.MatchId !== this._pendingLiveMatchId) {
      return false;
    }
    return true;
  }

  feedLine(line) {
    if (!line) return;

    const uidMatch = LOCAL_UID_RE.exec(line);
    if (uidMatch) {
      this._localAccountId = uidMatch[1];
    }

    const skipMatch = CLIENT_SKIP_RE.exec(line);
    if (skipMatch) {
      this._lastSeenTick = Number(skipMatch[1]);
      if (this._pendingGsmTick) {
        this._pendingGsmTick = false;
        const curR = this._activeRoundNumber;
        if (this._roundLevelLoadSeen.get(curR)) {
          this._roundGsmCandidates.set(curR, this._lastSeenTick);
        }
      }
    }

    const startPayload = extractGecNetPayload(line, 'matchStarted');
    if (startPayload && this._isPayloadRelevant(startPayload)) {
      this._sawMatchStarted = true;
      if (startPayload.MatchId && !this._pendingLiveMatchId) this._pendingLiveMatchId = startPayload.MatchId;
      this._pendingTeam0Name = startPayload.Team1Name ?? null;
      this._pendingTeam1Name = startPayload.Team2Name ?? null;
      if (Array.isArray(startPayload.Team1Members) && Array.isArray(startPayload.Team2Members)) {
        this._pendingIs2v2 = startPayload.Team1Members.length <= 2 && startPayload.Team2Members.length <= 2;
      }
      if (this.current) {
        if (!this.current.liveMatchId && this._pendingLiveMatchId) this.current.liveMatchId = this._pendingLiveMatchId;
        if (this._pendingTeam0Name) this.current.team0Name = this._pendingTeam0Name;
        if (this._pendingTeam1Name) this.current.team1Name = this._pendingTeam1Name;
        if (this._pendingIs2v2) this.current.is2v2 = true;
      }
    }

    // This line reliably arrives before a match's own Team/Kill/Damage
    // lines — often before this.current even opens — so it's captured
    // unconditionally here rather than inside the current-match dispatch
    // below, and attached to whichever match ends up owning it (this one,
    // if already open; the next one to open, otherwise).
    const vivoxMatch = VIVOX_MATCH_START_RE.exec(line);
    if (vivoxMatch) {
      const vid = vivoxMatch[1];
      if (this.current && this.current.liveMatchId && this.current.liveMatchId !== vid) {
        this._finalizeMatch({ MatchId: this.current.liveMatchId });
      }
      this._pendingLiveMatchId = vid;
      if (this.current && !this.current.liveMatchId) {
        this.current.liveMatchId = vid;
      }
    }

    const levelMatch = LEVEL_LOAD_RE.exec(line);
    if (levelMatch) {
      this._pendingMapLabel = `[${levelMatch[1].trim()}] ${levelMatch[2].trim()}`;
      this._roundLevelLoadSeen.set(this._activeRoundNumber, true);
    }

    if (line.indexOf(LOCK_BREAK_MARKER) !== -1) {
      const curR = this._activeRoundNumber;
      if (this._roundLevelLoadSeen.get(curR) && !this._roundActionStarts.has(curR) && this._lastSeenTick !== null) {
        this._roundActionStarts.set(curR, this._lastSeenTick);
      }
    }

    if (line.indexOf(GSM_MERGE_MARKER) !== -1) {
      this._pendingGsmTick = true;
    }

    const scorePayload = extractGecNetPayload(line, 'updateMatchScore');
    if (scorePayload && this._isPayloadRelevant(scorePayload)) {
      if (scorePayload.MatchId) {
        if (!this._pendingLiveMatchId) this._pendingLiveMatchId = scorePayload.MatchId;
        if (this.current && !this.current.liveMatchId) this.current.liveMatchId = scorePayload.MatchId;
      }
      if (scorePayload.Team1Name) {
        this._pendingTeam0Name = scorePayload.Team1Name;
        if (this.current && !this.current.team0Name) this.current.team0Name = scorePayload.Team1Name;
      }
      if (scorePayload.Team2Name) {
        this._pendingTeam1Name = scorePayload.Team2Name;
        if (this.current && !this.current.team1Name) this.current.team1Name = scorePayload.Team2Name;
      }
      if (Array.isArray(scorePayload.Team1Members) && Array.isArray(scorePayload.Team2Members)) {
        const is2v2 = scorePayload.Team1Members.length <= 2 && scorePayload.Team2Members.length <= 2;
        this._pendingIs2v2 = is2v2;
        if (this.current && is2v2) this.current.is2v2 = true;
      }
      if (this.current) {
        this.current.lastScoreUpdate = {
          attackerScore: scorePayload.AttackerScore,
          defenderScore: scorePayload.DefenderScore,
        };
      }
    }

    const killObj = line.indexOf(KILL_MARKER) !== -1 ? extractJsonObject(line, KILL_MARKER) : null;
    const damageObj = line.indexOf(DAMAGE_MARKER) !== -1 ? extractJsonObject(line, DAMAGE_MARKER) : null;
    const team0Obj = line.indexOf(TEAM_MARKER[0]) !== -1 ? extractJsonObject(line, TEAM_MARKER[0]) : null;

    if (killObj) this._lastSeenTick = Number(killObj.tick);
    if (damageObj) this._lastSeenTick = Number(damageObj.tick);

    if (this.current && this.current.roundsByNumber.size > 1) {
      const isRound1KillOrDmg = (killObj && killObj.round === 1) || (damageObj && damageObj.round === 1);
      const isRound1Team0 = team0Obj && Array.isArray(team0Obj.RoundOutcomes) && team0Obj.RoundOutcomes.length === 1;
      if (isRound1KillOrDmg || isRound1Team0) {
        this._finalizeMatch({ MatchId: this.current.liveMatchId });
      }
    }

    if (this.current === null) {
      const isMatchEvidence =
        line.indexOf(TEAM_MARKER[0]) !== -1 ||
        line.indexOf(TEAM_MARKER[1]) !== -1 ||
        line.indexOf(KILL_MARKER) !== -1 ||
        line.indexOf(DAMAGE_MARKER) !== -1 ||
        line.indexOf(KILLFEED_MARKER) !== -1;
      if (isMatchEvidence) {
        this.current = newMatch();
        this.current.liveMatchId = this._pendingLiveMatchId;
        this.current.team0Name = this._pendingTeam0Name;
        this.current.team1Name = this._pendingTeam1Name;
        this.current.is2v2 = this._pendingIs2v2;
        this._pendingLiveMatchId = null;
        this._sawMatchStarted = false;
        this._pendingIs2v2 = false;
        this._roundLevelLoadSeen.set(1, true);
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
    if (line.indexOf(TEAM_MARKER[2]) !== -1) {
      this._handleTeamBlock(2, line);
      return;
    }
    if (killObj) {
      this._round(killObj.round).kills.push(killObj);
      return;
    }
    if (damageObj) {
      this._round(damageObj.round).damage.push(damageObj);
      return;
    }
    if (line.indexOf(KILLFEED_MARKER) !== -1) {
      const m = KILLFEED_RE.exec(line);
      if (m) {
        const [, , killerName, verb, , victimName, tick] = m;
        const numTick = Number(tick);
        this._lastSeenTick = numTick;
        // Match-level, not per-round: killfeed lines arrive in real time as
        // a round is played, but Stats::Kill/Damage/Team for that same
        // round only flush as a single batch at the round's own end — so
        // "whichever round is currently open" while a killfeed line is
        // being read is actually still the PREVIOUS round for virtually the
        // entire live duration of the round the line really belongs to.
        // Confirmed live: round N's killfeed bucket, filed this way, held
        // round (N+1)'s real events. Callers instead match a killfeed
        // entry to a round by its own tick falling inside that round's
        // Stats::Kill/Damage tick range (see rescan.js) — the one thing
        // that's actually correct regardless of how mis-timed the write is.
        const upperKiller = killerName.toUpperCase();
        const upperVerb = verb.toUpperCase();
        const isPit = upperKiller === 'PIT' || upperVerb === 'ROASTED';
        const isUav = upperKiller === 'UAV' || upperVerb === 'ZAPPED';
        this.current.killFeed.push({
          killerName,
          verb,
          victimName,
          tick: numTick,
          // e.g. "UAV ZAPPED <player>" or "PIT ROASTED <player>" — a non-player kill,
          // not attributable to any player's personal stat line.
          isEnvironmentKill: isUav || isPit,
          isPitDeath: isPit,
        });
      }
      return;
    }

    const endedPayload = extractGecNetPayload(line, 'matchEnded');
    if (endedPayload && this._isPayloadRelevant(endedPayload)) {
      this._finalizeMatch(endedPayload);
      return;
    }

  }

  _round(number) {
    const rounds = this.current.roundsByNumber;
    if (!rounds.has(number)) rounds.set(number, newRound(number, this._pendingMapLabel));
    const r = rounds.get(number);
    if (r.actionStartTick === null) {
      if (this._roundActionStarts.has(number)) {
        r.actionStartTick = this._roundActionStarts.get(number);
      } else if (this._roundGsmCandidates.has(number)) {
        r.actionStartTick = this._roundGsmCandidates.get(number);
      }
    }
    return r;
  }

  _handleTeamBlock(side, line) {
    const obj = extractJsonObject(line, TEAM_MARKER[side]);
    if (!obj || !Array.isArray(obj.RoundOutcomes) || !Array.isArray(obj.Members)) return;

    if (side === 0 || side === 1) {
      const roundNumber = obj.RoundOutcomes.length;
      this._activeRoundNumber = roundNumber + 1;
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
    match.matchEndedPayload = endedPayload.AttackerScore !== undefined ? {
      attackerScore: endedPayload.AttackerScore,
      defenderScore: endedPayload.DefenderScore,
    } : null;
    match.finalScore = this._deriveFinalScore(match);

    for (const [rNum, r] of match.roundsByNumber) {
      const combatTicks = [...r.kills.map((k) => Number(k.tick)), ...r.damage.map((d) => Number(d.tick))];
      const minCombat = combatTicks.length > 0 ? Math.min(...combatTicks) : null;
      let start = r.actionStartTick;
      if (start === null || (minCombat !== null && start > minCombat)) {
        const gsm = this._roundGsmCandidates.get(rNum);
        if (gsm !== undefined && gsm !== null && (minCombat === null || gsm <= minCombat)) {
          start = gsm;
        }
      }
      r.actionStartTick = start;
    }

    this.matches.push(match);
    this.current = null;
    this._roundActionStarts.clear();
    this._roundGsmCandidates.clear();
    this._roundLevelLoadSeen.clear();
    this._activeRoundNumber = 1;
    this._pendingLiveMatchId = null;
    this._pendingTeam0Name = null;
    this._pendingTeam1Name = null;
    this._pendingIs2v2 = false;
    this._sawMatchStarted = false;
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
      for (const [rNum, r] of this.current.roundsByNumber) {
        if (!r.actionStartTick) {
          if (this._roundActionStarts.has(rNum)) {
            r.actionStartTick = this._roundActionStarts.get(rNum);
          } else if (this._roundGsmCandidates.has(rNum)) {
            r.actionStartTick = this._roundGsmCandidates.get(rNum);
          }
        }
      }
      list.push({ ...this.current, finalScore: this._deriveFinalScore(this.current) });
    }
    return list;
  }
}

