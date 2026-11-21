// Création d'une partie, sauvegarde et chargement.
// L'état de partie est un simple objet JSON : on peut le copier, le sauver, le recharger.

import {
  DEPART, SAUVEGARDE, OPTIONS_DEFAUT, CHAPITRES, BATIMENTS, RESSOURCES, ACTIONS, ORDRE_ACTIONS,
  TYPES_SOLDATS, REGLES, MISSIONS,
} from './data.js';
import { getMap, inBounds, isWalkable } from './map.js';
import { normalizeSeed, mixSeeds } from './rng.js';
import { newMeta, normalizeMeta, talentEffects, buildingMaxHpFor } from './meta.js';

export const STATE_VERSION = 1;

const PHASES = ['prep', 'battle', 'report', 'defeat', 'victory'];

function nouvellesStats() {
  return {
    kills: 0,            // ennemis tués (toutes vagues)
    trapKills: 0,        // ennemis tués par les pièges
    soldiersLost: 0,     // soldats morts
    buildingsLost: 0,    // bâtiments détruits
    recruited: 0,        // recrues
    built: 0,            // bâtiments construits
    villagersLost: 0,    // villageois partis (famine)
    born: 0,             // nouveaux villageois
    firstTowerWave: null, // numéro de la vague qui suivait la 1re tour construite (mission)
  };
}

/**
 * Nouvelle partie du chapitre 1. Les réserves et talents du royaume sont appliqués.
 * @param {object} [meta] progression du royaume (facultatif)
 * @param {{ seed?: number|string, chapter?: number }} [options] l'interface passe par ex. `{ seed: Date.now() }`
 * @returns {object} état de partie (voir SPEC §3)
 */
export function newGame(meta = null, options = {}) {
  const m = meta || newMeta();
  const chapter = options.chapter ?? 1;
  const map = getMap(chapter);
  const seed = normalizeSeed(options.seed ?? DEPART.graine);
  const fx = talentEffects(m.talents);
  const cap = BATIMENTS.maison_commune.stockage + fx.stockage;
  const resources = {};
  for (const r of RESSOURCES) {
    resources[r] = Math.min(cap, (DEPART.ressources[r] || 0) + (m.reserves?.[r] || 0));
  }
  let nextId = 1;
  const hall = {
    id: nextId++,
    type: 'maison_commune',
    x: map.hall.x,
    z: map.hall.z,
    hp: buildingMaxHpFor('maison_commune', m.talents),
    workers: 0,
    destroyed: false,
    builtWave: 0,
  };
  const soldiers = DEPART.soldats.map((s) => ({
    id: nextId++,
    kind: s.kind,
    equip: s.equip,
    training: 0,
    hpBonus: 0,
  }));
  const actionsMax = DEPART.actions + fx.actions;
  return {
    version: STATE_VERSION,
    seed,
    rngState: mixSeeds(seed, 0x5eed),
    chapter,
    wave: 0,
    wavesTotal: CHAPITRES[chapter]?.vagues ?? 10,
    phase: 'prep',
    resources,
    villagers: DEPART.villageois,
    soldiers,
    actionsLeft: actionsMax,
    actionsMax,
    buildings: [hall],
    unlocked: DEPART.debloques.filter((t) => BATIMENTS[t]),
    unlockedActions: ORDRE_ACTIONS.filter((a) => ACTIONS[a].deblocage?.depart),
    rally: { ...map.defaultRally },
    talents: [...m.talents],
    stats: nouvellesStats(),
    missionsDone: [],
    lastReport: null,
    log: [],
    nextId,
  };
}

/**
 * Copie profonde d'un état (pour simuler « et si… » sans toucher à la partie).
 * @param {object} state
 * @returns {object}
 */
export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Transforme l'état en texte JSON pour la sauvegarde.
 * @param {object} state
 * @returns {string}
 */
export function serialize(state) {
  return JSON.stringify(state);
}

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);
const estObjet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Un bilan sauvegardé n'est gardé que s'il a la forme attendue (sinon l'écran du bilan planterait).
function bilanValide(r, phase) {
  if (!estObjet(r) || !Number.isInteger(r.wave) || !estNombre(r.kills)) return false;
  if (!estNombre(r.soldiersLost) || !estNombre(r.buildingsLost)) return false;
  if (r.messages !== undefined && !Array.isArray(r.messages)) return false;
  if (phase === 'defeat') return true; // la défaite n'a ni production ni repas
  if (!estObjet(r.production) || !estObjet(r.food) || !estObjet(r.population)) return false;
  for (const res of RESSOURCES) {
    const p = r.production[res];
    if (!estObjet(p) || !estNombre(p.produced) || !estNombre(p.gained) || !estNombre(p.lost)) return false;
  }
  return estNombre(r.food.eaten) && estNombre(r.food.missing) && estNombre(r.population.before) && estNombre(r.population.after);
}

/**
 * Relit un état sauvegardé (texte JSON ou objet). Répare ce qui peut l'être, refuse le reste.
 * Une partie sauvegardée pendant une bataille reprend à la préparation de cette vague.
 * @param {string|object} data
 * @returns {object|null} état valide, ou null si la sauvegarde est illisible
 */
export function deserialize(data) {
  let raw = data;
  if (typeof data === 'string') {
    try { raw = JSON.parse(data); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object' || raw.version !== STATE_VERSION) return null;
  if (!Array.isArray(raw.buildings) || !Array.isArray(raw.soldiers) || !raw.resources) return null;
  if (!Number.isInteger(raw.wave) || !estNombre(raw.villagers)) return null;

  const base = newGame(null, { seed: raw.seed ?? DEPART.graine, chapter: raw.chapter ?? 1 });
  const map = getMap(base.chapter);
  const s = { ...base };
  s.seed = normalizeSeed(raw.seed ?? DEPART.graine);
  s.rngState = estNombre(raw.rngState) ? raw.rngState >>> 0 : base.rngState;
  s.wavesTotal = Number.isInteger(raw.wavesTotal) && raw.wavesTotal > 0 ? raw.wavesTotal : base.wavesTotal;
  s.wave = Math.max(0, Math.min(s.wavesTotal, raw.wave)); // jamais au-delà de la dernière vague
  s.phase = PHASES.includes(raw.phase) ? raw.phase : 'prep';
  if (s.phase === 'battle') s.phase = 'prep'; // les batailles ne sont pas sauvegardées
  s.resources = {};
  for (const r of RESSOURCES) s.resources[r] = estNombre(raw.resources[r]) ? Math.max(0, Math.floor(raw.resources[r])) : 0;
  s.villagers = Math.max(0, Math.floor(raw.villagers));
  s.talents = Array.isArray(raw.talents) ? raw.talents.filter((t) => typeof t === 'string') : [];

  // Bâtiments : dans la carte, un seul par case, identifiants uniques, une seule Maison commune (à sa place).
  let maxId = 0;
  const cases = new Set();
  const ids = new Set();
  s.buildings = raw.buildings
    .filter((b) => {
      if (!b || !BATIMENTS[b.type] || !Number.isInteger(b.id) || !inBounds(map, b.x, b.z)) return false;
      const unique = !!BATIMENTS[b.type].unique;
      const surMaison = b.x === map.hall.x && b.z === map.hall.z;
      if (unique !== surMaison) return false;
      const cle = `${b.x},${b.z}`;
      if (cases.has(cle) || ids.has(b.id)) return false;
      cases.add(cle);
      ids.add(b.id);
      return true;
    })
    .map((b) => {
      maxId = Math.max(maxId, b.id);
      const max = buildingMaxHpFor(b.type, s.talents);
      const destroyed = !!b.destroyed;
      return {
        id: b.id,
        type: b.type,
        x: b.x,
        z: b.z,
        hp: destroyed ? 0 : Math.min(max, estNombre(b.hp) ? Math.max(1, Math.round(b.hp)) : max),
        workers: destroyed ? 0 : Math.max(0, Math.min(BATIMENTS[b.type].emplois, Math.floor(b.workers || 0))),
        destroyed,
        builtWave: Number.isInteger(b.builtWave) ? b.builtWave : 0,
      };
    });
  if (s.buildings.length === 0) return null;
  if (!s.buildings.some((b) => BATIMENTS[b.type].unique)) {
    // Maison commune illisible : on la remet debout plutôt que de perdre la partie.
    maxId += 1;
    s.buildings.unshift({ ...base.buildings[0], id: maxId });
    ids.add(maxId);
  }

  s.soldiers = raw.soldiers
    .filter((x) => {
      if (!x || !TYPES_SOLDATS[x.kind] || !Number.isInteger(x.id) || ids.has(x.id)) return false;
      ids.add(x.id);
      return true;
    })
    .map((x) => {
      maxId = Math.max(maxId, x.id);
      return {
        id: x.id,
        kind: x.kind,
        equip: Math.max(0, Math.min(3, Math.floor(x.equip || 0))),
        training: Math.max(0, Math.min(REGLES.entrainementMax, Math.floor(x.training || 0))),
        hpBonus: estNombre(x.hpBonus) ? x.hpBonus : 0,
      };
    });

  // Pas plus d'ouvriers que de villageois.
  let trop = s.buildings.reduce((n, b) => n + b.workers, 0) - s.villagers;
  for (let i = s.buildings.length - 1; i >= 0 && trop > 0; i--) {
    const retire = Math.min(trop, s.buildings[i].workers);
    s.buildings[i].workers -= retire;
    trop -= retire;
  }

  s.actionsMax = Number.isInteger(raw.actionsMax) && raw.actionsMax > 0 ? raw.actionsMax : base.actionsMax;
  s.actionsLeft = Number.isInteger(raw.actionsLeft) ? Math.max(0, Math.min(s.actionsMax, raw.actionsLeft)) : s.actionsMax;
  s.unlocked = Array.isArray(raw.unlocked) ? raw.unlocked.filter((t) => BATIMENTS[t]) : base.unlocked;
  for (const t of base.unlocked) if (!s.unlocked.includes(t)) s.unlocked.push(t);
  s.unlockedActions = Array.isArray(raw.unlockedActions) ? raw.unlockedActions.filter((a) => ACTIONS[a]) : base.unlockedActions;
  for (const a of base.unlockedActions) if (!s.unlockedActions.includes(a)) s.unlockedActions.push(a);
  const rally = raw.rally;
  s.rally = rally && inBounds(map, rally.x, rally.z) && isWalkable(map, rally.x, rally.z)
    ? { x: rally.x, z: rally.z } : { ...map.defaultRally };
  // Statistiques : uniquement des nombres (une valeur abîmée repart de 0).
  s.stats = nouvellesStats();
  const rawStats = estObjet(raw.stats) ? raw.stats : {};
  for (const k of Object.keys(s.stats)) {
    if (k === 'firstTowerWave') s.stats[k] = Number.isInteger(rawStats[k]) ? rawStats[k] : null;
    else s.stats[k] = estNombre(rawStats[k]) ? Math.max(0, rawStats[k]) : 0;
  }
  const missionIds = new Set(MISSIONS.map((m) => m.id));
  s.missionsDone = Array.isArray(raw.missionsDone) ? raw.missionsDone.filter((id) => missionIds.has(id)) : [];
  s.lastReport = bilanValide(raw.lastReport, s.phase) ? raw.lastReport : null;
  // Fin de chapitre atteinte sans écran de victoire lisible : la partie est gagnée.
  if (s.wave >= s.wavesTotal && (s.phase === 'prep' || s.phase === 'report')) s.phase = 'victory';
  s.log = Array.isArray(raw.log) ? raw.log.filter((l) => typeof l === 'string').slice(-REGLES.journalMax) : [];
  s.nextId = Math.max(Number.isInteger(raw.nextId) ? raw.nextId : 0, maxId + 1);
  return s;
}

/**
 * Enveloppe de stockage sûre : toutes les opérations sont protégées (try/catch).
 * Si le stockage est indisponible, une copie en mémoire prend le relais pour la session,
 * et `failed` passe à vrai (l'interface affiche une fois « sauvegarde indisponible »).
 * @param {{ getItem(k:string):string|null, setItem(k:string,v:string):void, removeItem(k:string):void }|null} [backend]
 *   par exemple `window.localStorage` (peut lever une exception rien qu'en y accédant : passer une fonction qui le renvoie convient aussi)
 * @returns {{ available:boolean, failed:boolean, getJSON(key:string):any, setJSON(key:string, value:any):boolean,
 *   getText(key:string):string|null, setText(key:string, text:string):boolean, remove(key:string):boolean }}
 */
export function createStorage(backend = null) {
  const memoire = new Map();
  let be = null;
  try { be = typeof backend === 'function' ? backend() : backend; } catch { be = null; }
  const store = {
    available: false,
    failed: false,
    getText(key) {
      if (store.available) {
        try {
          const v = be.getItem(key);
          if (v !== null && v !== undefined) return v;
        } catch { store.failed = true; }
      }
      return memoire.has(key) ? memoire.get(key) : null;
    },
    setText(key, text) {
      memoire.set(key, text);
      if (!store.available) return false;
      try { be.setItem(key, text); return true; } catch { store.failed = true; return false; }
    },
    remove(key) {
      memoire.delete(key);
      if (!store.available) return false;
      try { be.removeItem(key); return true; } catch { store.failed = true; return false; }
    },
    getJSON(key) {
      const t = store.getText(key);
      if (t === null) return null;
      try { return JSON.parse(t); } catch { return null; }
    },
    setJSON(key, value) {
      let t;
      try { t = JSON.stringify(value); } catch { return false; }
      return store.setText(key, t);
    },
  };
  if (be && typeof be.getItem === 'function' && typeof be.setItem === 'function') {
    try {
      const k = '__royaume_test__';
      be.setItem(k, '1');
      be.removeItem(k);
      store.available = true;
    } catch {
      store.failed = true;
    }
  } else if (backend) {
    store.failed = true;
  }
  return store;
}

/**
 * Sauvegarde la partie. Pendant une bataille, on garde la préparation qui la précède.
 * @param {ReturnType<typeof createStorage>} storage
 * @param {object} state
 * @returns {boolean} vrai si écrit dans le stockage durable
 */
export function saveGame(storage, state) {
  const copie = state.phase === 'battle' ? { ...state, phase: 'prep' } : state;
  return storage.setText(SAUVEGARDE.partie, serialize(copie));
}

/**
 * Charge la partie sauvegardée.
 * @param {ReturnType<typeof createStorage>} storage
 * @returns {object|null} état, ou null s'il n'y a pas de sauvegarde lisible
 */
export function loadGame(storage) {
  const t = storage.getText(SAUVEGARDE.partie);
  return t === null ? null : deserialize(t);
}

/**
 * Vrai s'il existe une partie en cours à continuer (ni perdue ni gagnée).
 * @param {ReturnType<typeof createStorage>} storage
 * @returns {boolean}
 */
export function hasSavedGame(storage) {
  const s = loadGame(storage);
  return !!s && s.phase !== 'defeat' && s.phase !== 'victory';
}

/**
 * Efface la partie sauvegardée (la progression du royaume est gardée).
 * @param {ReturnType<typeof createStorage>} storage
 * @returns {boolean}
 */
export function clearGame(storage) {
  return storage.remove(SAUVEGARDE.partie);
}

/**
 * Sauvegarde la progression du royaume.
 * @param {ReturnType<typeof createStorage>} storage
 * @param {object} meta
 * @returns {boolean}
 */
export function saveMeta(storage, meta) {
  return storage.setJSON(SAUVEGARDE.meta, meta);
}

/**
 * Charge la progression du royaume (une nouvelle si rien n'est sauvegardé).
 * @param {ReturnType<typeof createStorage>} storage
 * @returns {object}
 */
export function loadMeta(storage) {
  return normalizeMeta(storage.getJSON(SAUVEGARDE.meta));
}

/**
 * Efface la progression du royaume.
 * @param {ReturnType<typeof createStorage>} storage
 * @returns {boolean}
 */
export function clearMeta(storage) {
  return storage.remove(SAUVEGARDE.meta);
}

/**
 * Sauvegarde les options (qualité, conseils…).
 * @param {ReturnType<typeof createStorage>} storage
 * @param {object} options
 * @returns {boolean}
 */
export function saveOptions(storage, options) {
  return storage.setJSON(SAUVEGARDE.options, options);
}

/**
 * Charge les options, complétées par les valeurs par défaut.
 * @param {ReturnType<typeof createStorage>} storage
 * @returns {object}
 */
export function loadOptions(storage) {
  const o = storage.getJSON(SAUVEGARDE.options);
  const raw = estObjet(o) ? o : {};
  // Chaque champ est vérifié : une option abîmée ne doit jamais empêcher le jeu de démarrer.
  return {
    ...OPTIONS_DEFAUT,
    qualite: raw.qualite === 'economie' || raw.qualite === 'normale' ? raw.qualite : OPTIONS_DEFAUT.qualite,
    conseils: typeof raw.conseils === 'boolean' ? raw.conseils : OPTIONS_DEFAUT.conseils,
    tutoVus: Array.isArray(raw.tutoVus) ? raw.tutoVus.filter((id) => typeof id === 'string') : [],
  };
}
