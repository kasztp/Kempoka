# UI.md — screens, menus, input, HUD

This covers the immediate-mode screen/menu layer in `index.html`: the `state` machine,
the `btn()`/`buttons` click system, the Create-Fighter DOM-overlay form, character
select, the fight HUD, keyboard/touch input, and the persistent corner buttons
(fullscreen, exit, GFX quality). It does not cover:

- Fighter/stage drawing internals (`drawFighter`, `drawFighterClassic/Pixel`, `stageDojo`
  etc.) — see `docs/2D_rendering.md`.
- WebGL rendering and what the 3D quality preset actually changes — see `docs/3D_rendering.md`.
- Belts, roster data, move tables, combat math, the `I18N` table itself — see `docs/game_logic.md`.
- Supabase/`SharedStore` networking (publish, shared roster, high scores) — see `docs/backend.md`.

## The screen/state machine

One global drives everything: `let state='menu', F=[null,null], mode='1p';` (index.html:733).
Valid values, all set as plain string literals throughout the file: `'menu'`, `'controls'`,
`'create'`, `'select'`, `'fight'`, `'result'`, `'scoreEntry'`, `'highscore'`.

The per-frame dispatch lives in `loop(now)` (index.html:1393-1410):

```js
function loop(now){ DT=Math.min(0.05,(now-last)/1000); last=now;
  handleClick();
  if(state==='menu') drawMenu();
  else if(state==='controls') drawControls();
  else if(state==='create') drawCreate();
  else if(state==='select') drawSelect();
  else if(state==='fight'){ updateFight(); drawFight(); }
  else if(state==='result') drawResult();
  else if(state==='scoreEntry') drawScoreEntry();
  else if(state==='highscore') drawHighscore();
  document.getElementById('touch').classList.toggle('on', wantTouch() && (state==='fight'||state==='controls'));
  document.getElementById('createUI').classList.toggle('on', state==='create');
  document.getElementById('scoreUI').classList.toggle('on', state==='scoreEntry' && SharedStore.isConfigured());
  document.getElementById('exitBtn').classList.toggle('show', state==='fight');
  document.getElementById('qualityBtn').classList.toggle('show', state==='fight' && graphicsStyle==='3d');
  requestAnimationFrame(loop);
}
```

Every `drawX()` for a menu-like screen (`drawMenu`, `drawControls`, `drawCreate`,
`drawSelect`, `drawResult`, `drawScoreEntry`, `drawHighscore`) starts with
`buttons=[]; bg2();` — the button list is rebuilt from scratch every frame (see below),
and `bg2()` paints the shared radial-gradient menu backdrop. `drawFight` is the odd one
out: it doesn't touch `buttons` at all (menu clicks are ignored during a fight —
see `handleClick`), and it calls `updateFight()` first to advance simulation before drawing.

Only `'fight'` runs game simulation (`updateFight()`); every other state is purely
reactive to clicks, redrawn fresh each frame from current data (`draft`, `ROSTER`,
`highscoreList`, etc.) — there's no separate "screen enter" render, just whatever
`drawX()` computes this frame.

### Transition functions

State changes happen either inline (`()=>{state='menu';}` in a button's `fn`) or via a
named transition function that also does setup work:

| Function | index.html | Effect |
|---|---|---|
| `enterCreate()` | 994 | `state='create'`; resets `draft=newDraft()`, `editingId=null`, syncs DOM inputs |
| `editCustom(c)` | 995 | `state` stays `'create'`; loads a deep-cloned saved fighter into `draft` for editing |
| `gotoSelect()` | 1171 | `state='select'`; resets `selPhase=0`, `sel=[0,0]`, `page=0`; starts music; re-pulls the shared roster |
| `chooseFighter(idx)` | 1215 | advances `selPhase` (1P/2P) or calls `startTournament` (tournament mode) or calls `startFight()` |
| `pickRandomCpu()` | 1218 | fills `sel[1]` randomly and calls `startFight()` directly (1P only) |
| `startTournament(yourIdx)` | 1225 | builds the `tournament` object, calls `startFight()` |
| `startFight()` | 1249 | `state='fight'`; builds `F[0]`/`F[1]` via `makeFighter`, picks next stage, resets round timer |
| `advanceTournament()` / `finishTournament()` | 1231/1241 | next tournament match, or `state='scoreEntry'` |
| `enterHighscore()` | 1365 | `state='highscore'`; kicks off `SharedStore.topScores(20)` |

There is no generic "goto(state)" helper — each transition is a plain function that sets
`state` alongside whatever state it needs to reset. Keep that pattern when adding a
screen: don't introduce a router, just write `enterFoo()`.

## The button system

`buttons` is a flat array of hit-rects rebuilt every frame; `btn()` pushes to it and
`drawBtn()` renders one:

```js
let buttons=[];
function btn(x,y,w,h,label,fn,active){ buttons.push({x,y,w,h,label,fn,active}); }
function drawBtn(b){ /* rounded rect, GOLD outline, filled solid when b.active */
  let fs=Math.max(11,Math.min(22,Math.round(b.h*0.55)));
  const maxW=b.w-14;   // 7px breathing room each side so longer translations never touch the border
  ctx.font='bold '+fs+'px "Trebuchet MS"';
  while(fs>8 && ctx.measureText(b.label).width>maxW){ fs--; ctx.font='bold '+fs+'px "Trebuchet MS"'; }
  ctx.fillText(b.label,b.x+b.w/2,b.y+b.h/2);
}
function hit(b,p){ return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h; }
```

This is genuinely immediate-mode: every `drawX()` screen function declares its buttons
fresh with `btn(...)` calls in the same pass it draws them, then loops `buttons.forEach(drawBtn)`
at the end. There's no persistent widget tree — a button only exists for one frame, and
its `fn` closure captures whatever state it needs at declaration time (e.g. the roster
index `idx` in the character-select grid).

Clicks are hit-tested against the *current* `buttons` array by `handleClick()`
(index.html:1389), called at the top of every `loop()` frame before any drawing happens:

```js
function handleClick(){ if(!clickPt) return; const p=clickPt; clickPt=null;
  if(state==='fight') return;
  for(const b of buttons){ if(b.fn && hit(b,p)){ b.fn(); return; } } }
```

Note `buttons` at the time `handleClick()` runs is whatever was built *last* frame (the
frame's own `drawX()` hasn't run yet this tick) — one-frame-stale hit-testing that's
invisible in practice since layouts don't change between clicks. Also note the character-select
grid pushes plain `{x,y,w,h,fn,label:''}` objects directly (index.html:1203) instead of
calling `btn()`, because the whole card (portrait, name, belt swatch) is the click target
but only the `‹ back`/`◀ prev`/`▶ next`/`+ create` rects should actually get outlined and
labeled by `drawBtn` — hence `drawSelect` finishes with
`buttons.filter(b=>b.label).forEach(drawBtn)` rather than drawing every pushed rect.

### `fitText()` — the other half of the overflow guard

```js
function fitText(text,x,y,maxW,startPx,bold){   // shrinks font until text fits maxW — guards long translations on fixed-width lines
  let fs=startPx;
  ctx.font=(bold?'bold ':'')+fs+'px "Trebuchet MS"';
  while(fs>9 && ctx.measureText(text).width>maxW){ fs--; ctx.font=(bold?'bold ':'')+fs+'px "Trebuchet MS"'; }
  ctx.fillText(text,x,y);
}
```

Same shrink-until-it-fits loop as `drawBtn`, but for free-standing text drawn outside a
button box (labels, captions, the Controls-screen copy). Both exist because translated
strings (German, Hungarian especially) routinely run 1.5-2x longer than their English
source, and canvas text doesn't wrap — without this, longer locales would overflow fixed-width
layouts or collide with neighboring text. Any new UI text on a fixed-width line should go
through `fitText`/`btn` rather than a raw `ctx.fillText`, or it will silently break for
some languages.

## Create Fighter screen (`drawCreate`, index.html:1086)

### The `draft` object

`draft` is the one character object being edited; `null` when Create isn't active.
`newDraft()` (index.html:984) returns a fresh default (belt `kyu12`, `gi` outfit, mid
stats, `id:'custom_'+Date.now()...`); `editCustom(c)` (995) instead deep-clones an
existing saved fighter (`JSON.parse(JSON.stringify(c))`) into `draft` and sets `editingId`
so `saveDraft()` knows to overwrite rather than insert. `randomizeDraft()` (1008) rerolls
every field from the same pools used elsewhere (`SKIN_TONES`, `HAIR_COLORS`,
`SPANDEX_COLORS`, `BELT_CHOICES`, `HAIR_ORDER`, etc. — the `*_ORDER` arrays are exported
from `game-logic.js`, shared with `normalizeCharacter`'s validation there).

### DOM-input overlay (`createUI`, `placeEl`)

Canvas 2D can't natively do text editing, color pickers, or `<select>` dropdowns, so
those specific fields are real HTML form elements (declared in the `#createUI` div in the
`<body>`, e.g. `<input id="cfName" class="cfield" type="text">`, `type="color"`,
`type="range"`, a `<select>`) absolutely positioned *on top of* the canvas rather than
drawn into it:

```js
const createUI={ name:$('cfName'), specialName:$('cfSpecialName'), skin:$('cfSkin'), ... };
function canvasScale(){ const r=canvasContentRect(); return {r, sx:r.width/W, sy:r.height/H}; }
function placeEl(el,lx,ly,lw,lh){ const {r,sx,sy}=canvasScale();
  el.style.left=(r.left+lx*sx)+'px'; el.style.top=(r.top+ly*sy)+'px';
  el.style.width=(lw*sx)+'px'; el.style.height=(lh*sy)+'px'; }
```

`drawCreate()` calls `placeEl(createUI.name,60,80,230,28)` etc. every frame, in the same
960x540 logical coordinate space as everything drawn on canvas — `canvasScale()` maps
those logical coordinates through `canvasContentRect()` (see High-DPI section below) to
real screen pixels, so the DOM inputs track the canvas's letterboxed position/size as the
window resizes. `#createUI` is toggled visible only in the `'create'` state (`loop()`);
its CSS (`position:fixed; pointer-events:none` on the wrapper, `pointer-events:auto` on
each `.cfield`) keeps it from swallowing clicks anywhere else. The same `placeEl`
mechanism positions `#scoreUI` (the tournament score-entry name field) and
`#turnstileHost` (the Cloudflare Turnstile widget mount, used by Publish and score
submission — see `docs/backend.md`).

`readUIIntoDraft()` (1034) is called at the top of every `drawCreate()` frame, syncing the
live DOM input values back into `draft` before anything reads `draft` for drawing (the
belt swatch, stat previews, live portrait) — so slider/color/text edits show up
immediately without a separate "on change" handler per field. `syncUIFromDraft()` (1027)
does the reverse (draft → DOM), called after `enterCreate`/`editCustom`/`randomizeDraft`
replace `draft` wholesale.

### Cycle-buttons for enum fields

Belt rank, outfit, hairstyle, beard, glasses, and glasses tint are all enums with no
native HTML control wired up for them; each is a single `btn()` whose `fn` advances the
value through a fixed `*_ORDER` array (from `game-logic.js`) and wraps around:

```js
btn(180,214,86,30,t(lang,HAIR_LABELS[draft.hair.style]),
  ()=>{ draft.hair.style=HAIR_ORDER[(HAIR_ORDER.indexOf(draft.hair.style)+1)%HAIR_ORDER.length]; },false);
```

Same pattern for beard (`BEARD_ORDER`), glasses (`GLASSES_ORDER`), glasses tint
(`TINT_ORDER`, only shown when `draft.glasses==='dark'`), and belt rank — belt gets two
buttons (◀/▶) instead of one cycle button since `BELT_CHOICES` is long enough that
forward-only cycling would be tedious. The label shown on each button is looked up
through a small local `*_LABELS` map (e.g. `HAIR_LABELS={short:'hairShort',...}`) into
`t(lang, key)`, so the button text is always the translated current value.

### My Fighters

The bottom-left "My Fighters" list (index.html:1146-1162) shows the last two
`customCharacters` (`.slice(-2).reverse()`, newest first), each row with an
`Edit`/`×`(delete) button pair (`editCustom(c)` / `deleteCustom(c.id)`), plus a
Publish/Published toggle button (`togglePublish(c)`) shown only when
`SharedStore.isConfigured()` — the button's presence and its `busy`/`isMe` label states
are UI's; what publishing actually does over the network is `docs/backend.md`'s. A count
of any additional saved fighters beyond the two shown is printed below the list.

## Character select screen (`drawSelect`, index.html:1179)

Paginated grid over `ROSTER` (`CHARACTERS` + `customCharacters` + `sharedCharacters`,
combined by `refreshRoster()` at index.html:134 — de-duped so your own published fighter
isn't listed twice). Layout constants: `const PER_PAGE=8, COLS=4;` (1178) — grid position
and card size (`cw=180, chh=150, gap=18`) are computed fresh each frame from `page` and
`ROSTER.length`; `pages=Math.ceil(ROSTER.length/PER_PAGE)`. Each card is one
`drawPortrait(c,...)` call (fighter-drawing internals: see `docs/2D_rendering.md`) plus
name/belt-swatch/special-move text, with a plain hit-rect (not a `btn()`) whose `fn` is
`()=>chooseFighter(idx)`.

### Selection-phase differences (`selPhase`)

`selPhase` (0 or 1) tracks whether this is the first or second fighter pick in the
current `mode`:

- **1P** (`mode==='1p'`): phase 0 picks your fighter; phase 1 title becomes
  `chooseCpuOpponent` and a **Random CPU** button (`🎲 randomCpu`, calls
  `pickRandomCpu()`) appears, letting you skip picking the opponent by hand.
- **2P** (`mode==='2p'`): phase 0 picks P1, phase 1 title becomes `player2Choose`
  ("Player 2, choose") — no random-CPU button, since a human is picking.
- **Tournament** (`mode==='tournament'`): only one pick ever happens — `chooseFighter`
  routes straight to `startTournament(idx)` instead of advancing `selPhase`, so the title
  always reads `chooseYourFighter`.

`gotoSelect()` always resets `selPhase=0`. The chosen P1 fighter is highlighted
(`chosenP1 = selPhase===1 && sel[0]===idx`, grey outline) while picking the second
fighter, so the already-picked card stays visible in context.

## HUD during a fight (`drawHUD`, index.html:1301)

Two health bars (`BAR_W=280` each), a center round timer, per-fighter special-move
readiness text, and round-win pips, all recomputed from `F[0]`/`F[1]` each frame — no
separate HUD state. Special-move readiness reads `f.cool.special` (a countdown) and
`f.cleaver` (an active-buff flag for the "cleaver" special type): shows the countdown
seconds while on cooldown, `★ cleaverActive` while the buff is active, or the special's
own name + "ready" otherwise.

### `HUD_MARGIN` — keeping corner buttons off the HP bars

```js
const HUD_MARGIN=130;   // extra edge inset (vs. a plain 30) so the corner buttons never sit over the HP bar
const BAR_W=280;        // narrower than the old 360 so both bars leave a clear gap for the timer in the middle
```

The HP bars start at `HUD_MARGIN` from each edge (not flush against it) specifically
because the fixed DOM corner buttons (`⛶`/`⌂`/quality) sit in the top-right at `top:8px`
with `right:8/46/84px`, and at narrow logical widths the P2 bar would otherwise run
underneath them. Any change to `BAR_W` or the corner-button stack width should re-check
this margin still clears them at the narrowest supported window size.

### Fixed corner buttons

Declared once in the `<body>` (not part of the canvas or `buttons` array), toggled via
CSS class rather than redrawn:

- **`#fsBtn` (⛶ Fullscreen)** — `initFullscreen()` (index.html:1421). Feature-detected via
  `document.documentElement.requestFullscreen || ...webkitRequestFullscreen`; if neither
  exists the button is never shown (`if(!canFullscreen){ return; }` — no `.show` class
  ever added). The code comment explains why: *"element Fullscreen isn't supported on
  iPhone Safari (iPadOS/desktop/Android are fine) — feature-detect and just hide the
  button there rather than show a control that silently no-ops."* Icon/title flip between
  `⛶`/`Fullscreen` and `⤫`/`Exit fullscreen` on `fullscreenchange`/`webkitfullscreenchange`.
  Visible on every screen, not just during a fight.
- **`#exitBtn` (⌂ Exit to Menu)** — fight-only: `classList.toggle('show', state==='fight')`
  in `loop()`. Its `pointerdown` handler just does `state='menu'` directly (index.html:1411),
  bypassing the canvas `buttons` system entirely since it's a real DOM element.
- **`#qualityBtn` (⚡/✨ Performance/Eye Candy)** — fight-only *and* 3D-only:
  `classList.toggle('show', state==='fight' && graphicsStyle==='3d')`. Cycles
  `getQuality3D()`/`setQuality3D()` (defined in `render3d.js`) between `'performance'` and
  `'eyecandy'`, persisted to `localStorage.kmp_quality` by `setQuality3D` itself. The
  button/icon-swap code is here; what "eye candy" vs "performance" actually renders
  differently is `docs/3D_rendering.md`'s territory.

## Input handling

### Keyboard

```js
const KEYMAP={KeyA:1,KeyD:1,KeyW:1,KeyS:1,KeyJ:1,KeyK:1,KeyL:1,KeyU:1,KeyI:1,
  ArrowLeft:1,ArrowRight:1,ArrowUp:1,ArrowDown:1,Numpad1:1,Numpad2:1,Numpad3:1,Numpad0:1,Numpad4:1,Enter:1,Space:1};
```

`readInput(side)` (index.html:225) maps raw key state to a semantic input object per
side:

| Action | P1 (side 0) | P2 (side 1) |
|---|---|---|
| left / right | `KeyA` / `KeyD` | `ArrowLeft` / `ArrowRight` |
| up (jump) / down (duck) | `KeyW` / `KeyS` | `ArrowUp` / `ArrowDown` |
| punch | `KeyJ` | `Numpad1` |
| kick | `KeyK` | `Numpad2` |
| block | `KeyL` | `Numpad3` |
| special | `KeyU` | `Numpad0` |
| grab | `KeyI` | `Numpad4` |

P1's input also OR's in the on-screen touch state (`||!!touch.left` etc.) — P2 keyboard
input has no touch equivalent, since touch always drives P1 (see below). `KEYMAP` entries
get `preventDefault()`'d on `keydown` so arrow keys/space don't scroll the page, but only
when the event target isn't a form field: `isFormField(e)` checks
`tag==='INPUT'||'SELECT'||'TEXTAREA'` so typing in the Create-Fighter name field or the
score-entry name field isn't hijacked by the game's key bindings.

### Touch pad

Nine `.tbtn` divs in `#touch` (`tLeft/tRight/tUp/tDown/tPunch/tKick/tBlock/tSpecial/tGrab`),
each `data-k`-tagged; `bindTouch()` (index.html:216) wires `pointerdown`/`pointerup`/
`pointercancel`/`pointerleave` to set/clear `touch[k]`, which `readInput(0)` reads. Touch
**always drives P1**, never P2 or the CPU — there is no touch-input path for `side===1` in
`readInput`. The pad is shown (`#touch.on`) only in `'fight'` or `'controls'` state, and
only when `wantTouch()` is true:

```js
let touchMode = localStorage.kmp_touch || 'auto';   // 'auto' | 'on' | 'off'
function touchAuto(){ try{ return matchMedia('(pointer: coarse)').matches; }catch(e){ return ('ontouchstart' in window)||navigator.maxTouchPoints>0; } }
function wantTouch(){ return touchMode==='on' || (touchMode==='auto' && touchAuto()); }
```

### "Preview touch controls on desktop" toggle

The Controls screen (`drawControls`, index.html:911) has a button cycling `touchMode`
through `auto → on → off → auto`, persisted to `localStorage.kmp_touch`. Setting it to
`'on'` forces the on-screen pad to show even on a desktop/mouse device (bypassing the
`touchAuto()` pointer-type check) so it can be previewed/tested without touch hardware;
`'off'` force-hides it even on an actual touch device.

## GFX style toggle (Classic / Pixel / 3D)

```js
let graphicsStyle = localStorage.kmp_graphics || 'classic';   // 'classic' | 'pixel' | '3d'
if(graphicsStyle==='3d' && !has3DSupport()) graphicsStyle='classic';   // device can't do it — fall back silently
function toggleGraphicsStyle(){
  const order = has3DSupport() ? ['classic','pixel','3d'] : ['classic','pixel'];
  graphicsStyle = order[(order.indexOf(graphicsStyle)+1) % order.length];
  localStorage.kmp_graphics=graphicsStyle; applyGraphicsStyle();
}
```

Cycled by a menu button (`btn(...,toggleGraphicsStyle,...)` in `drawMenu`, labeled
`gfx: classic/pixel/3d` via `t(lang,...)`). `has3DSupport()` (from `render3d.js`, WebGL
context probe) both gates whether `'3d'` is ever offered in the cycle order and forces a
silent fallback to `'classic'` at load if a previously-persisted choice of `'3d'` is no
longer supported (e.g. switched browsers/devices). `applyGraphicsStyle()` just flips
`cv.style.imageRendering` (`pixelated` for Pixel mode) and makes the 2D canvas background
transparent for `'3d'` (so the WebGL canvas underneath, `#cv3d`, shows through — see
`docs/3D_rendering.md` for what's actually drawn there and the `#cv3d`/`#cv` z-index
stacking note in the `<style>` block).

## Language selector

```js
const FLAGS = { en:'🇬🇧', de:'🇩🇪', es:'🇪🇸', it:'🇮🇹', fr:'🇫🇷', hu:'🇭🇺' };
let lang = localStorage.kmp_lang || detectDefaultLang(navigator.languages || [navigator.language]);
let langPickerOpen = false;
function setLang(l){ lang=l; localStorage.kmp_lang=l; langPickerOpen=false; if(typeof applyLangToDom==='function') applyLangToDom(); }
```

`drawLangPicker()` (index.html:880, called only from `drawMenu`) draws a flag button
(current `lang`'s flag) top-right; clicking it toggles `langPickerOpen`, which — while
open — adds one button per *other* supported language (`SUPPORTED_LANGS.filter(l=>l!==lang)`,
`SUPPORTED_LANGS`/`detectDefaultLang` from `game-logic.js`) stacked below it. Picking one
calls `setLang(l)`.

Every canvas text call throughout the file reads the current `lang` live via
`t(lang,'someKey')` (`t`/`I18N` defined in `game-logic.js`) — there's no re-render step
needed on language change beyond the normal per-frame redraw, since every `drawX()`
already recomputes its text from scratch each frame. The one exception is
`applyLangToDom()` (index.html:955): native HTML placeholders (`createUI.name.placeholder`,
`scoreNameEl.placeholder`) and the touch-pad button labels aren't canvas-drawn text, so
they need an explicit re-set — called both at startup and from `setLang()`.

## Canvas high-DPI sizing and hit-testing

```js
const DPR = Math.min(window.devicePixelRatio||1, 2);
cv.width = W*DPR; cv.height = H*DPR;
ctx.scale(DPR, DPR);
```

The backing store is sized by device pixel ratio (capped at 2x) purely so drawing isn't
blurry on high-DPI displays; every draw call still works in the same 960x540 logical
coordinate space (`ctx.scale` absorbs the DPR factor), so nothing above needs to know
about it. Full rationale and rendering detail: `docs/2D_rendering.md`.

The part that *is* this doc's concern is **pointer-to-logical-coordinate mapping**, since
it directly feeds button hit-testing. The canvas element is styled
`width:100%;height:100%;object-fit:contain`, so its CSS box from `getBoundingClientRect()`
is frequently larger than the actual rendered 960x540 content (any non-16:9 viewport adds
letterbox bars). `canvasContentRect()` (index.html:119) computes the true letterboxed
content rect, and both the click handler and `placeEl`/`canvasScale` (DOM-overlay
positioning) go through it — never the raw `getBoundingClientRect()`:

```js
cv.addEventListener('pointerdown',e=>{ const r=canvasContentRect();
  clickPt={x:(e.clientX-r.left)/r.width*W, y:(e.clientY-r.top)/r.height*H}; Audio.ensure(); });
```

If a future change reads `cv.getBoundingClientRect()` directly for hit-testing instead of
`canvasContentRect()`, clicks will drift out of alignment with drawn buttons on any
non-16:9 window — worst near the edges (e.g. the bottom-row menu buttons), exactly the
bug this function exists to prevent.
