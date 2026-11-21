// Petits outils DOM partagés par l'interface (sans bibliothèque).

const ESP = '\u00a0'; // espace insécable
const LETTRE = 'A-Za-zÀ-ÖØ-öø-ÿŒœ';

/**
 * Typographie française d'un texte simple : apostrophe courbe, espace insécable avant « : ; ! ? »
 * et entre un nombre et son unité, après « et avant ». Sans effet si déjà appliquée.
 */
export function typo(v) {
  return String(v ?? '')
    .replace(new RegExp(`([${LETTRE}])'(?=[${LETTRE}])`, 'g'), '$1’')
    .replace(/ ([:;!?»])/g, `${ESP}$1`)
    .replace(/« /g, `«${ESP}`)
    .replace(/(\d) (%|s\b|PV\b|XP\b|bois\b|pierre\b|nourriture\b|dégâts\b|cases?\b|ennemis?\b|soldats?\b|habitants?\b|points?\b)/g, `$1${ESP}$2`)
    .replace(/\b(Vague|vague|Niveau|niveau|Chapitre) (\d)/g, `$1${ESP}$2`);
}

/** Même chose sur du HTML : seuls les textes entre les balises sont touchés. */
export function typoHTML(html) {
  return String(html ?? '').replace(/>([^<]+)</g, (m, t) => `>${typo(t)}<`);
}

/** Échappe un texte pour l'insérer dans du HTML (avec la typographie française). */
export function esc(v) {
  return typo(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Premier élément correspondant au sélecteur. */
export function $(sel, root = document) {
  return root.querySelector(sel);
}

/** Crée un élément avec classe et contenu HTML. */
export function el(tag, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Nombre affiché à la française (virgule décimale, une décimale au plus). */
export function nb(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

/** « 1 soldat » / « 3 soldats » (pluriel simple). */
export function pluriel(n, mot, motPluriel = mot + 's') {
  return `${n} ${Math.abs(n) > 1 ? motPluriel : mot}`;
}

/** Vrai si l'utilisateur préfère moins d'animations. */
export function reduceMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Remplace le contenu HTML d'un élément en gardant le focus clavier et la position de défilement
 * (le bouton qui avait le focus est retrouvé grâce à son attribut data-key).
 */
export function swapHTML(node, html) {
  const act = document.activeElement;
  const key = act && node.contains(act) ? act.getAttribute('data-key') : null;
  const scrollers = [...node.querySelectorAll('[data-scroll]')].map((s) => [s.getAttribute('data-scroll'), s.scrollTop]);
  node.innerHTML = typoHTML(html);
  for (const [k, top] of scrollers) {
    const s = node.querySelector(`[data-scroll="${k}"]`);
    if (s) s.scrollTop = top;
  }
  if (key) {
    const again = node.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
}
