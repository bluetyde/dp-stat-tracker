'use strict';
// The exe name below was confirmed from the actual Player.log during
// development (from its own "Command line args are:" line). The log path
// follows Unity's standard per-user LocalLow location, built from the
// current OS user so this works unmodified on any Windows account.

const os = require('node:os');
const path = require('node:path');

const PLAYER_LOG_PATH = path.join(
  os.homedir(),
  'AppData',
  'LocalLow',
  'Giant Enemy Crab',
  'Due Process',
  'Player.log'
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

  // Manual overlay show/hide toggle. Control+Shift+Y is used to avoid
  // conflicts with terminal shortcuts (e.g. Quake-mode backtick keybinds),
  // browser shortcuts, or in-game hotkeys.
  OVERLAY_HOTKEY: 'Control+Shift+Y',
};
