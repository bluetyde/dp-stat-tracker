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
const { app, BrowserWindow, screen, globalShortcut, ipcMain, shell } = require('electron');

app.setName('due-process-scoreboard');

const config = require('./config');
const { MatchArchive } = require('./match-archive');
const { findLocalAccountId } = require('./local-player');
const { MapTracker } = require('./map-tracker');
const { recordCompletedMatch, scanLogFileForCompletedMatches } = require('./rescan');

let overlayWindow = null;
let hubWindow = null;
let rankedArchive = null; // match-archive.json — ranked (7-X / 6-6) matches, the ONLY source for career totals
let otherArchive = null; // other-matches-archive.json — everything else (unranked, 2v2, Push, ...), never counted toward totals

let DueProcessLogParser = null;
let computeMatchStats = null;
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
  hubWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    alwaysOnTop: false,
    title: 'Due Process Tracker',
    backgroundColor: '#0d1013',
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
  const matches = parser.getMatches();
  if (matches.length === 0) return;

  const accountId = localAccountId || rankedArchive.getLocalAccountId();
  let recordedAny = false;
  for (const match of parser.matches) {
    if (recordCompletedMatch(match, { rankedArchive, otherArchive, computeMatchStats, mapTracker, accountId })) {
      recordedAny = true;
    }
  }
  if (recordedAny) sendHubUpdate();

  const latest = matches[matches.length - 1];
  const stats = computeMatchStats(latest);
  sendOverlayUpdate(latest, stats);
}

function sendOverlayUpdate(match, stats) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('overlay:update', {
    status: match.status,
    finalScore: stats.finalScore,
    roundCount: stats.roundCount,
    teams: stats.teams,
    currentMap: mapTracker.peekCurrent().at(-1)?.label ?? null,
    localAccountId: localAccountId || rankedArchive.getLocalAccountId(),
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

function computeWinPrediction(teams, playedWithStats) {
  if (!teams || !teams[0] || !teams[1]) return null;

  // NOTE: playedWithStats (rankedArchive.getPlayedWithStats()) deliberately
  // excludes the local player (it's "who you've played with/against"), so
  // playedWithMap never has an entry for either team's local-player row —
  // that row's `?? 1.0` fallback below always fires, meaning the local
  // player's own skill is never actually factored into their team's average
  // rating here. Known gap, not fixed blindly: there's no existing
  // aggregate of the local player's own kpr/adr/kast in the same shape
  // dplRating below is built from, so a real fix needs that design decision
  // made deliberately rather than guessed at here.
  const playedWithMap = new Map((playedWithStats ?? []).map((p) => [p.accountId, p.dplRating]));

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

function getLiveMatchState(playedWithStats) {
  if (!parser || !parser.current) return null;
  const match = parser.current;
  const stats = computeMatchStats(match);
  const prediction = computeWinPrediction(stats.teams, playedWithStats);
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
  hubWindow.webContents.send('hub:update', {
    playerName: currentPlayerName(),
    // Career totals are derived ONLY from rankedArchive — see match-archive.js
    // (summed fresh on every read) and rescan.js (routing by score shape).
    lifetime: rankedArchive.getLifetimeStats(),
    recentMatches: rankedArchive.getRecentMatches(8),
    otherMatches: otherArchive.getRecentMatches(8),
    topWeapons: rankedArchive.getTopWeapons(4),
    weaponStats: rankedArchive.getWeaponStats(),
    killsTrend: rankedArchive.getRecentKillsTrend(12),
    playedWith: playedWithStats,
    playedWithStats: playedWithStats,
    mapStats: rankedArchive.getMapStats(),
    liveMatch: getLiveMatchState(playedWithStats),
  });
}

const steamAvatarCache = new Map();
const httpsClient = require('node:https');

ipcMain.handle('hub:get-steam-avatar', async (_event, accountId) => {
  if (!accountId) return null;
  if (steamAvatarCache.has(accountId)) {
    return steamAvatarCache.get(accountId);
  }
  return new Promise((resolve) => {
    const url = `https://steamcommunity.com/profiles/${accountId}?xml=1`;
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
});

ipcMain.on('hub:request-refresh', () => {
  sendHubUpdate();
});

// Match-detail view (click-through from either list) reads straight from
// whichever archive actually has it — works even after the source log has
// rotated away, since the full scoreboard was persisted at record time.
ipcMain.handle('hub:get-match-detail', (_event, matchId) => {
  return rankedArchive.getMatch(matchId) ?? otherArchive.getMatch(matchId);
});

ipcMain.handle('hub:get-player-detail', (_event, accountId) => {
  return rankedArchive.getSinglePlayedWith(accountId);
});

ipcMain.handle('hub:save-map-note', (_event, mapName, note) => {
  rankedArchive.saveMapNote(mapName, note);
});

ipcMain.handle('hub:export-csv', () => {
  return rankedArchive.exportCsv();
});

ipcMain.handle('hub:open-external', (_event, url) => {
  if (url && typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

ipcMain.handle('hub:get-ranked-history', () => {
  return rankedArchive.getRecentMatches(Number.MAX_SAFE_INTEGER);
});
ipcMain.handle('hub:get-other-history', () => {
  return otherArchive.getRecentMatches(Number.MAX_SAFE_INTEGER);
});

ipcMain.handle('hub:delete-match', (_event, matchId) => {
  const deleted = rankedArchive.deleteMatch(matchId) || otherArchive.deleteMatch(matchId);
  if (deleted) sendHubUpdate();
  return deleted;
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
  parser = new DueProcessLogParser();

  // Step 1: load both archives directly — match-archive.json is the totals
  // source of truth (match-archive.js sums it on read), so the Hub can show
  // correct history the moment its window is ready, with no rescanning
  // needed just to display what's already recorded.
  const userDataDir = app.getPath('userData');
  rankedArchive = new MatchArchive(path.join(userDataDir, 'match-archive.json'));
  otherArchive = new MatchArchive(path.join(userDataDir, 'other-matches-archive.json'));
  localAccountId = rankedArchive.getLocalAccountId() || otherArchive.getLocalAccountId();

  await app.whenReady();

  createOverlayWindow();
  createHubWindow();

  // Renderers may finish loading after the first update already fired (or
  // before any log activity happens at all) — re-push current state once
  // each window is actually ready to receive it. Both handlers are
  // idempotent (onParserUpdate recomputes from current state;
  // recordCompletedMatch is dedupe-guarded), so re-sending is harmless.
  overlayWindow.webContents.once('did-finish-load', () => onParserUpdate());
  hubWindow.webContents.once('did-finish-load', () => sendHubUpdate());

  const registered = globalShortcut.register(config.OVERLAY_HOTKEY, toggleOverlayManually);
  if (!registered) {
    console.warn(`Could not register global shortcut ${config.OVERLAY_HOTKEY} — it may be in use by another app.`);
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
