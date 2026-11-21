// Tests unitaires du cœur du jeu (node:test). Lancer : npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as C from '../src/core/index.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const CORE = join(ICI, '..', 'src', 'core');

// --- outils ---------------------------------------------------------
function partie(opts = {}) {
  const meta = opts.meta ?? C.newMeta();
  const state = C.newGame(meta, { seed: opts.seed ?? 7 });
  return { meta, state };
}
function riche(state, n = 500) {
  // Pour tester les règles sans se soucier du coût (on monte aussi le stockage).
  state.buildings.push({ id: state.nextId++, type: 'entrepot', x: 14, z: 18, hp: 100, workers: 0, destroyed: false, builtWave: 0 });
  state.buildings.push({ id: state.nextId++, type: 'entrepot', x: 15, z: 18, hp: 100, workers: 0, destroyed: false, builtWave: 0 });
  state.buildings.push({ id: state.nextId++, type: 'entrepot', x: 16, z: 18, hp: 100, workers: 0, destroyed: false, builtWave: 0 });
  state.buildings.push({ id: state.nextId++, type: 'entrepot', x: 14, z: 19, hp: 100, workers: 0, destroyed: false, builtWave: 0 });
  state.resources = { bois: n, pierre: n, nourriture: n };
}
function debloquerTout(state) {
  state.unlocked = [...C.ORDRE_BATIMENTS];
}
const bat = (state, type) => state.buildings.find((b) => b.type === type);
function gagnerVague(state, meta = null) {
  const r = C.startBattle(state);
  assert.ok(r.ok, r.reason);
  C.runBattle(r.battle, {
    onStep: (b) => {
      for (const t of b.buildings) if (t.trap?.ready) C.triggerTrap(b, t.id);
    },
  });
  return { battle: r.battle, report: C.finishBattle(state, r.battle, meta) };
}

// --- carte ----------------------------------------------------------
describe('carte du chapitre 1', () => {
  const map = C.getMap(1);

  test('dimensions et forme exportée', () => {
    assert.equal(map.w, 22);
    assert.equal(map.h, 22);
    assert.equal(map.tiles.length, 22);
    assert.ok(map.tiles.every((row) => row.length === 22));
    assert.deepEqual(map.hall, { x: 11, z: 16 });
    assert.ok(Object.isFrozen(map));
  });

  test('la route entre au nord vers x = 11 et finit 2 tuiles au nord de la Maison commune', () => {
    assert.equal(map.path[0].z, 0);
    assert.ok(Math.abs(map.path[0].x - 11) <= 1);
    assert.deepEqual(map.spawn, map.path[0]);
    const fin = map.path[map.path.length - 1];
    assert.deepEqual(fin, { x: map.hall.x, z: map.hall.z - 2 });
  });

  test('la route est continue, sans doublon, et chaque tuile du chemin est de la route', () => {
    const vus = new Set();
    for (let i = 0; i < map.path.length; i++) {
      const p = map.path[i];
      assert.equal(C.tileAt(map, p.x, p.z), 'road');
      assert.ok(!vus.has(`${p.x},${p.z}`));
      vus.add(`${p.x},${p.z}`);
      if (i > 0) {
        const q = map.path[i - 1];
        assert.equal(Math.abs(p.x - q.x) + Math.abs(p.z - q.z), 1);
      }
    }
  });

  test('la route a 2 à 3 grands virages (épingles)', () => {
    // Un virage = un changement de direction ; une épingle en compte deux.
    let changements = 0;
    for (let i = 2; i < map.path.length; i++) {
      const a = map.path[i - 2];
      const b = map.path[i - 1];
      const c = map.path[i];
      if (b.x - a.x !== c.x - b.x || b.z - a.z !== c.z - b.z) changements++;
    }
    assert.ok(changements >= 4 && changements <= 6, `changements de direction : ${changements}`);
  });

  test('au moins 40 tuiles constructibles à 6 tuiles de la Maison commune', () => {
    let n = 0;
    for (let z = 0; z < 22; z++) {
      for (let x = 0; x < 22; x++) {
        if (map.tiles[z][x] === 'grass' && !(x === 11 && z === 16) && Math.hypot(x - 11, z - 16) <= 6) n++;
      }
    }
    assert.ok(n >= 40, `seulement ${n}`);
  });

  test('forêts à l’ouest et à l’est, rochers au nord-est et au sud-ouest, ruisseau à l’ouest loin de la route', () => {
    const compte = (type, f) => {
      let n = 0;
      for (let z = 0; z < 22; z++) for (let x = 0; x < 22; x++) if (map.tiles[z][x] === type && f(x, z)) n++;
      return n;
    };
    assert.ok(compte('forest', (x) => x <= 5) >= 8);
    assert.ok(compte('forest', (x) => x >= 16) >= 8);
    assert.ok(compte('rock', (x, z) => x >= 14 && z <= 7) >= 3);
    assert.ok(compte('rock', (x, z) => x <= 7 && z >= 14) >= 3);
    assert.ok(compte('water', (x) => x <= 5) >= 5);
    for (let z = 0; z < 22; z++) {
      for (let x = 0; x < 22; x++) {
        if (map.tiles[z][x] !== 'water') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(C.tileAt(map, x + dx, z + dz), 'road');
      }
    }
  });

  test('assez d’emplacements pour plusieurs bûcherons et 2 carrières', () => {
    const { state } = partie();
    debloquerTout(state);
    riche(state);
    assert.ok(C.validTiles(state, 'bucheron').length >= 10);
    assert.ok(C.validTiles(state, 'carriere').length >= 6);
    // De l'herbe le long de la route pour les tours.
    const prèsRoute = C.validTiles(state, 'tour_guet').filter((t) => map.path.some((p) => Math.hypot(p.x - t.x, p.z - t.z) <= 1.5));
    assert.ok(prèsRoute.length >= 20);
  });

  test('conversion tuile ↔ monde', () => {
    assert.deepEqual(C.tileToWorld(0, 0), { wx: -21, wz: -21 });
    assert.deepEqual(C.tileToWorld(11, 16), { wx: 1, wz: 11 });
    assert.deepEqual(C.worldToTile(1, 11), { x: 11, z: 16 });
    assert.deepEqual(C.worldToTile(1.9, 10.1), { x: 11, z: 16 });
  });
});

// --- hasard -----------------------------------------------------------
describe('hasard déterministe', () => {
  test('même graine, même suite', () => {
    const a = C.createRng(123);
    const b = C.createRng(123);
    for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
    const c = C.createRng('royaume');
    assert.ok(c.next() >= 0 && c.next() < 1);
  });

  test('int reste dans les bornes', () => {
    const r = C.createRng(5);
    for (let i = 0; i < 500; i++) {
      const v = r.int(10, 25);
      assert.ok(v >= 10 && v <= 25 && Number.isInteger(v));
    }
  });

  test('aucun Math.random dans src/core', () => {
    for (const f of readdirSync(CORE)) {
      const txt = readFileSync(join(CORE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/Math\.random/.test(txt), `Math.random trouvé dans ${f}`);
      assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(txt), `alert/confirm/prompt dans ${f}`);
      assert.ok(!/\b(document|window)\./.test(txt), `DOM dans ${f}`);
    }
  });
});

// --- début de partie --------------------------------------------------
describe('nouvelle partie', () => {
  test('départ du chapitre 1', () => {
    const { state } = partie();
    assert.equal(state.version, 1);
    assert.equal(state.phase, 'prep');
    assert.equal(state.wave, 0);
    assert.equal(state.wavesTotal, 10);
    assert.deepEqual(state.resources, { bois: 30, pierre: 10, nourriture: 30 });
    assert.equal(state.villagers, 5);
    assert.equal(state.soldiers.length, 3);
    assert.ok(state.soldiers.every((s) => s.kind === 'fantassin' && s.equip === 0 && s.training === 0));
    assert.equal(state.actionsMax, 5);
    assert.equal(state.actionsLeft, 5);
    assert.equal(state.buildings.length, 1);
    assert.equal(state.buildings[0].type, 'maison_commune');
    assert.deepEqual(state.unlocked.sort(), ['bucheron', 'chasseur', 'hutte', 'palissade', 'piege']);
    assert.equal(C.storageCap(state), 100);
    assert.equal(C.housingCapacity(state), 8);
    assert.equal(C.soldierCapacity(state), 3);
    assert.equal(C.freeVillagers(state), 5);
  });

  test('les réserves du royaume s’ajoutent au départ, plafonnées par le stockage', () => {
    const meta = C.newMeta();
    meta.reserves = { bois: 20, pierre: 500, nourriture: 0 };
    const state = C.newGame(meta, { seed: 1 });
    assert.equal(state.resources.bois, 50);
    assert.equal(state.resources.pierre, 100);
  });

  test('les talents du royaume s’appliquent à la nouvelle partie', () => {
    const meta = C.newMeta();
    meta.talents = ['bras_supplementaires', 'bucherons_aguerris', 'greniers'];
    const state = C.newGame(meta, { seed: 1 });
    assert.equal(state.actionsMax, 6);
    assert.equal(C.storageCap(state), 150);
  });
});

// --- actions ----------------------------------------------------------
describe('actions manuelles', () => {
  test('couper, tailler, chasser coûtent 1 action et rapportent', () => {
    const { state } = partie();
    assert.ok(C.doAction(state, 'couper_bois').ok);
    assert.ok(C.doAction(state, 'tailler_pierre').ok);
    assert.ok(C.doAction(state, 'chasser').ok);
    assert.deepEqual(state.resources, { bois: 38, pierre: 15, nourriture: 36 });
    assert.equal(state.actionsLeft, 2);
  });

  test("plus d'action : refus avec une raison", () => {
    const { state } = partie();
    for (let i = 0; i < 5; i++) assert.ok(C.doAction(state, 'couper_bois').ok);
    const r = C.doAction(state, 'couper_bois');
    assert.equal(r.ok, false);
    assert.match(r.reason, /action/);
  });

  test('le stockage plafonne les gains, réserve pleine refusée', () => {
    const { state } = partie();
    state.resources.bois = 96;
    const r = C.doAction(state, 'couper_bois');
    assert.ok(r.ok);
    assert.equal(state.resources.bois, 100);
    assert.equal(r.lost.bois, 4);
    const r2 = C.doAction(state, 'couper_bois');
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'plein');
  });

  test('entraîner : +1 pour tous (max 3), +10 % dégâts et +5 PV par niveau', () => {
    const { state } = partie();
    const avant = C.soldierStats(state, state.soldiers[0]);
    for (let i = 0; i < 3; i++) assert.ok(C.doAction(state, 'entrainer').ok);
    assert.ok(state.soldiers.every((s) => s.training === 3));
    const apres = C.soldierStats(state, state.soldiers[0]);
    assert.equal(apres.maxHp, avant.maxHp + 15);
    assert.ok(Math.abs(apres.dmg - avant.dmg * 1.3) < 1e-9);
    const r = C.doAction(state, 'entrainer');
    assert.equal(r.ok, false);
  });

  test('explorer : débloqué après la vague 2, résultat déterministe', () => {
    const { state } = partie({ seed: 99 });
    assert.equal(C.doAction(state, 'explorer').ok, false);
    state.wave = 2;
    const nouveaux = C.checkUnlocks(state);
    assert.ok(nouveaux.some((n) => n.id === 'explorer'));
    const copie = C.cloneState(state);
    const r1 = C.doAction(state, 'explorer');
    const r2 = C.doAction(copie, 'explorer');
    assert.ok(r1.ok);
    assert.equal(r1.message, r2.message);
    assert.deepEqual(state.resources, copie.resources);
    assert.equal(typeof r1.message, 'string');
    assert.ok(r1.message.length > 5);
  });

  test("explorer varie d'une fois à l'autre et respecte les bornes", () => {
    const { state } = partie({ seed: 3 });
    state.wave = 2;
    C.checkUnlocks(state);
    const issues = new Set();
    for (let i = 0; i < 40; i++) {
      state.actionsLeft = 1;
      state.resources = { bois: 0, pierre: 0, nourriture: 0 };
      const r = C.doAction(state, 'explorer');
      assert.ok(r.ok);
      issues.add(r.outcome);
      const total = state.resources.bois + state.resources.pierre + state.resources.nourriture;
      if (r.outcome === 'ressource') assert.ok(total >= 10 && total <= 25);
    }
    assert.ok(issues.size >= 2);
  });
});

// --- construction -----------------------------------------------------
describe('construction et placement', () => {
  test('bûcheron près de la forêt : coût payé, ouvrier placé', () => {
    const { state } = partie();
    const r = C.build(state, 'bucheron', 5, 13);
    assert.ok(r.ok, r.reason);
    assert.equal(state.resources.bois, 15);
    assert.equal(r.building.hp, 60);
    assert.equal(r.building.workers, 0);
  });

  test('refus lisibles : loin de la forêt, sur la route, eau, rocher, occupé, entrée ennemie', () => {
    const { state } = partie();
    riche(state);
    debloquerTout(state);
    assert.equal(C.canPlace(state, 'bucheron', 11, 8).code, 'tuile'); // route
    const loin = C.canPlace(state, 'bucheron', 10, 5);
    assert.equal(loin.code, 'pres');
    assert.match(loin.reason, /forêt/);
    assert.match(C.canPlace(state, 'carriere', 10, 5).reason, /rocher/);
    assert.equal(C.canPlace(state, 'hutte', 3, 0).code, 'tuile'); // eau
    assert.equal(C.canPlace(state, 'hutte', 17, 0).code, 'tuile'); // rocher
    assert.equal(C.canPlace(state, 'hutte', 11, 16).code, 'occupe'); // Maison commune
    assert.equal(C.canPlace(state, 'palissade', 11, 0).code, 'tuile'); // entrée des ennemis
    assert.equal(C.canPlace(state, 'hutte', -1, 3).code, 'tuile');
    assert.ok(C.build(state, 'hutte', 10, 15).ok);
    assert.equal(C.canPlace(state, 'hutte', 10, 15).code, 'occupe');
  });

  test('pièges seulement sur la route ; palissade et mur sur route ou herbe ; tours sur l’herbe', () => {
    const { state } = partie();
    riche(state);
    debloquerTout(state);
    assert.equal(C.canPlace(state, 'piege', 10, 10).code, 'tuile');
    assert.ok(C.canPlace(state, 'piege', 11, 12).ok);
    assert.ok(C.canPlace(state, 'palissade', 11, 12).ok);
    assert.ok(C.canPlace(state, 'palissade', 10, 10).ok);
    assert.ok(C.canPlace(state, 'mur_pierre', 11, 12).ok);
    assert.equal(C.canPlace(state, 'tour_guet', 11, 12).code, 'tuile');
    assert.ok(C.canPlace(state, 'tour_guet', 12, 10).ok);
  });

  test('pas assez de ressources : « Manque … »', () => {
    const { state } = partie();
    state.resources.bois = 5;
    const r = C.build(state, 'hutte', 10, 15);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'cout');
    assert.equal(r.reason, 'Manque 15 bois');
    state.unlocked.push('entrepot');
    state.resources.pierre = 0;
    assert.equal(C.canPlace(state, 'entrepot', 10, 15).reason, 'Manque 20 bois et 10 pierre');
    assert.equal(state.resources.bois, 5);
  });

  test('pas encore débloqué', () => {
    const { state } = partie();
    const r = C.canPlace(state, 'carriere', 6, 18);
    assert.equal(r.code, 'verrou');
    assert.match(r.reason, /bûcheron/);
  });

  test('construction refusée hors préparation', () => {
    const { state } = partie();
    state.phase = 'battle';
    assert.equal(C.build(state, 'hutte', 10, 15).code, 'phase');
  });

  test('chaîne de déblocages', () => {
    const { state } = partie();
    riche(state);
    let r = C.build(state, 'bucheron', 5, 13);
    assert.deepEqual(r.unlocked.map((u) => u.id).sort(), ['carriere', 'tour_guet']);
    r = C.build(state, 'carriere', 6, 18);
    assert.ok(r.ok, r.reason);
    // la carrière fournit la pierre : murs, tour de pierre, entrepôt et caserne arrivent avec elle
    assert.deepEqual(r.unlocked.map((u) => u.id).sort(), ['caserne', 'entrepot', 'mur_pierre', 'tour_pierre']);
    r = C.build(state, 'caserne', 9, 16);
    assert.deepEqual(r.unlocked.map((u) => u.id), ['atelier']);
    r = C.build(state, 'atelier', 9, 17);
    assert.deepEqual(r.unlocked.map((u) => u.id), []);
    assert.ok(!state.unlocked.includes('champ'));
    state.wave = 3;
    assert.deepEqual(C.checkUnlocks(state).filter((u) => u.kind === 'batiment').map((u) => u.id), ['champ']);
  });

  test('menu Construire : raisons affichées', () => {
    const { state } = partie();
    const menu = C.buildOptions(state);
    assert.equal(menu.length, C.ORDRE_BATIMENTS.length);
    const carriere = menu.find((m) => m.type === 'carriere');
    assert.equal(carriere.ok, false);
    assert.match(carriere.reason, /Construisez/);
    const hutte = menu.find((m) => m.type === 'hutte');
    assert.ok(hutte.ok);
    assert.equal(hutte.coutTexte, '20 bois');
  });

  test('démolir rend 50 % (arrondi bas) ; Maison commune protégée', () => {
    const { state } = partie();
    const b = C.build(state, 'chasseur', 5, 13).building;
    assert.equal(state.resources.bois, 15);
    C.assign(state, b.id, +1);
    const r = C.demolish(state, b.id);
    assert.ok(r.ok);
    assert.equal(state.resources.bois, 22);
    assert.equal(C.freeVillagers(state), 5);
    assert.equal(C.demolish(state, state.buildings[0].id).ok, false);
  });

  test('fiche d’un bâtiment pour le panneau', () => {
    const { state } = partie();
    const b = C.build(state, 'bucheron', 5, 13).building;
    C.assign(state, b.id, 1);
    let info = C.buildingInfo(state, b.id);
    assert.equal(info.nom, 'Cabane de bûcheron');
    assert.deepEqual(info.production, { res: 'bois', parOuvrier: 8, actuelle: 8, avecUnDePlus: 16 });
    assert.ok(info.demolir.ok);
    assert.deepEqual(info.demolir.remboursement, { bois: 7 });
    assert.equal(info.reconstruire, null);
    const hall = C.buildingInfo(state, state.buildings[0].id);
    assert.equal(hall.demolir.ok, false);
    assert.equal(hall.tour.portee, 3);
    state.resources.bois = 30;
    const p = C.build(state, 'palissade', 11, 12).building;
    assert.equal(C.buildingInfo(state, p.id).bloqueRoute, true);
    b.destroyed = true;
    b.workers = 0;
    info = C.buildingInfo(state, b.id);
    assert.equal(info.reconstruire.coutTexte, '15 bois');
    assert.equal(info.reconstruire.ok, true);
    assert.equal(C.buildingInfo(state, 999), null);
  });

  test('impossible de démolir son dernier bâtiment debout', () => {
    const { state } = partie();
    const h = C.build(state, 'hutte', 10, 15).building;
    state.buildings[0].destroyed = true;
    const r = C.demolish(state, h.id);
    assert.equal(r.ok, false);
    assert.match(r.reason, /dernier/);
  });
});

// --- ouvriers, armée --------------------------------------------------
describe('villageois et armée', () => {
  test('placer et retirer des ouvriers', () => {
    const { state } = partie();
    const b = C.build(state, 'bucheron', 5, 13).building;
    assert.ok(C.assign(state, b.id, +1).ok);
    assert.ok(C.assign(state, b.id, +1).ok);
    const r = C.assign(state, b.id, +1);
    assert.equal(r.ok, false);
    assert.match(r.reason, /2\/2/);
    assert.equal(C.freeVillagers(state), 3);
    assert.ok(C.assign(state, b.id, -1).ok);
    assert.equal(C.freeVillagers(state), 4);
    assert.equal(C.assign(state, state.buildings[0].id, +1).ok, false);
  });

  test('aucun villageois libre', () => {
    const { state } = partie();
    riche(state);
    const a = C.build(state, 'bucheron', 5, 13).building;
    const b = C.build(state, 'chasseur', 5, 14).building;
    const c = C.build(state, 'bucheron', 15, 15).building;
    for (const x of [a, a, b, b, c]) assert.ok(C.assign(state, x.id, +1).ok);
    const r = C.assign(state, c.id, +1);
    assert.equal(r.reason, 'Aucun villageois libre.');
  });

  test('recruter : caserne, villageois libre, 10 nourriture, places', () => {
    const { state } = partie();
    riche(state);
    debloquerTout(state);
    assert.equal(C.recruit(state).reason, 'Il faut une caserne.');
    C.build(state, 'caserne', 9, 16);
    const avant = state.resources.nourriture;
    const r = C.recruit(state);
    assert.ok(r.ok, r.reason);
    assert.equal(state.villagers, 4);
    assert.equal(state.soldiers.length, 4);
    assert.equal(state.resources.nourriture, avant - 10);
    assert.equal(C.population(state), 8);
    for (let i = 0; i < 4; i++) assert.ok(C.recruit(state).ok);
    assert.equal(state.soldiers.length, 8);
    assert.match(C.recruit(state).reason, /place/);
  });

  test('archer : il faut un atelier et du bois', () => {
    const { state } = partie();
    riche(state);
    debloquerTout(state);
    C.build(state, 'caserne', 9, 16);
    assert.match(C.recruit(state, 'archer').reason, /atelier/);
    C.build(state, 'atelier', 9, 17);
    const bois = state.resources.bois;
    const r = C.recruit(state, 'archer');
    assert.ok(r.ok, r.reason);
    assert.equal(r.soldier.kind, 'archer');
    assert.equal(state.resources.bois, bois - 8);
    const s = state.soldiers[0];
    assert.ok(C.convertToArcher(state, s.id).ok);
    assert.equal(s.kind, 'archer');
    const st = C.soldierStats(state, s);
    assert.equal(st.maxHp, C.TYPES_SOLDATS.archer.pv);
    assert.equal(st.range, C.TYPES_SOLDATS.archer.portee);
  });

  test('équipement : gourdin sans bâtiment, lance avec atelier, coûts et stats', () => {
    const { state } = partie();
    riche(state);
    debloquerTout(state);
    const s = state.soldiers[0];
    assert.equal(C.soldierStats(state, s).dmg, 3);
    assert.ok(C.equip(state, s.id, 1).ok);
    assert.equal(state.resources.bois, 497);
    assert.equal(C.soldierStats(state, s).dmg, 5);
    assert.match(C.equip(state, s.id, 2).reason, /atelier/);
    C.build(state, 'atelier', 9, 17);
    assert.ok(C.equip(state, s.id, 3).ok);
    const st = C.soldierStats(state, s);
    assert.equal(st.dmg, 7);
    assert.equal(st.maxHp, 45);
    assert.equal(C.equip(state, s.id, 2).ok, false); // déjà mieux
  });

  test('équiper tous', () => {
    const { state } = partie();
    state.resources.bois = 7; // assez pour 2 gourdins seulement
    const r = C.equipAll(state, 1);
    assert.ok(r.ok);
    assert.equal(r.count, 2);
    assert.equal(state.resources.bois, 1);
    assert.match(r.reason, /Manque/);
  });

  test('drapeau de ralliement : pas dans l’eau', () => {
    const { state } = partie();
    assert.equal(C.setRally(state, { x: 3, z: 0 }).ok, false);
    assert.ok(C.setRally(state, { x: 9, z: 12 }).ok);
    assert.deepEqual(state.rally, { x: 9, z: 12 });
  });
});

// --- fin de cycle -----------------------------------------------------
describe('bilan de fin de cycle', () => {
  test('production, repas, croissance avec une hutte', () => {
    const { state } = partie();
    state.resources = { bois: 60, pierre: 10, nourriture: 30 };
    const b = C.build(state, 'bucheron', 5, 13).building;
    const c = C.build(state, 'chasseur', 5, 14).building;
    C.build(state, 'hutte', 10, 15);
    C.assign(state, b.id, 1); C.assign(state, b.id, 1);
    C.assign(state, c.id, 1); C.assign(state, c.id, 1);
    state.wave = 1;
    state.actionsLeft = 0;
    const rep = C.endOfCycle(state, null, { waveNumber: 1, kills: 3 });
    assert.equal(rep.production.bois.produced, 16);
    assert.equal(rep.production.nourriture.produced, 12);
    assert.equal(rep.food.eaten, 8);
    assert.equal(state.resources.bois, 10 + 16);
    assert.equal(state.resources.nourriture, 30 + 12 - 8);
    assert.equal(rep.population.born, 1);
    assert.equal(state.villagers, 6);
    assert.equal(state.actionsLeft, 5);
    assert.equal(state.phase, 'report');
    assert.equal(rep.xp.gained, 10 + 5 + 3);
    assert.ok(C.continueToPrep(state).ok);
    assert.equal(state.phase, 'prep');
  });

  test('pas de croissance sans logement ou sans 10 nourriture restante', () => {
    const { state } = partie();
    state.wave = 1;
    let rep = C.endOfCycle(state, null, {});
    assert.equal(rep.population.born, 0); // 8 habitants pour 8 places
    const s2 = partie().state;
    s2.resources.bois = 50;
    C.build(s2, 'hutte', 10, 15);
    s2.resources.nourriture = 17; // 17 - 8 = 9 < 10
    s2.wave = 1;
    rep = C.endOfCycle(s2, null, {});
    assert.equal(rep.population.born, 0);
  });

  test('stockage plein : le surplus est perdu et signalé', () => {
    const { state } = partie();
    state.resources.bois = 95;
    const b = C.build(state, 'bucheron', 5, 13).building;
    C.assign(state, b.id, 1); C.assign(state, b.id, 1);
    state.wave = 1;
    const rep = C.endOfCycle(state, null, {});
    assert.equal(state.resources.bois, 96);
    assert.equal(rep.production.bois.gained, 16);
    state.phase = 'prep';
    state.resources.bois = 95;
    const rep2 = C.endOfCycle(state, null, {});
    assert.equal(state.resources.bois, 100);
    assert.equal(rep2.production.bois.lost, 11);
    assert.ok(rep2.messages.some((m) => /plein/.test(m)));
  });

  test('famine : 1 départ par tranche de 5 nourriture manquante (min 1), soldat déserte s’il n’y a plus de villageois', () => {
    const { state } = partie();
    state.resources.nourriture = 0;
    state.wave = 1;
    const rep = C.endOfCycle(state, null, {});
    assert.equal(rep.food.missing, 8);
    assert.equal(rep.population.left, 1);
    assert.equal(state.villagers, 4);
    const s2 = partie().state;
    s2.villagers = 0;
    s2.resources.nourriture = 0;
    s2.wave = 1;
    const rep2 = C.endOfCycle(s2, null, {});
    assert.equal(rep2.population.deserted, 1);
    assert.equal(s2.soldiers.length, 2);
    const s3 = partie().state;
    s3.villagers = 20;
    s3.resources.nourriture = 0;
    s3.wave = 1;
    const rep3 = C.endOfCycle(s3, null, {});
    assert.equal(rep3.food.missing, 23);
    // 4 départs pour la famine, + 1 sans toit (20 villageois pour 8 places)
    assert.equal(rep3.population.left - rep3.population.homeless, 4);
    assert.equal(rep3.population.homeless, C.REGLES.departsSansToit);
  });

  test('les ouvriers partis libèrent leur poste', () => {
    const { state } = partie();
    state.resources.bois = 60;
    const b = C.build(state, 'bucheron', 5, 13).building;
    const c = C.build(state, 'chasseur', 5, 14).building;
    for (const x of [b, b, c, c]) C.assign(state, x.id, 1);
    state.villagers = 5;
    state.resources.nourriture = 0;
    state.wave = 1;
    C.endOfCycle(state, null, {});
    // 12 nourriture produite, 8 mangée : pas de famine.
    assert.equal(state.villagers, 5);
    state.phase = 'prep';
    state.villagers = 3; // départ forcé
    state.resources.nourriture = 0;
    C.assign(state, c.id, -1);
    C.endOfCycle(state, null, {});
    const ouvriers = state.buildings.reduce((n, x) => n + x.workers, 0);
    assert.ok(ouvriers <= state.villagers);
  });

  test('réparations gratuites des bâtiments abîmés', () => {
    const { state } = partie();
    state.buildings[0].hp = 50;
    state.wave = 1;
    const rep = C.endOfCycle(state, null, {});
    assert.equal(state.buildings[0].hp, 300);
    assert.equal(rep.repaired, 1);
  });
});

// --- ruines, défaite --------------------------------------------------
describe('ruines et défaite', () => {
  test('ruine : plus d’effet, ouvriers libérés, reconstruction au prix fort, déblayage', () => {
    const { state } = partie();
    state.resources.bois = 100;
    const b = C.build(state, 'bucheron', 5, 13).building;
    C.assign(state, b.id, 1);
    const h = C.build(state, 'hutte', 10, 15).building;
    // Simule une bataille qui détruit la hutte et le bûcheron.
    const r = C.startBattle(state);
    const battle = r.battle;
    for (const bb of battle.buildings) if (bb.id === b.id || bb.id === h.id) { bb.destroyed = true; bb.hp = 0; }
    battle.over = true;
    battle.result = 'won';
    const rep = C.finishBattle(state, battle, null);
    assert.equal(rep.buildingsLost, 2);
    assert.ok(b.destroyed && h.destroyed);
    assert.equal(b.workers, 0);
    assert.equal(C.housingCapacity(state), 8);
    C.continueToPrep(state);
    assert.equal(C.canPlace(state, 'hutte', 10, 15).code, 'occupe');
    state.resources.bois = 10;
    assert.equal(C.rebuild(state, h.id).reason, 'Manque 10 bois');
    state.resources.bois = 40;
    assert.ok(C.rebuild(state, h.id).ok);
    assert.equal(h.destroyed, false);
    assert.equal(h.hp, 60);
    assert.equal(state.resources.bois, 20);
    assert.ok(C.demolish(state, b.id).ok);
    assert.equal(state.resources.bois, 20); // rien rendu pour une ruine
    assert.ok(C.canPlace(state, 'bucheron', 5, 13).ok);
  });

  test('défaite quand tous les bâtiments sont détruits (les pièges ne comptent pas)', () => {
    const { state } = partie();
    state.resources.bois = 30;
    C.build(state, 'piege', 11, 12);
    assert.equal(C.isDefeated(state), false);
    state.buildings[0].destroyed = true;
    assert.equal(C.isDefeated(state), true);
  });

  test('une bataille sans défense finit en défaite, XP des tués conservée', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 4 });
    state.soldiers = [];
    state.wave = 5; // vague 6 : bien trop forte pour un village nu
    const r = C.startBattle(state);
    C.runBattle(r.battle);
    assert.equal(r.battle.result, 'defeat');
    const rep = C.finishBattle(state, r.battle, meta);
    assert.equal(state.phase, 'defeat');
    assert.equal(rep.result, 'defeat');
    assert.ok(state.buildings[0].destroyed);
    assert.equal(meta.xp, r.battle.kills);
  });
});

// --- sauvegarde -------------------------------------------------------
describe('sauvegarde', () => {
  function fauxStockage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
  }

  test('aller-retour JSON identique', () => {
    const { state } = partie();
    state.resources.bois = 60;
    const b = C.build(state, 'bucheron', 5, 13).building;
    C.assign(state, b.id, 1);
    C.doAction(state, 'couper_bois');
    const copie = C.deserialize(C.serialize(state));
    assert.deepEqual(copie, state);
  });

  test('aller-retour identique après une bataille (piège à 0 PV, murs abîmés)', () => {
    const { state, meta } = partie();
    state.resources.bois = 60;
    assert.ok(C.build(state, 'palissade', 11, 12).ok);
    assert.ok(C.build(state, 'piege', 11, 11).ok);
    gagnerVague(state, meta);
    assert.equal(state.phase, 'report');
    const piege = bat(state, 'piege');
    assert.equal(piege.hp, 0);
    const copie = C.deserialize(C.serialize(state));
    assert.deepEqual(copie, state);
  });

  test('une sauvegarde pendant la bataille reprend à la préparation', () => {
    const { state } = partie();
    const store = C.createStorage(fauxStockage());
    const r = C.startBattle(state);
    assert.equal(state.phase, 'battle');
    C.saveGame(store, state);
    const relu = C.loadGame(store);
    assert.equal(relu.phase, 'prep');
    assert.equal(relu.wave, 0);
    assert.ok(r.ok);
  });

  test('saveGame / loadGame / hasSavedGame / clearGame', () => {
    const store = C.createStorage(fauxStockage());
    assert.ok(store.available);
    assert.equal(C.loadGame(store), null);
    assert.equal(C.hasSavedGame(store), false);
    const { state } = partie();
    assert.ok(C.saveGame(store, state));
    assert.deepEqual(C.loadGame(store), state);
    assert.ok(C.hasSavedGame(store));
    state.phase = 'defeat';
    C.saveGame(store, state);
    assert.equal(C.hasSavedGame(store), false);
    C.clearGame(store);
    assert.equal(C.loadGame(store), null);
  });

  test('stockage indisponible : aucune exception, mémoire de secours, drapeau failed', () => {
    const casse = { getItem() { throw new Error('non'); }, setItem() { throw new Error('non'); }, removeItem() { throw new Error('non'); } };
    const store = C.createStorage(casse);
    assert.equal(store.available, false);
    assert.equal(store.failed, true);
    const { state } = partie();
    assert.equal(C.saveGame(store, state), false);
    assert.deepEqual(C.loadGame(store), state); // copie en mémoire pour la session
    const store2 = C.createStorage(() => { throw new Error('SecurityError'); });
    assert.equal(store2.available, false);
    assert.doesNotThrow(() => C.saveMeta(store2, C.newMeta()));
    const store3 = C.createStorage(null);
    assert.equal(store3.failed, false);
    assert.deepEqual(C.loadOptions(store3), C.OPTIONS_DEFAUT);
  });

  test('sauvegardes abîmées refusées ou réparées', () => {
    assert.equal(C.deserialize('pas du json'), null);
    assert.equal(C.deserialize('{"version":2}'), null);
    assert.equal(C.deserialize(null), null);
    const { state } = partie();
    const raw = JSON.parse(C.serialize(state));
    raw.buildings.push({ id: 99, type: 'licorne', x: 1, z: 1 });
    raw.resources.bois = 'beaucoup';
    raw.rally = { x: 900, z: 2 };
    const s = C.deserialize(raw);
    assert.ok(s);
    assert.equal(s.buildings.length, 1);
    assert.equal(s.resources.bois, 0);
    assert.deepEqual(s.rally, C.getMap(1).defaultRally);
  });

  test('progression du royaume et options', () => {
    const store = C.createStorage(fauxStockage());
    const meta = C.newMeta();
    C.addXp(meta, 150);
    C.saveMeta(store, meta);
    assert.deepEqual(C.loadMeta(store), meta);
    C.saveOptions(store, { qualite: 'economie' });
    assert.deepEqual(C.loadOptions(store), { qualite: 'economie', conseils: true, tutoVus: [] });
    // options abîmées (ancienne version, valeur bricolée) : le jeu démarre quand même
    C.saveOptions(store, { qualite: 'ultra', conseils: 'oui', tutoVus: 5 });
    assert.deepEqual(C.loadOptions(store), { qualite: 'normale', conseils: true, tutoVus: [] });
    C.saveOptions(store, { tutoVus: ['placer', 3, null] });
    assert.deepEqual(C.loadOptions(store).tutoVus, ['placer']);
    assert.equal(C.loadMeta(C.createStorage(fauxStockage())).level, 1);
  });
});

// --- royaume (meta) ---------------------------------------------------
describe('progression du royaume', () => {
  test('XP par vague et niveaux (100 × n)', () => {
    assert.equal(C.waveXp(3, 7), 10 + 15 + 7);
    const meta = C.newMeta();
    let r = C.addXp(meta, 99);
    assert.equal(meta.level, 1);
    r = C.addXp(meta, 1);
    assert.equal(meta.level, 2);
    assert.equal(r.levelsGained, 1);
    assert.equal(meta.talentPoints, 1);
    C.addXp(meta, 200); // 300 au total → niveau 3
    assert.equal(meta.level, 3);
    C.addXp(meta, 299); // 599 < 600
    assert.equal(meta.level, 3);
    const p = C.levelProgress(meta);
    assert.equal(p.xpInLevel, 299);
    assert.equal(p.xpNeeded, 300);
  });

  test('talents : points, prérequis, effet immédiat sur la partie', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 1 });
    assert.match(C.buyTalent(meta, 'bras_supplementaires', state).reason, /points/);
    meta.talentPoints = 3;
    assert.match(C.buyTalent(meta, 'greniers', state).reason, /Bûcherons aguerris/);
    assert.ok(C.buyTalent(meta, 'bras_supplementaires', state).ok);
    assert.equal(state.actionsMax, 6);
    assert.equal(state.actionsLeft, 6);
    assert.equal(C.buyTalent(meta, 'bras_supplementaires', state).ok, false);
    state.resources.bois = 30;
    const p = C.build(state, 'palissade', 11, 12).building;
    assert.ok(C.buyTalent(meta, 'pieux_durcis', state).ok);
    assert.equal(p.hp, 120);
    assert.equal(C.buildingMaxHp(state, p), 120);
    assert.equal(meta.talentPoints, 1);
    const arbre = C.talentTree(meta);
    assert.equal(arbre.length, 3);
    assert.equal(arbre.flatMap((b) => b.talents).length, 10);
  });

  test('talents de combat : dégâts des soldats, recrues vétérans, rations', () => {
    const meta = C.newMeta();
    meta.talents = ['discipline', 'veterans', 'rations'];
    const state = C.newGame(meta, { seed: 1 });
    riche(state);
    debloquerTout(state);
    assert.ok(Math.abs(C.soldierStats(state, state.soldiers[0]).dmg - 3 * 1.15) < 1e-9);
    C.build(state, 'caserne', 9, 16);
    const n = state.resources.nourriture;
    const r = C.recruit(state);
    assert.equal(r.soldier.training, 1);
    assert.equal(state.resources.nourriture, n - 5);
  });

  test('missions : récompense une seule fois par royaume', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 1 });
    state.resources.bois = 100;
    C.build(state, 'bucheron', 5, 13);
    C.build(state, 'tour_guet', 12, 10);
    assert.equal(state.stats.firstTowerWave, 1);
    state.wave = 1;
    const rep = C.endOfCycle(state, meta, { waveNumber: 1, kills: 0 });
    const m = rep.missions.find((x) => x.id === 'tour_avant_v3');
    assert.ok(m && m.rewarded);
    assert.equal(meta.reserves.bois, 10);
    assert.ok(meta.missionsDone.includes('tour_avant_v3'));
    // Nouvelle partie : la mission se refait mais ne rapporte plus.
    const s2 = C.newGame(meta, { seed: 2 });
    assert.equal(s2.resources.bois, 40); // 30 + 10 de réserve
    s2.resources.bois = 100;
    C.build(s2, 'bucheron', 5, 13);
    C.build(s2, 'tour_guet', 12, 10);
    s2.wave = 1;
    const rep2 = C.endOfCycle(s2, meta, { waveNumber: 1 });
    assert.equal(rep2.missions.find((x) => x.id === 'tour_avant_v3').rewarded, false);
    assert.equal(meta.reserves.bois, 10);
    const liste = C.missionList(meta, s2);
    assert.ok(liste.find((x) => x.id === 'tour_avant_v3').doneEver);
  });

  test('mission « 15 habitants » et « 5 lances »', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 1 });
    state.villagers = 12;
    state.soldiers.push(...[1, 2].map((i) => ({ id: 100 + i, kind: 'fantassin', equip: 2, training: 0, hpBonus: 0 })));
    state.soldiers.forEach((s) => { s.equip = 2; });
    const done = C.checkMissions(state, meta, null);
    assert.deepEqual(done.map((d) => d.id).sort(), ['habitants_15', 'lances_5']);
  });

  test('normalizeMeta répare une sauvegarde abîmée', () => {
    const m = C.normalizeMeta({ xp: 350, level: 1, talents: ['discipline', 'inconnu'], reserves: { bois: -5 } });
    assert.equal(m.level, 3);
    assert.deepEqual(m.talents, ['discipline']);
    assert.equal(m.reserves.bois, 0);
    assert.deepEqual(C.normalizeMeta('n’importe quoi'), C.newMeta());
  });
});

// --- bataille ---------------------------------------------------------
describe('bataille', () => {
  test('données exposées pour le rendu', () => {
    const { state } = partie();
    const battle = C.createBattle(state, 0);
    assert.equal(battle.units.length, 3);
    const u = battle.units[0];
    for (const k of ['id', 'side', 'type', 'kind', 'equip', 'x', 'z', 'hp', 'maxHp', 'state', 'facing', 'attackProgress', 'attackTime', 'hitTime']) {
      assert.ok(k in u, `champ ${k}`);
    }
    assert.equal(u.side, 'ally');
    assert.equal(u.kind, 'fantassin');
    assert.ok(Math.abs(u.x - state.rally.x) < 2);
    for (let i = 0; i < 120; i++) C.stepBattle(battle);
    const spawn = battle.events.find((e) => e.type === 'spawn');
    assert.ok(spawn);
    const ennemi = battle.units.find((x) => x.side === 'enemy');
    assert.ok(ennemi && ennemi.state === 'walk');
    assert.equal(C.enemiesRemaining(battle), C.VAGUES[0].groupes.reduce((n, g) => n + g.count, 0));
  });

  test('vague 1 gagnée avec l’armée de départ et une palissade sur la route', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 11 });
    assert.ok(C.build(state, 'palissade', 11, 12).ok);
    const r = C.startBattle(state);
    let palissadeTouchee = false;
    C.runBattle(r.battle, {
      onStep: (b) => { if (b.events.some((e) => e.type === 'building_hit')) palissadeTouchee = true; },
    });
    assert.equal(r.battle.result, 'won');
    assert.equal(r.battle.retreated, false);
    const rep = C.finishBattle(state, r.battle, meta);
    const total = C.VAGUES[0].groupes.reduce((n, g) => n + g.count, 0);
    assert.equal(rep.result, 'won');
    assert.equal(rep.kills, total);
    assert.equal(state.wave, 1);
    assert.equal(state.phase, 'report');
    assert.equal(state.stats.kills, total);
    assert.ok(meta.xp >= 18);
    assert.equal(typeof palissadeTouchee, 'boolean');
  });

  test('déterminisme : même graine, même bataille ; graine différente, autre bataille', () => {
    const faire = (seed) => {
      const s = C.newGame(null, { seed });
      s.resources.bois = 100;
      C.build(s, 'bucheron', 5, 13);
      C.build(s, 'tour_guet', 12, 10);
      C.build(s, 'palissade', 11, 12);
      s.wave = 3;
      const b = C.createBattle(s);
      const trace = [];
      C.runBattle(b, {
        onStep: (bb) => {
          for (const e of bb.events) trace.push(`${bb.time.toFixed(3)}:${e.type}:${e.unitId ?? e.targetId ?? e.buildingId ?? ''}:${(e.amount ?? 0).toFixed(3)}`);
        },
      });
      return { trace: trace.join('|'), units: b.units.map((u) => `${u.id}:${u.x.toFixed(6)}:${u.z.toFixed(6)}:${u.hp.toFixed(3)}`).join(','), time: b.time, result: b.result };
    };
    const a = faire(42);
    const b = faire(42);
    assert.equal(a.trace, b.trace);
    assert.equal(a.units, b.units);
    assert.equal(a.time, b.time);
    const c = faire(43);
    assert.notEqual(a.units, c.units);
  });

  test('une palissade sur la route arrête les ennemis, sur l’herbe non', () => {
    const s = C.newGame(null, { seed: 5 });
    s.soldiers = [];
    s.resources.bois = 100;
    const p = C.build(s, 'palissade', 11, 4).building; // tout début de route... index 4 = (10,3)
    assert.ok(p);
    const b = C.createBattle(s, 0);
    for (let i = 0; i < 30 * 12; i++) C.stepBattle(b);
    const ennemis = b.units.filter((u) => u.side === 'enemy');
    assert.ok(ennemis.length >= 1);
    const pal = b.buildings.find((x) => x.id === p.id);
    assert.equal(pal.blocks, false); // (11,4) est de l'herbe : décor
    // Sur la route, en (10, 3) :
    const s2 = C.newGame(null, { seed: 5 });
    s2.soldiers = [];
    s2.resources.bois = 100;
    const p2 = C.build(s2, 'palissade', 10, 3).building;
    const b2 = C.createBattle(s2, 0);
    const pal2 = b2.buildings.find((x) => x.id === p2.id);
    assert.equal(pal2.blocks, true);
    let touche = false;
    let tombee = false;
    for (let i = 0; i < 30 * 40 && !b2.over; i++) {
      C.stepBattle(b2);
      if (b2.events.some((e) => e.type === 'building_hit' && e.buildingId === p2.id)) touche = true;
      if (b2.events.some((e) => e.type === 'building_destroyed' && e.buildingId === p2.id)) tombee = true;
      b2.events.length = 0;
      if (!pal2.destroyed) {
        // Tant qu'elle tient, personne ne la franchit (la route part vers l'ouest).
        for (const u of b2.units) if (u.side === 'enemy' && u.state !== 'dead') assert.ok(u.x > 10.4, `ennemi passé à travers : x = ${u.x}`);
      }
    }
    assert.ok(touche);
    assert.ok(tombee); // sans soldat ni tour, les pillards finissent par la casser
    assert.ok(b2.units.some((u) => u.side === 'enemy' && u.state !== 'dead' && u.pathIndex > 5)); // puis ils passent
  });

  test('le bélier ignore les soldats et frappe les bâtiments', () => {
    const s = C.newGame(null, { seed: 8 });
    s.resources.bois = 100;
    C.build(s, 'palissade', 11, 12);
    const b = C.createBattle(s, 0);
    b.spawnQueue = ['belier'];
    b.totalEnemies = 1;
    let frappeSoldat = false;
    let frappeBatiment = false;
    for (let i = 0; i < 30 * 120 && !b.over; i++) {
      C.stepBattle(b);
      for (const e of b.events) {
        if (e.type === 'hit' && e.side === 'ally') frappeSoldat = true;
        if (e.type === 'building_hit') frappeBatiment = true;
      }
      b.events.length = 0;
    }
    assert.equal(frappeSoldat, false);
    assert.ok(frappeBatiment);
  });

  test('piège : chargé au départ, dégâts dans le rayon, recharge', () => {
    const s = C.newGame(null, { seed: 9 });
    s.soldiers = [];
    s.resources.bois = 100;
    const t = C.build(s, 'piege', 11, 2).building;
    const b = C.createBattle(s, 0);
    const bt = b.buildings.find((x) => x.id === t.id);
    assert.equal(bt.trap.ready, true);
    // Attendre qu'un ennemi soit sur le piège.
    let i = 0;
    while (i++ < 30 * 30 && !b.units.some((u) => u.side === 'enemy' && Math.hypot(u.x - 11, u.z - 2) < 0.5)) C.stepBattle(b);
    const r = C.triggerTrap(b, t.id);
    assert.ok(r.ok);
    assert.ok(r.hits >= 1);
    assert.ok(b.events.some((e) => e.type === 'trap'));
    assert.ok(b.trapKills >= 1); // 35 dégâts > 20 PV d'un pillard
    const r2 = C.triggerTrap(b, t.id);
    assert.equal(r2.ok, false);
    assert.match(r2.reason, /recharge/);
    for (let k = 0; k < 30 * 16; k++) C.stepBattle(b);
    assert.equal(bt.trap.ready, true);
    assert.equal(C.triggerTrap(b, s.buildings[0].id).ok, false);
  });

  test('déplacer l’armée : pas dans l’eau, drapeau gardé après la bataille', () => {
    const { state } = partie();
    state.resources.bois = 30;
    C.build(state, 'palissade', 11, 12);
    const r = C.startBattle(state);
    assert.equal(C.moveArmy(r.battle, { x: 3, z: 0 }).ok, false);
    assert.ok(C.moveArmy(r.battle, { x: 12, z: 12 }).ok);
    for (let i = 0; i < 90; i++) C.stepBattle(r.battle);
    const s = r.battle.units.find((u) => u.side === 'ally');
    assert.ok(Math.hypot(s.x - 12, s.z - 12) < 1.6);
    C.runBattle(r.battle);
    C.finishBattle(state, r.battle, null);
    assert.deepEqual(state.rally, { x: 12, z: 12 });
  });

  test('les tours tirent des flèches (événement arrow puis dégâts)', () => {
    const s = C.newGame(null, { seed: 2 });
    s.soldiers = [];
    s.resources.bois = 100;
    C.build(s, 'bucheron', 5, 13);
    const t = C.build(s, 'tour_guet', 12, 2).building;
    const b = C.createBattle(s, 0);
    let fleche = null;
    let coup = null;
    for (let i = 0; i < 30 * 30 && !coup; i++) {
      C.stepBattle(b);
      for (const e of b.events) {
        if (e.type === 'arrow' && e.sourceId === t.id && !fleche) fleche = { ...e, time: b.time };
        if (e.type === 'hit' && e.sourceId === t.id && !coup) coup = { ...e, time: b.time };
      }
      b.events.length = 0;
    }
    assert.ok(fleche && coup);
    assert.ok(coup.time - fleche.time >= C.COMBAT.dureeFlecheTour - 1e-9);
    assert.equal(coup.amount, C.BATIMENTS.tour_guet.tour.degats);
  });

  test('les soldats morts disparaissent pour de bon, finishBattle sans effet la 2e fois', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 3 });
    state.wave = 4; // vague 5 contre 3 soldats à mains nues
    state.resources.bois = 100;
    C.build(state, 'palissade', 11, 12);
    const r = C.startBattle(state);
    C.runBattle(r.battle);
    const morts = r.battle.deadSoldierIds.length;
    assert.ok(morts >= 1);
    const rep = C.finishBattle(state, r.battle, meta);
    assert.equal(state.soldiers.length, 3 - morts);
    const xp = meta.xp;
    const rep2 = C.finishBattle(state, r.battle, meta);
    assert.equal(rep2, rep);
    assert.equal(meta.xp, xp);
    assert.equal(state.soldiers.length, 3 - morts);
  });

  test('sécurité : à 600 s les ennemis se retirent, la vague compte comme gagnée', () => {
    const s = C.newGame(null, { seed: 1 });
    const b = C.createBattle(s, 0);
    for (let i = 0; i < 120; i++) C.stepBattle(b);
    b.time = C.COMBAT.dureeMax - 0.001;
    C.stepBattle(b);
    assert.ok(b.over);
    assert.equal(b.result, 'won');
    assert.equal(b.retreated, true);
    assert.ok(b.events.some((e) => e.type === 'wave_won' && e.retreated));
    const rep = C.finishBattle(s, b, null);
    assert.ok(rep.messages.some((m) => /retirés/.test(m)));
  });

  test('startBattle refusé hors préparation', () => {
    const { state } = partie();
    state.phase = 'report';
    assert.equal(C.startBattle(state).ok, false);
  });

  test('aperçu de vague', () => {
    const v1 = C.wavePreview(0);
    assert.deepEqual(v1.groupes, [{ type: 'pillard', nom: 'Pillard', count: 4 }]);
    const v10 = C.wavePreview(9);
    assert.ok(v10.groupes.some((g) => g.type === 'chef_de_guerre'));
    assert.equal(C.wavePreview(10), null);
  });
});

// --- partie complète ----------------------------------------------------
describe('partie complète', () => {
  test('victoire après la 10e vague : phase victory, bonus d’XP, chapitre gagné', () => {
    const meta = C.newMeta();
    const state = C.newGame(meta, { seed: 1 });
    state.wave = 9;
    // Défense écrasante pour garantir la victoire (on teste le passage à la victoire, pas l'équilibre).
    riche(state, 900);
    debloquerTout(state);
    for (const [x, z] of [[12, 10], [13, 10], [12, 9], [10, 10], [10, 12], [12, 12], [10, 13], [12, 13], [9, 7], [14, 9], [8, 9], [7, 5]]) {
      assert.ok(C.build(state, 'tour_pierre', x, z).ok);
    }
    C.build(state, 'mur_pierre', 15, 9);
    C.build(state, 'mur_pierre', 11, 12);
    const { report } = gagnerVague(state, meta);
    assert.equal(report.result, 'victory');
    assert.equal(state.phase, 'victory');
    assert.ok(meta.chaptersWon.includes(1));
    assert.ok(report.xp.victory === 150);
    assert.ok(state.missionsDone.includes('chapitre_1'));
    assert.equal(C.startBattle(state).ok, false);
  });
});

describe('bataille : cas limites', () => {
  test('après « Déplacer l’armée » loin, les soldats y vont même si un ennemi est déjà près du drapeau', () => {
    const s = C.newGame(null, { seed: 12 });
    const b = C.createBattle(s, 0);
    // Drapeau envoyé tout au nord, là où les ennemis apparaissent (à ~10 tuiles des soldats).
    assert.ok(C.moveArmy(b, { x: 11, z: 3 }).ok);
    for (let i = 0; i < 30 * 4; i++) C.stepBattle(b);
    assert.ok(b.units.some((u) => u.side === 'enemy'));
    for (const u of b.units) {
      if (u.side !== 'ally' || u.state === 'dead') continue;
      assert.ok(Math.hypot(u.x - 11, u.z - 3) < 5, `soldat bloqué en (${u.x.toFixed(1)}, ${u.z.toFixed(1)})`);
    }
  });

  test('aucune partie ne reste bloquée : chaque vague finit avant la limite de temps', () => {
    for (let v = 0; v < 10; v++) {
      const s = C.newGame(null, { seed: 100 + v });
      s.resources.bois = 60;
      C.build(s, 'palissade', 11, 12);
      C.build(s, 'palissade', 15, 9);
      const b = C.createBattle(s, v);
      C.runBattle(b);
      assert.ok(b.over);
      assert.equal(b.retreated, false, `vague ${v + 1} bloquée`);
    }
  });

  test('unités toujours dans la carte et valeurs finies', () => {
    const s = C.newGame(null, { seed: 77 });
    s.resources.bois = 60;
    C.build(s, 'palissade', 11, 12);
    const b = C.createBattle(s, 6);
    for (let i = 0; i < 30 * 120 && !b.over; i++) {
      C.stepBattle(b);
      if (i % 30 === 0) {
        for (const u of b.units) {
          assert.ok(Number.isFinite(u.x) && Number.isFinite(u.z) && Number.isFinite(u.facing) && Number.isFinite(u.hp));
          assert.ok(u.x >= -0.5 && u.x <= 21.5 && u.z >= -0.5 && u.z <= 21.5);
          assert.ok(['walk', 'attack', 'idle', 'dead'].includes(u.state));
          assert.ok(u.attackProgress >= 0 && u.attackProgress <= 1);
        }
      }
      b.events.length = 0;
    }
  });
});

// --- corrections de la relecture ---------------------------------------
describe('relecture : règles corrigées', () => {
  test('Maison commune en ruine : un petit stock minimum reste, on peut encore travailler et reconstruire', () => {
    const { state } = partie({ seed: 3 });
    state.resources = { bois: 40, pierre: 10, nourriture: 30 };
    const b = C.build(state, 'bucheron', 4, 14).building;
    C.assign(state, b.id, 1);
    C.assign(state, b.id, 1);
    const hall = bat(state, 'maison_commune');
    hall.destroyed = true;
    hall.hp = 0;
    assert.ok(C.hallInRuins(state));
    assert.equal(C.storageCap(state), C.REGLES.stockageMinimum);
    assert.ok(C.canDoAction(state, 'couper_bois').ok);
    const rep = C.endOfCycle(state, null, { waveNumber: 1 });
    assert.equal(rep.production.bois.lost, 0);
    assert.ok(C.REGLES.stockageMinimum >= C.BATIMENTS.maison_commune.cout.bois, 'assez pour reconstruire la Maison');
    // stock plein sans Maison : le message montre la vraie cause
    state.phase = 'prep';
    state.resources.bois = state.resources.pierre = state.resources.nourriture = C.REGLES.stockageMinimum;
    assert.match(C.canDoAction(state, 'couper_bois').reason, /Maison commune est en ruine/);
  });

  test('démolir un logement qui laisserait des habitants dehors est refusé ; sans toit, un villageois part au bilan', () => {
    const { state } = partie({ seed: 5 });
    state.resources.bois = 100;
    const h = C.build(state, 'hutte', 12, 18).building;
    state.villagers = 9; // 9 + 3 soldats = 12 = 8 + 4
    const r = C.demolish(state, h.id);
    assert.equal(r.ok, false);
    assert.match(r.reason, /4 habitants n’auraient plus de toit/);
    assert.equal(C.buildingInfo(state, h.id).demolir.ok, false);
    // hutte perdue en bataille : un villageois s'en va à chaque bilan tant qu'il manque des places
    h.destroyed = true;
    state.wave = 1;
    state.resources.nourriture = 100;
    const rep = C.endOfCycle(state, null, { waveNumber: 1 });
    assert.equal(rep.population.homeless, C.REGLES.departsSansToit);
    assert.equal(state.villagers, 9 - C.REGLES.departsSansToit);
    assert.ok(rep.messages.some((m) => /Sans toit/.test(m)));
  });

  test('sauvegarde abîmée : bilan, bâtiments, statistiques, vague et drapeau sont vérifiés', () => {
    const s = C.newGame(null, { seed: 6 });
    s.phase = 'report';
    s.lastReport = { wave: 1 };
    s.buildings.push({ id: 50, type: 'hutte', x: -1, z: 5, hp: 60, workers: 0, destroyed: false, builtWave: 0 });
    s.buildings.push({ id: 51, type: 'hutte', x: 11, z: 16, hp: 60, workers: 0, destroyed: false, builtWave: 0 });
    s.buildings.push({ id: 52, type: 'hutte', x: 12, z: 18, hp: 60, workers: 0, destroyed: false, builtWave: 0 });
    s.buildings.push({ id: 53, type: 'hutte', x: 12, z: 18, hp: 60, workers: 0, destroyed: false, builtWave: 0 });
    s.stats.kills = 'abc';
    s.stats.firstTowerWave = 'x';
    s.rally = { x: 2, z: 5 }; // le ruisseau
    const d = C.deserialize(JSON.stringify(s));
    assert.equal(d.lastReport, null);
    assert.deepEqual(d.buildings.map((b) => b.id), [1, 52]);
    assert.equal(d.stats.kills, 0);
    assert.equal(d.stats.firstTowerWave, null);
    assert.deepEqual(d.rally, C.getMap(1).defaultRally);
    // un vrai bilan est gardé
    const t = C.newGame(null, { seed: 6 });
    t.resources.bois = 100;
    C.build(t, 'palissade', 11, 12);
    gagnerVague(t);
    const d2 = C.deserialize(JSON.stringify(t));
    assert.equal(d2.phase, 'report');
    assert.ok(d2.lastReport && d2.lastReport.production.bois);
    // vague au-delà de la dernière : bornée, et la partie est gagnée
    const u = C.newGame(null, { seed: 6 });
    u.wave = 99;
    const d3 = C.deserialize(JSON.stringify(u));
    assert.equal(d3.wave, d3.wavesTotal);
    assert.equal(d3.phase, 'victory');
  });

  test('nos soldats tiennent la palissade depuis l’arrière, sans la franchir', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = C.newGame(null, { seed });
      s.resources.bois = 100;
      C.build(s, 'palissade', 11, 12); // drapeau par défaut en (11, 13), juste derrière
      s.wave = 1; // 5 pillards
      const b = C.createBattle(s);
      let auDela = 0;
      let coups = 0;
      C.runBattle(b, {
        onStep: (bt) => {
          const pal = bt.buildings.find((x) => x.type === 'palissade');
          if (pal.destroyed) return;
          for (const u of bt.units) if (u.side === 'ally' && u.state !== 'dead' && u.z < 11.5) auDela++;
          for (const e of bt.events) if (e.type === 'hit' && e.side === 'enemy' && e.cause === 'melee') coups++;
        },
      });
      assert.equal(auDela, 0, `graine ${seed} : un soldat est passé devant la palissade`);
      assert.ok(coups > 0, `graine ${seed} : les soldats frappent par-dessus la palissade`);
    }
  });

  test('drapeau dans l’herbe à côté du mur : les soldats le tiennent sans le contourner', () => {
    // mur au coude (6, 8) : la route arrive du nord et repart vers l'est ; drapeau au sud, dans l'herbe
    for (const drapeau of [{ x: 6, z: 9 }, { x: 5, z: 9 }, { x: 6, z: 8 }]) {
      const s = C.newGame(null, { seed: 3 });
      riche(s);
      debloquerTout(s);
      assert.ok(C.build(s, 'mur_pierre', 6, 8).ok);
      assert.ok(C.setRally(s, drapeau).ok);
      s.wave = 2; // pillards et soudards
      const b = C.createBattle(s);
      let devant = 0;
      let coups = 0;
      C.runBattle(b, {
        onStep: (bt) => {
          const mur = bt.buildings.find((x) => x.type === 'mur_pierre');
          if (mur.destroyed) return;
          for (const u of bt.units) if (u.side === 'ally' && u.state !== 'dead' && u.z < 7.6) devant++;
          for (const e of bt.events) if (e.type === 'hit' && e.side === 'enemy' && e.cause === 'melee') coups++;
        },
      });
      assert.equal(devant, 0, `drapeau ${JSON.stringify(drapeau)} : un soldat est passé devant le mur`);
      assert.ok(coups > 0, `drapeau ${JSON.stringify(drapeau)} : les soldats frappent par-dessus le mur`);
    }
  });

  test('derrière un mur, les archers ennemis ne visent pas nos soldats', () => {
    const s = C.newGame(null, { seed: 4 });
    riche(s);
    debloquerTout(s);
    C.build(s, 'mur_pierre', 11, 12);
    s.wave = 3; // vague 4 : des archers ennemis
    const b = C.createBattle(s);
    let flechesSurSoldats = 0;
    C.runBattle(b, {
      onStep: (bt) => {
        const mur = bt.buildings.find((x) => x.type === 'mur_pierre');
        if (mur.destroyed) return;
        for (const e of bt.events) {
          if (e.type === 'arrow' && e.side === 'enemy' && e.targetKind === 'unit') flechesSurSoldats++;
        }
      },
    });
    assert.equal(flechesSurSoldats, 0);
  });

  test('le bélier encaisse moins les flèches des tours (il faut l’armée au mur)', () => {
    assert.ok(C.ENNEMIS.belier.resistanceTours > 0);
    const s = C.newGame(null, { seed: 2 });
    s.soldiers = [];
    riche(s);
    debloquerTout(s);
    const t = C.build(s, 'tour_guet', 12, 2).building;
    const b = C.createBattle(s, 4);
    b.spawnQueue = ['belier'];
    b.totalEnemies = 1;
    let coup = null;
    for (let i = 0; i < 30 * 60 && !coup; i++) {
      C.stepBattle(b);
      coup = b.events.find((e) => e.type === 'hit' && e.sourceId === t.id) || null;
      b.events.length = 0;
    }
    assert.ok(coup);
    assert.equal(coup.amount, C.BATIMENTS.tour_guet.tour.degats * (1 - C.ENNEMIS.belier.resistanceTours));
  });
});
