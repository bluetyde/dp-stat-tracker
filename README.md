# Due Process Scoreboard

An Electron overlay and history hub for the game [Due Process](https://store.steampowered.com/app/2933120/Due_Process/).
It tails the game's own Unity log files to track kills, deaths, assists,
match results, and career stats, entirely from data the game already writes
to disk — no game files are modified.

- **Overlay** — an always-on-top scoreboard shown while you play.
- **Hub** — a separate window for browsing match history, career totals,
  top weapons, and per-match detail, split into ranked and other (unranked,
  2v2, Push, etc.) archives.

## Setup

Two ways to run this, depending on whether you're developing it or just
using it.

### Option A: Download the portable .exe (no Node/npm required)

Grab `Due Process Tracker <version>.exe` and double-click it — that's the
whole install. It's a single portable executable (not an installer): no
setup wizard, nothing added to Start Menu/Programs, nothing to uninstall
later beyond deleting the file. Windows SmartScreen may warn about an
unrecognized publisher on first run (the build isn't code-signed) — click
"More info" → "Run anyway".

### Option B: Run from source

```bash
npm install
npm start
```

`npm start` launches the Electron app directly. On Windows you can also
double-click [`start.bat`](start.bat), which does the same thing and is
handy for a desktop shortcut.

There's also a plain web viewer (`npm run web`), an older/simpler variant
that serves the same parsing logic over HTTP instead of as a native overlay.

### Building the portable .exe yourself

```bash
npm install
npm run dist
```

Produces `dist/Due Process Tracker <version>.exe` via
[electron-builder](https://www.electron.build/), targeting a portable
single-file executable rather than an NSIS installer — the simplest thing
to hand to someone else, with no install/uninstall step. (An NSIS installer
would make more sense if this ever needed Start Menu shortcuts, silent
auto-update, or multi-user machine installs — none of which apply to a
personal-use overlay shared with a friend.)

No manual configuration is required: the app locates Due Process's log
automatically, based on the standard Unity per-user log location:

```
C:\Users\<you>\AppData\LocalLow\Giant Enemy Crab\Due Process\Player.log
```

Due Process only ever keeps two of these on disk — `Player.log` (the
current session) and `Player-prev.log` (the prior one) — so the app does a
startup scan of both before it starts live-tailing, to minimize the window
where a completed match could otherwise be missed.

## Data & storage

Match history lives in two JSON archive files under Electron's per-user
`userData` directory (not inside this project folder, so they're untouched
by git and by reinstalling/updating the app):

- `match-archive.json` — ranked matches (best-of-12, sudden death at 7).
  The sole source of career totals shown in the Hub.
- `other-matches-archive.json` — everything else (unranked, 2v2, Push,
  etc.). Never counted toward career totals.

This is identical whether you're running from source or the portable .exe —
both resolve to the same `userData` folder (the app name is set explicitly
in code, not derived from how it was launched), so switching between the
two, or moving to a newer build, doesn't lose or fork your history.

## Project layout

- `parser.js` / `stats.js` — log parsing and stat computation, no Electron
  or DOM dependencies, reused as-is by both the Electron app and the web
  viewer.
- `electron/` — the Electron app: main process (log tailing, game-process
  detection, IPC), the overlay window, and the Hub window.
- `server.js` / `app.js` / `index.html` / `style.css` — the standalone web
  viewer (`npm run web`).

## Acknowledgments & Credits

Stat calculation logic, trade-window timing, KAST criteria, role-relative assist thresholds, and percent-of-max-health weapon scoring formulas are adapted from and inspired by Austen Keeling's open-source [Due-Process-Stat-Parser](https://github.com/austenke/Due-Process-Stat-Parser) library and the [dp-stats.com](https://dp-stats.com) community platform. Special thanks to Austen for establishing the foundational log parsing standards for the Due Process community.
