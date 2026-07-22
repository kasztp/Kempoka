# 2D Rendering (Classic & Pixel)

Technical reference for the two 2D canvas fighter/stage renderers in `index.html`: **Classic**
(vector strokes) and **Pixel** (blocky/retro). The 3D renderer lives in `render3d.js` — see
`docs/3D_rendering.md`. Screens, menus, buttons, HUD, and the state machine are covered in
`docs/UI.md`. Game data (belts, `CHARACTERS`, combat math, i18n) is covered in `docs/game_logic.md`
— this doc only explains how that data gets drawn.

## Per-frame dispatch

Each fight frame, `bg()` paints the current stage, then both fighters are drawn on top:

```js
bg();
[F[0],F[1]].forEach(drawFighter);
```

`drawFighter(f)` (`index.html:426`) is the single entry point for drawing one fighter. It:

1. Resolves `h=fh(f)` (height, from `game-logic.js`, see `docs/game_logic.md`), `c=f.char`, and
   `pose=poseOf(f)` (idle/walk/crouch/jump/hit/punch/kick/jab/cross/hookH/hookB/upper/tepe/low/
   round/roundH/shoot/clinch/choke/ko — derived from fighter state, see `poseOf()` at
   `index.html:415`).
2. Draws the ground shadow ellipse.
3. Applies `ctx.translate(f.x,f.y); ctx.scale(f.facing,1)` — all subsequent joint math and drawing
   happens in **fighter-local space**: feet at `(0,0)`, up is negative Y, and mirroring for
   left/right facing is just the `facing` scale (`1` or `-1`), never separate art.
4. Computes shared joint positions for the current pose (see next section).
5. Dispatches to exactly one renderer:

```js
(graphicsStyle==='3d'&&state==='fight' ? draw3DFighter : graphicsStyle==='pixel'?drawFighterPixel:drawFighterClassic)
  (f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee);
```

`graphicsStyle` is `'classic'|'pixel'|'3d'` (persisted in `localStorage.kmp_graphics`, cycled by
`toggleGraphicsStyle()`, falls back to `'classic'` if `has3DSupport()` is false). Note the 3D
branch is further gated on `state==='fight'` — outside an active fight (menus, portraits) 3D-mode
still falls through to `drawFighterPixel`/`drawFighterClassic` based on `graphicsStyle==='pixel'`.

### The shared joint-math contract

This is *why* Classic, Pixel, and 3D stay visually consistent despite being three independent
drawing backends: **all pose/joint math is computed once, in `drawFighter()`, before the dispatch
line, and handed to all three renderers as plain arguments.** None of the three renderer functions
computes its own joint positions — they only know how to render a given set of joints.

Joints, all in local space (`hip`, `sh` shoulder, `head`, `headR` head radius, `fFoot`/`bFoot`
front/back foot, `fHand`/`bHand` front/back hand, `fKnee` front knee or `null`):

```js
let hip=[0,-0.46*h], sh=[0,-0.76*h], head=[0,-0.9*h], headR=0.11*h;
let fFoot=[0.14*h,0], bFoot=[-0.14*h,0], fHand=[0.16*h,-0.6*h], bHand=[-0.12*h,-0.6*h], fKnee=null;
```

These defaults are then overridden per `pose` (idle sways the shoulder with `Math.sin`, walk
alternates feet/hands with `Math.sin(ph*10)`, punch/kick families extend a hand or foot by an
interpolation factor `p` derived from `f.action.t` against the move's `active` window, roundhouse
chambers a knee and whips the shin, `shoot`/`clinch`/`choke` reposition the whole silhouette for
grapples, `ko` is handled by an outer rotate). Because every renderer receives the *same* `hip`,
`sh`, `head`, hand, and foot coordinates for a given pose, a fighter looks anatomically identical
in Classic, Pixel, and 3D — only the rendering technique (strokes vs. blocky pixels vs. WebGL mesh)
differs. Anyone changing a pose's math changes it for all three renderers at once, by construction.

`g=c.build.girth` (limb/torso thickness multiplier) is also passed through unchanged for both 2D
renderers to scale `line()`/`drawBlockyLimb()` widths.

## `drawFighterClassic` — vector/stroke renderer

`index.html:472`. Draws the fighter as a series of `ctx.stroke()`/`ctx.fill()` calls directly on
the main `ctx` (already translated/scaled into fighter-local space by `drawFighter()`). The local
helper:

```js
const line=(a,b,w,col)=>{ ctx.strokeStyle=col; ctx.lineWidth=w; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke(); };
```

draws one limb segment as a round-capped stroke — this is what gives limbs their sausage-like
rounded ends without separate joint circles.

**Draw order** (deliberate, and commented in the source):

1. **Legs** — front leg (bent at `fKnee` if present, two strokes hip→knee→foot; otherwise one
   hip→foot stroke) in `pantsColor`, then back leg in `shade(pantsColor,-10)` (slightly darker, for
   cheap depth separation).
2. **Back arm**, drawn *before* the torso. The source comment explains why: it "pivot[s] a bit
   toward the body's centerline so its near end sits under the torso's rounded cap — the body
   partially occludes it near the shoulder instead of both arms visibly fanning out from one
   exposed point ('crossed shoulders')". The pivot point is `bSh=[sh[0]-3*g, sh[1]]`, not `sh`
   itself.
3. **Torso**, a single thick round-capped stroke from `hip` to `sh` in `topColor` (`GI_BLACK` for
   gi outfits — the pants color already distinguishes rank via `giAboveBlue()`; otherwise `c.gi`).
   A gi gets a faint lapel-hint stroke.
4. **Belt** — see below.
5. **Front arm**, drawn *before* the necklace. Comment: "drawn before the necklace so the necklace
   isn't half-covered by it".
6. **Necklace** (Dan ranks only), drawn *after* both arms. Comment: "necklace ... sitting on the
   upper chest just below the shoulder/collar point so the head circle drawn later doesn't cover
   it; drawn after both arms so it reads clearly on top". So the ordering back-arm → torso →
   belt → front-arm → necklace → hands → head is entirely occlusion-driven, not incidental.
7. **Hands** — filled circles in `c.skin`.
8. **Cleaver** (Imi's special weapon, active while `f.cleaver>0`) — a small rectangle blade +
   handle drawn attached to `fHand`.
9. **Head** — filled circle at `head`, radius `headR`.
10. **Hair**, **beard**, then **glasses** — see below.

### Belt band

```js
const belt=getBelt(c.beltRank);
if(belt){ const bx0=hip[0]-11*g, bx1=hip[0]+11*g, by=hip[1]-4;
  // band stroke, then belt.stripe (kyu rank stripe) as a thin overlay, then belt.tip
  // (dan-rank colored tip segment) as a short overlay at the bx1 end
}
```

`belt`/`belt.stripe`/`belt.tip`/`belt.dan` come from `getBelt()` in `game-logic.js` — see
`docs/game_logic.md` for what those fields mean; here they only drive draw calls (stripe = thin
line 3.5px above the band, tip = short colored overlay segment at one end, dan → necklace).

### Hairstyles (`c.hair.style`)

All drawn in `c.hair.color`, positioned relative to `head`/`headR`:

- **`braid`** — a cap (half-circle arc) plus a single curved strand quadratic-curving down-left.
  The strand's start point is deliberately pinned to the cap arc's own bottom edge
  (`head[1]-headR*0.3`), not the bare skull — comment: "now visibly grows out of the hair, not the
  skin".
- **`punk`** — a fan of 5 triangular spikes radiating from one anchor point at the top of the
  skull (`by=head[1]-headR*0.82`), angles `i*0.36` for `i` in `[-2..2]`. Comment: "reads as a
  mohawk ridge in profile instead of bangs" (vs. spreading spikes across the face).
- **`leia`** — two side buns (circles offset ±`headR*0.9`) plus a top cap arc.
- **`headguard`** — a full-coverage cap arc plus two ear-flap circles plus a chin-strap stroke in a
  darker shade (`shade(c.hair.color,-30)`).
- **`bald`** — no hair drawn.
- default/other styles — a plain cap arc.

### Beards (`beardStyle(c)`, `index.html:563`)

`beardStyle()` normalizes `c.beard`: `true`→`'full'`, falsy→`'none'`, otherwise passes the string
through (`'moustache'|'goatee'|'long'`). Rendering:

- **`full`** — filled half-circle under the head.
- **`moustache`** — a small filled rectangle.
- **`goatee`** — a rectangle (moustache) plus a small chin circle.
- **`long`** — a grey moustache rectangle plus a long curved quadratic beard shape reaching down
  to `head[1]+headR*3.4` — the comment notes this was previously `headR*2.6` and was lengthened
  "for a properly long look".

### Glasses (`c.glasses`, 5 types, tint-aware)

Independent of hair/beard — "a character can have any combination". Positioned at
`ey=head[1]-headR*0.05`, lenses at `±headR*0.42`:

- **`monocle`** — a single tinted ellipse over the left eye only (fixed purple tint), no frame.
- **`potter`** — round wire frames (`strokeStyle='#1a1a1a'`, no fill), plus a bridge line — no
  tint.
- **`sensei`** — filled tinted ellipses (fixed orange `rgba(230,140,40,.7)`) with dark outlines and
  a bridge line.
- any other type (default lens rendering) — filled tinted ellipses using
  `c.glassesTint` (`'black'|'brown'|'pink'`) to pick the fill color from a lookup object, same
  outline/bridge as `sensei`.

## `drawFighterPixel` — blocky/retro renderer

`index.html:570`. Same joint inputs, same conceptual draw order as Classic (each block below
carries an explicit comment cross-referencing the matching Classic behavior), but rendered through
a low-resolution offscreen buffer instead of directly on `ctx`.

### Why an offscreen buffer, not just grid-snapped coordinates

```js
const PIXEL_BUF_RANGE=220, PIXEL_BUF_SCALE=2;   // covers world coords [-220,220]; 2 world units per buffer pixel
const pixelBuf=document.createElement('canvas');
pixelBuf.width=pixelBuf.height=(PIXEL_BUF_RANGE*2)/PIXEL_BUF_SCALE;
const bctx=pixelBuf.getContext('2d');
```

The source comment is explicit about the reasoning: "Canvas2D always antialiases vector
fills/strokes no matter how much coordinates are grid-snapped, so the only way to get genuinely
stepped/blocky pixel-art edges is to rasterize at low native resolution and upscale with
nearest-neighbor." Snapping coordinates to a grid (`snap()`, see below) only controls *where*
edges fall — it does not stop the rasterizer from antialiasing those edges. Rendering small (110×110
px) and then blitting up with `imageSmoothingEnabled=false` is what actually produces hard
stair-stepped pixels.

Per fighter-draw call: `bctx` is reset and cleared, then translated to its own center and scaled by
`1/PIXEL_BUF_SCALE` so the same fighter-local joint coordinates used by Classic work unchanged
against the small buffer. All the blocky-toolkit drawing happens against `bctx`. At the end:

```js
const smoothed=ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled=false;
ctx.drawImage(pixelBuf, -PIXEL_BUF_RANGE, -PIXEL_BUF_RANGE, PIXEL_BUF_RANGE*2, PIXEL_BUF_RANGE*2);
ctx.imageSmoothingEnabled=smoothed;
```

drawn centered at local `(0,0)` on the main `ctx`, which already has the caller's
`translate(f.x,f.y)+scale(f.facing,1)` applied — so the buffer inherits correct position and
mirroring for free.

### Blocky toolkit primitives (`index.html:666-730`)

Shared by both the pixel fighter renderer and the pixel stage renderers. Comment at the toolkit's
top marks the whole approach as an explicit simplification: "blocky strokes/rows instead of true
tapered polygons — same visual payoff (outlined, pixel-snapped, 2-tone shaded), far less geometry
code. Upgrade to real quads only if this reads wrong at the close-together-limb poses
(shoot/clinch)."

- **`PX=2`** — "the one dial for chunky vs detailed" pixel-grid size.
- **`snap(v)`** — `Math.round(v/PX)*PX`, quantizes a coordinate to the grid.
- **`drawBlockyLimb(a,b,width,col,tctx)`** — one limb segment: a wider ink-colored (`INK`) outline
  stroke, then the fill-colored stroke on top, then (guarded by `len>=width*1.2`, to skip
  squashed/too-short segments) a thin shadow-band stroke offset perpendicular to the segment using
  `shade(col,-24)`.
- **`drawBlockyCircle(cx,cy,r,col,yMin,yMax,tctx)`** — head/hands: draws the circle as horizontal
  1px(`PX`)-tall rows (`circleRows(r)`, cached per radius), first an ink outline row pass, then a
  fill pass where rows below `r*0.15` get a darkened shade band for cheap sphere shading.
  `yMin`/`yMax` let a caller clip to a vertical sub-range (used to draw only the top or bottom half
  of a circle, e.g. hair caps).
- **`drawBlockyCircleFlat(...)`** — same row technique, fill-only, no outline/shading — used for
  hair caps/beard accents layered on top of a circle already outlined.
- Every helper takes an optional trailing `tctx` context arg, defaulting to the main `ctx`.
  `drawFighterPixel` passes `bctx` so fighters rasterize into the small buffer; stage props pass
  nothing and draw straight onto `ctx` because, per the comment, "Stage props stay on the main ctx
  (mostly axis-aligned already, antialiasing is a non-issue there)."

### Mirroring Classic's logic

`drawFighterPixel` re-implements the exact same sequence as Classic through the blocky primitives:
legs (bent knee via two `drawBlockyLimb` calls) → back leg (darker shade) → back arm (pivoted
toward centerline, same occlusion comment) → torso → belt band/stripe/tip → front arm → necklace →
hands → cleaver → head → hairstyle (same 6 styles, same geometry formulas, just via
`drawBlockyCircleFlat`/`drawBlockyLimb` instead of arcs/strokes) → beard (same 4 styles) → glasses
(same 5 types/tints, monocle/potter/sensei/tinted-default), confirming the two renderers are kept
in lockstep by hand, not by sharing a code path.

## High-DPI handling (Classic-mode crispness fix)

`index.html:99-112`. The canvas element is styled to fill its container
(`width:100%;height:100%;object-fit:contain`) while the game itself always draws in a fixed
logical coordinate space, `W=960, H=540`. Historically the canvas's backing store was exactly
960×540 physical pixels, CSS-stretched to fill the viewport — on a high-DPI display this is a large
upscale with no extra source resolution, reading as blurry.

Fix:

```js
const DPR = Math.min(window.devicePixelRatio||1, 2);
cv.width = W*DPR; cv.height = H*DPR;
ctx.scale(DPR, DPR);
```

The backing store (`cv.width`/`cv.height`, physical pixels) is sized to `W*DPR`×`H*DPR` — i.e. it
matches the device's real pixel density (capped at 2x, "matching the cap already used for the 3D
quality preset in `render3d.js`", so neither renderer over-spends GPU/fill-rate on displays beyond
2x). The CSS box size is untouched (still stretches to fill the viewport via `object-fit:contain`).
A single `ctx.scale(DPR, DPR)` right after resizing means every existing `ctx.fillRect(0,0,...)`-
style call elsewhere in the file keeps using the same `960×540` logical coordinates unchanged —
the scale factor is applied once, globally, rather than every draw call needing DPR-awareness.

Because the backing store is now genuinely `DPR`× denser than the logical 960×540, the browser has
real source pixels to map to the physical display, and `object-fit:contain` no longer has to
upscale a low-res buffer.

Related: pointer-to-canvas coordinate mapping has its own correction, `canvasContentRect()`
(`index.html:119`), which accounts for letterbox bars introduced by `object-fit:contain` when the
viewport aspect ratio isn't exactly 16:9 — not a rendering concern per se, but exists for the same
CSS-stretching setup. See `docs/UI.md` for input/click handling.

## Stage/background rendering

`bg()` (`index.html:867`) is the per-frame stage entry point:

```js
function bg(){
  if(graphicsStyle==='3d'){ ctx.clearRect(0,0,W,H); begin3DFrame(stageIndex, now()); }
  else{
    ctx.fillStyle=INK; ctx.fillRect(0,0,W,H);
    const set = graphicsStyle==='pixel' ? STAGES_PIXEL : STAGES;
    set[stageIndex % set.length]();
  }
  ...
}
```

`STAGES=[stageDojo, stageRooftop, stageBamboo, stageArena]` (`index.html:817`) and
`STAGES_PIXEL=[stageDojoPixel, stageRooftopPixel, stageBambooPixel, stageArenaPixel]`
(`index.html:865`) are parallel arrays indexed by `stageIndex` (which stage advances is game-state
logic, out of scope here). Each pair renders the same stage concept once with plain
`ctx`/gradient/stroke calls (Classic) and once through the blocky toolkit (Pixel) — analogous to
the fighter renderer split.

Static decorative layout (building silhouettes, star positions, bamboo stalk positions/phases,
falling-leaf positions) is precomputed once at load into `DECOR` (`index.html:759`) via a small
seeded PRNG `rng(seed)`, specifically "so decor doesn't jitter each frame" — only animation phase
(via `now()`, `performance.now()/1000`) varies per frame, not layout.

All 4 stages are entirely procedural — no image assets:

1. **`stageDojo`/`stageDojoPixel`** — Underground Dojo: dim linear-gradient concrete backdrop,
   a brick-grid stroke pattern (offset every other row), two calligraphy scrolls (tan rectangles
   with dark red end-caps and 拳/法 kanji glyphs drawn with `ctx.fillText`, positioned to clear the
   HUD's round-timer/HP-bar/name columns), two swaying heavy bags (`Math.sin(t*1.1+k*2)` rotation)
   with dark shadow bands, and a tatami-mat floor (grid-stroked rectangle).
2. **`stageRooftop`/`stageRooftopPixel`** — Rooftop Cage: dark blue gradient sky, a skyline of
   `DECOR.buildings` with lit/unlit window cells (pseudo-random via a hashed index, cycling
   yellow/cyan/pink), a purple haze band, a diagonal crosshatch line pattern forming a diamond
   lattice (the chain-link fence), a dark wet floor, and animated rain streaks
   (`(i*137+t*900)%W` / `(i*53+t*900)%GROUND`, short diagonal strokes).
3. **`stageBamboo`/`stageBambooPixel`** — Bamboo Grove: warm-dark gradient backdrop, `DECOR.bamboo`
   stalks swaying (`Math.sin(t*0.8+b.ph)*6`) with horizontal node-line shading, two stone lanterns
   (stacked rectangles with a lit orange window), a dirt floor, static `DECOR.leaves` scattered on
   the ground (rotated ellipses, red/gold), and `DECOR.drift` — leaves falling and drifting
   sideways over time (`(d.y+t*d.sp)%GROUND` wrap, `Math.sin` horizontal sway).
4. **`stageArena`/`stageArenaPixel`** — World Combat Arena: near-black stadium gradient,
   `DECOR.stars` flickering as camera flashes (two summed sine waves gated past a threshold,
   `Math.sin(t*9+s.ph)+Math.sin(t*13+i)>1.6`, so flashes are irregular/sparse rather than a uniform
   strobe), a radial spotlight/vignette gradient, red ring-rope lines, ring-post rectangles, and a
   canvas-colored floor with a red-stroked ring outline.

The Pixel variants reuse the exact same procedural formulas/`DECOR` data — the only difference is
substituting `ctx.fillRect`/gradient calls with `drawBlockyRect`/`bandedFillRect`/`bandedRadial`/
`drawBlockyLimb`, plus snapping stroke coordinates with `snap()`. `bandedFillRect`/`bandedRadial`
(`index.html:717-730`) render "solid color bands instead of a smooth gradient" — stepping a linear
interpolation (`lerpColor`) across a fixed number of flat-filled bands (default 6) to keep the
pixel-art look consistent even where Classic would use a true CSS/Canvas gradient.

## `drawPortrait()` — shared small-preview renderer

`index.html:1213`, used by character-select cards and Create Fighter's live preview:

```js
function drawPortrait(c,cx,cy,scale){
  const f={char:c,x:cx,y:cy,facing:1,vx:0,anim:0,cleaver:0,action:null,grab:null,down:0,stun:0,
    blocking:false,crouching:false,onGround:true};
  ctx.save(); ctx.translate(cx,cy); ctx.scale(scale,scale); ctx.translate(-cx,-cy); drawFighter(f); ctx.restore();
}
```

It builds a minimal synthetic fighter object (idle pose, no action/grab/stun) so `poseOf()`
resolves to `'idle'`, then wraps `drawFighter(f)` — the same full dispatch described above,
including whatever `graphicsStyle` is currently active — in a `translate/scale/translate` sandwich
that scales the fighter about `(cx,cy)` rather than the origin. No separate portrait-drawing logic
exists; portraits are literally one frame of the same fighter renderer at a different scale/
position. Card layout, click targets, and everything else around the portrait are UI concerns —
see `docs/UI.md`.

## Shared color helper: `shade()`

`index.html:664`:

```js
function shade(hex,amt){ const n=parseInt(hex.slice(1),16);
  let r=(n>>16)+amt, gc=((n>>8)&255)+amt, b=(n&255)+amt;
  r=Math.max(0,Math.min(255,r)); gc=Math.max(0,Math.min(255,gc)); b=Math.max(0,Math.min(255,b));
  return '#'+((r<<16)|(gc<<8)|b).toString(16).padStart(6,'0');
}
```

Adds `amt` (positive = lighten, negative = darken) to each RGB channel of a `#rrggbb` hex color,
clamped to `[0,255]`. Used throughout both 2D renderers for cheap depth/shading cues: darkening the
back leg/back arm relative to the front, darkening a headguard's chin-strap, darkening the lower
rows of a blocky circle to fake sphere shading, and darkening a blocky limb's shadow band. Defined
once, referenced at every callsite above rather than re-explained.
