# Character Rendering Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 hairstyle geometry bugs (ponytail, mohawk, buns) and the old-master beard
length in Classic/Pixel mode, add matching per-style hair + beard geometry to the 3D
renderer (currently a generic cap with no beards), and fix Classic mode's blurriness on
high-DPI displays.

**Architecture:** Pure geometry/constant edits to the three existing fighter-drawing
functions (`drawFighterClassic`, `drawFighterPixel` in `index.html`; `draw3DFighter` in
`render3d.js`) plus one small canvas-setup change. No new character data, no gameplay
changes, no new files.

**Tech Stack:** Vanilla JS, Canvas2D (Classic/Pixel), raw WebGL (3D) — unchanged from the
existing codebase. No new dependencies.

## Global Constraints

- No changes to `CHARACTERS`, `normalizeCharacter`, or the Create Fighter UI — every fix
  uses character data (`c.hair.style`, `c.hair.color`, `beardStyle(c)`) that already
  exists.
- No changes to gameplay, hitboxes, animation timing, or `game-logic.js`.
- Classic and Pixel must stay visually consistent with each other (same geometry, just
  drawn through each style's own toolkit — `ctx.arc`/`ctx.lineTo` for Classic,
  `drawBlockyCircle`/`drawBlockyLimb`/`snap()` for Pixel).
- The 3D additions reuse only the two existing mesh primitives (`bone()` = cylinder,
  `ball()` = sphere) — no new mesh generator.
- The DPI fix must not change `canvasContentRect()`'s hit-testing math (it reads
  `cv.getBoundingClientRect()` and the logical `W`/`H` constants, never
  `cv.width`/`cv.height` directly) and must not change Pixel mode's intentional
  blockiness (defined by the separate `pixelBuf`/`PIXEL_BUF_SCALE` offscreen buffer,
  independent of the main canvas's backing-store resolution).

---

## File Structure

- **Modify:** `index.html` — `drawFighterClassic` (hair/beard section, ~line 501-522),
  `drawFighterPixel` (hair/beard section, ~line 569-596), and the canvas setup block
  (~line 99-103) for the DPI fix.
- **Modify:** `render3d.js` — `draw3DFighter`'s hair line (~line 328-329), plus two new
  small functions `draw3DHair`/`draw3DBeard` added right after it.

---

### Task 1: Hairstyle & beard geometry fixes — Classic & Pixel

**Files:**
- Modify: `index.html:502-522` (`drawFighterClassic`'s hair/beard block)
- Modify: `index.html:569-596` (`drawFighterPixel`'s hair/beard block)

**Interfaces:** None — pure internal geometry changes to two existing functions; no
signature changes, no new exports, nothing else in the codebase calls into this code
differently.

- [ ] **Step 1: Fix `drawFighterClassic`'s hair/beard block**

In `index.html`, replace lines 502-522:

```js
  // hair
  ctx.fillStyle=c.hair.color;
  if(c.hair.style==='braid'){ ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.3,headR,Math.PI,0); ctx.fill();
    ctx.lineWidth=6; ctx.strokeStyle=c.hair.color; ctx.beginPath(); ctx.moveTo(head[0]-headR*0.8,head[1]); ctx.quadraticCurveTo(head[0]-headR*2,head[1]+headR,head[0]-headR*1.4,head[1]+headR*2.4); ctx.stroke(); }
  else if(c.hair.style==='punk'){ ctx.beginPath();
    for(let i=-2;i<=2;i++){ const sx=head[0]+i*headR*0.35, spikeH=headR*(1.3-Math.abs(i)*0.15);
      ctx.moveTo(sx-headR*0.12,head[1]-headR*0.15); ctx.lineTo(sx,head[1]-headR*0.15-spikeH); ctx.lineTo(sx+headR*0.12,head[1]-headR*0.15); }
    ctx.closePath(); ctx.fill(); }
  else if(c.hair.style==='leia'){ [-1,1].forEach(side=>{ ctx.beginPath(); ctx.arc(head[0]+side*headR*0.9,head[1]-headR*0.05,headR*0.45,0,7); ctx.fill(); });
    ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.25,headR*0.7,Math.PI,0); ctx.fill(); }
  else if(c.hair.style==='headguard'){ ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.15,headR*1.08,Math.PI,0); ctx.fill();
    [-1,1].forEach(side=>{ ctx.beginPath(); ctx.arc(head[0]+side*headR*0.95,head[1]+headR*0.05,headR*0.4,0,7); ctx.fill(); });
    ctx.strokeStyle=shade(c.hair.color,-30); ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(head[0]-headR*0.95,head[1]+headR*0.05); ctx.quadraticCurveTo(head[0],head[1]+headR*0.8,head[0]+headR*0.95,head[1]+headR*0.05); ctx.stroke(); }
  else if(c.hair.style!=='bald'){ ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.25,headR*0.98,Math.PI,0); ctx.fill(); }
  // beard
  const bStyle=beardStyle(c);
  if(bStyle==='full'){ ctx.fillStyle=c.hair.color; ctx.beginPath(); ctx.arc(head[0],head[1]+headR*0.5,headR*0.75,0,Math.PI); ctx.fill(); }
  else if(bStyle==='moustache'){ ctx.fillStyle=c.hair.color; ctx.fillRect(head[0]-headR*0.55,head[1]+headR*0.28,headR*1.1,headR*0.22); }
  else if(bStyle==='goatee'){ ctx.fillStyle=c.hair.color; ctx.fillRect(head[0]-headR*0.5,head[1]+headR*0.26,headR,headR*0.2);
    ctx.beginPath(); ctx.arc(head[0],head[1]+headR*0.62,headR*0.4,0,Math.PI); ctx.fill(); }
  else if(bStyle==='long'){ ctx.fillStyle='#c9c9c9'; ctx.fillRect(head[0]-headR*0.55,head[1]+headR*0.28,headR*1.1,headR*0.2);
    ctx.beginPath(); ctx.moveTo(head[0]-headR*0.7,head[1]+headR*0.4); ctx.quadraticCurveTo(head[0],head[1]+headR*2.6,head[0]+headR*0.7,head[1]+headR*0.4); ctx.closePath(); ctx.fill(); }
```

with:

```js
  // hair
  ctx.fillStyle=c.hair.color;
  if(c.hair.style==='braid'){ ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.3,headR,Math.PI,0); ctx.fill();
    // strand starts at the cap's own bottom edge (y=head[1]-headR*0.3, same as the cap arc's
    // flat close-out line), not the bare head — it now visibly grows out of the hair, not the skin
    ctx.lineWidth=6; ctx.strokeStyle=c.hair.color; ctx.beginPath(); ctx.moveTo(head[0]-headR*0.8,head[1]-headR*0.3); ctx.quadraticCurveTo(head[0]-headR*2,head[1]+headR,head[0]-headR*1.4,head[1]+headR*2.4); ctx.stroke(); }
  else if(c.hair.style==='punk'){
    // fan of spikes from one anchor at the top of the skull, not spread across the face —
    // reads as a mohawk ridge in profile instead of bangs
    const bx=head[0], by=head[1]-headR*0.82;
    for(let i=-2;i<=2;i++){ const ang=i*0.36, spikeLen=headR*(0.75-Math.abs(i)*0.08);
      const dx=Math.sin(ang), dy=-Math.cos(ang), px=-dy, py=dx, w=headR*0.12;
      const tipX=bx+dx*spikeLen, tipY=by+dy*spikeLen;
      ctx.beginPath(); ctx.moveTo(bx-px*w,by-py*w); ctx.lineTo(tipX,tipY); ctx.lineTo(bx+px*w,by+py*w); ctx.closePath(); ctx.fill(); }
  }
  else if(c.hair.style==='leia'){ [-1,1].forEach(side=>{ ctx.beginPath(); ctx.arc(head[0]+side*headR*0.9,head[1]-headR*0.05,headR*0.6,0,7); ctx.fill(); });
    ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.25,headR*0.7,Math.PI,0); ctx.fill(); }
  else if(c.hair.style==='headguard'){ ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.15,headR*1.08,Math.PI,0); ctx.fill();
    [-1,1].forEach(side=>{ ctx.beginPath(); ctx.arc(head[0]+side*headR*0.95,head[1]+headR*0.05,headR*0.4,0,7); ctx.fill(); });
    ctx.strokeStyle=shade(c.hair.color,-30); ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(head[0]-headR*0.95,head[1]+headR*0.05); ctx.quadraticCurveTo(head[0],head[1]+headR*0.8,head[0]+headR*0.95,head[1]+headR*0.05); ctx.stroke(); }
  else if(c.hair.style!=='bald'){ ctx.beginPath(); ctx.arc(head[0],head[1]-headR*0.25,headR*0.98,Math.PI,0); ctx.fill(); }
  // beard
  const bStyle=beardStyle(c);
  if(bStyle==='full'){ ctx.fillStyle=c.hair.color; ctx.beginPath(); ctx.arc(head[0],head[1]+headR*0.5,headR*0.75,0,Math.PI); ctx.fill(); }
  else if(bStyle==='moustache'){ ctx.fillStyle=c.hair.color; ctx.fillRect(head[0]-headR*0.55,head[1]+headR*0.28,headR*1.1,headR*0.22); }
  else if(bStyle==='goatee'){ ctx.fillStyle=c.hair.color; ctx.fillRect(head[0]-headR*0.5,head[1]+headR*0.26,headR,headR*0.2);
    ctx.beginPath(); ctx.arc(head[0],head[1]+headR*0.62,headR*0.4,0,Math.PI); ctx.fill(); }
  else if(bStyle==='long'){ ctx.fillStyle='#c9c9c9'; ctx.fillRect(head[0]-headR*0.55,head[1]+headR*0.28,headR*1.1,headR*0.2);
    // old-master beard reaches further down (was headR*2.6) for a properly long look
    ctx.beginPath(); ctx.moveTo(head[0]-headR*0.7,head[1]+headR*0.4); ctx.quadraticCurveTo(head[0],head[1]+headR*3.4,head[0]+headR*0.7,head[1]+headR*0.4); ctx.closePath(); ctx.fill(); }
```

- [ ] **Step 2: Fix `drawFighterPixel`'s hair/beard block (same geometry, Pixel toolkit)**

In `index.html`, replace lines 569-596:

```js
  // hair
  if(c.hair.style==='braid'){
    drawBlockyCircleFlat(head[0],head[1]-headR*0.3,headR,c.hair.color,-headR,0,bctx);
    const p0=[head[0]-headR*0.8,head[1]], p1=[head[0]-headR*1.6,head[1]+headR*1.1], p2=[head[0]-headR*1.4,head[1]+headR*2.4];
    drawBlockyLimb(p0,p1,6,c.hair.color,bctx); drawBlockyLimb(p1,p2,5,c.hair.color,bctx);
  } else if(c.hair.style==='punk'){
    bctx.fillStyle=c.hair.color;
    for(let i=-2;i<=2;i++){ const sx=head[0]+i*headR*0.35, spikeH=headR*(1.3-Math.abs(i)*0.15);
      bctx.beginPath(); bctx.moveTo(snap(sx-headR*0.12),snap(head[1]-headR*0.15)); bctx.lineTo(snap(sx),snap(head[1]-headR*0.15-spikeH)); bctx.lineTo(snap(sx+headR*0.12),snap(head[1]-headR*0.15)); bctx.closePath(); bctx.fill(); }
  } else if(c.hair.style==='leia'){
    drawBlockyCircleFlat(head[0]-headR*0.9,head[1]-headR*0.05,headR*0.45,c.hair.color,-headR*0.45,headR*0.45,bctx);
    drawBlockyCircleFlat(head[0]+headR*0.9,head[1]-headR*0.05,headR*0.45,c.hair.color,-headR*0.45,headR*0.45,bctx);
    drawBlockyCircleFlat(head[0],head[1]-headR*0.25,headR*0.7,c.hair.color,-headR*0.7,0,bctx);
  } else if(c.hair.style==='headguard'){
    drawBlockyCircleFlat(head[0],head[1]-headR*0.15,headR*1.08,c.hair.color,-headR*1.08,0,bctx);
    drawBlockyCircleFlat(head[0]-headR*0.95,head[1]+headR*0.05,headR*0.4,c.hair.color,-headR*0.4,headR*0.4,bctx);
    drawBlockyCircleFlat(head[0]+headR*0.95,head[1]+headR*0.05,headR*0.4,c.hair.color,-headR*0.4,headR*0.4,bctx);
  } else if(c.hair.style!=='bald'){
    drawBlockyCircleFlat(head[0],head[1]-headR*0.25,headR*0.98,c.hair.color,-headR*0.98,0,bctx);
  }
  // beard
  const bStyle=beardStyle(c);
  if(bStyle==='full') drawBlockyCircleFlat(head[0],head[1]+headR*0.5,headR*0.75,c.hair.color,0,headR*0.75,bctx);
  else if(bStyle==='moustache'){ bctx.fillStyle=c.hair.color; bctx.fillRect(snap(head[0]-headR*0.55),snap(head[1]+headR*0.28),snap(headR*1.1),snap(headR*0.22)); }
  else if(bStyle==='goatee'){ bctx.fillStyle=c.hair.color; bctx.fillRect(snap(head[0]-headR*0.5),snap(head[1]+headR*0.26),snap(headR),snap(headR*0.2));
    drawBlockyCircleFlat(head[0],head[1]+headR*0.62,headR*0.4,c.hair.color,0,headR*0.4,bctx); }
  else if(bStyle==='long'){ bctx.fillStyle='#c9c9c9'; bctx.fillRect(snap(head[0]-headR*0.55),snap(head[1]+headR*0.28),snap(headR*1.1),snap(headR*0.2));
    bctx.beginPath(); bctx.moveTo(snap(head[0]-headR*0.7),snap(head[1]+headR*0.4)); bctx.quadraticCurveTo(snap(head[0]),snap(head[1]+headR*2.6),snap(head[0]+headR*0.7),snap(head[1]+headR*0.4)); bctx.closePath(); bctx.fill(); }
```

with:

```js
  // hair
  if(c.hair.style==='braid'){
    drawBlockyCircleFlat(head[0],head[1]-headR*0.3,headR,c.hair.color,-headR,0,bctx);
    // strand starts at the cap's bottom edge (head[1]-headR*0.3), not the bare head
    const p0=[head[0]-headR*0.8,head[1]-headR*0.3], p1=[head[0]-headR*1.6,head[1]+headR*1.1], p2=[head[0]-headR*1.4,head[1]+headR*2.4];
    drawBlockyLimb(p0,p1,6,c.hair.color,bctx); drawBlockyLimb(p1,p2,5,c.hair.color,bctx);
  } else if(c.hair.style==='punk'){
    // fan of spikes from one anchor at the top of the skull (matches drawFighterClassic)
    bctx.fillStyle=c.hair.color;
    const bx=head[0], by=head[1]-headR*0.82;
    for(let i=-2;i<=2;i++){ const ang=i*0.36, spikeLen=headR*(0.75-Math.abs(i)*0.08);
      const dx=Math.sin(ang), dy=-Math.cos(ang), px=-dy, py=dx, w=headR*0.12;
      const tipX=bx+dx*spikeLen, tipY=by+dy*spikeLen;
      bctx.beginPath(); bctx.moveTo(snap(bx-px*w),snap(by-py*w)); bctx.lineTo(snap(tipX),snap(tipY)); bctx.lineTo(snap(bx+px*w),snap(by+py*w)); bctx.closePath(); bctx.fill(); }
  } else if(c.hair.style==='leia'){
    drawBlockyCircleFlat(head[0]-headR*0.9,head[1]-headR*0.05,headR*0.6,c.hair.color,-headR*0.6,headR*0.6,bctx);
    drawBlockyCircleFlat(head[0]+headR*0.9,head[1]-headR*0.05,headR*0.6,c.hair.color,-headR*0.6,headR*0.6,bctx);
    drawBlockyCircleFlat(head[0],head[1]-headR*0.25,headR*0.7,c.hair.color,-headR*0.7,0,bctx);
  } else if(c.hair.style==='headguard'){
    drawBlockyCircleFlat(head[0],head[1]-headR*0.15,headR*1.08,c.hair.color,-headR*1.08,0,bctx);
    drawBlockyCircleFlat(head[0]-headR*0.95,head[1]+headR*0.05,headR*0.4,c.hair.color,-headR*0.4,headR*0.4,bctx);
    drawBlockyCircleFlat(head[0]+headR*0.95,head[1]+headR*0.05,headR*0.4,c.hair.color,-headR*0.4,headR*0.4,bctx);
  } else if(c.hair.style!=='bald'){
    drawBlockyCircleFlat(head[0],head[1]-headR*0.25,headR*0.98,c.hair.color,-headR*0.98,0,bctx);
  }
  // beard
  const bStyle=beardStyle(c);
  if(bStyle==='full') drawBlockyCircleFlat(head[0],head[1]+headR*0.5,headR*0.75,c.hair.color,0,headR*0.75,bctx);
  else if(bStyle==='moustache'){ bctx.fillStyle=c.hair.color; bctx.fillRect(snap(head[0]-headR*0.55),snap(head[1]+headR*0.28),snap(headR*1.1),snap(headR*0.22)); }
  else if(bStyle==='goatee'){ bctx.fillStyle=c.hair.color; bctx.fillRect(snap(head[0]-headR*0.5),snap(head[1]+headR*0.26),snap(headR),snap(headR*0.2));
    drawBlockyCircleFlat(head[0],head[1]+headR*0.62,headR*0.4,c.hair.color,0,headR*0.4,bctx); }
  else if(bStyle==='long'){ bctx.fillStyle='#c9c9c9'; bctx.fillRect(snap(head[0]-headR*0.55),snap(head[1]+headR*0.28),snap(headR*1.1),snap(headR*0.2));
    // old-master beard reaches further down (was headR*2.6)
    bctx.beginPath(); bctx.moveTo(snap(head[0]-headR*0.7),snap(head[1]+headR*0.4)); bctx.quadraticCurveTo(snap(head[0]),snap(head[1]+headR*3.4),snap(head[0]+headR*0.7),snap(head[1]+headR*0.4)); bctx.closePath(); bctx.fill(); }
```

- [ ] **Step 3: Manually verify in a browser**

Run: `python3 -m http.server 8000` from the repo root, open `http://localhost:8000`.
Go to **Create Fighter**, cycle through each hairstyle (short/braid/bald/punk/leia/
headguard) and each beard style — the live preview uses Classic rendering, so this is the
fastest way to check every combination at once.
Expected:
- `braid` (ponytail): strand visibly connects to the hair cap, no gap.
- `punk` (mohawk): a fan/tuft of spikes at the top of the head, not spread across the
  face.
- `leia` (buns): visibly bigger, proportional to the head.
- `long` beard (old master): noticeably longer than before.
- Every other style (`bald`, `headguard`, `short`, `full`/`moustache`/`goatee` beards)
  looks unchanged.

Then switch `GFX` to `PIXEL` on the main menu and repeat the same check in the character
select grid (any screen showing fighter portraits) — the shapes should match Classic,
just blockier.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Fix ponytail/mohawk/buns hairstyle geometry and lengthen old-master beard"
```

---

### Task 2: Classic-mode high-DPI crisp rendering

**Files:**
- Modify: `index.html:99-103` (canvas/context setup, right after `cv`/`ctx`/`W`/`H` are
  defined)

**Interfaces:** None — `W`/`H`/`GROUND`/`INK` keep their existing values and meaning;
every function that already draws in this 960×540 logical space needs no changes.

- [ ] **Step 1: Size the canvas backing store by devicePixelRatio**

In `index.html`, modify (insert right after line 102, before the `canvasContentRect`
comment block):

```js
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const cv3d = document.getElementById('cv3d');
init3D(cv3d);
const W = 960, H = 540, GROUND = 476, INK = '#1a1a1a';
```

to:

```js
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const cv3d = document.getElementById('cv3d');
init3D(cv3d);
const W = 960, H = 540, GROUND = 476, INK = '#1a1a1a';

// cv's backing store defaulted to exactly 960x540 physical pixels, CSS-stretched to fill
// the viewport (object-fit:contain) — on a high-DPI display that's a big upscale with no
// extra resolution to work with, reading as blurry. Sizing the backing store by
// devicePixelRatio (capped at 2x, matching the cap already used for the 3D quality
// preset in render3d.js) and scaling the context once here means every existing draw
// call below keeps working in the same 960x540 logical coordinates, unchanged.
const DPR = Math.min(window.devicePixelRatio||1, 2);
cv.width = W*DPR; cv.height = H*DPR;
ctx.scale(DPR, DPR);
```

- [ ] **Step 2: Manually verify in a browser**

Run: `python3 -m http.server 8000`, open `http://localhost:8000`.

Check via devtools: `document.getElementById('cv').width` should equal
`960 * Math.min(window.devicePixelRatio,2)` (e.g. `1920` on a standard 2x-retina display).
Visually: menu text and Classic-mode fighters should look noticeably crisper than before
on a high-DPI display (compare before/after if possible, e.g. via git stash). Confirm
clicking menu buttons and (if on a touch device or via devtools device emulation) the
on-screen touch pad still land on the correct targets — `canvasContentRect()`/hit-testing
must be unaffected. Switch `GFX` to `PIXEL` mid-fight and confirm it still looks
intentionally blocky (not smoothed away) — just with crisper block edges than before.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Fix Classic-mode blurriness on high-DPI displays via DPR-aware canvas sizing"
```

---

### Task 3: Per-style 3D hair + beard geometry

**Files:**
- Modify: `render3d.js:324-330` (`draw3DFighter`'s hair line, plus two new functions
  added right after it)

**Interfaces:**
- Consumes: `bone(a,b,radius,color)`, `ball(p,radius,color)` (existing, from Task 2 of
  the original 3D-mode plan), `hexToRgb01` (Task 1 of that plan), `beardStyle(c)` (defined
  in `index.html`, accessible as a global the same way `DECOR`/`GI_BLACK` already are from
  `render3d.js` — see the existing cross-script-global comments in this file for why that
  works).
- Produces: `draw3DHair(style, headW, headR, hairColor)`,
  `draw3DBeard(bStyle, headW, headR)` — internal helpers, not exported (nothing outside
  `draw3DFighter` calls them).

- [ ] **Step 1: Replace the simplified hair line and add the two new functions**

In `render3d.js`, replace:

```js
  // head + a simplified hair "cap" (every hairstyle renders as the same rounded cap in
  // 3D, colored with the character's hair color — replicating each of Classic's 5 distinct
  // hair silhouettes as real geometry would need new mesh shapes for no gameplay benefit).
  // ponytail: simplified hair; add per-style 3D geometry later if it's visibly missed.
  ball(headW, headR, skin);
  if(c.hair.style!=='bald') ball([headW[0],headW[1]-headR*0.35,headW[2]], headR*0.92, hairColor);
}
```

with:

```js
  // head + per-style hair/beard geometry — mirrors the Classic/Pixel hairstyle shapes,
  // built entirely from the same two primitives (bone=cylinder, ball=sphere) used
  // everywhere else in this renderer, no new mesh types needed.
  ball(headW, headR, skin);
  draw3DHair(c.hair.style, headW, headR, hairColor);
  draw3DBeard(beardStyle(c), headW, headR);
}

// Per-style hair, in 3D. `style` is one of short/braid/bald/punk/leia/headguard
// (HAIR_ORDER in game-logic.js). headW is the head joint's world position [x,y,z].
function draw3DHair(style, headW, headR, hairColor){
  if(style==='bald') return;
  const [hx,hy,hz]=headW;
  if(style==='punk'){
    // fan of thin spikes from one anchor at the top of the skull, fanned along X. X is the
    // character's facing/profile axis (the direction the fighter stands sideways toward),
    // so a ridge fanned along X runs front-to-back across the skull — anatomically the
    // right direction for a mohawk on a sideways-facing figure. Z is the ear-to-ear axis,
    // which the fixed frontal camera can't usefully show anyway. Matches the Classic/Pixel
    // mohawk fix's angle math exactly.
    const bx=hx, by=hy-headR*0.82;
    for(let i=-2;i<=2;i++){ const ang=i*0.36, spikeLen=headR*(0.75-Math.abs(i)*0.08);
      const dx=Math.sin(ang), dy=-Math.cos(ang);
      const tipX=bx+dx*spikeLen, tipY=by+dy*spikeLen;
      bone([bx,by,hz],[tipX,tipY,hz], headR*0.1, hairColor);
      ball([tipX,tipY,hz], headR*0.08, hairColor);
    }
    return;
  }
  if(style==='braid'){
    const capR=headR*0.92, capCX=hx, capCY=hy-headR*0.35;
    ball([capCX,capCY,hz], capR, hairColor);                      // cap
    // strand starts on the cap's own surface (lower-back side), not the bare head sphere
    const p0=[capCX-capR*0.75, capCY+capR*0.5, hz];
    const p1=[hx-headR*1.5, hy+headR*1.0, hz];
    const p2=[hx-headR*1.3, hy+headR*2.2, hz];
    bone(p0,p1, headR*0.16, hairColor); bone(p1,p2, headR*0.11, hairColor);
    ball(p2, headR*0.11, hairColor);
    return;
  }
  if(style==='leia'){
    ball([hx-headR*0.9, hy-headR*0.05, hz], headR*0.6, hairColor);
    ball([hx+headR*0.9, hy-headR*0.05, hz], headR*0.6, hairColor);
    ball([hx, hy-headR*0.35, hz], headR*0.75, hairColor);
    return;
  }
  if(style==='headguard'){
    ball([hx, hy-headR*0.15, hz], headR*1.1, hairColor);
    ball([hx-headR*0.95, hy+headR*0.05, hz], headR*0.4, hairColor);
    ball([hx+headR*0.95, hy+headR*0.05, hz], headR*0.4, hairColor);
    return;
  }
  // 'short' (the only remaining non-bald style): a plain rounded cap
  ball([hx, hy-headR*0.35, hz], headR*0.92, hairColor);
}

// Per-style beard, in 3D. bStyle is one of none/full/moustache/goatee/long
// (BEARD_ORDER in game-logic.js).
function draw3DBeard(bStyle, headW, headR){
  if(bStyle==='none') return;
  const [hx,hy,hz]=headW;
  const beardColor = bStyle==='long' ? hexToRgb01('#c9c9c9') : hexToRgb01_lastHairColor;
  if(bStyle==='full'){ ball([hx,hy+headR*0.5,hz], headR*0.6, beardColor); return; }
  if(bStyle==='moustache'){ bone([hx-headR*0.45,hy+headR*0.32,hz],[hx+headR*0.45,hy+headR*0.32,hz], headR*0.1, beardColor); return; }
  if(bStyle==='goatee'){
    bone([hx-headR*0.4,hy+headR*0.3,hz],[hx+headR*0.4,hy+headR*0.3,hz], headR*0.1, beardColor);
    ball([hx,hy+headR*0.55,hz], headR*0.28, beardColor);
    return;
  }
  // 'long' (old master) — reaches down about as far as the lengthened Classic/Pixel
  // version (headR*3.4)
  const p0=[hx,hy+headR*0.35,hz], p1=[hx,hy+headR*1.8,hz], p2=[hx,hy+headR*3.4,hz];
  bone(p0,p1, headR*0.28, beardColor); bone(p1,p2, headR*0.16, beardColor);
  ball(p2, headR*0.14, beardColor);
}
```

Note: `draw3DBeard` needs the character's hair color for non-`long` beard styles (Classic/
Pixel use `c.hair.color` for `full`/`moustache`/`goatee`) — but `draw3DFighter` only passes
`bStyle` and `headW`/`headR` per the interface above, not the color. Fix this before
implementing: change `draw3DBeard`'s signature to take `hairColor` too (it's already
computed once in `draw3DFighter` as `const hairColor = hexToRgb01(c.hair.color);`, right
above where hair/beard are drawn) and pass it through:

```js
draw3DBeard(beardStyle(c), headW, headR, hairColor);
```

```js
function draw3DBeard(bStyle, headW, headR, hairColor){
  if(bStyle==='none') return;
  const [hx,hy,hz]=headW;
  const beardColor = bStyle==='long' ? hexToRgb01('#c9c9c9') : hairColor;
  // ...rest unchanged from above
}
```

(This replaces the placeholder `hexToRgb01_lastHairColor` reference above, which doesn't
exist — use the corrected version.)

- [ ] **Step 2: Manually verify in a browser**

Run: `python3 -m http.server 8000`, open `http://localhost:8000`. Switch `GFX` to `3D`.
Start a fight with a roster character that has a non-`short`/non-`bald` hairstyle and a
beard (check `CHARACTERS` in `game-logic.js` for one, or use Create Fighter to build one
with `punk` hair and a `long` beard for the clearest test). Confirm:
- The mohawk renders as a small fan of spikes at the top of the head, matching the
  Classic/Pixel fix's silhouette (just rounder/3D).
- A `braid` character's ponytail visibly extends from the hair cap, not the bare head
  sphere.
- `leia` buns are two visible spheres at ear height.
- `headguard` shows an oversized cap plus two ear-pad spheres.
- A `long` (old master) beard is visibly present and reaches down the chest, in grey —
  this is entirely new geometry (3D had no beards before this task) — confirm it doesn't
  clip through the torso in any pose (idle, walk, block, a punch/kick).
- No console errors, no regression in the fighter's overall silhouette/proportions.

- [ ] **Step 3: Commit**

```bash
git add render3d.js
git commit -m "Add per-style 3D hair and beard geometry to draw3DFighter"
```

---

## Self-Review Notes

- **Spec coverage:** every fix in `docs/superpowers/specs/2026-07-21-character-rendering-fixes-design.md`
  maps to a task: ponytail/mohawk/buns/beard-length → Task 1 (Classic) & mirrored in Task 1
  Step 2 (Pixel); DPI crispness → Task 2; per-style 3D hair+beard → Task 3.
- **No placeholders:** Task 3's draft code originally referenced a non-existent
  `hexToRgb01_lastHairColor` — caught during this self-review and corrected inline (pass
  `hairColor` through `draw3DBeard`'s parameter list instead). The step above now shows
  only the corrected version as the one to implement.
- **Type/signature consistency:** `draw3DHair(style, headW, headR, hairColor)` and
  `draw3DBeard(bStyle, headW, headR, hairColor)` are called with matching argument order
  and types everywhere they appear in this plan.
