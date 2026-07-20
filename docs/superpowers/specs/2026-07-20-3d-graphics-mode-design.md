# GFX: 3D mode — design

## Context

Kempoka currently has two procedurally-generated rendering styles for the fight screen,
switched by the `GFX: CLASSIC / GFX: PIXEL` button on the main menu (`graphicsStyle` in
`index.html`, persisted via `localStorage.kmp_graphics`):

- **Classic** — smooth vector shapes drawn directly to the 2D canvas (`drawFighterClassic`,
  `stageDojo`/`stageRooftop`/`stageBamboo`/`stageArena`).
- **Pixel** — the same fighters/stages redrawn into a low-res offscreen buffer and
  upscaled with nearest-neighbor filtering for a blocky retro look (`drawFighterPixel`,
  `stage*Pixel`).

Both styles share one source of truth: `poseOf(f)` computes a 2D stick-figure skeleton
every frame (`hip, sh, head, headR, fFoot, bFoot, fHand, bHand, fKnee`), and
`drawFighter()` dispatches those joint positions to whichever style is active. This
skeleton, not the rendering code, is what "is" a fighter's pose — the two existing
styles are just different artists drawing the same figure.

This spec adds a third style, **GFX: 3D**, using the same skeleton, that renders fighters
and stages as lit, real 3D geometry via raw WebGL — high enough quality to look good, cheap
enough to stay fluid on phones.

## Goals

- A third `GFX` option, cycling `CLASSIC → PIXEL → 3D → CLASSIC`, same button, same
  persistence mechanism.
- Procedurally generated, like the other two — no model files, no textures, no external
  assets or libraries.
- Real 3D: lit geometry with depth, not a lighting trick on flat 2D shapes.
- Runs fluidly on phones. A quality toggle (below) gives players/devices that can't hit
  that bar a lower-cost fallback without leaving 3D mode entirely.
- Zero changes to gameplay/combat logic (`game-logic.js` is untouched) and zero changes
  to how Classic/Pixel already render.

## Non-goals

- No camera movement or angle — the camera is fixed and frontal, matching today's exact
  framing (see **Camera** below). This is a deliberate scope cut: it keeps HUD alignment,
  hit-timing perception, and touch-control hit-testing byte-for-byte identical to
  Classic/Pixel, so none of that code needs to change or be re-verified.
  Camera movement is a possible future addition, not part of this spec.
- No photorealism. Stage/prop geometry mirrors the current 2D stages' existing prop
  density — flat-shaded, graphic-novel look, not a detailed 3D environment.

## Architecture

### Layered canvas

A second canvas, `cv3d`, is added stacked under the existing `cv`, same `960×540` logical
size and the same `object-fit:contain` CSS so both scale identically under
`canvasContentRect()`'s existing letterbox math (unchanged).

```html
<div id="wrap">
  <canvas id="cv3d"></canvas>
  <canvas id="cv" width="960" height="540"></canvas>
</div>
```

`cv3d` gets a `webgl2` (falling back to `webgl`) context once at load. If context
creation throws or returns null, 3D mode is simply never added to the `GFX` cycle —
Classic/Pixel behave exactly as they do today. No other fallback path is needed.

`cv` remains the only canvas that ever draws UI: menus, HUD, buttons, the touch pad,
language picker, Create Fighter form, etc. — completely unchanged in every mode. The
*only* behavior change on `cv` is: during a fight, when `graphicsStyle==='3d'`, the
background/stage fill that normally opens `bg()`/`stage*()` is skipped so `cv`'s fight
area stays transparent and `cv3d` shows through underneath. HUD elements continue
drawing on top exactly as today.

### Render dispatch

`graphicsStyle` becomes `'classic' | 'pixel' | '3d'`. `drawFighter()` gains a third
branch:

```js
if(graphicsStyle==='pixel') drawFighterPixel(...)
else if(graphicsStyle==='3d') drawFighter3D(...)
else drawFighterClassic(...)
```

`drawFighter3D` doesn't touch `ctx` — it submits instanced draw calls (mesh + model
matrix + flat color) to the WebGL renderer for that frame, using the exact same joint
arguments `drawFighterClassic`/`drawFighterPixel` already receive.

Because `drawPortrait()` (character select grid, Create Fighter preview) already calls
the shared `drawFighter()`, 3D mode appears there automatically too, with no separate
code path — each portrait is just another instanced figure submitted to the same WebGL
renderer at a different screen position/scale, derived from the same 2D transform
(`ctx.translate/scale`) portraits already use today, projected through the fixed
frontal camera.

Similarly, stage rendering gains a third array alongside `STAGES`/`STAGES_PIXEL`:
`STAGES_3D = [stageDojo3D, stageRooftop3D, stageBamboo3D, stageArena3D]`, submitting
floor/backdrop/prop primitives to the WebGL renderer instead of painting `ctx`.

### Fighter skeleton → 3D joints

`poseOf(f)` is unchanged. One small, pure function adds a Z-depth to each joint, derived
from which side of the body it's on and the fighter's existing `facing`:

```js
function depthOf(jointKey, facing){ ... }  // e.g. front-side joints +Z, back-side -Z, torso/head ~0
```

This is the only change to shared pose logic — everything else 3D-specific lives in the
new rendering module.

### Fighter geometry

Two procedural meshes are built once at load (not per frame): a unit sphere and a unit
capsule, both generated in code (no model files). Every limb, head, hand, and foot is one
instanced draw of one of these two meshes, scaled/rotated/translated per joint pair, and
colored with a flat uniform using the same data Classic/Pixel already use
(`c.skin`, gi/pants colors, belt color/stripe/tip, hair color) — no new character data.

Mesh segment count (roundness) is one of the two quality knobs (see **Quality toggle**).

### Camera & lighting

- **Camera:** fixed, frontal, matching today's exact 960×540 framing — a fighter's
  screen X/Y at Z=0 is pixel-identical to Classic/Pixel. Z depth is used only for (a)
  limb roundness via the front/back joint offset above, and (b) stage prop/backdrop
  recession behind the fight line.
- **Lighting:** one directional light + ambient, one shader program for the whole scene.
  Shading is flat/banded (2-3 tone diffuse) to match the game's graphic look and to
  stay cheap — no shadow maps; the existing blob-shadow-under-the-feet trick becomes a
  flat dark quad on the floor plane at the fighter's X/Z.
- No textures anywhere — all color comes from per-draw-call uniforms.

### Stage 3D scenes

Each of the 4 stages gets a 3D counterpart at the same prop density as its existing 2D
version (a floor plane + backdrop plane + a handful of instanced props), reusing existing
sway/animation math (e.g. heavy-bag swing, bamboo sway) so behavior matches, only the
geometry/shading is new:

- **Dojo** — tatami floor plane, brick-banded backdrop plane, 2 heavy-bag capsules.
- **Rooftop** — skyline box props with emissive window quads, chain-link plane
  (alpha-discard in the fragment shader), instanced thin rain quads.
- **Bamboo** — bamboo-stalk cylinders (existing sway math), 2 stone-lantern prop groups,
  falling-leaf quads.
- **Arena** — ring floor plane, rope cylinders, soft spotlight quad, brief full-scene
  light-pulse for camera flashes.

### Quality toggle (3D mode only)

A third fixed top-right button, next to the existing ⛶ (fullscreen) and ⌂ (main menu),
appears **only during a fight, only when `graphicsStyle==='3d'`** — same
margin-aware positioning so it never overlaps the HP bars, and the same
"icon swaps in place" interaction the ⛶/⤫ button already uses: ⚡ (Performance) ↔
✨ (Eye Candy). It's simply absent in Classic/Pixel, since neither has a real
performance/quality axis to trade off.

Persisted as `localStorage.kmp_quality`, **defaulting to `'eyecandy'`**. A `QUALITY`
config selects a few existing-in-spirit numeric constants per preset:

| Knob | Eye Candy | Performance |
|---|---|---|
| Backing-store resolution | `min(devicePixelRatio, 2)×` | `1×` (native canvas size) |
| Mesh segment count (roundness) | full | reduced |
| Decorative particle density (rain/leaves/flashes) | full | reduced |

All three are plain numbers read at draw-call/setup time, so switching mid-fight is
instant — no WebGL context recreation, no new rendering path. Antialiasing is requested
once at context creation and is **not** part of the toggle (changing it would require
destroying and rebuilding the whole context — too fragile for the win it buys).
`// ponytail: AA fixed at context creation, not swappable; revisit only if a real device
shows AA is the actual bottleneck.`

### Fallback & compatibility

- WebGL support is detected once at load. If unavailable, 3D is never added to the GFX
  cycle — the button only ever shows CLASSIC/PIXEL, exactly as today.
- No other special-casing: every other screen/feature (language, touch controls,
  fullscreen, tournament, shared roster) is untouched by this change.

## Performance plan

No textures, no shadow maps, one shader program, two tiny procedural meshes, capped
backing-store resolution, no post-processing — standard practice for smooth 60fps on
mid-range phones. The Performance quality preset gives a second lever for devices that
still struggle. Manual verification on real phone hardware (or devtools device emulation
+ FPS meter) is part of the acceptance check before this is considered done.

## Testing

- `game-logic.js`/`game-logic.test.js` — untouched, no changes needed (pure combat math,
  no rendering).
- Extend the existing in-browser `?test=1` smoke badge to also assert:
  - WebGL context creation succeeds when the browser supports it.
  - The pose→3D depth function returns finite numbers for every pose.
  - The `GFX` cycle includes `3D` only when a WebGL context was actually obtained.
  - The quality toggle button is present only when `graphicsStyle==='3d'` during a fight.

## Open risks

- Exact triangle/draw-call budget per frame isn't pinned to a number in this spec —
  the implementation plan should pick a concrete target (e.g. low thousands of
  triangles/frame) and verify against it on real hardware, since "fluid on phones" is
  the core requirement this whole feature exists to satisfy.
