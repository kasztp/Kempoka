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
