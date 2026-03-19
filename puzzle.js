/**
 * Patches Puzzle Generator
 *
 * Generates valid Shikaku/Tatamibari-style puzzles:
 * - Divide an N×N grid into non-overlapping rectangles
 * - Each rectangle has a seed cell with: optional number (area) + shape type clue
 * - Shape types: 'square', 'tall', 'wide', 'any'
 */

const SHAPE = { SQUARE: 'square', TALL: 'tall', WIDE: 'wide', ANY: 'any' };

/**
 * Generate a puzzle for an N×N grid.
 * Returns array of patch objects:
 *   { id, r1, c1, r2, c2, seedRow, seedCol, shapeClue, numClue, trueShape, area }
 */
function generatePuzzle(N, difficulty) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const solution = generateSolution(N, difficulty);
    if (solution) {
      return applyClues(solution, difficulty);
    }
  }
  return applyClues(fallbackSolution(N), difficulty);
}

// ── Solution generation ───────────────────────────────────────────────────────

/**
 * Fill N×N grid with non-overlapping rectangles using a greedy top-left-first
 * approach with randomized rectangle sizes.
 * Returns array of {id, r1, c1, r2, c2} or null on failure.
 */
function generateSolution(N, difficulty) {
  const grid = new Int8Array(N * N).fill(-1);
  const rects = [];
  const maxSize = maxPatchSize(N, difficulty);
  // minSize matches the target so small leftover patches don't form
  const target = targetPatchSize(N, difficulty);
  const minSize = Math.max(2, Math.floor(target * 0.5));

  let id = 0;
  while (true) {
    // Find first uncovered cell
    let startIdx = grid.indexOf(-1);
    if (startIdx === -1) break; // done
    const startR = Math.floor(startIdx / N);
    const startC = startIdx % N;

    // Build list of valid rectangles from this corner
    const candidates = [];
    for (let h = 1; h <= Math.min(N - startR, maxSize); h++) {
      for (let w = 1; w <= Math.min(N - startC, maxSize); w++) {
        if (!canPlace(grid, N, startR, startC, h, w)) break; // column blocked — skip wider
        if (h * w < minSize) continue; // skip too-small patches
        candidates.push([h, w]);
      }
    }
    // If no valid candidate of minSize, allow 1×1 as last resort to avoid getting stuck
    if (candidates.length === 0) {
      if (canPlace(grid, N, startR, startC, 1, 1)) candidates.push([1, 1]);
    }

    if (candidates.length === 0) return null;

    // Bias toward medium sizes to avoid one huge rectangle eating the grid
    shuffle(candidates);
    // Sort: prefer sizes close to target
    const target = targetPatchSize(N, difficulty);
    candidates.sort((a, b) => {
      const da = Math.abs(a[0]*a[1] - target);
      const db = Math.abs(b[0]*b[1] - target);
      return da - db + (Math.random() - 0.5) * 2;
    });

    const [h, w] = candidates[0];
    placeRect(grid, N, startR, startC, h, w, id);
    rects.push({ id, r1: startR, c1: startC, r2: startR + h - 1, c2: startC + w - 1 });
    id++;
  }

  return rects;
}

function maxPatchSize(N, difficulty) {
  // Cap max side length (not area) to prevent one giant patch eating the grid
  switch (difficulty) {
    case 'easy':   return Math.ceil(N / 2);      // e.g. 3 on 5×5
    case 'medium': return Math.ceil(N * 0.7);    // e.g. 4 on 5×5
    case 'hard':   return N;                     // full grid width allowed
    default:       return Math.ceil(N * 0.7);
  }
}

function targetPatchSize(N, difficulty) {
  // Target patch count: easy=5, medium=7, hard=10 (scales with grid)
  // More patches = harder because more constraints to satisfy simultaneously
  // targetSize = N² / targetCount
  const targetCount = { easy: 5, medium: 7, hard: 10 }[difficulty] ?? 7;
  return Math.max(2, Math.round(N * N / targetCount));
}

function canPlace(grid, N, r, c, h, w) {
  if (r + h > N || c + w > N) return false;
  for (let dr = 0; dr < h; dr++)
    for (let dc = 0; dc < w; dc++)
      if (grid[(r + dr) * N + (c + dc)] !== -1) return false;
  return true;
}

function placeRect(grid, N, r, c, h, w, id) {
  for (let dr = 0; dr < h; dr++)
    for (let dc = 0; dc < w; dc++)
      grid[(r + dr) * N + (c + dc)] = id;
}

function fallbackSolution(N) {
  // Safe fallback: 1×N rows
  return Array.from({ length: N }, (_, r) => ({
    id: r, r1: r, c1: 0, r2: r, c2: N - 1,
  }));
}

// ── Clue assignment ───────────────────────────────────────────────────────────

function applyClues(rects, difficulty) {
  return rects.map(rect => {
    const h = rect.r2 - rect.r1 + 1;
    const w = rect.c2 - rect.c1 + 1;
    const area = h * w;

    let trueShape;
    if (h === w)     trueShape = SHAPE.SQUARE;
    else if (h > w)  trueShape = SHAPE.TALL;
    else             trueShape = SHAPE.WIDE;

    const shapeClue = pickShapeClue(trueShape, difficulty);
    const numClue   = pickNumClue(area, shapeClue, difficulty);

    // Seed cell: center of rectangle
    const seedRow = rect.r1 + Math.floor(h / 2);
    const seedCol = rect.c1 + Math.floor(w / 2);

    return {
      id: rect.id,
      r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2,
      seedRow, seedCol,
      shapeClue, numClue, trueShape, area,
    };
  });
}

function pickShapeClue(trueShape, difficulty) {
  const anyProb = { easy: 0, medium: 0.2, hard: 0.45 }[difficulty] ?? 0.2;
  return Math.random() < anyProb ? SHAPE.ANY : trueShape;
}

function pickNumClue(area, shapeClue, difficulty) {
  let prob;
  if (shapeClue === SHAPE.ANY) {
    prob = { easy: 1, medium: 0.9, hard: 0.7 }[difficulty] ?? 0.9;
  } else {
    prob = { easy: 1, medium: 0.7, hard: 0.45 }[difficulty] ?? 0.7;
  }
  return Math.random() < prob ? area : null;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate player-assigned patch bounds against puzzle clues.
 * Each entry in puzzlePatches must have: r1,c1,r2,c2,shapeClue,numClue
 * Returns { valid: bool, errors: [{patchId, reason}] }
 */
function validateAssignment(puzzlePatches, N) {
  const grid = new Int8Array(N * N).fill(-1);
  const errors = [];

  for (const p of puzzlePatches) {
    const h = p.r2 - p.r1 + 1;
    const w = p.c2 - p.c1 + 1;
    const area = h * w;

    if (p.numClue !== null && area !== p.numClue) {
      errors.push({ patchId: p.id, reason: `Size should be ${p.numClue}, got ${area}` });
    }

    if (p.shapeClue !== SHAPE.ANY) {
      const ok = p.shapeClue === SHAPE.SQUARE ? h === w
               : p.shapeClue === SHAPE.TALL   ? h > w
               :                                w > h;
      if (!ok) errors.push({ patchId: p.id, reason: `Shape mismatch: expected ${p.shapeClue}` });
    }

    for (let r = p.r1; r <= p.r2; r++) {
      for (let c = p.c1; c <= p.c2; c++) {
        if (r < 0 || r >= N || c < 0 || c >= N) {
          errors.push({ patchId: p.id, reason: 'Out of bounds' });
        } else if (grid[r * N + c] !== -1) {
          errors.push({ patchId: p.id, reason: 'Overlaps another patch' });
        } else {
          grid[r * N + c] = p.id;
        }
      }
    }
  }

  for (let i = 0; i < N * N; i++) {
    if (grid[i] === -1) errors.push({ patchId: -1, reason: `Cell ${i} uncovered` });
  }

  return { valid: errors.length === 0, errors };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

window.PatchesPuzzle = { generatePuzzle, validateAssignment, SHAPE };
