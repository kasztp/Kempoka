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

// ---------- Custom-character enums ---------------------------------------------
// ponytail: single source of truth for the Create-fighter enums, shared by the Create
// screen (index.html) and normalizeCharacter's validation below — was two copies
// (index.html + a third hardcoded in game-logic.test.js) before the shared-roster work.
const HAIR_ORDER = ['short','braid','bald','punk','leia','headguard'];
const BEARD_ORDER = ['none','full','moustache','goatee','long'];
const GLASSES_ORDER = ['none','sensei','dark','potter','monocle'];
const TINT_ORDER = ['black','brown','pink'];
const SPECIAL_TYPE_IDS = ['combo','throw','lunge','spin','cleaver'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

// ---------- Character validation -----------------------------------------------
// ponytail: the trust boundary for any character NOT authored by this codebase's own
// Create screen — persisted localStorage records today, a shared/cloud roster next.
// Clamps every stat to the same min/max the Create-form sliders enforce (index.html's
// cfHp/cfSpeed/... inputs), enforces every enum, and caps name lengths (matching the
// inputs' maxlength). Returns null for anything too broken to salvage (no id/name).
function normalizeCharacter(raw){
  if(!raw || typeof raw!=='object') return null;
  if(typeof raw.id!=='string' || !raw.id) return null;
  const num=(v,min,max,dflt)=> (typeof v==='number' && isFinite(v)) ? Math.min(max,Math.max(min,v)) : dflt;
  const str=(v,max,dflt)=> (typeof v==='string' && v.trim()) ? v.trim().slice(0,max) : dflt;
  const hex=(v,dflt)=> (typeof v==='string' && HEX_COLOR_RE.test(v)) ? v : dflt;
  const raw_build = raw.build||{}, raw_hair = raw.hair||{}, raw_stats = raw.stats||{}, raw_special = raw.special||{};
  return {
    id: raw.id,
    name: str(raw.name, 16, 'Fighter'),
    beltRank: BELT_CHOICES.includes(raw.beltRank) ? raw.beltRank : null,
    outfit: raw.outfit==='spandex' ? 'spandex' : 'gi',
    gi: hex(raw.gi, '#16bcbc'),
    build: { scale: num(raw_build.scale,0.8,1.25,1.0), girth: num(raw_build.girth,0.75,1.5,1.0) },
    skin: hex(raw.skin, '#e8b98f'),
    hair: { color: hex(raw_hair.color, '#2a2a2a'), style: HAIR_ORDER.includes(raw_hair.style) ? raw_hair.style : 'short' },
    beard: raw.beard===true || BEARD_ORDER.includes(raw.beard) ? raw.beard : false,
    glasses: GLASSES_ORDER.includes(raw.glasses) ? raw.glasses : 'none',
    glassesTint: TINT_ORDER.includes(raw.glassesTint) ? raw.glassesTint : 'black',
    stats: {
      maxHp: num(raw_stats.maxHp,80,140,100),
      speed: num(raw_stats.speed,0.8,1.35,1.0),
      power: num(raw_stats.power,0.8,1.4,1.0),
      defense: num(raw_stats.defense,0.8,1.2,1.0),
    },
    special: {
      name: str(raw_special.name, 22, 'Special'),
      type: SPECIAL_TYPE_IDS.includes(raw_special.type) ? raw_special.type : 'combo',
    },
    custom: true,
  };
}

// ponytail: browser localStorage, or an in-memory fallback so this file runs unmodified
// under `node --test` (Node's own experimental `localStorage` global exists but throws/no-ops
// without a --localstorage-file flag). Shared by CharacterStore and the Supabase session below.
function kvStore(){
  const hasReal = typeof localStorage!=='undefined' && typeof localStorage.setItem==='function';
  if(hasReal) return localStorage;
  const mem={};
  return { getItem:k=>(k in mem ? mem[k] : null), setItem:(k,v)=>{mem[k]=v;}, removeItem:k=>{delete mem[k];} };
}

// ---------- Character persistence ---------------------------------------------
// ponytail: localStorage-backed for now, but every call returns a Promise — a future
// fetch()-based cloud store (shared roster across players) is a drop-in swap; nothing
// that calls CharacterStore assumes synchronous storage.
const CharacterStore = (()=>{
  const KEY='kmp_custom_characters';
  const storage = kvStore();
  // raw records are normalized on the way out — the one point every persisted character
  // (hand-edited storage today, a shared/cloud roster next) passes through before reaching
  // the roster, combat math, or rendering. Malformed entries are dropped rather than crashing.
  function readAll(){ try{ return JSON.parse(storage.getItem(KEY)||'[]').map(normalizeCharacter).filter(Boolean); }catch(e){ return []; } }
  function writeAll(list){ storage.setItem(KEY, JSON.stringify(list)); }
  return {
    list(){ return Promise.resolve(readAll()); },
    save(char){ const all=readAll(); const i=all.findIndex(c=>c.id===char.id); if(i>=0) all[i]=char; else all.push(char); writeAll(all); return Promise.resolve(char); },
    remove(id){ writeAll(readAll().filter(c=>c.id!==id)); return Promise.resolve(); },
  };
})();

// ---------- Shared backend (Supabase): anonymous auth + write gateway ----------------------
// ponytail: config comes from a global KEMPOKA_CONFIG (see config.js, loaded before this file
// in index.html). No config (or an unreachable network) means every SharedStore method below
// resolves to an empty/no-op result — the shared roster & highscore feature is entirely
// optional, and the game plays exactly as it always has when opened offline/local.
function sharedConfig(){
  const c = typeof KEMPOKA_CONFIG!=='undefined' ? KEMPOKA_CONFIG : undefined;
  return (c && c.SUPABASE_URL && c.SUPABASE_PUBLISHABLE_KEY) ? c : null;
}

// One real Supabase-managed anonymous session per browser (auth.uid() is the ownership
// identity — see supabase-schema.sql). No email/password; just a JWT persisted locally.
const SupaAuth = (()=>{
  const KEY='kmp_supabase_session';
  const store = kvStore();
  function readSession(){ try{ return JSON.parse(store.getItem(KEY)||'null'); }catch(e){ return null; } }
  function writeSession(tokens){ store.setItem(KEY, JSON.stringify(tokens)); return tokens; }
  async function signUpAnonymous(cfg){
    const res = await fetch(cfg.SUPABASE_URL+'/auth/v1/signup', {
      method:'POST', headers:{ 'Content-Type':'application/json', apikey:cfg.SUPABASE_PUBLISHABLE_KEY }, body:'{}',
    });
    if(!res.ok) throw new Error('anonymous sign-up failed: '+res.status);
    const json = await res.json();
    return writeSession({ access_token:json.access_token, refresh_token:json.refresh_token });
  }
  async function refresh(cfg, refreshToken){
    const res = await fetch(cfg.SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token', {
      method:'POST', headers:{ 'Content-Type':'application/json', apikey:cfg.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if(!res.ok) return null;
    const json = await res.json();
    return writeSession({ access_token:json.access_token, refresh_token:json.refresh_token });
  }
  async function accessToken(){
    const cfg = sharedConfig(); if(!cfg) return null;
    const session = readSession() || await signUpAnonymous(cfg).catch(()=>null);
    return session ? session.access_token : null;
  }
  // Wraps a fetch call with the caller's bearer token, retrying once with a refreshed
  // token on a 401 (an expired access token, not a real auth failure).
  async function authedFetch(url, opts){
    const cfg = sharedConfig(); if(!cfg) throw new Error('no shared backend configured');
    const token = await accessToken(); if(!token) throw new Error('no session');
    const withAuth = t=>Object.assign({}, opts, { headers: Object.assign({}, opts.headers, { apikey:cfg.SUPABASE_PUBLISHABLE_KEY, Authorization:'Bearer '+t }) });
    let res = await fetch(url, withAuth(token));
    if(res.status===401){
      const session = readSession();
      const refreshed = session && await refresh(cfg, session.refresh_token);
      if(refreshed) res = await fetch(url, withAuth(refreshed.access_token));
    }
    return res;
  }
  return { accessToken, authedFetch };
})();

// Public reads go straight to PostgREST; all writes go through the kempoka-write Edge
// Function (Turnstile-verified, service_role) — see supabase-schema.sql for why direct
// writes are denied by RLS. Every method degrades to []/false rather than throwing.
const SharedStore = (()=>{
  async function listCharacters(){
    const cfg = sharedConfig(); if(!cfg) return [];
    try{
      const res = await fetch(cfg.SUPABASE_URL+'/rest/v1/characters?select=data', { headers:{ apikey:cfg.SUPABASE_PUBLISHABLE_KEY } });
      if(!res.ok) return [];
      const rows = await res.json();
      return rows.map(r=>normalizeCharacter(r.data)).filter(Boolean);
    }catch(e){ return []; }
  }
  async function writeAction(action, payload, turnstileToken){
    const cfg = sharedConfig(); if(!cfg) return false;
    try{
      const res = await SupaAuth.authedFetch(cfg.SUPABASE_URL+'/functions/v1/kempoka-write', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ action, payload, turnstileToken }),
      });
      return res.ok;
    }catch(e){ return false; }
  }
  async function topScores(limit){
    const cfg = sharedConfig(); if(!cfg) return [];
    try{
      const res = await fetch(cfg.SUPABASE_URL+'/rest/v1/scores?select=name,score,beaten&order=score.desc&limit='+(limit||20), { headers:{ apikey:cfg.SUPABASE_PUBLISHABLE_KEY } });
      return res.ok ? await res.json() : [];
    }catch(e){ return []; }
  }
  return {
    // lets the UI hide publish/tournament-submit affordances entirely when no backend is
    // configured, instead of rendering a Turnstile widget for a feature that's fully off.
    isConfigured:()=>!!sharedConfig(),
    listCharacters,
    publishCharacter:(char, turnstileToken)=>writeAction('publish_character', char, turnstileToken),
    unpublishCharacter:(turnstileToken)=>writeAction('unpublish_character', null, turnstileToken),
    submitScore:(entry, turnstileToken)=>writeAction('submit_score', entry, turnstileToken),
    topScores,
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
// Tournament mode: one round per opponent (no best-of-3), so it needs longer than a normal
// round to be a fair single shot — 120s, unlike ROUND_TIME which only ever decides one of three.
const TOURNEY_ROUND_TIME=120;

// ---------- Combat math (pure — no DOM, no globals besides the above) ---------
function computeDamage(base,attacker,defender,blocking){
  // ponytail: floor guards against a persisted/shared defense:0 (or negative) producing
  // Infinity/NaN damage, which would leave HP stuck at NaN and the round unable to end.
  const defense = Math.max(0.1, defender.char.stats.defense);
  let d = base * attacker.char.stats.power / defense;
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

// ---------- i18n ---------------------------------------------------------------
// ponytail: key-major dictionary (one row per string, all 6 langs inline) instead of
// lang-major nesting — easier to spot a missing translation while writing/reviewing a row.
// Fighter names and special.name values are NOT looked up here by design (Japanese
// loanwords, stay as authored in CHARACTERS above regardless of UI language).
const SUPPORTED_LANGS = ['en','de','es','it','fr','hu'];
const I18N = {
  onePlayer:{en:'1 PLAYER',de:'1 SPIELER',es:'1 JUGADOR',it:'1 GIOCATORE',fr:'1 JOUEUR',hu:'1 JÁTÉKOS'},
  twoPlayers:{en:'2 PLAYERS',de:'2 SPIELER',es:'2 JUGADORES',it:'2 GIOCATORI',fr:'2 JOUEURS',hu:'2 JÁTÉKOS'},
  controls:{en:'CONTROLS',de:'STEUERUNG',es:'CONTROLES',it:'COMANDI',fr:'COMMANDES',hu:'IRÁNYÍTÁS'},
  music:{en:'MUSIC',de:'MUSIK',es:'MÚSICA',it:'MUSICA',fr:'MUSIQUE',hu:'ZENE'},
  sfx:{en:'SFX',de:'SFX',es:'SFX',it:'SFX',fr:'SFX',hu:'SFX'},
  gfx:{en:'GFX',de:'GFX',es:'GFX',it:'GFX',fr:'GFX',hu:'GFX'},
  classic:{en:'CLASSIC',de:'KLASSISCH',es:'CLÁSICO',it:'CLASSICO',fr:'CLASSIQUE',hu:'KLASSZIKUS'},
  pixel:{en:'PIXEL',de:'PIXEL',es:'PÍXEL',it:'PIXEL',fr:'PIXEL',hu:'PIXEL'},
  '3d':{en:'3D',de:'3D',es:'3D',it:'3D',fr:'3D',hu:'3D'},
  on:{en:'ON',de:'AN',es:'SÍ',it:'SÌ',fr:'OUI',hu:'BE'},
  off:{en:'OFF',de:'AUS',es:'NO',it:'NO',fr:'NON',hu:'KI'},
  auto:{en:'AUTO',de:'AUTO',es:'AUTO',it:'AUTO',fr:'AUTO',hu:'AUTO'},
  back:{en:'BACK',de:'ZURÜCK',es:'ATRÁS',it:'INDIETRO',fr:'RETOUR',hu:'VISSZA'},
  create:{en:'CREATE',de:'ERSTELLEN',es:'CREAR',it:'CREA',fr:'CRÉER',hu:'LÉTREHOZ'},
  createFighter:{en:'CREATE FIGHTER',de:'KÄMPFER ERSTELLEN',es:'CREAR LUCHADOR',it:'CREA LOTTATORE',fr:'CRÉER UN COMBATTANT',hu:'HARCOS LÉTREHOZÁSA'},
  player1Keyboard:{en:'PLAYER 1  (keyboard)',de:'SPIELER 1  (Tastatur)',es:'JUGADOR 1  (teclado)',it:'GIOCATORE 1  (tastiera)',fr:'JOUEUR 1  (clavier)',hu:'1. JÁTÉKOS  (billentyűzet)'},
  player1Line1:{en:'A / D — move    W — jump    S — crouch',de:'A / D — bewegen    W — springen    S — ducken',es:'A / D — mover    W — saltar    S — agacharse',it:'A / D — muovi    W — salta    S — accovacciati',fr:'A / D — déplacer    W — sauter    S — s\'accroupir',hu:'A / D — mozgás    W — ugrás    S — guggolás'},
  player1Line2:{en:'J — punch    K — kick    L — block',de:'J — Schlag    K — Tritt    L — blocken',es:'J — puñetazo    K — patada    L — bloquear',it:'J — pugno    K — calcio    L — parata',fr:'J — coup de poing    K — coup de pied    L — bloquer',hu:'J — ütés    K — rúgás    L — védés'},
  player1Line3:{en:'U — special    I — grab / counter',de:'U — Spezialangriff    I — greifen / Konter',es:'U — especial    I — agarrar / contra',it:'U — speciale    I — presa / contro',fr:'U — spécial    I — saisir / contre',hu:'U — különleges    I — dobás / ellenütés'},
  player2Keyboard:{en:'PLAYER 2  (2P keyboard)',de:'SPIELER 2  (2P-Tastatur)',es:'JUGADOR 2  (teclado 2J)',it:'GIOCATORE 2  (tastiera 2G)',fr:'JOUEUR 2  (clavier 2J)',hu:'2. JÁTÉKOS  (2J billentyűzet)'},
  player2Line1:{en:'← / → — move    ↑ — jump    ↓ — crouch',de:'← / → — bewegen    ↑ — springen    ↓ — ducken',es:'← / → — mover    ↑ — saltar    ↓ — agacharse',it:'← / → — muovi    ↑ — salta    ↓ — accovacciati',fr:'← / → — déplacer    ↑ — sauter    ↓ — s\'accroupir',hu:'← / → — mozgás    ↑ — ugrás    ↓ — guggolás'},
  player2Line2:{en:'Num 1 — punch   Num 2 — kick   Num 3 — block',de:'Num 1 — Schlag   Num 2 — Tritt   Num 3 — blocken',es:'Num 1 — puñetazo   Num 2 — patada   Num 3 — bloquear',it:'Num 1 — pugno   Num 2 — calcio   Num 3 — parata',fr:'Num 1 — coup de poing   Num 2 — coup de pied   Num 3 — bloquer',hu:'Num 1 — ütés   Num 2 — rúgás   Num 3 — védés'},
  player2Line3:{en:'Num 0 — special   Num 4 — grab / counter',de:'Num 0 — Spezialangriff   Num 4 — greifen / Konter',es:'Num 0 — especial   Num 4 — agarrar / contra',it:'Num 0 — speciale   Num 4 — presa / contro',fr:'Num 0 — spécial   Num 4 — saisir / contre',hu:'Num 0 — különleges   Num 4 — dobás / ellenütés'},
  movesHeader:{en:'MOVES  ( hold a direction + attack button )',de:'BEWEGUNGEN  ( Richtung + Angriffstaste halten )',es:'MOVIMIENTOS  ( mantén una dirección + botón de ataque )',it:'MOSSE  ( tieni premuta una direzione + tasto attacco )',fr:'COUPS  ( maintenez une direction + bouton d\'attaque )',hu:'MOZDULATOK  ( tarts lenyomva egy irányt + támadógombot )'},
  movesSub:{en:'→ = toward the opponent   ← = away   (you always auto-face the foe)',de:'→ = zum Gegner   ← = weg   (du drehst dich automatisch zum Gegner)',es:'→ = hacia el rival   ← = alejarse   (siempre miras automáticamente al rival)',it:'→ = verso l\'avversario   ← = lontano   (ti giri sempre automaticamente verso l\'avversario)',fr:'→ = vers l\'adversaire   ← = en s\'éloignant   (vous faites toujours face à l\'adversaire)',hu:'→ = az ellenfél felé   ← = távolodva   (mindig automatikusan az ellenfél felé fordulsz)'},
  punchLabel:{en:'PUNCH',de:'SCHLAG',es:'PUÑETAZO',it:'PUGNO',fr:'COUP DE POING',hu:'ÜTÉS'},
  punchDesc:{en:'Jab   ·   → Cross   ·   ↑ Uppercut   ·   ↓ Body hook   ·   ← Head hook',de:'Jab   ·   → Cross   ·   ↑ Aufwärtshaken   ·   ↓ Körperhaken   ·   ← Kopfhaken',es:'Jab   ·   → Cruzado   ·   ↑ Gancho ascendente   ·   ↓ Gancho al cuerpo   ·   ← Gancho a la cabeza',it:'Jab   ·   → Diretto   ·   ↑ Montante   ·   ↓ Gancio al corpo   ·   ← Gancio alla testa',fr:'Jab   ·   → Direct   ·   ↑ Uppercut   ·   ↓ Crochet au corps   ·   ← Crochet à la tête',hu:'Jab   ·   → Egyenes   ·   ↑ Felütés   ·   ↓ Testhorog   ·   ← Fejhorog'},
  kickLabel:{en:'KICK',de:'TRITT',es:'PATADA',it:'CALCIO',fr:'COUP DE PIED',hu:'RÚGÁS'},
  kickDesc:{en:'Front / tepe   ·   ↓ Low kick   ·   → Roundhouse (ribs)   ·   ← Side kick   ·   ↑ Head kick',de:'Frontkick / Tepe   ·   ↓ Low Kick   ·   → Roundhouse (Rippen)   ·   ← Seitkick   ·   ↑ Kopftritt',es:'Frontal / tepe   ·   ↓ Patada baja   ·   → Circular (costillas)   ·   ← Patada lateral   ·   ↑ Patada a la cabeza',it:'Frontale / tepe   ·   ↓ Calcio basso   ·   → Rotante (costole)   ·   ← Calcio laterale   ·   ↑ Calcio alla testa',fr:'Frontal / tepe   ·   ↓ Coup de pied bas   ·   → Circulaire (côtes)   ·   ← Coup de pied latéral   ·   ↑ Coup de pied à la tête',hu:'Egyenes / tepe   ·   ↓ Alacsony rúgás   ·   → Köríves (bordák)   ·   ← Oldalrúgás   ·   ↑ Fejrúgás'},
  grabLabel:{en:'GRAB',de:'GREIFEN',es:'AGARRE',it:'PRESA',fr:'SAISIE',hu:'DOBÁS'},
  grabDesc:{en:'Clinch   ·   ↓ Double-leg   ·   ← Single-leg   ·   ↑ Judo throw',de:'Clinch   ·   ↓ Doppel-Beingriff   ·   ← Einzel-Beingriff   ·   ↑ Judowurf',es:'Clinch   ·   ↓ Doble pierna   ·   ← Pierna simple   ·   ↑ Proyección de judo',it:'Clinch   ·   ↓ Doppia gamba   ·   ← Singola gamba   ·   ↑ Proiezione di judo',fr:'Clinch   ·   ↓ Double jambe   ·   ← Simple jambe   ·   ↑ Projection de judo',hu:'Klincs   ·   ↓ Dupla lábfogás   ·   ← Egyszeres lábfogás   ·   ↑ Judódobás'},
  clinchNote:{en:'In a clinch: punch = throw · kick a stunned foe = choke · the grabbed fighter taps grab to escape/reverse.',de:'Im Clinch: Schlag = Wurf · Tritt gegen betäubten Gegner = Würgegriff · der Gegriffene drückt Greifen zum Entkommen/Kontern.',es:'En el clinch: puñetazo = proyección · patada a un rival aturdido = estrangulación · el agarrado pulsa agarre para escapar/revertir.',it:'Nel clinch: pugno = proiezione · calcio a un avversario stordito = strangolamento · l\'afferrato preme presa per fuggire/ribaltare.',fr:'En clinch : coup de poing = projection · coup de pied sur un adversaire étourdi = étranglement · le combattant saisi appuie sur saisie pour s\'échapper/renverser.',hu:'Klincsben: ütés = dobás · rúgás egy kábult ellenfélre = fojtás · a megfogott harcos a dobás gombbal szabadulhat/fordíthat.'},
  bullet1:{en:'• Uppercut & head kick beat jump-ins; low kick & body hook stay under high strikes.',de:'• Aufwärtshaken & Kopftritt kontern Sprungangriffe; Low Kick & Körperhaken bleiben unter hohen Treffern.',es:'• El gancho ascendente y la patada a la cabeza vencen los saltos; la patada baja y el gancho al cuerpo pasan bajo los golpes altos.',it:'• Montante e calcio alla testa battono i salti; calcio basso e gancio al corpo restano sotto i colpi alti.',fr:'• L\'uppercut et le coup de pied à la tête battent les sauts ; le coup de pied bas et le crochet au corps restent sous les frappes hautes.',hu:'• A felütés és a fejrúgás legyőzi az ugrásokat; az alacsony rúgás és a testhorog a magas ütések alatt marad.'},
  bullet2:{en:'• Punches & kicks work in mid-air. Blocks, grabs, throws & chokes are ground-only.',de:'• Schläge & Tritte funktionieren auch in der Luft. Blocken, Greifen, Werfen & Würgen nur am Boden.',es:'• Los puñetazos y patadas funcionan en el aire. Bloquear, agarrar, proyectar y estrangular solo en tierra.',it:'• Pugni e calci funzionano anche in aria. Parate, prese, proiezioni e strangolamenti solo a terra.',fr:'• Les coups de poing et de pied fonctionnent en l\'air. Blocages, saisies, projections et étranglements sont au sol uniquement.',hu:'• Az ütések és rúgások levegőben is működnek. A védés, dobás és fojtás csak talajon lehetséges.'},
  bullet3:{en:'• Takedowns whiff (and can be punished) if you shoot out of range or into a block.',de:'• Takedowns gehen daneben (und können bestraft werden), wenn du außer Reichweite oder in einen Block ansetzt.',es:'• Los derribos fallan (y pueden ser castigados) si te lanzas fuera de rango o contra un bloqueo.',it:'• Le proiezioni falliscono (e possono essere punite) se scatti fuori portata o contro una parata.',fr:'• Les projections échouent (et peuvent être punies) si vous vous élancez hors de portée ou dans un blocage.',hu:'• A leszorítások félremennek (és büntethetők), ha hatótávolságon kívülről vagy védésbe indítod.'},
  touchNote:{en:'AUTO shows the on-screen pad on touchscreens only; ON forces it (preview on desktop).',de:'AUTO zeigt das Pad nur auf Touchscreens; AN erzwingt es (Vorschau am Desktop).',es:'AUTO muestra el panel solo en pantallas táctiles; SÍ lo fuerza (vista previa en escritorio).',it:'AUTO mostra il pad solo su schermi touch; SÌ lo forza (anteprima su desktop).',fr:'AUTO affiche le pad uniquement sur écrans tactiles ; OUI le force (aperçu sur ordinateur).',hu:'Az AUTO csak érintőképernyőn mutatja a panelt; a BE mindig megjeleníti (asztali előnézet).'},
  touchButtons:{en:'TOUCH BUTTONS',de:'TOUCH-TASTEN',es:'BOTONES TÁCTILES',it:'PULSANTI TOUCH',fr:'BOUTONS TACTILES',hu:'ÉRINTŐGOMBOK'},
  touchHint:{en:'On the touch pad, hold a D-pad direction together with an attack button for the variants.',de:'Halte auf dem Touch-Pad eine Richtung zusammen mit einer Angriffstaste für die Varianten.',es:'En el panel táctil, mantén una dirección junto con un botón de ataque para las variantes.',it:'Sul pad touch, tieni premuta una direzione insieme a un tasto attacco per le varianti.',fr:'Sur le pad tactile, maintenez une direction avec un bouton d\'attaque pour les variantes.',hu:'Az érintőpanelen tarts lenyomva egy irányt egy támadógombbal együtt a változatokért.'},
  touchJump:{en:'JUMP',de:'SPRUNG',es:'SALTO',it:'SALTO',fr:'SAUT',hu:'UGRÁS'},
  touchDuck:{en:'DUCK',de:'DUCKEN',es:'AGACH',it:'ACCOV',fr:'BAISSE',hu:'GUGGOL'},
  touchPunch:{en:'P',de:'S',es:'PUÑO',it:'P',fr:'POING',hu:'Ü'},
  touchKick:{en:'K',de:'T',es:'PATADA',it:'C',fr:'PIED',hu:'R'},
  touchBlock:{en:'BLK',de:'BLK',es:'BLQ',it:'PAR',fr:'BLQ',hu:'VÉD'},
  touchSpecial:{en:'SP',de:'SP',es:'ESP',it:'SP',fr:'SP',hu:'SP'},
  touchGrab:{en:'GRAB',de:'GREIF',es:'AGARR',it:'PRESA',fr:'SAISIE',hu:'DOBÁS'},
  name:{en:'NAME',de:'NAME',es:'NOMBRE',it:'NOME',fr:'NOM',hu:'NÉV'},
  beltRank:{en:'BELT RANK',de:'GURTGRAD',es:'GRADO DE CINTURÓN',it:'GRADO CINTURA',fr:'GRADE DE CEINTURE',hu:'ÖVFOKOZAT'},
  gi:{en:'GI',de:'GI',es:'GI',it:'GI',fr:'GI',hu:'GI'},
  spandex:{en:'RASHGUARD',de:'RASHGUARD',es:'RASHGUARD',it:'RASHGUARD',fr:'RASHGUARD',hu:'RASHGUARD'},
  outfitCaption:{en:'OUTFIT',de:'OUTFIT',es:'ATUENDO',it:'ABITO',fr:'TENUE',hu:'RUHA'},
  hairstyleCaption:{en:'HAIRSTYLE',de:'FRISUR',es:'PEINADO',it:'ACCONCIATURA',fr:'COIFFURE',hu:'FRIZURA'},
  hairShort:{en:'SHORT',de:'KURZ',es:'CORTO',it:'CORTI',fr:'COURTS',hu:'RÖVID'},
  hairBraid:{en:'BRAID',de:'ZOPF',es:'TRENZA',it:'TRECCIA',fr:'TRESSE',hu:'COPF'},
  hairBald:{en:'BALD',de:'GLATZE',es:'CALVO',it:'CALVO',fr:'CHAUVE',hu:'KOPASZ'},
  hairPunk:{en:'PUNK',de:'PUNK',es:'PUNK',it:'PUNK',fr:'PUNK',hu:'PUNK'},
  hairLeia:{en:'BUNS',de:'HAARKNOTEN',es:'MOÑOS',it:'CHIGNON',fr:'CHIGNONS',hu:'KONTY'},
  hairHeadguard:{en:'HEADGUARD',de:'KOPFSCHUTZ',es:'CASCO',it:'CASCHETTO',fr:'CASQUE',hu:'FEJVÉDŐ'},
  beard:{en:'BEARD',de:'BART',es:'BARBA',it:'BARBA',fr:'BARBE',hu:'SZAKÁLL'},
  beardNone:{en:'NONE',de:'KEIN',es:'NINGUNA',it:'NESSUNA',fr:'AUCUNE',hu:'NINCS'},
  beardFull:{en:'FULL',de:'VOLL',es:'COMPLETA',it:'COMPLETA',fr:'COMPLÈTE',hu:'TELJES'},
  beardMoustache:{en:'MOUSTACHE',de:'SCHNURRBART',es:'BIGOTE',it:'BAFFI',fr:'MOUSTACHE',hu:'BAJUSZ'},
  beardGoatee:{en:'GOATEE',de:'KINNBART',es:'PERILLA',it:'PIZZETTO',fr:'BOUC',hu:'KECSKESZAKÁLL'},
  beardLong:{en:'OLD MASTER',de:'ALTER MEISTER',es:'VIEJO MAESTRO',it:'VECCHIO MAESTRO',fr:'VIEUX MAÎTRE',hu:'ÖREG MESTER'},
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
  skin:{en:'SKIN',de:'HAUT',es:'PIEL',it:'PELLE',fr:'PEAU',hu:'BŐR'},
  hair:{en:'HAIR',de:'HAAR',es:'PELO',it:'CAPELLI',fr:'CHEVEUX',hu:'HAJ'},
  outfitColor:{en:'OUTFIT COLOR',de:'OUTFIT-FARBE',es:'COLOR DEL ATUENDO',it:'COLORE ABITO',fr:'COULEUR DE LA TENUE',hu:'RUHA SZÍNE'},
  stats:{en:'STATS',de:'WERTE',es:'ESTADÍSTICAS',it:'STATISTICHE',fr:'STATISTIQUES',hu:'ÉRTÉKEK'},
  build:{en:'BUILD',de:'KÖRPERBAU',es:'COMPLEXIÓN',it:'FISICO',fr:'CARRURE',hu:'TESTALKAT'},
  specialMove:{en:'SPECIAL MOVE',de:'SPEZIALANGRIFF',es:'MOVIMIENTO ESPECIAL',it:'MOSSA SPECIALE',fr:'COUP SPÉCIAL',hu:'KÜLÖNLEGES MOZDULAT'},
  hp:{en:'HP',de:'LP',es:'PV',it:'PV',fr:'PV',hu:'ÉP'},
  speedStat:{en:'Speed',de:'Geschwindigkeit',es:'Velocidad',it:'Velocità',fr:'Vitesse',hu:'Sebesség'},
  powerStat:{en:'Power',de:'Kraft',es:'Poder',it:'Potenza',fr:'Puissance',hu:'Erő'},
  defenseStat:{en:'Defense',de:'Verteidigung',es:'Defensa',it:'Difesa',fr:'Défense',hu:'Védekezés'},
  heightStat:{en:'Height',de:'Größe',es:'Altura',it:'Altezza',fr:'Taille',hu:'Magasság'},
  girthStat:{en:'Girth',de:'Statur',es:'Corpulencia',it:'Corporatura',fr:'Corpulence',hu:'Testtömeg'},
  typeLabel:{en:'Type',de:'Typ',es:'Tipo',it:'Tipo',fr:'Type',hu:'Típus'},
  nameFieldLabel:{en:'Name',de:'Name',es:'Nombre',it:'Nome',fr:'Nom',hu:'Név'},
  preview:{en:'PREVIEW',de:'VORSCHAU',es:'VISTA PREVIA',it:'ANTEPRIMA',fr:'APERÇU',hu:'ELŐNÉZET'},
  specialFallback:{en:'Special',de:'Spezial',es:'Especial',it:'Speciale',fr:'Spécial',hu:'Különleges'},
  myFighters:{en:'MY FIGHTERS',de:'MEINE KÄMPFER',es:'MIS LUCHADORES',it:'I MIEI LOTTATORI',fr:'MES COMBATTANTS',hu:'SAJÁT HARCOSOK'},
  noFightersYet:{en:'None yet — create your first fighter above.',de:'Noch keine — erstelle oben deinen ersten Kämpfer.',es:'Ninguno todavía — crea tu primer luchador arriba.',it:'Ancora nessuno — crea il tuo primo lottatore qui sopra.',fr:'Aucun pour l\'instant — créez votre premier combattant ci-dessus.',hu:'Még nincs — hozd létre az első harcosodat fent.'},
  moreFighters:{en:'+{n} more (also visible in fighter select)',de:'+{n} weitere (auch in der Kämpferauswahl sichtbar)',es:'+{n} más (también visibles en la selección de luchador)',it:'+{n} altri (visibili anche nella selezione lottatore)',fr:'+{n} de plus (visibles aussi dans la sélection des combattants)',hu:'+{n} további (a harcosválasztóban is látható)'},
  edit:{en:'EDIT',de:'BEARBEITEN',es:'EDITAR',it:'MODIFICA',fr:'MODIFIER',hu:'SZERKESZTÉS'},
  nameTaken:{en:'Name taken — you can still save',de:'Name bereits vergeben — Speichern trotzdem möglich',es:'Nombre en uso — puedes guardarlo igual',it:'Nome già in uso — puoi salvare comunque',fr:'Nom déjà pris — vous pouvez quand même enregistrer',hu:'A név már foglalt — mentés így is lehetséges'},
  publish:{en:'PUBLISH',de:'VERÖFFENTLICHEN',es:'PUBLICAR',it:'PUBBLICA',fr:'PUBLIER',hu:'KÖZZÉTÉTEL'},
  published:{en:'PUBLISHED',de:'VERÖFFENTLICHT',es:'PUBLICADO',it:'PUBBLICATO',fr:'PUBLIÉ',hu:'KÖZZÉTÉVE'},
  tournament:{en:'TOURNAMENT',de:'TURNIER',es:'TORNEO',it:'TORNEO',fr:'TOURNOI',hu:'BAJNOKSÁG'},
  highScores:{en:'HIGH SCORES',de:'BESTENLISTE',es:'MEJORES PUNTUACIONES',it:'MIGLIORI PUNTEGGI',fr:'MEILLEURS SCORES',hu:'TOPLISTA'},
  tourneyProgress:{en:'OPPONENT {n}/{m}',de:'GEGNER {n}/{m}',es:'RIVAL {n}/{m}',it:'AVVERSARIO {n}/{m}',fr:'ADVERSAIRE {n}/{m}',hu:'ELLENFÉL {n}/{m}'},
  newHighScore:{en:'NEW HIGH SCORE',de:'NEUER REKORD',es:'NUEVO RÉCORD',it:'NUOVO RECORD',fr:'NOUVEAU RECORD',hu:'ÚJ REKORD'},
  tourneyBeaten:{en:'Beaten: {n} fighters',de:'Besiegt: {n} Kämpfer',es:'Derrotados: {n} luchadores',it:'Sconfitti: {n} lottatori',fr:'Vaincus : {n} combattants',hu:'Legyőzve: {n} harcos'},
  tourneyScore:{en:'Score: {n}',de:'Punktzahl: {n}',es:'Puntuación: {n}',it:'Punteggio: {n}',fr:'Score : {n}',hu:'Pontszám: {n}'},
  submitScore:{en:'SUBMIT SCORE',de:'PUNKTZAHL SENDEN',es:'ENVIAR PUNTUACIÓN',it:'INVIA PUNTEGGIO',fr:'ENVOYER LE SCORE',hu:'PONTSZÁM KÜLDÉSE'},
  skip:{en:'SKIP',de:'ÜBERSPRINGEN',es:'OMITIR',it:'SALTA',fr:'PASSER',hu:'KIHAGYÁS'},
  rankHeader:{en:'RANK',de:'RANG',es:'PUESTO',it:'POSTO',fr:'RANG',hu:'HELYEZÉS'},
  scoreHeader:{en:'SCORE',de:'PUNKTE',es:'PUNTOS',it:'PUNTI',fr:'SCORE',hu:'PONT'},
  noScoresYet:{en:'No scores yet — be the first!',de:'Noch keine Einträge — sei der Erste!',es:'Aún no hay puntuaciones — ¡sé el primero!',it:'Ancora nessun punteggio — sii il primo!',fr:'Aucun score pour l\'instant — soyez le premier !',hu:'Még nincs eredmény — legyél te az első!'},
  randomize:{en:'RANDOMIZE',de:'ZUFÄLLIG',es:'ALEATORIO',it:'CASUALE',fr:'ALÉATOIRE',hu:'VÉLETLEN'},
  saveFighter:{en:'SAVE FIGHTER',de:'KÄMPFER SPEICHERN',es:'GUARDAR LUCHADOR',it:'SALVA LOTTATORE',fr:'ENREGISTRER LE COMBATTANT',hu:'HARCOS MENTÉSE'},
  fighterNamePlaceholder:{en:'Fighter name',de:'Kämpfername',es:'Nombre del luchador',it:'Nome del lottatore',fr:'Nom du combattant',hu:'Harcos neve'},
  specialNamePlaceholder:{en:'Special move name',de:'Name des Spezialangriffs',es:'Nombre del movimiento especial',it:'Nome della mossa speciale',fr:'Nom du coup spécial',hu:'Különleges mozdulat neve'},
  specialCombo:{en:'Combo Strike — jab, cross, roundhouse chain',de:'Kombo-Angriff — Jab, Cross, Roundhouse-Kette',es:'Golpe combinado — jab, cruzado, cadena circular',it:'Colpo combinato — jab, diretto, catena rotante',fr:'Frappe combinée — enchaînement jab, direct, circulaire',hu:'Kombó ütés — jab, egyenes, köríves lánc'},
  specialThrow:{en:'Judo Throw — lunge into a clinch throw',de:'Judowurf — Ansturm in einen Clinch-Wurf',es:'Proyección de judo — arremetida hacia una proyección desde el clinch',it:'Proiezione di judo — scatto in una proiezione dal clinch',fr:'Projection de judo — élan vers une projection en clinch',hu:'Judódobás — nekilendülés egy klincsdobásba'},
  specialLunge:{en:'Lunging Strike — dashing heavy hit',de:'Ansturm-Schlag — stürmender Schwerschlag',es:'Golpe de arremetida — golpe fuerte con embestida',it:'Colpo con scatto — colpo pesante in corsa',fr:'Frappe bondissante — coup lourd en charge',hu:'Rohanó ütés — száguldó nehéz ütés'},
  specialSpin:{en:'Spinning Kick — advancing roundhouse',de:'Drehtritt — vorwärts gerichteter Roundhouse',es:'Patada giratoria — circular de avance',it:'Calcio rotante — rotante in avanzamento',fr:'Coup de pied tournant — circulaire en avançant',hu:'Pördülő rúgás — előrehaladó köríves rúgás'},
  specialCleaver:{en:'Comeback Weapon — bonus reach/damage under 30% HP',de:'Comeback-Waffe — Bonus auf Reichweite/Schaden unter 30% LP',es:'Arma de remontada — bonificación de alcance/daño bajo el 30% de PV',it:'Arma di rimonta — bonus di portata/danno sotto il 30% dei PV',fr:'Arme de retour — bonus de portée/dégâts sous 30% de PV',hu:'Visszavágó fegyver — bónusz hatótáv/sebzés 30% ÉP alatt'},
  chooseYourFighter:{en:'CHOOSE YOUR FIGHTER',de:'WÄHLE DEINEN KÄMPFER',es:'ELIGE A TU LUCHADOR',it:'SCEGLI IL TUO LOTTATORE',fr:'CHOISISSEZ VOTRE COMBATTANT',hu:'VÁLASSZ HARCOST'},
  chooseCpuOpponent:{en:'CHOOSE CPU OPPONENT',de:'CPU-GEGNER WÄHLEN',es:'ELIGE RIVAL DE CPU',it:'SCEGLI AVVERSARIO CPU',fr:'CHOISISSEZ L\'ADVERSAIRE CPU',hu:'VÁLASSZ CPU ELLENFELET'},
  player2Choose:{en:'PLAYER 2 — CHOOSE',de:'SPIELER 2 — WÄHLEN',es:'JUGADOR 2 — ELIGE',it:'GIOCATORE 2 — SCEGLI',fr:'JOUEUR 2 — CHOISIR',hu:'2. JÁTÉKOS — VÁLASSZ'},
  pageIndicator:{en:'page {a}/{b}',de:'Seite {a}/{b}',es:'página {a}/{b}',it:'pagina {a}/{b}',fr:'page {a}/{b}',hu:'{a}. oldal / {b}'},
  randomCpu:{en:'RANDOM CPU',de:'ZUFÄLLIGE CPU',es:'CPU ALEATORIA',it:'CPU CASUALE',fr:'CPU ALÉATOIRE',hu:'VÉLETLEN CPU'},
  time:{en:'TIME',de:'ZEIT',es:'TIEMPO',it:'TEMPO',fr:'TEMPS',hu:'IDŐ'},
  ko:{en:'K.O.',de:'K.O.',es:'K.O.',it:'K.O.',fr:'K.O.',hu:'K.O.'},
  throwChoke:{en:'THROW / CHOKE!',de:'WURF / WÜRGEN!',es:'¡PROYECCIÓN / ESTRANGULAR!',it:'PROIEZIONE / STRANGOLAMENTO!',fr:'PROJECTION / ÉTRANGLEMENT !',hu:'DOBÁS / FOJTÁS!'},
  throwPrompt:{en:'THROW!',de:'WURF!',es:'¡PROYECCIÓN!',it:'PROIEZIONE!',fr:'PROJECTION !',hu:'DOBÁS!'},
  counter:{en:'COUNTER!',de:'KONTER!',es:'¡CONTRA!',it:'CONTRO!',fr:'CONTRE !',hu:'ELLENÜTÉS!'},
  cleaverActive:{en:'CLEAVER',de:'HACKMESSER',es:'CUCHILLA',it:'MANNAIA',fr:'HACHOIR',hu:'BÁRD'},
  readyLabel:{en:'READY',de:'BEREIT',es:'LISTO',it:'PRONTO',fr:'PRÊT',hu:'KÉSZ'},
  stageDojoName:{en:'Underground Dojo',de:'Untergrund-Dojo',es:'Dojo subterráneo',it:'Dojo sotterraneo',fr:'Dojo souterrain',hu:'Föld alatti dódzsó'},
  stageRooftopName:{en:'Rooftop Cage',de:'Dachkäfig',es:'Jaula en la azotea',it:'Gabbia sul tetto',fr:'Cage sur le toit',hu:'Tetőketrec'},
  stageBambooName:{en:'Bamboo Grove',de:'Bambushain',es:'Bosque de bambú',it:'Boschetto di bambù',fr:'Bosquet de bambous',hu:'Bambuszliget'},
  stageArenaName:{en:'World Combat Arena',de:'Weltkampf-Arena',es:'Arena de combate mundial',it:'Arena di combattimento mondiale',fr:'Arène de combat mondiale',hu:'Világbajnoki aréna'},
  youWin:{en:'YOU WIN',de:'DU GEWINNST',es:'GANASTE',it:'HAI VINTO',fr:'VOUS GAGNEZ',hu:'GYŐZTÉL'},
  youLose:{en:'YOU LOSE',de:'DU VERLIERST',es:'PERDISTE',it:'HAI PERSO',fr:'VOUS PERDEZ',hu:'VESZTETTÉL'},
  playerLabel:{en:'PLAYER',de:'SPIELER',es:'JUGADOR',it:'GIOCATORE',fr:'JOUEUR',hu:'JÁTÉKOS'},
  rematch:{en:'REMATCH',de:'REVANCHE',es:'REVANCHA',it:'RIVINCITA',fr:'REVANCHE',hu:'VISSZAVÁGÓ'},
  mainMenu:{en:'MAIN MENU',de:'HAUPTMENÜ',es:'MENÚ PRINCIPAL',it:'MENU PRINCIPALE',fr:'MENU PRINCIPAL',hu:'FŐMENÜ'},
  prev:{en:'PREV',de:'ZURÜCK',es:'ANTERIOR',it:'PRECEDENTE',fr:'PRÉCÉDENT',hu:'ELŐZŐ'},
  next:{en:'NEXT',de:'WEITER',es:'SIGUIENTE',it:'SUCCESSIVO',fr:'SUIVANT',hu:'KÖVETKEZŐ'},
  belt_none:{en:'No Belt',de:'Kein Gürtel',es:'Sin cinturón',it:'Nessuna cintura',fr:'Aucune ceinture',hu:'Nincs öv'},
  belt_kyu12:{en:'White Belt',de:'Weißer Gürtel',es:'Cinturón blanco',it:'Cintura bianca',fr:'Ceinture blanche',hu:'Fehér öv'},
  belt_kyu11:{en:'Yellow Belt',de:'Gelber Gürtel',es:'Cinturón amarillo',it:'Cintura gialla',fr:'Ceinture jaune',hu:'Sárga öv'},
  belt_kyu10:{en:'Orange Belt',de:'Oranger Gürtel',es:'Cinturón naranja',it:'Cintura arancione',fr:'Ceinture orange',hu:'Narancssárga öv'},
  belt_kyu9:{en:'Green Belt',de:'Grüner Gürtel',es:'Cinturón verde',it:'Cintura verde',fr:'Ceinture verte',hu:'Zöld öv'},
  belt_kyu8:{en:'Blue Belt',de:'Blauer Gürtel',es:'Cinturón azul',it:'Cintura blu',fr:'Ceinture bleue',hu:'Kék öv'},
  belt_kyu7:{en:'Purple Belt',de:'Violetter Gürtel',es:'Cinturón morado',it:'Cintura viola',fr:'Ceinture violette',hu:'Lila öv'},
  belt_kyu6:{en:'Purple Belt (brown tip)',de:'Violetter Gürtel (braune Spitze)',es:'Cinturón morado (punta marrón)',it:'Cintura viola (punta marrone)',fr:'Ceinture violette (pointe marron)',hu:'Lila öv (barna véggel)'},
  belt_kyu5:{en:'Brown Belt (white stripe)',de:'Brauner Gürtel (weißer Streifen)',es:'Cinturón marrón (franja blanca)',it:'Cintura marrone (striscia bianca)',fr:'Ceinture marron (bande blanche)',hu:'Barna öv (fehér csíkkal)'},
  belt_kyu4:{en:'Brown Belt (white stripe, black tip)',de:'Brauner Gürtel (weißer Streifen, schwarze Spitze)',es:'Cinturón marrón (franja blanca, punta negra)',it:'Cintura marrone (striscia bianca, punta nera)',fr:'Ceinture marron (bande blanche, pointe noire)',hu:'Barna öv (fehér csík, fekete vég)'},
  belt_kyu3:{en:'Brown Belt',de:'Brauner Gürtel',es:'Cinturón marrón',it:'Cintura marrone',fr:'Ceinture marron',hu:'Barna öv'},
  belt_kyu2:{en:'Brown Belt (black tip)',de:'Brauner Gürtel (schwarze Spitze)',es:'Cinturón marrón (punta negra)',it:'Cintura marrone (punta nera)',fr:'Ceinture marron (pointe noire)',hu:'Barna öv (fekete véggel)'},
  belt_kyu1:{en:'Brown Belt (black stripe)',de:'Brauner Gürtel (schwarzer Streifen)',es:'Cinturón marrón (franja negra)',it:'Cintura marrone (striscia nera)',fr:'Ceinture marron (bande noire)',hu:'Barna öv (fekete csíkkal)'},
  belt_dan1:{en:'1st Dan (Black Belt)',de:'1. Dan (Schwarzer Gürtel)',es:'1er Dan (Cinturón negro)',it:'1° Dan (Cintura nera)',fr:'1er Dan (Ceinture noire)',hu:'1. Dan (Fekete öv)'},
  belt_dan2:{en:'2nd Dan (Black Belt)',de:'2. Dan (Schwarzer Gürtel)',es:'2º Dan (Cinturón negro)',it:'2° Dan (Cintura nera)',fr:'2e Dan (Ceinture noire)',hu:'2. Dan (Fekete öv)'},
  belt_dan3:{en:'3rd Dan (Black Belt)',de:'3. Dan (Schwarzer Gürtel)',es:'3er Dan (Cinturón negro)',it:'3° Dan (Cintura nera)',fr:'3e Dan (Ceinture noire)',hu:'3. Dan (Fekete öv)'},
  belt_dan4:{en:'4th Dan (Black Belt)',de:'4. Dan (Schwarzer Gürtel)',es:'4º Dan (Cinturón negro)',it:'4° Dan (Cintura nera)',fr:'4e Dan (Ceinture noire)',hu:'4. Dan (Fekete öv)'},
  belt_dan5:{en:'5th Dan (Black Belt)',de:'5. Dan (Schwarzer Gürtel)',es:'5º Dan (Cinturón negro)',it:'5° Dan (Cintura nera)',fr:'5e Dan (Ceinture noire)',hu:'5. Dan (Fekete öv)'},
};
function t(lang,key){ const row=I18N[key]; if(!row) return key; return row[lang] || row.en || key; }
// languages: an array like navigator.languages (or [navigator.language]) — first supported
// 2-letter prefix wins, so 'de-DE' matches 'de'. Takes the array as a param (rather than
// reading navigator directly) so this stays a pure, Node-testable function.
function detectDefaultLang(languages){
  for(const l of (languages||[])){ const p=(l||'').slice(0,2).toLowerCase(); if(SUPPORTED_LANGS.includes(p)) return p; }
  return 'en';
}

const exportsObj = {
  GOLD, KYU_RANKS, DAN_RANKS, BELT_TABLE, getBelt, giAboveBlue, GI_BLACK, GI_WHITE, BELT_CHOICES, beltLabel,
  CHARACTERS, CharacterStore, SharedStore,
  HAIR_ORDER, BEARD_ORDER, GLASSES_ORDER, TINT_ORDER, SPECIAL_TYPE_IDS, normalizeCharacter,
  MOVES, PUNCHES, KICKS, GRAV, JUMP_V, CLINCH_RANGE, CLINCH_WINDOW, REVERSAL_WINDOW, ROUND_TIME, WINS_NEEDED, TOURNEY_ROUND_TIME,
  computeDamage, fh, bodyRect, rectsOverlap, inClinchRange, faceDir, moveDir,
  SUPPORTED_LANGS, I18N, t, detectDefaultLang,
};

if(typeof module!=='undefined' && module.exports){ module.exports = exportsObj; }
else { Object.assign(root, exportsObj); }

})(typeof window!=='undefined' ? window : globalThis);
