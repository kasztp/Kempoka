# Kempoka Cloud Backend

Technical reference for Kempoka's optional shared backend: a public fighter-publishing slot
and a persistent, shared tournament high-score list, built on a free Supabase project plus
Cloudflare Turnstile. This is the full reference for engineers/agents deploying or modifying the
backend; `README.md`'s "Shared roster & highscores" section is the short, user-facing version and
links here.

Related docs: `docs/game_logic.md` covers `game-logic.js`'s general data model (belts, `CHARACTERS`,
combat math, i18n, `CharacterStore`) and treats `SharedStore` as a black box — this doc is the
full story on `SharedStore` and everything behind it. `docs/UI.md` owns the Publish button, the
Tournament screen flow, and the High Scores list rendering; this doc only covers what those UI
elements send over the network and why.

## Opt-in design: fully offline by default

Everything in Kempoka works with `config.js` left at its default (blank) — no shared roster, no
highscore list, unlimited private "My Fighters" exactly as the game behaved before this feature
existed. No other module in the codebase branches on whether a backend exists; that logic is
centralized in one gate.

`config.js` defines a single global, `window.KEMPOKA_CONFIG`, with three fields (see below). In
`game-logic.js`, `sharedConfig()` is the single point that decides whether a backend is configured:

```js
function sharedConfig(){
  const c = typeof KEMPOKA_CONFIG!=='undefined' ? KEMPOKA_CONFIG : undefined;
  return (c && c.SUPABASE_URL && c.SUPABASE_PUBLISHABLE_KEY) ? c : null;
}
```

Every `SharedStore` method calls this first and short-circuits to an empty/no-op result (`[]` for
reads, `false` for writes) if it returns `null` — none of them ever throw for "not configured".
`SharedStore.isConfigured()` exposes the same check so UI code can hide the Publish button and
Tournament/High Scores affordances entirely rather than rendering a Turnstile widget for a feature
that's fully off.

Contrast with `CharacterStore`, right next to it in `game-logic.js`: that one is local-only and
always-on (backed by `localStorage`, or an in-memory fallback under `node --test`), with no
config gate at all — it's how "My Fighters" persistence works regardless of whether the shared
backend is configured.

## What the backend adds

Exactly two features, both opt-in:

1. **Publish a fighter** — from Create Fighter's "My Fighters" list (UI in `docs/UI.md`), publish
   exactly one of your local fighters as your public character. Other players then see it as a
   selectable CPU opponent, badged like any other custom fighter. Publishing again overwrites your
   previous published fighter (one row per owner — see the `characters` table below).
2. **Tournament mode + shared high-score list** — beat every other roster character in sequence
   (your own fighter last, mirroring a final boss), one 120-second round per opponent
   (`TOURNEY_ROUND_TIME` in `game-logic.js`, vs. the normal `ROUND_TIME` best-of-three). A win
   banks the remaining seconds and advances; a loss or draw ends the run. The score sent to the
   backend, computed in `index.html`:

   ```js
   // index.html
   tournament.timeBank += Math.ceil(Math.max(0, roundTimer));  // per win, on advance
   ...
   tournamentResult = { score: tournament.beaten*100 + tournament.timeBank, beaten: tournament.beaten };
   ```

   i.e. `score = (fighters beaten × 100) + (sum of banked seconds remaining in each won round)`.
   The full tournament UI flow (progress screen, score-entry screen, high-score table rendering)
   is `docs/UI.md`'s territory — this doc only covers the `{ name, score, beaten }` payload that
   gets submitted.

## Data model (`supabase-schema.sql`)

Two tables, run once via the Supabase SQL editor:

```sql
create table if not exists characters (
  owner_id   uuid primary key,        -- one published fighter per anonymous Supabase user
  char_id    text not null,
  name       text not null,
  data       jsonb not null,          -- full normalized character object (see normalizeCharacter)
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
```

`characters.owner_id` as primary key is what enforces "one published fighter per user" — a second
publish is an upsert on the same key, not a new row. `scores` is append-only (auto-incrementing
`id`), indexed on `score desc` for the high-score query.

**Row-level security posture**: both tables have RLS enabled with only `select` policies —
`create policy read_chars on characters for select using (true)` and the equivalent for `scores`.
There are **deliberately no insert/update/delete policies at all**. That means RLS denies every
direct write, even from a signed-in-anonymously authenticated client — reads are public via
PostgREST and the publishable key, but nothing can write directly to either table from the
browser. The only way to write is the `kempoka-write` Edge Function, which uses the project's
secret key (bypasses RLS by design) after doing its own checks. This is intentional: RLS can't
express "validate this payload" or "rate-limit this caller" or "verify a Turnstile token" — those
checks only exist in one place (server-side code) if all writes are forced through it. Direct
table writes from the client would have no such choke point.

## Auth model: anonymous Supabase auth

One real Supabase-managed anonymous session per browser — no email, no password, nothing the
player ever sees. `SupaAuth` in `game-logic.js` signs up anonymously on first use (`POST
/auth/v1/signup` with an empty body) and persists the resulting `{access_token, refresh_token}`
pair via the same `kvStore()` helper `CharacterStore` uses. `auth.uid()` from that session's JWT
*is* the ownership identity referenced by `characters.owner_id` and `scores.owner_id` — the Edge
Function derives it server-side from the caller's JWT (see below), it's never trusted from the
client payload. `authedFetch()` wraps the write-gateway call with the bearer token and retries
once with a refreshed token on a 401 (an expired access token, not an auth failure).

## `SharedStore`: the client-side networking interface

`SharedStore` (in `game-logic.js`, next to `CharacterStore`) is the only module that talks to
Supabase. Its shape:

```js
{
  isConfigured: () => boolean,
  listCharacters: () => Promise<Character[]>,          // public read, straight to PostgREST
  publishCharacter: (char, turnstileToken) => Promise<boolean>,   // via kempoka-write
  unpublishCharacter: (turnstileToken) => Promise<boolean>,       // via kempoka-write
  submitScore: (entry, turnstileToken) => Promise<boolean>,       // via kempoka-write
  topScores: (limit) => Promise<{name,score,beaten}[]>,           // public read, straight to PostgREST
}
```

Reads (`listCharacters`, `topScores`) go directly to PostgREST (`GET
{SUPABASE_URL}/rest/v1/characters?select=data`, `.../scores?select=name,score,beaten&order=score.desc`)
using only the publishable key — no auth needed, matching the public `select` RLS policies. Every
method degrades to `[]`/`false` on any error (bad config, network failure, non-OK response) rather
than throwing, so a flaky or unreachable backend never crashes the game.

Writes (`publishCharacter`, `unpublishCharacter`, `submitScore`) all funnel through one internal
`writeAction(action, payload, turnstileToken)` helper that POSTs to
`{SUPABASE_URL}/functions/v1/kempoka-write` with `{ action, payload, turnstileToken }` as the
body, authenticated via `SupaAuth.authedFetch`. `listCharacters` re-runs every row through the same
`normalizeCharacter()` that `CharacterStore` uses, so a shared/cloud character is validated on the
way in exactly like a local one.

## The write gateway: `kempoka-write` Edge Function

Path: `supabase/functions/kempoka-write/index.ts`. This is Kempoka's *only* write path for shared
characters/scores — per the RLS posture above, a direct client write is always denied. Per
request, it:

1. **Resolves the caller's identity** from their anonymous-auth JWT (`Authorization` header) via
   `userClient.auth.getUser()` — never from a client-supplied id. Missing/invalid → `401`.
2. **Verifies a Cloudflare Turnstile token** server-side (`verifyTurnstile`, a POST to
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the server-side secret) before
   doing anything else. Failure → `403`.
3. **Clamps/validates the payload.** `clampCharacter()` mirrors `normalizeCharacter`'s enums and
   numeric bounds from `game-logic.js` (hair/beard/special-type enums, hex-color regex, stat
   ranges, belt choices, string length caps) — duplicated here on purpose, since the Deno edge
   runtime can't `require()` that file. `submit_score` separately clamps `score` to `[0, 100000]`
   and `beaten` to `[0, 999]`, truncated to integers.
4. **Writes with the secret key** (`SECRET_KEY`, full access, bypasses RLS), always forcing
   `owner_id` to the caller's own `uid` — a client can never write on behalf of another owner.

Three actions, dispatched by `body.action`:

- `publish_character` — upserts one row into `characters` keyed by `owner_id` (so a second publish
  overwrites the first). Requires `payload.data` to be the *full* shape `normalizeCharacter`
  produces (id included), because `listCharacters()` re-normalizes every row it reads back.
- `unpublish_character` — deletes the caller's row from `characters`.
- `submit_score` — inserts one row into `scores`.

Anything else returns `400 unknown action`.

Environment/secrets (see the file's own header comment): `SUPABASE_URL` and the project's
publishable/secret keys are auto-injected into every Edge Function by the platform — nothing to
configure for those. The function reads `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` (new,
JSON-object-of-named-keys) via a `firstKey()` helper, falling back to the legacy
`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` single-string vars for a project that hasn't
migrated yet. The **one** secret that must be set by hand is `TURNSTILE_SECRET_KEY`, via `supabase
secrets set` (see Deployment below) — it is never checked into this repo or shipped client-side.

## Cloudflare Turnstile

Turnstile is Kempoka's bot/spam resistance on the public write endpoints — it stops scripted mass
publishes/score submissions from ever reaching the Edge Function, let alone the database. For a
real player it is "almost always invisible" (per the README and the widget's own
`error-callback`/`expired-callback` handling in `index.html`): it renders a one-shot widget only
while a publish or score-submit action is in flight, and resolves to a token without visible
interaction in the common case.

Two keys, with sharply different trust levels:

- **Site Key** (`TURNSTILE_SITE_KEY` in `config.js`) — public, meant to be embedded in client code.
  It only identifies which widget to render; it grants nothing on its own.
- **Secret Key** (`TURNSTILE_SECRET_KEY`) — server-side only, used by the Edge Function to verify a
  token against Cloudflare's `siteverify` endpoint. Set via `supabase secrets set
  TURNSTILE_SECRET_KEY=... --project-ref <ref>`; never appears in client code or this repo.

## `config.js`'s three public fields

```js
window.KEMPOKA_CONFIG = {
  SUPABASE_URL: '...',
  SUPABASE_PUBLISHABLE_KEY: '...',   // Project Settings → API Keys → Publishable key (sb_publishable_...)
  TURNSTILE_SITE_KEY: '...',
};
```

Per `config.js`'s own comments, all three are meant to be public (shipped in client code):

- The **Supabase publishable key** (formerly called the "anon" key; Supabase is retiring that
  name) "grants nothing beyond what `supabase-schema.sql`'s row-level-security policies allow
  (public reads, no direct writes)".
- The **Turnstile site key** "is a public widget id, not a secret".

This is the same reasoning laid out above: RLS makes the publishable key read-only-and-public by
construction, and Turnstile's site key is designed to be embedded (it just tells Cloudflare which
site's widget config to apply — the verification secret stays server-side).

**Never ship client-side**: the **Turnstile Secret Key**, and Supabase's legacy
**`service_role`** key / its replacement, the **Secret** key (as distinct from **Publishable**).
Both grant full, RLS-bypassing access — they belong only in the Edge Function's environment
(auto-injected by Supabase for `SECRET_KEY`; hand-set via `supabase secrets set` for
`TURNSTILE_SECRET_KEY`), never in `config.js`, never in any file committed to this repo.

## Deployment walkthrough

1. **Create a Supabase project** (free tier is enough) at [supabase.com](https://supabase.com).
2. **Run the schema**: Project → SQL Editor → New query → paste in `supabase-schema.sql` in full →
   Run. This creates `characters`/`scores` with RLS enabled and only `select` policies — no
   further table setup needed.
3. **Enable Anonymous sign-ins**: Project Settings → Authentication → Providers → toggle on
   "Anonymous Sign-Ins". Without this, `SupaAuth.signUpAnonymous` will fail and every
   `SharedStore` write silently degrades to `false`.
4. **Create a Cloudflare Turnstile widget**: [Cloudflare dashboard](https://dash.cloudflare.com) →
   Turnstile → Add site (any widget mode works — this repo's widget usage doesn't depend on a
   specific mode). Note both the **Site Key** and the **Secret Key** it gives you.
5. **Deploy the write gateway and set its secret**, from a machine with the [Supabase
   CLI](https://supabase.com/docs/guides/cli) installed and logged in:
   ```
   supabase functions deploy kempoka-write --project-ref <your-project-ref>
   supabase secrets set TURNSTILE_SECRET_KEY=<Turnstile secret> --project-ref <your-project-ref>
   ```
   `TURNSTILE_SECRET_KEY` is the only secret to set by hand — `SUPABASE_URL` and the project's
   publishable/secret keys are auto-injected into every Edge Function's environment.
6. **Fill in `config.js`** with the project's URL, its **Publishable** key (Project Settings → API
   Keys → Publishable key, starts `sb_publishable_...`), and the Turnstile **Site** Key. Reload the
   game — `sharedConfig()` now resolves non-null, `SharedStore.isConfigured()` returns `true`, and
   the Publish button / Tournament / High Scores UI light up automatically. No other code change
   is needed anywhere in the game to turn the feature on.

To go back to fully offline/local, blank out any of the three `config.js` fields.

## CI (`.github/workflows/ci.yml`)

CI runs on every push to `main` and every pull request: checkout, set up Node 20, `npm test`
(`node --test`, per `package.json`). That exercises `game-logic.test.js` and `render3d.test.js` —
unit tests for `game-logic.js`'s pure logic (combat math, `normalizeCharacter`, i18n helpers, etc.)
and `render3d.js`. There is no integration test against a live Supabase project or the
`kempoka-write` Edge Function in this workflow — the backend's schema, RLS policies, and Edge
Function logic are not covered by CI and must be verified manually (or via a separate harness) when
changed.
