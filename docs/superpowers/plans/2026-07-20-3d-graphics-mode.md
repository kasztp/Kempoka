# GFX: 3D Graphics Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `GFX: 3D` rendering mode to Kempoka — procedurally generated, lit
WebGL geometry for fighters and stages, driven by the exact same pose skeleton Classic/
Pixel already use — plus a fight-only Performance/Eye Candy quality toggle for phones and
slower machines.

**Architecture:** A second canvas (`cv3d`) stacked behind the existing 2D canvas gets a
raw WebGL context (no libraries). One shader (ambient + one directional light, banded/
toon shading, linear distance fog) draws everything using two procedurally-generated
meshes (a sphere and a cylinder) plus two flat quads (floor, wall/backdrop). Fighters are
built by placing spheres at every joint `poseOf()` already computes and cylinders between
them; stage scenes place a handful of the same primitives per stage. The camera is a
fixed frontal orthographic projection matching today's exact 960×540 framing — no camera
movement, no perspective, so HUD alignment and hit-testing never change.

**Tech Stack:** Vanilla JS, raw WebGL1/2 (`canvas.getContext('webgl2')||getContext('webgl')`),
GLSL ES 1.00 shaders as inline strings. No new npm packages, no build step, no bundler —
consistent with the rest of the project (`package.json` has zero dependencies today).

## Global Constraints

- Zero new dependencies (no three.js, no gl-matrix, no npm packages) — raw WebGL only,
  per the project's existing "no dependencies, no build step" ethos (README, package.json).
- No build step — every new file is a plain `<script src>` loaded directly by `index.html`,
  same as `game-logic.js` today.
- `game-logic.js` stays DOM-free and `require()`-able from Node (existing convention) —
  any new pure/testable code (`render3d.js`) follows the exact same dual-environment
  export pattern already used there.
- Unit tests run via `npm test` → `node --test`, which auto-discovers `*.test.js` files
  in the repo — no config changes needed to pick up a new test file.
- 6 supported UI languages: `en, de, es, it, fr, hu` (`SUPPORTED_LANGS` in `game-logic.js`)
  — every new user-facing string needs all 6.
- World coordinates: `W=960, H=540, GROUND=476` (fixed logical canvas size, defined in
  `index.html`). All new code must treat these as constants, not derive them at runtime.
- Camera is fixed and frontal — no perspective projection, no camera movement. Depth is
  used only for occlusion ordering, limb roundness, and distance fog — never for
  perspective foreshortening. This keeps every fighter's on-screen X/Y pixel-identical to
  Classic/Pixel mode, so no HUD, hit-testing, or touch-control code changes are needed
  anywhere in this plan.
- 3D rendering must never break Classic/Pixel: if WebGL context creation fails, `3D` is
  simply never added to the `GFX` cycle, and nothing else changes.

---

## File Structure

- **Create:** `render3d.js` — the entire 3D renderer: pure math/mesh-generation helpers
  (Node-testable, mirrors `game-logic.js`'s dual-environment export pattern) plus the
  WebGL-dependent parts (shader compilation, context init, per-frame drawing, the 4 stage
  scenes, the quality-preset config). One file, one responsibility: "draw the pose
  skeleton and the stages in 3D."
- **Create:** `render3d.test.js` — Node unit tests for the pure math/mesh functions,
  mirroring `game-logic.test.js`'s structure.
- **Modify:** `index.html` — add the `cv3d` canvas + CSS, load `render3d.js`, extend the
  `GFX` toggle to 3 states, wire the `drawFighter()`/`bg()` dispatch, add the quality
  toggle button, extend the `?test=1` self-check.
- **Modify:** `game-logic.js` — one new `I18N` key (`'3d'`) for the button label.
- **Modify:** `README.md` — document the new mode, mirroring the existing "Graphics
  style — Classic / HD Pixel toggle" section.

---

### Task 1: Pure 3D math & mesh foundations

**Files:**
- Create: `render3d.js`
- Create: `render3d.test.js`

**Interfaces:**
- Produces: `mat4Identity()`, `mat4Multiply(a,b)`, `mat4Ortho(left,right,bottom,top,zNear,zFar)`,
  `normalize3(x,y,z) -> [x,y,z]`, `hexToRgb01(hex) -> [r,g,b]` (0..1 floats),
  `buildSphere(segments) -> {verts:Float32Array, norms:Float32Array, idx:Uint16Array}`,
  `buildCylinder(segments) -> {verts,norms,idx}`, `buildQuadFloor() -> {verts,norms,idx}`,
  `buildQuadWall() -> {verts,norms,idx}`, `pointMatrix(x,y,z,radius) -> Float32Array(16)`,
  `boneMatrix(ax,ay,az,bx,by,bz,radius) -> Float32Array(16)`,
  `boxScaleMatrix(x,y,z,sx,sy,sz) -> Float32Array(16)`.
  All exported both as Node `module.exports` and as globals, exactly like `game-logic.js`.

- [ ] **Step 1: Write the failing tests**

Create `render3d.test.js`:

```js
// Unit tests for render3d.js's pure math/mesh-generation functions (the WebGL-free half —
// mirrors game-logic.test.js). Run with: node --test
"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mat4Identity, mat4Multiply, mat4Ortho, normalize3, hexToRgb01,
  buildSphere, buildCylinder, buildQuadFloor, buildQuadWall,
  pointMatrix, boneMatrix, boxScaleMatrix,
} = require('./render3d.js');

test('mat4Identity: multiplying by identity is a no-op', () => {
  const m = new Float32Array([1,2,3,4, 5,6,7,8, 9,10,11,12, 13,14,15,16]);
  const r = mat4Multiply(m, mat4Identity());
  for (let i=0;i<16;i++) assert.ok(Math.abs(r[i]-m[i])<1e-6, `index ${i}`);
});

test('mat4Ortho: near plane maps to clip z=-1, far plane to clip z=+1', () => {
  const m = mat4Ortho(0,960,540,0,-80,500);
  const clipZ = (wz)=> m[2]*0 + m[6]*0 + m[10]*wz + m[14];
  assert.ok(Math.abs(clipZ(-80) - -1) < 1e-6, 'near should map to -1');
  assert.ok(Math.abs(clipZ(500) - 1) < 1e-6, 'far should map to 1');
});

test('mat4Ortho: left/top map to clip -1/+1 for x, top/bottom map to +1/-1 for y (canvas y-flip)', () => {
  const m = mat4Ortho(0,960,540,0,-80,500);
  const clipX = (wx)=> m[0]*wx + m[12];
  const clipY = (wy)=> m[5]*wy + m[13];
  assert.ok(Math.abs(clipX(0) - -1) < 1e-6, 'left edge -> -1');
  assert.ok(Math.abs(clipX(960) - 1) < 1e-6, 'right edge -> 1');
  assert.ok(Math.abs(clipY(0) - 1) < 1e-6, 'world y=0 (screen top) -> clip +1');
  assert.ok(Math.abs(clipY(540) - -1) < 1e-6, 'world y=540 (screen bottom) -> clip -1');
});

test('normalize3: returns a unit vector in the same direction', () => {
  const [x,y,z] = normalize3(3,4,0);
  assert.ok(Math.abs(Math.hypot(x,y,z)-1) < 1e-6);
  assert.ok(Math.abs(x-0.6)<1e-6 && Math.abs(y-0.8)<1e-6 && z===0);
});

test('hexToRgb01: converts a hex color to 0..1 floats', () => {
  assert.deepEqual(hexToRgb01('#ff0080'), [1, 0, 128/255]);
});

test('buildSphere: vertex/index counts match the parametric grid', () => {
  const s = buildSphere(6);
  assert.equal(s.verts.length, (6+1)*(12+1)*3);
  assert.equal(s.idx.length, 6*12*6);
  const s2 = buildSphere(12);
  assert.equal(s2.verts.length, (12+1)*(24+1)*3);
});

test('buildCylinder: vertex/index counts match the ring grid', () => {
  const c = buildCylinder(6);
  assert.equal(c.verts.length, (6+1)*2*3);
  assert.equal(c.idx.length, 6*6);
});

test('buildQuadFloor/buildQuadWall: 4 verts, 2 triangles, correct normals', () => {
  const f = buildQuadFloor(), w = buildQuadWall();
  assert.equal(f.verts.length, 12); assert.equal(f.idx.length, 6);
  for(let i=0;i<4;i++) assert.deepEqual([f.norms[i*3],f.norms[i*3+1],f.norms[i*3+2]], [0,1,0]);
  for(let i=0;i<4;i++) assert.deepEqual([w.norms[i*3],w.norms[i*3+1],w.norms[i*3+2]], [0,0,1]);
});

test('pointMatrix: places a unit-sphere point and its normal correctly', () => {
  const m = pointMatrix(5,5,5,3);
  // local surface point (1,0,0) * model -> world position
  const wx = m[0]*1 + m[12], wy = m[1]*1 + m[13], wz = m[2]*1 + m[14];
  assert.ok(Math.abs(wx-8)<1e-6 && Math.abs(wy-5)<1e-6 && Math.abs(wz-5)<1e-6);
  // local normal (1,0,0) (w=0, no translation) -> normalized world normal
  const [nx,ny,nz] = normalize3(m[0]*1, m[1]*1, m[2]*1);
  assert.ok(Math.abs(nx-1)<1e-6 && Math.abs(ny)<1e-6 && Math.abs(nz)<1e-6);
});

test('boneMatrix: transforms a side normal exactly (no inverse-transpose needed)', () => {
  // straight vertical bone from (0,0,0) to (0,10,0), radius 2
  const m = boneMatrix(0,0,0, 0,10,0, 2);
  // local side normal (1,0,0) (w=0)
  const [nx,ny,nz] = normalize3(m[0]*1, m[1]*1, m[2]*1);
  assert.ok(Math.abs(nx- -1)<1e-6 && Math.abs(ny)<1e-6 && Math.abs(nz)<1e-6);
});

test('boxScaleMatrix: scales and translates a unit box', () => {
  const m = boxScaleMatrix(10,20,30, 2,3,4);
  const wx = m[0]*1 + m[12], wy = m[5]*1 + m[13], wz = m[10]*1 + m[14];
  assert.ok(Math.abs(wx-12)<1e-6 && Math.abs(wy-23)<1e-6 && Math.abs(wz-34)<1e-6);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './render3d.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `render3d.js`'s math/mesh section**

Create `render3d.js` with this content (WebGL-dependent parts are added in later tasks —
this step only adds the pure functions, so the file is valid but does nothing visible yet):

```js
// render3d.js — GFX: 3D renderer. Raw WebGL, no libraries, no textures. Draws the exact
// same joint skeleton poseOf() already computes for Classic/Pixel (index.html) as lit,
// procedurally-generated 3D geometry (spheres + cylinders for fighters, spheres/
// cylinders/quads for stage props). Loaded as a classic <script> by index.html (exposes
// globals) AND require()'d directly by the Node unit tests, same dual-environment split
// as game-logic.js — this section has zero DOM/WebGL dependencies, which is what makes
// it testable without a browser. WebGL-specific code (context init, drawing, stages)
// lives further down in this same file and is simply never exercised by the Node tests.
"use strict";
(function(root){

const R3D_W = 960, R3D_H = 540, R3D_GROUND = 476;   // must match W/H/GROUND in index.html

// ---------- small vector/matrix helpers (column-major, WebGL convention) ------------
function normalize3(x,y,z){ const l=Math.hypot(x,y,z)||1; return [x/l,y/l,z/l]; }

function mat4Identity(){ return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }

function mat4Multiply(a,b){   // returns a*b
  const o = new Float32Array(16);
  for(let c=0;c<4;c++) for(let r=0;r<4;r++){
    let sum=0; for(let k=0;k<4;k++) sum += a[k*4+r]*b[c*4+k];
    o[c*4+r]=sum;
  }
  return o;
}

// Linear remap of world-space X/Y/Z directly to clip space — NOT the textbook glOrtho
// formula (that one assumes an eye-space camera looking down -Z, which would flip the
// sign of the z terms here). We treat world Z as the depth axis directly: near -> -1,
// far -> +1. Passing top=0,bottom=R3D_H deliberately flips Y to match canvas convention
// (world y=0 is the screen's top).
function mat4Ortho(left,right,bottom,top,zNear,zFar){
  const w=right-left, h=top-bottom, d=zFar-zNear;
  return new Float32Array([
    2/w, 0, 0, 0,
    0, 2/h, 0, 0,
    0, 0, 2/d, 0,
    -(right+left)/w, -(top+bottom)/h, -(zFar+zNear)/d, 1,
  ]);
}

function hexToRgb01(hex){
  const n = parseInt(hex.slice(1),16);
  return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255];
}

// ---------- procedural meshes (generated once, no model files) ---------------------
// Unit sphere, radius 1, centered on the origin. `segments` controls both rings and
// sectors (sectors = segments*2 for round proportions).
function buildSphere(segments){
  const rings=segments, sectors=segments*2;
  const verts=[], norms=[], idx=[];
  for(let r=0;r<=rings;r++){
    const phi = Math.PI*r/rings - Math.PI/2;   // -PI/2 .. PI/2
    const y = Math.sin(phi), rad = Math.cos(phi);
    for(let s=0;s<=sectors;s++){
      const theta = 2*Math.PI*s/sectors;
      const x = rad*Math.cos(theta), z = rad*Math.sin(theta);
      verts.push(x,y,z); norms.push(x,y,z);
    }
  }
  for(let r=0;r<rings;r++){
    for(let s=0;s<sectors;s++){
      const a=r*(sectors+1)+s, b=a+sectors+1;
      idx.push(a,b,a+1,  a+1,b,b+1);
    }
  }
  return {verts:new Float32Array(verts), norms:new Float32Array(norms), idx:new Uint16Array(idx)};
}

// Unit cylinder side wall only (no end caps — every bone's ends are always covered by a
// sphere joint, so caps would never be visible). Radius 1 in X/Z, from y=0 to y=1.
function buildCylinder(segments){
  const verts=[], norms=[], idx=[];
  for(let s=0;s<=segments;s++){
    const theta = 2*Math.PI*s/segments, x=Math.cos(theta), z=Math.sin(theta);
    verts.push(x,0,z, x,1,z);
    norms.push(x,0,z, x,0,z);
  }
  for(let s=0;s<segments;s++){
    const a=s*2, b=a+2;
    idx.push(a,a+1,b,  b,a+1,b+1);
  }
  return {verts:new Float32Array(verts), norms:new Float32Array(norms), idx:new Uint16Array(idx)};
}

// Flat quad lying in the X-Z plane (floor), normal +Y, spanning x:[-0.5,0.5] z:[-0.5,0.5] at y=0.
function buildQuadFloor(){
  return {
    verts: new Float32Array([-0.5,0,-0.5,  0.5,0,-0.5,  0.5,0,0.5,  -0.5,0,0.5]),
    norms: new Float32Array([0,1,0, 0,1,0, 0,1,0, 0,1,0]),
    idx: new Uint16Array([0,1,2, 0,2,3]),
  };
}

// Flat quad standing in the X-Y plane (backdrop/wall), normal +Z (faces the camera,
// since the camera always looks straight down the Z axis — no billboard math needed),
// spanning x:[-0.5,0.5] y:[0,1] at z=0, so placing it is a plain translate+scale.
function buildQuadWall(){
  return {
    verts: new Float32Array([-0.5,0,0,  0.5,0,0,  0.5,1,0,  -0.5,1,0]),
    norms: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]),
    idx: new Uint16Array([0,1,2, 0,2,3]),
  };
}

// ---------- placement matrices -------------------------------------------------------
// Places a unit sphere at (x,y,z) with the given radius. Uniform scale never distorts a
// normal's direction, so the vertex shader can transform normals with this same matrix
// (dropped translation via w=0) and renormalize — no inverse-transpose matrix needed.
function pointMatrix(x,y,z,radius){
  return new Float32Array([radius,0,0,0,  0,radius,0,0,  0,0,radius,0,  x,y,z,1]);
}

// Places a unit cylinder so its local Y axis (0->1) runs from point A to point B, with
// the given radius. The cylinder's side normals always have a zero Y-component and are
// scaled equally in the two axes that matter (both get `radius`), so — like pointMatrix
// above — transforming a normal by this same matrix and renormalizing is mathematically
// exact, not an approximation: no inverse-transpose matrix needed here either.
function boneMatrix(ax,ay,az, bx,by,bz, radius){
  let dx=bx-ax, dy=by-ay, dz=bz-az;
  const len = Math.hypot(dx,dy,dz) || 0.0001;
  dx/=len; dy/=len; dz/=len;
  let ux=0,uy=0,uz=1;
  if(Math.abs(dz) > 0.9){ ux=1; uy=0; uz=0; }   // avoid picking a reference parallel to d
  let rx=uy*dz-uz*dy, ry=uz*dx-ux*dz, rz=ux*dy-uy*dx;
  const rl=Math.hypot(rx,ry,rz)||0.0001; rx/=rl; ry/=rl; rz/=rl;
  const fx=dy*rz-dz*ry, fy=dz*rx-dx*rz, fz=dx*ry-dy*rx;
  return new Float32Array([
    rx*radius, ry*radius, rz*radius, 0,
    dx*len,    dy*len,    dz*len,    0,
    fx*radius, fy*radius, fz*radius, 0,
    ax, ay, az, 1,
  ]);
}

// Places/scales a quad (or any unit-box-like mesh) by independent X/Y/Z scale factors —
// used for the floor and backdrop quads, whose normals are axis-aligned with a
// zero-scale-sensitive component, so this also needs no inverse-transpose matrix.
function boxScaleMatrix(x,y,z, sx,sy,sz){
  return new Float32Array([sx,0,0,0,  0,sy,0,0,  0,0,sz,0,  x,y,z,1]);
}

const exportsObj = {
  mat4Identity, mat4Multiply, mat4Ortho, normalize3, hexToRgb01,
  buildSphere, buildCylinder, buildQuadFloor, buildQuadWall,
  pointMatrix, boneMatrix, boxScaleMatrix,
  R3D_W, R3D_H, R3D_GROUND,
};

if(typeof module!=='undefined' && module.exports){ module.exports = exportsObj; }
else { Object.assign(root, exportsObj); }

})(typeof window!=='undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all `render3d.test.js` tests, plus the existing `game-logic.test.js` tests
unaffected).

- [ ] **Step 5: Commit**

```bash
git add render3d.js render3d.test.js
git commit -m "Add render3d.js math/mesh foundations for GFX: 3D mode"
```

---

### Task 2: WebGL bootstrap, capability detection, canvas wiring

**Files:**
- Modify: `render3d.js` (append WebGL-dependent section)
- Modify: `index.html:47` (add `cv3d` canvas + CSS), and near the closing `</script>`
  where other startup code runs (around `index.html:1336-1337`)

**Interfaces:**
- Consumes: `mat4Ortho`, `R3D_W/H/GROUND` from Task 1.
- Produces: `has3DSupport() -> boolean`, `init3D(canvas) -> boolean`,
  `getQuality3D() -> 'eyecandy'|'performance'`, `setQuality3D(name)`.

- [ ] **Step 1: Add the CSS and the `cv3d` canvas element**

In `index.html`, modify the `<style>` block (right after the existing `.cornerBtn` rules,
around line 40) to stack the two canvases explicitly (z-index removes any ambiguity about
paint order between an absolutely-positioned canvas and its non-positioned sibling):

```html
  #fsBtn { right:8px; }
  #exitBtn { right:46px; font-size:17px; }
  /* GFX:3D layers a WebGL canvas behind the 2D one; explicit z-index (not DOM order)
     decides stacking, since an absolutely-positioned element paints after non-positioned
     siblings by default regardless of where it sits in the markup. */
  #cv3d { position:absolute; top:0; left:0; z-index:0; }
  #cv { position:relative; z-index:1; }
```

Modify line 47 from:
```html
<div id="wrap"><canvas id="cv" width="960" height="540"></canvas></div>
```
to:
```html
<div id="wrap"><canvas id="cv3d"></canvas><canvas id="cv" width="960" height="540"></canvas></div>
```

(`cv3d` gets no `width`/`height` attributes — `resize3D()`, added in Step 3, sets its
backing-store resolution based on the active quality preset.)

- [ ] **Step 2: Load `render3d.js`**

In `index.html`, find the `<script src="game-logic.js">` tag and add `render3d.js` right
after it (before the big inline `<script>` block):

```html
<script src="game-logic.js"></script>
<script src="render3d.js"></script>
```

- [ ] **Step 3: Append the WebGL bootstrap to `render3d.js`**

Add this after the closing `})(typeof window!=='undefined' ? window : globalThis);` line
— wait, actually insert it *before* that closing line/`exportsObj`, inside the same IIFE,
so these functions share the module's closure and can be added to `exportsObj` too:

```js
// ---------- WebGL bootstrap (browser-only; never exercised by the Node unit tests) ---
let gl=null, prog=null, meshes={};
let uModel, uProjection, uColor, uLightDir, uFogColor, uFogNear, uFogFar, aPosition, aNormal;
let projectionMatrix=null;

const QUALITY3D = {
  eyecandy:    { segments:12, dpr:(typeof window!=='undefined' ? Math.min(window.devicePixelRatio||1,2) : 1), particleScale:1 },
  performance: { segments:6,  dpr:1, particleScale:0.4 },
};
let quality3D = (typeof localStorage!=='undefined' && localStorage.kmp_quality==='performance') ? 'performance' : 'eyecandy';

function getQuality3D(){ return quality3D; }
function setQuality3D(name){
  quality3D = name;
  if(typeof localStorage!=='undefined') localStorage.kmp_quality = name;
  if(gl){ buildMeshes(QUALITY3D[quality3D].segments); resize3D(); }
}

function has3DSupport(){ return !!gl; }

const VERTEX_SRC = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uProjection;
varying vec3 vNormal;
varying float vDepth;
void main(){
  vec4 world = uModel * vec4(aPosition, 1.0);
  vNormal = normalize((uModel * vec4(aNormal, 0.0)).xyz);
  vDepth = world.z;
  gl_Position = uProjection * world;
}`;

const FRAGMENT_SRC = `
precision mediump float;
varying vec3 vNormal;
varying float vDepth;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
void main(){
  float diff = max(dot(normalize(vNormal), uLightDir), 0.0);
  float band = floor(diff * 3.0) / 3.0;
  float lit = 0.55 + band * 0.55;
  vec3 shaded = uColor * lit;
  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(shaded, uFogColor, fog), 1.0);
}`;

function compileShader(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error(gl.getShaderInfoLog(s)); return null; }
  return s;
}

function uploadMesh(data){
  const vbuf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, data.verts, gl.STATIC_DRAW);
  const nbuf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nbuf); gl.bufferData(gl.ARRAY_BUFFER, data.norms, gl.STATIC_DRAW);
  const ibuf=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.idx, gl.STATIC_DRAW);
  return {vbuf, nbuf, ibuf, count: data.idx.length};
}

function buildMeshes(segments){
  meshes.sphere = uploadMesh(buildSphere(segments));
  meshes.cylinder = uploadMesh(buildCylinder(segments));
  meshes.quadFloor = uploadMesh(buildQuadFloor());
  meshes.quadWall = uploadMesh(buildQuadWall());
}

function resize3D(){
  const canvas = gl.canvas, dpr = QUALITY3D[quality3D].dpr;
  canvas.width = R3D_W*dpr; canvas.height = R3D_H*dpr;
  gl.viewport(0,0,canvas.width,canvas.height);
}

// ponytail: no gl.enable(CULL_FACE) — our meshes are simple closed/near-closed shapes
// (sphere, cylinder sides, single-sided quads) with the depth buffer already sorting
// overlap correctly; culling would save a little fill rate but risks invisible geometry
// if a mesh generator's winding order is ever wrong. Not worth that failure mode here.
function init3D(canvas){
  try{ gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); }catch(e){ gl=null; }
  if(!gl) return false;
  const vs=compileShader(gl.VERTEX_SHADER, VERTEX_SRC), fs=compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if(!vs||!fs){ gl=null; return false; }
  prog = gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){ gl=null; return false; }
  gl.useProgram(prog);
  aPosition = gl.getAttribLocation(prog,'aPosition');
  aNormal = gl.getAttribLocation(prog,'aNormal');
  uModel = gl.getUniformLocation(prog,'uModel');
  uProjection = gl.getUniformLocation(prog,'uProjection');
  uColor = gl.getUniformLocation(prog,'uColor');
  uLightDir = gl.getUniformLocation(prog,'uLightDir');
  uFogColor = gl.getUniformLocation(prog,'uFogColor');
  uFogNear = gl.getUniformLocation(prog,'uFogNear');
  uFogFar = gl.getUniformLocation(prog,'uFogFar');
  gl.enable(gl.DEPTH_TEST);
  projectionMatrix = mat4Ortho(0, R3D_W, R3D_H, 0, -80, 500);   // bottom=R3D_H,top=0 deliberately flips Y to canvas convention
  buildMeshes(QUALITY3D[quality3D].segments);
  resize3D();
  const [lx,ly,lz] = normalize3(-0.4,-0.7,-0.5);
  gl.uniform3f(uLightDir, lx,ly,lz);
  return true;
}
```

Then extend `exportsObj` (a few lines above the closing `})(...)`) to also include:
```js
  has3DSupport, init3D, getQuality3D, setQuality3D,
```

- [ ] **Step 2: Call `init3D` at startup**

In `index.html`, modify line 91 from:

```js
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
```

to:

```js
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const cv3d = document.getElementById('cv3d');
init3D(cv3d);
```

(This runs early — right after `cv`/`ctx` are defined — rather than at the bottom of the
script, because Task 3 needs `has3DSupport()` to already have a real answer at line 175,
well before the bottom of the script runs.)

- [ ] **Step 3: Manually verify in a browser**

Run: `python3 -m http.server 8000` from the repo root, then open
`http://localhost:8000` in a browser (desktop is fine for this check).

Open the browser's devtools console and run `has3DSupport()`.
Expected: `true`, and no errors were logged during page load (no shader compile/link
errors). The game should look and behave exactly as before — nothing draws to `cv3d` yet.

- [ ] **Step 4: Commit**

```bash
git add render3d.js index.html
git commit -m "Add WebGL bootstrap and cv3d canvas layer for GFX: 3D mode"
```

---

### Task 3: GFX 3-way toggle, capability gating, i18n

**Files:**
- Modify: `game-logic.js:302-304` (I18N)
- Modify: `index.html:175-177` (graphicsStyle/toggle), `index.html:823` (menu button)

**Interfaces:**
- Consumes: `has3DSupport()` from Task 2.
- Produces: `graphicsStyle` now takes values `'classic'|'pixel'|'3d'`.

- [ ] **Step 1: Add the `3d` translation key**

In `game-logic.js`, modify (right after line 304, the `pixel:` row):

```js
  pixel:{en:'PIXEL',de:'PIXEL',es:'PÍXEL',it:'PIXEL',fr:'PIXEL',hu:'PIXEL'},
  '3d':{en:'3D',de:'3D',es:'3D',it:'3D',fr:'3D',hu:'3D'},
```

- [ ] **Step 2: Run the existing i18n completeness test**

Run: `npm test`
Expected: PASS — the generic "every I18N key has every language" test
(`game-logic.test.js`) automatically covers the new key with no test changes needed.

- [ ] **Step 3: Extend the toggle to 3 states, gated on WebGL support**

In `index.html`, replace lines 175-177:

```js
let graphicsStyle = localStorage.kmp_graphics || 'classic';   // 'classic' | 'pixel'
function applyGraphicsStyle(){ cv.style.imageRendering = graphicsStyle==='pixel' ? 'pixelated' : 'auto'; }
function toggleGraphicsStyle(){ graphicsStyle = graphicsStyle==='pixel'?'classic':'pixel'; localStorage.kmp_graphics=graphicsStyle; applyGraphicsStyle(); }
```

with:

```js
let graphicsStyle = localStorage.kmp_graphics || 'classic';   // 'classic' | 'pixel' | '3d'
if(graphicsStyle==='3d' && !has3DSupport()) graphicsStyle='classic';   // device can't do it — fall back silently
function applyGraphicsStyle(){ cv.style.imageRendering = graphicsStyle==='pixel' ? 'pixelated' : 'auto'; }
function toggleGraphicsStyle(){
  const order = has3DSupport() ? ['classic','pixel','3d'] : ['classic','pixel'];
  graphicsStyle = order[(order.indexOf(graphicsStyle)+1) % order.length];
  localStorage.kmp_graphics=graphicsStyle; applyGraphicsStyle();
}
```

(This line runs at page-load time, top-level — not inside a function — so it relies on
`init3D()` having already run at line 91-92, per Task 2, Step 2.)

- [ ] **Step 4: Show the 3D option on the menu button**

In `index.html`, modify line 823 from:

```js
btn(W/2+41,466,154,38,t(lang,'gfx')+': '+(graphicsStyle==='pixel'?t(lang,'pixel'):t(lang,'classic')),toggleGraphicsStyle,graphicsStyle==='pixel');
```

to:

```js
btn(W/2+41,466,154,38,t(lang,'gfx')+': '+(graphicsStyle==='pixel'?t(lang,'pixel'):graphicsStyle==='3d'?t(lang,'3d'):t(lang,'classic')),toggleGraphicsStyle,graphicsStyle!=='classic');
```

- [ ] **Step 5: Manually verify in a browser**

Reload `http://localhost:8000`. Click the `GFX` button on the main menu repeatedly.
Expected: cycles `CLASSIC → PIXEL → 3D → CLASSIC`, label updates each click, persists
across a page reload (check `localStorage.kmp_graphics` in devtools).

- [ ] **Step 6: Commit**

```bash
git add game-logic.js index.html
git commit -m "Add 3-way GFX toggle (Classic/Pixel/3D) with WebGL capability gating"
```

---

### Task 4: Fighter 3D rendering + Dojo stage (first playable slice)

**Files:**
- Modify: `render3d.js` (append fighter + Dojo-stage drawing)
- Modify: `index.html:398-443` (`drawFighter` dispatch), `index.html:788-793` (`bg()`)

**Interfaces:**
- Consumes: `boneMatrix`, `pointMatrix`, `boxScaleMatrix`, `hexToRgb01` (Task 1);
  `gl`, `meshes`, `uModel/uColor/uProjection/uFogColor/uFogNear/uFogFar` (Task 2, module-
  internal — not exported, but this task's new code lives in the same closure);
  `GI_BLACK`, `GI_WHITE`, `giAboveBlue` (globals from `game-logic.js`); `DECOR` (global
  from `index.html`, used by later stages, not this one).
- Produces: `draw3D(meshName, model, r,g,b)`, `begin3DFrame(stageIndex, t)`,
  `draw3DFighter(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee)` — the same
  signature `drawFighterClassic`/`drawFighterPixel` already receive, for drop-in dispatch.
  `STAGES_3D` array (length 4; only index 0 implemented this task, others added in Task 5).

- [ ] **Step 1: Add the low-level draw call and frame lifecycle to `render3d.js`**

Add inside the same IIFE, after the Task 2 code:

```js
// ---------- per-frame drawing -------------------------------------------------------
function draw3D(meshName, model, r,g,b){
  const m = meshes[meshName];
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vbuf); gl.vertexAttribPointer(aPosition,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aPosition);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.nbuf); gl.vertexAttribPointer(aNormal,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aNormal);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibuf);
  gl.uniformMatrix4fv(uModel, false, model);
  gl.uniform3f(uColor, r,g,b);
  gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
}

function bone(a,b,radius,color){ draw3D('cylinder', boneMatrix(a[0],a[1],a[2], b[0],b[1],b[2], radius), color[0],color[1],color[2]); }
function ball(p,radius,color){ draw3D('sphere', pointMatrix(p[0],p[1],p[2],radius), color[0],color[1],color[2]); }
function shade3(rgb,amt){ return rgb.map(v=>Math.max(0,Math.min(1,v+amt))); }

function begin3DFrame(stageIndex, t){
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prog);
  gl.uniformMatrix4fv(uProjection, false, projectionMatrix);
  STAGES_3D[stageIndex % STAGES_3D.length](t);
}
```

- [ ] **Step 2: Add fighter rendering**

Add:

```js
// ---------- fighter rendering -------------------------------------------------------
// Fixed camera-relative depth per joint (independent of left/right facing — facing only
// mirrors X, never Z). Front-side limbs (toward the opponent) bulge slightly toward the
// camera; back-side limbs recede slightly — this is what makes the figure read as round
// 3D rather than a flat cutout, using the exact same joints poseOf() already computes.
const JOINT_DEPTH = { hip:0, sh:0, head:0, fFoot:-14, bFoot:14, fHand:-14, bHand:14, fKnee:-10 };

function draw3DFighter(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee){
  // Replicates the ctx.translate/scale/rotate stack drawFighter() applies in 2D (index.html)
  // before dispatching, since this renderer has no canvas transform stack of its own. The KO
  // pose's ctx.rotate is a rotation around the screen-perpendicular axis, which is exactly
  // the camera's view axis here — so applying it to X/Y only and leaving Z untouched is the
  // exact 3D equivalent, not an approximation.
  let rot=0, offY=0;
  if(pose==='ko'){ rot = f.airThrow ? f.rot : Math.PI/2; offY = -0.2*h; }
  const cosR=Math.cos(rot), sinR=Math.sin(rot), fac=f.facing;
  const J = (p,dz)=>{
    const y1=p[1]+offY, cx=p[0]*cosR - y1*sinR, cy=p[0]*sinR + y1*cosR;
    return [f.x+cx*fac, f.y+cy, dz];
  };
  const hipW=J(hip,JOINT_DEPTH.hip), shW=J(sh,JOINT_DEPTH.sh), headW=J(head,JOINT_DEPTH.head);
  const fFootW=J(fFoot,JOINT_DEPTH.fFoot), bFootW=J(bFoot,JOINT_DEPTH.bFoot);
  const fHandW=J(fHand,JOINT_DEPTH.fHand), bHandW=J(bHand,JOINT_DEPTH.bHand);
  const fKneeW = fKnee ? J(fKnee,JOINT_DEPTH.fKnee) : null;

  const isGi = c.outfit==='gi';
  const pantsColor = hexToRgb01(isGi ? (giAboveBlue(c.beltRank)?GI_BLACK:GI_WHITE) : '#2b2b2b');
  const topColor = hexToRgb01(isGi ? GI_BLACK : c.gi);
  const skin = hexToRgb01(c.skin);
  const hairColor = hexToRgb01(c.hair.color);
  const legR=4*g, armR=3.5*g, torsoR=11*g;

  // legs (front leg bends at the knee for kicks, exactly like drawFighterClassic)
  if(fKneeW){ bone(hipW,fKneeW,legR,pantsColor); bone(fKneeW,fFootW,legR*0.9,pantsColor); }
  else bone(hipW,fFootW,legR,pantsColor);
  bone(hipW,bFootW,legR,pantsColor);
  // back arm, torso, front arm (same draw order as Classic: back arm first so the torso
  // partially occludes its shoulder end)
  bone(shW,bHandW,armR,shade3(topColor,-0.15));
  bone(hipW,shW,torsoR,topColor);
  bone(shW,fHandW,armR,topColor);
  // hands/feet
  ball(fFootW,legR,skin); ball(bFootW,legR,skin);
  ball(fHandW,armR*1.3,skin); ball(bHandW,armR*1.3,skin);
  // head + a simplified hair "cap" (every hairstyle renders as the same rounded cap in
  // 3D, colored with the character's hair color — replicating each of Classic's 5 distinct
  // hair silhouettes as real geometry would need new mesh shapes for no gameplay benefit).
  // ponytail: simplified hair; add per-style 3D geometry later if it's visibly missed.
  ball(headW, headR, skin);
  if(c.hair.style!=='bald') ball([headW[0],headW[1]-headR*0.35,headW[2]], headR*0.92, hairColor);
}
```

- [ ] **Step 3: Add the Dojo 3D stage**

Add:

```js
// ---------- stage scenes ------------------------------------------------------------
// Each stage mirrors its 2D counterpart's existing prop density (floor + backdrop + a
// couple of props) — a "3D-ified" version of an already-minimal scene, not a new one.
function stageDojo3D(t){
  gl.uniform3f(uFogColor, 0.10,0.09,0.08); gl.uniform1f(uFogNear, 80); gl.uniform1f(uFogFar, 420);
  draw3D('quadFloor', boxScaleMatrix(R3D_W/2, R3D_GROUND, 120, R3D_W, 1, 260), 0.37,0.36,0.24);
  draw3D('quadWall', boxScaleMatrix(R3D_W/2, 0, 260, R3D_W, R3D_GROUND, 1), 0.13,0.12,0.11);
  [360,600].forEach((bx,k)=>{
    const sway = Math.sin(t*1.1+k*2)*10;
    bone([bx+sway*0.3,94,40], [bx,260,40], 16, [0.29,0.20,0.14]);
  });
}
const STAGES_3D = [stageDojo3D, stageDojo3D, stageDojo3D, stageDojo3D];   // Task 5 replaces indices 1-3
```

Then extend `exportsObj` to also include (`JOINT_DEPTH` is needed by Task 7's self-check,
which runs from `index.html` — only names listed here become accessible globals outside
this file's closure, via the module's existing `Object.assign(root, exportsObj)` line):
```js
  draw3D, begin3DFrame, draw3DFighter, JOINT_DEPTH, STAGES_3D,
```

- [ ] **Step 4: Wire the dispatch in `index.html`**

Modify line 441 (inside `drawFighter()`):

```js
(graphicsStyle==='pixel'?drawFighterPixel:drawFighterClassic)(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee);
```

to:

```js
(graphicsStyle==='3d'&&state==='fight' ? draw3DFighter : graphicsStyle==='pixel'?drawFighterPixel:drawFighterClassic)(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee);
```

(The `state==='fight'` check keeps character-select portraits and the Create Fighter
preview — which also call `drawFighter()` — rendering in Classic, since they're drawn on
the opaque 2D menu background where a layered WebGL canvas behind them wouldn't show
through. Only the live fight screen clears to transparent, per the next step.)

Modify `bg()` (lines 788-793):

```js
function bg(){ ctx.fillStyle=INK; ctx.fillRect(0,0,W,H);
  const set = graphicsStyle==='pixel' ? STAGES_PIXEL : STAGES;
  set[stageIndex % set.length]();
  ctx.strokeStyle='rgba(245,168,0,.20)'; ctx.lineWidth=2; ctx.strokeRect(30,GROUND+6,W-60,H-GROUND-14);
  drawWatermark(W-70,H-58,44,0.10);
}
```

to:

```js
function bg(){
  if(graphicsStyle==='3d'){ ctx.clearRect(0,0,W,H); begin3DFrame(stageIndex, now()); }
  else{
    ctx.fillStyle=INK; ctx.fillRect(0,0,W,H);
    const set = graphicsStyle==='pixel' ? STAGES_PIXEL : STAGES;
    set[stageIndex % set.length]();
  }
  ctx.strokeStyle='rgba(245,168,0,.20)'; ctx.lineWidth=2; ctx.strokeRect(30,GROUND+6,W-60,H-GROUND-14);
  drawWatermark(W-70,H-58,44,0.10);
}
```

- [ ] **Step 5: Manually verify in a browser**

Reload `http://localhost:8000`, switch `GFX` to `3D`, start a 1-Player fight.
Expected: fighters render as lit, rounded 3D figures (not flat shapes) standing on a lit
floor with a dim backdrop and two swaying heavy-bag shapes; movement, jumping, punching,
kicking, blocking, and a KO all look proportionally correct (the KO tip-over should be
visible in 3D too). No console errors. Cycle stages — the other 3 will look identical to
the Dojo for now (fixed in Task 5). Switch back to Classic/Pixel — those must look exactly
as before.

- [ ] **Step 6: Commit**

```bash
git add render3d.js index.html
git commit -m "Add 3D fighter rendering and the first (Dojo) 3D stage scene"
```

---

### Task 5: Remaining 3 stage 3D scenes (Rooftop, Bamboo, Arena)

**Files:**
- Modify: `render3d.js` (append 3 stage functions, update `STAGES_3D`)

**Interfaces:**
- Consumes: `DECOR` (global from `index.html`, already used by the 2D Rooftop/Bamboo
  stages for the same randomized layout data — reused here, not duplicated).

- [ ] **Step 1: Add the 3 remaining stage functions**

Add to `render3d.js`, right after `stageDojo3D`:

```js
function stageRooftop3D(t){
  gl.uniform3f(uFogColor, 0.06,0.08,0.14); gl.uniform1f(uFogNear, 60); gl.uniform1f(uFogFar, 380);
  draw3D('quadFloor', boxScaleMatrix(R3D_W/2, R3D_GROUND, 100, R3D_W, 1, 220), 0.12,0.13,0.15);
  draw3D('quadWall', boxScaleMatrix(R3D_W/2, 0, 300, R3D_W, R3D_GROUND, 1), 0.04,0.06,0.12);
  DECOR.buildings.filter((b,i)=>i%2===0).slice(0,10).forEach((b,i)=>{
    const bw=Math.max(30,b.w*0.6), bh=R3D_GROUND-b.top;
    draw3D('quadWall', boxScaleMatrix(b.x+bw/2, b.top, 220+((i%3)*20), bw, bh, 1), 0.05,0.06,0.09);
    const wc = [[1,0.83,0.42],[0.48,0.88,1],[1,0.48,0.82]][i%3];
    draw3D('quadWall', boxScaleMatrix(b.x+bw/2, b.top+18, 218+((i%3)*20), bw*0.4, 10, 1), wc[0],wc[1],wc[2]);
  });
  bone([R3D_W*0.15,80,0],[R3D_W*0.15,R3D_GROUND,0],3,[0.5,0.55,0.6]);
  bone([R3D_W*0.85,80,0],[R3D_W*0.85,R3D_GROUND,0],3,[0.5,0.55,0.6]);
}

function stageBamboo3D(t){
  gl.uniform3f(uFogColor, 0.18,0.16,0.09); gl.uniform1f(uFogNear, 80); gl.uniform1f(uFogFar, 400);
  draw3D('quadFloor', boxScaleMatrix(R3D_W/2, R3D_GROUND, 110, R3D_W, 1, 240), 0.26,0.20,0.12);
  draw3D('quadWall', boxScaleMatrix(R3D_W/2, 0, 280, R3D_W, R3D_GROUND, 1), 0.23,0.20,0.13);
  DECOR.bamboo.slice(0,9).forEach(b=>{
    const sway = Math.sin(t*0.8+b.ph)*6;
    bone([b.x+sway,R3D_GROUND,180], [b.x,b.top,180], Math.max(2,b.w*0.5), [0.33,0.42,0.20]);
  });
  [110,850].forEach(lx=>{
    bone([lx,R3D_GROUND-30,60],[lx,R3D_GROUND-52,60], 12, [0.54,0.54,0.50]);
    ball([lx,R3D_GROUND-58,60], 10, [1,0.81,0.48]);
  });
}

function stageArena3D(t){
  const flash = Math.sin(t*9)+Math.sin(t*13) > 1.6 ? 0.18 : 0;
  gl.uniform3f(uFogColor, 0.05,0.05,0.06); gl.uniform1f(uFogNear, 80); gl.uniform1f(uFogFar, 420);
  draw3D('quadFloor', boxScaleMatrix(R3D_W/2, R3D_GROUND, 120, R3D_W, 1, 260), 0.79+flash,0.75+flash,0.66+flash);
  draw3D('quadWall', boxScaleMatrix(R3D_W/2, 0, 300, R3D_W, R3D_GROUND, 1), 0.05+flash,0.05+flash,0.06+flash);
  [R3D_GROUND-96,R3D_GROUND-64,R3D_GROUND-32].forEach(ry=>{
    bone([44,ry,20],[R3D_W-44,ry,20], 3, [0.76,0.2,0.2]);
  });
  bone([34,R3D_GROUND-104,20],[34,R3D_GROUND,20], 6, [0.91,0.89,0.81]);
  bone([R3D_W-34,R3D_GROUND-104,20],[R3D_W-34,R3D_GROUND,20], 6, [0.91,0.89,0.81]);
}

const STAGES_3D = [stageDojo3D, stageRooftop3D, stageBamboo3D, stageArena3D];
```

Remove the placeholder `const STAGES_3D = [stageDojo3D, stageDojo3D, stageDojo3D, stageDojo3D];`
line added in Task 4, Step 3 (this new one replaces it).

- [ ] **Step 2: Manually verify in a browser**

Reload, GFX: 3D, start fights and let the stage cycle through several rounds (or edit
`stageIndex` in devtools to jump directly). Expected: 4 visibly distinct 3D scenes —
Rooftop shows lit building silhouettes with colored window strips and two vertical fence
posts; Bamboo shows swaying stalks and two lantern shapes; Arena shows a lit ring floor
with 3 ropes and 2 corner posts, occasionally flashing brighter. No console errors, no
stage crashes.

- [ ] **Step 3: Commit**

```bash
git add render3d.js
git commit -m "Add Rooftop, Bamboo, and Arena 3D stage scenes"
```

---

### Task 6: Quality toggle button (Performance / Eye Candy)

**Files:**
- Modify: `index.html` (CSS near `.cornerBtn`, HTML near `#fsBtn`, JS near the `exitBtn`
  wiring around line 1312-1315)

**Interfaces:**
- Consumes: `getQuality3D()`, `setQuality3D()` (Task 2).

- [ ] **Step 1: Add the button's CSS and HTML**

In `index.html`, modify the corner-button CSS block to add a third slot to the left of
the other two:

```css
  #fsBtn { right:8px; }
  #exitBtn { right:46px; font-size:17px; }
  #qualityBtn { right:84px; font-size:15px; }
```

Add the HTML element next to `#fsBtn`:

```html
<div id="exitBtn" class="cornerBtn" title="Exit to Menu">⌂</div>
<div id="fsBtn" class="cornerBtn" title="Fullscreen">⛶</div>
<div id="qualityBtn" class="cornerBtn" title="Quality">⚡</div>
```

- [ ] **Step 2: Wire show/hide and click behavior**

In `index.html`, modify the `loop()` function's button-visibility line (line 1312):

```js
document.getElementById('exitBtn').classList.toggle('show', state==='fight');
```

to also drive the quality button (3D-mode-and-fight-only, per the approved design):

```js
document.getElementById('exitBtn').classList.toggle('show', state==='fight');
document.getElementById('qualityBtn').classList.toggle('show', state==='fight' && graphicsStyle==='3d');
```

Add the click handler right after the existing `exitBtn` listener (line 1315):

```js
document.getElementById('exitBtn').addEventListener('pointerdown', e=>{ e.preventDefault(); state='menu'; });
(function initQualityBtn(){
  const btn = document.getElementById('qualityBtn');
  function updateIcon(){ const q=getQuality3D(); btn.textContent = q==='performance' ? '⚡' : '✨'; btn.title = q==='performance' ? 'Performance' : 'Eye Candy'; }
  btn.addEventListener('pointerdown', e=>{ e.preventDefault(); setQuality3D(getQuality3D()==='performance'?'eyecandy':'performance'); updateIcon(); });
  updateIcon();
})();
```

- [ ] **Step 3: Manually verify in a browser**

Reload, switch GFX to 3D, start a fight. Expected: a third button (⚡ or ✨, matching
whatever was last saved — default ✨ on first run) appears next to ⛶/⌂, and *only* then
— switch back to Classic/Pixel mid-fight (via exiting to menu, toggling GFX, refighting)
and confirm the quality button is absent. Click it during a 3D fight: icon flips
instantly, mesh roundness and backing resolution visibly change (most noticeable on the
head/limbs' smoothness), and the choice survives a page reload
(`localStorage.kmp_quality`).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add fight-only Performance/Eye Candy quality toggle for GFX: 3D"
```

---

### Task 7: Extend the `?test=1` self-check

**Files:**
- Modify: `index.html:1340-1368` (`runSelfCheck`)

**Interfaces:**
- Consumes: `has3DSupport()`, `JOINT_DEPTH`, and `STAGES_3D` — all exported from
  `render3d.js` in Task 4.

- [ ] **Step 1: Add 3D assertions to `runSelfCheck`**

In `index.html`, modify `runSelfCheck()` (starting line 1340) — add a new `ok8` alongside
the existing `ok1`..`ok7` and fold it into `pass`:

```js
  const ok7 = ROSTER.length>=CHARACTERS.length && ROSTER[0]===CHARACTERS[0];   // roster combiner sane
  const ok8 = has3DSupport()===true && STAGES_3D.length===4
    && Number.isFinite(JOINT_DEPTH.hip) && Number.isFinite(JOINT_DEPTH.fFoot) && Number.isFinite(JOINT_DEPTH.fHand);
  const pass=ok1&&ok2&&ok3&&ok4&&ok5&&ok6&&ok7&&ok8;
  console.assert(ok1,'block should reduce damage'); console.assert(ok2,'rect overlap'); console.assert(ok3,'grab fails at range'); console.assert(ok4,'grab works in range');
  console.assert(ok5,'moveDir maps directions'); console.assert(ok6,'move tables wired'); console.assert(ok7,'ROSTER combines CHARACTERS + custom');
  console.assert(ok8,'GFX:3D initialized: WebGL support detected, 4 stages wired, joint depths finite');
```

(`has3DSupport()` is asserted `===true` here because this check assumes it's run in a
modern desktop/CI browser with WebGL — exactly the environment the existing `?test=1`
badge already targets for the rest of its assertions.)

- [ ] **Step 2: Manually verify**

Open `http://localhost:8000/?test=1` in a browser.
Expected: green `SELF-CHECK PASS` badge (same as before this change — no new failures).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Extend ?test=1 self-check with GFX:3D assertions"
```

---

### Task 8: README documentation

**Files:**
- Modify: `README.md` (after the existing "Graphics style — Classic / HD Pixel toggle"
  section, currently lines 115-129)

**Interfaces:** None (documentation only).

- [ ] **Step 1: Add a "3D mode" subsection**

In `README.md`, insert right after the existing Classic/Pixel section (after line 129,
before the "## Language" heading):

```markdown
Main menu → **GFX** cycles a third time into **3D**: the same fighters and stages,
rendered as lit, rounded WebGL geometry — still procedurally generated at runtime, no
model files, no textures, no external libraries. The camera is fixed and frontal, matching
the exact framing Classic/Pixel already use, so HUD placement and hit timing never
change — only how everything looks. If a device's browser doesn't support WebGL, this
option is silently left out of the cycle and the game behaves exactly as it always has.

During a 3D fight, a third button appears next to ⛶/⌂ (⚡ Performance / ✨ Eye Candy) to
trade rendering quality for smoothness on phones and slower machines — lower-resolution
rendering and simpler meshes vs. full detail. It only appears in 3D mode, since Classic
and Pixel already draw at the same fixed cost regardless of device. Your choice persists
across reloads, same as the GFX mode itself.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document GFX: 3D mode and the quality toggle in the README"
```

---

## Self-Review Notes

- **Spec coverage:** every section of the approved design doc
  (`docs/superpowers/specs/2026-07-20-3d-graphics-mode-design.md`) maps to a task: layered
  canvas → Task 2; GFX cycle → Task 3; fighter skeleton reuse → Task 4; camera/lighting →
  Task 2 shader + Task 4 fighter code; stage scenes → Tasks 4-5; quality toggle → Task 6;
  fallback/compatibility → Tasks 2-3; testing → Tasks 1, 7.
- **Deviation from the approved spec, called out explicitly:** the spec said 3D would
  "appear everywhere Classic/Pixel do" (portraits, Create Fighter preview) automatically,
  since they share the `drawFighter()` dispatch. Building Task 4 revealed that's only true
  for the live fight screen — portraits are drawn on top of an *opaque* 2D menu background
  that would fully hide anything on the layered WebGL canvas behind it. The fix is a
  one-line guard (`state==='fight'`) that keeps portraits on Classic rendering in 3D mode,
  rather than punching per-portrait transparent holes in every menu screen for a secondary
  surface. This is called out again in Task 4's dispatch step so it isn't missed.
- **No placeholders:** every step has complete, runnable code; no TODOs.
- **Type/signature consistency checked:** `draw3DFighter(f,h,c,pose,g,hip,sh,head,headR,fFoot,bFoot,fHand,bHand,fKnee)`
  matches `drawFighterClassic`/`drawFighterPixel`'s exact parameter list everywhere it's
  referenced (Tasks 4 and the dispatch line). `STAGES_3D` is declared once effectively
  (Task 4's placeholder is explicitly replaced, not left dangling, in Task 5).
