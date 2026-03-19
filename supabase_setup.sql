-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ── Leaderboard scores table ──────────────────────────────────────────────────
create table if not exists leaderboard_scores (
  id            bigserial primary key,
  name          text        not null default 'Anonymous',
  time_seconds  integer     not null check (time_seconds > 0),
  difficulty    text        not null check (difficulty in ('easy','medium','hard')),
  grid_size     integer     not null check (grid_size between 5 and 10),
  created_at    timestamptz not null default now()
);

-- Index for fast leaderboard queries
create index if not exists idx_lb_diff_time on leaderboard_scores (difficulty, time_seconds asc);

-- RLS: enable row-level security
alter table leaderboard_scores enable row level security;

-- Anyone can read scores (public leaderboard)
create policy "Public read scores"
  on leaderboard_scores for select
  using (true);

-- Anyone can insert a score (anon key is safe — no UPDATE/DELETE allowed)
create policy "Public insert scores"
  on leaderboard_scores for insert
  with check (
    length(name) <= 24
    and time_seconds > 0
    and difficulty in ('easy','medium','hard')
    and grid_size between 5 and 10
  );

-- No one can update or delete via the anon key
-- (UPDATE/DELETE policies are omitted — defaults to deny)


-- ── Game events / analytics table ────────────────────────────────────────────
create table if not exists game_events (
  id            bigserial primary key,
  event_name    text        not null,
  difficulty    text,
  grid_size     integer,
  time_seconds  integer,
  extra         jsonb,
  created_at    timestamptz not null default now()
);

-- Index for analytics queries
create index if not exists idx_events_name_time on game_events (event_name, created_at desc);

-- RLS
alter table game_events enable row level security;

-- Only service-role key (server-side) can read analytics — anon cannot
create policy "Public insert events"
  on game_events for insert
  with check (
    event_name in ('puzzle_start','puzzle_complete','hint_used','undo_used')
  );
