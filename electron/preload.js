'use strict';
// Preload script (contextIsolation:true, nodeIntegration:false in both
// windows) — the only bridge between renderer pages and the main process.
// Renderers get plain data via these callbacks; they never touch fs/child_process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onUpdate: (callback) => {
    ipcRenderer.on('overlay:update', (_event, payload) => callback(payload));
  },
  // Fire-and-forget: main.js ensures/focuses the Hub window and pushes it
  // 'hub:show-player-detail' in response. See main.js's
  // 'overlay:open-player-detail' handler.
  openPlayerDetail: (accountId) => ipcRenderer.send('overlay:open-player-detail', accountId),
});

contextBridge.exposeInMainWorld('hubAPI', {
  onUpdate: (callback) => {
    ipcRenderer.on('hub:update', (_event, payload) => callback(payload));
  },
  // Pushed by main.js when the overlay's click-through (see overlayAPI.openPlayerDetail)
  // asks the Hub to show a specific player's Quick Reference modal.
  onShowPlayerDetail: (callback) => {
    ipcRenderer.on('hub:show-player-detail', (_event, accountId) => callback(accountId));
  },
  requestRefresh: () => ipcRenderer.send('hub:request-refresh'),
  // Full archived scoreboard for one match (both teams, every player) —
  // fetched on demand when a Recent Matches row is clicked, not pushed with
  // every hub:update (those stay list-summary-sized).
  getMatchDetail: (matchId) => ipcRenderer.invoke('hub:get-match-detail', matchId),
  // Removes one match (from whichever archive — ranked or other — it lives
  // in) and returns true/false. Caller is responsible for confirming with
  // the user first; this performs the deletion unconditionally.
  deleteMatch: (matchId) => ipcRenderer.invoke('hub:delete-match', matchId),
  // Full (uncapped) match lists for the Ranked History / Other History nav views.
  getRankedHistory: () => ipcRenderer.invoke('hub:get-ranked-history'),
  getOtherHistory: () => ipcRenderer.invoke('hub:get-other-history'),
  getPlayerDetail: (accountId) => ipcRenderer.invoke('hub:get-player-detail', accountId),
  getSteamAvatar: (accountId) => ipcRenderer.invoke('hub:get-steam-avatar', accountId),
  // `which` is optional — 'ranked' (default), or 'other' for the otherArchive.
  exportCsv: (which) => ipcRenderer.invoke('hub:export-csv', which),
  saveMapNote: (mapName, note) => ipcRenderer.invoke('hub:save-map-note', mapName, note),
  // `tags` is the full replacement array of selected tags for this map, not
  // a single tag — see match-archive.js's saveMapTags doc comment.
  saveMapTags: (mapName, tags) => ipcRenderer.invoke('hub:save-map-tags', mapName, tags),
  openExternal: (url) => ipcRenderer.invoke('hub:open-external', url),
  // Steam profile links specifically go through this instead of
  // openExternal above — takes a raw accountId, not a pre-built URL, so
  // main.js's numeric validation and scheme/host check both run before
  // anything reaches shell.openExternal. See main.js's hub:open-steam-profile.
  openSteamProfile: (accountId) => ipcRenderer.invoke('hub:open-steam-profile', accountId),
  // Map layout screenshot capture — see main.js's captureMapScreenshot().
  onMapScreenshotPreview: (callback) => {
    ipcRenderer.on('hub:map-screenshot-preview', (_event, payload) => callback(payload));
  },
  onMapScreenshotNotice: (callback) => {
    ipcRenderer.on('hub:map-screenshot-notice', (_event, payload) => callback(payload));
  },
  confirmMapScreenshot: () => ipcRenderer.send('hub:map-screenshot-confirm'),
  retryMapScreenshot: () => ipcRenderer.send('hub:map-screenshot-retry'),
  cancelMapScreenshot: () => ipcRenderer.send('hub:map-screenshot-cancel'),
  getMapLayoutPicture: (tileset, mapName) => ipcRenderer.invoke('hub:get-map-layout-picture', tileset, mapName),
});
