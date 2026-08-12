# Due Process Scoreboard & Stat Tracker — Project Summary & Changelog (v0.5)

This document provides a comprehensive overview of all architectural improvements, UI redesigns, data aggregation pipelines, log parsing fixes, and Git push history made to the **Due Process Stat Tracker** (`dp-stat-tracker`).

---

## 🚀 Overview of Version 0.5 Enhancements

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
  - Includes **`STEAM PROFILE ↗`** action buttons opening `https://steamcommunity.com/profiles/<accountId>` in the user's default browser.

---

### 4. Weapons Fandom Wiki Integration & Canonical Categories
- **Official Due Process Wiki Links & High-Res Weapon Images**:
  - Scraped weapon URLs (`https://dueprocess.fandom.com/wiki/<Weapon>`) and high-res PNG image assets from the [Official Due Process Wiki](https://dueprocess.fandom.com/wiki/Weapons).
  - Hyperlinked weapon titles and thumbnail images with `↗` across the **Weapons** tab and Home tab **Top Weapons** cards.
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

## 🛠️ GitHub Repository & Git Push Summary

All modifications have been committed and pushed to the main repository:

- **Repository**: [`bluetyde/dp-stat-tracker`](https://github.com/bluetyde/dp-stat-tracker)
- **Branch**: `main`

### Modified Files:
1. `stats.js` — Weapon metadata, KR82U/KR82M names, canonical categories, wiki & image URLs.
2. `parser.js` — Log regex matching for maps, rounds, and player rosters.
3. `electron/match-archive.js` — Player roster aggregation, map notes persistence, map layout summaries.
4. `electron/rescan.js` — Round map alignment & durability rescan logic.
5. `electron/main.js` — Steam avatar IPC handler, payload property alignment, external URL opener, map notes handler.
6. `electron/preload.js` — Exposed `getSteamAvatar`, `saveMapNote`, `openExternal`, and history API methods.
7. `electron/hub.html` — Version bump (Tracker v0.5), Played With view, 5x1 Maps grid CSS, Map History modal.
8. `electron/hub-renderer.js` — Renderer for Played With, Weapons Fandom Wiki links, Steam avatars, and map layout notes & history modal.
