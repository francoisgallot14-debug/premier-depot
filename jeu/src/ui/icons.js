// Icônes de l'interface : petits dessins SVG au trait (grille 24×24), tous dans le même style.
// La couleur vient du CSS (currentColor), pour qu'une même icône serve partout.

const P = {
  // Ressources et population
  bois: '<path d="M17 7.5H7.5a4.5 4.5 0 0 0 0 9H17"/><ellipse cx="17" cy="12" rx="3" ry="4.5"/><circle cx="17" cy="12" r="1.2"/><path d="M7.5 10.5h4M9 13.8h3.5"/>',
  pierre: '<path d="M3.5 18.5 6.5 10 12 5.5l6 2.5 2.5 6.5-2.5 4z"/><path d="M6.5 10 12 12.5l6-4.5M12 12.5l-1.5 6"/>',
  nourriture: '<path d="M12 21V8.5"/><path d="M12 8.5c0-2.6 1.4-4.6 3.4-5.2 0 2.6-1.4 4.6-3.4 5.2zM12 8.5c0-2.6-1.4-4.6-3.4-5.2 0 2.6 1.4 4.6 3.4 5.2z"/><path d="M12 13.5c0-2.4 1.5-4.1 3.6-4.6 0 2.4-1.5 4.1-3.6 4.6zM12 13.5c0-2.4-1.5-4.1-3.6-4.6 0 2.4 1.5 4.1 3.6 4.6z"/><path d="M12 18c0-2.2 1.5-3.8 3.6-4.2 0 2.2-1.5 3.8-3.6 4.2zM12 18c0-2.2-1.5-3.8-3.6-4.2 0 2.2 1.5 3.8 3.6 4.2z"/>',
  villageois: '<circle cx="12" cy="7.2" r="3.4"/><path d="M5 20.5c.6-4.3 3.4-7 7-7s6.4 2.7 7 7"/>',
  soldat: '<path d="M4 4h3.2L17 13.8 13.8 17 4 7.2z"/><path d="M12 19l7-7M16.2 17.2l3.6 3.6"/>',
  etoile: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  vague: '<path d="M5 21V4"/><path d="M5 4.5h12l-2.5 4 2.5 4H5"/>',
  // Onglets
  actions: '<path d="M14.5 9.5 4 20"/><path d="M13 7.5 17.2 3.3c1.9 2.2 3.1 5.3 2.6 8.4l-2.9 1.5z"/>',
  construire: '<path d="M13.6 10.4 4.5 19.5"/><path d="m10.6 6.6 3.2-3.2 6.8 6.8-3.2 3.2z"/>',
  armee: '<path d="M12 3.2 19 6v5.3c0 4.4-3 7.9-7 9.5-4-1.6-7-5.1-7-9.5V6z"/><path d="M12 7.5v9M8.5 11h7"/>',
  royaume: '<path d="m4 17.5-1-9.5 5 4 4-6.5 4 6.5 5-4-1 9.5z"/><path d="M4 20.5h16"/>',
  lancer: '<path d="M4 4l10.5 10.5M20 4 9.5 14.5"/><path d="M12.5 16.5l4-4M7.5 12.5l4 4"/><path d="M14.5 14.5 19 19M9.5 14.5 5 19"/>',
  // Commandes
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
  lecture: '<path d="M7.5 4.8v14.4L19 12z"/>',
  vitesse: '<path d="M3.5 6.5 11 12l-7.5 5.5zM12 6.5l7.5 5.5-7.5 5.5z"/>',
  fermer: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  drapeau: '<path d="M5.5 21V3.5"/><path d="M5.5 4h11.5l-2.4 3.8L17 11.5H5.5"/>',
  piege: '<path d="M3 19.5h18"/><path d="M4.5 19.5 7 10l2.5 9.5M9.5 19.5 12 6.5l2.5 13M14.5 19.5 17 10l2.5 9.5"/>',
  coeur: '<path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moins: '<path d="M5 12h14"/>',
  demolir: '<path d="M4 7h16M9.5 7V4.5h5V7M6.2 7l1 13h9.6l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  valide: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  cadenas: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
  crane: '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.5 3 5.6V20h9v-3.9c1.7-1.1 3-3 3-5.6A7.5 7.5 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.5 20v-2M13.5 20v-2"/>',
  trophee: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4.2M16 6h3a3 3 0 0 1-3 4.2M12 13.5V17M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  maison: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M5.8 9.8V20h12.4V9.8"/><path d="M10 20v-5h4v5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  hausse: '<path d="M12 19V5.5M6 11.5l6-6 6 6"/>',
  horloge: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cible: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2"/>',
  boussole: '<circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z"/>',
  fleche: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  livre: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/>',
  reglages: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6"/>',
  // Bâtiments
  hutte: '<path d="M3.5 12.5C5.6 7.8 8.6 4.8 12 4.2c3.4.6 6.4 3.6 8.5 8.3z"/><path d="M6 12.5V20h12v-7.5M10.5 20v-4h3v4"/>',
  bucheron: '<path d="M14.5 9.5 4 20"/><path d="M13 7.5 17.2 3.3c1.9 2.2 3.1 5.3 2.6 8.4l-2.9 1.5z"/>',
  chasseur: '<path d="M6 3.5c7.6.4 14 6.8 14.5 14.5"/><path d="M6 3.5l14.5 14.5"/><path d="M4 20l9-9M4 20h3.5M4 20v-3.5"/>',
  carriere: '<path d="M14 10 4.5 19.5"/><path d="M5.2 8.3C9.3 4.6 15 3.8 19.6 5c1.2 4.6.4 10.3-3.3 14.4"/><path d="m11.5 7.5 5 5"/>',
  champ: '<path d="M3 20.5h18"/><path d="M6 20.5v-8M6 12.5c0-2 1-3.5 2.5-4-.1 2-1 3.5-2.5 4zM6 12.5c0-2-1-3.5-2.5-4 .1 2 1 3.5 2.5 4zM12 20.5v-11M12 9.5c0-2.2 1.1-3.9 2.8-4.4 0 2.2-1.1 3.9-2.8 4.4zM12 9.5c0-2.2-1.1-3.9-2.8-4.4 0 2.2 1.1 3.9 2.8 4.4zM18 20.5v-8M18 12.5c0-2 1-3.5 2.5-4-.1 2-1 3.5-2.5 4zM18 12.5c0-2-1-3.5-2.5-4 .1 2 1 3.5 2.5 4z"/>',
  entrepot: '<path d="M3.5 10 12 4.5l8.5 5.5V20h-17z"/><path d="M8 20v-6.5h8V20M8 16.8h8"/>',
  palissade: '<path d="M5.5 20.5V8.5L7 5l1.5 3.5v12M10.5 20.5V7.5L12 4l1.5 3.5v13M15.5 20.5V8.5L17 5l1.5 3.5v12"/><path d="M3.5 12.5h17M3.5 16.5h17"/>',
  tour_guet: '<path d="M6.5 9h11L15 4.5H9z"/><path d="M8.3 9 6.5 20.5M15.7 9l1.8 11.5M7.8 13h8.4M7.2 17h9.6"/>',
  mur_pierre: '<path d="M3 9.5h3v-3h3.5v3h5v-3H18v3h3V20H3z"/><path d="M3 14.8h18M9 9.5v5.3M15 9.5v5.3M6 14.8V20M12 14.8V20M18 14.8V20"/>',
  tour_pierre: '<path d="M7 20.5V10h10v10.5"/><path d="M6 10V4.5h2.6v2h2.1v-2h2.6v2h2.1v-2H18V10"/><path d="M10.5 20.5V17a1.5 1.5 0 0 1 3 0v3.5"/>',
  caserne: '<path d="M5.5 21V3.5"/><path d="M5.5 4h12v8h-12"/><path d="M9.5 7.2 11.5 9l2-1.8"/><path d="M3.5 21h6"/>',
  atelier: '<path d="M3 7h13.2a4 4 0 0 0 4 4.2H15.5l-1.2 3.6h1.8V18H7.8v-3.2h1.8L8.6 11.2C5.2 11 3 9.7 3 7z"/>',
  maison_commune: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M5.8 9.8V20h12.4V9.8"/><path d="M10 20v-5h4v5"/><path d="M12 4.5V1.8l3 .9-3 .9"/>',
};

/** Icône de chaque action manuelle. */
export const ICONE_ACTION = {
  couper_bois: 'bucheron', tailler_pierre: 'carriere', chasser: 'chasseur', entrainer: 'cible', explorer: 'boussole',
};

/**
 * Code SVG d'une icône.
 * @param {string} name nom de l'icône (voir P)
 * @param {string} [cls] classes CSS en plus
 * @returns {string}
 */
export function icon(name, cls = '') {
  const d = P[name] || P.info;
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
}

/** Liste des noms disponibles (page de test des icônes). */
export const ICON_NAMES = Object.keys(P);
