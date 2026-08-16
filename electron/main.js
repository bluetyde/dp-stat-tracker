'use strict';
// Electron main process. Run from due-process-scoreboard/ with:
//   npx electron .
//
// parser.js and stats.js are reused unchanged (see ../parser.js, ../stats.js).
// They're ES modules; main.js stays CommonJS and loads them via a dynamic
// import() so nothing about them had to change.

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { exec } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, screen, globalShortcut, ipcMain, shell, desktopCapturer } = require('electron');

app.setName('due-process-scoreboard');

const config = require('./config');
const { MatchArchive } = require('./match-archive');
const { findLocalAccountId } = require('./local-player');
const { MapTracker } = require('./map-tracker');
const { MapLayoutLibrary } = require('./map-layout-library');
const { ThemeStore, DEFAULT_THEME } = require('./theme-store');
const { recordCompletedMatch, scanLogFileForCompletedMatches } = require('./rescan');

let overlayWindow = null;
let hubWindow = null;
let rankedArchive = null; // match-archive.json — ranked (7-X / 6-6) matches, the ONLY source for career totals
let otherArchive = null; // other-matches-archive.json — everything else (unranked, 2v2, Push, ...), never counted toward totals
let mapLayoutLibrary = null;
let themeStore = null; // theme.json — 'dark' | 'light', shared by both windows (see theme-store.js)
// Holds the just-captured (not yet saved) picture between the hotkey press
// and the user confirming it in the Hub's preview popup — see
// captureMapScreenshot() and the hub:map-screenshot-confirm/retry handlers.
let pendingMapScreenshot = null;

let DueProcessLogParser = null;
let computeMatchStats = null;
let roundRoleByRosterSide = null;
let deriveFinalScoreFromRounds = null;
let parser = null;
const mapTracker = new MapTracker();

let logCursor = 0; // byte offset already fed to the parser
let localAccountId = null;
let watchingLogPath = null;
let processingChange = false;

let overlayManuallyVisible = null; // null = follow game detection; true/false = hotkey override until next game-state flip
let lastGameRunning = false;

// Debounced, separate from the overlay-visibility toggle above (which
// reacts every poll on purpose) — this one only fires on a CONFIRMED exit,
// used to trigger inferred match completion (see handleConfirmedGameExit).
let consecutiveNotRunningPolls = 0;
let lastConfirmedGameRunning = true; // assume true until the first poll settles, so app-launch-before-first-check never reads as a false exit

// ---------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------

function createOverlayWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 1120;
  const height = 420;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + 40,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    resizable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createHubWindow() {
  // Matches the current theme's --bg so the window's own background (visible
  // for a frame before hub.html finishes loading) doesn't flash the wrong
  // color under the light palette.
  const bg = themeStore && themeStore.get() === 'light' ? '#f3f5f7' : '#0d1013';
  hubWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    alwaysOnTop: false,
    title: 'Due Process Tracker',
    backgroundColor: bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hubWindow.loadFile(path.join(__dirname, 'hub.html'));
  hubWindow.on('closed', () => {
    hubWindow = null;
  });
}

// Creates the Hub window if it doesn't exist yet, and calls `onReady` once
// it's actually able to receive IPC — immediately if it's already loaded,
// or after `did-finish-load` if it's missing or still mid-load. Centralizing
// the three-way "missing / loading / ready" branch here means a second
// caller arriving while the window is still loading (e.g. two overlay
// clicks in quick succession) also waits for `did-finish-load` instead of
// sending straight into a renderer that hasn't registered its listeners
// yet — sending to a not-yet-loaded webContents doesn't queue, it's simply
// never received.
function ensureHubWindowReady(onReady) {
  if (!hubWindow || hubWindow.isDestroyed()) {
    createHubWindow();
    hubWindow.webContents.once('did-finish-load', onReady);
    return;
  }
  if (hubWindow.webContents.isLoading()) {
    hubWindow.webContents.once('did-finish-load', onReady);
    return;
  }
  onReady();
}

// ---------------------------------------------------------------------
// Game detection (poll `tasklist`, show/hide the overlay)
// ---------------------------------------------------------------------

function isGameRunning() {
  return new Promise((resolve) => {
    const exeName = config.DUE_PROCESS_EXE_NAME;
    exec(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(stdout.toLowerCase().includes(exeName.toLowerCase()));
    });
  });
}

function applyOverlayVisibility() {
  if (!overlayWindow) return;
  const shouldShow = overlayManuallyVisible !== null ? overlayManuallyVisible : lastGameRunning;
  if (shouldShow && !overlayWindow.isVisible()) overlayWindow.show();
  if (!shouldShow && overlayWindow.isVisible()) overlayWindow.hide();
}

function startGameDetection() {
  setInterval(async () => {
    const running = await isGameRunning();
    if (running !== lastGameRunning) {
      lastGameRunning = running;
      // A real game-state change clears any manual hotkey override, so
      // detection takes back over automatically once the game starts/exits.
      overlayManuallyVisible = null;
    }
    applyOverlayVisibility();

    // Separate, debounced signal for inferred match completion (see
    // handleConfirmedGameExit) — require two consecutive "not running"
    // polls before treating it as a real exit, so one momentary tasklist
    // hiccup doesn't fire a false completion. Independent of the
    // immediate-response overlay toggle above on purpose.
    if (running) {
      consecutiveNotRunningPolls = 0;
      lastConfirmedGameRunning = true;
    } else {
      consecutiveNotRunningPolls += 1;
      if (consecutiveNotRunningPolls >= 2 && lastConfirmedGameRunning) {
        lastConfirmedGameRunning = false;
        handleConfirmedGameExit();
      }
    }
  }, config.GAME_POLL_INTERVAL_MS);
}

// The game routinely gets closed right when a match's result is decided,
// before the client returns to the menu — which is apparently when the
// normal matchEnded teardown sequence actually writes to the log (observed
// firsthand: a match sitting at a decisive 7-3 score with zero matchEnded
// and zero teardown log lines, hours after the score stopped changing). So
// a legitimately finished match can end up with no matchEnded at all, ever.
// This infers completion instead, from the currently-tracked live match's
// own last-known Team RoundWins — through the exact same recordCompletedMatch()
// used everywhere else (same MatchId dedup, same ranked-score gate, same
// ranked/other routing), not a separate path. Never fires for a match that
// isn't already decisive: see recordCompletedMatch's inferred branch.
function handleConfirmedGameExit() {
  if (!parser || !parser.current) return; // nothing currently tracked — nothing to infer
  const accountId = localAccountId || rankedArchive.getLocalAccountId();
  const recorded = recordCompletedMatch(parser.current, {
    rankedArchive,
    otherArchive,
    computeMatchStats,
    roundRoleByRosterSide,
    mapTracker,
    accountId,
    inferred: true,
    deriveFinalScoreFromRounds,
  });
  if (recorded) {
    console.log(`Inferred match completion recorded on game exit (liveMatchId ${parser.current.liveMatchId}).`);
    sendHubUpdate();
  }
}

function toggleOverlayManually() {
  const currentlyShown = overlayManuallyVisible !== null ? overlayManuallyVisible : lastGameRunning;
  overlayManuallyVisible = !currentlyShown;
  applyOverlayVisibility();
}

// ---------------------------------------------------------------------
// Map layout screenshot capture
// ---------------------------------------------------------------------

// One picture per unique (tileset, mapName) layout, captured on demand via
// MAP_SCREENSHOT_HOTKEY — not automatic, not per-round. See
// map-layout-library.js for why once-per-layout is enough. Pushes a preview
// to the Hub for the user to confirm/retry rather than saving blind, since
// there's no way to verify from here that the player was actually looking
// at the map screen when the hotkey fired.
async function captureMapScreenshot() {
  const current = mapTracker.peekCurrent().at(-1);
  if (!current) {
    notifyMapScreenshot({ kind: 'error', message: 'No map detected yet — start a round first.' });
    return;
  }
  const { tileset, mapName, seed } = current;

  if (mapLayoutLibrary.hasPicture(tileset, mapName)) {
    notifyMapScreenshot({ kind: 'info', message: `Already have a picture for ${mapName}.` });
    return;
  }

  let sources;
  try {
    sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 } });
  } catch (err) {
    console.error('captureMapScreenshot: desktopCapturer.getSources failed', err);
    notifyMapScreenshot({ kind: 'error', message: 'Screen capture failed — see console.' });
    return;
  }

  // Our own Hub ("Due Process Tracker") and overlay ("Due Process Overlay")
  // windows both match a plain "dueprocess" substring too, and desktopCapturer
  // lists every window on the system including this app's own — confirmed
  // live: with the overlay visible, its window was winning this match and
  // getting captured instead of the actual game. Excluding "tracker"/"overlay"
  // rules out both of this app's own windows regardless of which happens to
  // be listed first, without needing to know the real game window's exact title.
  const source = sources.find((s) => {
    const name = s.name.toLowerCase().replace(/\s+/g, '');
    return name.includes('dueprocess') && !name.includes('tracker') && !name.includes('overlay');
  });
  if (!source) {
    notifyMapScreenshot({ kind: 'error', message: 'Due Process window not found — is the game running?' });
    return;
  }

  pendingMapScreenshot = { tileset, mapName, seed, pngBuffer: source.thumbnail.toPNG() };
  ensureHubWindowReady(() => {
    hubWindow.webContents.send('hub:map-screenshot-preview', {
      tileset,
      mapName,
      dataUrl: source.thumbnail.toDataURL(),
    });
  });
  hubWindow.show();
  hubWindow.focus();
}

// Passive FYI (already captured / no map / capture failed) — unlike the
// preview above, this never opens or focuses the Hub, since it isn't
// actionable and shouldn't yank focus away from the game mid-round. Just
// logged if the Hub isn't already open to receive it.
function notifyMapScreenshot(payload) {
  if (hubWindow && !hubWindow.isDestroyed() && !hubWindow.webContents.isLoading()) {
    hubWindow.webContents.send('hub:map-screenshot-notice', payload);
  } else {
    console.log(`Map screenshot notice (Hub not open): ${payload.message}`);
  }
}

// ---------------------------------------------------------------------
// Log tailing
// ---------------------------------------------------------------------

async function readFullLogSoFar() {
  try {
    return await fsp.readFile(config.PLAYER_LOG_PATH, 'utf8');
  } catch {
    return '';
  }
}

function feedChunk(text) {
  if (!text) return;
  parser.feedText(text);
  mapTracker.feedText(text);
  if (!localAccountId) {
    localAccountId = findLocalAccountId(text) || null;
    if (localAccountId) {
      rankedArchive.setLocalAccountId(localAccountId);
      otherArchive.setLocalAccountId(localAccountId);
    }
  }
}

async function initialLogRead() {
  const text = await readFullLogSoFar();
  feedChunk(text);
  logCursor = Buffer.byteLength(text, 'utf8');
  onParserUpdate();
}

async function handleLogChange() {
  if (processingChange) return;
  processingChange = true;
  try {
    const stat = await fsp.stat(config.PLAYER_LOG_PATH).catch(() => null);
    if (!stat) return;

    if (stat.size < logCursor) {
      // The game truncates/replaces Player.log at the start of each new
      // session (observed firsthand) — treat this as a fresh log.
      parser = new DueProcessLogParser();
      logCursor = 0;
    }
    if (stat.size <= logCursor) return;

    const stream = fs.createReadStream(config.PLAYER_LOG_PATH, {
      start: logCursor,
      encoding: 'utf8',
    });
    let chunk = '';
    for await (const part of stream) chunk += part;
    feedChunk(chunk);
    logCursor = stat.size;
    onParserUpdate();
  } finally {
    processingChange = false;
  }
}

function watchLogFile() {
  if (watchingLogPath === config.PLAYER_LOG_PATH) return;
  try {
    fs.watch(config.PLAYER_LOG_PATH, { persistent: true }, () => {
      handleLogChange();
    });
    watchingLogPath = config.PLAYER_LOG_PATH;
  } catch {
    // File doesn't exist yet (game hasn't been launched this boot) — poll
    // for it to appear rather than crashing the watcher setup.
    setTimeout(watchLogFile, 5000);
  }
}

async function startLogTailing() {
  await initialLogRead();
  watchLogFile();
  // Also poll on the same cadence as game detection, in case fs.watch
  // misses an event (has happened historically on some Windows/network
  // filesystem combinations) or the file didn't exist at startup.
  setInterval(handleLogChange, config.GAME_POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------
// Parser -> stats -> windows / archives
// ---------------------------------------------------------------------

function onParserUpdate() {
  const matches = parser ? parser.getMatches() : [];
  const accountId = localAccountId || rankedArchive.getLocalAccountId();
  let recordedAny = false;
  if (parser) {
    for (const match of parser.matches) {
      if (recordCompletedMatch(match, { rankedArchive, otherArchive, computeMatchStats, roundRoleByRosterSide, mapTracker, accountId })) {
        recordedAny = true;
      }
    }
  }
  if (recordedAny) sendHubUpdate();

  const latest = matches.length > 0 ? matches[matches.length - 1] : null;
  const stats = latest ? computeMatchStats(latest) : null;
  sendOverlayUpdate(latest, stats);
}

function sendOverlayUpdate(match, stats) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('overlay:update', {
    status: match?.status ?? 'waiting',
    finalScore: stats?.finalScore ?? null,
    roundCount: stats?.roundCount ?? 0,
    teams: stats?.teams ?? { 0: [], 1: [] },
    currentMap: mapTracker.peekCurrent().at(-1)?.label ?? null,
    localAccountId: localAccountId || rankedArchive.getLocalAccountId(),
    overlayHotkey: config.OVERLAY_HOTKEY,
  });
}

// Prefers the live-tailing parser (has this session's freshest name, if any
// match data has been fed yet) but falls back to the archives, which persist
// each match's `teams` rows durably. The fallback matters: sendHubUpdate()
// fires once during startup (main()'s Step 2) BEFORE startLogTailing() has
// fed `parser` anything at all, so relying on the parser alone left the name
// blank on every boot where nothing new got recorded that session — see
// match-archive.js's getPlayerName() doc comment.
function currentPlayerName() {
  const accountId = localAccountId || rankedArchive.getLocalAccountId();
  if (!accountId) return null;

  if (parser) {
    const matches = parser.getMatches();
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const known = matches[i].players.get(accountId);
      if (known) return known.name;
    }
  }

  return rankedArchive.getPlayerName(accountId) ?? otherArchive.getPlayerName(accountId);
}

function computeWinPrediction(teams, playedWithStats, localLifetimeStats) {
  if (!teams || !teams[0] || !teams[1]) return null;

  // playedWithStats (rankedArchive.getPlayedWithStats()) deliberately
  // excludes the local player (it's "who you've played with/against"), so
  // playedWithMap never has an entry for either team's local-player row.
  // Every other player's rating here is their stable lifetime aggregate from
  // playedWithMap; without a special case, the local player would instead
  // fall through to r.dplRating — the CURRENT live match's own in-progress
  // rating (stats.js's calculateDplRating, recomputed every update from
  // just this match's partial rounds), not a historical average. That's
  // inconsistent with every teammate's rating source and noisy/unstable
  // early in a match. Substitute the local player's own lifetime dplRating
  // (same formula, computeDplRating in match-archive.js, fed their summed
  // career stats — see getLifetimeStats()) so the comparison is apples-to-
  // apples with everyone else's rating. Set directly into playedWithMap
  // (rather than special-cased per-row in the reduce below) so the map
  // itself is the single source of "every player's rating, local included" —
  // any future consumer of playedWithMap gets the fix for free instead of
  // needing its own local-player special case.
  const playedWithMap = new Map((playedWithStats ?? []).map((p) => [p.accountId, p.dplRating]));
  const myAccountId = localAccountId || rankedArchive.getLocalAccountId();
  if (myAccountId && localLifetimeStats) playedWithMap.set(myAccountId, localLifetimeStats.dplRating);

  const getTeamAvgRating = (teamRows) => {
    if (!teamRows || teamRows.length === 0) return 1.0;
    const sum = teamRows.reduce((acc, r) => {
      const rating = playedWithMap.get(r.accountId) ?? r.dplRating ?? 1.0;
      return acc + rating;
    }, 0);
    return sum / teamRows.length;
  };

  const avg0 = getTeamAvgRating(teams[0]);
  const avg1 = getTeamAvgRating(teams[1]);

  const diff = avg0 - avg1;
  const prob0 = 1 / (1 + Math.pow(10, -diff / 0.50));
  const winRate0 = Math.round(prob0 * 100);
  const winRate1 = 100 - winRate0;

  return {
    avgRating0: Math.round(avg0 * 100) / 100,
    avgRating1: Math.round(avg1 * 100) / 100,
    team0WinChance: winRate0,
    team1WinChance: winRate1,
    predictedWinner: winRate0 >= 50 ? 0 : 1,
  };
}

function getLiveMatchState(playedWithStats, localLifetimeStats) {
  if (!parser || !parser.current) return null;
  const match = parser.current;
  const stats = computeMatchStats(match);
  const prediction = computeWinPrediction(stats.teams, playedWithStats, localLifetimeStats);
  return {
    status: match.status,
    liveMatchId: match.liveMatchId,
    roundCount: stats.roundCount,
    finalScore: stats.finalScore,
    teams: stats.teams,
    currentMap: mapTracker.peekCurrent().at(-1)?.label ?? null,
    prediction,
  };
}

function sendHubUpdate() {
  if (!hubWindow || hubWindow.isDestroyed()) return;
  // Computed once and reused for both keys below — hub-renderer.js reads
  // `playedWith` (live-match prediction lookups) and `playedWithStats` (the
  // Played With tab itself) as separate names, but they're the exact same
  // data; calling getPlayedWithStats() twice just redid the same
  // all-matches aggregation for no reason.
  const playedWithStats = rankedArchive.getPlayedWithStats();
  // Also computed once and reused below — getLifetimeStats() sums the whole
  // archive (plus a second full pass in _streaks()) on every call, and
  // computeWinPrediction needs the same local-player dplRating this
  // function already needs for the `lifetime` key.
  const lifetimeStats = rankedArchive.getLifetimeStats();
  hubWindow.webContents.send('hub:update', {
    // Reads package.json's "version" directly (Electron's own mechanism,
    // not a separately-maintained copy) — hub.html's "Tracker vX.Y" label
    // had been hardcoded and drifted stale across several version bumps.
    appVersion: app.getVersion(),
    playerName: currentPlayerName(),
    // Raw accountId (not just the display name above) — the Career Overview
    // avatar fetch needs it for hub:get-steam-avatar the same way every
    // Played With row does; that IPC handler validates it main-process side
    // regardless (see isValidSteamAccountId in this file), so exposing the
    // raw value here doesn't open up anything the hardening doesn't already
    // cover.
    localAccountId: localAccountId || rankedArchive.getLocalAccountId(),
    // Career totals are derived ONLY from rankedArchive — see match-archive.js
    // (summed fresh on every read) and rescan.js (routing by score shape).
    lifetime: lifetimeStats,
    recentMatches: rankedArchive.getRecentMatches(8),
    otherMatches: otherArchive.getRecentMatches(8),
    topWeapons: rankedArchive.getTopWeapons(4),
    weaponStats: rankedArchive.getWeaponStats(),
    killsTrend: rankedArchive.getRecentKillsTrend(12),
    playedWith: playedWithStats,
    playedWithStats: playedWithStats,
    mapStats: rankedArchive.getMapStats(),
    liveMatch: getLiveMatchState(playedWithStats, lifetimeStats),
  });
}

const steamAvatarCache = new Map();
const httpsClient = require('node:https');

// accountId here traces back to parser.js's Stats::Team block parsing
// (m.AccountId, straight out of opponent/teammate JSON broadcast during a
// match) — semi-trusted, attacker-influenced data, not something the local
// user typed or controls. Steam64 ids are always plain digit strings, so
// that's the full accepted shape; anything else is rejected before it ever
// reaches a URL or shell.openExternal.
const STEAM_ACCOUNT_ID_RE = /^\d+$/;

function isValidSteamAccountId(accountId) {
  return typeof accountId === 'string' && STEAM_ACCOUNT_ID_RE.test(accountId);
}

// Single point where a Steam profile URL gets built from an accountId —
// used by both the avatar-fetch handler and the profile-link opener below,
// so the validation above only has to live in one place. Returns null
// (never a URL) for anything that fails isValidSteamAccountId, so an
// invalid accountId can't reach either https.get() or shell.openExternal.
function buildSteamProfileUrl(accountId, { xml = false } = {}) {
  if (!isValidSteamAccountId(accountId)) return null;
  return `https://steamcommunity.com/profiles/${accountId}${xml ? '?xml=1' : ''}`;
}

function handleGetSteamAvatar(_event, accountId) {
  const url = buildSteamProfileUrl(accountId, { xml: true });
  if (!url) {
    console.warn(`hub:get-steam-avatar: rejected non-numeric accountId (${JSON.stringify(accountId)})`);
    return Promise.resolve(null);
  }
  if (steamAvatarCache.has(accountId)) {
    return Promise.resolve(steamAvatarCache.get(accountId));
  }
  return new Promise((resolve) => {
    const req = httpsClient.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        const match = /<avatarFull><!\[CDATA\[([^\]]+)\]\]><\/avatarFull>/.exec(body) ||
                      /<avatarFull>([^<]+)<\/avatarFull>/.exec(body) ||
                      /<avatarMedium><!\[CDATA\[([^\]]+)\]\]><\/avatarMedium>/.exec(body) ||
                      /<avatarMedium>([^<]+)<\/avatarMedium>/.exec(body);
        const avatarUrl = match ? match[1] : null;
        if (avatarUrl) {
          steamAvatarCache.set(accountId, avatarUrl);
        }
        resolve(avatarUrl);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(null);
    });
  });
}
ipcMain.handle('hub:get-steam-avatar', handleGetSteamAvatar);

// Due Process's Steam app id, hardcoded — the only parameter this request
// ever sends, so there's no variable input to validate the way accountId
// needs isValidSteamAccountId above. No API key required for this specific
// endpoint. Not cached: only ever called on Hub load and manual refresh
// clicks, never polled, so a fresh number each time is exactly what's
// wanted rather than something to dedupe against.
const DUE_PROCESS_STEAM_APP_ID = 753650;

function handleGetPlayerCount() {
  return new Promise((resolve) => {
    const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${DUE_PROCESS_STEAM_APP_ID}`;
    const req = httpsClient.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const count = parsed?.response?.player_count;
          resolve(typeof count === 'number' ? count : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(null);
    });
  });
}
ipcMain.handle('hub:get-player-count', handleGetPlayerCount);

ipcMain.on('hub:request-refresh', () => {
  sendHubUpdate();
});

// Synchronous on purpose: read by preload.js's top-of-file (module-load-time)
// code, before either window's <head> has parsed far enough to apply
// theme.css — so the very first paint already carries the right
// [data-theme] attribute instead of flashing dark-then-light (or vice
// versa) on every launch. themeStore is assigned in main() before either
// window is created, so it's always populated by the time a renderer can
// possibly ask.
ipcMain.on('theme:get-sync', (event) => {
  event.returnValue = themeStore ? themeStore.get() : DEFAULT_THEME;
});

// Fire-and-forget: persists the choice and pushes it to both windows so
// neither one silently keeps the old theme. Broadcasting back to the
// sender too (rather than special-casing it) keeps this simple — the
// sender's own listener just re-applies the same value it already set
// optimistically.
ipcMain.on('theme:set', (_event, theme) => {
  const applied = themeStore.set(theme);
  for (const win of [overlayWindow, hubWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('theme:changed', applied);
  }
});

// Match-detail view (click-through from either list) reads straight from
// whichever archive actually has it — works even after the source log has
// rotated away, since the full scoreboard was persisted at record time.
ipcMain.handle('hub:get-match-detail', (_event, matchId) => {
  const rankedMatch = rankedArchive.getMatch(matchId);
  if (rankedMatch) return { ...rankedMatch, isRanked: true };
  const otherMatch = otherArchive.getMatch(matchId);
  return otherMatch ? { ...otherMatch, isRanked: false } : null;
});

ipcMain.handle('hub:get-player-detail', (_event, accountId) => {
  return rankedArchive.getSinglePlayedWith(accountId);
});

// Overlay -> Hub click-through: the overlay window can't open its own modal
// (it has no such UI), so this ensures the Hub window exists, brings it
// forward, and pushes the accountId over for hub-renderer.js's
// onShowPlayerDetail listener to open via its own existing openPlayerDetail().
// sendHubUpdate() runs first (same tick, same webContents, so it's
// guaranteed to be processed by the renderer before hub:show-player-detail
// right behind it) so latestHubData.localAccountId is populated before
// openPlayerDetail's isSelf check runs — otherwise a freshly-created Hub
// window racing its own independent requestRefresh() call could still have
// latestHubData null/stale, misrouting a click on your own row into the
// "unknown player" branch instead of the self view.
ipcMain.on('overlay:open-player-detail', (_event, accountId) => {
  ensureHubWindowReady(() => {
    sendHubUpdate();
    hubWindow.webContents.send('hub:show-player-detail', accountId);
  });
  hubWindow.show();
  hubWindow.focus();
});

// Both push a fresh hub:update after saving, same as every other
// archive-mutating handler (record/delete) already does — without it,
// hub-renderer.js's latestHubData.mapStats keeps the pre-edit snapshot, so
// switching tabs and back (or a filter/sort click, which all re-render
// Maps from that cache) would show the edit as having reverted even though
// it saved correctly.
ipcMain.handle('hub:save-map-note', (_event, mapName, note) => {
  rankedArchive.saveMapNote(mapName, note);
  sendHubUpdate();
});

ipcMain.handle('hub:save-map-tags', (_event, mapName, tags) => {
  rankedArchive.saveMapTags(mapName, tags);
  sendHubUpdate();
});

ipcMain.handle('hub:export-csv', (_event, which) => {
  const archive = which === 'other' ? otherArchive : rankedArchive;
  return archive.exportCsv();
});

ipcMain.handle('hub:open-external', (_event, url) => {
  if (url && typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// Dedicated handler for the Played With tab's "STEAM ↗" buttons — separate
// from the generic hub:open-external above (which also opens hardcoded,
// trusted weapon-wiki links and stays a plain scheme check) because this
// one's URL is built from accountId, semi-trusted match data. Takes the raw
// accountId rather than a renderer-built URL string, so the numeric
// validation and URL construction both happen here, main-process side,
// through the same buildSteamProfileUrl() the avatar fetch uses — the
// renderer never gets to hand this handler an arbitrary string.
// Belt-and-suspenders on top of buildSteamProfileUrl's accountId regex:
// parses `url` and checks its scheme/host explicitly, rather than a plain
// url.includes('steamcommunity.com') check, which would incorrectly pass
// for an attacker-crafted host like "steamcommunity.com.evil.com" — the
// parsed hostname only ever reflects the actual authority component, so
// that kind of suffix trick can't fool it. Standalone (not folded into
// handleOpenSteamProfile) so this specific safeguard can be exercised
// directly against a crafted URL, independent of accountId validation.
function isSteamCommunityUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && parsed.hostname === 'steamcommunity.com';
}

function handleOpenSteamProfile(_event, accountId) {
  const url = buildSteamProfileUrl(accountId);
  if (!url) {
    console.warn(`hub:open-steam-profile: rejected non-numeric accountId (${JSON.stringify(accountId)})`);
    return false;
  }
  if (!isSteamCommunityUrl(url)) {
    console.warn(`hub:open-steam-profile: scheme/host check failed (${url})`);
    return false;
  }
  shell.openExternal(url);
  return true;
}
ipcMain.handle('hub:open-steam-profile', handleOpenSteamProfile);

// Full (uncapped) match lists for the Ranked History / Other History nav
// views — deliberately separate from hub:update's regular payload (which
// stays capped at getRecentMatches(8) for the Home feed) so switching to a
// history view doesn't inflate every routine push once an archive grows
// into the hundreds of matches. Fetched on demand when the view is opened.
ipcMain.handle('hub:get-ranked-history', () => {
  return rankedArchive.getRecentMatches(Number.MAX_SAFE_INTEGER);
});
ipcMain.handle('hub:get-other-history', () => {
  return otherArchive.getRecentMatches(Number.MAX_SAFE_INTEGER);
});

// Delete a match from whichever archive it lives in, then push fresh
// (re-derived, since totals are summed on read) totals/lists to the Hub.
//
// FLAGGED BEHAVIOR: dedup (hasRecordedMatch) only ever looks at what's
// CURRENTLY in the archive files. Deleting an entry makes that MatchId
// "unseen" again — if it's still reachable in Player.log or Player-prev.log
// the next time a scan runs, it WILL be re-recorded. This is a deliberate
// consequence of archive-state-based dedup (see match-archive.js's
// deleteMatch doc comment), not prevented or specially handled here.
ipcMain.handle('hub:delete-match', (_event, matchId) => {
  const deleted = rankedArchive.deleteMatch(matchId) || otherArchive.deleteMatch(matchId);
  if (deleted) sendHubUpdate();
  return deleted;
});

// See captureMapScreenshot() — pendingMapScreenshot holds the just-captured
// bytes between the hotkey press and the user confirming/retrying in the
// Hub's preview popup.
ipcMain.on('hub:map-screenshot-confirm', () => {
  if (!pendingMapScreenshot) return;
  const { tileset, mapName, seed, pngBuffer } = pendingMapScreenshot;
  mapLayoutLibrary.savePicture(tileset, mapName, seed, pngBuffer);
  pendingMapScreenshot = null;
  notifyMapScreenshot({ kind: 'info', message: `Saved picture for ${mapName}.` });
});

ipcMain.on('hub:map-screenshot-retry', () => {
  pendingMapScreenshot = null;
  captureMapScreenshot();
});

ipcMain.on('hub:map-screenshot-cancel', () => {
  pendingMapScreenshot = null;
});

// Returns a file:// URL for the renderer's <img src>, or null if this
// layout has never been captured — the Map Layout History modal falls back
// to the generic tileset icon in that case.
ipcMain.handle('hub:get-map-layout-picture', (_event, tileset, mapName) => {
  const filePath = mapLayoutLibrary.getPicturePath(tileset, mapName);
  return filePath ? pathToFileURL(filePath).href : null;
});

// ---------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------

async function main() {
  // parser.js / stats.js are ES modules and are reused unchanged; dynamic
  // import() is how a CommonJS file (this one) loads them.
  const parserModule = await import(pathToFileURL(path.join(__dirname, '..', 'parser.js')));
  const statsModule = await import(pathToFileURL(path.join(__dirname, '..', 'stats.js')));
  DueProcessLogParser = parserModule.DueProcessLogParser;
  deriveFinalScoreFromRounds = parserModule.deriveFinalScoreFromRounds;
  computeMatchStats = statsModule.computeMatchStats;
  roundRoleByRosterSide = statsModule.roundRoleByRosterSide;
  parser = new DueProcessLogParser();

  await app.whenReady();

  // Step 1: load both archives directly — match-archive.json is the totals
  // source of truth (match-archive.js sums it on read), so the Hub can show
  // correct history the moment its window is ready, with no rescanning
  // needed just to display what's already recorded.
  const userDataDir = app.getPath('userData');
  rankedArchive = new MatchArchive(path.join(userDataDir, 'match-archive.json'));
  otherArchive = new MatchArchive(path.join(userDataDir, 'other-matches-archive.json'));
  mapLayoutLibrary = new MapLayoutLibrary(path.join(userDataDir, 'map-layouts'));
  themeStore = new ThemeStore(path.join(userDataDir, 'theme.json'));
  localAccountId = rankedArchive.getLocalAccountId() || otherArchive.getLocalAccountId();

  createOverlayWindow();

  // Renderers may finish loading after the first update already fired (or
  // before any log activity happens at all) — re-push current state once
  // each window is actually ready to receive it. Both handlers are
  // idempotent (onParserUpdate recomputes from current state;
  // recordCompletedMatch is dedupe-guarded), so re-sending is harmless.
  overlayWindow.webContents.once('did-finish-load', () => onParserUpdate());
  ensureHubWindowReady(() => sendHubUpdate());

  const registered = globalShortcut.register(config.OVERLAY_HOTKEY, toggleOverlayManually);
  if (registered) {
    console.log(`Successfully registered global overlay hotkey: ${config.OVERLAY_HOTKEY}`);
  } else {
    console.warn(`FAILED to register global overlay hotkey ${config.OVERLAY_HOTKEY} — it may be in use by another app.`);
  }

  const mapHotkeyRegistered = globalShortcut.register(config.MAP_SCREENSHOT_HOTKEY, captureMapScreenshot);
  if (mapHotkeyRegistered) {
    console.log(`Successfully registered map screenshot hotkey: ${config.MAP_SCREENSHOT_HOTKEY}`);
  } else {
    console.warn(`FAILED to register map screenshot hotkey ${config.MAP_SCREENSHOT_HOTKEY} — it may be in use by another app.`);
  }

  startGameDetection();

  // Step 2: check Player-prev.log and Player.log for any completed (or, if
  // the game isn't currently running, inferred-completable) matches whose
  // MatchId isn't archived yet — BEFORE live tailing starts. Due Process
  // rotates its log on every launch (Player.log -> Player-prev.log, older
  // deleted), so this is the only chance to catch a match that finished
  // between "app closed" and "app reopened"; see rescan.js for the
  // durability note. Order matters: prev (older) first, then current.
  //
  // allowInferred is gated on a single startup-time isGameRunning() check
  // (not the 2-poll debounce the live path uses) — there's no "momentary
  // hiccup" to guard against here, just one deliberate check before any
  // polling has even started.
  const gameRunningAtStartup = await isGameRunning();
  const prevScan = await scanLogFileForCompletedMatches({
    filePath: config.PLAYER_PREV_LOG_PATH,
    DueProcessLogParser,
    computeMatchStats,
    roundRoleByRosterSide,
    rankedArchive,
    otherArchive,
    findLocalAccountId,
    deriveFinalScoreFromRounds,
    allowInferred: !gameRunningAtStartup,
  });
  const currentScan = await scanLogFileForCompletedMatches({
    filePath: config.PLAYER_LOG_PATH,
    DueProcessLogParser,
    computeMatchStats,
    roundRoleByRosterSide,
    rankedArchive,
    otherArchive,
    findLocalAccountId,
    deriveFinalScoreFromRounds,
    allowInferred: !gameRunningAtStartup,
  });
  if (prevScan.recorded + currentScan.recorded > 0) {
    console.log(
      `Startup catch-up: recorded ${prevScan.recorded} match(es) from Player-prev.log, ` +
        `${currentScan.recorded} from Player.log.`
    );
  }
  localAccountId = rankedArchive.getLocalAccountId() || otherArchive.getLocalAccountId(); // the scans above may have just discovered it
  sendHubUpdate();

  // Step 3: only now start live tailing.
  await startLogTailing();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlayWindow();
      createHubWindow();
    }
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

main().catch((err) => {
  console.error('Failed to start:', err);
  app.quit();
});
