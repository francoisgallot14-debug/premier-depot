# Spécification technique — Projet Royaume (prototype chapitre 1)

Read `../CONCEPTION.md` first: it is the game design agreed with the owner (French). This file is the
technical contract every contributor follows. The owner is a French non-programmer who reads code
logic: **all in-game text is French; code comments are French, short, explaining the "why"**. Tunable
numbers live ONLY in `src/core/data.js`, laid out as readable tables with a French comment per field.

## 0. Goals of this prototype

A complete, playable, testable chapter 1 on a phone, offline, at 60 fps on a mid-range Android phone.
Quality bar: no console errors, no dead buttons, no soft-locks, saves survive reload, readable UI in
portrait (390×844) and landscape (844×390), touch-first (tap targets ≥ 44px), also works with a mouse.

## 1. Layout & build

```
jeu/
  CONCEPTION.md               design (owner-facing)
  docs/SPEC_TECHNIQUE.md      this file
  package.json                deps already installed: three@0.170.0, esbuild@0.24.0 (node_modules present)
  index.html                  dev page: <script type="module" src="./src/main.js">, importmap "three" -> ./node_modules/three/build/three.module.js
  src/
    core/   PURE logic, no DOM, no three.js, runs in Node (tests import it directly)
      data.js     all tables and numbers (buildings, enemies, waves, talents, missions, actions, equipment)
      rng.js      seeded RNG (mulberry32) — never Math.random in core
      map.js      chapter 1 map (deterministic hand-designed layout)
      state.js    newGame(meta), serialize/deserialize, save/load helpers (storage injected)
      economy.js  prep-phase rules: actions, build, place validation, assign workers, recruit, equip, rebuild, endOfCycle
      battle.js   real-time battle simulation (fixed step), emits events for rendering
      meta.js     kingdom XP, levels, talents, missions, reserves (persistent across games)
      index.js    re-exports
    render/ three.js only, reads core state, never mutates game rules
      scene.js    renderer, lights, sky, fog, quality settings, resize, render loop hooks
      camera.js   touch + mouse camera controller (pan / pinch-zoom / twist-rotate / wheel / right-drag)
      models.js   procedural low-poly models (buildings per type, ruins, units per type/equipment, trees, rocks, props)
      world.js    builds terrain from map, syncs buildings/units meshes with state, ghost placement preview, picking (raycast → tile)
      fx.js       particles, arrows, damage numbers, trap spikes, dust, smoke, building-destroyed debris
    ui/     DOM overlay (no framework)
      style.css
      hud.js      top bar (resources, population, wave, kingdom level)
      panels.js   bottom sheets: Actions, Construire, Armée, Bâtiment (selected), Royaume (talents), Bilan, title, options, modals
      tutorial.js short contextual hints for the first cycles (can be turned off)
    main.js     boot, title screen, phase machine (title → prep → battle → report → prep… / defeat / victory), wiring
  scripts/build.mjs           esbuild bundle → dist/royaume.html (full standalone document) + dist/artifact.html (fragment, see §8)
  tests/core.test.mjs         node:test unit tests of core
  tests/balance.mjs           headless bot strategies over 10 waves → table
  tests/smoke.mjs             Playwright end-to-end on dist/royaume.html (portrait + landscape), screenshots to test-output/
  dist/                       build outputs (committed)
```

Playwright is preinstalled globally: `require('playwright')` / `import { chromium } from 'playwright'` works
(if ESM import fails, use `createRequire`). `chromium.launch()` needs no options; headless WebGL works.
Do NOT run `playwright install`. Use the scratch/test-output dir for screenshots.

## 2. Coordinates & map

- Grid `MAP_W = 22`, `MAP_H = 22` tiles. `TILE = 2` world units. Tile `(x, z)` integers, `0 ≤ x < 22`.
- World position of tile center: `wx = (x - MAP_W/2 + 0.5) * TILE`, `wz = (z - MAP_H/2 + 0.5) * TILE`, y = 0.
- Tile types: `'grass' | 'road' | 'forest' | 'rock' | 'water'`. Forest/rock/water are not buildable.
- Chapter 1 layout (map.js, hand-designed, deterministic): enemy road enters at the north edge (z = 0)
  around x = 11, winds (2–3 bends) south to the village. **Maison commune** at (11, 16). The road ends
  2 tiles north of it (the "village gate" area). Forest clusters west and east (enough for several
  bûcherons), rock outcrops NE and SW (enough for 2+ carrières), a small stream on the west side as decor
  (not crossing the road). Plenty of grass around the village (≥ 40 buildable tiles within 6 of the hall)
  and along the road (for towers).
- `map.path`: ordered list of tile coords along the road from entry to end (enemies follow centers).
- Export: `{ w, h, tiles: string[][] /* [z][x] */, path: [{x,z}], hall: {x,z}, spawn: {x,z}, defaultRally: {x,z} }`.

## 3. Game state shape (plain JSON, serializable)

```js
state = {
  version: 1, seed, rngState,
  chapter: 1, wave: 0 /* waves completed */, wavesTotal: 10,
  phase: 'prep' | 'battle' | 'report' | 'defeat' | 'victory',
  resources: { bois, pierre, nourriture },
  villagers: n /* total villagers, assigned + free */,
  soldiers: [ { id, kind: 'fantassin'|'archer', equip: 0..3, training: 0..3, hpBonus } ],
  actionsLeft, actionsMax,
  buildings: [ { id, type, x, z, hp, workers, destroyed: bool, builtWave } ],
  unlocked: [buildingType...], // types available to build
  rally: {x, z},               // army position (tile), persists
  stats: { kills, soldiersLost, buildingsLost, ... },
  missionsDone: [missionId],
  lastReport: {...} | null,
  log: [] // optional short history for the report
}
```
Ids: incrementing integers from `state.nextId`. All mutations through functions in economy.js/battle.js,
each returning `{ ok: true }` or `{ ok: false, reason: 'texte français lisible' }` — the UI shows `reason`.

## 4. Rules (economy.js) — numbers are defaults; put them in data.js

Resources: bois, pierre, nourriture. Storage cap per resource = Maison commune 100 + 100 per Entrepôt
(+ talents), never below `REGLES.stockageMinimum` (60) so a ruined Maison commune cannot soft-lock the
game. Gains above the cap are lost (report says so).

Start (chapter 1): Maison commune only; resources bois 30, pierre 10, nourriture 30 (+ meta reserves,
capped); 5 villagers; 3 soldiers fantassin equip 0 (mains nues); actionsMax 5 (+ talents);
unlocked: hutte, bucheron, chasseur, palissade, piege.

Manual actions (cost 1 action each):
- `couper_bois` +8 bois · `tailler_pierre` +5 pierre (needs a rock tile on the map — always true) · `chasser` +6 nourriture
- `entrainer` all soldiers training +1 (max 3); each level: +10% dmg, +5 max hp
- `explorer` (unlocked after wave 2): seeded random outcome table in data.js (resources 10–25, a wandering
  villager joins if housing allows, or nothing found); outcome text in French.
Actions refill to actionsMax at the start of each prep phase.

Buildings (1 tile each). Fields in data.js: `nom, description, categorie, cout{}, pv, emplois, production{res, parOuvrier}, logement, stockage, placement, bloqueRoute, tour{portee,degats,cadence}, piege{degats,rayon,recharge}, deblocage`.

| id | nom | coût | pv | effet | placement | débloqué par |
|---|---|---|---|---|---|---|
| maison_commune | Maison commune | reconstruire: 60 bois 30 pierre | 300 | stockage 100, logement 8 | — (unique, start) | start |
| hutte | Hutte | 20 bois | 60 | logement +4 | herbe | start |
| bucheron | Cabane de bûcheron | 15 bois | 60 | 2 emplois × 8 bois | herbe, ≤2 tuiles d'une forêt | start |
| chasseur | Cabane de chasseur | 15 bois | 60 | 2 emplois × 6 nourriture | herbe, ≤2 tuiles d'une forêt | start |
| carriere | Carrière | 20 bois | 80 | 2 emplois × 5 pierre | herbe, ≤2 tuiles d'un rocher | 1er bûcheron construit |
| tour_guet | Tour de guet | 25 bois | 100 | tour portée 3.5 tuiles, 3 dégâts, 1 tir/s | herbe | 1er bûcheron construit |
| champ | Champ | 20 bois 5 pierre | 50 | 3 emplois × 7 nourriture | herbe | vague 3 terminée |
| entrepot | Entrepôt | 25 bois 10 pierre | 100 | stockage +100 | herbe | 1re carrière |
| caserne | Caserne | 30 bois 10 pierre | 150 | +5 places de soldats, permet de recruter | herbe | 1re carrière |
| mur_pierre | Mur de pierre | 10 pierre | 220 | bloque la route | route ou herbe | 1re carrière |
| atelier | Atelier d'armes | 25 bois 15 pierre | 120 | débloque lance, bouclier, arc | herbe | 1re caserne |
| tour_pierre | Tour de pierre | 10 bois 20 pierre | 220 | tour portée 4.5, 8 dégâts, 0.9 s | herbe | 1re carrière |
| palissade | Palissade | 6 bois | 80 | bloque la route si posée sur la route | route ou herbe | start |
| piege | Piège à pieux | 10 bois | — (non ciblable) | levier: 35 dégâts rayon 1 tuile, recharge 15 s | route uniquement | start |

- Building is instant during prep (it's a calm phase). Unlocks trigger a French toast "Nouveau : …".
- Workers: `assign(buildingId, +1/-1)` uses free villagers; free = villagers − Σworkers. Soldiers are separate.
- Housing: Σlogement of non-destroyed buildings ≥ villagers + soldiers count. Soldier capacity = 3 (Maison
  commune) + 5 per Caserne. Recruit (needs a Caserne): one free villager becomes a fantassin, costs 10
  nourriture, requires a free soldier slot.
- Equipment (per soldier, or "équiper tous" bulk button): tier 1 Gourdin (3 bois, no building needed),
  tier 2 Lance (6 bois 2 pierre, Atelier), tier 3 Lance + bouclier (8 bois 4 pierre, Atelier).
  Archer: convert/recruit as archer needs Atelier, 8 bois. Stats in data.js, e.g. fantassin hp 30;
  dmg by tier 3/5/7/7; tier 3 +15 hp; archer hp 22, dmg 4, range 4 tiles.
- Demolish (prep): refunds 50% (rounded down), frees workers. Maison commune cannot be demolished.
  Refused if housing would drop below the population. Housing lost in battle: `REGLES.departsSansToit`
  villager(s) leave at each report while over capacity (the report says so).
- Damaged buildings are fully repaired for free at the end of each battle. Destroyed buildings become ruins
  (`destroyed: true`, keep position, workers freed, no effect, no housing) and can be rebuilt for the full
  cost from their panel. A ruin occupies its tile.
- End of cycle (after a won battle) — `endOfCycle(state)` returns a report object:
  1. production of non-destroyed buildings (workers × parOuvrier × talent multipliers), capped by storage;
  2. consumption: 1 nourriture per villager and per soldier; if short: food goes to 0 and 1 villager leaves
     (or 1 soldier deserts if no villager) per 5 missing food (min 1);
  3. growth: if housing free and nourriture ≥ 10 after consumption → +1 villager (+talent);
  4. repairs; 5. XP (meta) & missions check; 6. actions refill; 7. unlocks check; 8. autosave.
- Defeat: at any moment all buildings destroyed (ruins only) → phase 'defeat'. XP earned is kept (meta).
- Victory: wave `wavesTotal` won → phase 'victory'.

## 5. Battle (battle.js) — pure, deterministic

`createBattle(state, waveIndex)` → `battle` object; `stepBattle(battle, dt)` with fixed dt = 1/30 s (the
render loop accumulates real time × speed and calls step N times); `battle.events` array filled each step
(cleared by the renderer after reading): `{type:'hit'|'death'|'arrow'|'trap'|'building_hit'|'building_destroyed'|'spawn'|'wave_won'|'defeat', ...}`.
Units positions in **tile coordinates as floats** (renderer converts). Speeds in tiles/s.

- Enemies spawn at `map.spawn` one by one (interval in data.js), follow `map.path`.
- Enemy types (data.js): `pillard` (hp 20, dmg 3, cadence 1 s, speed 1.2), `soudard` (hp 40, dmg 5, speed 1.0),
  `archer_ennemi` (hp 18, dmg 4, range 4, targets soldiers then towers), `belier` (battering ram: hp 150,
  dmg 25 vs buildings only, speed 0.6, ignores soldiers), `chef_de_guerre` (boss: hp 400, dmg 12, speed 0.9).
- Waves 1–10 in data.js: list of `{type, count}` + spawn interval. Wave 1: 4 pillards. Ramp so that a
  sensible player wins all 10 with some tension; wave 10 includes the chef de guerre.
- Blocking: if the next path tile has a non-destroyed building with `bloqueRoute`, the enemy stops in
  front and attacks it. Palissade/mur on grass does not block (they're decor-ish there; still targetable
  if adjacent to an enemy that has no other target).
- Enemies engage soldiers within 1.5 tiles (melee) instead of walking on (except bélier).
- Our walls: a standing road blocker between an enemy (before it on the path) and the army (rally after it)
  is never crossed by our soldiers. Melee soldiers hold it from behind: they take a post just behind it
  (`COMBAT.posteMur`) if that post is inside the leash, and strike enemies at its foot across it
  (`COMBAT.allongeMur`); those enemies strike back across it the same way. Enemy archers do not shoot
  soldiers over a standing wall (cover); our archers do shoot over it. `ENNEMIS.*.resistanceTours`
  (bélier, chef de guerre) reduces tower-arrow damage only, so the army matters at the wall.
- After the last path tile, enemies target the nearest non-destroyed building and attack it.
- Soldiers stand around `rally` (formation offsets). They engage enemies within 3.5 tiles of the rally
  point, chase within that leash, return when no target. Archers keep distance and shoot (range).
- Towers shoot the nearest enemy in range (projectile travel time ~0.3 s; damage applied on impact event or
  instantly — your choice, but visuals must match).
- Traps: `triggerTrap(battle, buildingId)` — if charged: all enemies within rayon take degats, starts
  recharge. Recharge also visible in UI. Traps start the battle charged.
- Lever: `moveArmy(battle, {x,z})` sets a new rally point (any walkable non-water tile); soldiers walk there
  and the leash recenters. Persist the final rally into state.
- Soldier death: removed from `state.soldiers` permanently at battle end (track deaths in battle).
- Wave won when all spawned enemies are dead and none left to spawn. Defeat when no non-destroyed
  building remains.
- `finishBattle(state, battle)` writes back: building hp/destroyed, soldiers lost, kills, then for a won
  wave calls `endOfCycle`. Must be safe to call once.
- Safety: hard cap 600 s simulated → remaining enemies retreat (wave counts as won but report says
  "les ennemis se sont retirés"). Prevents soft-locks.

## 6. Meta progression (meta.js) — persistent, separate save key

```js
meta = { version:1, xp, level, talentPoints, talents: [id], reserves:{bois,pierre,nourriture}, chaptersWon:[1], bestWave }
```
- XP per won wave: `10 + 5 × waveNumber + kills`; chapter victory +150. Level n→n+1 needs `100 × n` XP.
  Each level = 1 talent point. XP is added during the game (shown in report) and persists even on defeat.
- Talents (data.js, 3 branches, cost 1 point, some require another):
  Économie: `bras_supplementaires` (+1 action), `bucherons_aguerris` (+25% bois), `greniers` (+50 stockage),
  `natalite` (+1 croissance/cycle). Défense: `pieux_durcis` (+50% pv palissades & murs),
  `archers_de_tour` (+25% dégâts des tours), `pieges_affutes` (+25% dégâts, −30% recharge). Armée:
  `discipline` (+15% dégâts soldats), `veterans` (recrues avec entraînement 1), `rations` (recruter coûte 5 nourriture).
- Talents apply to the current game immediately when bought (between waves) and to future games.
- Missions (chapter 1, data.js): e.g. "Construire une tour avant la vague 3", "Gagner une vague sans perdre
  de soldat", "Atteindre 15 habitants", "Équiper 5 soldats d'une lance". Reward: XP + permanent
  `reserves` (e.g. +10 bois) added to the starting resources of future games. Shown in the Royaume panel.

## 7. Saving

- Storage wrapper with try/catch everywhere (storage may be unavailable → game still works, shows a small
  "sauvegarde indisponible" note once). Keys: `royaume.partie.v1`, `royaume.meta.v1`, `royaume.options.v1`.
- Autosave at start of every prep phase and after every prep action. Battles are not saved mid-way: if the
  page reloads during a battle, the game resumes at the prep phase before that wave (state saved before
  battle start).

## 8. Build (scripts/build.mjs)

- esbuild bundles `src/main.js` (+ three) into one minified IIFE; CSS inlined.
- `dist/royaume.html`: complete standalone document (`<!doctype html>`, `<meta charset>`, viewport meta with
  `viewport-fit=cover`, title, style, script). Must work opened via `file://` (no fetch, no modules, no
  external requests required). Google Fonts link allowed but the game must look fine without it (fallback stack).
- `dist/artifact.html`: same game as a **fragment** for claude.ai hosting: no `<!doctype>`, `<html>`,
  `<head>`, `<body>` tags; starts with `<title>Projet Royaume</title>`,
  `<meta name="claude:viewport-fit-sides" content="cover">`, then `<style>`, then markup, then `<script>`.
  Constraints of that host: no service workers, no alert/confirm/prompt (they do nothing) — so the game
  must never use them anywhere (build in-page confirmations), localStorage may throw (wrapped),
  `html, body { height: 100% }` instead of `100vh`, root padding for safe areas is applied by the host.
- Both outputs from one template so they never diverge. Build must print sizes. Target < 1.2 MB each.

## 9. Rendering (three r170) — look & performance

- Look: stylised low-poly, flat shading, warm late-afternoon sun, soft shadows, gentle fog, sky-gradient
  background, saturated but tasteful palette (greens, ochre road, slate rocks, warm wood, red/blue team
  colours). References: Bad North, Townscaper. It must feel cosy and alive.
- Renderer: antialias, `outputColorSpace = SRGBColorSpace`, ACES tone mapping, shadows PCFSoft (map 1024,
  tight frustum around the map). Quality option "Économie" = pixelRatio 1, no shadows, no antialias;
  "Normale" = pixelRatio min(dpr, 2). Default Normale. Pause the loop when `document.hidden`.
- Terrain: per-tile slight height/colour variation (merged geometry or InstancedMesh), road slightly lower
  and ochre, water animated subtly. Trees/rocks via InstancedMesh with random scale/rotation (seeded).
- Buildings: distinct, recognisable silhouettes per type (hall with flag, huts with straw roofs, lumber
  camp with log pile, quarry with stone blocks, barracks with banner, towers tall with crenels, palisade
  stakes, stone wall, trap = spike pit visible on road, field = crop rows). Pop-in animation when built.
  Damage tint/smoke when hp < 50%, ruins model when destroyed.
- Units: low-poly humanoids (team colour tunic, skin head, weapon mesh by equipment: fists/club/spear/
  spear+shield/bow); enemies red/brown variants, bélier is a wheeled log with roof, chef de guerre bigger
  with helmet plume. Walk bob animation, attack lunge, hit flash, death fall + fade.
- Prep phase life: a few villager figures walk between the hall and workplaces (count ≈ assigned workers,
  capped ~12), idle soldiers stand at the rally flag.
- FX: arrow projectiles, floating damage numbers (pooled), trap spikes + dust, debris + smoke on destroy,
  rally flag marker, ghost preview (green valid / red invalid) with range circle for towers.
- Health bars above units/buildings during battle (billboards, pooled).
- Must hold ~60 fps with 40 units on a mid phone: share geometries/materials, instancing where easy,
  no per-frame allocations in hot paths.

## 10. Camera & input

- Perspective fov 45, orbit around a ground target, pitch ~55°, distance 14–46 (clamped), target clamped to
  map bounds. Touch: 1 finger drag = pan, pinch = zoom, two-finger twist = rotate. Mouse: left drag = pan,
  right drag = rotate, wheel = zoom. Smooth damping.
- Tap vs drag threshold 8 px. Tap on world → pick tile (raycast to ground plane, then tile) → context:
  build mode places ghost (then a confirm button "Construire ici" + cancel; a second tap elsewhere moves the
  ghost); otherwise selects building → building panel. In battle with "Déplacer l'armée" armed → sets rally.
  Tapping a trap in battle triggers it.
- Prevent page scroll/zoom gestures on the canvas (`touch-action: none`), disable context menu on canvas.

## 11. UI (French, mobile-first, single committed visual identity)

- Committed dark game-UI look (single theme is fine: set `color-scheme: dark`, explicit backgrounds,
  every colour a CSS custom property on `:root`). Palette idea: deep slate-blue translucent panels, wheat
  gold accent, parchment-white text, blood-red for danger, moss-green for valid. Avoid the generic
  cream/terracotta look and purple gradients. Display face for titles (e.g. Google Font "Cinzel" or
  "IM Fell English SC") + clean body face ("Inter"), each with a solid fallback stack (offline!).
- Resource icons: small inline SVGs (log, stone, meat/wheat, people, sword, star) — consistent style.
- Top bar: bois/pierre/nourriture with `value/cap`, villageois `libres/total`, soldats, "Vague 3/10",
  kingdom level. Safe-area aware (`env(safe-area-inset-*)`), gutters `max(16px, env(safe-area-inset-left))`.
- Prep bottom bar: Actions (badge actionsLeft), Construire, Armée, Royaume, and a prominent
  "Lancer la vague 4" button. Panels = bottom sheets (max 60% height in portrait, side panel in landscape),
  big tap targets, scroll inside, close button. Disabled items show why ("Manque 5 bois").
- Building panel: name, description, hp, workers − / + with production preview, demolish (in-page
  confirm), rebuild (if ruin), for towers/traps their stats.
- Armée panel: soldier list (kind, equipment, training, hp), Recruter, Équiper (per soldier + "tous"),
  Former un archer.
- Royaume panel: level, XP bar, talent points, talent tree (3 columns), missions with status, reserves.
- Battle HUD: enemies remaining, speed ×1/×2, pause, "Déplacer l'armée" toggle, trap buttons with
  recharge rings (and tap-on-trap in world), no build menus.
- Report (bilan) modal after each wave: victory banner, kills, soldiers lost, buildings lost, production
  per resource (with "perdu: stock plein"), food eaten, population change, XP gained (+level up), missions
  completed, newly unlocked buildings; button "Continuer".
- Defeat screen (XP kept, "Recommencer le chapitre") and Victory screen (stats, XP, "Rejouer le chapitre").
- Title screen: game name "Projet Royaume", subtle animated 3D village in the background is a bonus,
  buttons Continuer (if save) / Nouvelle partie (in-page confirm if a save exists) / Royaume / Options
  (qualité, conseils on/off, effacer la sauvegarde with confirm).
- Tutorial hints (tutorial.js): short French tips at key moments of the first 2 cycles: use actions,
  build a bûcheron near the forest, put villagers in it, build a palissade ON the road, launch the wave,
  during battle: traps & moving the army. Dismissable, never blocking.
- `prefers-reduced-motion`: reduce UI animations. Visible focus states for keyboard.
- Never use alert/confirm/prompt.

## 12. Tests (must pass before you're done)

- `npm test` (node:test): core rules (placement, costs, unlocks, assign, recruit/equip, end-of-cycle
  production/consumption/growth/cap, ruins & rebuild, defeat detection, save round-trip, meta XP/levels/
  talents/missions, battle determinism with same seed, wave 1 won with starting army + a palissade on the road).
- `npm run balance`: bots over 10 waves, print a table per wave (survived?, soldiers lost, buildings lost,
  resources). Bots: `passif` (no defence, should lose early), `raisonnable` (simple sensible build order,
  should win all 10 with some losses), `econome` (economy first, defends late).
- `npm run build` then `npm run smoke`: Playwright loads `dist/royaume.html` via file:// in portrait and
  landscape, starts a new game, spends actions, builds a bûcheron + palissade on the road, assigns a
  worker, launches wave 1, uses speed ×2 and a trap/army move, waits for the report, continues, reloads
  page and checks "Continuer" restores the state. Fails on any console error / page error. Saves
  screenshots (title, prep, build panel, battle, report) in `test-output/`.
