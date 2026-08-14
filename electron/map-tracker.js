'use strict';
// Tracks per-round map names from Player.log.
//
// Portable Node module — no Electron APIs, no dependency on parser.js —
// works from raw log text the same way parser.js does, so it's safe to
// feed it the exact same chunks.
//
// IMPORTANT, confirmed against real data: the map name line appears once
// PER ROUND, not once per match (the earlier assumption that it was
// per-match was wrong — 10 of these lines lined up 1:1 with 10 round-end
// Stats::Team blocks in a single still-in-progress match, i.e. this mode
// rotates the map every round). There's no shared id linking the line to a
// MatchId or round number, so it's associated purely by log order: the Nth
// map line seen while a match is open is that match's round-N map.
//
// Example source line:
//   Levels:: Loading game level and background ,[Bank] Arrow Obsidian [1966517414] (),bank level set bank
// displayed as "[Bank] Arrow Obsidian".

const MAP_LINE_RE =
  /Levels:: Loading game level and background\s*,\s*\[([^\]]+)\]\s*(.+?)\s*\[(-?\d+)\]/i;

class MapTracker {
  constructor() {
    this._pending = []; // map labels seen so far, in file order, not yet consumed by a finalized match
  }

  /** Feed the same raw text chunk (full file or incremental) passed to the log parser. */
  feedText(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const m = MAP_LINE_RE.exec(line);
      if (m) {
        const [, tileset, mapName, seed] = m;
        this._pending.push({ tileset, mapName, seed, label: `[${tileset}] ${mapName}` });
      }
    }
  }

  /**
   * Consume and return the maps for a just-finalized match's `roundCount`
   * rounds (in round order, index 0 = round 1). Call this once per
   * completed match, in the same order matches complete in the log.
   */
  takeForRounds(roundCount) {
    return this._pending.splice(0, roundCount);
  }

  /**
   * Peek at the maps accumulated so far for the current in-progress match,
   * without consuming them (safe to call repeatedly while a match is live).
   */
  peekCurrent() {
    return [...this._pending];
  }
}

module.exports = { MapTracker };
