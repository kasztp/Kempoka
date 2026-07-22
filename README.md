# Kempoka — The Chosen Ones

A Street Fighter–style 2D fighting game themed around **Zen Bu Kan Kempo**. Runs in any
browser on desktop (keyboard) or phone/tablet (touch). No dependencies, no build step —
`index.html` is everything a player needs.

**Working on the code?** See [`docs/`](docs/) for how it's built: [`game_logic.md`](docs/game_logic.md)
(belts, roster, combat math, i18n data), [`2D_rendering.md`](docs/2D_rendering.md) (Classic/Pixel
canvas renderers), [`3D_rendering.md`](docs/3D_rendering.md) (the WebGL `GFX: 3D` mode),
[`UI.md`](docs/UI.md) (screens, menus, input, HUD), and [`backend.md`](docs/backend.md) (the
optional Supabase shared-roster/highscores layer). [`CLAUDE.md`](CLAUDE.md) is a quick-start map
for agents working in this repo.

## Run it

Just open `index.html` in a browser — double-click it, or serve the folder:

```
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Tests

```
npm test   # node --test — zero dependencies, uses Node's built-in test runner
```

`.github/workflows/ci.yml` runs the same command on every push/PR. There's also an in-browser
smoke check: append `?test=1` to the URL for a quick visual PASS/FAIL badge covering the same
combat math plus a live `CharacterStore` round-trip. See [`docs/game_logic.md`](docs/game_logic.md)
for what's covered and why the core logic is unit-testable without a browser at all.

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

Belts are a shared rank table, not per-character colors: 12th Kyu (White) up through 1st Kyu
(Brown, black stripe), then Dan grades (Black). Some kyu grades carry a stripe or tip accent (e.g.
6th Kyu = Purple with a brown tip). A gi-wearing fighter's uniform follows rank automatically:
**below Blue Belt** (White/Yellow/Orange/Green) wears **white pants with a black top**; **Blue
Belt and above** (including all Dan grades) is **fully black**. Any Dan-ranked fighter (gi or
spandex/rashguard) also wears a thin gold necklace with a small round pendant. Full rank table and
data shape: [`docs/game_logic.md`](docs/game_logic.md).

## Adding a character

Every built-in fighter is one object in the `CHARACTERS` array in `game-logic.js`. Copy
an existing entry, change the fields (name, belt rank — an ID from the belt table above, or `null`
for no belt — outfit, build, hair/beard, stats, special), and it shows up in character select
automatically, belt and gi colors included — the grid pages to fit any number. A brand-new kind of
special needs a matching `case` in `doSpecial()`; reusing an existing special type needs no code
changes. Full field-by-field reference: [`docs/game_logic.md`](docs/game_logic.md).

## Create Fighter (in-game)

Main menu → **Create Fighter** lets a player build one without touching code: name, belt rank,
gi/rashguard + colors, hairstyle, beard, build, stats, and a special move (picked from the same
reusable special types above, with a custom name). Hairstyles: short, braid, bald, punk, buns
("Leia"), or a padded headguard. Beard styles: none, full, mustache, goatee, or a long grey "old
master" look. **🎲 Randomize** fills the whole form for a quick-generated fighter. Saved fighters
appear in every fighter-select screen alongside the built-ins (with a small badge), and can be
edited or deleted from the **Create Fighter** screen's "My Fighters" list.

Custom fighters are saved locally (`localStorage`) — **per-browser only, not shared between
players** by default, and that stays true unless you opt in: see **Shared roster & highscores**
below for publishing one to other players. Implementation details (the `draft` object, the
DOM-input overlay for text/color fields, the local `CharacterStore`): [`docs/UI.md`](docs/UI.md)
and [`docs/game_logic.md`](docs/game_logic.md).

## Fullscreen / exit to menu

Two small buttons sit fixed in the top-right corner. **⛶** is available on every screen — click to
enter fullscreen (hides the browser chrome/URL bar) via the standard Fullscreen API; click again
(⤫) to exit. Not shown on browsers that don't support element fullscreen (notably iPhone Safari —
iPadOS, desktop, and Android browsers are fine). **⌂** appears only during a match — click it to
abandon the fight and return to the main menu immediately, no confirmation (same as the result
screen's "Main Menu" button). Implementation (the HUD-margin layout guarantee that keeps these off
the HP bars at any window size): [`docs/UI.md`](docs/UI.md).

## Graphics style — Classic / HD Pixel toggle

Main menu, next to MUSIC/SFX: **GFX** cycles between three rendering styles, all procedurally
generated at runtime — no sprite/model assets, no textures, no new dependencies. The switch is
instant and persists across reloads.

- **Classic** — the original smooth vector look.
- **Pixel** — a chunky HD retro pixel-art style; fighters and the 4 stage backgrounds both get the
  same blocky treatment, so they read as one consistent style.
- **3D** — the same fighters and stages as lit, rounded WebGL geometry, framed with a fixed camera
  matching Classic/Pixel exactly, so HUD placement and hit timing never change — only how
  everything looks. Silently left out of the cycle on devices without WebGL support. A fight-only
  ⚡ Performance / ✨ Eye Candy toggle trades rendering quality for smoothness on slower devices.

How each renderer actually works: [`docs/2D_rendering.md`](docs/2D_rendering.md) (Classic/Pixel)
and [`docs/3D_rendering.md`](docs/3D_rendering.md) (3D).

## Language — EN / DE / ES / IT / FR / HU

A flag button sits in the top-right of the main menu. Click it to expand a list of the other 5
flags; picking one switches every UI string (menus, HUD, Controls, Create Fighter, the on-screen
touchpad, etc.) and persists across reloads. The default is auto-detected from the browser's
language (`navigator.languages`, matched against the 6 supported codes, falling back to English).
Fighter names and special-move names are **not** translated — they're often Japanese loanwords by
design and stay as authored in `CHARACTERS` regardless of UI language.

A unit test asserts every string has a non-empty value for every supported language, so an
incomplete translation fails `npm test` rather than shipping silently. Button labels and longer
fixed lines auto-shrink their font to fit, since a translation can be much longer than its English
source. Data layout: [`docs/game_logic.md`](docs/game_logic.md). UI consumption/auto-shrink:
[`docs/UI.md`](docs/UI.md).

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

Leave `config.js` blank (its default) to keep playing fully offline/local. To stand up your own
backend — Supabase project, schema, anonymous auth, Turnstile widget, the `kempoka-write` Edge
Function, and `config.js` — follow the full deployment walkthrough in
[`docs/backend.md`](docs/backend.md).

## Credits

Branding: [The Chosen Ones — Zen Bu Kan Kempo](https://tcokempo.hu/).
Music and sound effects are generated at runtime
with the Web Audio API (original chiptune, no copyrighted material).

Code: Peter Kaszt - 2026 (With the help of Claude.)
