# Character rendering fixes — design

## Context

Kempoka draws every fighter from a shared 2D joint skeleton (`poseOf()` in `index.html`)
across three render styles: Classic (vector), Pixel (blocky retro), and 3D (WebGL,
`render3d.js`). Character customization includes 5 hairstyles (`short`, `braid`, `bald`,
`punk`, `leia`, `headguard` — see `HAIR_ORDER` in `game-logic.js`) and 5 beard styles
(`none`, `full`, `moustache`, `goatee`, `long`).

Three concrete rendering bugs were found in the hairstyle geometry (confirmed against
screenshots), Classic mode looks blurry on high-DPI displays, and the 3D mode currently
renders every hairstyle as one generic cap with no beards at all (a deliberate scope cut
from the original 3D-mode work, tracked as a known gap).

This spec covers: fixing the 3 hairstyle geometry bugs in Classic/Pixel, lengthening the
old-master beard, adding real per-style hair + beard geometry to 3D mode, and fixing
Classic mode's high-DPI blurriness. It does **not** cover new special moves or weapons —
that's a separate, independently-scoped follow-up.

## Goals

- Ponytail (`braid`) visibly grows out of the hair mass, not the bare scalp.
- Mohawk (`punk`) reads as a ridge/tuft from the top of the skull, not spikes plastered
  across the face.
- Buns (`leia`) are sized proportional to the head, not visibly undersized.
- The old-master long beard reaches noticeably further down.
- All of the above fixed consistently in **both** Classic and Pixel (they share the same
  underlying geometry, just rendered through different toolkits).
- 3D mode gains real per-style hair and beard geometry, reusing only the existing
  `bone()`/`ball()` primitives (no new mesh types) — bringing it to parity with what
  Classic/Pixel already show.
- Classic mode (and, incidentally, the menus/HUD and Pixel mode's edges) render crisply
  on high-DPI displays instead of blurry.

## Non-goals

- No changes to character data (`CHARACTERS`, `normalizeCharacter`, Create Fighter UI) —
  every fix is pure rendering geometry using data that already exists.
- No changes to gameplay, hitboxes, or animation timing.
- No new hairstyles or beard styles.
- No perspective or camera changes to the 3D renderer.

## Fixes

### 1. Ponytail (`braid`) — Classic & Pixel

**Bug:** the hair cap is drawn as an upper half-disk ending at its flat bottom edge
(`y = head[1] - headR*0.3`), but the drooping strand currently starts at
`y = head[1]` (the head's vertical center — ear/mid-face height), well below the cap.
The result is a visible gap that reads as the strand growing from bare skin.

**Fix:** move the strand's start point to the cap's actual bottom edge:
`[head[0]-headR*0.8, head[1]-headR*0.3]` (only the Y coordinate changes, from `head[1]`
to `head[1]-headR*0.3`). The curve's control point and end point are unchanged — the
strand simply starts higher, closing the gap (and reads as slightly longer/more flowing,
which is a welcome side effect).

Applies to `drawFighterClassic`'s `quadraticCurveTo` strand and `drawFighterPixel`'s
2-segment `drawBlockyLimb` strand (`p0`) identically.

### 2. Mohawk (`punk`) — Classic & Pixel

**Bug:** 5 spikes are currently spread horizontally across the face width
(`head[0] + i*headR*0.35` for `i` in `-2..2`) at a fixed height near the vertical center
(`head[1]-headR*0.15`, roughly eyebrow height) — reading as spiky bangs plastered on the
face rather than a mohawk on top of the head.

**Fix:** replace the whole shape. All spikes share one base anchor point at the top of the
skull, `(head[0], head[1]-headR*0.82)`, and fan outward at different angles from vertical
— a small trig loop instead of a fixed horizontal spread:

```js
const bx=head[0], by=head[1]-headR*0.82;
for(let i=-2;i<=2;i++){
  const ang=i*0.36, spikeLen=headR*(0.75-Math.abs(i)*0.08);
  const dx=Math.sin(ang), dy=-Math.cos(ang), px=-dy, py=dx;   // px,py = perpendicular to spike direction
  const tipX=bx+dx*spikeLen, tipY=by+dy*spikeLen, w=headR*0.12;
  // triangle: (bx-px*w,by-py*w) -> (tipX,tipY) -> (bx+px*w,by+py*w)
}
```

The center spike is tallest (`0.75*headR`), tapering slightly outward — reads as a tuft/
ridge fanning from the top of the head regardless of viewing angle, matching a mohawk seen
in profile (the game's actual camera framing).

Pixel mode draws the same triangles through `bctx` with each vertex passed through the
existing `snap()` pixel-grid helper, keeping the blocky-edge convention.

### 3. Buns (`leia`) — Classic & Pixel

**Bug:** side buns are drawn at `radius = headR*0.45`, reading as too small relative to
the head.

**Fix:** increase to `radius = headR*0.6`. Position (`head[0] ± headR*0.9`) and the small
top-cap arc are unchanged — larger buns naturally overlap the head silhouette slightly,
which reads as normal for the hairstyle.

### 4. Old-master beard length — Classic & Pixel

**Fix:** the `long` beard style's drooping curve currently reaches
`head[1]+headR*2.6`; extend to `head[1]+headR*3.4`. Same change in both
`drawFighterClassic` and `drawFighterPixel`.

### 5. Per-style 3D hair + beards (new geometry in `render3d.js`)

Currently `draw3DFighter` renders every non-bald hairstyle as one generic cap `ball()` and
no beard at all. This adds real per-style shapes, reusing only the existing `bone()`
(cylinder) and `ball()` (sphere) helpers — consistent with the rest of the 3D renderer's
"two primitives only" design, no new mesh generator needed.

- **Mohawk:** the same fan-of-spikes math as fix #2, in 3D. Each spike is one thin
  `bone()` (anchor → tip) plus a small `ball()` at the tip for a slightly rounded point.
  The fan direction is along **X** (the character's facing/profile axis — anatomically the
  ridge of a mohawk on a sideways-facing figure runs front-to-back of the skull, which in
  this coordinate system is the X axis; Z is the ear-to-ear axis, which the frontal camera
  can't usefully show). All spike vertices sit at `JOINT_DEPTH.head` (Z=0), matching the
  head sphere.
- **Ponytail:** keeps the existing cap `ball()`; adds 2 tapering `bone()` segments
  drooping from a point on the cap sphere's actual surface (not the bare head sphere),
  ending in a small `ball()` tip — mirroring the Classic/Pixel fix's "start from the hair,
  not the skin" principle.
- **Buns:** two `ball()`s at ear height, sized to match the enlarged Classic/Pixel version.
- **Headguard:** a slightly-oversized cap `ball()` plus two small ear-pad `ball()`s.
- **Short:** unchanged (already the existing generic cap, which suits "short hair" as-is).
- **Bald:** unchanged (no hair geometry).
- **Beards** (net-new in 3D):
  - `full` — one `ball()` under the chin.
  - `moustache` — one thin horizontal `bone()` under the nose.
  - `goatee` — the moustache `bone()` plus one small `ball()` below the chin.
  - `long` (old master) — a tapering 2-3 segment `bone()` chain from the chin, reaching
    down about as far as the lengthened Classic/Pixel version (fix #4), in the same
    grey/white tone (`#c9c9c9`), ending in a small `ball()` tip.

All new geometry uses the character's existing `c.hair.color` (hair shapes) or the fixed
grey (beard, matching Classic/Pixel's `long` style — the only beard style with a
non-hair-colored tint today).

### 6. Classic-mode high-DPI crispness

**Root cause:** the canvas backing store is fixed at `960×540` physical pixels
(`<canvas id="cv" width="960" height="540">`), CSS-stretched via
`width:100%;height:100%;object-fit:contain` to fill whatever viewport size the browser
gives it. On a high-DPI (e.g., Retina Mac) display, that's a large upscale with no extra
source resolution — reading as blurry, which is easy to mistake for "pixelated" even
though nothing about Classic mode is intentionally pixelated.

**Fix:** size the canvas backing store to the logical size times the device pixel ratio
(capped at 2×, matching the cap already used for the 3D quality preset elsewhere in this
codebase), and apply one `ctx.scale(dpr,dpr)` immediately after:

```js
const DPR = Math.min(window.devicePixelRatio||1, 2);
cv.width = W*DPR; cv.height = H*DPR;
ctx.scale(DPR, DPR);
```

Every existing draw call keeps working unchanged — they're all written in the same
logical `960×540` coordinate space, and `ctx.scale` makes that space map to more physical
pixels without touching a single drawing function.

**Why this doesn't affect Pixel mode's intentional chunkiness:** Pixel mode's blocky look
comes from a *separate* low-resolution offscreen buffer (`pixelBuf`, sized by
`PIXEL_BUF_SCALE`) composited back with nearest-neighbor upscaling — that's independent of
the main canvas's backing-store resolution. This fix only makes the *edges* of that
already-blocky output crisper (sharper stair-steps instead of blurred ones); it does not
change the world-space granularity that makes Pixel mode chunky in the first place.

**Why this doesn't affect click/touch hit-testing:** `canvasContentRect()` (the function
all pointer-to-world-coordinate math goes through) reads `cv.getBoundingClientRect()` (the
CSS layout box) and compares it against the logical `W`/`H` constants — it never reads
`cv.width`/`cv.height` directly, so hit-testing is unaffected by this change.

## Testing

- No `game-logic.js` changes — nothing to add to `game-logic.test.js`.
- All fixes are visual/geometric; verification is manual, in a real browser: character
  select portraits (which exercise Classic rendering for every hairstyle/beard
  combination regardless of the active `GFX` mode, per the existing `state==='fight'`
  gate) are the fastest way to check Classic's fixes across every hairstyle at once, then
  spot-check Pixel and 3D in an actual fight.
- The DPI fix should be checked at at least two different `devicePixelRatio` values if
  possible (e.g., via the browser's device-emulation tools) to confirm both the crisp
  rendering and that touch/click hit-testing still lines up correctly.

## Open risks

- The mohawk fan's exact angles/lengths and the enlarged bun radius are aesthetic
  judgment calls, not derived from a hard requirement — if they don't look right once
  rendered, they're cheap constants to retune, not a structural problem.
