// Règles de la phase de préparation et du bilan de fin de cycle.
// Toute modification de la partie passe par ces fonctions, qui renvoient
// { ok: true, ... } ou { ok: false, reason: 'texte lisible' } (affiché tel quel).

import {
  BATIMENTS, ORDRE_BATIMENTS, ACTIONS, ORDRE_ACTIONS, EXPLORATION, REGLES, EQUIPEMENTS,
  TYPES_SOLDATS, RESSOURCES, NOMS_RESSOURCES, DEPART, META, VAGUES, ENNEMIS,
} from './data.js';
import { getMap, tileAt, inBounds, isNearTile, isWalkable } from './map.js';
import { stateRng } from './rng.js';
import {
  talentEffects, buildingMaxHpFor, addXp, checkMissions, waveXp,
} from './meta.js';

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (reason, code = 'regle') => ({ ok: false, reason, code });

const NOMS_TUILES = {
  road: 'la route',
  forest: 'une forêt',
  rock: 'un rocher',
  water: 'l’eau',
  grass: 'l’herbe',
};

// ---------------------------------------------------------------------
//  Petits utilitaires (ressources, coûts, journal)
// ---------------------------------------------------------------------

/**
 * Texte d'un coût : « 25 bois, 10 pierre » (ou « gratuit »).
 * @param {object} cost ex. { bois: 25, pierre: 10 }
 * @returns {string}
 */
export function costText(cost) {
  const parts = RESSOURCES.filter((r) => cost?.[r] > 0).map((r) => `${cost[r]} ${NOMS_RESSOURCES[r]}`);
  return parts.length ? parts.join(', ') : 'gratuit';
}

/**
 * Ce qui manque pour payer un coût, ressource par ressource (vide si tout va bien).
 * @param {object} state
 * @param {object} cost
 * @returns {object} ex. { bois: 5 }
 */
export function missingFor(state, cost) {
  const manque = {};
  for (const r of RESSOURCES) {
    const besoin = cost?.[r] || 0;
    if (besoin > state.resources[r]) manque[r] = besoin - state.resources[r];
  }
  return manque;
}

/**
 * Vrai si la partie a de quoi payer ce coût.
 * @param {object} state
 * @param {object} cost
 * @returns {boolean}
 */
export function canAfford(state, cost) {
  return Object.keys(missingFor(state, cost)).length === 0;
}

/**
 * Phrase « Manque 5 bois et 2 pierre » (chaîne vide si rien ne manque).
 * @param {object} state
 * @param {object} cost
 * @returns {string}
 */
export function missingText(state, cost) {
  const m = missingFor(state, cost);
  const parts = Object.keys(m).map((r) => `${m[r]} ${NOMS_RESSOURCES[r]}`);
  if (!parts.length) return '';
  const liste = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
  return `Manque ${liste}`;
}

function payer(state, cost) {
  for (const r of RESSOURCES) state.resources[r] -= cost?.[r] || 0;
}

// Ajoute des ressources en respectant le stockage ; renvoie ce qui est gagné et perdu.
function encaisser(state, amounts) {
  const cap = storageCap(state);
  const gained = {};
  const lost = {};
  for (const r of RESSOURCES) {
    const a = Math.max(0, Math.floor(amounts?.[r] || 0));
    if (!a) continue;
    const place = Math.max(0, cap - state.resources[r]);
    const g = Math.min(a, place);
    state.resources[r] += g;
    if (g) gained[r] = g;
    if (a - g) lost[r] = a - g;
  }
  return { gained, lost };
}

/**
 * Ajoute une ligne à l'historique court de la partie.
 * @param {object} state
 * @param {string} text
 * @returns {void}
 */
export function addLog(state, text) {
  state.log.push(text);
  if (state.log.length > REGLES.journalMax) state.log.splice(0, state.log.length - REGLES.journalMax);
}

function enPreparation(state) {
  return state.phase === 'prep';
}

const PAS_EN_PREP = 'Possible seulement pendant la préparation.';

// ---------------------------------------------------------------------
//  Lecture de l'état (capacités, logement, statistiques)
// ---------------------------------------------------------------------

/**
 * Bâtiment par identifiant.
 * @param {object} state
 * @param {number} id
 * @returns {object|undefined}
 */
export function getBuilding(state, id) {
  return state.buildings.find((b) => b.id === id);
}

/**
 * Bâtiment (ou ruine) posé sur la tuile (x, z).
 * @param {object} state
 * @param {number} x
 * @param {number} z
 * @returns {object|undefined}
 */
export function buildingAt(state, x, z) {
  return state.buildings.find((b) => b.x === x && b.z === z);
}

/**
 * Nombre de bâtiments debout (non détruits) d'un type.
 * @param {object} state
 * @param {string} type
 * @returns {number}
 */
export function countBuildings(state, type) {
  return state.buildings.filter((b) => b.type === type && !b.destroyed).length;
}

/**
 * Vrai s'il existe au moins un bâtiment debout de ce type.
 * @param {object} state
 * @param {string} type
 * @returns {boolean}
 */
export function hasBuilding(state, type) {
  return state.buildings.some((b) => b.type === type && !b.destroyed);
}

function somme(state, champ) {
  let n = 0;
  for (const b of state.buildings) if (!b.destroyed) n += BATIMENTS[b.type][champ] || 0;
  return n;
}

/**
 * Stockage maximal par ressource (Maison commune + entrepôts + talents). Les ruines ne comptent pas,
 * mais il reste toujours un petit minimum (REGLES.stockageMinimum) : une Maison commune en ruine
 * ne doit pas bloquer la partie (on peut encore ramasser de quoi la reconstruire).
 * @param {object} state
 * @returns {number}
 */
export function storageCap(state) {
  return Math.max(REGLES.stockageMinimum, somme(state, 'stockage') + talentEffects(state.talents).stockage);
}

/**
 * Vrai si la Maison commune est en ruine (le stockage tombe alors au minimum).
 * @param {object} state
 * @returns {boolean}
 */
export function hallInRuins(state) {
  return state.buildings.some((b) => BATIMENTS[b.type].unique && b.destroyed);
}

// Raison lisible quand le stock est plein (la Maison commune en ruine est la cause la plus probable).
function raisonStockPlein(state, cap) {
  if (hallInRuins(state)) return `Stock plein (${cap}) : la Maison commune est en ruine. Reconstruisez-la pour stocker davantage.`;
  return `Stock plein (${cap}). Construisez un entrepôt.`;
}

/**
 * Places de logement (bâtiments debout).
 * @param {object} state
 * @returns {number}
 */
export function housingCapacity(state) {
  return somme(state, 'logement');
}

/**
 * Population totale : villageois + soldats.
 * @param {object} state
 * @returns {number}
 */
export function population(state) {
  return state.villagers + state.soldiers.length;
}

/**
 * Places dans l'armée (3 grâce à la Maison commune + 5 par caserne).
 * @param {object} state
 * @returns {number}
 */
export function soldierCapacity(state) {
  return somme(state, 'soldats');
}

/**
 * Villageois sans travail (villageois − ouvriers placés).
 * @param {object} state
 * @returns {number}
 */
export function freeVillagers(state) {
  let w = 0;
  for (const b of state.buildings) if (!b.destroyed) w += b.workers;
  return Math.max(0, state.villagers - w);
}

/**
 * PV max d'un bâtiment (avec talents).
 * @param {object} state
 * @param {object|string} b bâtiment ou type
 * @returns {number}
 */
export function buildingMaxHp(state, b) {
  return buildingMaxHpFor(typeof b === 'string' ? b : b.type, state.talents);
}

/**
 * Caractéristiques de combat d'un soldat (équipement, entraînement, talents).
 * @param {object} state
 * @param {{ kind:string, equip:number, training:number, hpBonus?:number }} soldier
 * @returns {{ maxHp:number, dmg:number, cadence:number, range:number, speed:number, equipNom:string }}
 */
export function soldierStats(state, soldier) {
  const fx = talentEffects(state.talents);
  const type = TYPES_SOLDATS[soldier.kind] || TYPES_SOLDATS.fantassin;
  const archer = soldier.kind === 'archer';
  const eq = EQUIPEMENTS[archer ? 0 : Math.max(0, Math.min(3, soldier.equip || 0))];
  const baseDmg = archer ? type.degats : eq.degats;
  const tr = soldier.training || 0;
  return {
    maxHp: type.pv + (archer ? 0 : eq.pvBonus) + tr * REGLES.entrainementPv + (soldier.hpBonus || 0),
    dmg: baseDmg * (1 + tr * REGLES.entrainementDegats) * (1 + fx.degatsSoldats),
    cadence: type.cadence,
    range: type.portee,
    speed: type.vitesse,
    equipNom: archer ? 'Arc' : eq.nom,
  };
}

/**
 * Statistiques d'une tour ou d'un piège avec talents (pour le panneau bâtiment).
 * @param {object} state
 * @param {string} type
 * @returns {{ tour: {portee:number,degats:number,cadence:number}|null, piege: {degats:number,rayon:number,recharge:number}|null }}
 */
export function defenseStats(state, type) {
  const def = BATIMENTS[type];
  const fx = talentEffects(state.talents);
  return {
    tour: def?.tour ? { ...def.tour, degats: def.tour.degats * (1 + fx.degatsTours) } : null,
    piege: def?.piege ? {
      ...def.piege,
      degats: def.piege.degats * (1 + fx.degatsPieges),
      recharge: def.piege.recharge * (1 + fx.rechargePieges),
    } : null,
  };
}

/**
 * Production attendue d'un bâtiment à la fin du cycle (ouvriers × production × talents).
 * @param {object} state
 * @param {object} b
 * @returns {{ res: string, amount: number }|null}
 */
export function productionOf(state, b) {
  const def = BATIMENTS[b.type];
  if (!def.production || b.destroyed) return null;
  const fx = talentEffects(state.talents);
  const mult = def.production.res === 'bois' ? 1 + fx.productionBois : 1;
  return { res: def.production.res, amount: Math.round(b.workers * def.production.parOuvrier * mult) };
}

/**
 * Prévision du prochain bilan : production par ressource, nourriture mangée, solde de nourriture.
 * @param {object} state
 * @returns {{ production: object, mange: number, soldeNourriture: number, cap: number }}
 */
export function productionForecast(state) {
  const production = { bois: 0, pierre: 0, nourriture: 0 };
  for (const b of state.buildings) {
    const p = productionOf(state, b);
    if (p) production[p.res] += p.amount;
  }
  const mange = state.villagers * REGLES.mangeParVillageois + state.soldiers.length * REGLES.mangeParSoldat;
  return { production, mange, soldeNourriture: production.nourriture - mange, cap: storageCap(state) };
}

/**
 * Vrai si la partie est perdue : plus aucun bâtiment debout (les pièges ne comptent pas).
 * @param {object} state
 * @returns {boolean}
 */
export function isDefeated(state) {
  return !state.buildings.some((b) => !b.destroyed && BATIMENTS[b.type].ciblable !== false);
}

// ---------------------------------------------------------------------
//  Déblocages
// ---------------------------------------------------------------------

function conditionRemplie(state, deb) {
  if (!deb || deb.depart) return true;
  if (deb.batiment) return state.buildings.some((b) => b.type === deb.batiment);
  if (deb.vague) return state.wave >= deb.vague;
  return false;
}

/**
 * Débloque les bâtiments et actions dont la condition est remplie.
 * @param {object} state
 * @returns {{ kind: 'batiment'|'action', id: string, nom: string }[]} nouveautés (pour le message « Nouveau : … »)
 */
export function checkUnlocks(state) {
  const nouveaux = [];
  for (const type of ORDRE_BATIMENTS) {
    if (state.unlocked.includes(type)) continue;
    if (conditionRemplie(state, BATIMENTS[type].deblocage)) {
      state.unlocked.push(type);
      nouveaux.push({ kind: 'batiment', id: type, nom: BATIMENTS[type].nom });
    }
  }
  for (const id of ORDRE_ACTIONS) {
    if (state.unlockedActions.includes(id)) continue;
    if (conditionRemplie(state, ACTIONS[id].deblocage)) {
      state.unlockedActions.push(id);
      nouveaux.push({ kind: 'action', id, nom: ACTIONS[id].nom });
    }
  }
  for (const n of nouveaux) addLog(state, `Nouveau : ${n.nom}`);
  return nouveaux;
}

function texteDeblocage(deb) {
  if (!deb) return '';
  if (deb.batiment) return `Construisez d’abord : ${BATIMENTS[deb.batiment].nom}.`;
  if (deb.vague) return `Disponible après la vague ${deb.vague}.`;
  return '';
}

// ---------------------------------------------------------------------
//  Actions manuelles
// ---------------------------------------------------------------------

/**
 * Peut-on faire cette action maintenant ?
 * @param {object} state
 * @param {string} id
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canDoAction(state, id) {
  const a = ACTIONS[id];
  if (!a) return fail('Action inconnue.');
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  if (!state.unlockedActions.includes(id)) return fail(texteDeblocage(a.deblocage) || 'Pas encore disponible.', 'verrou');
  if (state.actionsLeft <= 0) return fail("Plus d’action pour ce cycle.", 'actions');
  if (a.gain) {
    const cap = storageCap(state);
    const plein = Object.keys(a.gain).every((r) => state.resources[r] >= cap);
    if (plein) return fail(raisonStockPlein(state, cap), 'plein');
  }
  if (id === 'entrainer') {
    if (!state.soldiers.length) return fail('Aucun soldat à entraîner.');
    if (state.soldiers.every((s) => s.training >= REGLES.entrainementMax)) {
      return fail("Tous les soldats sont déjà entraînés au maximum.");
    }
  }
  return ok();
}

/**
 * Liste des actions pour le panneau « Actions » (toutes, avec la raison si indisponible).
 * @param {object} state
 * @returns {{ id:string, nom:string, description:string, gain:object|null, unlocked:boolean, ok:boolean, reason:string }[]}
 */
export function actionList(state) {
  return ORDRE_ACTIONS.map((id) => {
    const a = ACTIONS[id];
    const c = canDoAction(state, id);
    return {
      id, nom: a.nom, description: a.description, gain: a.gain,
      unlocked: state.unlockedActions.includes(id), ok: c.ok, reason: c.ok ? '' : c.reason,
    };
  });
}

/**
 * Fait une action manuelle (coûte 1 action).
 * @param {object} state
 * @param {string} id 'couper_bois' | 'tailler_pierre' | 'chasser' | 'entrainer' | 'explorer'
 * @returns {{ ok: boolean, reason?: string, message?: string, gained?: object, lost?: object }}
 */
export function doAction(state, id) {
  const c = canDoAction(state, id);
  if (!c.ok) return c;
  const a = ACTIONS[id];
  state.actionsLeft -= 1;
  if (a.gain) {
    const { gained, lost } = encaisser(state, a.gain);
    const morceaux = Object.keys(gained).map((r) => `+${gained[r]} ${NOMS_RESSOURCES[r]}`);
    let message = morceaux.join(', ');
    if (Object.keys(lost).length) message += ' (stock plein, le reste est perdu)';
    return ok({ message, gained, lost });
  }
  if (id === 'entrainer') {
    let n = 0;
    for (const s of state.soldiers) {
      if (s.training < REGLES.entrainementMax) { s.training++; n++; }
    }
    return ok({ message: `${n} soldat${n > 1 ? 's' : ''} mieux entraîné${n > 1 ? 's' : ''}.`, gained: {}, lost: {} });
  }
  if (id === 'explorer') return explorer(state);
  return ok({ message: '', gained: {}, lost: {} });
}

function explorer(state) {
  const rng = stateRng(state);
  const issue = rng.weighted(EXPLORATION);
  if (issue.type === 'ressource') {
    const n = rng.int(issue.min, issue.max);
    const { gained, lost } = encaisser(state, { [issue.res]: n });
    let message = issue.texte.replace('{n}', String(n));
    if (lost[issue.res]) message += ` (stock plein : ${lost[issue.res]} perdu${lost[issue.res] > 1 ? 's' : ''})`;
    addLog(state, message);
    return ok({ message, gained, lost, outcome: issue.type });
  }
  if (issue.type === 'villageois') {
    if (population(state) < housingCapacity(state)) {
      state.villagers += 1;
      addLog(state, issue.texte);
      return ok({ message: issue.texte, gained: {}, lost: {}, outcome: 'villageois' });
    }
    return ok({ message: issue.texteSansPlace, gained: {}, lost: {}, outcome: 'rien' });
  }
  return ok({ message: issue.texte, gained: {}, lost: {}, outcome: 'rien' });
}

// ---------------------------------------------------------------------
//  Construction
// ---------------------------------------------------------------------

/**
 * Le bâtiment peut-il être posé sur la tuile (x, z) ? Vérifie phase, déblocage, terrain,
 * place libre, proximité (forêt/rocher) puis coût. `code` aide l'interface :
 * 'phase' | 'verrou' | 'tuile' | 'occupe' | 'pres' | 'cout'.
 * @param {object} state
 * @param {string} type
 * @param {number} x
 * @param {number} z
 * @returns {{ ok: boolean, reason?: string, code?: string }}
 */
export function canPlace(state, type, x, z) {
  const def = BATIMENTS[type];
  if (!def) return fail('Bâtiment inconnu.');
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  if (def.unique) return fail('Ce bâtiment est unique.', 'verrou');
  if (!state.unlocked.includes(type)) return fail(texteDeblocage(def.deblocage) || 'Pas encore débloqué.', 'verrou');
  const map = getMap(state.chapter);
  if (!inBounds(map, x, z)) return fail('Hors de la carte.', 'tuile');
  const tuile = tileAt(map, x, z);
  const surRoute = tuile === 'road';
  if (def.placement === 'herbe' && tuile !== 'grass') {
    return fail(surRoute ? 'Pas sur la route : choisissez de l’herbe.' : `Impossible sur ${NOMS_TUILES[tuile]}.`, 'tuile');
  }
  if (def.placement === 'route' && !surRoute) return fail('Se pose uniquement sur la route.', 'tuile');
  if (def.placement === 'route_ou_herbe' && !surRoute && tuile !== 'grass') return fail(`Impossible sur ${NOMS_TUILES[tuile]}.`, 'tuile');
  if (surRoute && x === map.spawn.x && z === map.spawn.z) return fail("Trop près de l’arrivée des ennemis.", 'tuile');
  if (x === map.hall.x && z === map.hall.z) return fail('Emplacement occupé.', 'occupe');
  const deja = buildingAt(state, x, z);
  if (deja) {
    return fail(deja.destroyed ? 'Des ruines occupent cet endroit (reconstruisez-les ou déblayez-les).' : 'Emplacement occupé.', 'occupe');
  }
  if (def.pres && !isNearTile(map, x, z, def.pres.tuile, def.pres.distance)) {
    return fail(`Doit être à ${def.pres.distance} cases au plus d${def.pres.tuile === 'rock' ? '’un rocher' : '’une forêt'}.`, 'pres');
  }
  if (!canAfford(state, def.cout)) return fail(missingText(state, def.cout), 'cout');
  return ok();
}

/**
 * Toutes les tuiles où ce bâtiment peut être posé (pour surligner en mode construction).
 * @param {object} state
 * @param {string} type
 * @param {{ ignoreCost?: boolean }} [opts] ignoreCost : montrer les emplacements même sans les moyens
 * @returns {{ x:number, z:number }[]}
 */
export function validTiles(state, type, opts = {}) {
  const map = getMap(state.chapter);
  const out = [];
  for (let z = 0; z < map.h; z++) {
    for (let x = 0; x < map.w; x++) {
      const c = canPlace(state, type, x, z);
      if (c.ok || (opts.ignoreCost && c.code === 'cout')) out.push({ x, z });
    }
  }
  return out;
}

/**
 * Liste du menu « Construire » (dans l'ordre de data.js), avec coût et raison si impossible.
 * @param {object} state
 * @returns {{ type:string, nom:string, description:string, categorie:string, cout:object, coutTexte:string,
 *   unlocked:boolean, affordable:boolean, ok:boolean, reason:string }[]}
 */
export function buildOptions(state) {
  return ORDRE_BATIMENTS.map((type) => {
    const def = BATIMENTS[type];
    const unlocked = state.unlocked.includes(type);
    const affordable = canAfford(state, def.cout);
    let reason = '';
    if (!enPreparation(state)) reason = PAS_EN_PREP;
    else if (!unlocked) reason = texteDeblocage(def.deblocage) || 'Pas encore débloqué.';
    else if (!affordable) reason = missingText(state, def.cout);
    return {
      type, nom: def.nom, description: def.description, categorie: def.categorie,
      cout: { ...def.cout }, coutTexte: costText(def.cout),
      unlocked, affordable, ok: !reason, reason,
    };
  });
}

/**
 * Construit un bâtiment (instantané pendant la préparation).
 * @param {object} state
 * @param {string} type
 * @param {number} x
 * @param {number} z
 * @returns {{ ok: boolean, reason?: string, building?: object, unlocked?: {kind:string,id:string,nom:string}[] }}
 */
export function build(state, type, x, z) {
  const c = canPlace(state, type, x, z);
  if (!c.ok) return c;
  const def = BATIMENTS[type];
  payer(state, def.cout);
  const building = {
    id: state.nextId++,
    type,
    x,
    z,
    hp: buildingMaxHp(state, type),
    workers: 0,
    destroyed: false,
    builtWave: state.wave,
  };
  state.buildings.push(building);
  state.stats.built += 1;
  if (def.tour && state.stats.firstTowerWave == null) state.stats.firstTowerWave = state.wave + 1;
  const unlocked = checkUnlocks(state);
  return ok({ building, unlocked });
}

// Habitants qui n'auraient plus de toit si ce bâtiment disparaissait (0 si tout va bien).
function sansToitApresDemolition(state, b) {
  const def = BATIMENTS[b.type];
  if (b.destroyed || !def.logement) return 0;
  return Math.max(0, population(state) - (housingCapacity(state) - def.logement));
}
function texteSansToit(n) {
  return `Impossible : ${n} habitant${n > 1 ? 's' : ''} n’aurai${n > 1 ? 'ent' : 't'} plus de toit.`;
}

/**
 * Démolit un bâtiment (rend 50 % du coût) ou déblaie des ruines (rien n'est rendu).
 * Refusé si des habitants se retrouveraient sans toit.
 * La Maison commune et le dernier bâtiment debout ne peuvent pas être démolis.
 * @param {object} state
 * @param {number} id
 * @returns {{ ok: boolean, reason?: string, refund?: object, lost?: object }}
 */
export function demolish(state, id) {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  const b = getBuilding(state, id);
  if (!b) return fail('Bâtiment introuvable.');
  const def = BATIMENTS[b.type];
  if (def.unique) return fail(`${def.nom} ne peut pas être démolie.`);
  if (!b.destroyed && def.ciblable !== false) {
    const debout = state.buildings.filter((o) => !o.destroyed && BATIMENTS[o.type].ciblable !== false);
    if (debout.length <= 1) return fail("Impossible : c’est votre dernier bâtiment debout.");
  }
  const sansToit = sansToitApresDemolition(state, b);
  if (sansToit > 0) return fail(texteSansToit(sansToit));
  state.buildings.splice(state.buildings.indexOf(b), 1);
  if (b.destroyed) return ok({ refund: {}, lost: {}, message: 'Les ruines sont déblayées.' });
  const rendu = {};
  for (const r of RESSOURCES) {
    const v = Math.floor((def.cout[r] || 0) * REGLES.remboursementDemolition);
    if (v) rendu[r] = v;
  }
  const { gained, lost } = encaisser(state, rendu);
  const total = Object.values(gained).reduce((n, v) => n + v, 0);
  const message = total
    ? `Démoli : ${costText(gained)} récupéré${total > 1 ? 's' : ''}.`
    : 'Démoli (stock plein : rien n’est récupéré).';
  return ok({ refund: gained, lost, message });
}

/**
 * Reconstruit une ruine pour le coût complet (PV au maximum, sans ouvriers).
 * @param {object} state
 * @param {number} id
 * @returns {{ ok: boolean, reason?: string, building?: object }}
 */
export function rebuild(state, id) {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  const b = getBuilding(state, id);
  if (!b) return fail('Bâtiment introuvable.');
  if (!b.destroyed) return fail("Ce bâtiment n’est pas en ruine.");
  const def = BATIMENTS[b.type];
  if (!canAfford(state, def.cout)) return fail(missingText(state, def.cout), 'cout');
  payer(state, def.cout);
  b.destroyed = false;
  b.hp = buildingMaxHp(state, b);
  b.workers = 0;
  return ok({ building: b });
}

/**
 * Tout ce qu'affiche le panneau d'un bâtiment sélectionné.
 * @param {object} state
 * @param {number} id
 * @returns {{ id:number, type:string, nom:string, description:string, categorie:string, x:number, z:number,
 *   hp:number, maxHp:number, destroyed:boolean, workers:number, emplois:number,
 *   production: { res:string, parOuvrier:number, actuelle:number, avecUnDePlus:number }|null,
 *   logement:number, stockage:number, soldats:number,
 *   tour: {portee:number,degats:number,cadence:number}|null, piege: {degats:number,rayon:number,recharge:number}|null,
 *   bloqueRoute:boolean, demolir: { ok:boolean, reason?:string, remboursement?:object },
 *   reconstruire: { ok:boolean, reason?:string, cout:object, coutTexte:string }|null }|null}
 */
export function buildingInfo(state, id) {
  const b = getBuilding(state, id);
  if (!b) return null;
  const def = BATIMENTS[b.type];
  const fx = talentEffects(state.talents);
  const mult = def.production?.res === 'bois' ? 1 + fx.productionBois : 1;
  const prod = def.production ? {
    res: def.production.res,
    parOuvrier: def.production.parOuvrier * mult,
    actuelle: b.destroyed ? 0 : Math.round(b.workers * def.production.parOuvrier * mult),
    avecUnDePlus: Math.round(Math.min(def.emplois, b.workers + 1) * def.production.parOuvrier * mult),
  } : null;
  const defense = defenseStats(state, b.type);
  let demolir;
  if (def.unique) demolir = fail(`${def.nom} ne peut pas être démolie.`);
  else if (!enPreparation(state)) demolir = fail(PAS_EN_PREP, 'phase');
  else if (b.destroyed) demolir = ok({ remboursement: {} });
  else {
    const debout = state.buildings.filter((o) => !o.destroyed && BATIMENTS[o.type].ciblable !== false);
    const sansToit = sansToitApresDemolition(state, b);
    if (def.ciblable !== false && debout.length <= 1) demolir = fail("Impossible : c’est votre dernier bâtiment debout.");
    else if (sansToit > 0) demolir = fail(texteSansToit(sansToit));
    else {
      const remboursement = {};
      for (const r of RESSOURCES) {
        const v = Math.floor((def.cout[r] || 0) * REGLES.remboursementDemolition);
        if (v) remboursement[r] = v;
      }
      demolir = ok({ remboursement });
    }
  }
  let reconstruire = null;
  if (b.destroyed) {
    const c = !enPreparation(state) ? fail(PAS_EN_PREP, 'phase')
      : canAfford(state, def.cout) ? ok() : fail(missingText(state, def.cout), 'cout');
    reconstruire = { ...c, cout: { ...def.cout }, coutTexte: costText(def.cout) };
  }
  return {
    id: b.id, type: b.type, nom: def.nom, description: def.description, categorie: def.categorie,
    x: b.x, z: b.z, hp: b.hp, maxHp: buildingMaxHp(state, b), destroyed: !!b.destroyed,
    workers: b.workers, emplois: def.emplois, production: prod,
    logement: def.logement, stockage: def.stockage, soldats: def.soldats,
    tour: defense.tour, piege: defense.piege,
    bloqueRoute: !!def.bloqueRoute && tileAt(getMap(state.chapter), b.x, b.z) === 'road',
    demolir, reconstruire,
  };
}

// ---------------------------------------------------------------------
//  Villageois au travail
// ---------------------------------------------------------------------

/**
 * Ajoute (+1) ou retire (−1) un ouvrier dans un bâtiment de production.
 * @param {object} state
 * @param {number} buildingId
 * @param {number} delta +1 ou -1
 * @returns {{ ok: boolean, reason?: string, workers?: number }}
 */
export function assign(state, buildingId, delta) {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  const b = getBuilding(state, buildingId);
  if (!b) return fail('Bâtiment introuvable.');
  const def = BATIMENTS[b.type];
  if (b.destroyed) return fail('Ce bâtiment est en ruine.');
  if (!def.emplois) return fail("Personne ne peut travailler ici.");
  if (delta > 0) {
    if (b.workers >= def.emplois) return fail(`Plus de place : ${b.workers}/${def.emplois}.`);
    if (freeVillagers(state) < 1) return fail('Aucun villageois libre.');
    b.workers += 1;
  } else if (delta < 0) {
    if (b.workers <= 0) return fail('Personne ne travaille ici.');
    b.workers -= 1;
  } else {
    return fail('Rien à changer.');
  }
  return ok({ workers: b.workers });
}

// Retire des ouvriers si des villageois sont partis (les derniers bâtiments d'abord).
function ajusterOuvriers(state) {
  let trop = state.buildings.reduce((n, b) => n + (b.destroyed ? 0 : b.workers), 0) - state.villagers;
  for (let i = state.buildings.length - 1; i >= 0 && trop > 0; i--) {
    const b = state.buildings[i];
    const r = Math.min(trop, b.workers);
    b.workers -= r;
    trop -= r;
  }
  for (const b of state.buildings) if (b.destroyed) b.workers = 0;
}

// ---------------------------------------------------------------------
//  Armée : recrues, équipement, archers, ralliement
// ---------------------------------------------------------------------

/**
 * Coût d'une recrue (nourriture, talent « Rations », + bois pour un archer).
 * @param {object} state
 * @param {'fantassin'|'archer'} [kind]
 * @returns {object}
 */
export function recruitCost(state, kind = 'fantassin') {
  const fx = talentEffects(state.talents);
  const cout = { ...REGLES.coutRecrue };
  if (cout.nourriture) cout.nourriture = Math.max(0, cout.nourriture - fx.reductionRecrue);
  const extra = TYPES_SOLDATS[kind]?.cout || {};
  for (const r of RESSOURCES) if (extra[r]) cout[r] = (cout[r] || 0) + extra[r];
  return cout;
}

/**
 * Peut-on recruter maintenant ? (caserne, atelier pour un archer, place, villageois libre, coût)
 * @param {object} state
 * @param {'fantassin'|'archer'} [kind]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canRecruit(state, kind = 'fantassin') {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  if (!TYPES_SOLDATS[kind]) return fail('Type de soldat inconnu.');
  if (!state.buildings.some((b) => !b.destroyed && BATIMENTS[b.type].permetRecrutement)) return fail('Il faut une caserne.', 'verrou');
  const req = TYPES_SOLDATS[kind].requiert;
  if (req && !hasBuilding(state, req)) return fail(`Il faut un ${BATIMENTS[req].nom.toLowerCase()}.`, 'verrou');
  const cap = soldierCapacity(state);
  if (state.soldiers.length >= cap) return fail(`Plus de place dans l’armée (${state.soldiers.length}/${cap}).`);
  if (freeVillagers(state) < 1) return fail('Aucun villageois libre.');
  const cout = recruitCost(state, kind);
  if (!canAfford(state, cout)) return fail(missingText(state, cout), 'cout');
  return ok();
}

/**
 * Recrute un soldat : un villageois libre devient fantassin (ou archer).
 * @param {object} state
 * @param {'fantassin'|'archer'} [kind]
 * @returns {{ ok: boolean, reason?: string, soldier?: object }}
 */
export function recruit(state, kind = 'fantassin') {
  const c = canRecruit(state, kind);
  if (!c.ok) return c;
  payer(state, recruitCost(state, kind));
  const fx = talentEffects(state.talents);
  const soldier = {
    id: state.nextId++,
    kind,
    equip: 0,
    training: Math.min(REGLES.entrainementMax, fx.entrainementRecrues),
    hpBonus: 0,
  };
  state.villagers -= 1;
  state.soldiers.push(soldier);
  state.stats.recruited += 1;
  return ok({ soldier });
}

/**
 * Peut-on équiper ce soldat de ce niveau d'équipement ?
 * @param {object} state
 * @param {number} soldierId
 * @param {number} tier 1 Gourdin, 2 Lance, 3 Lance et bouclier
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canEquip(state, soldierId, tier) {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  const s = state.soldiers.find((x) => x.id === soldierId);
  if (!s) return fail('Soldat introuvable.');
  const eq = EQUIPEMENTS[tier];
  if (!eq || tier < 1) return fail('Équipement inconnu.');
  if (s.kind !== 'fantassin') return fail('Les archers gardent leur arc.');
  if (s.equip >= tier) return fail('Déjà équipé ainsi ou mieux.');
  if (eq.requiert && !hasBuilding(state, eq.requiert)) return fail(`Il faut un ${BATIMENTS[eq.requiert].nom.toLowerCase()}.`, 'verrou');
  if (!canAfford(state, eq.cout)) return fail(missingText(state, eq.cout), 'cout');
  return ok();
}

/**
 * Équipe un fantassin (le prix est celui du niveau visé, sans reprise de l'ancien).
 * @param {object} state
 * @param {number} soldierId
 * @param {number} tier 1 à 3
 * @returns {{ ok: boolean, reason?: string }}
 */
export function equip(state, soldierId, tier) {
  const c = canEquip(state, soldierId, tier);
  if (!c.ok) return c;
  const s = state.soldiers.find((x) => x.id === soldierId);
  payer(state, EQUIPEMENTS[tier].cout);
  s.equip = tier;
  return ok({ soldier: s });
}

/**
 * « Équiper tous » : équipe chaque fantassin moins bien équipé, tant qu'on peut payer.
 * @param {object} state
 * @param {number} tier
 * @returns {{ ok: boolean, reason?: string, count?: number }}
 */
export function equipAll(state, tier) {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  const cibles = state.soldiers.filter((s) => s.kind === 'fantassin' && s.equip < tier);
  if (!cibles.length) return fail('Tous les fantassins ont déjà cet équipement.');
  let count = 0;
  let premiereRaison = '';
  for (const s of cibles) {
    const r = equip(state, s.id, tier);
    if (r.ok) count++;
    else if (!premiereRaison) premiereRaison = r.reason;
  }
  if (!count) return fail(premiereRaison || 'Impossible.');
  return ok({ count, reason: premiereRaison });
}

/**
 * Forme un archer à partir d'un fantassin (atelier + bois). Il garde son entraînement.
 * @param {object} state
 * @param {number} soldierId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function convertToArcher(state, soldierId) {
  if (!enPreparation(state)) return fail(PAS_EN_PREP, 'phase');
  const s = state.soldiers.find((x) => x.id === soldierId);
  if (!s) return fail('Soldat introuvable.');
  if (s.kind === 'archer') return fail("C’est déjà un archer.");
  const t = TYPES_SOLDATS.archer;
  if (t.requiert && !hasBuilding(state, t.requiert)) return fail(`Il faut un ${BATIMENTS[t.requiert].nom.toLowerCase()}.`, 'verrou');
  if (!canAfford(state, t.cout)) return fail(missingText(state, t.cout), 'cout');
  payer(state, t.cout);
  s.kind = 'archer';
  s.equip = 0;
  return ok({ soldier: s });
}

/**
 * Déplace le drapeau de ralliement de l'armée (préparation). Pas dans l'eau ni sur un rocher.
 * @param {object} state
 * @param {{ x:number, z:number }} pos tuile
 * @returns {{ ok: boolean, reason?: string }}
 */
export function setRally(state, pos) {
  const map = getMap(state.chapter);
  const x = Math.round(pos.x);
  const z = Math.round(pos.z);
  const r = rallyCheck(map, x, z);
  if (!r.ok) return r;
  state.rally = { x, z };
  return ok();
}

/**
 * Vérifie qu'une tuile convient comme point de ralliement.
 * @param {object} map
 * @param {number} x
 * @param {number} z
 * @returns {{ ok: boolean, reason?: string }}
 */
export function rallyCheck(map, x, z) {
  if (!inBounds(map, x, z)) return fail('Hors de la carte.');
  if (!isWalkable(map, x, z)) return fail(tileAt(map, x, z) === 'water' ? "Les soldats ne vont pas dans l’eau." : 'Les soldats ne peuvent pas aller sur les rochers.');
  return ok();
}

// ---------------------------------------------------------------------
//  Vagues : aperçu pour l'interface
// ---------------------------------------------------------------------

/**
 * Composition d'une vague (indice 0 = vague 1) pour l'aperçu « Prochaine vague ».
 * @param {number} waveIndex
 * @returns {{ numero:number, total:number, groupes:{ type:string, nom:string, count:number }[] }|null}
 */
export function wavePreview(waveIndex) {
  const v = VAGUES[waveIndex];
  if (!v) return null;
  const parType = new Map();
  for (const g of v.groupes) parType.set(g.type, (parType.get(g.type) || 0) + g.count);
  const groupes = [...parType].map(([type, count]) => ({ type, nom: ENNEMIS[type].nom, count }));
  return { numero: waveIndex + 1, total: groupes.reduce((n, g) => n + g.count, 0), groupes };
}

// ---------------------------------------------------------------------
//  Fin de cycle (bilan)
// ---------------------------------------------------------------------

/**
 * Bilan de fin de cycle, après une vague gagnée (appelé par finishBattle) :
 * production, repas, croissance, réparations, XP et missions, actions, déblocages.
 * La phase passe à 'report' (ou 'victory' après la dernière vague). L'appelant sauvegarde.
 * @param {object} state (state.wave déjà augmenté de 1)
 * @param {object|null} [meta] progression du royaume, reçoit l'XP et les récompenses
 * @param {{ waveNumber?:number, kills?:number, trapKills?:number, soldiersLost?:number,
 *   buildingsLost?:number, buildingsLostTypes?:string[], retreated?:boolean, won?:boolean }} [ctx]
 * @returns {object} rapport (aussi rangé dans state.lastReport)
 */
export function endOfCycle(state, meta = null, ctx = {}) {
  const fx = talentEffects(state.talents);
  const waveNumber = ctx.waveNumber ?? state.wave;
  const report = {
    ok: true,
    result: 'won',
    wave: waveNumber,
    wavesTotal: state.wavesTotal,
    retreated: !!ctx.retreated,
    kills: ctx.kills || 0,
    trapKills: ctx.trapKills || 0,
    soldiersLost: ctx.soldiersLost || 0,
    buildingsLost: ctx.buildingsLost || 0,
    buildingsLostTypes: ctx.buildingsLostTypes || [],
    production: {},
    food: { eaten: 0, missing: 0 },
    population: { before: population(state), after: 0, born: 0, left: 0, deserted: 0 },
    repaired: 0,
    xp: null,
    missions: [],
    unlocked: [],
    messages: [],
  };
  if (report.retreated) report.messages.push('Les ennemis se sont retirés.');

  // 1. Production des bâtiments debout, plafonnée par le stockage.
  const produit = { bois: 0, pierre: 0, nourriture: 0 };
  for (const b of state.buildings) {
    const p = productionOf(state, b);
    if (p) produit[p.res] += p.amount;
  }
  const { gained, lost } = encaisser(state, produit);
  for (const r of RESSOURCES) {
    report.production[r] = { produced: produit[r], gained: gained[r] || 0, lost: lost[r] || 0 };
    if (lost[r]) report.messages.push(`Stock de ${NOMS_RESSOURCES[r]} plein : ${lost[r]} perdu${lost[r] > 1 ? 's' : ''}.`);
  }
  if (Object.keys(lost).length && hallInRuins(state)) {
    report.messages.push(`La Maison commune est en ruine : le stock est limité à ${storageCap(state)}. Reconstruisez-la.`);
  }

  // 2. Repas : 1 nourriture par villageois et par soldat.
  const mange = state.villagers * REGLES.mangeParVillageois + state.soldiers.length * REGLES.mangeParSoldat;
  report.food.eaten = Math.min(mange, state.resources.nourriture);
  if (state.resources.nourriture >= mange) {
    state.resources.nourriture -= mange;
  } else {
    const manque = mange - state.resources.nourriture;
    report.food.missing = manque;
    state.resources.nourriture = 0;
    const departs = Math.max(1, Math.floor(manque / REGLES.manqueParDepart));
    for (let i = 0; i < departs; i++) {
      if (state.villagers > 0) { state.villagers--; report.population.left++; } else if (state.soldiers.length) { state.soldiers.pop(); report.population.deserted++; }
    }
    state.stats.villagersLost += report.population.left;
    ajusterOuvriers(state);
    report.messages.push(`Famine : il manquait ${manque} nourriture.`);
    if (report.population.left) report.messages.push(`${report.population.left} villageois ${report.population.left > 1 ? 'sont partis' : 'est parti'}.`);
    if (report.population.deserted) report.messages.push(`${report.population.deserted} soldat${report.population.deserted > 1 ? 's ont' : ' a'} déserté.`);
  }

  // 2 bis. Sans toit (logement détruit pendant la bataille) : quelques villageois s'en vont à chaque bilan.
  report.population.homeless = 0;
  for (let i = 0; i < REGLES.departsSansToit && population(state) > housingCapacity(state) && state.villagers > 0; i++) {
    state.villagers--;
    report.population.left++;
    report.population.homeless++;
    state.stats.villagersLost += 1;
  }
  if (report.population.homeless) {
    ajusterOuvriers(state);
    report.messages.push(`Sans toit, ${report.population.homeless} villageois ${report.population.homeless > 1 ? 'sont partis' : 'est parti'} : reconstruisez les logements.`);
  }

  // 3. Croissance : s'il reste de la place et assez à manger.
  const croissance = REGLES.croissanceParCycle + fx.croissance;
  for (let i = 0; i < croissance; i++) {
    if (population(state) < housingCapacity(state) && state.resources.nourriture >= REGLES.nourritureMinCroissance) {
      state.villagers++;
      report.population.born++;
    }
  }
  state.stats.born += report.population.born;
  if (report.population.born === 0 && population(state) >= housingCapacity(state)) {
    report.messages.push('Plus de place pour loger de nouveaux habitants : construisez des huttes.');
  }
  report.population.after = population(state);

  // 4. Réparations gratuites des bâtiments abîmés (pas des ruines).
  for (const b of state.buildings) {
    if (b.destroyed) continue;
    const max = buildingMaxHp(state, b);
    if (b.hp < max) { b.hp = max; report.repaired++; }
  }

  // 5. XP du royaume, victoire, missions.
  const niveauAvant = meta ? meta.level : 0;
  const xpVague = waveXp(waveNumber, report.kills);
  addXp(meta, xpVague);
  let xpVictoire = 0;
  if (meta) meta.bestWave = Math.max(meta.bestWave, state.wave);
  if (state.wave >= state.wavesTotal) {
    state.phase = 'victory';
    report.result = 'victory';
    xpVictoire = META.xpVictoire;
    addXp(meta, xpVictoire);
    if (meta && !meta.chaptersWon.includes(state.chapter)) meta.chaptersWon.push(state.chapter);
    report.messages.push('Le chapitre est gagné : le royaume tient bon !');
  } else {
    state.phase = 'report';
  }
  report.missions = checkMissions(state, meta, { ...ctx, won: true, waveNumber });
  const xpMissions = report.missions.filter((m) => m.rewarded).reduce((n, m) => n + (m.recompense.xp || 0), 0);
  report.xp = {
    gained: xpVague + xpVictoire + xpMissions, // total gagné à ce bilan
    wave: xpVague,
    victory: xpVictoire,
    missions: xpMissions,
    total: meta ? meta.xp : null,
    level: meta ? meta.level : null,
    levelUp: meta ? meta.level > niveauAvant : false,
    levelsGained: meta ? meta.level - niveauAvant : 0,
    talentPoints: meta ? meta.talentPoints : null,
  };

  // 6. Les actions reviennent.
  state.actionsMax = DEPART.actions + fx.actions;
  state.actionsLeft = state.actionsMax;

  // 7. Déblocages (ex. le champ après la vague 3).
  report.unlocked = checkUnlocks(state);

  addLog(state, report.result === 'victory'
    ? `Vague ${waveNumber} repoussée : victoire !`
    : `Vague ${waveNumber} repoussée (${report.kills} ennemi${report.kills > 1 ? 's' : ''} tué${report.kills > 1 ? 's' : ''}, ${report.soldiersLost} soldat${report.soldiersLost > 1 ? 's' : ''} perdu${report.soldiersLost > 1 ? 's' : ''}).`);
  state.lastReport = report;
  return report;
}

/**
 * Après le bilan, retour à la préparation de la vague suivante (bouton « Continuer »).
 * L'interface sauvegarde juste après.
 * @param {object} state
 * @returns {{ ok: boolean, reason?: string }}
 */
export function continueToPrep(state) {
  if (state.phase !== 'report') return fail("Il n’y a pas de bilan en cours.");
  state.phase = 'prep';
  return ok();
}
