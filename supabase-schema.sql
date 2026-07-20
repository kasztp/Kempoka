-- Kempoka shared backend — run once in the Supabase SQL editor (Project → SQL Editor → New query).
--
-- Reads (SELECT) are public via PostgREST and the publishable key — anyone can list characters/scores.
-- There are deliberately NO insert/update/delete policies: RLS denies every direct write, even
-- from an authenticated (signed-in-anonymously) client. The ONLY way to write is the
-- `kempoka-write` Edge Function, which authenticates the caller, verifies a Cloudflare Turnstile
-- token, clamps/validates the payload, and then writes with the service_role key (which bypasses
-- RLS by design). This is what makes the public write endpoints spam-resistant.

create table if not exists characters (
  owner_id   uuid primary key,        -- one published fighter per anonymous Supabase user
  char_id    text not null,
  name       text not null,
  data       jsonb not null,          -- full normalized character object (see normalizeCharacter in game-logic.js)
  updated_at timestamptz not null default now()
);

create table if not exists scores (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null,
  name       text not null,
  score      integer not null,
  beaten     integer not null,
  created_at timestamptz not null default now()
);

create index if not exists scores_score_desc_idx on scores (score desc);

alter table characters enable row level security;
alter table scores     enable row level security;

create policy read_chars  on characters for select using (true);
create policy read_scores on scores     for select using (true);
