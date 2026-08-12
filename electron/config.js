'use strict';
// The exe name below was confirmed from the actual Player.log during
// development (from its own "Command line args are:" line). The log path
// follows Unity's standard per-user LocalLow location, built from the
// current OS user so this works unmodified on any Windows account.

const os = require('node:os');
const path = require('node:path');

const PLAYER_LOG_PATH = path.join(
  'C:\\Users',
  os.userInfo().username,
  'AppData\\LocalLow\\Giant Enemy Crab\\Due Process\\Player.log'
);

module.exports = {
  DUE_PROCESS_EXE_NAME: 'DueProcess.exe',
  PLAYER_LOG_PATH,

  // Due Process rotates its own log on each game launch: the previous
  // session's Player.log becomes Player-prev.log, and anything older than
  // that is deleted — only these two files ever exist on disk at once. See
  // main.js's startup rescan and the note in store.js.
  PLAYER_PREV_LOG_PATH: path.join(path.dirname(PLAYER_LOG_PATH), 'Player-prev.log'),

  // How often to check `tasklist` for the game process.
  GAME_POLL_INTERVAL_MS: 4000,

  // Manual overlay show/hide toggle. Alt+` has no common Windows/browser
  // conflict, but backtick is the conventional dev-console key in a lot of
  // Unity-based games (Due Process is built on Unity) — this is Alt+backtick,
  // not bare backtick, so a collision with a bare-key console bind is
  // unlikely, but not confirmed one way or the other. Watch for it in-game;
  // change here if it turns out to clash.
  OVERLAY_HOTKEY: 'Alt+`',
};
