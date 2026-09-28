# Due Process — Global Player Database Web Portal

This folder contains the standalone PHP web portal for hosting a public, searchable Due Process player database on your domain.

## Overview
- **Design**: Matches the Due Process Stat Tracker cyberpunk interface (dark/light themes, Barlow typography, HUD cards, sorting, search).
- **Global & Objective**: Contains stats for **all players** recorded in matches (win rates, DPL rating, KDR, ADR, KAST%, attack/defense splits, weapons, recent matches). Not centered on any single user.
- **Easy Updates**: The webmaster updates stats simply by replacing `database.json`. No database setup or server reconfiguration is needed.
- **Last Updated Badge**: Automatically shows the timestamp of when the database was last refreshed.

## How to Deploy on Your Web Domain (PHP)
1. Upload `index.php` to your web server / domain directory (e.g. `public_html/stats/` or your root domain).
2. Export `database.json` from the Due Process Stat Tracker (click **Export Database** in the Tracker header).
3. Upload `database.json` to the same folder as `index.php`.
4. Visit your URL (e.g. `https://yourdomain.com/stats/`).

## How to Update Stats (Webmaster Workflow)
Whenever you record new matches and want to publish the updated leaderboard:
1. Open Due Process Stat Tracker.
2. Click **Export Database** (in the top header or in Settings).
3. Choose **Download database.json**.
4. Replace `database.json` on your web server.
5. Your website will instantly show the new player stats and update the "Last Updated" timestamp.

## Alternative: Standalone HTML (.html)
If your host does not support PHP, or you want to distribute a single portable file to friends or on Discord, choose **Export Standalone HTML** (`players_database.html`). It opens directly in any web browser with full search, sorting, and player dossier modals without requiring any server.
