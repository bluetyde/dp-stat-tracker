'use strict';
// Identifies which AccountId in a parsed match is "you".
//
// Portable Node module — no Electron APIs — so it works the same way from
// any host that feeds it raw Player.log text (this Electron app, a future
// Overwolf overlay, a CLI script, etc).
//
// Confirmed against real Player.log: the client logs a plain-text line like
//   Aunthentication: Client UID set to 10 (76561198189294289)
// (the "10" is a local connection slot number, not stable — only the
// Steam64 id in parentheses is used here.) This line is emitted once per
// session, fairly early, before the first round starts.

const LOCAL_UID_RE = /Client UID set to \d+ \((\d+)\)/;

/** Returns the first AccountId found in `text`, or null if none present. */
function findLocalAccountId(text) {
  const m = LOCAL_UID_RE.exec(text);
  return m ? m[1] : null;
}

module.exports = { findLocalAccountId };
