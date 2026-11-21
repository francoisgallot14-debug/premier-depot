// Simulation de bataille en temps réel, à pas fixe et déterministe :
// même partie + même vague = exactement la même bataille.
// La bataille travaille sur des COPIES (bâtiments, soldats) : la partie n'est
// modifiée qu'à la fin, par finishBattle(). Si la page se recharge pendant
// une bataille, la partie reprend donc à la préparation de cette vague.
//
// Coordonnées : tuiles, en nombres décimaux (x, z). Vitesses : tuiles/seconde.
// Le moteur 3D lit battle.units / battle.buildings / battle.projectiles et
// vide battle.events après les avoir lus.

import { COMBAT, ENNEMIS, VAGUES, BATIMENTS, META, MAP_W, MAP_H } from './data.js';
import { getMap, tileAt, pathIndexOf } from './map.js';
import { createRng, mixSeeds } from './rng.js';
import { talentEffects, addXp } from './meta.js';
import {
  soldierStats, buildingMaxHp, endOfCycle, isDefeated, addLog, rallyCheck,
} from './economy.js';

const NORD = Math.PI; // orientation « face au nord » (vers z négatif)

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function cleTuile(x, z) {
  return x * 1000 + z;
}

// Indice de la tuile de route la plus proche du drapeau (à égalité, la plus proche du village).
// Sert à savoir de quel côté d'un mur se trouve l'armée.
function indiceRouteProche(path, pos) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i].x - pos.x, path[i].z - pos.z);
    if (d <= bd + 1e-9) { bd = d; best = i; }
  }
  return best;
}

// Position du drapeau le long de la route, en demi-tuiles : i + 0,5 = côté village de la tuile i,
// i − 0,5 = côté ennemi. Un drapeau posé à côté d'un mur (dans l'herbe, ou sur le mur même) est
// ainsi « derrière » lui : nos soldats le tiennent au lieu de le contourner. À égalité, on se met
// derrière (c'est ce que veut un joueur qui plante son drapeau contre son mur).
function coteDrapeau(path, pos) {
  const i = indiceRouteProche(path, pos);
  const d = (j) => (j < 0 || j >= path.length ? Infinity : Math.hypot(path[j].x - pos.x, path[j].z - pos.z));
  return d(i - 1) < d(i + 1) - 1e-9 ? i - 0.5 : i + 0.5;
}

// Décalage de formation autour du drapeau : rangs de 4, fantassins devant (nord), archers derrière.
function decalagesFormation(nbFantassins, nbArchers) {
  const e = COMBAT.espacementFormation;
  const parRang = COMBAT.soldatsParRang;
  const out = [];
  const rangs = (n, rangDepart) => {
    for (let i = 0; i < n; i++) {
      const rang = Math.floor(i / parRang);
      const dansRang = Math.min(parRang, n - rang * parRang);
      const col = i % parRang;
      out.push({ x: (col - (dansRang - 1) / 2) * e, z: (rangDepart + rang - 0.5) * e });
    }
  };
  rangs(nbFantassins, 0);
  rangs(nbArchers, Math.ceil(nbFantassins / parRang));
  return out;
}

function nouvelleUnite(battle, champs) {
  const u = {
    id: battle.nextUnitId++,
    side: 'ally',          // 'ally' (nos soldats) | 'enemy'
    type: 'fantassin',     // fantassin | archer | pillard | soudard | archer_ennemi | belier | chef_de_guerre
    kind: 'fantassin',     // pour nos soldats : 'fantassin' | 'archer' ; pour les ennemis : = type
    equip: 0,              // 0 mains nues, 1 gourdin, 2 lance, 3 lance + bouclier (nos fantassins)
    training: 0,
    soldierId: null,       // identifiant du soldat dans state.soldiers
    x: 0,
    z: 0,
    hp: 1,
    maxHp: 1,
    dmg: 0,                // dégâts par coup contre les unités
    dmgB: 0,               // dégâts par coup contre les bâtiments
    cadence: 1,
    range: 0.9,            // allonge contre les unités (tuiles)
    rangeB: 0.9,           // allonge contre les bâtiments (archers ennemis : plus courte)
    speed: 1,
    ranged: false,
    size: 1,               // échelle d'affichage conseillée
    state: 'idle',         // 'walk' | 'attack' | 'idle' | 'dead'
    facing: NORD,          // angle (radians) = atan2(dx, dz) : utilisable tel quel en rotation.y d'un modèle qui regarde vers +z
    cd: 0,                 // temps avant le prochain coup
    attackTime: 99,        // secondes depuis le début du dernier coup
    attackProgress: 1,     // 0 → 1 pendant le coup (fente : sin(progress × π)), 1 au repos
    hitTime: 99,           // secondes depuis le dernier coup reçu (flash)
    targetId: null,
    targetKind: null,      // 'unit' | 'building' | null
    deadTime: 0,           // secondes depuis la mort (chute + fondu)
    retreated: false,      // vrai si l'ennemi s'est retiré (limite de temps), pas tué
    // propres aux ennemis
    mode: null,            // 'path' (suit la route) | 'assault' (au bout de la route : attaque les bâtiments)
    pathIndex: 0,
    ox: 0,
    oz: 0,
    cible: 'tout',
    resTours: 0,           // part des dégâts de tour ignorée (bélier, chef de guerre)
    // propres aux soldats
    offX: 0,
    offZ: 0,
  };
  Object.assign(u, champs);
  battle.units.push(u);
  battle.unitIndex.set(u.id, u);
  return u;
}

/**
 * Prépare la bataille d'une vague à partir de la partie (sans la modifier).
 * @param {object} state partie (phase 'prep' ou 'battle')
 * @param {number} [waveIndex] indice de la vague, 0 = vague 1 (par défaut : state.wave, la prochaine)
 * @returns {object} bataille : { waveIndex, waveNumber, time, over, result: null|'won'|'defeat', retreated,
 *   units[], buildings[], projectiles[], events[], rally:{x,z}, kills, trapKills, totalEnemies, ... }
 */
export function createBattle(state, waveIndex = state.wave) {
  const map = getMap(state.chapter);
  const idx = Math.max(0, Math.min(VAGUES.length - 1, waveIndex));
  const vague = VAGUES[idx];
  const fx = talentEffects(state.talents);
  const battle = {
    waveIndex: idx,
    waveNumber: idx + 1,
    chapter: state.chapter,
    time: 0,
    over: false,
    result: null,
    retreated: false,
    finished: false,
    report: null,
    rally: { ...state.rally },
    rallyIdx: coteDrapeau(map.path, state.rally), // côté de la route où se tient l'armée (demi-tuiles)
    units: [],
    buildings: [],
    projectiles: [],
    events: [],
    spawnQueue: [],
    spawnTimer: COMBAT.delaiPremierEnnemi,
    spawnInterval: vague.intervalle,
    force: vague.force ?? 1,
    totalEnemies: 0,
    spawned: 0,
    kills: 0,
    trapKills: 0,
    deadSoldierIds: [],
    buildingsLost: 0,
    nextUnitId: 1,
    nextProjectileId: 1,
    path: map.path,
    rng: createRng(mixSeeds(state.seed, state.rngState, idx + 1)),
    unitIndex: new Map(),     // id → unité
    buildingIndex: new Map(), // id → bâtiment de bataille
    blockers: new Map(),      // tuile → palissade/mur posé sur la route
  };
  for (const g of vague.groupes) for (let i = 0; i < g.count; i++) battle.spawnQueue.push(g.type);
  battle.totalEnemies = battle.spawnQueue.length;

  // Bâtiments : copies avec l'état de combat (tours, pièges).
  for (const b of state.buildings) {
    const def = BATIMENTS[b.type];
    const maxHp = buildingMaxHp(state, b);
    const sb = {
      id: b.id,
      type: b.type,
      x: b.x,
      z: b.z,
      hp: b.destroyed ? 0 : Math.min(maxHp, b.hp > 0 ? b.hp : maxHp),
      maxHp,
      destroyed: !!b.destroyed,
      targetable: def.ciblable !== false,
      blocks: !!def.bloqueRoute && tileAt(map, b.x, b.z) === 'road',
      pathIndex: pathIndexOf(map, b.x, b.z), // -1 hors de la route
      hitTime: 99,
      tower: def.tour ? {
        range: def.tour.portee,
        damage: def.tour.degats * (1 + fx.degatsTours),
        cadence: def.tour.cadence,
        cd: 0,
        targetId: null,
        facing: NORD,   // orientation de l'archer de la tour
        shotTime: 99,   // secondes depuis le dernier tir
      } : null,
      trap: def.piege ? {
        damage: def.piege.degats * (1 + fx.degatsPieges),
        radius: def.piege.rayon,
        recharge: def.piege.recharge * (1 + fx.rechargePieges),
        rechargeLeft: 0,   // les pièges commencent chargés
        ready: true,
        progress: 1,       // 0 → 1 pendant la recharge (anneau de l'interface)
      } : null,
    };
    battle.buildings.push(sb);
    battle.buildingIndex.set(sb.id, sb);
    if (sb.blocks) battle.blockers.set(cleTuile(b.x, b.z), sb);
  }

  // Soldats autour du drapeau de ralliement.
  const fantassins = state.soldiers.filter((s) => s.kind !== 'archer');
  const archers = state.soldiers.filter((s) => s.kind === 'archer');
  const offs = decalagesFormation(fantassins.length, archers.length);
  [...fantassins, ...archers].forEach((s, i) => {
    const st = soldierStats(state, s);
    nouvelleUnite(battle, {
      side: 'ally',
      type: s.kind,
      kind: s.kind,
      equip: s.kind === 'archer' ? 0 : s.equip,
      training: s.training,
      soldierId: s.id,
      x: battle.rally.x + offs[i].x,
      z: battle.rally.z + offs[i].z,
      offX: offs[i].x,
      offZ: offs[i].z,
      hp: st.maxHp,
      maxHp: st.maxHp,
      dmg: st.dmg,
      cadence: st.cadence,
      range: st.range,
      speed: st.speed,
      ranged: s.kind === 'archer',
      state: 'idle',
      facing: NORD,
    });
  });
  return battle;
}

// ---------------------------------------------------------------------
//  Événements et dégâts
// ---------------------------------------------------------------------

function emettre(battle, ev) {
  battle.events.push(ev);
  if (battle.events.length > COMBAT.limiteEvenements) battle.events.splice(0, battle.events.length >> 1);
}

function tuer(battle, u, cause) {
  u.state = 'dead';
  u.hp = 0;
  u.deadTime = 0;
  u.targetId = null;
  u.targetKind = null;
  emettre(battle, { type: 'death', unitId: u.id, side: u.side, unitType: u.type, x: u.x, z: u.z, cause });
  if (u.side === 'enemy') {
    battle.kills++;
    if (cause === 'trap') battle.trapKills++;
  } else if (u.soldierId != null) {
    battle.deadSoldierIds.push(u.soldierId);
  }
}

function blesserUnite(battle, u, amount, sourceId, cause) {
  if (u.state === 'dead') return;
  u.hp -= amount;
  u.hitTime = 0;
  emettre(battle, { type: 'hit', targetId: u.id, side: u.side, amount, x: u.x, z: u.z, sourceId, cause });
  if (u.hp <= 0) tuer(battle, u, cause);
}

function blesserBatiment(battle, b, amount, sourceId) {
  if (b.destroyed || !b.targetable) return;
  b.hp -= amount;
  b.hitTime = 0;
  emettre(battle, {
    type: 'building_hit', buildingId: b.id, buildingType: b.type, amount,
    hp: Math.max(0, b.hp), maxHp: b.maxHp, x: b.x, z: b.z, sourceId,
  });
  if (b.hp <= 0) {
    b.hp = 0;
    b.destroyed = true;
    battle.buildingsLost++;
    emettre(battle, { type: 'building_destroyed', buildingId: b.id, buildingType: b.type, x: b.x, z: b.z });
  }
}

function tirer(battle, source, cible, cibleKind, damage, fromX, fromZ, duration, sourceKind) {
  const p = {
    id: battle.nextProjectileId++,
    sourceId: source.id,
    sourceKind,                 // 'tower' | 'unit'
    side: source.side || 'ally',
    targetId: cible.id,
    targetKind: cibleKind,      // 'unit' | 'building'
    damage,
    fromX,
    fromZ,
    toX: cible.x,
    toZ: cible.z,
    t: 0,
    duration,
  };
  battle.projectiles.push(p);
  emettre(battle, {
    type: 'arrow', projectileId: p.id, sourceId: source.id, sourceKind, side: p.side,
    from: { x: fromX, z: fromZ }, to: { x: cible.x, z: cible.z },
    targetId: cible.id, targetKind: cibleKind, duration,
  });
}

// ---------------------------------------------------------------------
//  Déplacements
// ---------------------------------------------------------------------

// Tuile bloquée par une palissade / un mur posé sur la route (et encore debout).
function bloqueurEn(battle, x, z) {
  const b = battle.blockers.get(cleTuile(x, z));
  return b && !b.destroyed ? b : null;
}

// Les ennemis ne traversent pas une palissade : refuse un pas qui entrerait dans sa tuile.
// (Nos soldats, eux, n'y sont jamais poussés par la bousculade : voir pousser.)
function pasInterdit(battle, u, nx, nz) {
  if (u.side !== 'enemy' || u.mode !== 'path') return false;
  const tx = Math.round(nx);
  const tz = Math.round(nz);
  if (tx === Math.round(u.x) && tz === Math.round(u.z)) return false;
  return !!bloqueurEn(battle, tx, tz);
}

// Avance vers (tx, tz) jusqu'à être à `arret` de distance. Renvoie vrai une fois arrivé.
function approcher(battle, u, tx, tz, arret, dt) {
  const dx = tx - u.x;
  const dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  if (d <= arret + 1e-6) return true;
  u.facing = Math.atan2(dx, dz);
  const pas = Math.min(u.speed * dt, d - arret);
  const nx = u.x + (dx / d) * pas;
  const nz = u.z + (dz / d) * pas;
  if (pasInterdit(battle, u, nx, nz)) {
    u.state = 'idle';
    return false;
  }
  u.x = nx;
  u.z = nz;
  u.state = 'walk';
  return d - pas <= arret + 1e-6;
}

function regarder(u, cible) {
  const dx = cible.x - u.x;
  const dz = cible.z - u.z;
  if (dx * dx + dz * dz > 1e-8) u.facing = Math.atan2(dx, dz);
}

// ---------------------------------------------------------------------
//  Attaques
// ---------------------------------------------------------------------

function attaquerUnite(battle, a, cible) {
  regarder(a, cible);
  a.state = 'attack';
  a.targetId = cible.id;
  a.targetKind = 'unit';
  if (a.cd > 0) return;
  a.cd = a.cadence;
  a.attackTime = 0;
  if (a.ranged) {
    tirer(battle, a, cible, 'unit', a.dmg, a.x, a.z, COMBAT.dureeFlecheArcher, 'unit');
  } else {
    blesserUnite(battle, cible, a.dmg, a.id, 'melee');
  }
}

function attaquerBatiment(battle, a, b) {
  regarder(a, b);
  a.state = 'attack';
  a.targetId = b.id;
  a.targetKind = 'building';
  if (a.cd > 0) return;
  a.cd = a.cadence;
  a.attackTime = 0;
  if (a.ranged) {
    tirer(battle, a, b, 'building', a.dmgB, a.x, a.z, COMBAT.dureeFlecheArcher, 'unit');
  } else {
    blesserBatiment(battle, b, a.dmgB, a.id);
  }
}

// ---------------------------------------------------------------------
//  Intelligence des unités
// ---------------------------------------------------------------------

// Laisse d'un soldat face à cet ennemi : plus longue s'il frappe nos soldats (riposte).
function laissePour(e) {
  return e.targetKind === 'unit' && e.state === 'attack' ? COMBAT.laisse + COMBAT.riposte : COMBAT.laisse;
}

// Mur / palissade encore debout qui sépare cet ennemi (sur la route, avant le mur) de notre
// armée (drapeau après le mur) : le plus proche de l'ennemi. null s'il n'y en a pas.
// Nos soldats ne franchissent pas leurs propres défenses : ils les tiennent depuis l'arrière.
function murDevant(battle, e) {
  if (!battle.blockers.size || e.mode !== 'path') return null;
  let best = null;
  for (const b of battle.blockers.values()) {
    if (b.destroyed || b.pathIndex < e.pathIndex || b.pathIndex >= battle.rallyIdx) continue;
    if (!best || b.pathIndex < best.pathIndex) best = b;
  }
  return best;
}

// L'ennemi est-il au pied de ce mur (en train de le frapper ou tout contre) ?
function auPiedDuMur(e, mur) {
  return dist(e, mur) <= COMBAT.porteeBatiment + COMBAT.piedDuMur;
}

// Poste d'un soldat derrière un mur : juste après lui sur la route (côté village),
// un peu décalé sur le côté selon sa place dans la formation.
function posteMur(battle, mur, u) {
  const suivant = battle.path[Math.min(battle.path.length - 1, mur.pathIndex + 1)];
  let dx = suivant.x - mur.x;
  let dz = suivant.z - mur.z;
  const n = Math.hypot(dx, dz) || 1;
  dx /= n;
  dz /= n;
  const cote = u.offX * COMBAT.ecartPosteMur;
  return { x: mur.x + dx * COMBAT.posteMur - dz * cote, z: mur.z + dz * COMBAT.posteMur + dx * cote };
}

// Un soldat peut-il viser cet ennemi ? (dans la laisse du drapeau, ou à portée d'arc)
// De l'autre côté d'un de nos murs : un archer tire s'il est à portée ; un fantassin ne le
// combat que s'il est au pied du mur et que son poste derrière le mur est dans la laisse.
function cibleValide(battle, u, e) {
  if (!e || e.side !== 'enemy' || e.state === 'dead') return false;
  const mur = murDevant(battle, e);
  if (mur) {
    if (u.ranged) return dist(u, e) <= u.range;
    if (dist(u, e) <= COMBAT.allongeMur) return true;
    if (!auPiedDuMur(e, mur)) return false;
    const p = posteMur(battle, mur, u);
    return Math.hypot(p.x - battle.rally.x, p.z - battle.rally.z) <= COMBAT.laisse;
  }
  const r = battle.rally;
  if (Math.hypot(e.x - r.x, e.z - r.z) <= laissePour(e)) return true;
  return u.ranged && dist(u, e) <= u.range;
}

function ennemiLePlusProche(battle, u) {
  let best = null;
  let bestD = Infinity;
  for (const e of battle.units) {
    if (!cibleValide(battle, u, e)) continue;
    const d = dist(u, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function soldatLePlusProche(battle, u, portee) {
  let best = null;
  let bestD = portee;
  for (const o of battle.units) {
    if (o.side !== 'ally' || o.state === 'dead') continue;
    const d = dist(u, o);
    if (d <= bestD) { bestD = d; best = o; }
  }
  return best;
}

function batimentLePlusProche(battle, u, portee, toursSeulement) {
  let best = null;
  let bestD = portee;
  for (const b of battle.buildings) {
    if (b.destroyed || !b.targetable) continue;
    if (toursSeulement && !b.tower) continue;
    const d = dist(u, b);
    if (d <= bestD) { bestD = d; best = b; }
  }
  return best;
}

// Allonge d'un soldat contre cet ennemi (par-dessus un mur, on frappe plus loin).
function allongeContre(battle, u, e) {
  return !u.ranged && murDevant(battle, e) ? COMBAT.allongeMur : u.range;
}

function etapeSoldat(battle, u, dt) {
  const rally = battle.rally;
  let cible = u.targetKind === 'unit' ? battle.unitIndex.get(u.targetId) : null;
  const valide = cibleValide(battle, u, cible);
  if (!valide || dist(u, cible) > allongeContre(battle, u, cible)) {
    const meilleur = ennemiLePlusProche(battle, u);
    if (meilleur) cible = meilleur;
    else if (!valide) cible = null;
  }

  if (cible) {
    if (dist(u, cible) <= allongeContre(battle, u, cible)) {
      attaquerUnite(battle, u, cible);
      return;
    }
    // Ennemi au pied d'un de nos murs : on va tenir le mur depuis l'arrière, sans le franchir.
    const mur = u.ranged ? null : murDevant(battle, cible);
    if (mur) {
      u.targetId = cible.id;
      u.targetKind = 'unit';
      const p = posteMur(battle, mur, u);
      if (approcher(battle, u, p.x, p.z, 0.05, dt)) { u.state = 'idle'; regarder(u, cible); }
      return;
    }
    // Poursuite, sans quitter la laisse autour du drapeau.
    u.targetId = cible.id;
    u.targetKind = 'unit';
    const avantX = u.x;
    const avantZ = u.z;
    const avant = Math.hypot(u.x - rally.x, u.z - rally.z);
    approcher(battle, u, cible.x, cible.z, u.range * 0.9, dt);
    const apres = Math.hypot(u.x - rally.x, u.z - rally.z);
    // On refuse seulement un pas qui éloigne du drapeau au-delà de la laisse
    // (un soldat encore loin, après « Déplacer l'armée », peut toujours se rapprocher).
    if (apres > laissePour(cible) + 0.5 && apres > avant) {
      u.x = avantX;
      u.z = avantZ;
      u.state = 'idle';
      regarder(u, cible);
    }
    return;
  }

  // Pas d'ennemi à portée : retour à sa place dans la formation.
  u.targetId = null;
  u.targetKind = null;
  const arrive = approcher(battle, u, rally.x + u.offX, rally.z + u.offZ, 0.02, dt);
  if (arrive) {
    u.state = 'idle';
    // Au repos, on regarde l'ennemi le plus proche s'il approche, sinon le nord.
    let proche = null;
    let dp = COMBAT.laisse + 4;
    for (const e of battle.units) {
      if (e.side !== 'enemy' || e.state === 'dead') continue;
      const d = dist(u, e);
      if (d < dp) { dp = d; proche = e; }
    }
    if (proche) regarder(u, proche);
    else u.facing = NORD;
  }
}

function etapeEnnemi(battle, u, dt) {
  // 1. Les soldats d'abord (sauf le bélier, qui ne s'occupe que des bâtiments).
  //    Derrière un mur encore debout, nos soldats sont à couvert : pas de flèche par-dessus,
  //    et on ne les attaque au corps à corps que s'ils sont déjà au contact.
  if (u.cible !== 'batiments') {
    const mur = murDevant(battle, u);
    if (u.ranged) {
      const s = mur ? null : soldatLePlusProche(battle, u, u.range);
      if (s) { attaquerUnite(battle, u, s); return; }
      if (u.cible === 'soldats_puis_tours') {
        const t = batimentLePlusProche(battle, u, u.rangeB, true);
        if (t) { attaquerBatiment(battle, u, t); return; }
      }
    } else if (mur) {
      // De l'autre côté du mur : on rend les coups par-dessus, sans quitter le pied du mur.
      const allonge = auPiedDuMur(u, mur) ? COMBAT.allongeMur : u.range;
      let s = u.targetKind === 'unit' ? battle.unitIndex.get(u.targetId) : null;
      if (s && (s.state === 'dead' || dist(u, s) > allonge)) s = null;
      if (!s) s = soldatLePlusProche(battle, u, allonge);
      if (s) { attaquerUnite(battle, u, s); return; }
    } else {
      let s = u.targetKind === 'unit' ? battle.unitIndex.get(u.targetId) : null;
      if (s && (s.state === 'dead' || dist(u, s) > COMBAT.decrochage)) s = null;
      if (!s) s = soldatLePlusProche(battle, u, COMBAT.porteeEngagement);
      if (s) {
        u.targetId = s.id;
        u.targetKind = 'unit';
        if (dist(u, s) <= u.range) attaquerUnite(battle, u, s);
        else approcher(battle, u, s.x, s.z, u.range * 0.9, dt);
        return;
      }
    }
  }
  if (u.targetKind === 'unit') { u.targetId = null; u.targetKind = null; }

  // 2. Suivre la route ; une palissade sur la prochaine tuile arrête l'ennemi qui doit la casser.
  if (u.mode === 'path') {
    const noeud = battle.path[u.pathIndex];
    const bloqueur = bloqueurEn(battle, noeud.x, noeud.z);
    if (bloqueur) {
      const allonge = u.ranged ? u.rangeB : COMBAT.porteeBatiment;
      if (dist(u, bloqueur) <= allonge) { attaquerBatiment(battle, u, bloqueur); return; }
    }
    if (u.targetKind === 'building') { u.targetId = null; u.targetKind = null; }
    if (approcher(battle, u, noeud.x + u.ox, noeud.z + u.oz, 0, dt)) {
      u.pathIndex++;
      if (u.pathIndex >= battle.path.length) u.mode = 'assault';
    }
    return;
  }

  // 3. Au bout de la route : attaquer le bâtiment le plus proche.
  let b = u.targetKind === 'building' ? battle.buildingIndex.get(u.targetId) : null;
  if (!b || b.destroyed) b = batimentLePlusProche(battle, u, Infinity, false);
  if (!b) { u.state = 'idle'; return; }
  u.targetId = b.id;
  u.targetKind = 'building';
  const allonge = u.ranged ? u.rangeB : COMBAT.porteeBatiment;
  if (dist(u, b) <= allonge) attaquerBatiment(battle, u, b);
  else approcher(battle, u, b.x, b.z, allonge * 0.9, dt);
}

// ---------------------------------------------------------------------
//  Étapes globales
// ---------------------------------------------------------------------

function etapeApparition(battle, dt) {
  if (!battle.spawnQueue.length) return;
  battle.spawnTimer -= dt;
  if (battle.spawnTimer > 0) return;
  battle.spawnTimer += battle.spawnInterval;
  const type = battle.spawnQueue.shift();
  const def = ENNEMIS[type];
  const rng = battle.rng;
  const lat = COMBAT.decalageLateral;
  const ox = rng.range(-lat, lat);
  const oz = rng.range(-lat, lat);
  const spawn = battle.path[0];
  const pv = Math.round(def.pv * battle.force);
  const u = nouvelleUnite(battle, {
    side: 'enemy',
    type,
    kind: type,
    x: spawn.x + ox,
    z: spawn.z - 0.4 + oz,
    hp: pv,
    maxHp: pv,
    dmg: def.degats,
    dmgB: def.degatsBatiments ?? def.degats,
    cadence: def.cadence,
    range: def.portee,
    rangeB: def.porteeBatiments ?? def.portee,
    speed: def.vitesse * rng.range(0.95, 1.05),
    ranged: def.portee > COMBAT.porteeEngagement,
    size: def.taille,
    cible: def.cible,
    resTours: def.resistanceTours ?? 0,
    state: 'walk',
    facing: 0,
    mode: 'path',
    pathIndex: 1,
    ox,
    oz,
    cd: rng.range(0, def.cadence * 0.5),
  });
  battle.spawned++;
  emettre(battle, { type: 'spawn', unitId: u.id, unitType: type, side: 'enemy', x: u.x, z: u.z });
}

function etapeBatiments(battle, dt) {
  for (const b of battle.buildings) {
    if (b.destroyed) continue;
    b.hitTime += dt;
    if (b.trap && !b.trap.ready) {
      b.trap.rechargeLeft = Math.max(0, b.trap.rechargeLeft - dt);
      b.trap.progress = 1 - b.trap.rechargeLeft / b.trap.recharge;
      if (b.trap.rechargeLeft <= 0) { b.trap.ready = true; b.trap.progress = 1; }
    }
    const t = b.tower;
    if (!t) continue;
    t.shotTime += dt;
    t.cd -= dt;
    if (t.cd > 0) continue;
    let cible = null;
    let best = Infinity;
    for (const u of battle.units) {
      if (u.side !== 'enemy' || u.state === 'dead') continue;
      const d = dist(b, u);
      if (d <= t.range && d < best) { best = d; cible = u; }
    }
    if (!cible) { t.cd = 0; t.targetId = null; continue; }
    t.cd = t.cadence;
    t.targetId = cible.id;
    t.shotTime = 0;
    t.facing = Math.atan2(cible.x - b.x, cible.z - b.z);
    tirer(battle, b, cible, 'unit', t.damage, b.x, b.z, COMBAT.dureeFlecheTour, 'tower');
  }
}

function etapeProjectiles(battle, dt) {
  const ps = battle.projectiles;
  let w = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.t += dt;
    if (p.t + 1e-9 < p.duration) { ps[w++] = p; continue; }
    if (p.targetKind === 'unit') {
      const u = battle.unitIndex.get(p.targetId);
      if (u && u.state !== 'dead') {
        // Les flèches des tours glissent sur les gros (bélier, chef) : il faut l'armée pour les arrêter.
        const tour = p.sourceKind === 'tower';
        const degats = tour ? p.damage * (1 - u.resTours) : p.damage;
        blesserUnite(battle, u, degats, p.sourceId, tour ? 'tower' : 'arrow');
      }
    } else {
      const b = battle.buildingIndex.get(p.targetId);
      if (b) blesserBatiment(battle, b, p.damage, p.sourceId);
    }
  }
  ps.length = w;
}

// Les unités d'un même camp s'écartent un peu pour ne pas se superposer.
function etapeSeparation(battle, dt) {
  const r = COMBAT.rayonSeparation;
  const k = Math.min(1, COMBAT.forceSeparation * dt);
  const us = battle.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    if (a.state === 'dead') continue;
    for (let j = i + 1; j < us.length; j++) {
      const c = us[j];
      if (c.state === 'dead' || c.side !== a.side) continue;
      let dx = c.x - a.x;
      let dz = c.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d < 1e-6) {
        const ang = (a.id * 2.3999 + c.id * 0.7) % (Math.PI * 2);
        dx = Math.cos(ang);
        dz = Math.sin(ang);
        d = 1;
      } else {
        dx /= d;
        dz /= d;
      }
      const pousse = (r - Math.min(d, r)) * 0.5 * k;
      pousser(battle, a, -dx * pousse, -dz * pousse);
      pousser(battle, c, dx * pousse, dz * pousse);
    }
  }
}

function pousser(battle, u, dx, dz) {
  const nx = u.x + dx;
  const nz = u.z + dz;
  if (pasInterdit(battle, u, nx, nz)) return;
  if (u.side === 'ally' && battle.blockers.size && bloqueurEn(battle, Math.round(nx), Math.round(nz))
    && !bloqueurEn(battle, Math.round(u.x), Math.round(u.z))) return;
  u.x = Math.max(-0.45, Math.min(MAP_W - 0.55, nx));
  u.z = Math.max(-0.45, Math.min(MAP_H - 0.55, nz));
}

function etapeFin(battle) {
  let debout = false;
  for (const b of battle.buildings) if (!b.destroyed && b.targetable) { debout = true; break; }
  if (!debout) {
    battle.over = true;
    battle.result = 'defeat';
    emettre(battle, { type: 'defeat' });
    return;
  }
  let vivants = false;
  for (const u of battle.units) if (u.side === 'enemy' && u.state !== 'dead') { vivants = true; break; }
  if (!battle.spawnQueue.length && !vivants) {
    battle.over = true;
    battle.result = 'won';
    emettre(battle, { type: 'wave_won', retreated: false });
    return;
  }
  if (battle.time >= COMBAT.dureeMax) {
    // Sécurité anti-blocage : les ennemis restants se retirent.
    for (const u of battle.units) {
      if (u.side === 'enemy' && u.state !== 'dead') {
        u.state = 'dead';
        u.retreated = true;
        u.deadTime = 0;
      }
    }
    battle.spawnQueue.length = 0;
    battle.over = true;
    battle.result = 'won';
    battle.retreated = true;
    emettre(battle, { type: 'wave_won', retreated: true });
  }
}

/**
 * Avance la bataille d'un pas fixe (1/30 s par défaut). Le moteur 3D accumule le temps réel
 * × vitesse (×1, ×2) et appelle stepBattle autant de fois que nécessaire.
 * Remplit battle.events (à vider par le lecteur).
 * @param {object} battle
 * @param {number} [dt] durée du pas en secondes (garder COMBAT.pas pour rester déterministe)
 * @returns {object} la bataille
 */
export function stepBattle(battle, dt = COMBAT.pas) {
  if (battle.over) return battle;
  battle.time += dt;
  etapeApparition(battle, dt);
  etapeProjectiles(battle, dt); // avant les tirs : une flèche vole bien « duration » secondes
  etapeBatiments(battle, dt);
  for (const u of battle.units) {
    if (u.state === 'dead') { u.deadTime += dt; continue; }
    u.cd -= dt;
    u.attackTime += dt;
    u.hitTime += dt;
    u.attackProgress = Math.min(1, u.attackTime / COMBAT.dureeAnimAttaque);
    if (u.side === 'ally') etapeSoldat(battle, u, dt);
    else etapeEnnemi(battle, u, dt);
  }
  etapeSeparation(battle, dt);
  etapeFin(battle);
  return battle;
}

/**
 * Levier « piège » : déclenche le piège s'il est chargé. Tous les ennemis dans son rayon
 * prennent les dégâts, puis il se recharge (battle.buildings[i].trap.progress de 0 à 1).
 * @param {object} battle
 * @param {number} buildingId
 * @returns {{ ok: boolean, reason?: string, hits?: number }}
 */
export function triggerTrap(battle, buildingId) {
  if (battle.over) return { ok: false, reason: 'La bataille est terminée.' };
  const b = battle.buildingIndex.get(buildingId);
  if (!b || !b.trap) return { ok: false, reason: "Ce n’est pas un piège." };
  if (b.destroyed) return { ok: false, reason: 'Ce piège est détruit.' };
  if (!b.trap.ready) return { ok: false, reason: `Le piège se recharge (${Math.ceil(b.trap.rechargeLeft)} s).` };
  const rayon = b.trap.radius + COMBAT.margeRayonPiege;
  let hits = 0;
  for (const u of battle.units) {
    if (u.side !== 'enemy' || u.state === 'dead') continue;
    if (dist(u, b) <= rayon) {
      hits++;
      blesserUnite(battle, u, b.trap.damage, b.id, 'trap');
    }
  }
  b.trap.ready = false;
  b.trap.rechargeLeft = b.trap.recharge;
  b.trap.progress = 0;
  emettre(battle, { type: 'trap', buildingId: b.id, x: b.x, z: b.z, radius: b.trap.radius, hits });
  return { ok: true, hits };
}

/**
 * Levier « Déplacer l'armée » : nouveau point de ralliement (pas dans l'eau ni sur un rocher).
 * Les soldats y marchent et la laisse se recentre. Le drapeau est gardé à la fin de la bataille.
 * @param {object} battle
 * @param {{ x:number, z:number }} pos tuile
 * @returns {{ ok: boolean, reason?: string }}
 */
export function moveArmy(battle, pos) {
  if (battle.over) return { ok: false, reason: 'La bataille est terminée.' };
  const map = getMap(battle.chapter);
  const x = Math.round(pos.x);
  const z = Math.round(pos.z);
  const c = rallyCheck(map, x, z);
  if (!c.ok) return c;
  battle.rally = { x, z };
  battle.rallyIdx = coteDrapeau(battle.path, battle.rally);
  for (const u of battle.units) {
    if (u.side === 'ally' && u.state !== 'dead') { u.targetId = null; u.targetKind = null; }
  }
  return { ok: true };
}

/**
 * Ennemis encore à vaincre (vivants + pas encore arrivés).
 * @param {object} battle
 * @returns {number}
 */
export function enemiesRemaining(battle) {
  let n = battle.spawnQueue.length;
  for (const u of battle.units) if (u.side === 'enemy' && u.state !== 'dead') n++;
  return n;
}

/**
 * Simule la bataille jusqu'au bout sans affichage (tests, robots d'équilibrage).
 * Vide battle.events à chaque pas (après l'appel éventuel de onStep).
 * @param {object} battle
 * @param {{ onStep?: (battle:object) => void, maxSteps?: number }} [opts]
 * @returns {object} la bataille terminée
 */
export function runBattle(battle, opts = {}) {
  const max = opts.maxSteps ?? Math.ceil((COMBAT.dureeMax + 5) / COMBAT.pas);
  for (let i = 0; i < max && !battle.over; i++) {
    stepBattle(battle, COMBAT.pas);
    if (opts.onStep) opts.onStep(battle);
    battle.events.length = 0;
  }
  return battle;
}

/**
 * Lance la vague suivante : vérifie la phase, passe la partie en 'battle' et crée la bataille.
 * L'interface sauvegarde la partie JUSTE AVANT cet appel.
 * @param {object} state
 * @returns {{ ok: boolean, reason?: string, battle?: object }}
 */
export function startBattle(state) {
  if (state.phase !== 'prep') return { ok: false, reason: 'Impossible de lancer la vague maintenant.' };
  if (state.wave >= state.wavesTotal) return { ok: false, reason: 'Toutes les vagues sont déjà repoussées.' };
  const battle = createBattle(state, state.wave);
  state.phase = 'battle';
  return { ok: true, battle };
}

/**
 * Fin de bataille : reporte dans la partie les bâtiments détruits, les soldats morts, les ennemis tués
 * et le drapeau ; puis, si la vague est gagnée, fait le bilan (endOfCycle). Sans effet si appelé deux fois.
 * En cas de défaite, la phase passe à 'defeat' et l'XP des ennemis tués est gardée.
 * @param {object} state
 * @param {object} battle bataille terminée (battle.over)
 * @param {object|null} [meta] progression du royaume (XP, missions)
 * @returns {object} rapport (voir endOfCycle) ou { ok:false, reason } si la bataille n'est pas finie
 */
export function finishBattle(state, battle, meta = null) {
  if (battle.finished) return battle.report;
  if (!battle.over) return { ok: false, reason: "La bataille n’est pas terminée." };
  battle.finished = true;

  const perdus = [];
  for (const bb of battle.buildings) {
    const sb = state.buildings.find((b) => b.id === bb.id);
    if (!sb) continue;
    if (bb.destroyed && !sb.destroyed) {
      sb.destroyed = true;
      sb.hp = 0;
      sb.workers = 0;
      perdus.push(sb.type);
    } else if (!sb.destroyed && bb.targetable) {
      // borné au maximum : un piège (0 PV, jamais visé) garde 0, comme après un rechargement
      sb.hp = Math.min(bb.maxHp, Math.max(1, Math.ceil(bb.hp)));
    }
  }
  const morts = new Set(battle.deadSoldierIds);
  state.soldiers = state.soldiers.filter((s) => !morts.has(s.id));
  state.stats.kills += battle.kills;
  state.stats.trapKills += battle.trapKills;
  state.stats.soldiersLost += morts.size;
  state.stats.buildingsLost += perdus.length;
  state.rally = { ...battle.rally };

  const ctx = {
    waveNumber: battle.waveNumber,
    kills: battle.kills,
    trapKills: battle.trapKills,
    soldiersLost: morts.size,
    buildingsLost: perdus.length,
    buildingsLostTypes: perdus,
    retreated: battle.retreated,
    won: battle.result === 'won',
  };

  let report;
  if (battle.result === 'defeat' || isDefeated(state)) {
    state.phase = 'defeat';
    const niveauAvant = meta ? meta.level : 0;
    const xp = META.xpParEnnemi * battle.kills;
    addXp(meta, xp);
    if (meta) meta.bestWave = Math.max(meta.bestWave, state.wave);
    report = {
      ok: true,
      result: 'defeat',
      wave: battle.waveNumber,
      wavesTotal: state.wavesTotal,
      retreated: false,
      kills: battle.kills,
      trapKills: battle.trapKills,
      soldiersLost: morts.size,
      buildingsLost: perdus.length,
      buildingsLostTypes: perdus,
      production: null,
      food: null,
      population: null,
      repaired: 0,
      xp: {
        gained: xp, wave: xp, victory: 0, missions: 0,
        total: meta ? meta.xp : null, level: meta ? meta.level : null,
        levelUp: meta ? meta.level > niveauAvant : false, levelsGained: meta ? meta.level - niveauAvant : 0,
        talentPoints: meta ? meta.talentPoints : null,
      },
      missions: [],
      unlocked: [],
      messages: ['Le village est tombé. L’expérience du royaume est conservée.'],
    };
    addLog(state, `Vague ${battle.waveNumber} : le village est tombé.`);
    state.lastReport = report;
  } else {
    state.wave = Math.max(state.wave, battle.waveIndex + 1);
    report = endOfCycle(state, meta, ctx);
  }
  battle.report = report;
  return report;
}
