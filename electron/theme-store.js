'use strict';
// Persists the user's dark/light choice across launches, in the main
// process — not localStorage, since the overlay and Hub are two separate
// BrowserWindows with two separate renderer processes and two separate
// localStorage jars. main.js broadcasts changes to both windows over IPC
// (see 'theme:changed') so they never disagree. Same load/save shape as
// map-layout-library.js's index.json.

const fs = require('fs');
const path = require('path');

const VALID_THEMES = new Set(['dark', 'light']);
const DEFAULT_THEME = 'dark';

class ThemeStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.theme = this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return VALID_THEMES.has(parsed.theme) ? parsed.theme : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ theme: this.theme }, null, 2));
  }

  get() {
    return this.theme;
  }

  set(theme) {
    if (!VALID_THEMES.has(theme) || theme === this.theme) return this.theme;
    this.theme = theme;
    this._save();
    return this.theme;
  }
}

module.exports = { ThemeStore, DEFAULT_THEME };
