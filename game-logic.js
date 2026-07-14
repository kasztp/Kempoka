// Kempoka — shared game logic: belts, roster, move tables, combat math.
// Loaded as a classic <script> by index.html (exposes globals, same as before the split) AND
// require()'d directly by the Node unit tests — this file has zero DOM/canvas dependencies,
// which is exactly what makes it testable without a browser.
"use strict";
(function(root){

const GOLD = '#F5A800';

// ---------- Belt ranks (12th-1st Kyu, then Dan) -------------------------------
// ponytail: single source of truth for belt color/pattern. A character just
// references an id below (or null = no belt); add a new rank here, not per-fighter.
const KYU_RANKS = [
  { id:'kyu12', kyu:12, label:'White Belt',                             color:'#f2ede0' },
  { id:'kyu11', kyu:11, label:'Yellow Belt',                            color:'#e8c33a' },
  { id:'kyu10', kyu:10, label:'Orange Belt',                            color:'#d9782a' },
  { id:'kyu9',  kyu:9,  label:'Green Belt',                             color:'#3f8f4f' },
  { id:'kyu8',  kyu:8,  label:'Blue Belt',                              color:'#2b6cb0' },
  { id:'kyu7',  kyu:7,  label:'Purple Belt',                            color:'#6b3fa0' },
  { id:'kyu6',  kyu:6,  label:'Purple Belt (brown tip)',                color:'#6b3fa0', tip:'#6b3f1d' },
  { id:'kyu5',  kyu:5,  label:'Brown Belt (white stripe)',              color:'#6b3f1d', stripe:'#f2ede0' },
  { id:'kyu4',  kyu:4,  label:'Brown Belt (white stripe, black tip)',   color:'#6b3f1d', stripe:'#f2ede0', tip:'#141414' },
  { id:'kyu3',  kyu:3,  label:'Brown Belt',                             color:'#6b3f1d' },
  { id:'kyu2',  kyu:2,  label:'Brown Belt (black tip)',                 color:'#6b3f1d', tip:'#141414' },
  { id:'kyu1',  kyu:1,  label:'Brown Belt (black stripe)',              color:'#6b3f1d', stripe:'#141414' },
];
const DAN_RANKS = Array.from({length:5},(_,i)=>{ const n=i+1;
  return { id:'dan'+n, dan:n, label:n+(n===1?'st':n===2?'nd':n===3?'rd':'th')+' Dan (Black Belt)', color:'#141414', tip:GOLD }; });
const BELT_TABLE={}; [...KYU_RANKS,...DAN_RANKS].forEach(b=>BELT_TABLE[b.id]=b);
function getBelt(rankId){ return rankId ? BELT_TABLE[rankId] : null; }
// gi rule: below Blue belt = white pants + black top; Blue belt and up (incl. all Dan) = fully black
function giAboveBlue(rankId){ const b=getBelt(rankId); return !b || b.dan!=null || b.kyu<=8; }
const GI_BLACK='#161616', GI_WHITE='#e9e3d2';
const BELT_CHOICES=[null, ...KYU_RANKS.map(b=>b.id), ...DAN_RANKS.map(b=>b.id)];
function beltLabel(id){ const b=getBelt(id); return b?b.label:'No Belt'; }

// ---------- Roster (add a character = add one object here) --------------------
// ponytail: this array is the whole mod point. New fighter -> new entry. A novel
// special needs a matching case in doSpecial(); reusing a type below needs no code.
const CHARACTERS = [
  { id:'rob', name:'Sensei Rob', beltRank:'dan1', outfit:'gi',
    build:{scale:1.02,girth:1.0}, skin:'#e8b98f', hair:{color:'#3a2a1a',style:'short'}, beard:false,
    stats:{maxHp:110,speed:1.05,power:1.05,defense:1.08},
    special:{name:'Renraku', type:'combo'} },
  { id:'zsolti', name:'Zsolti', beltRank:'kyu3', outfit:'gi',
    build:{scale:1.2,girth:1.45}, skin:'#e5b083', hair:{color:'#4a3320',style:'short'}, beard:true,
    stats:{maxHp:132,speed:0.82,power:1.3,defense:1.18},
    special:{name:'Ippon Seoi', type:'throw'} },
  { id:'endre', name:'Endre', beltRank:'kyu3', outfit:'gi',
    build:{scale:0.86,girth:0.92}, skin:'#e3ab7d', hair:{color:'#241a12',style:'short'}, beard:false,
    stats:{maxHp:92,speed:1.2,power:1.38,defense:0.84},
    special:{name:'Tobi Tsuki', type:'lunge'} },
  { id:'imi', name:'Imi', beltRank:null, outfit:'spandex', gi:'#16bcbc',
    build:{scale:1.0,girth:1.02}, skin:'#e6b489', hair:{color:'#2a2a2a',style:'short'}, beard:false,
    stats:{maxHp:106,speed:1.05,power:1.0,defense:1.0},
    special:{name:'Cleaver', type:'cleaver'} },
  { id:'dori', name:'Dori', beltRank:'kyu11', outfit:'gi',
    build:{scale:0.94,girth:0.9}, skin:'#f0c39c', hair:{color:'#b3401a',style:'braid'}, beard:false,
    stats:{maxHp:96,speed:1.32,power:0.86,defense:0.96},
    special:{name:'Mawashi Geri', type:'spin'} },
];

// ---------- Character persistence ---------------------------------------------
// ponytail: localStorage-backed for now, but every call returns a Promise — a future
// fetch()-based cloud store (shared roster across players) is a drop-in swap; nothing
// that calls CharacterStore assumes synchronous storage. Falls back to an in-memory
// store when localStorage doesn't exist or isn't actually functional (Node's own experimental
// `localStorage` global exists but throws/no-ops without a --localstorage-file flag), so this
// same file runs unmodified in both the browser and `node --test`.
const CharacterStore = (()=>{
  const KEY='kmp_custom_characters';
  const hasRealStorage = typeof localStorage!=='undefined' && typeof localStorage.setItem==='function';
  const storage = hasRealStorage ? localStorage : (()=>{
    const mem={};
    return { getItem:k=>(k in mem ? mem[k] : null), setItem:(k,v)=>{mem[k]=v;}, removeItem:k=>{delete mem[k];} };
  })();
  function readAll(){ try{ return JSON.parse(storage.getItem(KEY)||'[]'); }catch(e){ return []; } }
  function writeAll(list){ storage.setItem(KEY, JSON.stringify(list)); }
  return {
    list(){ return Promise.resolve(readAll()); },
    save(char){ const all=readAll(); const i=all.findIndex(c=>c.id===char.id); if(i>=0) all[i]=char; else all.push(char); writeAll(all); return Promise.resolve(char); },
    remove(id){ writeAll(readAll().filter(c=>c.id!==id)); return Promise.resolve(); },
  };
})();

// ---------- Move tables ------------------------------------------------------
// MOVES = bases used by specials. PUNCHES / KICKS = normal attacks, keyed by the
// held direction relative to the opponent: neutral | toward | back | up | down.
// top/bot are the hitbox band as a fraction of fighter height (so head strikes hit
// high, body/low strikes hit low). This is the whole "moveset" — pure data.
const MOVES = {
  punch:{ dur:0.30, active:[0.09,0.17], reach:56, top:-0.66, bot:-0.5, dmg:6,  knock:180, pose:'punch' },
  kick: { dur:0.44, active:[0.15,0.28], reach:78, top:-0.5,  bot:-0.28, dmg:10, knock:300, pose:'kick'  },
};
const PUNCHES = {
  neutral:{ name:'Jab',        dur:0.24, active:[0.06,0.12], reach:52, top:-0.74, bot:-0.60, dmg:5,  knock:150, pose:'jab'   },
  toward: { name:'Cross',      dur:0.34, active:[0.11,0.19], reach:64, top:-0.72, bot:-0.58, dmg:9,  knock:270, pose:'cross' },
  up:     { name:'Uppercut',   dur:0.42, active:[0.10,0.20], reach:46, top:-0.88, bot:-0.52, dmg:11, knock:170, launch:-430, pose:'upper' },
  down:   { name:'Body hook',  dur:0.32, active:[0.10,0.18], reach:50, top:-0.56, bot:-0.40, dmg:8,  knock:170, pose:'hookB' },
  back:   { name:'Head hook',  dur:0.40, active:[0.13,0.22], reach:58, top:-0.78, bot:-0.62, dmg:10, knock:240, pose:'hookH' },
};
const KICKS = {
  neutral:{ name:'Front kick (tepe)', dur:0.40, active:[0.13,0.24], reach:86, top:-0.62, bot:-0.46, dmg:9,  knock:380, pose:'tepe'  },
  down:   { name:'Low kick',          dur:0.32, active:[0.10,0.20], reach:72, top:-0.24, bot:-0.06, dmg:8,  knock:140, pose:'low'   },
  toward: { name:'Roundhouse (ribs)', dur:0.46, active:[0.16,0.28], reach:86, top:-0.60, bot:-0.42, dmg:12, knock:320, pose:'round' },
  back:   { name:'Side kick (ribs)',  dur:0.44, active:[0.16,0.28], reach:94, top:-0.58, bot:-0.44, dmg:11, knock:360, pose:'round' },
  up:     { name:'Head kick',         dur:0.54, active:[0.20,0.32], reach:88, top:-0.94, bot:-0.70, dmg:15, knock:410, pose:'roundH'},
};
const GRAV=2200, JUMP_V=-820, CLINCH_RANGE=64, CLINCH_WINDOW=1.5, REVERSAL_WINDOW=0.4;
const ROUND_TIME=60, WINS_NEEDED=2;

// ---------- Combat math (pure — no DOM, no globals besides the above) ---------
function computeDamage(base,attacker,defender,blocking){
  let d = base * attacker.char.stats.power / defender.char.stats.defense;
  if(blocking) d *= 0.2;
  return d;
}
function fh(f){ return 132*f.char.build.scale; }
function bodyRect(f){ const h=fh(f); const halfW=0.16*h*f.char.build.girth; return {x0:f.x-halfW,x1:f.x+halfW,y0:f.y-h,y1:f.y}; }
function rectsOverlap(a,b){ return a.x0<b.x1 && a.x1>b.x0 && a.y0<b.y1 && a.y1>b.y0; }
function inClinchRange(a,b){ return Math.abs(a.x-b.x) < CLINCH_RANGE && Math.abs(a.y-b.y) < 20; }
// you always auto-face the opponent; the held direction selects the move variant
// (relative to the opponent): up/down win, else toward/back, else neutral.
function faceDir(f,o){ return f.x<=o.x?1:-1; }
function moveDir(f,o,inp){
  if(inp.up) return 'up';
  if(inp.down) return 'down';
  const toOpp = faceDir(f,o);   // +1 = opponent is to the right
  if((toOpp>0&&inp.right)||(toOpp<0&&inp.left)) return 'toward';
  if((toOpp>0&&inp.left)||(toOpp<0&&inp.right)) return 'back';
  return 'neutral';
}

const exportsObj = {
  GOLD, KYU_RANKS, DAN_RANKS, BELT_TABLE, getBelt, giAboveBlue, GI_BLACK, GI_WHITE, BELT_CHOICES, beltLabel,
  CHARACTERS, CharacterStore,
  MOVES, PUNCHES, KICKS, GRAV, JUMP_V, CLINCH_RANGE, CLINCH_WINDOW, REVERSAL_WINDOW, ROUND_TIME, WINS_NEEDED,
  computeDamage, fh, bodyRect, rectsOverlap, inClinchRange, faceDir, moveDir,
};

if(typeof module!=='undefined' && module.exports){ module.exports = exportsObj; }
else { Object.assign(root, exportsObj); }

})(typeof window!=='undefined' ? window : globalThis);
