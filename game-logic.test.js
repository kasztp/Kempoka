// Unit tests for game-logic.js — the DOM/canvas-free half of Kempoka (belts, roster, move
// tables, combat math). Run with: node --test
"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KYU_RANKS, DAN_RANKS, BELT_TABLE, getBelt, giAboveBlue, BELT_CHOICES, beltLabel,
  CHARACTERS, CharacterStore, SharedStore,
  HAIR_ORDER, BEARD_ORDER, SPECIAL_TYPE_IDS, normalizeCharacter,
  MOVES, PUNCHES, KICKS, CLINCH_RANGE,
  computeDamage, fh, bodyRect, rectsOverlap, inClinchRange, faceDir, moveDir,
  SUPPORTED_LANGS, I18N, t, detectDefaultLang,
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
test('CHARACTERS: five built-ins, unique ids, valid belt/outfit/stats/special', () => {
  assert.equal(CHARACTERS.length, 5);
  const ids = new Set(CHARACTERS.map(c=>c.id));
  assert.equal(ids.size, CHARACTERS.length, 'ids must be unique');
  for(const c of CHARACTERS){
    assert.ok(c.beltRank===null || BELT_TABLE[c.beltRank], `${c.name} has an unknown beltRank`);
    assert.ok(c.outfit==='gi' || c.outfit==='spandex', `${c.name} has an invalid outfit`);
    for(const k of ['maxHp','speed','power','defense']) assert.ok(c.stats[k]>0, `${c.name}.stats.${k} must be positive`);
    assert.ok(SPECIAL_TYPE_IDS.includes(c.special.type), `${c.name} has an unknown special type`);
  }
});

// ---------- character validation (the shared/persisted-data trust boundary) -------
test('normalizeCharacter: rejects non-objects and records with no usable id', () => {
  assert.equal(normalizeCharacter(null), null);
  assert.equal(normalizeCharacter(undefined), null);
  assert.equal(normalizeCharacter('nope'), null);
  assert.equal(normalizeCharacter({}), null);
  assert.equal(normalizeCharacter({id:''}), null);
});
test('normalizeCharacter: fills in every missing field with a safe default', () => {
  const c = normalizeCharacter({ id:'x' });
  assert.equal(c.name, 'Fighter');
  assert.equal(c.beltRank, null);
  assert.equal(c.outfit, 'gi');
  assert.equal(c.build.scale, 1.0); assert.equal(c.build.girth, 1.0);
  assert.equal(c.hair.style, 'short');
  assert.equal(c.beard, false);
  assert.equal(c.stats.maxHp, 100);
  assert.ok(SPECIAL_TYPE_IDS.includes(c.special.type));
  assert.equal(c.custom, true);
});
test('normalizeCharacter: clamps out-of-range stats/build to the Create-form slider bounds', () => {
  const c = normalizeCharacter({ id:'x', stats:{maxHp:9999,speed:-5,power:0,defense:0}, build:{scale:99,girth:-1} });
  assert.equal(c.stats.maxHp, 140); assert.equal(c.stats.speed, 0.8);
  assert.equal(c.stats.power, 0.8); assert.equal(c.stats.defense, 0.8);
  assert.equal(c.build.scale, 1.25); assert.equal(c.build.girth, 0.75);
});
test('normalizeCharacter: NaN/non-numeric stats fall back to the default rather than passing through', () => {
  const c = normalizeCharacter({ id:'x', stats:{maxHp:NaN,speed:'fast',power:undefined,defense:null} });
  assert.equal(c.stats.maxHp, 100); assert.equal(c.stats.speed, 1.0);
  assert.equal(c.stats.power, 1.0); assert.equal(c.stats.defense, 1.0);
});
test('normalizeCharacter: rejects unknown enum values (belt/outfit/hair/beard/special type)', () => {
  const c = normalizeCharacter({ id:'x', beltRank:'kyu99', outfit:'ninja', hair:{style:'mohawk'}, beard:'werewolf', special:{type:'fireball'} });
  assert.equal(c.beltRank, null); assert.equal(c.outfit, 'gi');
  assert.equal(c.hair.style, 'short'); assert.equal(c.beard, false); assert.equal(c.special.type, 'combo');
});
test('normalizeCharacter: accepts every real HAIR_ORDER/BEARD_ORDER/SPECIAL_TYPE_IDS value', () => {
  for(const style of HAIR_ORDER) assert.equal(normalizeCharacter({id:'x',hair:{style}}).hair.style, style);
  for(const beard of BEARD_ORDER) assert.equal(normalizeCharacter({id:'x',beard}).beard, beard);
  for(const type of SPECIAL_TYPE_IDS) assert.equal(normalizeCharacter({id:'x',special:{type}}).special.type, type);
});
test('normalizeCharacter: truncates over-long name/special.name to the input maxlength', () => {
  const c = normalizeCharacter({ id:'x', name:'x'.repeat(50), special:{name:'y'.repeat(50)} });
  assert.equal(c.name.length, 16);
  assert.equal(c.special.name.length, 22);
});
test('normalizeCharacter: rejects malformed hex colors, keeps valid ones', () => {
  const bad = normalizeCharacter({ id:'x', skin:'not-a-color', hair:{color:'javascript:alert(1)'}, gi:'#zzz' });
  assert.match(bad.skin, /^#[0-9a-fA-F]{3,8}$/);
  assert.match(bad.hair.color, /^#[0-9a-fA-F]{3,8}$/);
  assert.match(bad.gi, /^#[0-9a-fA-F]{3,8}$/);
  const good = normalizeCharacter({ id:'x', skin:'#123456' });
  assert.equal(good.skin, '#123456');
});
test('computeDamage: a zero or negative defense is floored, never producing Infinity/NaN', () => {
  const a=makeStub(), zeroDef=makeStub({char:{build:{scale:1,girth:1},stats:{power:1,speed:1,defense:0,maxHp:100}}});
  const negDef=makeStub({char:{build:{scale:1,girth:1},stats:{power:1,speed:1,defense:-5,maxHp:100}}});
  assert.ok(Number.isFinite(computeDamage(10,a,zeroDef,false)), 'defense:0 must not produce Infinity/NaN');
  assert.ok(Number.isFinite(computeDamage(10,a,negDef,false)), 'negative defense must not produce Infinity/NaN');
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

// ---------- SharedStore (Supabase-backed; degrades to no-ops without KEMPOKA_CONFIG) ----
test('SharedStore: with no backend configured, every method resolves safely and never throws', async () => {
  assert.deepEqual(await SharedStore.listCharacters(), []);
  assert.equal(await SharedStore.publishCharacter({id:'x'}, 'tok'), false);
  assert.equal(await SharedStore.unpublishCharacter('tok'), false);
  assert.equal(await SharedStore.submitScore({name:'a',score:100,beaten:1}, 'tok'), false);
  assert.deepEqual(await SharedStore.topScores(10), []);
});

// ---------- i18n ---------------------------------------------------------------
test('t: returns the requested language', () => {
  assert.equal(t('de', 'controls'), 'STEUERUNG');
  assert.equal(t('hu', 'mainMenu'), 'FŐMENÜ');
});
test('t: falls back to English for an unsupported language or missing key', () => {
  assert.equal(t('ja', 'controls'), I18N.controls.en);
  assert.equal(t('en', 'thisKeyDoesNotExist'), 'thisKeyDoesNotExist');
});
test('t: every key has a non-empty string for every supported language', () => {
  for(const [key, row] of Object.entries(I18N)){
    for(const lang of SUPPORTED_LANGS){
      assert.equal(typeof row[lang], 'string', `${key}.${lang} should be a string`);
      assert.ok(row[lang].length > 0, `${key}.${lang} should not be empty`);
    }
  }
});
test('detectDefaultLang: matches the first supported 2-letter prefix', () => {
  assert.equal(detectDefaultLang(['de-DE', 'en-US']), 'de');
  assert.equal(detectDefaultLang(['fr']), 'fr');
});
test('detectDefaultLang: falls back to en for unsupported languages or no input', () => {
  assert.equal(detectDefaultLang(['ja-JP', 'ko-KR']), 'en');
  assert.equal(detectDefaultLang([]), 'en');
  assert.equal(detectDefaultLang(undefined), 'en');
});

test('I18N: every belt in BELT_TABLE (plus "no belt") has a translated label', () => {
  const ids = ['none', ...Object.keys(BELT_TABLE)];
  for (const id of ids) {
    const key = 'belt_' + id;
    assert.ok(I18N[key], `missing I18N key ${key}`);
    for (const l of SUPPORTED_LANGS) assert.ok(I18N[key][l], `${key}.${l} missing`);
  }
});
