# game-logic.js — technical reference

`game-logic.js` (~480 lines) is Kempoka's data/logic core: belt ranks, the character
roster and its validation, the move tables, combat math, and the i18n dictionary. It has
**zero DOM/canvas/`window` dependencies** — everything in it is plain data and pure
functions. This doc covers that module only. It does not cover:

- How fighters/stages are drawn on canvas — see `docs/2D_rendering.md`.
- WebGL rendering — see `docs/3D_rendering.md`.
- Screens, menus, input handling, the Create-Fighter UI flow — see `docs/UI.md`.
- The Supabase backend and `SharedStore`'s networking — see `docs/backend.md`.

## Module shape: dual-loaded, DOM-free

The whole file is one IIFE:

```js
(function(root){
  ...
  if(typeof module!=='undefined' && module.exports){ module.exports = exportsObj; }
  else { Object.assign(root, exportsObj); }
})(typeof window!=='undefined' ? window : globalThis);
```

`index.html` loads it as a classic `<script src="game-logic.js"></script>` (before any
code that uses it), which assigns every exported name as a global on `window`. Node's
`game-logic.test.js` instead does `require('./game-logic.js')`, which hits the
`module.exports` branch and gets the same `exportsObj` back as a plain object.

This is what makes `npm test` (`node --test`) work with **no jsdom, no browser, no
bundler** — the module never touches `document`, `window` (except as the global-assign
target), `canvas`, or any rendering API. Anywhere it needs a browser-only API
(`localStorage`), it falls back to an in-memory stand-in rather than requiring one — see
`kvStore()` below. That's the whole trick: pure functions and data in, a small adapter
layer for the one browser API it touches, dual export at the bottom.

## Belt system

Single source of truth for every belt/gi visual, referenced by id everywhere else
(`Character.beltRank`).

```js
const KYU_RANKS = [ { id:'kyu12', kyu:12, label:'White Belt', color:'#f2ede0' }, ... ];
const DAN_RANKS = [ { id:'dan1', dan:1, label:"1st Dan (Black Belt)", color:'#141414', tip:GOLD }, ... ];
const BELT_TABLE = {};   // id -> rank row, built from KYU_RANKS + DAN_RANKS
function getBelt(rankId)  // BELT_TABLE[rankId], or null for a falsy rankId
function beltLabel(id)    // getBelt(id).label, or 'No Belt'
const BELT_CHOICES = [null, ...KYU_RANKS ids..., ...DAN_RANKS ids...];
```

- 12 kyu grades (12th/White down to 1st/Brown-black-stripe), then 5 dan grades
  (1st–5th Dan, all black belts, gold tip via the shared `GOLD` constant).
- A rank row's fields are `{ id, kyu|dan, label, color, stripe?, tip? }` — `color` is the
  belt's base color; `stripe` and `tip` are optional accent colors for compound ranks
  (e.g. `kyu6` = purple belt with a brown tip, `kyu4` = brown belt with a white stripe
  *and* a black tip). Not every rank has `stripe`/`tip`.
- `BELT_CHOICES` includes `null` (meaning "no belt") as its first entry — that's the
  valid "no belt" value used by `normalizeCharacter` and the Create screen's belt picker.

Gi color convention, driven by rank:

```js
function giAboveBlue(rankId){ const b=getBelt(rankId); return !b || b.dan!=null || b.kyu<=8; }
const GI_BLACK='#161616', GI_WHITE='#e9e3d2';
```

Rule: below Blue Belt (kyu 9–12) wears white pants + black top; Blue Belt and up
(kyu 1–8, and *all* dan ranks) wears fully black. A character with **no** belt
(`rankId` falsy, e.g. a spandex-outfit fighter) also resolves to `true` (the
above-blue/black look) — that's a deliberate default, not an oversight (see the
`normalizeCharacter` test asserting `giAboveBlue(null) === true`).

Adding a new rank means adding one row to `KYU_RANKS`/`DAN_RANKS` — nothing else needs
to change; `BELT_TABLE`/`BELT_CHOICES` are derived, not hand-maintained.

## Character data model

### `CHARACTERS` — the built-in roster

An array of plain objects, one per built-in fighter (5 today: Sensei Rob, Zsolti, Endre,
Imi, Dori). Shape per entry:

```js
{
  id, name, beltRank,            // beltRank is a BELT_TABLE id or null
  outfit,                        // 'gi' | 'spandex'
  gi,                            // optional hex color override, only used when outfit is not the belt-driven gi color
  build:{ scale, girth },        // scale = overall height/size, girth = width multiplier
  skin,                          // hex color
  hair:{ color, style },         // style is one of HAIR_ORDER
  beard,                         // false, or one of BEARD_ORDER
  glasses,                       // optional, one of GLASSES_ORDER (defaults to 'none' if absent)
  stats:{ maxHp, speed, power, defense },
  special:{ name, type },        // type is one of SPECIAL_TYPE_IDS
}
```

Adding a new roster character is "add one object here" — no other code changes required
*unless* the character introduces a genuinely new special-move behavior, which needs a
matching case in `doSpecial()` (that logic lives outside this file, in the UI/combat
loop — see `docs/UI.md` / rendering docs for where `doSpecial` is implemented). Reusing
an existing `special.type` needs zero code.

### Custom-character enums

Shared by the Create-fighter screen (`index.html`) and `normalizeCharacter`'s validation
below — a single source of truth was introduced specifically to kill duplicate copies
that used to live in both `index.html` and `game-logic.test.js`:

```js
const HAIR_ORDER = ['short','braid','bald','punk','leia','headguard'];
const BEARD_ORDER = ['none','full','moustache','goatee','long'];
const GLASSES_ORDER = ['none','sensei','dark','potter','monocle'];
const TINT_ORDER = ['black','brown','pink'];
const SPECIAL_TYPE_IDS = ['combo','throw','lunge','spin','cleaver'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
```

### `normalizeCharacter(raw)` — the trust boundary

```js
function normalizeCharacter(raw){ ... }  // returns a sanitized character object, or null
```

This is the one function every character record passes through **before** it can reach
the roster, combat math, or rendering — whether it came from `localStorage`
(`CharacterStore`) or (per `docs/backend.md`) a shared/cloud roster. Nothing downstream
is expected to re-validate a character; `normalizeCharacter` is where untrusted data
becomes safe data.

What it does, top to bottom:

- **Rejects the unsalvageable**: returns `null` if `raw` isn't an object, or if
  `raw.id` isn't a non-empty string. Everything else gets a default rather than being
  rejected.
- **Strings** (`name`, `special.name`): trimmed, and truncated to a max length —
  `name` to 16 chars, `special.name` to 22 chars — matching the `maxlength` on the
  corresponding Create-form inputs in `index.html`. Falls back to `'Fighter'` /
  `'Special'` if missing or blank.
- **Hex colors** (`gi`, `skin`, `hair.color`): validated against `HEX_COLOR_RE`
  (`#` + 3–8 hex digits); anything that doesn't match — including something like
  `javascript:alert(1)` — falls back to a safe default color instead of being passed
  through to a `style`/canvas fill.
- **Numeric stats and build fields**: clamped to fixed min/max ranges (matching the
  Create-form sliders), with a default for anything non-numeric or non-finite (NaN,
  strings, `undefined`, `null` all fall back rather than propagating):
  - `stats.maxHp`: 80–140 (default 100)
  - `stats.speed`: 0.8–1.35 (default 1.0)
  - `stats.power`: 0.8–1.4 (default 1.0)
  - `stats.defense`: 0.8–1.2 (default 1.0)
  - `build.scale`: 0.8–1.25 (default 1.0)
  - `build.girth`: 0.75–1.5 (default 1.0)
- **Enums**, checked against the arrays above (or `BELT_CHOICES`), each falling back to
  a safe default if the value isn't a recognized member: `beltRank` (must be in
  `BELT_CHOICES`, else `null`), `outfit` (`'spandex'` or else `'gi'`), `hair.style`
  (`HAIR_ORDER`, else `'short'`), `beard` (`true` or a `BEARD_ORDER` value, else
  `false`), `glasses` (`GLASSES_ORDER`, else `'none'`), `glassesTint` (`TINT_ORDER`,
  else `'black'`), `special.type` (`SPECIAL_TYPE_IDS`, else `'combo'`).
- Always stamps `custom: true` on the result, marking it as a non-built-in character
  (built-ins in `CHARACTERS` are never passed through this function).

Why this matters: `computeDamage` divides by `defender.char.stats.defense` with only a
`Math.max(0.1, ...)` floor at the call site (see Combat math below) — a
`normalizeCharacter` that let a bad/negative `defense` through from persisted data would
produce `Infinity`/`NaN` damage and leave a fight unable to end. Clamping happens once,
here, rather than being re-checked in combat code.

## `CharacterStore` — localStorage-backed custom-fighter store

```js
CharacterStore.list()          // -> Promise<Character[]>  (already normalized)
CharacterStore.save(char)      // -> Promise<Character>    (upsert by id)
CharacterStore.remove(id)      // -> Promise<void>
```

Backed by `kvStore()`, which returns the real `localStorage` in a browser, or an
in-memory object with the same `getItem`/`setItem`/`removeItem` shape when
`localStorage` isn't usable (Node's `node --test` environment) — this is what lets
`CharacterStore` round-trip in the test suite with no browser at all.

Every record is run through `normalizeCharacter` on the way *out* of storage
(`readAll()` maps + filters `Boolean`), so a malformed or hand-edited localStorage entry
is silently dropped rather than crashing the game.

All three methods return Promises even though `localStorage` itself is fully
synchronous. That's a deliberate future-proofing, not accidental over-engineering: it
means no caller anywhere assumes synchronous storage, so a real async backend can be
swapped in as a drop-in replacement with no call-site changes. `SharedStore` (documented
in full in `docs/backend.md`) is exactly that payoff — a pluggable cloud layer sitting
behind the same shape. Briefly: `SharedStore` exposes `list`/`save`/`remove`-style
Promise-returning methods (`listCharacters`, `publishCharacter`, `unpublishCharacter`,
`submitScore`, `topScores`) plus an `isConfigured()` gate that lets calling code check
whether a shared backend exists at all before offering shared-roster/publish/tournament
UI — see `docs/backend.md` for its Supabase/Edge-Function internals.

## Combat math

Pure functions, no DOM/globals beyond the constants defined in this file.

```js
function computeDamage(base, attacker, defender, blocking)
```
`damage = base * attacker.char.stats.power / max(0.1, defender.char.stats.defense)`,
then `× 0.2` if `blocking`. The `max(0.1, ...)` floor exists specifically to guard
against a persisted/shared character with `defense <= 0`, which would otherwise produce
`Infinity`/`NaN` and permanently stall HP/round-end logic.

```js
function fh(f)          // fighter height in px: 132 * f.char.build.scale
function bodyRect(f)    // hitbox rect: half-width = 0.16*h*girth, spans up from f.y (feet) to f.y - h
function rectsOverlap(a, b)   // AABB overlap test on two {x0,x1,y0,y1} rects
function inClinchRange(a, b)  // |dx| < CLINCH_RANGE && |dy| < 20
function faceDir(f, o)        // +1 if opponent o is to the right of f, else -1 — you always auto-face the opponent
function moveDir(f, o, inp)   // resolves held input -> 'up'|'down'|'toward'|'back'|'neutral', relative to the opponent
```

`moveDir` precedence: `up`/`down` win outright regardless of left/right; otherwise
`toward`/`back` are computed relative to `faceDir` (so holding the opponent's direction
is always `'toward'`, never an absolute left/right); no held direction is `'neutral'`.

### Move tables — pure data

```js
const MOVES = { punch: {...}, kick: {...} };   // shared "bases" used by specials
const PUNCHES = { neutral, toward, up, down, back };  // normal punch variants
const KICKS   = { neutral, toward, up, down, back };  // normal kick variants
```

Each move entry has: `dur` (total animation duration, seconds), `active: [start,end]`
(the fraction of `dur` during which the hitbox is live), `reach` (px), `top`/`bot`
(hitbox vertical band, as a fraction of fighter height — negative because it's measured
up from the feet, so head strikes have more negative `top`/`bot` than low strikes),
`dmg`, `knock` (knockback), `pose` (animation/pose id — consumed by the rendering docs,
not this one), and optionally `launch` (upward velocity imparted, e.g. `PUNCHES.up` the
uppercut) and `name` (display name for `PUNCHES`/`KICKS` entries; `MOVES` entries don't
have one since they're bases, not selectable moves).

`PUNCHES`/`KICKS` are keyed by the *held direction relative to the opponent* — `neutral`
(Jab / Front kick), `toward` (Cross / Roundhouse), `back` (Head hook / Side kick), `up`
(Uppercut / Head kick), `down` (Body hook / Low kick) — see `moveDir` above for how the
key is chosen from raw input.

`SPECIAL_TYPE_IDS` (`combo`, `throw`, `lunge`, `spin`, `cleaver`) is the enum a
character's `special.type` must be one of; the actual per-type special-move behavior is
implemented outside this file (combat-loop code, not covered here).

### Timing/tuning constants

```js
GRAV=2200, JUMP_V=-820, CLINCH_RANGE=64, CLINCH_WINDOW=1.5, REVERSAL_WINDOW=0.4,
ROUND_TIME=60, WINS_NEEDED=2, TOURNEY_ROUND_TIME=120
```

`ROUND_TIME` (60s) / `WINS_NEEDED` (2, i.e. best-of-3) govern a normal match.
`TOURNEY_ROUND_TIME` is longer (120s) than `ROUND_TIME` by design: tournament mode is
one round per opponent with no best-of-3 decider, so a single round needs to be a fairer
shot at winning than a round that's only ever deciding one of three. `CLINCH_RANGE` /
`CLINCH_WINDOW` / `REVERSAL_WINDOW` govern clinch entry distance and the timing windows
for grab-escape/reversal and choke/counter interactions (the actual clinch/throw state
machine lives in combat-loop code, not this file — these are just the tuning numbers it
reads).

## i18n data

```js
const SUPPORTED_LANGS = ['en','de','es','it','fr','hu'];
const I18N = { onePlayer:{en:'1 PLAYER', de:'1 SPIELER', es:..., it:..., fr:..., hu:...}, ... };
function t(lang, key)             // I18N[key][lang], falling back to .en, falling back to the raw key
function detectDefaultLang(languages)  // first SUPPORTED_LANGS match among a navigator.languages-like array, else 'en'
```

`I18N` is **key-major**: one row per string key, with all 6 languages inline on that
row, rather than the more conventional lang-major nesting (one blob per language). Per
this file's own comments, that layout is deliberate — it makes a missing/incomplete
translation easy to spot while writing or reviewing a single row, versus having to
diff six separate language blobs.

`t(lang, key)` fallback chain: exact `I18N[key][lang]` → `I18N[key].en` → the raw `key`
string itself (so an unrecognized key never throws or renders `undefined`, it just
renders its own key literally — useful as a visible "missing translation" signal).

`detectDefaultLang(languages)` takes an array shaped like `navigator.languages` (or
`[navigator.language]]`) as an explicit parameter rather than reading `navigator`
directly — that's what keeps it a pure, Node-testable function despite being
"browser-flavored" in purpose. It matches the first entry whose lowercased 2-letter
prefix (e.g. `'de-DE'` → `'de'`) is in `SUPPORTED_LANGS`, defaulting to `'en'`.

Fighter names and `special.name` values (from `CHARACTERS`/custom characters) are
**not** looked up through `I18N`/`t()` — they're Japanese loanwords/authored names shown
as-is regardless of UI language, by design.

Consuming this data — drawing translated strings, the language-switcher control — is
`docs/UI.md`'s territory; this doc covers only the key table and lookup/fallback
functions.

## Testing

`game-logic.test.js` unit-tests this module directly, using Node's built-in
`node:test` + `require('./game-logic.js')` — no jsdom, no browser, run via `npm test`
(`node --test`). Test categories, roughly in file order:

- **Combat math**: `computeDamage` (blocking, power/defense scaling, zero/negative
  defense floor), `fh`, `bodyRect`, `rectsOverlap`, `inClinchRange`.
- **Direction/moveset selection**: `faceDir`, `moveDir` (up/down precedence,
  toward/back relative to the opponent, neutral).
- **Move tables**: shape/sanity checks across `PUNCHES`/`KICKS`/`MOVES` (all 5
  directions present, valid dur/reach/dmg, uppercut launches upward, kicks out-reach
  punches).
- **Belt ranks**: `KYU_RANKS`/`DAN_RANKS` counts and known labels/accents,
  `getBelt`/`beltLabel`/`BELT_CHOICES`, `giAboveBlue` across the below/at/above-Blue
  boundary (including the no-belt default).
- **Roster**: `CHARACTERS` invariants (unique ids, valid belt/outfit/stats/special
  per entry).
- **`normalizeCharacter` validation/clamping**: rejection of unsalvageable input,
  defaults for every missing field, numeric clamping, NaN/non-numeric fallback, enum
  rejection and acceptance (every real `HAIR_ORDER`/`BEARD_ORDER`/`SPECIAL_TYPE_IDS`
  value), name/special-name truncation, hex color validation.
- **`CharacterStore`**: save/list/remove round-trip, same-id save updates rather than
  duplicates.
- **`SharedStore`**: with no backend configured, every method degrades to an empty/
  `false` result rather than throwing.
- **i18n**: `t()` per-language lookup and fallback, completeness (every `I18N` key has
  a non-empty string for every `SUPPORTED_LANGS` entry), `detectDefaultLang` matching
  and fallback, and a cross-check that every `BELT_TABLE` id (plus `'none'`) has a
  corresponding translated `belt_*` key.
