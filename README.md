# Kempoka — The Chosen Ones

A Street Fighter–style 2D fighting game themed around **Zen Bu Kan Kempo**. Runs in any
browser on desktop (keyboard) or phone/tablet (touch). One self-contained `index.html`,
no dependencies, no build step.

## Run it

Just open `index.html` in a browser — double-click it, or serve the folder:

```
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

**Player 1 (keyboard):** `A`/`D` move · `W` jump · `S` crouch · `J` punch (tsuki) ·
`K` kick (geri) · `L` block (uke) · `U` special · `I` grab / clinch counter

**Player 2 (keyboard, 2P mode):** `←`/`→` move · `↑` jump · `↓` crouch · Numpad `1` punch ·
`2` kick · `3` block · `0` special · `4` grab / counter

**Touch:** on-screen pad (move/jump/crouch) + action buttons appear automatically on touch
devices (during a fight). Touch drives Player 1 (vs CPU). On a desktop you can preview them via
**Controls → Touch buttons: ON**.

**Moveset — direction + attack button.** You always auto-face the opponent; the *held direction*
selects the variant (→ = toward the foe, ← = away):

- **Punch:** neutral Jab · → Cross · ▲ Uppercut · ▼ Body hook · ← Head hook
- **Kick:** neutral Front kick (tepe) · ▼ Low kick · → Roundhouse (ribs) · ← Side kick · ▲ Head kick
- **Grab:** neutral Clinch (then punch = throw, kick a stunned foe = choke) · ▼ Double-leg takedown ·
  ← Single-leg takedown · ▲ Judo throw

Uppercut and head kick punish jump-ins; low kick and body hook stay under high strikes. Punches and
kicks work in mid-air; blocks, grabs, throws and chokes are ground-only. Takedowns whiff and leave you
open if you shoot out of range or into a block. The full list is on the in-game **Controls** screen.

## Grappling (Zen Bu Kan Kempo rules)

Throws and chokes are legal but **only from a clinch** — get close and **grab** first. From a
clinch you can **throw** (knockdown) or, from behind, **choke** (a gradual drain). The grabbed
fighter can press grab/counter to **break free** or, with good timing, **reverse** it. No strikes
on a downed opponent.

## Adding a character

Every fighter is one object in the `CHARACTERS` array near the top of `index.html`. Copy an
existing entry, change the fields (name, belt color, outfit, build, hair/beard, stats, special),
and it shows up in character select automatically — the grid pages to fit any number. A brand-new
kind of special needs a matching `case` in `doSpecial()`; reusing an existing special type needs
no code changes.

## Credits

Branding: *The Chosen Ones — Zen Bu Kan Kempo*. Music and sound effects are generated at runtime
with the Web Audio API (original chiptune, no copyrighted material).
