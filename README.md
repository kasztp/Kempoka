# Kempoka — The Chosen Ones

A Street Fighter–style 2D fighting game themed around **Zen Bu Kan Kempo**. Runs in any
browser on desktop (keyboard) or phone/tablet (touch). No dependencies, no build step —
`index.html` is everything a player needs.

## Run it

Just open `index.html` in a browser — double-click it, or serve the folder:

```
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Tests

Belts, roster, move tables, and combat math (`computeDamage`, `moveDir`, `getBelt`, etc.) live in
`game-logic.js` — a small DOM-free module loaded by `index.html` via `<script src>` and also
`require()`-able directly from Node, which is what makes it unit-testable without a browser.
Everything canvas/DOM-dependent (rendering, input, audio, the game loop) stays in `index.html`.

```
npm test   # node --test — zero dependencies, uses Node's built-in test runner
```

`.github/workflows/ci.yml` runs the same command on every push/PR. There's also an in-browser
smoke check: append `?test=1` to the URL for a quick visual PASS/FAIL badge covering the same
combat math plus a live `CharacterStore` round-trip.

## Controls

**Player 1 (keyboard):** `A`/`D` move · `W` jump · `S` crouch · `J` punch (tsuki) ·
`K` kick (geri) · `L` block (uke) · `U` special · `I` grab / clinch counter

**Player 2 (keyboard, 2P mode):** `←`/`→` move · `↑` jump · `↓` crouch · Numpad `1` punch ·
`2` kick · `3` block · `0` special · `4` grab / counter

**Touch:** on-screen pad (move/jump/crouch) + action buttons appear automatically on touch
devices (during a fight). Touch drives Player 1 (vs CPU). On a desktop, you can preview them via
**Controls → Touch buttons: ON**.

**Moveset — direction + attack button.** You always auto-face the opponent; the *held direction*
selects the variant (→ = toward the foe, ← = away):

- **Punch:** neutral Jab · → Cross · ▲ Uppercut · ▼ Body hook · ← Head hook
- **Kick:** neutral Front kick (tepe) · ▼ Low kick · → Roundhouse (ribs) · ← Side kick · ▲ Head kick
- **Grab:** neutral Clinch (then punch = throw, kick a stunned foe = choke) · ▼ Double-leg takedown ·
  ← Single-leg takedown · ▲ Judo throw

Uppercut and head kick punish jump-ins; low kick and body hook stay under high strikes. Punches and
kicks work in mid-air; blocks, grabs, throws and chokes are ground-only. Takedowns whiff and leave you
open if you shoot out of range or into a block. The full list is on the in-game **Controls** screen.

## Grappling

Throws and chokes are legal but **only from a clinch** — get close and **grab** first. From a
clinch you can **throw** (knockdown) or, from behind, **choke** (a gradual drain). The grabbed
fighter can press grab/counter to **break free** or, with good timing, **reverse** it. No strikes
on a downed opponent.

## Stages

Each fight cycles to the next of four arenas, in order: **Underground Dojo** (brick basement,
calligraphy scrolls, swaying heavy bags, tatami), **Rooftop Cage** (neon skyline, chain-link fence,
rain), **Bamboo Grove** (swaying stalks, stone lanterns, drifting autumn leaves), and the
**World Combat Arena** (lit ring, camera flashes; winners get a 優勝 flourish). Decor is drawn
procedurally — no image assets.

## Belt ranks

Belts are a shared rank table (`KYU_RANKS`/`DAN_RANKS` in `game-logic.js`), not per-character colors:
12th Kyu (White) up through 1st Kyu (Brown, black stripe), then Dan grades (Black). Some kyu grades
carry a stripe or tip accent (e.g. 6th Kyu = Purple with a brown tip). A gi-wearing fighter's uniform
follows rank automatically: **below Blue Belt** (White/Yellow/Orange/Green) wears **white pants with
a black top**; **Blue Belt and above** (including all Dan grades) is **fully black**. Any Dan-ranked
fighter (gi or spandex/rashguard) also wears a thin gold necklace with a small round pendant.

## Adding a character

Every built-in fighter is one object in the `CHARACTERS` array in `game-logic.js`. Copy
an existing entry, change the fields (name, `beltRank` — an ID from the belt table above, or `null`
for no belt — outfit, build, hair/beard, stats, special), and it shows up in character select
automatically, belt and gi colors included — the grid pages to fit any number. A brand-new kind of
special needs a matching `case` in `doSpecial()`; reusing an existing special type needs no code
changes.

## Create Fighter (in-game)

Main menu → **Create Fighter** lets a player build one without touching code: name, belt rank,
gi/rashguard + colors, hairstyle, beard, build, stats, and a special move (picked from the same
reusable special types above, with a custom name). Hairstyles: short, braid, bald, punk, buns
("Leia"), or a padded headguard. Beard styles: none, full, mustache, goatee, or a long grey "old
master" look. **🎲 Randomize** fills the whole form for a quick-generated fighter. Saved fighters
appear in every fighter-select screen alongside the built-ins (with a small badge), and can be
edited or deleted from the **Create Fighter** screen's "My Fighters" list.

Custom fighters are saved via `CharacterStore` (`game-logic.js`), backed by `localStorage` —
**per-browser only, not shared between players**, and that stays true by design: you can keep as
many local/private fighters as you like. The store's `list()/save()/remove()` all return Promises
even though `localStorage` itself is synchronous, specifically so it was a drop-in swap for a
`fetch()`-based cloud API later — which is exactly what happened, as an *addition* rather than a
replacement: see **Shared roster & highscores** below for `SharedStore`, the optional layer that
lets you publish exactly one of these local fighters for other players to see and fight.

## Fullscreen / exit to menu

Two small buttons sit fixed in the top-right corner. **⛶** is available on every screen — click to
enter fullscreen (hides the browser chrome/URL bar) via the standard Fullscreen API; click again
(⤫) to exit. Not shown on browsers that don't support element fullscreen (notably iPhone Safari —
iPadOS, desktop, and Android browsers are fine). **⌂** appears only during a match — click it to
abandon the fight and return to the main menu immediately, no confirmation (same as the result
screen's "Main Menu" button). The HP bars are inset from the screen edges (`HUD_MARGIN` in
`index.html`) specifically so these buttons never sit on top of them, at any window size.

## Graphics style — Classic / HD Pixel toggle

Main menu, next to MUSIC/SFX: **GFX: CLASSIC / GFX: PIXEL** switches the whole game's rendering
between the original smooth vector look and a **HD retro pixel-art** style — both
procedurally generated at runtime, no sprite assets, no new dependencies. The switch is instant
(theoretically works mid-fight) and persists across reloads.

Classic is the original renderer. Pixel mode draws each fighter into a small offscreen
canvas at reduced native resolution (outlined, 2-tone shaded, blocky limbs/circles) and composites
it back scaled up with nearest-neighbor upscaling — that low-res-buffer step is what actually
produces hard pixel-stepped edges; grid-snapping coordinates alone doesn't, since Canvas2D always
antialiases vector fills/strokes/clips regardless of coordinate rounding. The 4 stage backgrounds
get a parallel pixel-art treatment too (banded gradients instead of smooth ones, blocky outlined
props), so the fighters and the world read as one consistent style. See `PIXEL_BUF_SCALE`/`PX` in
`index.html` to tune chunkiness.

Main menu → **GFX** cycles a third time into **3D**: the same fighters and stages,
rendered as lit, rounded WebGL geometry — still procedurally generated at runtime, no
model files, no textures, no external libraries. The camera is fixed and frontal, matching
the exact framing Classic/Pixel already use, so HUD placement and hit timing never
change — only how everything looks. If a device's browser doesn't support WebGL, this
option is silently left out of the cycle, and the game behaves as if this option weren't available.

During a 3D fight, a third button appears next to ⛶/⌂ (⚡ Performance / ✨ Eye Candy) to
trade rendering quality for smoothness on phones and slower machines — lower-resolution
rendering and simpler meshes vs. full detail. It only appears in 3D mode, since Classic
and Pixel already draw at the same fixed cost regardless of device. Your choice persists
across reloads, same as the GFX mode itself.

## Language — EN / DE / ES / IT / FR / HU

A flag button sits in the top-right of the main menu. Click it to expand a list of the other 5
flags; picking one switches every UI string (menus, HUD, Controls, Create Fighter, the on-screen
touchpad, etc.) and persists across reloads. The default is auto-detected from the browser's
language (`navigator.languages`, matched against the 6 supported codes, falling back to English).
Fighter names and special-move names are **not** translated — they're often Japanese loanwords by
design and stay as authored in `CHARACTERS` regardless of UI language.

Translations live in `I18N` in `game-logic.js` (a key-major dictionary — one row per string, all
6 languages inline — so a missing translation is easy to spot while editing a row) alongside the
lookup function `t(lang, key)` and `detectDefaultLang(languages)`. A unit test asserts every key
has a non-empty value for every supported language, so an incomplete row fails `npm test` rather
than shipping silently. Button labels auto-shrink their font to fit (`drawBtn`), and longer fixed
lines use the `fitText()` helper for the same reason — a translation can be much longer than its
English source, and neither should ever overflow or collide with a neighboring label.

## CPU opponent (1-Player mode)

1-Player now always shows a second **"Choose CPU Opponent"** select screen after you pick your own
fighter — pick anyone in the roster (built-in or custom), or hit **🎲 Random CPU** for the
random-pick behavior.

## Shared roster & highscores (optional)

Kempoka works exactly as described above with zero setup — everything is local/offline by
default. Filling in `config.js` turns on two extra features, backed by a free
[Supabase](https://supabase.com) project:

- **Publish a fighter** — from Create Fighter's "My Fighters" list, publish exactly one of your
  local fighters as your public character. Other players see it as a selectable CPU opponent
  (badged the same as any custom fighter); publishing again overwrites your previous one.
- **Tournament + retro highscore list** — main menu → **TOURNAMENT**: beat every other character
  in the roster in sequence, one 120-second round each, with your own published-or-not fighter as
  the final boss. Score = `(fighters beaten × 100) + (seconds left in each match you won)`. Submit
  your run's score under a name, and it appears on the shared, persistent **HIGH SCORES** list.

No login: each browser gets one anonymous identity (a Supabase-managed session, invisible to you)
that owns its own published fighter and can submit scores. Writes are gated by an (almost always
invisible) [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) challenge so the
public write endpoints resist scripted spam.

### Setup

1. **Create a Supabase project** (free tier is enough) at [supabase.com](https://supabase.com).
2. **Run the schema**: Project → SQL Editor → paste in [`supabase-schema.sql`](supabase-schema.sql)
   → Run. This creates the `characters`/`scores` tables with read-only row-level security — direct
   writes are denied by design; see the file's comments for why.
3. **Enable Anonymous sign-ins**: Project Settings → Authentication → Providers → toggle on
   "Anonymous Sign-Ins".
4. **Create a Cloudflare Turnstile widget**: [Cloudflare dashboard](https://dash.cloudflare.com) →
   Turnstile → Add site (any widget mode). Note its **Site Key** and **Secret Key**.
5. **Deploy the write gateway** (a Supabase Edge Function — the only path that's allowed to write;
   see [`supabase/functions/kempoka-write/index.ts`](supabase/functions/kempoka-write/index.ts) for
   what it does and why):
   ```
   supabase functions deploy kempoka-write --project-ref <your-project-ref>
   supabase secrets set TURNSTILE_SECRET_KEY=<Turnstile secret> --project-ref <your-project-ref>
   ```
   That's the only secret to set by hand — `SUPABASE_URL` and the project's publishable/secret
   keys are auto-injected for every Edge Function. (Supabase is retiring the legacy `anon`/
   `service_role` keys in favor of **Publishable**/**Secret** keys; the function picks up
   whichever your project has configured.)
6. **Fill in [`config.js`](config.js)** with your project's URL, its **Publishable** key (Project
   Settings → API Keys), and the Turnstile **Site** Key (all three are meant to be public — see
   the comments in that file for why). Reload the game; the Publish button and Tournament/High
   Scores features light up automatically.

Leave `config.js` blank (its default) to keep playing fully offline/local.

## Credits

Branding: [The Chosen Ones — Zen Bu Kan Kempo](https://tcokempo.hu/).
Music and sound effects are generated at runtime
with the Web Audio API (original chiptune, no copyrighted material).

Code: Peter Kaszt - 2026 (With the help of Claude.)
