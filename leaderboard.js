/**
 * Leaderboard & Analytics — Supabase integration
 *
 * Tables (create via SQL in Supabase dashboard):
 *
 *   leaderboard_scores
 *   game_events
 *
 * See supabase_setup.sql for the full schema + RLS policies.
 */

let _sb = null;

function getSupabase() {
  if (_sb) return _sb;
  if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL === 'YOUR_SUPABASE_URL') return null;
  _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _sb;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

/**
 * Submit a score to the leaderboard.
 * name is optional — anonymous submissions use 'Anonymous'.
 * Returns { success: bool, error: string|null }
 */
async function submitScore(name, timeSeconds, difficulty, gridSize) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: 'Supabase not configured' };

  const displayName = (name || '').trim() || 'Anonymous';

  const { error } = await sb.from('leaderboard_scores').insert({
    name: displayName,
    time_seconds: timeSeconds,
    difficulty,
    grid_size: gridSize,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

/**
 * Fetch top 10 scores for a given difficulty.
 * Returns array of { rank, name, time_seconds }
 */
async function fetchScores(difficulty) {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('leaderboard_scores')
    .select('name, time_seconds')
    .eq('difficulty', difficulty)
    .order('time_seconds', { ascending: true })
    .limit(10);

  if (error || !data) return [];
  return data.map((row, i) => ({ rank: i + 1, ...row }));
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * Track a game event (fire-and-forget, non-blocking).
 * eventName: 'puzzle_start' | 'puzzle_complete' | 'hint_used' | 'undo_used'
 */
function trackEvent(eventName, props = {}) {
  const sb = getSupabase();
  if (!sb) return;

  sb.from('game_events').insert({
    event_name: eventName,
    difficulty: props.difficulty || null,
    grid_size: props.gridSize || null,
    time_seconds: props.timeSeconds || null,
    extra: Object.keys(props).length ? props : null,
  }).then(() => {}); // fire and forget
}

// ── Leaderboard UI ────────────────────────────────────────────────────────────

let _currentLbDiff = 'easy';

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2,'0')}s` : `${s}s`;
}

async function renderLeaderboard(difficulty) {
  _currentLbDiff = difficulty;

  // Update tab states
  document.querySelectorAll('.lb-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.diff === difficulty);
  });

  const tbody  = document.getElementById('lbBody');
  const empty  = document.getElementById('lbEmpty');
  const loading = document.getElementById('lbLoading');

  tbody.innerHTML = '';
  empty.style.display  = 'none';
  loading.style.display = 'block';

  const scores = await fetchScores(difficulty);
  loading.style.display = 'none';

  if (scores.length === 0) {
    empty.style.display = 'block';
    return;
  }

  const rankClasses = ['lb-rank-gold', 'lb-rank-silver', 'lb-rank-bronze'];
  scores.forEach(({ rank, name, time_seconds }) => {
    const tr = document.createElement('tr');
    const rankClass = rank <= 3 ? rankClasses[rank - 1] : '';
    tr.innerHTML = `
      <td class="${rankClass}">${rank}</td>
      <td>${escapeHtml(name)}</td>
      <td>${formatTime(time_seconds)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function bindLeaderboardUI() {
  // Trophy button opens leaderboard
  document.getElementById('leaderboardBtn').addEventListener('click', () => {
    document.getElementById('leaderboardModal').style.display = 'flex';
    renderLeaderboard(_currentLbDiff);
  });

  // Tab switching
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => renderLeaderboard(tab.dataset.diff));
  });

  // Close leaderboard
  document.getElementById('lbCloseBtn').addEventListener('click', () => {
    document.getElementById('leaderboardModal').style.display = 'none';
  });
  document.getElementById('leaderboardModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('leaderboardModal')) {
      document.getElementById('leaderboardModal').style.display = 'none';
    }
  });

  // Submit score from win modal
  const submitBtn = document.getElementById('lbSubmitBtn');
  submitBtn.addEventListener('click', async () => {
    const btn    = document.getElementById('lbSubmitBtn');
    const status = document.getElementById('lbSubmitStatus');
    const name   = document.getElementById('lbNameInput').value.trim();

    // "Done" state — open the leaderboard
    if (btn.dataset.state === 'done') {
      document.getElementById('winModal').style.display = 'none';
      document.getElementById('leaderboardModal').style.display = 'flex';
      renderLeaderboard(_currentLbDiff);
      return;
    }

    btn.disabled = true;
    btn.textContent = '…';
    status.className = 'lb-submit-status';
    status.textContent = 'Submitting…';

    // These globals are set by game.js on win
    const result = await submitScore(name, window._lastWinTime, window._lastWinDifficulty, window._lastWinGridSize);

    if (result.success) {
      status.className = 'lb-submit-status success';
      status.textContent = '✓ Score submitted! Tap Done to view the board.';
      btn.textContent = 'Done';
      btn.dataset.state = 'done';
      btn.disabled = false;
      document.getElementById('lbNameInput').disabled = true;
      _currentLbDiff = window._lastWinDifficulty;
    } else {
      status.className = 'lb-submit-status error';
      status.textContent = result.error || 'Failed to submit.';
      btn.disabled = false;
      btn.textContent = 'Retry';
    }
  });
}

window.LB = { submitScore, fetchScores, trackEvent, renderLeaderboard, bindLeaderboardUI };
