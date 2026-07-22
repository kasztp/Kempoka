# 3D Rendering (`GFX: 3D` mode)

Technical reference for `render3d.js` (~540 lines), the raw-WebGL renderer behind the
third `GFX` option (`CLASSIC → PIXEL → 3D → CLASSIC`). No libraries, no textures, no
model files — every fighter and stage is procedurally generated from two mesh types.
This doc covers only that module (plus the minimal bootstrap glue in `index.html`).
For the joint/pose data this renderer consumes, see `docs/game_logic.md`. For the
Classic/Pixel canvas renderers this one deliberately mirrors, see `docs/2D_rendering.md`.
For the `GFX` toggle button, screens, and state machine that decide *when* this module
gets called, see `docs/UI.md`.

Design rationale not repeated here in full lives in
`docs/superpowers/specs/2026-07-20-3d-graphics-mode-design.md` (why 3D mode exists,
its architecture) and `docs/superpowers/specs/2026-07-21-character-rendering-fixes-design.md`
(hair/beard/glasses/belt geometry additions, the depth-occlusion fixes).

## Dual-environment file structure

`render3d.js` is loaded two ways: as a classic `<script>` by `index.html` (exposes
globals via `Object.assign(window, exportsObj)`) and via `require()` by
`render3d.test.js` under Node. The file is split accordingly — pure math/mesh-generation
functions at the top have zero DOM/WebGL dependencies (this is what makes them
unit-testable outside a browser); WebGL bootstrap, drawing, and stage code live further
down and are simply never exercised by the Node test suite.

## WebGL bootstrap and canvas layering

### The `cv3d` / `cv` stack

`index.html` renders two stacked canvases at the same logical `960×540` size:

```html
<div id="wrap"><canvas id="cv3d"></canvas><canvas id="cv" width="960" height="540"></canvas></div>
```

```css
#cv3d { position:absolute; top:0; left:0; z-index:0; }
#cv   { position:relative; z-index:1; }
```

`cv3d` (WebGL) sits behind `cv` (the existing 2D canvas that draws Classic/Pixel
fighters, HUD, menus). Stacking is controlled by explicit `z-index`, not DOM order —
an absolutely-positioned element paints after non-positioned siblings by default
regardless of markup order, so the comment in `index.html` calls this out deliberately.
`cv` remains the *only* canvas that ever draws UI (menus, HUD, touch pad, Create
Fighter form) in every mode.

`init3D(cv3d)` runs once at load (`index.html`):

```js
const cv3d = document.getElementById('cv3d');
init3D(cv3d);
```

### The occlusion bug: a generic `canvas{background}` rule hid the entire 3D scene

This project hit a real, easy-to-repeat bug when 3D mode first shipped: the page's
generic stylesheet rule

```css
canvas { background:var(--ink); image-rendering:auto; width:100%; height:100%; object-fit:contain; }
```

applies to *every* `<canvas>` element, including `cv`. With `cv` opaque, `cv3d`
underneath was 100% correctly rendering — but invisible, because `cv`'s own
CSS background painted over it in the composited page. Nothing about the WebGL side
was broken: `gl.readPixels` against `cv3d`'s own framebuffer would report the expected
lit geometry, because that check never looks at what's stacked on top of it in the DOM.
The bug only became visible via an actual composited-page screenshot (or the human eye),
not via any WebGL-internal check.

The fix is a one-line, mode-conditional override applied every time the graphics style
changes:

```js
function applyGraphicsStyle(){
  cv.style.imageRendering = graphicsStyle==='pixel' ? 'pixelated' : 'auto';
  cv.style.background = graphicsStyle==='3d' ? 'transparent' : '';
}
```

**Gotcha for anyone touching canvas layering here:** a generic `canvas{...}` CSS rule
is exactly the kind of change that silently breaks `cv3d` visibility again, and no
`gl.readPixels`-only test will ever catch it — that check only proves the WebGL canvas'
own buffer is correct, not that anything stacked on top of it in the DOM lets it show
through. Verifying canvas-layering changes requires looking at (or screenshotting) the
actual rendered page, not just querying the GL context.

### Capability detection and silent fallback

```js
function init3D(canvas){
  try{ gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); }catch(e){ gl=null; }
  if(!gl) return false;
  // ... compile/link shaders, gl.getShaderParameter/getProgramParameter checks ...
  // any compile/link failure also sets gl=null and returns false
}
function has3DSupport(){ return !!gl; }
```

If context creation throws, returns null, or shader compile/link fails, `gl` stays
`null` and `has3DSupport()` reports `false`. `index.html` uses this to gate the `GFX`
cycle itself:

```js
let graphicsStyle = localStorage.kmp_graphics || 'classic';
if(graphicsStyle==='3d' && !has3DSupport()) graphicsStyle='classic';   // fall back silently
function toggleGraphicsStyle(){
  const order = has3DSupport() ? ['classic','pixel','3d'] : ['classic','pixel'];
  ...
}
```

No error UI, no retry — devices without WebGL simply never see `3D` as an option, and
Classic/Pixel behave exactly as they do without this module. See `docs/UI.md` for the
button/state-machine side of this.

### Fixed frontal camera

The camera never moves or rotates — a fighter's screen X/Y at Z=0 is pixel-identical to
Classic/Pixel's 2D coordinates. This is a deliberate, permanent scope cut (not a
placeholder): it keeps HUD alignment, hit-timing perception, and touch-hit-testing
byte-for-byte identical to the other two modes, so none of that code needs to change or
be re-verified when 3D mode is active. Z depth is used *only* for (a) limb roundness via
front/back joint offsets (`JOINT_DEPTH`, below) and (b) stage prop/backdrop recession.
The projection is a straight ortho remap of world space to clip space:

```js
projectionMatrix = mat4Ortho(0, R3D_W, R3D_H, 0, -80, 500);
```

`R3D_W=960, R3D_H=540, R3D_GROUND=476` — must stay in sync with `W`/`H`/`GROUND` in
`index.html` (own comment in the source flags this).

## Core math utilities

All unit-tested in `render3d.test.js` (pure functions, no `gl` dependency — see
**Testing note** below).

- **`normalize3(x,y,z)`** → unit vector `[x,y,z]` in the same direction (falls back to
  length 1 if the input is the zero vector, avoiding divide-by-zero).
- **`mat4Identity()`** → 4×4 identity as a `Float32Array` (column-major, WebGL
  convention).
- **`mat4Ortho(left,right,bottom,top,zNear,zFar)`** → clip-space projection matrix.
  **Not** the textbook `glOrtho` formula: that assumes an eye-space camera looking down
  `-Z`, which would flip the sign of the Z terms. This renderer treats world Z as the
  depth axis directly (near → clip `-1`, far → clip `+1`). `index.html`/`render3d.js`
  call it with `top=0, bottom=R3D_H` specifically to flip Y to canvas convention (world
  `y=0` is the screen's top) — asserted directly by the test suite's clip-space checks.
- **`hexToRgb01(hex)`** → `"#rrggbb"` string to `[r,g,b]` floats in `0..1`, for feeding
  the flat-color fragment shader uniform.
- **`shade3(rgb, amt)`** → clamps `rgb[i]+amt` to `[0,1]` per channel; used for the
  "shade the back-side twin darker" convention (e.g. back leg/arm slightly darker than
  the front one), matching the same lightening/darkening convention Classic/Pixel use.
- **`boneMatrix(ax,ay,az, bx,by,bz, radius)`** → places a unit cylinder (local Y axis
  0→1) so it runs from point A to point B with the given radius. Builds an orthonormal
  frame (direction + two perpendiculars) via cross products, choosing a reference axis
  that avoids being parallel to the bone direction (`if(Math.abs(dz)>0.9) use X axis
  instead of Z`). Because the cylinder's side normals always have zero Y-component and
  are scaled equally on the two radius axes, transforming a normal by this same matrix
  (translation dropped, `w=0`) and renormalizing is *mathematically exact* — no
  inverse-transpose normal matrix needed. Verified directly in
  `render3d.test.js` ("transforms a side normal exactly").
- **`pointMatrix(x,y,z,radius)`** → places a unit sphere at `(x,y,z)` scaled uniformly by
  `radius`. Same exact-normal-transform property as `boneMatrix`, for the same reason
  (uniform scale never distorts normal direction).
- **`boxScaleMatrix(x,y,z, sx,sy,sz)`** → places/scales any unit mesh by independent
  X/Y/Z factors. Used for floor/wall quads (axis-aligned normals, so still exact) and
  — more delicately — for flattened-sphere glasses lenses, where the *non-uniform*
  scale means the exact-normal property does **not** hold on the flattened face (see
  `draw3DGlasses` below).

## Mesh primitives

Built once per quality-segment-count change (`buildMeshes(segments)`), not per frame —
uploaded to GPU buffers and reused every draw call via `draw3D(meshName, model, r,g,b)`.

- **`buildSphere(segments)`** — unit sphere, radius 1, centered on the origin.
  `segments` sets both rings and sectors (`sectors = segments*2` for round proportions).
  Vertex/index counts are exactly `(segments+1)*(segments*2+1)*3` floats and
  `segments*(segments*2)*6` indices — pinned by `render3d.test.js`.
- **`buildCylinder(segments)`** — side wall *only*, no end caps: every bone's ends are
  always covered by a sphere joint, so caps would never be visible. Radius 1 in X/Z,
  from `y=0` to `y=1`.
- **`buildQuadFloor()`** — flat quad in the X-Z plane, normal `+Y`, `[-0.5,0.5]` in both
  X and Z at `y=0`. Used for stage ground planes.
- **`buildQuadWall()`** — flat quad standing in the X-Y plane, normal `+Z` (faces the
  camera directly since the camera always looks straight down Z — no billboard math
  needed), `x:[-0.5,0.5] y:[0,1]` at `z=0`. Used for stage backdrops/skylines.

### The two primitives everything is built from

```js
function bone(a,b,radius,color){ draw3D('cylinder', boneMatrix(...), ...); }
function ball(p,radius,color){ draw3D('sphere', pointMatrix(...), ...); }
```

`bone(a,b,radius,color)` is a capped cylinder between two 3D points (the "cap" comes
from a `ball()` drawn at each joint, not from the cylinder mesh itself, which has no end
caps — see above). `ball(p,radius,color)` is a sphere at a point.

**The entire fighter and accessory system — limbs, torso, hands, feet, every hairstyle,
every beard, every glasses type, the belt, the Dan-rank necklace — is built from only
these two primitives.** No new mesh type has been added across multiple feature
generations (hair variety, beards, glasses, belt/necklace). This is a deliberate,
maintained constraint, not an oversight:

- **Simplicity** — one mesh generator each for sphere/cylinder, reused everywhere,
  versus a growing library of bespoke geometry per accessory.
- **Consistent lighting** — both meshes have the exact-normal-transform property (see
  `boneMatrix`/`pointMatrix` above), so every new accessory lights correctly for free,
  with no per-mesh normal-matrix math to get right.
- **No asset pipeline** — no model files, no importer, no build step; a new accessory
  is just new calls to `bone()`/`ball()` with computed points/radii.

When adding a new accessory or feature to this renderer, the expected approach is more
`bone()`/`ball()` calls with new geometry math, not a new mesh generator.

## `draw3DFighter`: the main per-frame fighter draw

```js
function draw3DFighter(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee)
```

Called from `index.html`'s `drawFighter()` dispatch, with **the same 2D joint
arguments** (`hip, sh, head, headR, fFoot, bFoot, fHand, bHand, fKnee`) that
`drawFighterClassic`/`drawFighterPixel` already receive from `poseOf(f)` — no separate
pose computation exists for 3D. See `docs/game_logic.md` for what `poseOf`/these joints
mean; see `docs/2D_rendering.md` for how Classic/Pixel consume the same data.

### Replicating the 2D transform stack, and adding depth

This renderer has no canvas transform stack, so it replicates `drawFighter()`'s
`ctx.translate/scale/rotate` manually per joint via a small closure `J`:

```js
const J = (p,dz)=>{
  const y1=p[1]+offY, cx=p[0]*cosR - y1*sinR, cy=p[0]*sinR + y1*cosR;
  return [f.x+cx*fac, f.y+cy, dz];
};
```

`fac=f.facing` mirrors X only (never Z) — Z depth is camera-relative, independent of
which way the fighter faces. The KO pose's `ctx.rotate` is a rotation around the
screen-perpendicular axis, which is exactly the camera's view axis here, so applying it
to X/Y and leaving Z untouched is the exact 3D equivalent of the 2D rotation, not an
approximation.

`JOINT_DEPTH` supplies each joint's fixed Z-offset:

```js
const JOINT_DEPTH = { hip:0, sh:0, head:0, fFoot:-14, bFoot:14, fHand:-14, bHand:14, fKnee:-10 };
```

Front-side limbs (toward the opponent) bulge slightly toward the camera (negative Z);
back-side limbs recede (positive Z). This is the entire mechanism that makes the figure
read as round 3D rather than a flat cutout — it's a fixed per-joint offset, not derived
from facing (facing only flips X via `fac`).

### Build order

1. Legs — front leg bends at the knee for kicks (mirrors `drawFighterClassic`'s knee
   logic exactly): `bone(hipW,fKneeW,legR,...); bone(fKneeW,fFootW,legR*0.9,...)` when
   `fKneeW` exists, else one straight `bone(hipW,fFootW,legR,...)`. Back leg is always
   straight and `shade3`'d darker.
2. Back arm, then torso, then front arm — same draw order as Classic (back arm first so
   the torso partially occludes its shoulder end).
3. `draw3DBelt(...)` — belt band + optional stripe/tip + Dan-rank necklace.
4. Hands and feet as `ball()`s (feet at `legR`, hands at `armR*1.3`).
5. Head `ball()`, then `draw3DHair`, `draw3DBeard`, `draw3DGlasses` in that order.

Colors come from the same character data Classic/Pixel use (`c.skin`, `c.gi`/gi-outfit
colors via `giAboveBlue`/`GI_BLACK`/`GI_WHITE` from `game-logic.js`, `c.hair.color`,
belt color/stripe/tip via `getBelt(c.beltRank)`) — no 3D-specific character fields.
See `docs/game_logic.md` for what these fields mean.

### Accessory functions

All four switch on a style/type enum defined in `game-logic.js` (see
`docs/game_logic.md` for the authoritative enum lists: `HAIR_ORDER`, `BEARD_ORDER`,
`GLASSES_ORDER`, `TINT_ORDER`) and are built entirely from `bone()`/`ball()`.

**`draw3DHair(style, headW, headR, hairColor)`** — one of `short/braid/bald/punk/leia/headguard`:
- `bald` — no geometry.
- `punk` (mohawk) — a fan of 5 thin angled spikes from one anchor at the top of the
  skull (`by=hy-headR*0.82`), each a `bone()` (anchor→tip) plus a small `ball()` at the
  tip for a rounded point. The fan is along **X** (the character's facing/profile axis):
  anatomically the ridge of a mohawk on a sideways-facing figure runs front-to-back of
  the skull, which is X in this coordinate system; Z is the ear-to-ear axis, which the
  fixed frontal camera can't usefully show anyway. Matches the Classic/Pixel mohawk
  fix's angle math exactly (`ang=i*0.36`, center spike tallest at `headR*0.75`).
- `braid` (ponytail) — a cap `ball()` (`capR=headR*0.92`), then two tapering `bone()`
  segments drooping from a point **on the cap's own surface**, not the bare head
  sphere, ending in a small tip `ball()`. Mirrors the Classic/Pixel "start from the hair
  mass, not the skin" fix.
- `leia` (buns) — two `ball()`s at ear height (`hx∓headR*0.9`, radius `headR*0.6`) plus
  a top-cap `ball()`.
- `headguard` — an oversized cap `ball()` (`headR*1.1`) plus two small ear-pad
  `ball()`s.
- `short` (the only remaining non-bald style) — one plain rounded cap `ball()`
  (`headR*0.92`).

**`draw3DBeard(bStyle, headW, headR, hairColor, torsoR)`** — one of
`none/full/moustache/goatee/long`. Takes `torsoR` specifically for its depth-clearance
math — see the dedicated **depth-occlusion** section below, since this function is the
first of the three that had to solve it. `long` uses a fixed grey (`#c9c9c9`) instead of
`hairColor`, matching Classic/Pixel's "old master" convention; the others use
`hairColor`.

**`draw3DGlasses(gType, gTint, headW, headR, skinColor)`** — one of
`none/sensei/dark/potter/monocle`. Every lens (or the monocle's bruise) is the existing
sphere mesh **flattened thin along Z via `boxScaleMatrix`'s independent x/y/z scale** —
e.g. `boxScaleMatrix(cx,ey,front, headR*0.32,headR*0.24,headR*0.1)` — producing a
disc-like shape facing the camera, no new mesh generator. `potter` (round/"Harry
Potter"-style, labeled "Round Glasses" in UI/i18n to avoid a trademarked name) layers a
smaller skin-toned flattened sphere in front of a larger black-rimmed one so the rim
reads as a thin frame with skin visible through the middle — no true transparency
needed. `sensei`/`dark` are two tinted lenses joined by a thin `bone()` bridge (`dark`'s
tint keyed off `gTint`: black/brown/pink). `monocle` is a single flattened sphere over
one eye, at a fixed side regardless of facing (matching the ponytail's fixed-side
convention). Accepted tradeoff, documented in the source: the exact-normal-transform
invariant that holds for every other mesh in this renderer does **not** hold for a
non-uniformly-flattened sphere's front-facing normal (only its equator/rim stays
exact) — a small, cosmetically-irrelevant lighting inaccuracy on an accessory this
size, not worth a dedicated inverse-transpose matrix path.

**`draw3DBelt(belt, hipW, shW, torsoR, g)`** — `belt` is `getBelt(c.beltRank)` (falsy
for no rank; see `docs/game_logic.md`). Radii follow the "half of the matching 2D
`lineWidth`" convention already used for `legR`/`armR`/`torsoR` (2D belt/tip
`lineWidth 8*g` → 3D radius `4*g`).
- Band: one horizontal `bone()` across the hips at radius `beltR=4*g`, in `belt.color`.
- Stripe (`belt.stripe`, optional): a second, thinner `bone()` (`stripeR=1.25`) at a
  different Y and Z.
- Tip (`belt.tip`, optional): a short `bone()` segment near one end, same radius as the
  band (`tipR=4*g`) — it shares the band's exact center/shape, so it only needs a small
  fixed nudge, unlike the stripe (see below).
- Dan-rank necklace (`belt.dan`, optional): two thin chain `bone()`s meeting at a
  `ball()` pendant, positioned relative to the shoulder joint (`shW`), not the belt.

## The depth-occlusion bug class

**This is the single most important pattern to understand before touching this
renderer.** The same bug has been hit and fixed **three separate times** in this
file's history: beard geometry hidden inside the head sphere, glasses geometry hidden
inside the head sphere, and belt-stripe geometry hidden inside the belt band itself.
Each time, the cause was identical: new geometry was drawn at a Z-depth that put it
*inside* the solid volume of an existing primitive (a sphere or cylinder), and WebGL's
depth test then hid it behind that primitive's own front surface — even though the
new geometry's 2D-projected screen X/Y position looked completely correct.

### Why it happens

A sphere or cylinder centered at some Z and drawn with radius `R` has its own front
surface (nearest the camera) at `Z - R` (this renderer's camera looks down `+Z`, so
"toward the camera" is `-Z`). Anything else drawn at plain `Z` (the primitive's center
depth) is `R` units *behind* that front surface and is invisible under depth testing,
regardless of where it sits in X/Y.

### The general rule

When attaching new geometry to an existing sphere/cylinder, its forward Z-offset must
clear that primitive's own radius, **with a safety margin** — the convention
established in this codebase is roughly `radius * 1.1` to `radius * 1.15`, arrived at
empirically/algebraically (confirmed via manual 3D-mode testing after a bare `0.55`
factor was tried first and sat entirely *inside* the sphere, rendering no visible
glasses at all). If the attached geometry has meaningful thickness of its own (not just
a point), **that thickness must be added to the clearance too** — clearing the parent's
surface isn't enough if the child then still buries its own back half inside the
parent.

### Worked example: the belt stripe

```js
const beltR=4*g, tipR=4*g, stripeR=1.25;
const bz = hipW[2] - (torsoR+beltR)*1.15;
...
if(belt.stripe){ const strZ=bz-(beltR+stripeR)*1.15; bone([bx0,by-3.5,strZ],[bx1,by-3.5,strZ], stripeR, ...); }
```

This is the most instructive case because it stacks two clearance problems:

1. The belt band itself must clear the **torso** cylinder (radius `torsoR`) plus its
   own half-thickness (`beltR`): `bz = hipW[2] - (torsoR+beltR)*1.15`.
2. The stripe sits at a *different* Y-center and radius than the band, so — unlike the
   belt **tip**, which shares the band's exact shape/center and is therefore always
   uniformly closer to the camera than the band's own surface — a bare constant offset
   from `bz` is not provably safe for the stripe. The fix scales the offset by
   `(beltR+stripeR)` (both radii, not just one) so the *stripe's whole disk* clears the
   band's frontmost point outright: `strZ = bz - (beltR+stripeR)*1.15`.

The lesson explicitly called out in this codebase: **a bare-constant nudge worked at
the default Create Fighter build, but silently broke (stripe hidden inside the band)
at high girth**, because `beltR` scales with `g` (girth) while a hardcoded constant
does not. Test clearance math at the *extremes* of the build sliders, not just
defaults — see the next section for why the sliders make this especially easy to get
wrong.

## Build-slider interaction: `build.scale` vs `build.girth`

Create Fighter exposes two independent sliders, and this renderer's radii split cleanly
along that independence:

- **`headR`** derives from `build.scale` only (via overall height `h = 132*build.scale`,
  then `headR = 0.11*h` in `poseOf`/`drawFighter` — computed once in `index.html`,
  passed in as an argument, not recomputed in `render3d.js`).
- **`torsoR`, `armR`, `legR`, `beltR`** derive from `build.girth` (`g`) only:
  `legR=4*g, armR=3.5*g, torsoR=11*g` (in `draw3DFighter`), `beltR=4*g` (in
  `draw3DBelt`).

Because `scale` and `girth` are independent sliders, a **short, stocky** build (low
`scale`, high `girth`) can produce `torsoR > headR` — the torso literally wider than
the head. This is exactly why the depth-clearance fixes above had to be general
formulas rather than one-off constants: an early beard-clearance fix assumed `headR`
alone was always the relevant radius to clear, and broke on short+stocky builds where
`torsoR` was actually larger. The current `draw3DBeard` clears
`Math.max(headR, torsoR)*1.3` specifically to stay correct across the full slider
range, not just the default build — the source comment calls this out directly:

```js
// Clearing by the LARGER of the two radii (not assuming headR>torsoR — Create
// Fighter's build sliders can make a short, stocky character where torsoR exceeds
// headR) guarantees the beard clears both.
const front = hz - Math.max(headR, torsoR)*1.3;
```

Any new accessory-clearance math added to this renderer should follow the same
pattern: identify every primitive the new geometry could be occluded by, and take the
`max()` (or sum, per the belt-stripe case) of the relevant radii — never assume one
named radius is always the largest.

## 3D stage scenes

`STAGES_3D = [stageDojo3D, stageRooftop3D, stageBamboo3D, stageArena3D]`, indexed the
same way as the 2D `STAGES`/`STAGES_PIXEL` arrays (see `docs/2D_rendering.md`). Each
stage is built from the same four primitives as everything else in this renderer —
`bone()`, `ball()`, `buildQuadFloor` (ground plane), `buildQuadWall` (backdrop plane) —
at roughly the same prop density as its 2D counterpart, not a new/richer scene:

- **Dojo** — tatami floor + backdrop quads, two swaying heavy-bag `bone()`s
  (`Math.sin(t*1.1+k*2)` sway, mirroring the 2D bag-swing animation).
- **Rooftop** — floor/backdrop quads, a filtered subset of `DECOR.buildings` as
  backdrop-quad "skyline" boxes with a colored window-quad accent per building, two
  vertical antenna `bone()`s.
- **Bamboo** — floor/backdrop quads, `DECOR.bamboo` stalks as swaying `bone()`s, two
  stone-lantern prop groups (`bone()` post + `ball()` lamp).
- **Arena** — floor/backdrop quads, three horizontal rope `bone()`s, two corner-post
  `bone()`s, and a brief full-scene brightness "flash" (`Math.sin(t*9)+Math.sin(t*13)`)
  mimicking camera flashes.

Each stage function also sets the fog uniforms for that scene
(`uFogColor`/`uFogNear`/`uFogFar`) — flat/banded diffuse lighting plus this simple
linear depth fog (computed in the fragment shader from `vDepth`) is the entire lighting
model; there are no shadow maps or per-light passes.

## Quality toggle (fight-only, 3D-only)

```js
const QUALITY3D = {
  eyecandy:    { segments:12, dpr: min(devicePixelRatio,2), particleScale:1 },
  performance: { segments:6,  dpr:1, particleScale:0.4 },
};
```

Two presets, persisted as `localStorage.kmp_quality` (default `'eyecandy'`):
- **Backing-store resolution** — `dpr` capped at 2× (Eye Candy) vs. native 1× canvas
  size (Performance), applied in `resize3D()`.
- **Mesh segment count** — `12` vs `6`, passed to `buildMeshes(segments)`, i.e. sphere/
  cylinder roundness/fidelity, not geometry that changes shape.
- **Particle/decoration density** (`particleScale`) — read by decorative stage effects.

`setQuality3D(name)` rebuilds meshes and resizes in place — no WebGL context
recreation, so switching is instant mid-fight. This toggle is **3D-only** because
Classic/Pixel have no equivalent cost axis to trade against: they're already flat 2D
canvas draws with no mesh-fidelity or GPU-resolution knob to turn. The corresponding
UI button (`#qualityBtn`, shown only during a fight when `graphicsStyle==='3d'`) is
`docs/UI.md`'s territory.

## Testing note

`render3d.test.js` unit-tests the **pure math layer only**: matrix correctness
(`mat4Identity`, `mat4Ortho`'s near/far and left/right/top/bottom clip-space mapping),
`normalize3`, `hexToRgb01`, mesh vertex/index counts for `buildSphere`/`buildCylinder`/
`buildQuadFloor`/`buildQuadWall`, and the exact-normal-transform property of
`pointMatrix`/`boneMatrix`/`boxScaleMatrix`. None of this touches `gl` — these are the
functions in the file with zero DOM/WebGL dependency (see **Dual-environment file
structure** above), run via `node --test`.

This test suite proves the math is correct; it proves nothing about visual
correctness — mesh placement relative to *other* meshes (the entire depth-occlusion bug
class above), lighting appearance, or the canvas-layering bug are all outside what a
math unit test can see. In this codebase's actual history, every one of those bug
classes was only caught by looking at (or screenshotting) an actual rendered, composited
page in a browser — never by a math-only test, and not by `gl.readPixels` alone either.

**A specific, easy-to-repeat trap:** calling `gl.readPixels` from outside the actual
render loop — e.g. from an automated test harness driving a headless/offscreen context
after the fact — can return an empty/cleared buffer, because WebGL's default
`preserveDrawingBuffer:false` semantics let the browser clear or invalidate the
drawing buffer between frames/composites unless it's read immediately after the draw
that produced it (or the context was created with `preserveDrawingBuffer:true`). This
has tripped up multiple review passes on this project already. Treat a `gl.readPixels`
call as trustworthy only when it happens synchronously right after the render call
being checked, in the same frame — for anything else (canvas layering, composited
visual state, "does this look right"), use an actual browser screenshot of the
composited page, not a raw pixel readback.
