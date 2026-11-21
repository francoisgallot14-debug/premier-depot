// Progression du royaume : XP, niveaux, talents, missions, réserves.
// Elle est conservée entre les parties (sauvegarde séparée de la partie).

import {
  META, TALENTS, BRANCHES_TALENTS, MISSIONS, RESSOURCES, BATIMENTS, DEPART, NOMS_RESSOURCES,
} from './data.js';

export const META_VERSION = 1;

/**
 * Nouvelle progression de royaume (niveau 1, rien de débloqué).
 * `missionsDone` est un ajout à la spec : les missions ne rapportent qu'une fois par royaume.
 * @returns {{ version:number, xp:number, level:number, talentPoints:number, talents:string[],
 *   reserves:{bois:number,pierre:number,nourriture:number}, chaptersWon:number[], bestWave:number,
 *   missionsDone:string[] }}
 */
export function newMeta() {
  return {
    version: META_VERSION,
    xp: 0,
    level: 1,
    talentPoints: 0,
    talents: [],
    reserves: { bois: 0, pierre: 0, nourriture: 0 },
    chaptersWon: [],
    bestWave: 0,
    missionsDone: [],
  };
}

/**
 * Remet d'aplomb une progression lue depuis la sauvegarde (champs manquants ou abîmés).
 * @param {any} raw
 * @returns {ReturnType<typeof newMeta>}
 */
export function normalizeMeta(raw) {
  const m = newMeta();
  if (!raw || typeof raw !== 'object') return m;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  m.xp = Math.floor(num(raw.xp, 0));
  m.level = Math.max(1, Math.floor(num(raw.level, 1)));
  m.talentPoints = Math.floor(num(raw.talentPoints, 0));
  if (Array.isArray(raw.talents)) m.talents = [...new Set(raw.talents.filter((t) => TALENTS[t]))];
  if (raw.reserves && typeof raw.reserves === 'object') {
    for (const r of RESSOURCES) m.reserves[r] = Math.floor(num(raw.reserves[r], 0));
  }
  if (Array.isArray(raw.chaptersWon)) m.chaptersWon = [...new Set(raw.chaptersWon.filter((c) => Number.isInteger(c)))];
  m.bestWave = Math.floor(num(raw.bestWave, 0));
  if (Array.isArray(raw.missionsDone)) {
    const ids = new Set(MISSIONS.map((x) => x.id));
    m.missionsDone = [...new Set(raw.missionsDone.filter((id) => ids.has(id)))];
  }
  // Le niveau doit correspondre à l'XP (sécurité si la sauvegarde a été bricolée).
  while (m.xp >= totalXpForLevel(m.level + 1)) m.level++;
  return m;
}

/**
 * XP nécessaire pour passer du niveau `level` au suivant (100 × niveau).
 * @param {number} level
 * @returns {number}
 */
export function xpForNextLevel(level) {
  return META.xpParNiveau * level;
}

/**
 * XP totale (cumulée depuis zéro) pour atteindre le niveau `level`.
 * @param {number} level
 * @returns {number}
 */
export function totalXpForLevel(level) {
  return (META.xpParNiveau * (level - 1) * level) / 2;
}

/**
 * Avancement dans le niveau courant (pour la barre d'XP).
 * @param {object} meta
 * @returns {{ level:number, xpInLevel:number, xpNeeded:number, ratio:number }}
 */
export function levelProgress(meta) {
  const base = totalXpForLevel(meta.level);
  const needed = xpForNextLevel(meta.level);
  const inLevel = Math.max(0, meta.xp - base);
  return { level: meta.level, xpInLevel: inLevel, xpNeeded: needed, ratio: Math.min(1, inLevel / needed) };
}

/**
 * Ajoute de l'XP au royaume et gère les montées de niveau (1 point de talent par niveau).
 * @param {object|null} meta (null : ne fait rien mais calcule le résultat à vide)
 * @param {number} amount
 * @returns {{ gained:number, levelBefore:number, levelAfter:number, levelsGained:number, pointsGained:number }}
 */
export function addXp(meta, amount) {
  const gained = Math.max(0, Math.floor(amount || 0));
  if (!meta) return { gained, levelBefore: 0, levelAfter: 0, levelsGained: 0, pointsGained: 0 };
  const before = meta.level;
  meta.xp += gained;
  while (meta.xp >= totalXpForLevel(meta.level + 1)) {
    meta.level++;
    meta.talentPoints += META.pointsParNiveau;
  }
  const levels = meta.level - before;
  return { gained, levelBefore: before, levelAfter: meta.level, levelsGained: levels, pointsGained: levels * META.pointsParNiveau };
}

/**
 * XP d'une vague gagnée : 10 + 5 × numéro de vague + ennemis tués.
 * @param {number} waveNumber numéro de la vague (1 à 10)
 * @param {number} kills
 * @returns {number}
 */
export function waveXp(waveNumber, kills) {
  return META.xpBaseVague + META.xpParNumeroVague * waveNumber + META.xpParEnnemi * (kills || 0);
}

/**
 * Additionne les effets d'une liste de talents (voir TALENTS[...].effet dans data.js).
 * @param {string[]} talentIds
 * @returns {{ actions:number, productionBois:number, stockage:number, croissance:number, pvMurs:number,
 *   degatsTours:number, degatsPieges:number, rechargePieges:number, degatsSoldats:number,
 *   entrainementRecrues:number, reductionRecrue:number }}
 */
export function talentEffects(talentIds) {
  const fx = {
    actions: 0, productionBois: 0, stockage: 0, croissance: 0, pvMurs: 0, degatsTours: 0,
    degatsPieges: 0, rechargePieges: 0, degatsSoldats: 0, entrainementRecrues: 0, reductionRecrue: 0,
  };
  for (const id of talentIds || []) {
    const t = TALENTS[id];
    if (!t) continue;
    for (const [k, v] of Object.entries(t.effet)) fx[k] = (fx[k] || 0) + v;
  }
  return fx;
}

/**
 * PV max d'un type de bâtiment selon les talents (les murs profitent de « Pieux durcis »).
 * @param {string} type
 * @param {string[]} talentIds
 * @returns {number}
 */
export function buildingMaxHpFor(type, talentIds) {
  const def = BATIMENTS[type];
  if (!def) return 0;
  const fx = talentEffects(talentIds);
  return Math.round(def.pv * (def.mur ? 1 + fx.pvMurs : 1));
}

/**
 * Peut-on acheter ce talent ? (points, prérequis, déjà acquis)
 * @param {object} meta
 * @param {string} id
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canBuyTalent(meta, id) {
  const t = TALENTS[id];
  if (!t) return { ok: false, reason: 'Talent inconnu.' };
  if (meta.talents.includes(id)) return { ok: false, reason: 'Déjà acquis.' };
  if (t.requiert && !meta.talents.includes(t.requiert)) {
    return { ok: false, reason: `Demande d’abord « ${TALENTS[t.requiert].nom} ».` };
  }
  if (meta.talentPoints < t.cout) return { ok: false, reason: 'Pas assez de points de talent.' };
  return { ok: true };
}

/**
 * Achète un talent. S'il y a une partie en cours, il s'applique tout de suite
 * (actions en plus, PV des murs…) et aussi aux parties suivantes.
 * @param {object} meta
 * @param {string} id
 * @param {object} [state] partie en cours (facultatif)
 * @returns {{ ok: boolean, reason?: string }}
 */
export function buyTalent(meta, id, state = null) {
  const check = canBuyTalent(meta, id);
  if (!check.ok) return check;
  meta.talentPoints -= TALENTS[id].cout;
  meta.talents.push(id);
  if (state) applyTalentsToState(state, meta.talents);
  return { ok: true };
}

/**
 * Recopie les talents du royaume dans la partie et applique les effets immédiats.
 * @param {object} state
 * @param {string[]} talentIds
 * @returns {void}
 */
export function applyTalentsToState(state, talentIds) {
  const before = talentEffects(state.talents);
  state.talents = [...new Set([...(state.talents || []), ...talentIds])];
  const fx = talentEffects(state.talents);
  // Actions : on gagne tout de suite l'action en plus.
  const extra = fx.actions - before.actions;
  state.actionsMax = DEPART.actions + fx.actions;
  if (extra > 0) state.actionsLeft += extra;
  // Murs plus solides : en préparation tout est réparé, on met donc les PV au nouveau max.
  for (const b of state.buildings) {
    if (!b.destroyed && BATIMENTS[b.type]?.mur) b.hp = buildingMaxHpFor(b.type, state.talents);
  }
}

/**
 * Arbre des talents pour l'écran Royaume (3 colonnes).
 * @param {object} meta
 * @returns {{ id:string, nom:string, talents:{ id:string, nom:string, description:string, cout:number,
 *   requiert:string|null, owned:boolean, available:boolean, reason:string }[] }[]}
 */
export function talentTree(meta) {
  return BRANCHES_TALENTS.map((br) => ({
    id: br.id,
    nom: br.nom,
    talents: Object.entries(TALENTS)
      .filter(([, t]) => t.branche === br.id)
      .map(([id, t]) => {
        const c = canBuyTalent(meta, id);
        return {
          id, nom: t.nom, description: t.description, cout: t.cout, requiert: t.requiert,
          owned: meta.talents.includes(id), available: c.ok, reason: c.ok ? '' : c.reason,
        };
      }),
  }));
}

/**
 * Texte court d'une récompense de mission (« +30 XP, +10 bois »).
 * @param {{ xp?: number, reserves?: object }} rec
 * @returns {string}
 */
export function rewardText(rec) {
  const parts = [];
  if (rec.xp) parts.push(`+${rec.xp} XP`);
  for (const r of RESSOURCES) if (rec.reserves?.[r]) parts.push(`+${rec.reserves[r]} ${NOMS_RESSOURCES[r]} en réserve`);
  return parts.join(', ');
}

function missionRemplie(m, state, ctx) {
  const c = m.condition;
  switch (c.type) {
    case 'tour_avant_vague':
      return state.stats.firstTowerWave != null && state.stats.firstTowerWave <= c.vague;
    case 'vague_sans_perte':
      return !!ctx && ctx.won === true && ctx.waveNumber >= c.aPartirDe && ctx.soldiersLost === 0 && state.soldiers.length > 0;
    case 'population':
      return state.villagers + state.soldiers.length >= c.n;
    case 'soldats_equipes':
      return state.soldiers.filter((s) => s.kind === 'fantassin' && s.equip >= c.tier).length >= c.n;
    case 'tues_par_pieges':
      return (state.stats.trapKills || 0) >= c.n;
    case 'chapitre_gagne':
      return state.phase === 'victory';
    default:
      return false;
  }
}

/**
 * Vérifie les missions. Une mission remplie est notée dans la partie ; la récompense
 * (XP + réserves) n'est donnée qu'une fois par royaume.
 * @param {object} state
 * @param {object|null} meta
 * @param {{ won?: boolean, waveNumber?: number, soldiersLost?: number }} [ctx] infos de la vague qui vient de finir
 * @returns {{ id:string, nom:string, recompense:object, recompenseTexte:string, rewarded:boolean }[]}
 */
export function checkMissions(state, meta, ctx = null) {
  const done = [];
  for (const m of MISSIONS) {
    if (state.missionsDone.includes(m.id)) continue;
    if (!missionRemplie(m, state, ctx)) continue;
    state.missionsDone.push(m.id);
    let rewarded = false;
    if (meta && !meta.missionsDone.includes(m.id)) {
      meta.missionsDone.push(m.id);
      addXp(meta, m.recompense.xp || 0);
      for (const r of RESSOURCES) meta.reserves[r] += m.recompense.reserves?.[r] || 0;
      rewarded = true;
    }
    done.push({ id: m.id, nom: m.nom, recompense: m.recompense, recompenseTexte: rewardText(m.recompense), rewarded });
  }
  return done;
}

/**
 * Liste des missions avec leur état, pour l'écran Royaume.
 * @param {object} meta
 * @param {object} [state] partie en cours (facultatif)
 * @returns {{ id:string, nom:string, recompenseTexte:string, doneEver:boolean, doneThisGame:boolean }[]}
 */
export function missionList(meta, state = null) {
  return MISSIONS.map((m) => ({
    id: m.id,
    nom: m.nom,
    recompenseTexte: rewardText(m.recompense),
    doneEver: meta.missionsDone.includes(m.id),
    doneThisGame: !!state && state.missionsDone.includes(m.id),
  }));
}
