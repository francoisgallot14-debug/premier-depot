// Page de démonstration du rendu (render-demo.html) : un village complet et une vraie bataille
// du cœur du jeu, pour regarder le rendu sans l'interface. Paramètres d'adresse :
//   ?mode=prep|battle|ghost|title|gallery   ?t=secondes simulées d'avance   ?freeze=1 (fige après l'avance)
//   ?yaw=degrés ?dist=14..46 ?tx=&tz= (tuile visée) ?q=economie ?info=1 ?wave=7
//   ?until=trap|building_destroyed&after=0.2 (avance jusqu'à cet événement)   ?selftest=1 (vérifie l'API)
import { createRenderer } from './scene.js';
import { createCameraController } from './camera.js';
import { createWorld } from './world.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'prep';
const info = document.getElementById('info');
const canvas = document.getElementById('c');

function showError(msg) {
  info.style.display = 'block';
  info.textContent = msg;
}

async function main() {
  const Core = await import('../core/index.js');
  const map = Core.getMap(1);
  const ctx = createRenderer(canvas, { quality: params.get('q') || 'normale' });
  let cam = null;
  const world = createWorld(ctx.scene, map, {
    camera: ctx.camera,
    canvas,
    defs: Core.BATIMENTS,
    quality: ctx.quality,
    formation: { spacing: Core.COMBAT.espacementFormation, perRow: Core.COMBAT.soldatsParRang },
    onShake: (s) => cam && cam.shake(s),
  });

  // --- un village bien garni (placé à la main, sans passer par les règles) ---------------
  const state = Core.newGame(Core.newMeta(), { seed: 4242 });
  const add = (type, x, z, extra = {}) => {
    if (map.tiles[z][x] === 'water' || map.tiles[z][x] === 'forest' || map.tiles[z][x] === 'rock') {
      throw new Error(`Démo : tuile invalide pour ${type} en (${x}, ${z})`);
    }
    const b = {
      id: state.nextId++, type, x, z, hp: Core.BATIMENTS[type].pv, workers: 0,
      destroyed: false, builtWave: 0, ...extra,
    };
    state.buildings.push(b);
    return b;
  };
  const gallery = mode === 'gallery';
  let trap1 = null;
  if (gallery) {
    // galerie : chaque type de bâtiment, puis sa ruine
    const types = ['hutte', 'bucheron', 'chasseur', 'carriere', 'tour_guet', 'champ', 'entrepot', 'caserne', 'mur_pierre', 'atelier', 'tour_pierre', 'palissade'];
    types.forEach((t, i) => add(t, 5 + i, 18));
    types.forEach((t, i) => add(t, 6 + i, 20, { destroyed: true, hp: 0 }));
    add('piege', 11, 13);
    add('hutte', 13, 16, { hp: 12 });
  } else {
  add('hutte', 9, 16); add('hutte', 13, 16); add('hutte', 10, 18); add('hutte', 13, 18);
  add('hutte', 9, 18, { destroyed: true, hp: 0 });
  add('bucheron', 16, 14, { workers: 2 });
  add('chasseur', 4, 14, { workers: 2, hp: 22 });
  add('carriere', 5, 19, { workers: 2 });
  add('champ', 7, 18, { workers: 1 }); add('champ', 8, 18, { workers: 1 });
  add('entrepot', 8, 16);
  add('caserne', 14, 16);
  add('atelier', 15, 18, { hp: 25 });
  add('tour_guet', 13, 10);
  add('tour_pierre', 8, 5);
  add('mur_pierre', 10, 12); add('palissade', 11, 12); add('mur_pierre', 12, 12);
  trap1 = add('piege', 13, 11);
  add('piege', 8, 8);
  }
  state.villagers = 14;
  const kinds = [];
  for (let i = 0; i < 9; i++) kinds.push({ kind: 'fantassin', equip: i % 4 });
  for (let i = 0; i < 3; i++) kinds.push({ kind: 'archer', equip: 0 });
  state.soldiers = kinds.map((k) => ({ id: state.nextId++, kind: k.kind, equip: k.equip, training: 1, hpBonus: 0 }));

  world.syncState(state);

  // --- caméra -----------------------------------------------------------------------------
  const tile = (x, z) => world.tileToWorld(x, z);
  const t0 = tile(num('tx', mode === 'battle' ? 12 : gallery ? 9 : 11), num('tz', mode === 'battle' ? 11 : gallery ? 16 : 14));
  cam = createCameraController(ctx.camera, canvas, world.bounds, {
    target: { x: t0.x, z: t0.z },
    distance: num('dist', mode === 'battle' ? 24 : 30),
    yaw: (num('yaw', 0) * Math.PI) / 180,
  });
  if (mode === 'title') {
    cam.setPitchOverride(num('pitch', 34));
    cam.setDistance(num('dist', 40), true);
    cam.setAutoRotate(0.05);
  } else if (params.has('pitch')) cam.setPitchOverride(num('pitch', 55));

  // --- bataille réelle du cœur -------------------------------------------------------------
  let battle = null;
  let acc = 0;
  let trapped = false;
  let simTime = 0;
  const seen = {}; // type d'événement -> instant de la première apparition
  if (mode === 'battle') {
    state.phase = 'battle';
    battle = Core.createBattle(state, num('wave', 7) - 1);
    world.syncState(state);
  }
  // galerie : une fausse bataille immobile (même forme que celle du cœur) pour voir chaque unité
  let fake = null;
  if (gallery) {
    const row = [
      ['ally', 'fantassin', 0], ['ally', 'fantassin', 1], ['ally', 'fantassin', 2], ['ally', 'fantassin', 3], ['ally', 'archer', 0],
      ['enemy', 'pillard'], ['enemy', 'soudard'], ['enemy', 'archer_ennemi'], ['enemy', 'chef_de_guerre'], ['enemy', 'belier'],
    ];
    const sizes = Core.ENNEMIS;
    fake = { time: 0, units: [], buildings: [], events: [] };
    row.forEach(([side, type, equip], i) => {
      fake.units.push({
        id: i + 1, side, type, kind: type, equip: equip || 0, x: 3.4 + i * 0.85 + (type === 'belier' ? 0.4 : 0), z: 14.2,
        hp: i % 3 === 0 ? 10 : 30, maxHp: 30, facing: 0, state: 'idle', attackProgress: 1, hitTime: 9,
        size: side === 'enemy' ? sizes[type].taille : 1,
      });
    });
    state.phase = 'battle';
    world.syncState(state);
  }
  function stepSim(dt) {
    if (fake) {
      // coups réguliers pour voir l'animation de fente
      fake.time += dt;
      fake.units.forEach((u, i) => {
        const c = (fake.time * 0.7 + i * 0.37) % 1.6;
        u.attackProgress = Math.min(1, c / 0.35);
        u.hitTime = (fake.time + i * 0.5) % 2.5;
      });
      return;
    }
    if (!battle || battle.over) return;
    acc += dt;
    const step = Core.COMBAT.pas;
    while (acc >= step) {
      Core.stepBattle(battle, step);
      acc -= step;
      simTime += step;
      // la démo déclenche le piège dès qu'un groupe passe dessus
      if (!trapped && trap1) {
        let n = 0;
        for (const u of battle.units) if (u.side === 'enemy' && u.state !== 'dead' && Math.hypot(u.x - trap1.x, u.z - trap1.z) < 1.1) n++;
        if (n >= 2) { Core.triggerTrap(battle, trap1.id); trapped = true; }
      }
      for (const e of battle.events) if (seen[e.type] === undefined) seen[e.type] = simTime;
      world.consumeEvents(battle.events);
    }
  }

  // --- fantôme et sélection (mode ghost) ----------------------------------------------------
  if (mode === 'ghost') {
    if (params.get('bad') === '1') world.setGhost('caserne', 17, 13, false, 0); // forêt : invalide
    else world.setGhost('tour_pierre', 14, 13, true, Core.BATIMENTS.tour_pierre.tour.portee);
    world.setSelected(14, 16);
  }
  if (params.get('leash') === '1') world.showRallyRange(true);

  // avance simulée (déterministe) avant d'afficher
  const fdt = 1 / 30;
  function advance(sec) {
    for (let t = 0; t < sec; t += fdt) {
      stepSim(fdt);
      if (battle) world.syncBattle(battle, acc / Core.COMBAT.pas);
      if (fake) world.syncBattle(fake, 1);
      world.update(fdt);
    }
  }
  const until = params.get('until');
  if (until && battle) {
    // avance jusqu'au premier événement de ce type (piège, bâtiment détruit…), puis un peu plus
    let guard = 0;
    while (seen[until] === undefined && guard++ < 30 * 300) advance(fdt);
    advance(num('after', 0.2));
  } else {
    advance(num('t', mode === 'battle' ? 24 : 6));
  }
  cam.update(1);

  // --- interactions de test : tap = sélection (prép.) / déplacer l'armée ou piège (bataille) ---
  cam.onTap((cx, cy) => {
    const p = world.pickTile(cx, cy);
    if (!p) { world.setSelected(null); return; }
    if (battle) {
      const trap = battle.buildings.find((b) => b.trap && b.x === p.x && b.z === p.z);
      if (trap) Core.triggerTrap(battle, trap.id);
      else if (Core.moveArmy(battle, p).ok) world.setRally(p.x, p.z);
    } else {
      world.setSelected(p.x, p.z);
    }
  });

  const freeze = params.get('freeze') === '1';
  let frames = 0, fpsT = 0;
  ctx.start((dt) => {
    const d = freeze ? 0 : dt;
    stepSim(d);
    if (battle) world.syncBattle(battle, acc / Core.COMBAT.pas);
    if (fake) world.syncBattle(fake, 1);
    cam.update(dt);
    ctx.setFogForDistance(cam.getState().distance);
    world.update(d);
    frames++;
    fpsT += dt;
    if (fpsT >= 1 && params.get('info') === '1') {
      info.style.display = 'block';
      info.textContent = `${mode} · ${Math.round(frames / fpsT)} img/s · ${ctx.renderer.info.render.calls} appels`;
      frames = 0; fpsT = 0;
    }
  });
  window.__demo = { ctx, world, cam, state, get battle() { return battle; }, Core, advance, seen, ready: false };
  if (params.get('selftest') === '1') {
    const r = await selfTest({ ctx, world, cam, state, Core, map, canvas });
    window.__demo.selftest = r;
    if (r.ok) console.log('AUTOTEST OK', JSON.stringify(r.perf));
    else console.error('AUTOTEST ÉCHEC : ' + r.failures.join(' | '));
  }
  window.__demo.ready = true;
}

/**
 * Vérifie l'API du rendu dans le vrai navigateur : sélection de tuile, fantômes de tous les types,
 * construction / destruction / reconstruction / démolition, événements de formes variées,
 * gestes de caméra, qualité, et coût d'une image de bataille chargée.
 */
async function selfTest({ ctx, world, cam, state, Core, map, canvas }) {
  const failures = [];
  const check = (cond, msg) => { if (!cond) failures.push(msg); };
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { cam.update(1 / 30); world.update(1 / 30); ctx.render(); } };
  try {
    // 1. tuile -> écran -> tuile (le rayon retrouve la même tuile)
    cam.setTarget(world.tileToWorld(11, 14).x, world.tileToWorld(11, 14).z, true);
    cam.setDistance(30, true);
    frame();
    const rect = canvas.getBoundingClientRect();
    let tested = 0;
    for (const [x, z] of [[11, 16], [11, 12], [9, 14], [13, 15], [10, 17], [12, 11]]) {
      const sp = world.tileToScreen(x, z, 0);
      if (!sp.visible) continue;
      tested++;
      const p = world.pickTile(rect.left + sp.x, rect.top + sp.y);
      check(p && p.x === x && p.z === z, `pickTile(${x},${z}) a donné ${JSON.stringify(p)}`);
    }
    check(tested >= 3, 'pas assez de tuiles visibles pour tester pickTile');
    // 2. fantômes de tous les types, valides et non valides
    for (const t of Object.keys(Core.BATIMENTS)) {
      const def = Core.BATIMENTS[t];
      world.setGhost(t, 12, 14, true, def.tour ? def.tour.portee : 0);
      frame();
      world.setGhost(t, 3, 3, false, 0);
      frame();
    }
    world.clearGhost();
    // 3. cycle de vie d'un bâtiment
    const before = world.getStats().buildings;
    const b = { id: state.nextId++, type: 'tour_guet', x: 14, z: 13, hp: 100, workers: 0, destroyed: false, builtWave: 0 };
    state.buildings.push(b);
    world.syncState(state); frame(10);
    check(world.getStats().buildings === before + 1, 'bâtiment ajouté non affiché');
    b.hp = 30; world.syncState(state); frame(10);
    b.destroyed = true; b.hp = 0; world.syncState(state); frame(20);
    check(world.getStats().ruins >= 1, 'ruine non affichée');
    b.destroyed = false; b.hp = 100; world.syncState(state); frame(20);
    state.buildings.splice(state.buildings.indexOf(b), 1);
    world.syncState(state); frame(5);
    check(world.getStats().buildings === before, 'bâtiment démoli encore affiché');
    // 4. événements de formes variées (robustesse) : rien ne doit planter, le tableau est vidé
    const evs = [
      { type: 'arrow', from: { x: 13, z: 10 }, to: { x: 11, z: 9 }, duration: 0.3, sourceKind: 'tower', sourceId: 1, targetId: 99, side: 'ally' },
      { type: 'arrow', x0: 1, z0: 1, x1: 2, z1: 2 },
      { type: 'arrow' },
      { type: 'hit', targetId: 12345, side: 'enemy', amount: 7, x: 11, z: 10, cause: 'tower' },
      { type: 'hit', amount: 3 },
      { type: 'death', unitId: 777, side: 'ally', x: 11, z: 13 },
      { type: 'trap', buildingId: -1, x: 13, z: 11 },
      { type: 'building_hit', buildingId: 1, amount: 12, hp: 200, maxHp: 300 },
      { type: 'building_destroyed', buildingId: 424242 },
      { type: 'spawn', unitId: 5, x: 11, z: 0 },
      { type: 'wave_won' }, { type: 'defeat' }, { type: 'inconnu' }, null,
    ];
    world.consumeEvents(evs); frame(30);
    check(evs.length === 0, 'consumeEvents ne vide pas le tableau');
    // 5. gestes de caméra (événements de pointeur synthétiques)
    const s0 = cam.getState();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const fire = (type, id, x, y, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: extra.mouse ? 'mouse' : 'touch', clientX: x, clientY: y, button: extra.button || 0, bubbles: true, isPrimary: id === 1 }));
    fire('pointerdown', 1, cx, cy); fire('pointermove', 1, cx + 30, cy + 10); fire('pointermove', 1, cx + 80, cy + 40); fire('pointerup', 1, cx + 80, cy + 40);
    frame(30);
    const s1 = cam.getState();
    check(Math.hypot(s1.x - s0.x, s1.z - s0.z) > 0.5, 'le glisser à un doigt ne déplace pas la caméra');
    fire('pointerdown', 1, cx - 50, cy); fire('pointerdown', 2, cx + 50, cy);
    fire('pointermove', 1, cx - 120, cy); fire('pointermove', 2, cx + 120, cy);
    fire('pointerup', 1, cx - 120, cy); fire('pointerup', 2, cx + 120, cy);
    frame(40);
    const s2 = cam.getState();
    check(s2.distance < s1.distance - 1, 'pincer pour zoomer ne marche pas');
    fire('pointerdown', 1, cx - 60, cy); fire('pointerdown', 2, cx + 60, cy);
    fire('pointermove', 1, cx - 42, cy - 42); fire('pointermove', 2, cx + 42, cy + 42);
    fire('pointerup', 1, cx - 42, cy - 42); fire('pointerup', 2, cx + 42, cy + 42);
    frame(40);
    check(Math.abs(cam.getState().yaw - s2.yaw) > 0.3, 'tourner à deux doigts ne marche pas');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    frame(40);
    check(cam.getState().distance > s2.distance + 1, 'la molette ne dézoome pas');
    let taps = 0;
    const off = cam.onTap(() => taps++);
    fire('pointerdown', 1, cx, cy); fire('pointermove', 1, cx + 3, cy + 2); fire('pointerup', 1, cx + 3, cy + 2);
    fire('pointerdown', 1, cx, cy); fire('pointermove', 1, cx + 40, cy); fire('pointerup', 1, cx + 40, cy);
    off();
    check(taps === 1, `tap détecté ${taps} fois au lieu d'une`);
    const yawR = cam.getState().yaw;
    fire('pointerdown', 1, cx, cy, { mouse: true, button: 2 }); fire('pointermove', 1, cx + 100, cy, { mouse: true }); fire('pointerup', 1, cx + 100, cy, { mouse: true });
    frame(20);
    check(Math.abs(cam.getState().yaw - yawR) > 0.3, 'clic droit + glisser ne tourne pas');
    // 6. qualité
    const q1 = ctx.setQuality('economie'); frame(); world.setQuality('economie');
    const q2 = ctx.setQuality('normale'); frame(); world.setQuality('normale');
    check(typeof q1.needsReload === 'boolean' && typeof q2.needsReload === 'boolean', 'setQuality ne répond pas');
    // 7. coût d'une image de bataille chargée (vague 10, ~40 unités)
    const st = Core.newGame(Core.newMeta(), { seed: 99 });
    st.buildings.push({ id: st.nextId++, type: 'palissade', x: 11, z: 12, hp: 80, workers: 0, destroyed: false, builtWave: 0 });
    st.buildings.push({ id: st.nextId++, type: 'tour_guet', x: 13, z: 10, hp: 100, workers: 0, destroyed: false, builtWave: 0 });
    for (let i = 0; i < 9; i++) st.soldiers.push({ id: st.nextId++, kind: i % 3 ? 'fantassin' : 'archer', equip: i % 4, training: 2, hpBonus: 0 });
    st.phase = 'battle';
    world.syncState(st);
    const bt = Core.createBattle(st, 9);
    let tUpd = 0, frames = 0, maxUnits = 0;
    for (let i = 0; i < 30 * 70 && !bt.over; i++) {
      Core.stepBattle(bt, 1 / 30);
      const t0 = performance.now();
      world.consumeEvents(bt.events);
      world.syncBattle(bt, 0.5);
      world.update(1 / 30);
      tUpd += performance.now() - t0;
      frames++;
      maxUnits = Math.max(maxUnits, world.getStats().battleUnits);
    }
    world.syncBattle(null);
    st.phase = 'prep';
    world.syncState(state);
    frame(5);
    check(maxUnits >= 30, `bataille trop petite pour mesurer (${maxUnits} unités)`);
    return { ok: failures.length === 0, failures, perf: { msParImage: +(tUpd / frames).toFixed(3), images: frames, unitesMax: maxUnits } };
  } catch (e) {
    failures.push('exception : ' + (e && e.stack ? e.stack : e));
    return { ok: false, failures, perf: null };
  }
}

function num(k, d) {
  const v = parseFloat(params.get(k));
  return Number.isFinite(v) ? v : d;
}

main().catch((e) => {
  console.error(e);
  showError('Erreur : ' + (e && e.message ? e.message : e));
});
