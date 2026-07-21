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

### Task 4: Eyewear/accessories data model, validation, i18n, and Create Fighter UI

**Files:**
- Modify: `game-logic.js` (new `GLASSES_ORDER`/`TINT_ORDER` consts near `HAIR_ORDER`/
  `BEARD_ORDER`; `normalizeCharacter`'s return object; `I18N` table; `exportsObj`)
- Modify: `game-logic.test.js` (new validation tests)
- Modify: `index.html` (`newDraft()`, `randomizeDraft()`, `drawCreate()`)

**Interfaces:**
- Produces: `GLASSES_ORDER = ['none','sensei','dark','potter','monocle']`,
  `TINT_ORDER = ['black','brown','pink']` (exported globals, consumed by Tasks 5-6's
  rendering code and by Create Fighter's cycle buttons).
- Every character object (built-in or custom) gains `glasses` (string, one of
  `GLASSES_ORDER`) and `glassesTint` (string, one of `TINT_ORDER`) fields, defaulting to
  `'none'`/`'black'`.

- [ ] **Step 1: Write the failing tests**

Add to `game-logic.test.js` (find the existing `normalizeCharacter` test block and add
these alongside it):

```js
test('GLASSES_ORDER/TINT_ORDER: non-empty and include the expected values', () => {
  assert.deepEqual(GLASSES_ORDER, ['none','sensei','dark','potter','monocle']);
  assert.deepEqual(TINT_ORDER, ['black','brown','pink']);
});
test('normalizeCharacter: clamps out-of-range glasses/glassesTint to safe defaults', () => {
  const n1 = normalizeCharacter({id:'x', glasses:'not-a-real-type', glassesTint:'neon'});
  assert.equal(n1.glasses, 'none');
  assert.equal(n1.glassesTint, 'black');
  const n2 = normalizeCharacter({id:'y', glasses:'potter', glassesTint:'pink'});
  assert.equal(n2.glasses, 'potter');
  assert.equal(n2.glassesTint, 'pink');
});
```

This needs `GLASSES_ORDER, TINT_ORDER` added to the test file's existing `require`
destructure. In `game-logic.test.js`, modify:

```js
  HAIR_ORDER, BEARD_ORDER, SPECIAL_TYPE_IDS, normalizeCharacter,
```

to:

```js
  HAIR_ORDER, BEARD_ORDER, GLASSES_ORDER, TINT_ORDER, SPECIAL_TYPE_IDS, normalizeCharacter,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `GLASSES_ORDER is not defined` (or similar; the two new consts and the
`normalizeCharacter` fields don't exist yet).

- [ ] **Step 3: Implement in `game-logic.js`**

Add right after the existing `const BEARD_ORDER = ['none','full','moustache','goatee','long'];`
line:

```js
const GLASSES_ORDER = ['none','sensei','dark','potter','monocle'];
const TINT_ORDER = ['black','brown','pink'];
```

In `normalizeCharacter`'s return object, add these two lines right after the existing
`beard:` line:

```js
    glasses: GLASSES_ORDER.includes(raw.glasses) ? raw.glasses : 'none',
    glassesTint: TINT_ORDER.includes(raw.glassesTint) ? raw.glassesTint : 'black',
```

In the `I18N` table, add these rows right after the existing `beardLong:` row:

```js
  glassesCaption:{en:'GLASSES',de:'BRILLE',es:'GAFAS',it:'OCCHIALI',fr:'LUNETTES',hu:'SZEMÜVEG'},
  tintCaption:{en:'TINT',de:'TÖNUNG',es:'TONO',it:'TONALITÀ',fr:'TEINTE',hu:'SZÍNEZET'},
  glassesNone:{en:'NONE',de:'KEIN',es:'NINGUNAS',it:'NESSUNI',fr:'AUCUNES',hu:'NINCS'},
  glassesSensei:{en:"SENSEI'S SHADES",de:'SENSEI-BRILLE',es:'GAFAS DEL SENSEI',it:'OCCHIALI DEL SENSEI',fr:'LUNETTES DU SENSEI',hu:'SZENSZEI NAPSZEMÜVEGE'},
  glassesDark:{en:'DARK SHADES',de:'DUNKLE BRILLE',es:'GAFAS OSCURAS',it:'OCCHIALI SCURI',fr:'LUNETTES FONCÉES',hu:'SÖTÉT SZEMÜVEG'},
  glassesPotter:{en:'ROUND GLASSES',de:'RUNDE BRILLE',es:'GAFAS REDONDAS',it:'OCCHIALI TONDI',fr:'LUNETTES RONDES',hu:'KEREK SZEMÜVEG'},
  glassesMonocle:{en:'MONOCLE',de:'MONOKEL',es:'MONÓCULO',it:'MONOCOLO',fr:'MONOCLE',hu:'MONOKLI'},
  tintBlack:{en:'BLACK',de:'SCHWARZ',es:'NEGRO',it:'NERO',fr:'NOIR',hu:'FEKETE'},
  tintBrown:{en:'BROWN',de:'BRAUN',es:'MARRÓN',it:'MARRONE',fr:'MARRON',hu:'BARNA'},
  tintPink:{en:'PINK',de:'PINK',es:'ROSA',it:'ROSA',fr:'ROSE',hu:'RÓZSASZÍN'},
```

In `exportsObj`, add `GLASSES_ORDER, TINT_ORDER` to the existing
`HAIR_ORDER, BEARD_ORDER, SPECIAL_TYPE_IDS, normalizeCharacter,` line, making it:

```js
  HAIR_ORDER, BEARD_ORDER, GLASSES_ORDER, TINT_ORDER, SPECIAL_TYPE_IDS, normalizeCharacter,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all tests, including the 2 new ones).

- [ ] **Step 5: Add the Create Fighter UI**

In `index.html`, modify `newDraft()` — add two fields to the returned object, right after
the existing `gi:SPANDEX_COLORS[0],` line:

```js
  gi:SPANDEX_COLORS[0],
  glasses:'none', glassesTint:'black',
```

Modify `randomizeDraft()` — add right after the existing
`draft.beard=Math.random()<0.55?'none':pick(['full','moustache','goatee','long']);` line:

```js
  draft.glasses=Math.random()<0.6?'none':pick(['sensei','dark','potter','monocle']);
  draft.glassesTint=pick(TINT_ORDER);
```

Modify `drawCreate()` — add right after the existing line that draws the outfit/hair/
beard button row (the line starting `btn(276,214,84,30,t(lang,BEARD_LABELS[...`):

```js
  const GLASSES_LABELS={none:'glassesNone',sensei:'glassesSensei',dark:'glassesDark',potter:'glassesPotter',monocle:'glassesMonocle'};
  const TINT_LABELS={black:'tintBlack',brown:'tintBrown',pink:'tintPink'};
  ctx.fillStyle='#8a7d5c'; ctx.font='11px "Trebuchet MS"';
  ctx.fillText(t(lang,'glassesCaption'),60,320);
  if(draft.glasses==='dark') ctx.fillText(t(lang,'tintCaption'),180,320);
  btn(60,326,110,30,t(lang,GLASSES_LABELS[draft.glasses||'none']),()=>{ draft.glasses=GLASSES_ORDER[(GLASSES_ORDER.indexOf(draft.glasses||'none')+1)%GLASSES_ORDER.length]; },draft.glasses&&draft.glasses!=='none');
  if(draft.glasses==='dark'){
    btn(180,326,110,30,t(lang,TINT_LABELS[draft.glassesTint||'black']),()=>{ draft.glassesTint=TINT_ORDER[(TINT_ORDER.indexOf(draft.glassesTint||'black')+1)%TINT_ORDER.length]; },false);
  }
```

- [ ] **Step 6: Manually verify in a browser**

Run: `python3 -m http.server 8000`, open `http://localhost:8000`, go to **Create Fighter**.
Click the new glasses button — confirm it cycles `none → sensei's shades → dark shades →
round glasses → monocle → none` and a second "tint" button appears only while `dark` is
selected, itself cycling black/brown/pink. Click **🎲 Randomize** a few times — confirm
`glasses`/`glassesTint` vary. (The live preview won't show the new shapes yet — that's
Task 5 — just confirm the buttons/state/labels work.)

- [ ] **Step 7: Commit**

```bash
git add game-logic.js game-logic.test.js index.html
git commit -m "Add glasses/accessories data model, validation, i18n, and Create Fighter UI"
```

---

### Task 5: Glasses/accessories rendering — Classic & Pixel

**Files:**
- Modify: `index.html` (`drawFighterClassic`, right after the beard block; `drawFighterPixel`,
  right after its beard block)

**Interfaces:**
- Consumes: `c.glasses`, `c.glassesTint` (Task 4), `head`, `headR` (already parameters of
  both functions).

- [ ] **Step 1: Add glasses drawing to `drawFighterClassic`**

In `index.html`, add immediately after the beard `if/else if` chain's closing line (the
`else if(bStyle==='long'){...}` line) and before the function's closing `}`:

```js
  // glasses (independent of hair/beard — a character can have any combination)
  const glassesType = c.glasses || 'none';
  if(glassesType==='monocle'){
    ctx.fillStyle='rgba(80,40,70,.55)'; ctx.beginPath(); ctx.ellipse(head[0]-headR*0.42,head[1]-headR*0.05,headR*0.32,headR*0.24,0,0,7); ctx.fill();
  } else if(glassesType!=='none'){
    const ey=head[1]-headR*0.05, lx=head[0]-headR*0.42, rx=head[0]+headR*0.42, lw=headR*0.32, lh=headR*0.24;
    if(glassesType==='potter'){
      ctx.strokeStyle='#1a1a1a'; ctx.lineWidth=2.5;
      [lx,rx].forEach(cx=>{ ctx.beginPath(); ctx.arc(cx,ey,lw*0.75,0,7); ctx.stroke(); });
      ctx.beginPath(); ctx.moveTo(lx+lw*0.75,ey); ctx.lineTo(rx-lw*0.75,ey); ctx.stroke();
    } else {
      const tint = glassesType==='sensei' ? 'rgba(230,140,40,.7)' : {black:'rgba(20,20,20,.75)',brown:'rgba(90,55,30,.75)',pink:'rgba(230,140,170,.65)'}[c.glassesTint||'black'];
      ctx.fillStyle=tint;
      ctx.beginPath(); ctx.ellipse(lx,ey,lw,lh,0,0,7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(rx,ey,lw,lh,0,0,7); ctx.fill();
      ctx.strokeStyle='#1a1a1a'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.ellipse(lx,ey,lw,lh,0,0,7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(rx,ey,lw,lh,0,0,7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx+lw,ey); ctx.lineTo(rx-lw,ey); ctx.stroke();
    }
  }
```

- [ ] **Step 2: Add glasses drawing to `drawFighterPixel`**

In `index.html`, add immediately after `drawFighterPixel`'s beard `if/else if` chain's
closing line and before the "composite" comment:

```js
  // glasses (same shapes as Classic, drawn through the blocky toolkit)
  const glassesType = c.glasses || 'none';
  if(glassesType==='monocle'){
    drawBlockyCircleFlat(head[0]-headR*0.42, head[1]-headR*0.05, headR*0.3, 'rgba(80,40,70,.6)', -headR*0.3, headR*0.3, bctx);
  } else if(glassesType!=='none'){
    const ey=head[1]-headR*0.05, lx=head[0]-headR*0.42, rx=head[0]+headR*0.42, lr=headR*0.28;
    if(glassesType==='potter'){
      bctx.strokeStyle='#1a1a1a'; bctx.lineWidth=2.5; bctx.lineCap='butt';
      [lx,rx].forEach(cx=>{ bctx.beginPath(); bctx.arc(snap(cx),snap(ey),lr,0,7); bctx.stroke(); });
      bctx.beginPath(); bctx.moveTo(snap(lx+lr),snap(ey)); bctx.lineTo(snap(rx-lr),snap(ey)); bctx.stroke();
    } else {
      const tint = glassesType==='sensei' ? 'rgba(230,140,40,.7)' : {black:'rgba(20,20,20,.75)',brown:'rgba(90,55,30,.75)',pink:'rgba(230,140,170,.65)'}[c.glassesTint||'black'];
      drawBlockyCircleFlat(lx,ey,lr,tint,-lr,lr,bctx); drawBlockyCircleFlat(rx,ey,lr,tint,-lr,lr,bctx);
      drawBlockyLimb([lx+lr,ey],[rx-lr,ey],3,'#1a1a1a',bctx);
    }
  }
```

- [ ] **Step 3: Manually verify in a browser**

Reload, go to **Create Fighter**, cycle the glasses button through all 5 values and
confirm the live preview (Classic rendering) shows: nothing for `none`; orange aviators
for `sensei`; tinted aviators (cycle the tint button too — black/brown/pink) for `dark`;
two thin unfilled circles for `potter` ("Round Glasses"); a dark bruise over one eye for
`monocle`. Switch `GFX` to `PIXEL` and confirm the same 5 states in the character-select
grid, blockier but matching.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add glasses/accessories rendering to Classic and Pixel modes"
```

---

### Task 6: Glasses/accessories rendering — 3D

**Files:**
- Modify: `render3d.js` (`draw3DFighter`, add a call after `draw3DBeard(...)`; add a new
  `draw3DGlasses` function)

**Interfaces:**
- Consumes: `boxScaleMatrix`, `draw3D`, `bone` (existing), `c.glasses`, `c.glassesTint`
  (Task 4), `skin` (already computed in `draw3DFighter` as `hexToRgb01(c.skin)`).

- [ ] **Step 1: Add the call site in `draw3DFighter`**

In `render3d.js`, modify:

```js
  ball(headW, headR, skin);
  draw3DHair(c.hair.style, headW, headR, hairColor);
  draw3DBeard(beardStyle(c), headW, headR, hairColor);
}
```

to:

```js
  ball(headW, headR, skin);
  draw3DHair(c.hair.style, headW, headR, hairColor);
  draw3DBeard(beardStyle(c), headW, headR, hairColor);
  draw3DGlasses(c.glasses, c.glassesTint, headW, headR, skin);
}
```

- [ ] **Step 2: Add `draw3DGlasses`**

In `render3d.js`, add this function right after `draw3DBeard`:

```js
// Per-style eyewear, in 3D. gType is one of none/sensei/dark/potter/monocle
// (GLASSES_ORDER in game-logic.js). Every lens/bruise is the existing sphere mesh
// flattened thin along Z via boxScaleMatrix's independent x/y/z scale — no new mesh.
// ponytail: a flattened sphere's lighting normal is only exact where its scale is
// uniform (the rim), not on the flattened front face — a cosmetically-irrelevant
// inaccuracy on an accessory this small, not worth a dedicated normal matrix for.
function draw3DGlasses(gType, gTint, headW, headR, skinColor){
  if(!gType || gType==='none') return;
  const [hx,hy,hz]=headW, ey=hy-headR*0.05, lx=hx-headR*0.42, rx=hx+headR*0.42, front=hz-headR*0.55;
  if(gType==='monocle'){
    draw3D('sphere', boxScaleMatrix(lx,ey,front, headR*0.3,headR*0.24,headR*0.12), 0.31,0.16,0.27);
    return;
  }
  if(gType==='potter'){
    const rimColor=[0.1,0.1,0.1];
    [lx,rx].forEach(cx=>{
      draw3D('sphere', boxScaleMatrix(cx,ey,front, headR*0.3,headR*0.3,headR*0.08), rimColor[0],rimColor[1],rimColor[2]);
      draw3D('sphere', boxScaleMatrix(cx,ey,front-headR*0.02, headR*0.24,headR*0.24,headR*0.08), skinColor[0],skinColor[1],skinColor[2]);
    });
    bone([lx+headR*0.3,ey,front],[rx-headR*0.3,ey,front], headR*0.05, rimColor);
    return;
  }
  // sensei / dark
  const tint = gType==='sensei' ? [0.85,0.5,0.15] : {black:[0.08,0.08,0.08],brown:[0.35,0.2,0.1],pink:[0.85,0.5,0.6]}[gTint||'black'];
  [lx,rx].forEach(cx=>{ draw3D('sphere', boxScaleMatrix(cx,ey,front, headR*0.32,headR*0.24,headR*0.1), tint[0],tint[1],tint[2]); });
  bone([lx+headR*0.32,ey,front],[rx-headR*0.32,ey,front], headR*0.05, [0.1,0.1,0.1]);
}
```

- [ ] **Step 3: Manually verify in a browser**

Reload, switch `GFX` to `3D`. Use Create Fighter to build a fighter with each glasses
type in turn (or edit a saved one), then start a 1-Player fight against them. Confirm:
each type is visibly distinct (aviators/round-rimmed/bruise), sits at a consistent eye
level across idle/walk/punch/kick poses, and doesn't clip badly through the head sphere.
No console errors.

- [ ] **Step 4: Commit**

```bash
git add render3d.js
git commit -m "Add glasses/accessories rendering to 3D mode"
```

---

### Task 7: Sensei Rob visual update

**Files:**
- Modify: `game-logic.js` (Sensei Rob's `CHARACTERS` entry)

**Interfaces:** None — pure data change to one existing built-in character entry.

- [ ] **Step 1: Update Sensei Rob's entry**

In `game-logic.js`, modify:

```js
  { id:'rob', name:'Sensei Rob', beltRank:'dan1', outfit:'gi',
    build:{scale:1.02,girth:1.0}, skin:'#e8b98f', hair:{color:'#3a2a1a',style:'short'}, beard:false,
    stats:{maxHp:110,speed:1.05,power:1.05,defense:1.08},
    special:{name:'Renraku', type:'combo'} },
```

to:

```js
  { id:'rob', name:'Sensei Rob', beltRank:'dan1', outfit:'gi',
    build:{scale:1.02,girth:1.0}, skin:'#e8b98f', hair:{color:'#8a6d4a',style:'short'}, beard:false,
    glasses:'sensei',
    stats:{maxHp:110,speed:1.05,power:1.05,defense:1.08},
    special:{name:'Renraku', type:'combo'} },
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — the existing `CHARACTERS: five built-ins, unique ids, valid belt/
outfit/stats/special` test doesn't assert specific hair colors, so this data-only change
shouldn't break it; confirm that's actually true by reading the test, not just assuming.

- [ ] **Step 3: Manually verify in a browser, across all 3 modes**

Run: `python3 -m http.server 8000`, open `http://localhost:8000`. Go to character select
— Sensei Rob's portrait (Classic rendering) should show lighter hair and orange aviator
sunglasses. Switch `GFX` to `PIXEL` and check the same portrait. Switch `GFX` to `3D`,
start a fight as or against Sensei Rob, and confirm the same look renders in 3D (lighter
hair-colored cap, orange lens spheres at eye level).

- [ ] **Step 4: Commit**

```bash
git add game-logic.js
git commit -m "Update Sensei Rob's hair color and add his signature sunglasses"
```

---

## Self-Review Notes

- **Spec coverage:** every fix/feature in
  `docs/superpowers/specs/2026-07-21-character-rendering-fixes-design.md` maps to a task:
  ponytail/mohawk/buns/beard-length → Task 1 (Classic) & mirrored in Task 1 Step 2
  (Pixel); DPI crispness → Task 2; per-style 3D hair+beard → Task 3; eyewear data
  model/validation/i18n/UI → Task 4; eyewear rendering (Classic/Pixel) → Task 5; eyewear
  rendering (3D) → Task 6; Sensei Rob's visual update → Task 7.
- **No placeholders:** Task 3's draft code originally referenced a non-existent
  `hexToRgb01_lastHairColor` — caught during this self-review and corrected inline (pass
  `hairColor` through `draw3DBeard`'s parameter list instead). The step above now shows
  only the corrected version as the one to implement. Task 4's test-file import step
  originally described the required change in prose instead of showing the exact
  before/after — also caught and corrected to a concrete diff.
- **Type/signature consistency:** `draw3DHair(style, headW, headR, hairColor)`,
  `draw3DBeard(bStyle, headW, headR, hairColor)`, and `draw3DGlasses(gType, gTint, headW,
  headR, skinColor)` are called with matching argument order and types everywhere they
  appear in this plan (Task 6's call site matches Task 3's `draw3DBeard` signature after
  its own self-review fix, plus the new `draw3DGlasses` call).
- **Task ordering matters here, unlike Tasks 1-3:** Tasks 5 and 6 insert code relative to
  anchors (the beard block's end, the `draw3DBeard(...)` call line) that only exist in
  their final form *after* Tasks 1 and 3 respectively have already been applied — this is
  intentional (these tasks are insertions after already-established code, not standalone
  replacements) and relies on executing this plan's tasks in numeric order, not in
  parallel or out of sequence.
- **Scope confirmed with the user before writing:** the eyewear/accessories system (Tasks
  4-7) was an addition requested mid-session, presented back as a design summary and
  confirmed before being added to the spec and this plan — it did not go through a full
  separate brainstorming round-trip given how specific the original request already was,
  but every concrete decision (data model, "eye level" convention, the "Round Glasses"
  naming choice, Sensei Rob's exact color) was surfaced and confirmed first.
