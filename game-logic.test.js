// Unit tests for game-logic.js — the DOM/canvas-free half of Kempoka (belts, roster, move
// tables, combat math). Run with: node --test
"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KYU_RANKS, DAN_RANKS, BELT_TABLE, getBelt, giAboveBlue, BELT_CHOICES, beltLabel,
  CHARACTERS, CharacterStore,
  MOVES, PUNCHES, KICKS, CLINCH_RANGE,
  computeDamage, fh, bodyRect, rectsOverlap, inClinchRange, faceDir, moveDir,
} = require('./game-logic.js');

function makeStub(overrides){
  return Object.assign({ x:0, y:0, char:{ build:{scale:1,girth:1}, stats:{power:1,speed:1,defense:1,maxHp:100} } }, overrides);
}

// ---------- combat math -------------------------------------------------------
test('computeDamage: blocking reduces damage', () => {
  const a=makeStub(), b=makeStub();
  const hit=computeDamage(10,a,b,false), blocked=computeDamage(10,a,b,true);
  assert.ok(blocked < hit, `blocked (${blocked}) should be less than unblocked (${hit})`);
});
test('computeDamage: scales by attacker power / defender defense', () => {
  const strong=makeStub({char:{build:{scale:1,girth:1},stats:{power:2,speed:1,defense:1,maxHp:100}}});
  const soft=makeStub({char:{build:{scale:1,girth:1},stats:{power:1,speed:1,defense:0.5,maxHp:100}}});
  const base=makeStub();
  assert.equal(computeDamage(10,strong,base,false), 20);
  assert.equal(computeDamage(10,base,soft,false), 20);
});
test('fh: scales with build.scale', () => {
  const small=makeStub({char:{build:{scale:0.8,girth:1},stats:{power:1,speed:1,defense:1,maxHp:100}}});
  const big=makeStub({char:{build:{scale:1.4,girth:1},stats:{power:1,speed:1,defense:1,maxHp:100}}});
  assert.ok(fh(big) > fh(small));
  assert.equal(fh(makeStub()), 132);
});
test('rectsOverlap: detects overlap and non-overlap', () => {
  assert.ok(rectsOverlap({x0:0,x1:10,y0:0,y1:10},{x0:5,x1:15,y0:5,y1:15}));
  assert.ok(!rectsOverlap({x0:0,x1:5,y0:0,y1:5},{x0:6,x1:9,y0:6,y1:9}));
});
test('bodyRect: centers on fighter x, spans up from feet', () => {
  const f=makeStub({x:100,y:200});
  const r=bodyRect(f);
  assert.ok(r.x0 < 100 && r.x1 > 100, 'straddles x');
  assert.equal(r.y1, 200, 'bottom is at the feet (f.y)');
  assert.ok(r.y0 < r.y1, 'top is above the feet');
});
test('inClinchRange: true within range, false outside', () => {
  const a=makeStub({x:0,y:0}), near=makeStub({x:CLINCH_RANGE-1,y:0}), far=makeStub({x:CLINCH_RANGE+50,y:0});
  assert.ok(inClinchRange(a,near));
  assert.ok(!inClinchRange(a,far));
});

// ---------- direction / moveset selection -------------------------------------
test('faceDir: faces toward whichever side the opponent is on', () => {
  const f=makeStub({x:100}), oppRight=makeStub({x:200}), oppLeft=makeStub({x:0});
  assert.equal(faceDir(f,oppRight), 1);
  assert.equal(faceDir(f,oppLeft), -1);
});
test('moveDir: up/down win regardless of left/right', () => {
  const f=makeStub({x:100}), o=makeStub({x:200});
  assert.equal(moveDir(f,o,{up:true,right:true}), 'up');
  assert.equal(moveDir(f,o,{down:true,left:true}), 'down');
});
test('moveDir: toward/back are relative to the opponent, not absolute left/right', () => {
  const f=makeStub({x:100}), oppRight=makeStub({x:200}), oppLeft=makeStub({x:0});
  assert.equal(moveDir(f,oppRight,{right:true}), 'toward');
  assert.equal(moveDir(f,oppRight,{left:true}), 'back');
  assert.equal(moveDir(f,oppLeft,{left:true}), 'toward');
  assert.equal(moveDir(f,oppLeft,{right:true}), 'back');
});
test('moveDir: no direction held is neutral', () => {
  assert.equal(moveDir(makeStub({x:0}),makeStub({x:100}),{}), 'neutral');
});

// ---------- move tables --------------------------------------------------------
test('PUNCHES/KICKS: cover all five directions with sane fields', () => {
  for(const dir of ['neutral','toward','up','down','back']){
    for(const table of [PUNCHES,KICKS]){
      const m=table[dir];
      assert.ok(m, `missing ${dir}`);
      assert.ok(m.dur>0 && m.reach>0 && m.dmg>0, `${dir} has invalid dur/reach/dmg`);
      assert.equal(m.active.length, 2);
      assert.ok(m.active[0] < m.active[1], `${dir} active window should be [start,end]`);
    }
  }
});
test('PUNCHES.up is the uppercut launcher', () => {
  assert.ok(PUNCHES.up.launch < 0, 'launch velocity should be negative (upward)');
});
test('MOVES base punch/kick are sane', () => {
  assert.ok(MOVES.punch.reach < MOVES.kick.reach, 'kicks should out-reach punches');
});

// ---------- belt ranks ----------------------------------------------------------
test('KYU_RANKS: 12 grades, 12th (White) down to 1st (Brown, black stripe)', () => {
  assert.equal(KYU_RANKS.length, 12);
  assert.equal(KYU_RANKS[0].kyu, 12); assert.match(KYU_RANKS[0].label, /White/);
  assert.equal(KYU_RANKS.at(-1).kyu, 1); assert.equal(KYU_RANKS.at(-1).stripe, '#141414');
});
test('DAN_RANKS: 5 black-belt grades, all with a gold tip', () => {
  assert.equal(DAN_RANKS.length, 5);
  DAN_RANKS.forEach((d,i)=>{ assert.equal(d.dan, i+1); assert.equal(d.color, '#141414'); assert.equal(d.tip, '#F5A800'); });
});
test('getBelt: looks up by id, null for no belt', () => {
  assert.equal(getBelt('kyu11').label, 'Yellow Belt');
  assert.equal(getBelt('dan1').label, '1st Dan (Black Belt)');
  assert.equal(getBelt(null), null);
  assert.equal(getBelt(undefined), null);
});
test('getBelt: compound ranks carry the right stripe/tip accents', () => {
  assert.equal(getBelt('kyu6').tip, '#6b3f1d', '6th kyu = purple with a brown tip');
  assert.equal(getBelt('kyu4').stripe, '#f2ede0', '4th kyu = brown with a white stripe');
  assert.equal(getBelt('kyu4').tip, '#141414', '4th kyu also has a black tip');
  assert.equal(getBelt('kyu3').stripe, undefined, '3rd kyu (plain brown) has no stripe');
});
test('giAboveBlue: below Blue Belt is false, Blue and up (incl. all Dan) is true', () => {
  assert.equal(giAboveBlue('kyu12'), false); // White
  assert.equal(giAboveBlue('kyu9'), false);  // Green
  assert.equal(giAboveBlue('kyu8'), true);   // Blue itself
  assert.equal(giAboveBlue('kyu1'), true);   // Brown
  assert.equal(giAboveBlue('dan1'), true);
  assert.equal(giAboveBlue(null), true, 'no belt (e.g. spandex fighters) defaults to the black/above-blue look');
});
test('BELT_CHOICES: null + every kyu + every dan, and beltLabel matches getBelt', () => {
  assert.equal(BELT_CHOICES.length, 1 + KYU_RANKS.length + DAN_RANKS.length);
  assert.equal(BELT_CHOICES[0], null);
  assert.equal(beltLabel(null), 'No Belt');
  assert.equal(beltLabel('kyu1'), getBelt('kyu1').label);
});

// ---------- roster ----------------------------------------------------------------
const SPECIAL_TYPES = ['combo','throw','lunge','spin','cleaver'];
test('CHARACTERS: five built-ins, unique ids, valid belt/outfit/stats/special', () => {
  assert.equal(CHARACTERS.length, 5);
  const ids = new Set(CHARACTERS.map(c=>c.id));
  assert.equal(ids.size, CHARACTERS.length, 'ids must be unique');
  for(const c of CHARACTERS){
    assert.ok(c.beltRank===null || BELT_TABLE[c.beltRank], `${c.name} has an unknown beltRank`);
    assert.ok(c.outfit==='gi' || c.outfit==='spandex', `${c.name} has an invalid outfit`);
    for(const k of ['maxHp','speed','power','defense']) assert.ok(c.stats[k]>0, `${c.name}.stats.${k} must be positive`);
    assert.ok(SPECIAL_TYPES.includes(c.special.type), `${c.name} has an unknown special type`);
  }
});

// ---------- CharacterStore (in-memory fallback in Node, same API as the browser) -
test('CharacterStore: save/list/remove round-trips', async () => {
  const char = { id:'test_'+Math.random().toString(36).slice(2), name:'Unit Test Fighter' };
  await CharacterStore.save(char);
  let list = await CharacterStore.list();
  assert.ok(list.some(c=>c.id===char.id), 'saved character should appear in list()');
  await CharacterStore.remove(char.id);
  list = await CharacterStore.list();
  assert.ok(!list.some(c=>c.id===char.id), 'removed character should be gone from list()');
});
test('CharacterStore: saving the same id twice updates rather than duplicates', async () => {
  const id = 'test_'+Math.random().toString(36).slice(2);
  await CharacterStore.save({ id, name:'First' });
  await CharacterStore.save({ id, name:'Second' });
  const list = await CharacterStore.list();
  const matches = list.filter(c=>c.id===id);
  assert.equal(matches.length, 1, 'should not duplicate on re-save');
  assert.equal(matches[0].name, 'Second');
  await CharacterStore.remove(id);
});
