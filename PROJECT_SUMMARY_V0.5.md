# Due Process Scoreboard & Stat Tracker — Project Summary & Changelog (v0.5)

This document provides a comprehensive overview of all architectural improvements, UI redesigns, data aggregation pipelines, log parsing fixes, and commit history made to the **Due Process Stat Tracker** (`dp-stat-tracker`) from initial release through V0.5.

**Repository**: [`bluetyde/dp-stat-tracker`](https://github.com/bluetyde/dp-stat-tracker) · **Branch**: `main` · **Version**: `Tracker v0.5`

---

## ðŸš€ Overview of Version 0.5 Enhancements

### 1. UI & Formatting Polishing
- **Tracker Version Bump**: Updated sidebar version brand from `Tracker v0.4` $\rightarrow$ **`Tracker v0.5`**.
- **K-D-A Text Wrapping Fix**: Enforced `white-space: nowrap; min-width: 90px;` on all match table K-D-A columns, preventing line breaks (e.g. `9-6-7` stays cleanly formatted on a single line at all window sizes).
- **Silent Inferred Tags**: Hidden the user-visible `INFERRED` badge from match tables while preserving internal durable logging metadata in JSON storage.

---

### 2. Maps Tab Redesign & Map Layout Aggregation
- **Clean Map Display Names**:
  - Automatically stripped `_Day` suffixes from tilesets (`Killhouse_Day` $\rightarrow$ `Killhouse`).
  - Removed redundant `[Tileset]` prefix brackets from map names (`[Killhouse_Day] Kronos Greased` $\rightarrow$ **`Kronos Greased`**, `[Bank] Union Anvil` $\rightarrow$ **`Union Anvil`**).
- **Map Layout Aggregation**:
  - Aggregated map performance per unique map layout (`mapName`) rather than raw unorganized round logs.
  - Table headers: **Map Name**, **Set**, **Record** (`Times Played (W-L)`), **Win %**, **Notes / Tags**.
- **Interactive Notes & Tags**:
  - Each map entry features an inline, auto-saving `Notes / Tags` input field.
  - Custom notes (e.g. *"Clutched 1v3 with SAB-R"*, *"Strong A-site defense"*) persist durably to disk in `match-archive.json` under `data.mapNotes`.
- **Map History Drilldown Modal**:
  - Clicking any map row opens a `#mapHistoryBackdrop` modal showing every matchup, round number, date/time, and win/loss outcome played on that specific map layout.

---

### 3. Dedicated "PLAYED WITH" Roster Intelligence Tab
- **Cross-Match Player Identity & Aggregation**:
  - Keys player performance across all matches using their 64-bit Steam `accountId`.
  - Dynamically calculates:
    - Teammate Stats: `Together W-L`, `Win % (With)`.
    - Opponent Stats: `Against W-L`, `Win % (Vs)`.
    - Overall **DPL Rating**, **K/D**, **ADR**, and **% KAST**.
- **Real-Time Steam Profile Pictures (Avatars)**:
  - Fetches real high-res Steam profile picture avatars via `hub:get-steam-avatar` IPC using `https://steamcommunity.com/profiles/<accountId>?xml=1`.
  - Renders avatar icons in the **Played With** table and inside the **Player Quick Reference Modal**.
  - Includes **`STEAM PROFILE â†—`** action buttons opening `https://steamcommunity.com/profiles/<accountId>` in the user's default browser.

---

### 4. Weapons Fandom Wiki Integration & Canonical Categories
- **Official Due Process Wiki Links & High-Res Weapon Images**:
  - Scraped weapon URLs (`https://dueprocess.fandom.com/wiki/<Weapon>`) and high-res PNG image assets from the [Official Due Process Wiki](https://dueprocess.fandom.com/wiki/Weapons).
  - Hyperlinked weapon titles and thumbnail images with `â†—` across the **Weapons** tab and Home tab **Top Weapons** cards.
- **Renamed Weapon AK References**:
  - **`Mini AK`** $\rightarrow$ **`KR82U`**
  - **`Big AK`** $\rightarrow$ **`KR82M`**
- **Strict 7 Canonical Weapon Categories**:
  - **ASSAULT RIFLES**: `Dawn`, `AP-25`, `BLK-TAR`, `KR82M`, `Legros`, `KR82U`.
  - **BATTLE RIFLES**: `SAB-R`, `Ingmar-57`.
  - **SMGS**: `Gruber-5`, `Nack-11`.
  - **SHOTGUNS**: `DL-12`, `TUB-12`, `Auto Shotgun`.
  - **PISTOLS**: `GAT-9`, `PK-57`, `LS-45`.
  - **SNIPERS**: `MAWP`.
  - **EXPLOSIVES**: `Grenade`, `Molotov Cocktail`.

---

### 5. Multi-Round Set Extraction & Durability Fixes
- **Full 6-Map / 10-Map Round Extraction**:
  - Resolved `mapRounds` vs `roundMaps` schema key alignment in `match-archive.js` and `rescan.js`.
  - Updated legacy detection logic to force automatic re-scanning whenever fewer map rounds were saved than were actually played in `Player-prev.log` (10 rounds) or `Player.log` (7 rounds).
- **Startup Crash Fix**: Fixed `roundMapsDetailed` variable transposition in `rescan.js`.

---

### 6. Infrastructure & Stability
- **App Name Initialization**: Added `app.setName('due-process-scoreboard')` at the top of `electron/main.js` so `app.getPath('userData')` resolves deterministically to `C:\Users\<user>\AppData\Roaming\due-process-scoreboard` on all machines, independent of working directory or launch context.
- **Hotkey Conflict Fix**: Changed `OVERLAY_HOTKEY` from `` Alt+` `` to `Alt+F9` in `electron/config.js` to avoid system-level shortcut conflicts.
- **Renderer Update Listener Fix** (`e18c7ff`): Resolved a top-level `ReferenceError: mapTilesetFiltersEl is not defined` in `hub-renderer.js` that caused the renderer script to crash during initialization — silently preventing `window.hubAPI.onUpdate(render)` from ever registering. This left Home, Weapons, Maps, and Played With showing empty `0` stats while Ranked History (which uses a separate direct IPC call path) continued to work. Fixed by declaring `const mapTilesetFiltersEl = document.getElementById('mapTilesetFilters')` alongside the other maps-section DOM references.

---

## 🛠️ Git Commit History

| Commit | Description |
|--------|-------------|
| `e18c7ff` | fix: Declare `mapTilesetFiltersEl` — resolves ReferenceError blocking renderer update listener (Home/Weapons/Maps/Played With all zeros) |
| `7acbdd0` | fix: Set `app.setName('due-process-scoreboard')` so userData path consistently resolves to AppData/Roaming |
| `abe0862` | fix: Resolve global shortcut conflict (Alt+F9), enforce non-OneDrive userData path |
| `d8098f9` | feat(v0.5): Maps tab redesign, auto-saving notes/tags, map history drilldown, silent inferred tags, K-D-A nowrap, Tracker v0.5 branding |
| `2439263` | feat: Played With tab, Steam profile pictures, Fandom weapon wiki links, 5x1 maps stat row, canonical weapon categories |
| `ce5e94e` | Initial commit: Due Process log-tailing scoreboard overlay and Hub |

---

## 📁 Modified Files (V0.5 Total)

| File | Changes |
|------|---------|
| `stats.js` | Weapon metadata, KR82U/KR82M renames, canonical 7 categories, Fandom wiki URLs & image CDN links |
| `parser.js` | Log regex for round maps, map tilesets, and player rosters |
| `electron/match-archive.js` | Cross-match player aggregation by `accountId`, DPL ratings, per-map layout stats, map notes persistence |
| `electron/rescan.js` | Round map array alignment, legacy re-scan durability logic |
| `electron/config.js` | `OVERLAY_HOTKEY` changed to `Alt+F9` |
| `electron/main.js` | `app.setName()`, Steam avatar IPC handler, map note save IPC handler, external URL opener |
| `electron/preload.js` | Exposed: `getSteamAvatar`, `saveMapNote`, `openExternal`, `getPlayerDetail`, `getRankedHistory`, `getOtherHistory` |
| `electron/hub.html` | V0.5 branding, Played With view, Player detail modal, Map history modal, 5x1 stat grid |
| `electron/hub-renderer.js` | Played With table/modal, Weapons wiki links & images, Steam avatars, Map layout table, notes input, map history drilldown, `mapTilesetFiltersEl` declaration fix |
