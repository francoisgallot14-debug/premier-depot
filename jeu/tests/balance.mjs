// Équilibrage : des robots jouent le chapitre 1 sans affichage.
//   passif      : ne construit rien (doit perdre tôt)
//   raisonnable : ordre de construction simple et sensé, garde une petite armée (comble ses pertes)
//                 et la poste derrière le premier mur. Leviers « humains » : il voit un attroupement
//                 sur un piège, réagit en 1,5 à 3 s, oublie parfois (doit gagner ≥ 90 % des parties)
//   sans_pieges : le même, sans construire ni toucher aucun piège (doit pouvoir gagner, moins souvent)
//   parfait     : le même avec des réflexes de robot (pièges vérifiés chaque 1/30 s) : un plafond
//   econome     : économie d'abord, défense tardive (jouable mais plus risqué)
//   tours       : même ordre que raisonnable mais l'armée est négligée (tous au travail, drapeau jamais
//                 déplacé) : doit s'en sortir moins bien, sinon l'armée ne sert à rien
// Usage : npm run balance   (options --seeds=40, --detail pour toutes les graines, --strict pour échouer
//         si les cibles ne tiennent pas, --robots=raisonnable,parfait, --tueurs : qui tue nos soldats)

import * as C from '../src/core/index.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}`));
  if (!a) return def;
  const v = a.split('=')[1];
  return v === undefined ? true : v;
};
const NB_GRAINES = Number(opt('seeds', 20)); // 20 graines : les cibles ne tiennent pas à un coup de chance
const DETAIL = !!opt('detail', false);
const STRICT = !!opt('strict', false);
const TRACE = opt('trace', false); // --trace=raisonnable : détail de chaque préparation
const TRACE_BATAILLE = String(opt('bataille', '')); // --bataille=raisonnable:7:6 : événements d'une bataille
const TUEURS = !!opt('tueurs', false); // --tueurs : qui tue nos soldats, vague par vague (robot raisonnable)
const SEULS = opt('robots', ''); // --robots=raisonnable,sans_pieges : ne faire jouer que ceux-là

const map = C.getMap(1);
const tueurs = {}; // vague → { type d'ennemi → soldats tués }
const P = map.path;

// ---------------------------------------------------------------------
//  Outils communs aux robots
// ---------------------------------------------------------------------
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const nb = (s, type) => s.buildings.filter((b) => b.type === type).length;

function pres(state, type, cible) {
  const v = C.validTiles(state, type, { ignoreCost: true });
  v.sort((a, b) => d2(a, cible) - d2(b, cible) || a.z - b.z || a.x - b.x);
  return v[0] || null;
}

// Emplacement de tour qui couvre le plus de route (la fin de route compte plus).
function placeTour(state, type) {
  const portee = C.BATIMENTS[type].tour.portee;
  let best = null;
  let bestScore = -1;
  for (const t of C.validTiles(state, type, { ignoreCost: true })) {
    let score = 0;
    P.forEach((p, i) => { if (d2(p, t) <= portee) score += 1 + i / P.length; });
    // Pas collé à un autre bâtiment de défense : on étale la couverture.
    for (const b of state.buildings) if (C.BATIMENTS[b.type].tour && d2(b, t) < 2) score -= 3;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

function placeRoute(state, type, indices) {
  for (const i of indices) {
    const p = P[i];
    const c = C.canPlace(state, type, p.x, p.z);
    if (c.ok || c.code === 'cout') return p;
  }
  return null;
}

// Essaie de construire ; renvoie 'ok' | 'cout' | 'impossible'.
function construire(state, type, spot) {
  if (!spot) return 'impossible';
  const r = C.build(state, type, spot.x, spot.z);
  if (r.ok) return 'ok';
  return r.code === 'cout' ? 'cout' : 'impossible';
}

function reconstruireRuines(state) {
  // La Maison commune d'abord, puis le reste.
  const ruines = state.buildings.filter((b) => b.destroyed).sort((a, b) => (a.type === 'maison_commune' ? -1 : 0) - (b.type === 'maison_commune' ? -1 : 0));
  for (const b of ruines) C.rebuild(state, b.id);
}

// Place les villageois libres : nourriture d'abord si le solde est négatif.
function placerOuvriers(state) {
  for (let garde = 0; garde < 40 && C.freeVillagers(state) > 0; garde++) {
    const f = C.productionForecast(state);
    const ordre = f.soldeNourriture < 2 || state.resources.nourriture < 15
      ? ['champ', 'chasseur', 'bucheron', 'carriere']
      : ['bucheron', 'carriere', 'champ', 'chasseur'];
    let place = false;
    for (const type of ordre) {
      for (const b of state.buildings.filter((x) => x.type === type && !x.destroyed)) {
        if (C.assign(state, b.id, +1).ok) { place = true; break; }
      }
      if (place) break;
    }
    if (!place) break;
  }
}

function utiliserActions(state, besoin) {
  while (state.actionsLeft > 0) {
    const f = C.productionForecast(state);
    const r = state.resources;
    let a = null;
    if (r.nourriture + f.soldeNourriture < 12) a = 'chasser';
    else if (besoin && besoin.pierre > r.pierre && C.canDoAction(state, 'tailler_pierre').ok) a = 'tailler_pierre';
    else if (besoin && besoin.bois > r.bois && C.canDoAction(state, 'couper_bois').ok) a = 'couper_bois';
    else if (state.wave >= 2 && C.canDoAction(state, 'entrainer').ok) a = 'entrainer';
    else if (C.canDoAction(state, 'explorer').ok && state.wave % 2 === 0) a = 'explorer';
    else if (r.pierre < 40 && C.canDoAction(state, 'tailler_pierre').ok && state.wave >= 2) a = 'tailler_pierre';
    else if (C.canDoAction(state, 'couper_bois').ok) a = 'couper_bois';
    else if (C.canDoAction(state, 'chasser').ok) a = 'chasser';
    if (!a || !C.doAction(state, a).ok) break;
  }
}

// Leviers « parfaits » : regarde les pièges à chaque pas (1/30 s) et déclenche dès que plusieurs
// ennemis (ou un costaud) sont dessus. Aucun joueur ne fait ça : sert seulement de plafond.
function leviersParfaits() {
  return (battle) => {
    for (const b of battle.buildings) {
      if (!b.trap || !b.trap.ready || b.destroyed) continue;
      let n = 0;
      let gros = false;
      for (const u of battle.units) {
        if (u.side !== 'enemy' || u.state === 'dead') continue;
        if (Math.hypot(u.x - b.x, u.z - b.z) <= b.trap.radius + C.COMBAT.margeRayonPiege) { n++; if (u.hp >= 35) gros = true; }
      }
      if (n >= 3 || (n >= 1 && gros) || (n >= 2 && battle.time > 0)) C.triggerTrap(battle, b.id);
    }
  };
}

// Leviers « humains » : un vrai joueur voit un attroupement sur un piège, met un moment à
// réagir, et parfois ne le voit pas (il regardait ailleurs, il zoomait…).
const HUMAIN = {
  reaction: [1.5, 3],    // secondes entre « je vois » et « j'ai touché le piège » (tirées par graine)
  oubli: 0.25,           // chance de rater une occasion
  distraction: [4, 9],   // secondes avant de regarder à nouveau ce piège après un oubli
  minEnnemis: 2,         // déclenche s'il voit au moins 2 ennemis dans le rayon…
  grosses: ['belier', 'chef_de_guerre'], // … ou une grosse cible
};

function ciblesSurPiege(battle, b) {
  let n = 0;
  let gros = false;
  for (const u of battle.units) {
    if (u.side !== 'enemy' || u.state === 'dead') continue;
    if (Math.hypot(u.x - b.x, u.z - b.z) <= b.trap.radius + C.COMBAT.margeRayonPiege) {
      n++;
      if (HUMAIN.grosses.includes(u.type)) gros = true;
    }
  }
  return n >= HUMAIN.minEnnemis || gros;
}

function leviersHumains(graine, vague) {
  const rng = C.createRng(C.mixSeeds(graine, vague, 'leviers'));
  const suivi = new Map(); // piège → { etat: 'guette' | 'vise' | 'distrait', t }
  return (battle) => {
    for (const b of battle.buildings) {
      if (!b.trap || b.destroyed) continue;
      let p = suivi.get(b.id);
      if (!p) { p = { etat: 'guette', t: 0 }; suivi.set(b.id, p); }
      if (!b.trap.ready) { p.etat = 'guette'; continue; }
      if (p.etat === 'distrait' && battle.time >= p.t) p.etat = 'guette';
      if (p.etat === 'guette' && ciblesSurPiege(battle, b)) {
        if (rng.chance(HUMAIN.oubli)) p = Object.assign(p, { etat: 'distrait', t: battle.time + rng.range(...HUMAIN.distraction) });
        else p = Object.assign(p, { etat: 'vise', t: battle.time + rng.range(...HUMAIN.reaction) });
      }
      // le doigt touche le piège : il part, même si les ennemis ont bougé entre-temps
      if (p.etat === 'vise' && battle.time >= p.t) { C.triggerTrap(battle, b.id); p.etat = 'guette'; }
    }
  };
}

// Exécute une liste de souhaits dans l'ordre ; s'arrête dès qu'il faut économiser.
function suivrePlan(state, plan) {
  for (const [type, combien, ou] of plan) {
    if (nb(state, type) >= combien) continue;
    if (!state.unlocked.includes(type)) continue;
    const spot = ou(state);
    const r = construire(state, type, spot);
    if (r === 'cout') return C.BATIMENTS[type].cout; // on garde les ressources pour celui-ci
  }
  return null;
}

// Retire un ouvrier pour en faire un soldat, sans faire passer la nourriture dans le rouge.
function libererOuvrier(state) {
  for (const type of ['carriere', 'bucheron', 'chasseur', 'champ']) {
    for (const b of state.buildings.filter((x) => x.type === type && !x.destroyed && x.workers > 0)) {
      if (!C.assign(state, b.id, -1).ok) continue;
      if (C.productionForecast(state).soldeNourriture >= 0) return true;
      C.assign(state, b.id, +1);
    }
  }
  return false;
}

/** Recrute jusqu'à `cible` soldats. `retirer` : un joueur sensé retire un ouvrier pour combler les pertes. */
function recruterEtEquiper(state, cible, retirer = false) {
  while (state.soldiers.length < cible) {
    if (C.freeVillagers(state) === 0) {
      const place = state.soldiers.length < C.soldierCapacity(state) && C.hasBuilding(state, 'caserne')
        && C.canAfford(state, C.recruitCost(state, 'fantassin'));
      if (!retirer || !place || !libererOuvrier(state)) break;
    }
    const archers = state.soldiers.filter((s) => s.kind === 'archer').length;
    const kind = C.hasBuilding(state, 'atelier') && archers < Math.floor(state.soldiers.length / 3) ? 'archer' : 'fantassin';
    if (!C.recruit(state, kind).ok && !C.recruit(state, 'fantassin').ok) break;
  }
  if (C.hasBuilding(state, 'atelier')) {
    if (state.resources.pierre >= 10) C.equipAll(state, 2);
    if (state.resources.pierre >= 20) C.equipAll(state, 3);
  } else if (state.resources.bois >= 9) {
    C.equipAll(state, 1);
  }
}

// Drapeau juste derrière le premier mur (ou palissade) debout sur la route : l'armée y tient la brèche.
function drapeauAuMur(state) {
  let premier = P.length;
  for (const b of state.buildings) {
    if (b.destroyed || !C.BATIMENTS[b.type].bloqueRoute) continue;
    const i = C.pathIndexOf(map, b.x, b.z);
    if (i >= 0) premier = Math.min(premier, i);
  }
  if (premier < P.length - 1) C.setRally(state, P[premier + 1]);
}

const H = map.hall;
const proche = (type) => (s) => pres(s, type, H);
const tour = (type) => (s) => placeTour(s, type);
const route = (type, idx) => (s) => placeRoute(s, type, idx);

// Tour de pierre dès la carrière ; pièges juste devant le premier mur (là où les ennemis s'entassent).
const PLAN_RAISONNABLE = [
  ['bucheron', 1, proche('bucheron')],
  ['palissade', 1, route('palissade', [30, 29, 28])],
  ['chasseur', 1, proche('chasseur')],
  ['tour_guet', 1, tour('tour_guet')],
  ['hutte', 1, proche('hutte')],
  ['carriere', 1, proche('carriere')],
  ['tour_pierre', 1, tour('tour_pierre')],
  ['caserne', 1, proche('caserne')],
  ['hutte', 2, proche('hutte')],
  ['piege', 1, route('piege', [24, 23, 22])],
  ['bucheron', 2, proche('bucheron')],
  ['mur_pierre', 1, route('mur_pierre', [25, 24, 23])],
  ['atelier', 1, proche('atelier')],
  ['tour_pierre', 2, tour('tour_pierre')],
  ['champ', 1, proche('champ')],
  ['hutte', 3, proche('hutte')],
  ['carriere', 2, proche('carriere')],
  ['tour_pierre', 3, tour('tour_pierre')],
  ['piege', 2, route('piege', [23, 22, 21])],
  ['hutte', 4, proche('hutte')],
  ['entrepot', 1, proche('entrepot')],
  ['tour_pierre', 4, tour('tour_pierre')],
  ['mur_pierre', 2, route('mur_pierre', [13, 12, 11])],
  ['hutte', 5, proche('hutte')],
  ['tour_pierre', 5, tour('tour_pierre')],
  ['tour_pierre', 6, tour('tour_pierre')],
];

// Même plan sans aucun piège (le bois va au reste).
const PLAN_SANS_PIEGES = PLAN_RAISONNABLE.filter(([type]) => type !== 'piege');

/**
 * Préparation sensée. `armee` : garde une petite armée (recrutée avant de distribuer les emplois)
 * et poste le drapeau derrière le premier mur ; sinon tout le monde travaille et le drapeau ne bouge pas.
 */
function prepRaisonnable(state, armee, plan = PLAN_RAISONNABLE) {
  reconstruireRuines(state);
  if (armee) recruterEtEquiper(state, 3 + Math.floor(Math.max(0, state.wave - 2) / 2), true);
  placerOuvriers(state);
  const besoin = suivrePlan(state, plan);
  utiliserActions(state, besoin);
  suivrePlan(state, plan);
  placerOuvriers(state);
  recruterEtEquiper(state, 3 + Math.max(0, state.wave - 2));
  placerOuvriers(state);
  if (armee) drapeauAuMur(state);
}

// ---------------------------------------------------------------------
//  Les robots
// ---------------------------------------------------------------------
const ROBOTS = {
  passif: {
    nom: 'passif',
    prep(state) {
      // Ne construit rien ; se contente de chasser pour manger.
      while (state.actionsLeft > 0 && C.doAction(state, 'chasser').ok);
      while (state.actionsLeft > 0 && C.doAction(state, 'couper_bois').ok);
    },
    leviers: null,
  },

  // Le robot de référence : joue comme un humain attentif (réaction 1,5–3 s, oublis).
  raisonnable: {
    nom: 'raisonnable',
    prep(state) { prepRaisonnable(state, true); },
    leviers: leviersHumains,
  },

  // Même jeu, sans construire ni toucher aucun piège : les pièges aident, ils ne sont pas obligatoires.
  sans_pieges: {
    nom: 'sans_pieges',
    prep(state) { prepRaisonnable(state, true, PLAN_SANS_PIEGES); },
    leviers: null,
  },

  // Même jeu avec des réflexes parfaits (chaque 1/30 s) : un plafond, pas une cible.
  parfait: {
    nom: 'parfait',
    prep(state) { prepRaisonnable(state, true); },
    leviers: leviersParfaits,
  },

  econome: {
    nom: 'econome',
    prep(state) {
      reconstruireRuines(state);
      placerOuvriers(state);
      const eco = [
        ['bucheron', 1, proche('bucheron')],
        ['chasseur', 1, proche('chasseur')],
        ['hutte', 1, proche('hutte')],
        ['bucheron', 2, proche('bucheron')],
        ['carriere', 1, proche('carriere')],
        ['hutte', 2, proche('hutte')],
        ['entrepot', 1, proche('entrepot')],
        ['champ', 1, proche('champ')],
        ['hutte', 3, proche('hutte')],
        ['carriere', 2, proche('carriere')],
        ['hutte', 4, proche('hutte')],
        ['champ', 2, proche('champ')],
        ['hutte', 5, proche('hutte')],
      ];
      const defense = [
        ['palissade', 1, route('palissade', [30, 29, 28])],
        ['tour_guet', 1, tour('tour_guet')],
        ['caserne', 1, proche('caserne')],
        ['atelier', 1, proche('atelier')],
        ['tour_pierre', 1, tour('tour_pierre')],
        ['mur_pierre', 1, route('mur_pierre', [25, 24, 23])],
        ['tour_pierre', 2, tour('tour_pierre')],
        ['piege', 1, route('piege', [29, 28, 27])],
        ['tour_pierre', 3, tour('tour_pierre')],
        ['tour_guet', 2, tour('tour_guet')],
        ['tour_pierre', 4, tour('tour_pierre')],
        ['mur_pierre', 2, route('mur_pierre', [13, 12, 11])],
        ['tour_pierre', 5, tour('tour_pierre')],
        ['tour_pierre', 6, tour('tour_pierre')],
        ['tour_pierre', 7, tour('tour_pierre')],
      ];
      // Juste une palissade au début, une tour avant la 3e vague, la vraie défense après.
      const plan = state.wave >= 3 ? [...defense, ...eco] : state.wave === 2 ? [defense[0], defense[1], ...eco] : [defense[0], ...eco];
      const besoin = suivrePlan(state, plan);
      utiliserActions(state, besoin);
      suivrePlan(state, plan);
      placerOuvriers(state);
      recruterEtEquiper(state, 3 + Math.max(0, state.wave - 3) * 2);
      placerOuvriers(state);
    },
    leviers: leviersHumains,
  },

  tours: {
    nom: 'tours',
    prep(state) { prepRaisonnable(state, false); },
    leviers: leviersHumains,
  },
};

// ---------------------------------------------------------------------
//  Partie complète
// ---------------------------------------------------------------------
function jouer(robot, graine) {
  const meta = C.newMeta();
  const state = C.newGame(meta, { seed: graine });
  const lignes = [];
  let duree = 0;
  while (state.phase === 'prep') {
    robot.prep(state);
    const vague = state.wave + 1;
    if (TRACE === robot.nom && graine === 1) {
      console.log(`[prep ${vague}] res ${JSON.stringify(state.resources)} vill ${state.villagers} libres ${C.freeVillagers(state)} soldats ${state.soldiers.map((x) => `${x.kind[0]}${x.equip}/${x.training}`).join(',')} actions ${state.actionsLeft}`);
      console.log('   ', state.buildings.map((b) => `${b.type}@${b.x},${b.z}${b.workers ? `:${b.workers}` : ''}${b.destroyed ? '(ruine)' : ''}`).join(' '));
    }
    const avant = { soldats: state.soldiers.length };
    let pvMin = 1; // PV les plus bas de la Maison commune pendant la bataille (tension)
    const tours = state.buildings.filter((b) => !b.destroyed && C.BATIMENTS[b.type].tour && b.type !== 'maison_commune').length;
    const r = C.startBattle(state);
    if (!r.ok) throw new Error(r.reason);
    const levier = robot.leviers ? robot.leviers(graine, vague) : null;
    const tracer = TRACE_BATAILLE === `${robot.nom}:${graine}:${vague}`;
    if (tracer) {
      console.log(`[bataille ${vague}] ${state.buildings.map((b) => `${b.type}@${b.x},${b.z}`).join(' ')}`);
      console.log(`  soldats ${state.soldiers.map((x) => `${x.kind[0]}${x.equip}/${x.training}`).join(',')} drapeau ${state.rally.x},${state.rally.z}`);
    }
    // dégâts utiles reçus par les ennemis, selon la source (l'armée compte-t-elle ?)
    const degats = { tower: 0, melee: 0, arrow: 0, trap: 0 };
    C.runBattle(r.battle, {
      onStep: (b) => {
        if (levier) levier(b);
        const h = b.buildings.find((x) => x.type === 'maison_commune');
        if (h) pvMin = Math.min(pvMin, h.hp / h.maxHp);
        for (const e of b.events) {
          if (TUEURS && robot.nom === 'raisonnable' && e.type === 'hit' && e.side === 'ally') {
            const cible = b.unitIndex.get(e.targetId);
            const source = b.unitIndex.get(e.sourceId);
            if (cible && cible.hp <= 0 && source) {
              const t = (tueurs[vague] ??= {});
              t[source.type] = (t[source.type] || 0) + 1;
            }
          }
          if (e.type !== 'hit' || e.side !== 'enemy' || !(e.cause in degats)) continue;
          const u = b.unitIndex.get(e.targetId);
          degats[e.cause] += u ? e.amount + Math.min(0, u.hp) : e.amount; // sans le surplus du coup fatal
        }
        if (!tracer) return;
        for (const e of b.events) {
          if (['death', 'building_destroyed', 'trap', 'wave_won', 'defeat'].includes(e.type)) {
            console.log(`  ${b.time.toFixed(1)}s ${e.type} ${e.unitType || e.buildingType || ''} ${e.side || ''} (${(e.x ?? 0).toFixed(1)}, ${(e.z ?? 0).toFixed(1)}) ${e.cause || ''}${e.hits !== undefined ? ` touchés ${e.hits}` : ''}`);
          }
        }
      },
    });
    duree += r.battle.time;
    const hall = r.battle.buildings.find((b) => b.type === 'maison_commune');
    const rep = C.finishBattle(state, r.battle, meta);
    lignes.push({
      vague,
      issue: rep.result === 'defeat' ? 'DÉFAITE' : (rep.retreated ? 'retraite' : 'gagnée'),
      soldatsAvant: avant.soldats,
      soldatsPerdus: rep.soldiersLost,
      batimentsPerdus: rep.buildingsLost,
      tues: rep.kills,
      tours,
      pvMaison: hall ? Math.round((hall.hp / hall.maxHp) * 100) : 0,
      maisonTouchee: pvMin < 1,
      bois: state.resources.bois,
      pierre: state.resources.pierre,
      nourriture: state.resources.nourriture,
      pop: C.population(state),
      duree: Math.round(r.battle.time),
      partArmee: (degats.melee + degats.arrow) / Math.max(1, degats.tower + degats.melee + degats.arrow + degats.trap),
      partPieges: degats.trap / Math.max(1, degats.tower + degats.melee + degats.arrow + degats.trap),
    });
    if (state.phase === 'report') C.continueToPrep(state);
  }
  return {
    lignes,
    gagne: state.phase === 'victory',
    vagues: lignes.filter((l) => l.issue !== 'DÉFAITE').length,
    soldatsPerdus: lignes.reduce((n, l) => n + l.soldatsPerdus, 0),
    batimentsPerdus: lignes.reduce((n, l) => n + l.batimentsPerdus, 0),
    duree,
    meta,
  };
}

function pad(v, n) {
  const s = String(v);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function tableau(nom, graine, res) {
  console.log(`\n=== ${nom} (graine ${graine}) : ${res.gagne ? 'VICTOIRE' : `défaite à la vague ${res.vagues + 1}`} — XP ${res.meta.xp}, niveau ${res.meta.level}`);
  console.log(' Vague | Issue    | Sold. | Perdus | Bât.perdus | Tués | Tours | Maison% | Bois | Pierre | Nourr. | Pop | Durée');
  for (const l of res.lignes) {
    console.log(` ${pad(l.vague, 5)} | ${l.issue.padEnd(8)} | ${pad(l.soldatsAvant, 5)} | ${pad(l.soldatsPerdus, 6)} | ${pad(l.batimentsPerdus, 10)} | ${pad(l.tues, 4)} | ${pad(l.tours, 5)} | ${pad(l.pvMaison, 7)} | ${pad(l.bois, 4)} | ${pad(l.pierre, 6)} | ${pad(l.nourriture, 6)} | ${pad(l.pop, 3)} | ${pad(l.duree, 4)}s`);
  }
}

const graines = Array.from({ length: NB_GRAINES }, (_, i) => i + 1);
const bilan = {};
const joueurs = Object.keys(ROBOTS).filter((nom) => !SEULS || String(SEULS).split(',').includes(nom));
for (const nom of joueurs) {
  const resultats = graines.map((g) => jouer(ROBOTS[nom], g));
  bilan[nom] = resultats;
  if (DETAIL) resultats.forEach((r, i) => tableau(nom, graines[i], r));
  else if (!SEULS) tableau(nom, graines[0], resultats[0]);
}

console.log(`\n=== Résumé sur ${NB_GRAINES} graines`);
console.log(' Robot        | Victoires | Vagues tenues (min–max) | Soldats perdus (moy.) | Bâtiments perdus (moy.)');
for (const [nom, rs] of Object.entries(bilan)) {
  const v = rs.filter((r) => r.gagne).length;
  const vs = rs.map((r) => r.vagues);
  const sp = rs.reduce((n, r) => n + r.soldatsPerdus, 0) / rs.length;
  const bp = rs.reduce((n, r) => n + r.batimentsPerdus, 0) / rs.length;
  console.log(` ${nom.padEnd(12)} | ${pad(`${v}/${rs.length}`, 9)} | ${pad(`${Math.min(...vs)}–${Math.max(...vs)}`, 23)} | ${pad(sp.toFixed(1), 21)} | ${pad(bp.toFixed(1), 23)}`);
}

// Tension vague par vague (robot raisonnable en détail ; les autres pour comparer)
function tension(nom, complet) {
  const rs = bilan[nom];
  const parVague = (f) => Array.from({ length: 10 }, (_, v) => {
    const ls = rs.map((r) => r.lignes[v]).filter(Boolean);
    return ls.length ? f(ls) : '  -';
  }).join(' ');
  console.log(`\n=== Tension : ${nom} (vagues 1 à 10)`);
  console.log(' Maison touchée (% des graines) :', parVague((ls) => pad(Math.round((100 * ls.filter((l) => l.maisonTouchee).length) / ls.length), 3)));
  console.log(' Soldats perdus (moyenne)       :', parVague((ls) => pad((ls.reduce((n, l) => n + l.soldatsPerdus, 0) / ls.length).toFixed(1), 3)));
  if (!complet) return;
  console.log(' Bâtiments perdus (moyenne)     :', parVague((ls) => pad((ls.reduce((n, l) => n + l.batimentsPerdus, 0) / ls.length).toFixed(1), 3)));
  console.log(' Dégâts faits par l’armée (%)   :', parVague((ls) => pad(Math.round((100 * ls.reduce((n, l) => n + l.partArmee, 0)) / ls.length), 3)));
  console.log(' Dégâts faits par les pièges (%):', parVague((ls) => pad(Math.round((100 * ls.reduce((n, l) => n + l.partPieges, 0)) / ls.length), 3)));
}
if (bilan.raisonnable) tension('raisonnable', true);
if (TUEURS) for (const [v, t] of Object.entries(tueurs)) console.log(` vague ${v} : soldats tués par`, JSON.stringify(t));
for (const nom of ['sans_pieges', 'parfait', 'tours', 'econome']) if (bilan[nom]) tension(nom, false);

// Cibles d'équilibrage (SPEC §12). Chaque cible dit de quels robots elle a besoin.
const moy = (rs, f) => rs.reduce((n, r) => n + f(r), 0) / rs.length;
const victoires = (nom) => bilan[nom].filter((r) => r.gagne).length;
// moyenne d'une valeur de ligne sur les vagues [v0, v1] (numéros 1 à 10), parties perdues comprises
const moyVagues = (nom, v0, v1, f) => {
  const ls = bilan[nom].flatMap((r) => r.lignes.filter((l) => l.vague >= v0 && l.vague <= v1));
  return ls.length ? ls.reduce((n, l) => n + f(l), 0) / ls.length : 0;
};
const touchee = (nom, v0, v1) => bilan[nom].filter((r) => r.lignes.some((l) => l.vague >= v0 && l.vague <= v1 && l.maisonTouchee)).length;
const N = NB_GRAINES;
const cibles = [
  [['passif'], 'passif perd tôt (avant la vague 5)', () => bilan.passif.every((r) => !r.gagne && r.vagues < 4)],
  [['raisonnable'], `raisonnable (leviers humains) gagne au moins 90 % des parties (${Math.ceil(0.9 * N)}/${N})`,
    () => victoires('raisonnable') >= Math.ceil(0.9 * N)],
  [['raisonnable'], 'raisonnable : des soldats tombent dès la vague 6 (≥ 0,3 par vague en moyenne sur les vagues 6 à 9)',
    () => [6, 7, 8, 9].every((v) => moyVagues('raisonnable', v, v, (l) => l.soldatsPerdus) >= 0.3)],
  // Tension : murs et palissades ne comptent pas (ils sont faits pour tomber), la Maison commune si.
  [['raisonnable'], 'raisonnable : Maison touchée sur une des vagues 8–10 dans ≥ 20 % des graines, et déjà avant la 10e dans certaines',
    () => touchee('raisonnable', 8, 10) >= 0.2 * N && touchee('raisonnable', 8, 9) >= 1],
  // La dernière vague est un sommet, pas un mur : ses pertes restent dans la suite des précédentes.
  [['raisonnable'], 'raisonnable : vague 10 = sommet, pas un mur (pertes ≤ 2,5 × la moyenne des vagues 7–9, Maison touchée ≤ 60 %)',
    () => moyVagues('raisonnable', 10, 10, (l) => l.soldatsPerdus) <= 2.5 * Math.max(0.4, moyVagues('raisonnable', 7, 9, (l) => l.soldatsPerdus))
      && touchee('raisonnable', 10, 10) <= 0.6 * N],
  [['raisonnable'], 'raisonnable : l’armée fait au moins 20 % des dégâts des vagues 5–9',
    () => moyVagues('raisonnable', 5, 9, (l) => l.partArmee) >= 0.2],
  // Les réflexes ne font pas tout : un humain (1,5–3 s, oublis) gagne presque autant qu'un robot parfait.
  [['raisonnable', 'parfait'], 'leviers humains ≈ leviers parfaits (au plus 2 victoires d’écart)',
    () => victoires('parfait') - victoires('raisonnable') <= 2],
  // Les pièges aident, ils ne sont pas obligatoires.
  [['sans_pieges', 'raisonnable'], 'sans aucun piège : on peut gagner, mais moins souvent',
    () => victoires('sans_pieges') >= 1 && victoires('sans_pieges') < victoires('raisonnable')],
  [['econome'], 'econome est jouable (gagne au moins une partie)', () => victoires('econome') >= 1],
  [['econome', 'raisonnable'], 'econome est plus risqué que raisonnable',
    () => victoires('econome') < victoires('raisonnable')
      || moy(bilan.econome, (r) => r.soldatsPerdus + r.batimentsPerdus) > moy(bilan.raisonnable, (r) => r.soldatsPerdus + r.batimentsPerdus)],
  // L'armée doit compter : des tours seules (armée négligée) s'en sortent moins bien.
  [['tours', 'raisonnable'], 'tours seules (armée négligée) : plus de bâtiments perdus que raisonnable',
    () => moy(bilan.tours, (r) => r.batimentsPerdus + (r.gagne ? 0 : 10)) > moy(bilan.raisonnable, (r) => r.batimentsPerdus + (r.gagne ? 0 : 10))],
];
console.log('\n=== Cibles');
let toutBon = true;
for (const [robots, texte, test] of cibles) {
  if (!robots.every((nom) => bilan[nom])) continue; // robot pas joué (--robots=…)
  const okc = test();
  console.log(` ${okc ? '[ok]' : '[ÉCHEC]'} ${texte}`);
  if (!okc) toutBon = false;
}
if (STRICT && !toutBon) process.exit(1);
