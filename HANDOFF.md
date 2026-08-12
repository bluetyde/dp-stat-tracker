# Handoff: Overlay player click-through, win-prediction rating fix, CSV export polish

Written for a fresh session to pick up — no code was changed while writing this, everything below was confirmed by reading the current files (paths/line numbers as of this writing; re-check if they've drifted). Codebase has grown a lot across sessions (Live Match, Weapons, Played With, Maps views, avatars, DPL rating, Player Quick Reference modal, CSV export) — don't assume anything from an older summary is still current; the notes below are freshly verified.

## Project-wide patterns to follow (don't relitigate these)

- **`hidden` attribute, never a raw `display` toggle.** Every show/hide in this app uses the native `hidden` attribute, and every container that gets `hidden`-toggled deliberately carries **no unconditional author `display` rule** of its own (see `hub.html`'s comment above `#matchDetailBackdrop[hidden]` and above the view-container block). An author `display: flex/grid` on a `hidden`-toggled element silently wins over the UA's `[hidden]{display:none}` regardless of specificity — this exact bug shipped once on `#matchDetailBackdrop` and cost a long debugging session. When adding new toggled UI (a modal, a view), verify with `getComputedStyle(el).display`, not just the `hidden` property/attribute — the attribute can be "correct" while the element is still visually shown.
- **Verify claims with real evidence, not synthetic input.** `element.dispatchEvent(new MouseEvent(...))` and Electron's `webContents.sendInputEvent()` were both tried for click verification earlier; `sendInputEvent` proved unreliable against a background-launched (non-OS-focused) window — a control test against an already-known-working button also failed to register. Prefer: (a) real IPC/data-path assertions via `executeJavaScript`/computed style, (b) actually launching the app and either checking console/log output or asking the user to click for real, over trying to simulate a physical click yourself.
- **Don't rebuild what already exists.** This codebase has repeatedly grown features (rating formula, CSV export, player modal, dual archives) that a fresh read might not notice already exist elsewhere. Grep before writing.
- **Two archives, one gate.** `rankedArchive` (`match-archive.json`) / `otherArchive` (`other-matches-archive.json`), routed by `isRankedFinalScore()` in `rescan.js`. Career totals (`getLifetimeStats()`) are **ranked-only, always** — don't let anything in Parts 1–3 pull from `otherArchive` for a stat that's supposed to represent "career."
- **Verify live**, not just via browser-pane stubs — all three parts below explicitly ask for it, and stubbed IPC tests won't catch e.g. main↔renderer wiring mistakes (see Part 1).

---

## PART 1 — Overlay → Hub player click-through

**Confirmed current state:**
- `overlay.html`/`overlay-renderer.js` render player rows via the **shared** `scoreboard-view.js` (same file the Hub's match-detail panel uses). Every `.player-row` element it builds already carries `el.dataset.accountId = row.accountId` (see `scoreboard-view.js`'s row-building code) — so the accountId is already sitting in the DOM on the overlay's rows. Nothing needs to change in `scoreboard-view.js`.
- `overlay-renderer.js` currently has **zero** click handling on player rows (grepped, no matches) — this is a fully new addition there, not a modification of existing logic.
- The Hub's own player-modal trigger pattern already exists: `hub-renderer.js` has `attachPlayerClickHandlers(container)` (~line 207) which delegates clicks within a container to `openPlayerDetail(accountId)` (~line 627). `openPlayerDetail` is an **async renderer-side function** — it populates the modal's fields (handling the local-player "isSelf" case specially by reading `latestHubData.lifetime`, and the general case via `window.hubAPI.getPlayerDetail(accountId)` → `ipcMain.handle('hub:get-player-detail', ...)` in `main.js` ~line 492) and finishes by setting `playerDetailBackdrop.hidden = false` (~line 689).
- **Critical implication**: `openPlayerDetail` lives in the Hub's renderer process. `main.js` **cannot call it directly** — the two windows don't share JS state. "Reuse the existing modal-opening function" means: main.js sends a **new push-style IPC message to the Hub's renderer** (`hubWindow.webContents.send('hub:show-player-detail', accountId)`), and `hub-renderer.js` needs a **new listener** that calls its own already-existing `openPlayerDetail(accountId)` in response. This is a small new wiring piece on both ends, not a new modal implementation — make sure whoever picks this up doesn't try to reimplement the modal logic in main.js or duplicate it into overlay-renderer.js.
- **No dedicated "ensure window exists" helper exists in `main.js` today.** The only precedents: a plain guard `if (!hubWindow || hubWindow.isDestroyed()) return;` inside `sendHubUpdate()` (bails silently, doesn't create), and the macOS-style `app.on('activate', ...)` block (~line 668) that recreates **both** `overlayWindow` and `hubWindow` together via `createOverlayWindow()`/`createHubWindow()`, but only fires when **all** windows are closed. Item 4 will need genuinely new logic — something like: if `!hubWindow || hubWindow.isDestroyed()`, call `createHubWindow()`, wait for its `did-finish-load` (mirror the existing pattern already used elsewhere for `onParserUpdate`/`sendHubUpdate` re-pushes after load), *then* send the show-player-detail message; either way call `hubWindow.show()` and `hubWindow.focus()`.
- `preload.js`'s `overlayAPI` currently exposes **only** `onUpdate` — no way for the overlay to send anything to main. Needs a new method, e.g. `openPlayerDetail: (accountId) => ipcRenderer.send('overlay:open-player-detail', accountId)`.

**Concrete steps:**
1. `overlay-renderer.js`: add a delegated click listener on the teams container (mirror `attachPlayerClickHandlers`'s delegation pattern from `hub-renderer.js`, but instead of calling a local function, call the new `window.overlayAPI.openPlayerDetail(accountId)`).
2. `preload.js`: add `openPlayerDetail` to `overlayAPI` as shown above.
3. `main.js`: add `ipcMain.on('overlay:open-player-detail', (_e, accountId) => { ... })` — ensure/create/focus the Hub window, then `webContents.send('hub:show-player-detail', accountId)` (after `did-finish-load` if the window was just created).
4. `preload.js`: add a matching `hubAPI.onShowPlayerDetail(callback)` wired to `ipcRenderer.on('hub:show-player-detail', ...)`.
5. `hub-renderer.js`: `window.hubAPI.onShowPlayerDetail((accountId) => { switchView('home'); /* or leave current view? decide */ openPlayerDetail(accountId); })` — decide whether receiving this should force-switch to Home or just open the modal over whatever view is active; the modal is a backdrop overlay so it probably doesn't matter, but worth a conscious call.
6. **Verify live**: launch the real app (`npx electron .` from `due-process-scoreboard/`), get it into a live match (or use archived data — the modal works from either), click a player row in the actual overlay window, confirm the Hub window comes forward and the correct modal opens — once for a player with match history together (non-self, non-zero "As Teammate/As Opponent" stats) and once for a player just met (should show the "no history" branch, not crash). Also test the Hub-window-already-open case and the Hub-window-closed case separately, since item 4's logic branches on that.

---

## PART 2 — Local player's own rating missing from win prediction

**Confirmed current state — this is a documented, known gap already, not a hidden bug:**

`main.js`, `computeWinPrediction(teams, playedWithStats)` (~line 334), has this exact comment already in place:

```js
// NOTE: playedWithStats (rankedArchive.getPlayedWithStats()) deliberately
// excludes the local player (it's "who you've played with/against"), so
// playedWithMap never has an entry for either team's local-player row —
// that row's `?? 1.0` fallback below always fires, meaning the local
// player's own skill is never actually factored into their team's average
// rating here. Known gap, not fixed blindly: ...
```

and the actual fallback chain, ~line 351:
```js
const rating = playedWithMap.get(r.accountId) ?? r.dplRating ?? 1.0;
```

**What's already correctly built (do not touch):**
- `computeDplRating({ kills, deaths, damage, roundsCounted, kastRounds })` in `match-archive.js` (~line 632) — the one shared formula, used by both `getPlayedWithStats()` (every other player) and `getLifetimeStats()` (local player).
- `MatchArchive.getLifetimeStats()` (`match-archive.js` ~line 206) already returns `dplRating`, computed from the local player's own summed kills/deaths/damage/roundsCounted/kastRounds (~line 262: `dplRating: computeDplRating({...})`). This is the exact value already shown on Home's rating badge and used by the Player Quick Reference modal's self-view (Part 1's `isSelf` branch in `openPlayerDetail`).

**What's actually missing**: `computeWinPrediction`'s `getTeamAvgRating` closure needs to special-case `r.accountId === localAccountId` and substitute `rankedArchive.getLifetimeStats().dplRating` there, instead of falling through the `playedWithMap.get(...) ?? r.dplRating ?? 1.0` chain (which always lands on `1.0` for the local player today, since `playedWithMap` never has them and `r.dplRating` presumably isn't set on the local player's own team row either — confirm this second part when picking this up, since `r` here is a `computeMatchStats()` team row, not a `getPlayedWithStats()` row, and it wasn't confirmed during this handoff whether `r.dplRating` exists on that shape at all).

**Concrete steps:**
1. In `computeWinPrediction`, get `localAccountId` (either passed in as a new parameter, or read from the module-level `localAccountId` variable that `main.js` already maintains — check which is more consistent with how this function is already called from `getLiveMatchState`).
2. In `getTeamAvgRating`, before falling to the existing chain: `if (r.accountId === localAccountId) return rankedArchive.getLifetimeStats().dplRating;` (or fold into the `rating` line's fallback chain directly — either is fine, whichever fits the existing style better).
3. Do **not** touch `computeDplRating` or `getLifetimeStats` — this is purely about consuming their existing output at the one call site that currently doesn't.
4. Delete or rewrite the "Known gap, not fixed blindly" comment once fixed, so it doesn't mislead the next reader into thinking the gap still exists.
5. **Verify live, with a real comparison, not just "did the number change"**: get into a live match with the overlay/Live Match view showing a win prediction, and independently compute what the team average *should* be by hand: (local player's `dplRating` from Home's badge, already verified elsewhere in this project to read `1.00` for a specific known state — re-verify current value, don't assume it's still exactly 1.00) averaged with the other teammates' `dplRating` values from Played With. Confirm the prediction's `avgRating0`/`avgRating1` output matches that hand-computed average, not just that it differs from the pre-fix number.

---

## PART 3 — CSV export: what exists vs. what's asked for

**Confirmed current state:**
- Export is **already fully built** for a single case: a button `#exportCsvBtn` in `hub.html` (~line 582), inside `#homeView`'s page-head (confirmed: it's a genuine Home-only button today, next to Refresh) → `hub-renderer.js` (~line 715) fetches via `window.hubAPI.exportCsv()` → `preload.js` (~line 32, **no parameters accepted**) → `ipcMain.handle('hub:export-csv', ...)` in `main.js` (~line 500, **hardcoded to `rankedArchive.exportCsv()`, no otherArchive path exists at all**) → `MatchArchive.exportCsv()` in `match-archive.js` (~line 607).
- **Current CSV columns, exactly**: `MatchID, Timestamp, Result, MyScore, OppScore, Map, Kills, Deaths, Assists, Inferred`.
- Download mechanism (`hub-renderer.js` ~line 718 onward): builds a `Blob`, triggers a synthetic `<a download>` click, filename `due-process-match-history-${Date.now()}.csv`. This part is generic and reusable as-is for the other two export buttons.

**Comparing against the requested column set (Timestamp, Result, Teams, Score, Map, K/D/A, Weapon Breakdown, Inferred Status):**
| Requested | Status |
|---|---|
| Timestamp | ✅ already present |
| Result | ✅ already present |
| Teams | ❌ **missing** — `team0Name`/`team1Name` exist on each archived match record (added in `rescan.js`'s `recordCompletedMatch`, defaulting to `'Blue Team'`/`'Orange Team'` if the log didn't carry a name) but are not exported |
| Score | 🟡 present as two separate columns (`MyScore`,`OppScore`) rather than one combined `Score` column — probably fine as-is, but confirm with the user if they specifically want one `"7-3"`-style column instead |
| Map | ✅ present (round 1's map only — note `mapRounds`/`roundMaps` per-round detail also exists on the record now if a fuller per-round map column is ever wanted, but that's beyond what was asked) |
| K/D/A | ✅ present as separate `Kills`/`Deaths`/`Assists` columns |
| Weapon Breakdown | ❌ **missing entirely** — `weaponBreakdown` (array of `{damageSource, label, hits, damage, kills}`) is stored on every archived match but never exported. Needs a sensible flattening for CSV — e.g. a single column like `"AP-25:12/3;BLK-TAR:5/1"` (weapon:hits/kills pairs) since a variable-length array doesn't map to fixed CSV columns; pick a format and document it in the header comment. |
| Inferred Status | ✅ already present (`Inferred`, `TRUE`/`FALSE`) |

**Concrete steps:**
1. Extend `MatchArchive.exportCsv()` in `match-archive.js` to add `Team0Name`, `Team1Name`, and a flattened `WeaponBreakdown` column to the header and each row — this is the **one function** both Home and the two new History buttons should call through (per-archive, since it's an instance method), so fixing it once fixes it everywhere. Don't write a second export function.
2. Parameterize the IPC path so the caller can choose which archive: change `main.js`'s handler to `ipcMain.handle('hub:export-csv', (_e, which) => { const archive = which === 'other' ? otherArchive : rankedArchive; return archive.exportCsv(); })` (default to ranked when `which` is omitted, to keep the existing Home button working unchanged), and update `preload.js`'s `exportCsv` to accept and forward an optional `which` argument.
3. In `hub.html`, add an `#exportRankedHistoryCsvBtn`-style button to `#rankedHistoryView`'s header, and an equivalent one to `#otherHistoryView`'s header.
4. In `hub-renderer.js`, factor the existing download-triggering code (Blob + synthetic `<a>` click) out of the single `#exportCsvBtn` listener into a small reusable `triggerCsvDownload(which)` helper, and wire all three buttons to it with `which` set to `undefined`/`'ranked'`/`'other'` respectively. Give the two new History-view downloads a filename that reflects which archive they came from (e.g. `due-process-ranked-history-....csv` / `due-process-other-history-....csv`) rather than reusing the generic `match-history` name for all three, so a user with multiple downloaded files can tell them apart.
5. **Verify all three, actually opening the file**: trigger export from Home (should be ranked data, same as today, now with the two new columns), from Ranked History (ranked data only), and from Other History (other-archive data only — confirm it's genuinely *not* ranked matches, since that archive has never had an export path before and this is the first real exercise of `otherArchive.exportCsv()`). Open each resulting CSV and cross-check a couple of rows' values (especially the new Teams and Weapon Breakdown columns) against what the corresponding History view / match-detail panel shows in the UI for the same match.

---

## Suggested order

Part 3 is the most self-contained and lowest-risk (one archive method, one IPC parameter, two buttons) — good first target to re-establish context. Part 2 is a small, precisely-located fix but needs the live-verification comparison to actually confirm correctness, not just "the number moved." Part 1 is the most involved (new IPC channel in both directions, a window-lifecycle decision with no existing helper to lean on) — save it for last once back up to speed on the main/preload/renderer three-way pattern from redoing Part 3.
