/**
 * Patches Game Engine
 * Handles rendering, interaction (drag to resize patches), undo, hints, timer, and win detection.
 */
'use strict';

// Aliases to puzzle engine (avoid redeclaring names from puzzle.js global scope)
const _generatePuzzle    = (n, d) => window.PatchesPuzzle.generatePuzzle(n, d);
const _validateAssignment = (p, n) => window.PatchesPuzzle.validateAssignment(p, n);
const _SHAPE = { SQUARE: 'square', TALL: 'tall', WIDE: 'wide', ANY: 'any' };

// ── State ─────────────────────────────────────────────────────────────────────

const PATCH_COLORS = [
  '#5b9bd5','#4caf70','#e05a4e','#c8a840',
  '#7b68c8','#e87d3e','#3ba8a8','#d4608c',
  '#8bad5a','#8070c0','#e8a020','#3c9ad0',
];

// Grid size per difficulty
const DIFFICULTY_SIZES = { easy: 5, medium: 7, hard: 10 };

let state = {
  N: 5,
  difficulty: 'easy',
  puzzlePatches: [],   // solution patches from generator
  playerState: [],     // [{id, r1,c1,r2,c2}] — current player-adjusted patch bounds
  history: [],         // stack of playerState snapshots for undo
  timerSecs: 0,
  timerInterval: null,
  won: false,
  dragInfo: null,
  errorMsg: null,      // current error message to show
};

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  newPuzzle();
  bindUI();
  if (window.LB) window.LB.bindLeaderboardUI();
}

function newPuzzle() {
  stopTimer();
  const patches = _generatePuzzle(state.N, state.difficulty);
  state.puzzlePatches = patches;
  // Player starts with seed cell as a 1×1 patch at seedRow/seedCol
  state.playerState = patches.map(p => ({
    id: p.id,
    r1: p.seedRow, c1: p.seedCol,
    r2: p.seedRow, c2: p.seedCol,
  }));
  state.history = [];
  state.won = false;
  state.timerSecs = 0;
  state.errorMsg = null;
  document.getElementById('timer').textContent = '0:00';
  document.getElementById('seeResultsBtn').style.display = 'none';
  document.getElementById('winModal').style.display = 'none';
  renderGrid();
  startTimer();
  if (window.LB) window.LB.trackEvent('puzzle_start', { difficulty: state.difficulty, gridSize: state.N });
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer() {
  state.timerInterval = setInterval(() => {
    if (state.won) return;
    state.timerSecs++;
    const m = Math.floor(state.timerSecs / 60);
    const s = state.timerSecs % 60;
    document.getElementById('timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderGrid() {
  const gridEl = document.getElementById('grid');
  const N = state.N;

  gridEl.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
  gridEl.innerHTML = '';

  const cellMap = buildCellMap();
  // Pending drag rect (gray preview when no seed claimed yet)
  const pending = state.dragInfo && !state.dragInfo.claimedPid ? state.dragInfo.pendingRect : null;

  // Determine which patches are currently invalid (wrong size or overlapping)
  const invalidPids = new Set(getInvalidPatchIds());

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;

      const pid = cellMap[r][c];
      // Check if inside pending (unclaimed) drag rect
      const inPending = pending && r >= pending.r1 && r <= pending.r2 && c >= pending.c1 && c <= pending.c2;

      if (inPending) {
        cell.classList.add('filled', 'pending-drag');
      } else if (pid !== -1) {
        const color = PATCH_COLORS[pid % PATCH_COLORS.length];
        const invalid = invalidPids.has(pid);
        cell.classList.add('filled');
        if (invalid) cell.classList.add('invalid');
        cell.style.setProperty('--patch-color', color);
        cell.style.setProperty('--patch-tint', hexToTint(color, 0.35));
        cell.dataset.patch = pid;
        applyBorderStyle(cell, r, c, pid, cellMap, N, invalid);
      }

      // Seed cell: always render label (even if pending covers it)
      const puzzle = state.puzzlePatches.find(p => p.seedRow === r && p.seedCol === c);
      if (puzzle) {
        const color = PATCH_COLORS[puzzle.id % PATCH_COLORS.length];
        const ps = state.playerState.find(p => p.id === puzzle.id);
        const currentArea = (ps.r2 - ps.r1 + 1) * (ps.c2 - ps.c1 + 1);
        const invalid = invalidPids.has(puzzle.id);
        cell.classList.add('seed');
        if (invalid) cell.classList.add('invalid');
        cell.style.setProperty('--patch-color', color);
        cell.style.setProperty('--patch-tint', hexToTint(color, 0.35));
        cell.appendChild(makeClueLabel(puzzle, currentArea, invalid));
      }

      gridEl.appendChild(cell);
    }
  }

  sizeCells();
  attachPointerEvents();
  renderErrorBanner();
}

// Returns set of patch IDs that violate their clues right now
function getInvalidPatchIds() {
  const invalid = [];
  for (const ps of state.playerState) {
    const puzzle = state.puzzlePatches.find(p => p.id === ps.id);
    if (!puzzle) continue;
    const h = ps.r2 - ps.r1 + 1, w = ps.c2 - ps.c1 + 1;
    const area = h * w;
    if (puzzle.numClue !== null && area !== puzzle.numClue) {
      invalid.push(ps.id);
      continue;
    }
    if (puzzle.shapeClue !== _SHAPE.ANY) {
      const ok = puzzle.shapeClue === _SHAPE.SQUARE ? h === w
               : puzzle.shapeClue === _SHAPE.TALL   ? h > w
               :                                      w > h;
      if (!ok) invalid.push(ps.id);
    }
  }
  return invalid;
}

function renderErrorBanner() {
  let banner = document.getElementById('errorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'errorBanner';
    banner.className = 'error-banner';
    document.querySelector('.game-container').appendChild(banner);
  }

  const drag = state.dragInfo;
  let msg = null;

  if (drag) {
    if (!drag.claimedPid && drag.pendingRect) {
      const { r1, c1, r2, c2 } = drag.pendingRect;
      const seeds = seedsInRect(r1, c1, r2, c2);
      if (seeds.length > 1) msg = 'A box can only contain one shape.';
      // 0 seeds: no message, just gray preview
    } else if (drag.claimedPid !== null) {
      const puzzle = state.puzzlePatches.find(p => p.id === drag.claimedPid);
      const ps = state.playerState.find(p => p.id === drag.claimedPid);
      if (puzzle && ps) {
        const area = (ps.r2 - ps.r1 + 1) * (ps.c2 - ps.c1 + 1);
        if (puzzle.numClue !== null && area !== puzzle.numClue) {
          msg = `Oops! This shaded region can only contain ${puzzle.numClue} cell${puzzle.numClue !== 1 ? 's' : ''}.`;
        } else if (puzzle.shapeClue !== _SHAPE.ANY) {
          const h = ps.r2 - ps.r1 + 1, w = ps.c2 - ps.c1 + 1;
          const ok = puzzle.shapeClue === _SHAPE.SQUARE ? h === w
                   : puzzle.shapeClue === _SHAPE.TALL   ? h > w
                   :                                      w > h;
          if (!ok) {
            const shapeNames = { square: 'a square', tall: 'a tall rectangle', wide: 'a wide rectangle' };
            msg = `This shape must be ${shapeNames[puzzle.shapeClue]}.`;
          }
        }
      }
    }
  }

  if (msg) {
    banner.textContent = msg;
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

function buildCellMap() {
  const N = state.N;
  const map = Array.from({length: N}, () => new Array(N).fill(-1));
  for (const ps of state.playerState) {
    for (let r = ps.r1; r <= ps.r2; r++)
      for (let c = ps.c1; c <= ps.c2; c++)
        map[r][c] = ps.id;
  }
  return map;
}

function applyBorderStyle(cell, r, c, pid, cellMap, N, invalid) {
  const color  = invalid ? '#e05050' : PATCH_COLORS[pid % PATCH_COLORS.length];
  const border = invalid ? '#c03030' : darken(PATCH_COLORS[pid % PATCH_COLORS.length], 0.25);

  const top    = r === 0    || cellMap[r-1][c] !== pid;
  const bottom = r === N-1  || cellMap[r+1][c] !== pid;
  const left   = c === 0    || cellMap[r][c-1] !== pid;
  const right  = c === N-1  || cellMap[r][c+1] !== pid;

  const bw = '2.5px';
  cell.style.borderTop    = top    ? `${bw} solid ${border}` : `${bw} solid transparent`;
  cell.style.borderBottom = bottom ? `${bw} solid ${border}` : `${bw} solid transparent`;
  cell.style.borderLeft   = left   ? `${bw} solid ${border}` : `${bw} solid transparent`;
  cell.style.borderRight  = right  ? `${bw} solid ${border}` : `${bw} solid transparent`;
}

function makeClueLabel(puzzle, currentArea, invalid) {
  const label = document.createElement('div');
  label.className = 'cell-label';

  if (puzzle.numClue !== null) {
    const num = document.createElement('div');
    num.className = 'clue-num';
    num.textContent = puzzle.numClue;
    label.appendChild(num);
  }

  if (puzzle.shapeClue !== _SHAPE.ANY) {
    const sym = document.createElement('div');
    sym.className = `shape-sym ${puzzle.shapeClue}`;
    label.appendChild(sym);
  }

  // Show current area count badge when dragging and size differs from clue
  if (invalid && currentArea !== undefined && puzzle.numClue !== null && currentArea !== puzzle.numClue) {
    const badge = document.createElement('div');
    badge.className = 'area-badge';
    badge.textContent = currentArea;
    label.appendChild(badge);
  }

  return label;
}

function sizeCells() {
  const wrapper = document.querySelector('.grid-wrapper');
  if (!wrapper) return;
  const available = wrapper.clientWidth - 28; // padding
  const cellSize = Math.floor(available / state.N);
  const gridEl = document.getElementById('grid');
  gridEl.style.gridTemplateRows = `repeat(${state.N}, ${cellSize}px)`;
  gridEl.style.gridTemplateColumns = `repeat(${state.N}, ${cellSize}px)`;
  gridEl.style.width = `${cellSize * state.N + 2 * (state.N - 1)}px`;
}

function darken(hex, amount) {
  let r = parseInt(hex.slice(1,3),16);
  let g = parseInt(hex.slice(3,5),16);
  let b = parseInt(hex.slice(5,7),16);
  r = Math.floor(r * (1-amount));
  g = Math.floor(g * (1-amount));
  b = Math.floor(b * (1-amount));
  return `rgb(${r},${g},${b})`;
}

// Mix color with white at given alpha (0=white, 1=full color)
function hexToTint(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const tr = Math.round(r * alpha + 255 * (1-alpha));
  const tg = Math.round(g * alpha + 255 * (1-alpha));
  const tb = Math.round(b * alpha + 255 * (1-alpha));
  return `rgb(${tr},${tg},${tb})`;
}

// ── Pointer / Drag Events ─────────────────────────────────────────────────────
//
// Interaction model:
//   - Drag from ANYWHERE on the grid to draw a rectangle
//   - Rectangle starts gray; turns colored when it covers exactly one seed
//   - On release: if exactly one seed inside → assign that patch; else revert
//   - Dragging an existing colored patch re-draws it from that patch's seed

function attachPointerEvents() {
  const gridEl = document.getElementById('grid');
  // Use a flag to avoid stacking duplicate listeners on re-renders
  if (gridEl._patchesListening) return;
  gridEl._patchesListening = true;
  gridEl.addEventListener('pointerdown', onPointerDown);
  gridEl.addEventListener('pointermove', onPointerMove);
  gridEl.addEventListener('pointerup',   onPointerUp);
  gridEl.addEventListener('pointercancel', onPointerUp);
}

function cellFromEvent(e) {
  const gridEl = document.getElementById('grid');
  const rect = gridEl.getBoundingClientRect();
  const cellSize = rect.width / state.N;
  const c = clamp(Math.floor((e.clientX - rect.left) / cellSize), 0, state.N - 1);
  const r = clamp(Math.floor((e.clientY - rect.top)  / cellSize), 0, state.N - 1);
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top  || e.clientY > rect.bottom) return null;
  return { r, c };
}

// Find which seeds fall inside a rectangle [r1,r2]×[c1,c2]
function seedsInRect(r1, c1, r2, c2) {
  return state.puzzlePatches.filter(
    p => p.seedRow >= r1 && p.seedRow <= r2 && p.seedCol >= c1 && p.seedCol <= c2
  );
}

function onPointerDown(e) {
  if (state.won) return;
  e.preventDefault();

  const pos = cellFromEvent(e);
  if (!pos) return;

  // Anchor stays at the click point — drag expands in any direction from there
  const anchorR = pos.r, anchorC = pos.c;

  saveHistory();

  state.dragInfo = {
    anchorR, anchorC,       // where the drag started
    curR: pos.r, curC: pos.c,
    claimedPid: null,       // patch claimed once a seed is inside the rect
    // Track the maximum extent reached — once expanded, cells stay selected
    minR: pos.r, maxR: pos.r,
    minC: pos.c, maxC: pos.c,
  };

  updateDrag(pos.r, pos.c);
  renderGrid();

  try { document.getElementById('grid').setPointerCapture(e.pointerId); } catch(_) {}
}

function onPointerMove(e) {
  if (!state.dragInfo) return;
  e.preventDefault();

  const pos = cellFromEvent(e);
  if (!pos) return;

  updateDrag(pos.r, pos.c);
  renderGrid();
}

function onPointerUp(e) {
  if (!state.dragInfo) return;
  const drag = state.dragInfo;
  state.dragInfo = null;

  if (drag.claimedPid !== null && !hasOverlap(drag.claimedPid)) {
    checkWin();
  } else {
    // No seed claimed or overlaps — revert
    undoLast();
    if (drag.claimedPid !== null) flashError(drag.claimedPid);
  }
  renderGrid();
}

/**
 * Called on every pointermove/down — updates the drag rect and claimed patch.
 *
 * The rectangle only ever grows during a drag — once you expand in a direction,
 * moving the mouse back won't shrink it. Only Undo can reduce the selection.
 * Once a seed is claimed, the seed is always included in the rect.
 */
function updateDrag(curR, curC) {
  const drag = state.dragInfo;
  drag.curR = curR;
  drag.curC = curC;

  // Expand the max extent — rect only grows, never shrinks during a drag
  drag.minR = Math.min(drag.minR, curR);
  drag.maxR = Math.max(drag.maxR, curR);
  drag.minC = Math.min(drag.minC, curC);
  drag.maxC = Math.max(drag.maxC, curC);

  // If we have a claimed seed, make sure the rect always includes it
  if (drag.claimedPid !== null) {
    const puzzle = state.puzzlePatches.find(p => p.id === drag.claimedPid);
    if (puzzle) {
      drag.minR = Math.min(drag.minR, puzzle.seedRow);
      drag.maxR = Math.max(drag.maxR, puzzle.seedRow);
      drag.minC = Math.min(drag.minC, puzzle.seedCol);
      drag.maxC = Math.max(drag.maxC, puzzle.seedCol);
    }
  }

  const r1 = drag.minR, c1 = drag.minC;
  const r2 = drag.maxR, c2 = drag.maxC;

  const seeds = seedsInRect(r1, c1, r2, c2);

  if (drag.claimedPid !== null) {
    // Already claimed a patch — just keep updating its bounds (only grows)
    const ps = state.playerState.find(p => p.id === drag.claimedPid);
    ps.r1 = r1; ps.c1 = c1; ps.r2 = r2; ps.c2 = c2;
  } else if (seeds.length === 1) {
    // Exactly one seed found: claim this patch
    const pid = seeds[0].id;
    drag.claimedPid = pid;
    // Include the seed in the extent
    const puzzle = seeds[0];
    drag.minR = Math.min(drag.minR, puzzle.seedRow);
    drag.maxR = Math.max(drag.maxR, puzzle.seedRow);
    drag.minC = Math.min(drag.minC, puzzle.seedCol);
    drag.maxC = Math.max(drag.maxC, puzzle.seedCol);
    const ps = state.playerState.find(p => p.id === pid);
    ps.r1 = drag.minR; ps.c1 = drag.minC;
    ps.r2 = drag.maxR; ps.c2 = drag.maxC;
  } else {
    // Zero or multiple seeds and no claim yet — show gray pending rect
    drag.pendingRect = { r1, c1, r2, c2 };
  }
}

function hasOverlap(patchId) {
  const ps = state.playerState.find(p => p.id === patchId);
  for (const other of state.playerState) {
    if (other.id === patchId) continue;
    if (rectsOverlap(ps, other)) return true;
  }
  return false;
}

function rectsOverlap(a, b) {
  return !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);
}

function flashError(patchId) {
  document.querySelectorAll(`.cell[data-patch="${patchId}"]`).forEach(el => {
    el.classList.add('error-flash');
    setTimeout(() => el.classList.remove('error-flash'), 500);
  });
}

// ── Undo ──────────────────────────────────────────────────────────────────────

function saveHistory() {
  state.history.push(JSON.stringify(state.playerState));
  if (state.history.length > 50) state.history.shift();
  document.getElementById('undoBtn').disabled = false;
}

function undoLast() {
  if (state.history.length === 0) return;
  state.playerState = JSON.parse(state.history.pop());
  document.getElementById('undoBtn').disabled = state.history.length === 0;
}

// ── Win Check ─────────────────────────────────────────────────────────────────

function checkWin() {
  const N = state.N;
  // Build the playerState with shapeClue and numClue from puzzlePatches for validation
  const combined = state.playerState.map(ps => {
    const puzzle = state.puzzlePatches.find(p => p.id === ps.id);
    return { ...ps, shapeClue: puzzle.shapeClue, numClue: puzzle.numClue };
  });

  const result = _validateAssignment(combined, N);
  if (result.valid) {
    onWin();
  }
}

function onWin() {
  state.won = true;
  stopTimer();

  const m = Math.floor(state.timerSecs / 60);
  const s = state.timerSecs % 60;
  const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;

  // Expose win state for leaderboard submission
  window._lastWinTime       = state.timerSecs;
  window._lastWinDifficulty = state.difficulty;
  window._lastWinGridSize   = state.N;

  // Reset leaderboard submit form
  const nameInput = document.getElementById('lbNameInput');
  const submitBtn = document.getElementById('lbSubmitBtn');
  const status    = document.getElementById('lbSubmitStatus');
  if (nameInput) { nameInput.value = ''; nameInput.disabled = false; }
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
  if (status)    { status.textContent = ''; status.className = 'lb-submit-status'; }

  document.getElementById('finalTime').textContent = timeStr;
  document.getElementById('winModal').style.display = 'flex';
  document.getElementById('seeResultsBtn').style.display = 'block';

  if (window.LB) window.LB.trackEvent('puzzle_complete', {
    difficulty: state.difficulty,
    gridSize: state.N,
    timeSeconds: state.timerSecs,
  });
}

// ── Hint ──────────────────────────────────────────────────────────────────────

function giveHint() {
  // Find a patch that doesn't match the solution yet and snap it to solution
  for (const ps of state.playerState) {
    const puzzle = state.puzzlePatches.find(p => p.id === ps.id);
    if (ps.r1 !== puzzle.r1 || ps.c1 !== puzzle.c1 || ps.r2 !== puzzle.r2 || ps.c2 !== puzzle.c2) {
      saveHistory();
      ps.r1 = puzzle.r1; ps.c1 = puzzle.c1;
      ps.r2 = puzzle.r2; ps.c2 = puzzle.c2;
      renderGrid();

      // Highlight the hinted patch
      setTimeout(() => {
        document.querySelectorAll(`.cell[data-patch="${ps.id}"]`).forEach(el => {
          el.classList.add('hint-highlight');
          setTimeout(() => el.classList.remove('hint-highlight'), 1200);
        });
      }, 50);

      checkWin();
      return;
    }
  }
}

// ── Settings / UI ─────────────────────────────────────────────────────────────

function bindUI() {
  document.getElementById('undoBtn').addEventListener('click', () => {
    undoLast();
    renderGrid();
    if (window.LB) window.LB.trackEvent('undo_used', { difficulty: state.difficulty, gridSize: state.N });
  });
  document.getElementById('undoBtn').disabled = true;

  document.getElementById('hintBtn').addEventListener('click', () => {
    giveHint();
    if (window.LB) window.LB.trackEvent('hint_used', { difficulty: state.difficulty, gridSize: state.N });
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    state.playerState = state.puzzlePatches.map(p => ({
      id: p.id,
      r1: p.seedRow, c1: p.seedCol,
      r2: p.seedRow, c2: p.seedCol,
    }));
    state.history = [];
    state.won = false;
    state.timerSecs = 0;
    document.getElementById('timer').textContent = '0:00';
    document.getElementById('seeResultsBtn').style.display = 'none';
    document.getElementById('winModal').style.display = 'none';
    stopTimer();
    startTimer();
    renderGrid();
  });

  document.getElementById('playAgainBtn').addEventListener('click', newPuzzle);
  document.getElementById('seeResultsBtn').addEventListener('click', () => {
    document.getElementById('winModal').style.display = 'flex';
  });

  document.getElementById('shareBtn').addEventListener('click', () => {
    const m = Math.floor(state.timerSecs / 60);
    const s = state.timerSecs % 60;
    const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
    const text = `I solved Patches in ${timeStr}! 🧩 Play at: ${location.href}`;
    if (navigator.share) {
      navigator.share({ text });
    } else {
      navigator.clipboard.writeText(text).then(() => alert('Score copied to clipboard!'));
    }
  });

  // Settings dropdown
  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('settingsMenu').classList.toggle('open');
  });
  document.addEventListener('click', () => {
    document.getElementById('settingsMenu').classList.remove('open');
  });

  document.getElementById('newPuzzleBtn').addEventListener('click', () => {
    document.getElementById('settingsMenu').classList.remove('open');
    newPuzzle();
  });

  document.getElementById('difficultyBtn').addEventListener('click', () => {
    const levels = ['easy','medium','hard'];
    const idx = levels.indexOf(state.difficulty);
    state.difficulty = levels[(idx + 1) % levels.length];
    state.N = DIFFICULTY_SIZES[state.difficulty];
    document.getElementById('diffLabel').textContent = capitalize(state.difficulty);
    newPuzzle();
  });

  // Back button
  document.getElementById('backBtn').addEventListener('click', () => {
    if (confirm('Leave the game?')) window.history.back();
  });

  window.addEventListener('resize', () => sizeCells());
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Start ─────────────────────────────────────────────────────────────────────
// Scripts are at end of <body>, DOM is ready. Use setTimeout to ensure
// puzzle.js window.PatchesPuzzle assignment has been processed.
setTimeout(init, 0);
