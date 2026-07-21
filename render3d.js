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

const exportsObj = {
  mat4Identity, mat4Multiply, mat4Ortho, normalize3, hexToRgb01,
  buildSphere, buildCylinder, buildQuadFloor, buildQuadWall,
  pointMatrix, boneMatrix, boxScaleMatrix,
  R3D_W, R3D_H, R3D_GROUND,
  has3DSupport, init3D, getQuality3D, setQuality3D,
  draw3D, begin3DFrame, draw3DFighter, JOINT_DEPTH, STAGES_3D,
};

if(typeof module!=='undefined' && module.exports){ module.exports = exportsObj; }
else { Object.assign(root, exportsObj); }

})(typeof window!=='undefined' ? window : globalThis);
