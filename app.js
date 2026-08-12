import { DueProcessLogParser } from './parser.js';
import { computeMatchStats, DEFAULT_CONFIG } from './stats.js';

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileNameEl = document.getElementById('fileName');
const matchPicker = document.getElementById('matchPicker');
const matchSelect = document.getElementById('matchSelect');
const warningsEl = document.getElementById('warnings');
const scoreboardEl = document.getElementById('scoreboard');

let currentMatches = [];

function handleFile(file) {
  fileNameEl.textContent = `Loaded: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  const reader = new FileReader();
  reader.onload = () => {
    const parser = new DueProcessLogParser();
    parser.feedText(reader.result);
    parser.end();
    currentMatches = parser.getMatches();
    populateMatchPicker();
  };
  reader.readAsText(file);
}

function populateMatchPicker() {
  matchSelect.innerHTML = '';
  if (currentMatches.length === 0) {
    warningsEl.hidden = false;
    warningsEl.textContent = 'No matches found in this file (no Stats :: Team blocks were seen).';
    scoreboardEl.innerHTML = '';
    matchPicker.hidden = true;
    return;
  }
  warningsEl.hidden = true;

  currentMatches.forEach((match, i) => {
    const opt = document.createElement('option');
    const roundCount = match.roundsByNumber.size;
    const scoreText = match.finalScore ? `${match.finalScore.side0}-${match.finalScore.side1}` : '?-?';
    const statusText = match.status === 'in-progress' ? ' (in progress)' : '';
    opt.value = String(i);
    opt.textContent = `Match ${i + 1} — ${roundCount} round(s), score ${scoreText}${statusText}`;
    matchSelect.appendChild(opt);
  });

  matchPicker.hidden = currentMatches.length <= 1;
  matchSelect.selectedIndex = currentMatches.length - 1; // default to most recent match
  renderSelectedMatch();
}

matchSelect.addEventListener('change', renderSelectedMatch);

function renderSelectedMatch() {
  const match = currentMatches[Number(matchSelect.value)];
  if (!match) return;
  const stats = computeMatchStats(match);
  renderScoreboard(match, stats);
}

function renderScoreboard(match, stats) {
  scoreboardEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'score-header';
  header.innerHTML = `
    <div class="score-badge score-badge--green">${stats.finalScore?.side0 ?? '?'}</div>
    <div class="team-name team-name--green">Team 1</div>
    <div class="score-meta">
      ${match.status === 'in-progress' ? '<span class="live-badge">LIVE</span>' : ''}
      <span class="round-count">${stats.roundCount} round(s)</span>
      <span class="score-source" title="Final score is taken from the last round's Stats::Team RoundWins totals, not the matchEnded message's AttackerScore/DefenderScore fields — those were observed to lag one round behind in sample data.">
        score source: ${stats.finalScore?.source ?? 'n/a'}
      </span>
    </div>
    <div class="team-name team-name--red">Team 2</div>
    <div class="score-badge score-badge--red">${stats.finalScore?.side1 ?? '?'}</div>
  `;
  scoreboardEl.appendChild(header);

  scoreboardEl.appendChild(renderTeamTable('Team 1', 'green', stats.teams[0]));
  scoreboardEl.appendChild(renderTeamTable('Team 2', 'red', stats.teams[1]));
  scoreboardEl.appendChild(renderAssumptionsNote(stats.config));
}

function renderTeamTable(label, color, rows) {
  const section = document.createElement('section');
  section.className = 'team-section';

  const bar = document.createElement('div');
  bar.className = `team-bar team-bar--${color}`;
  bar.textContent = label;
  section.appendChild(bar);

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Damage</th>
        <th title="Average damage per round, split by attack rounds vs defense rounds">ADR</th>
        <th>K - D - A</th>
        <th title="Percent of rounds with a Kill, Assist, Survival, or Trade">KAST</th>
        <th title="First kill of the round: won / involved">Opening Duels</th>
        <th title="Weapon codes are unmapped — see weaponNames in stats.js">Best Weapon</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  for (const row of [...rows].sort((a, b) => b.damage - a.damage)) {
    const tr = document.createElement('tr');

    const adrTitle =
      `attack: ${row.adr.attackDamageRaw} dmg / ${row.adr.attackRounds} round(s) = ${row.adr.attack}\n` +
      `defense: ${row.adr.defenseDamageRaw} dmg / ${row.adr.defenseRounds} round(s) = ${row.adr.defense}`;
    const kastTitle = `${row.kast.kastRounds} of ${row.kast.roundsCounted} rounds`;
    const bestWeaponText = row.bestWeapon
      ? `${row.bestWeapon.label} (${row.bestWeapon.kills} kills, ${row.bestWeapon.damage} dmg)`
      : '—';
    const weaponTitle = row.weaponBreakdown
      .map((w) => `${w.label}: ${w.kills} kills, ${w.hits} hits, ${w.damage} dmg`)
      .join('\n');

    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td>${row.damage}</td>
      <td title="${escapeHtml(adrTitle)}">${row.adr.attack} - ${row.adr.defense}</td>
      <td>${row.kills} - ${row.deaths} - ${row.assists}</td>
      <td title="${escapeHtml(kastTitle)}">${row.kast.percent}%</td>
      <td>${row.openingDuels.won} / ${row.openingDuels.involved}</td>
      <td title="${escapeHtml(weaponTitle)}">${escapeHtml(bestWeaponText)}</td>
    `;
    tbody.appendChild(tr);
  }

  section.appendChild(table);
  return section;
}

function renderAssumptionsNote(config) {
  const details = document.createElement('details');
  details.className = 'assumptions';
  details.innerHTML = `
    <summary>Formulas that are best-effort / unconfirmed — check these</summary>
    <ul>
      <li><strong>Final score</strong> uses the last round's Stats::Team <code>RoundWins</code>, not the
        <code>matchEnded</code> message's AttackerScore/DefenderScore (the latter lagged one round behind
        in a sample completed match).</li>
      <li><strong>ADR split</strong> buckets each Damage event by that round's attack/defense role
        (derived from <code>attackerSide</code>/<code>victimSide</code>, which rotates per round) and
        divides by rounds played on that side specifically, not by total rounds. Hover a cell for the
        raw numbers behind it.</li>
      <li><strong>Assists</strong> have no signal in the log — implemented as: a teammate dealt at least
        <strong>${config.assistDamageThreshold}</strong> damage to the victim within
        <strong>${config.assistTimeWindowTicks}</strong> ticks before the kill. Tick rate is unknown, so
        this tick window is a placeholder, not a time-based value — tune
        <code>assistDamageThreshold</code> / <code>assistTimeWindowTicks</code> in stats.js.</li>
      <li><strong>KAST "Traded"</strong> uses the same unconfirmed
        <strong>${config.tradeTimeWindowTicks}</strong>-tick window (<code>tradeTimeWindowTicks</code> in
        stats.js) for "a teammate killed the killer shortly after."</li>
      <li><strong>Best Weapon</strong> is chosen by most kills (ties broken by damage). Weapon codes are
        unmapped — fill in <code>weaponNames</code> in stats.js once confirmed.</li>
    </ul>
  `;
  return details;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drop-zone--active');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drop-zone--active');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drop-zone--active');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
