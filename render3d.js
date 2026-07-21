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
