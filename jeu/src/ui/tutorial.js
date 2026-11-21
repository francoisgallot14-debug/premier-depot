// Conseils du tutoriel : de courtes aides au bon moment pendant les premiers cycles.
// Jamais bloquants (un petit cadre qu'on peut fermer), désactivables dans les options.
// Un conseil fermé ne revient plus (mémorisé dans les options : tutoVus).
import * as C from '../core/index.js';
import { icon } from './icons.js';
import { el, typoHTML } from './dom.js';

const surRoute = (map, b) => map.tiles[b.z][b.x] === 'road';
/** Vrai si la vague d'indice i est la première à amener ce type d'ennemi. */
function premiereVagueAvec(i, type) {
  const a = (v) => !!C.VAGUES[v]?.groupes.some((g) => g.type === type);
  if (!a(i)) return false;
  for (let v = 0; v < i; v++) if (a(v)) return false;
  return true;
}

/**
 * Liste des conseils, du plus prioritaire au moins prioritaire.
 * quand(ctx) : vrai si le conseil doit s'afficher ; cible : sélecteur du bouton à faire briller ;
 * feuilles : panneaux pendant lesquels il peut s'afficher (null = aucun panneau ouvert ; absent = toujours).
 */
const CONSEILS = [
  {
    id: 'placer',
    quand: (c) => c.mode === 'placement',
    texte: () => 'Les cases <b>dorées</b> sont possibles. Touchez-en une, puis <b>Construire ici</b>.',
    cible: () => '[data-cmd="construire-ici"]',
  },
  {
    id: 'actions',
    feuilles: [null],
    quand: (c) => c.prep && c.s.wave === 0 && c.s.actionsLeft === c.s.actionsMax && c.sheet !== 'actions',
    texte: () => 'Bienvenue ! Commencez par vos <b>actions</b> : couper du bois, tailler la pierre, chasser.',
    cible: () => '[data-sheet="actions"]',
  },
  {
    id: 'actions_ouvert',
    feuilles: ['actions'],
    quand: (c) => c.prep && c.s.wave === 0 && c.sheet === 'actions' && c.s.actionsLeft > 0,
    texte: (c) => `Vous avez ${c.s.actionsMax} actions par cycle : elles reviennent après chaque vague, ne les gardez pas !`,
    cible: () => '[data-id="couper_bois"]',
  },
  {
    id: 'bucheron',
    feuilles: [null, 'construire'],
    quand: (c) => c.prep && c.s.wave < 2 && !C.hasBuilding(c.s, 'bucheron') && c.s.actionsLeft < c.s.actionsMax,
    texte: (c) => (c.sheet === 'construire'
      ? 'Choisissez la <b>cabane de bûcheron</b> : elle se pose près de la forêt.'
      : 'Construisez une <b>cabane de bûcheron</b> près de la forêt : elle produira du bois.'),
    cible: (c) => (c.sheet === 'construire' ? '[data-type="bucheron"]' : '[data-sheet="construire"]'),
  },
  {
    id: 'ouvriers',
    feuilles: [null, 'batiment'],
    quand: (c) => c.prep && c.s.wave < 2 && C.freeVillagers(c.s) > 0
      && c.s.buildings.some((b) => !b.destroyed && C.BATIMENTS[b.type].emplois > 0 && b.workers === 0),
    texte: (c) => (c.sheet === 'batiment' && c.selEmplois
      ? 'Touchez <b>+</b> pour y placer des villageois : ils produiront à chaque bilan.'
      : 'Touchez votre cabane sur la carte, puis ajoutez-y des <b>villageois</b>.'),
    cible: (c) => (c.sheet === 'batiment' && c.selEmplois ? '[data-key="plus"]' : null),
  },
  {
    id: 'palissade',
    feuilles: [null, 'construire'],
    quand: (c) => c.prep && c.s.wave < 2 && C.hasBuilding(c.s, 'bucheron')
      && !c.s.buildings.some((b) => !b.destroyed && C.BATIMENTS[b.type].bloqueRoute && surRoute(c.map, b)),
    texte: (c) => (c.sheet === 'construire'
      ? 'La <b>palissade</b> : posez-la <b>sur la route</b>, pas dans l’herbe.'
      : 'Posez une <b>palissade sur la route</b> : les ennemis devront la casser pour passer.'),
    cible: (c) => (c.sheet === 'construire' ? '[data-type="palissade"]' : '[data-sheet="construire"]'),
  },
  {
    id: 'lancer',
    feuilles: [null],
    quand: (c) => c.prep && c.s.wave === 0 && !c.sheet && c.s.buildings.some((b) => !b.destroyed && C.BATIMENTS[b.type].bloqueRoute && surRoute(c.map, b)),
    texte: () => 'Prêt ? Lancez la vague quand vous voulez : <b>pas de chrono</b> en préparation.',
    cible: () => '[data-cmd="lancer"]',
  },
  {
    id: 'tour',
    feuilles: [null, 'construire'],
    quand: (c) => c.prep && c.s.wave >= 1 && c.s.wave < 4 && c.s.unlocked.includes('tour_guet') && !C.hasBuilding(c.s, 'tour_guet') && !C.hasBuilding(c.s, 'tour_pierre'),
    texte: () => 'Une <b>tour de guet</b> près de la route tire sur les ennemis qui passent.',
    cible: (c) => (c.sheet === 'construire' ? '[data-type="tour_guet"]' : '[data-sheet="construire"]'),
  },
  {
    id: 'armee',
    quand: (c) => c.bataille && c.b && !c.b.over && c.mode !== 'deplacer' && !c.usedMove && c.b.waveNumber <= 2 && c.b.time > 2,
    texte: () => 'Touchez <b>Déplacer l’armée</b> puis une case : vos soldats y courent.',
    cible: () => '[data-cmd="deplacer"]',
  },
  {
    id: 'piege',
    quand: (c) => c.bataille && c.b && !c.b.over && !c.usedTrap && c.b.buildings.some((x) => x.trap && !x.destroyed),
    texte: () => 'Quand des ennemis passent sur le <b>piège</b>, touchez-le pour le déclencher.',
    cible: () => '.battlebar .piege-btn',
  },
  {
    // première vague avec des soudards : leur armure rend l'armée indispensable au mur
    id: 'soudards',
    feuilles: [null, 'armee'],
    quand: (c) => c.prep && premiereVagueAvec(c.s.wave, 'soudard') && c.s.soldiers.length > 0
      && c.s.rally.x === c.map.defaultRally.x && c.s.rally.z === c.map.defaultRally.z,
    texte: (c) => (c.sheet === 'armee'
      ? '<b>Placez le drapeau</b> juste derrière votre palissade : les soldats la tiendront sans la franchir.'
      : 'Des <b>soudards</b> arrivent : leur cotte de mailles arrête une partie des flèches. Postez l’<b>armée</b> derrière la palissade.'),
    cible: (c) => (c.sheet === 'armee' ? '[data-cmd="drapeau"]' : '[data-sheet="armee"]'),
  },
  {
    id: 'caserne',
    feuilles: [null, 'construire'],
    quand: (c) => c.prep && c.s.wave >= 2 && c.s.unlocked.includes('caserne') && !C.hasBuilding(c.s, 'caserne'),
    texte: () => 'La <b>caserne</b> permet de recruter : un villageois libre devient soldat.',
    cible: (c) => (c.sheet === 'construire' ? '[data-type="caserne"]' : null),
  },
];

/**
 * Crée le système de conseils.
 * @param {HTMLElement} ui calque d'interface
 * @param {{ getOptions: () => object, saveOptions: (o: object) => void }} opts
 */
export function createTutorial(ui, { getOptions, saveOptions }) {
  const box = el('div', 'conseil');
  box.hidden = true;
  box.setAttribute('role', 'note');
  box.innerHTML = `${icon('livre', 'ic-conseil')}<p></p><button type="button" class="btn btn-icone" data-cmd="conseil-fermer" aria-label="Fermer le conseil">${icon('fermer')}</button>`;
  const p = box.querySelector('p');
  ui.append(box);
  let courant = null;
  let cibleEl = null;

  function clearTarget() {
    if (cibleEl) cibleEl.classList.remove('cible-conseil');
    cibleEl = null;
  }

  /**
   * Choisit le conseil à afficher selon la situation.
   * @param {{ screen:string, mode:string|null, sheet:string|null, s:object|null, b:object|null, map:object, selEmplois?:boolean }} ctx
   */
  function check(ctx) {
    const o = getOptions();
    const vus = new Set(Array.isArray(o.tutoVus) ? o.tutoVus : []);
    let choix = null;
    if (o.conseils && ctx.screen === 'jeu' && ctx.s && !ctx.modal) {
      const c = { ...ctx, prep: ctx.s.phase === 'prep' && ctx.mode !== 'placement' && ctx.mode !== 'drapeau', bataille: ctx.s.phase === 'battle' };
      choix = CONSEILS.find((k) => !vus.has(k.id) && (!k.feuilles || k.feuilles.includes(c.sheet || null)) && k.quand(c)) || null;
      if (choix) {
        const txt = typoHTML(`>${choix.texte(c)}<`).slice(1, -1);
        if (courant !== choix.id || p.innerHTML !== txt) p.innerHTML = txt;
        const sel = choix.cible(c);
        const t = sel ? ui.querySelector(sel) : null;
        if (t !== cibleEl) { clearTarget(); cibleEl = t; if (t) t.classList.add('cible-conseil'); }
      }
    }
    if (!choix) clearTarget();
    courant = choix ? choix.id : null;
    box.hidden = !choix;
    box.dataset.id = courant || '';
  }

  /** Ferme le conseil affiché (il ne reviendra plus). */
  function dismiss() {
    if (!courant) return;
    markSeen(courant);
  }

  /** Conseil appris (le geste a été fait) : il ne reviendra plus. */
  function markSeen(id) {
    const o = getOptions();
    const vus = Array.isArray(o.tutoVus) ? o.tutoVus : [];
    if (!vus.includes(id)) {
      o.tutoVus = [...vus, id];
      saveOptions(o);
    }
    if (courant === id) {
      courant = null;
      box.hidden = true;
      box.dataset.id = '';
      clearTarget();
    }
  }

  /** Fait revenir tous les conseils. */
  function reset() {
    const o = getOptions();
    o.tutoVus = [];
    saveOptions(o);
  }

  return { check, dismiss, markSeen, reset, get current() { return courant; }, el: box };
}
