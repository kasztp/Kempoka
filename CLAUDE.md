# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm test                       # node --test — game-logic.test.js + render3d.test.js, zero deps
python3 -m http.server 8000    # serve the game locally, then open http://localhost:8000
```

There is no build step. `index.html` is opened/served directly; nothing is bundled, transpiled,
or compiled. `.github/workflows/ci.yml` runs `npm test` on every push/PR — it does not exercise
the Supabase backend (no live-integration test exists for that).

To run a single test, use Node's built-in filter: `node --test --test-name-pattern="<name>"`, or
run one file directly: `node --test game-logic.test.js`.

An in-browser smoke check also exists: append `?test=1` to the URL for a visual PASS/FAIL badge
covering core combat math plus a live `CharacterStore` round-trip.

## Architecture

Three top-level files, no framework:

- **`game-logic.js`** — DOM-free game data and pure logic (belts, roster, combat math, i18n
  data, move tables, validation). Loaded by `index.html` via `<script src>` *and* `require()`-able
  directly from Node — that dual-load is what makes it unit-testable without a browser/jsdom.
- **`render3d.js`** — the WebGL `GFX: 3D` renderer. Same dual-load pattern, tested by
  `render3d.test.js` (math/mesh unit tests only — visual correctness is not covered by tests, see
  the gotcha below).
- **`index.html`** — everything DOM/canvas-dependent: the two 2D renderers (Classic, Pixel), the
  screen/state machine, input, HUD, audio, and the game loop.

Five docs under `docs/` go deep on one subsystem each, with explicit scope boundaries and
cross-links to each other — read the relevant one before making a non-trivial change instead of
re-deriving it from source:

- [`docs/game_logic.md`](docs/game_logic.md) — belts, the `CHARACTERS` roster shape,
  `normalizeCharacter`, `CharacterStore`, combat math, i18n data.
- [`docs/2D_rendering.md`](docs/2D_rendering.md) — Classic/Pixel canvas rendering.
- [`docs/3D_rendering.md`](docs/3D_rendering.md) — the WebGL renderer.
- [`docs/UI.md`](docs/UI.md) — screens, menus, buttons, input, HUD.
- [`docs/backend.md`](docs/backend.md) — the optional Supabase shared-roster/highscores layer.

`docs/superpowers/plans/` and `docs/superpowers/specs/` hold the design specs and implementation
plans for past features (the 3D graphics mode, the character-rendering-fixes plan) — committed on
purpose, useful for historical "why was this built this way" context. `.claude/` and
`.superpowers/` (gitignored) are transient per-session working directories, not project docs.

### Cross-cutting conventions worth knowing before touching rendering code

**The shared joint-math contract.** `drawFighter()` in `index.html` computes a fighter's pose
(hip/shoulder/head/hand/foot/knee positions) once per frame, then dispatches the *identical*
`(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee)` signature to whichever renderer is
active (`drawFighterClassic` / `drawFighterPixel` / `draw3DFighter`). This is why all three
renderers stay visually consistent — a pose change belongs in that one function, not duplicated
across renderers. See `docs/2D_rendering.md` and `docs/3D_rendering.md`.

**The 3D depth-occlusion bug class.** This exact bug has recurred three times in `render3d.js`:
new geometry (beard, then glasses, then a belt stripe) drawn at a Z-depth that put it *inside* an
existing sphere/cylinder's volume, so WebGL's depth test hid it behind that primitive's own front
surface — even though the 2D-projected screen position looked correct. The fix pattern is always
the same: a forward Z-offset that clears `radius * ~1.1–1.15` (plus the new geometry's own
thickness, if non-trivial), verified algebraically across the full `build.scale`/`build.girth`
range, not just the default build. Full writeup: `docs/3D_rendering.md`.

**`normalizeCharacter` is the trust boundary.** Any character data arriving from `localStorage`
(saved custom fighters) or the network (the shared roster) is clamped through
`normalizeCharacter()` in `game-logic.js` before use — invalid enum values, malformed hex colors,
and out-of-range stats are all silently corrected to safe defaults there. New character fields
need a matching clamp added to this function, not just to the UI that sets them.

**Testing WebGL visuals.** A fresh `gl.readPixels()` call made outside the actual render loop
returns an empty/cleared buffer in this project's automated-testing environment (a
`preserveDrawingBuffer` quirk) — this has produced false "it's broken" and false "it's fine"
readings in past review passes. Real screenshots of the composited page are the reliable check for
3D visual correctness; `render3d.test.js` only proves the math layer, not what actually renders.

**The backend is fully optional.** Everything works offline/local with `config.js` left blank;
`SharedStore.isConfigured()` gates the cloud layer so the rest of the game never branches on
whether a backend exists. See `docs/backend.md` before touching anything under `supabase/`.
