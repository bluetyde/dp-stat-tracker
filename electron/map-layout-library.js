'use strict';
// Stores one reference screenshot per unique map layout, keyed by
// (tileset, mapName) — not per round or per match. A named layout's map
// seed has been observed stable across every session it's ever appeared in
// (e.g. "[Dome] Crab Trident" always carries seed 1397879412), so capturing
// it once is enough; every future round that reuses that layout shows the
// same picture with no further action needed. See map-tracker.js for the
// same (tileset, mapName) identity used to associate rounds to their maps.

const fs = require('fs');
const path = require('path');

class MapLayoutLibrary {
  constructor(dirPath) {
    this.dirPath = dirPath;
    this.indexPath = path.join(dirPath, 'index.json');
    this.index = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    } catch {
      return {};
    }
  }

  _save() {
    fs.mkdirSync(this.dirPath, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  _key(tileset, mapName) {
    return `${tileset}_${mapName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  hasPicture(tileset, mapName) {
    return Boolean(this.index[this._key(tileset, mapName)]);
  }

  /** Absolute file path, or null if this layout has never been captured. */
  getPicturePath(tileset, mapName) {
    const entry = this.index[this._key(tileset, mapName)];
    return entry ? path.join(this.dirPath, entry.fileName) : null;
  }

  /** `pngBuffer` is the already-encoded PNG bytes (e.g. NativeImage#toPNG()). */
  savePicture(tileset, mapName, seed, pngBuffer) {
    const key = this._key(tileset, mapName);
    const existing = this.index[key];
    if (existing && existing.seed !== undefined && seed !== undefined && existing.seed !== seed) {
      // Confirms or refutes the "seed is stable per map name" assumption
      // this whole one-picture-per-layout design rests on — surfacing it
      // instead of silently overwriting lets that assumption be checked.
      console.warn(
        `MapLayoutLibrary: seed changed for ${tileset} ${mapName} — was ${existing.seed}, now ${seed}. The stable-seed-per-layout assumption may not hold for this map.`
      );
    }
    const fileName = `${key}.png`;
    fs.mkdirSync(this.dirPath, { recursive: true });
    fs.writeFileSync(path.join(this.dirPath, fileName), pngBuffer);
    this.index[key] = { tileset, mapName, seed, fileName, capturedAt: Date.now() };
    this._save();
  }
}

module.exports = { MapLayoutLibrary };
