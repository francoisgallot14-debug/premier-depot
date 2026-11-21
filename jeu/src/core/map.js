// Carte du chapitre 1, dessinée à la main (toujours identique).
// Légende du plan :  .  herbe   #  route   F  forêt   R  rocher   ~  ruisseau
//
// La route entre au nord (x = 11), fait trois grands virages (épingle à l'ouest,
// épingle à l'est, puis descente finale) et s'arrête 2 tuiles au nord de la
// Maison commune (11, 16). L'intérieur des virages est en herbe : ce sont les
// meilleurs emplacements de tours, car elles y couvrent deux tronçons de route.

import { MAP_W, MAP_H, TILE, CHAPITRES } from './data.js';

//                    x: 0123456789012345678901
const PLAN_CHAPITRE_1 = [
  /* z= 0 */ 'FF.~...FF..#..F..RR.FF',
  /* z= 1 */ 'F..~..FFF..#....RRRR.F',
  /* z= 2 */ 'F.~~...F...#.....RR..F',
  /* z= 3 */ '..~...######......R...',
  /* z= 4 */ '..~...#.............FF',
  /* z= 5 */ '..~~..#..............F',
  /* z= 6 */ '...~..#...............',
  /* z= 7 */ '...~..#...............',
  /* z= 8 */ '..~~..##########...RR.',
  /* z= 9 */ '..~............#.F..R.',
  /* z=10 */ '.~~............#..FF..',
  /* z=11 */ 'F~.F.......#####..FFF.',
  /* z=12 */ 'FFFF.......#......FFFF',
  /* z=13 */ 'FFF........#.....FFFF.',
  /* z=14 */ 'FF.F.......#.....FF.FF',
  /* z=15 */ 'FFF...............FF.F',
  /* z=16 */ 'FF................F..F',
  /* z=17 */ 'F...F...............F.',
  /* z=18 */ '.F.................F..',
  /* z=19 */ '...RR...............FF',
  /* z=20 */ 'F..RRR..............FF',
  /* z=21 */ 'FF.RR..........F...FFF',
];

// Coins de la route, de l'entrée des ennemis jusqu'à la porte du village.
const VIRAGES_CHAPITRE_1 = [
  { x: 11, z: 0 },
  { x: 11, z: 3 },
  { x: 6, z: 3 },
  { x: 6, z: 8 },
  { x: 15, z: 8 },
  { x: 15, z: 11 },
  { x: 11, z: 11 },
  { x: 11, z: 14 },
];

const LEGENDE = { '.': 'grass', '#': 'road', F: 'forest', R: 'rock', '~': 'water' };

// Déplie la liste des coins en une suite de tuiles voisines.
function deplierRoute(virages) {
  const path = [{ x: virages[0].x, z: virages[0].z }];
  for (let i = 1; i < virages.length; i++) {
    const a = virages[i - 1];
    const b = virages[i];
    const dx = Math.sign(b.x - a.x);
    const dz = Math.sign(b.z - a.z);
    let x = a.x;
    let z = a.z;
    while (x !== b.x || z !== b.z) {
      x += dx;
      z += dz;
      path.push({ x, z });
    }
  }
  return path;
}

function geler(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) geler(obj[k]);
  }
  return obj;
}

function construireCarte(chapter, plan, virages, hall, defaultRally) {
  if (plan.length !== MAP_H) throw new Error(`Carte ${chapter} : ${plan.length} lignes au lieu de ${MAP_H}`);
  const tiles = plan.map((ligne, z) => {
    if (ligne.length !== MAP_W) throw new Error(`Carte ${chapter} : ligne z=${z} de ${ligne.length} cases`);
    return [...ligne].map((c) => {
      const t = LEGENDE[c];
      if (!t) throw new Error(`Carte ${chapter} : caractère inconnu « ${c} »`);
      return t;
    });
  });
  const path = deplierRoute(virages);
  // Vérifie que le plan et la route dessinée correspondent exactement.
  const surRoute = new Set(path.map((p) => `${p.x},${p.z}`));
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const estRoute = tiles[z][x] === 'road';
      if (estRoute !== surRoute.has(`${x},${z}`)) {
        throw new Error(`Carte ${chapter} : la route ne correspond pas au plan en (${x}, ${z})`);
      }
    }
  }
  const pathIndex = {};
  path.forEach((p, i) => { pathIndex[`${p.x},${p.z}`] = i; });
  return geler({
    chapter,
    nom: CHAPITRES[chapter]?.nom ?? `Chapitre ${chapter}`,
    w: MAP_W,
    h: MAP_H,
    tiles,
    path,
    pathIndex,
    hall: { ...hall },
    spawn: { ...path[0] },
    gate: { ...path[path.length - 1] },
    defaultRally: { ...defaultRally },
  });
}

const CARTES = {
  1: construireCarte(1, PLAN_CHAPITRE_1, VIRAGES_CHAPITRE_1, { x: 11, z: 16 }, { x: 11, z: 13 }),
};

/**
 * Carte d'un chapitre (objet gelé, à ne pas modifier).
 * Forme : `{ chapter, nom, w, h, tiles: string[][] (tiles[z][x]), path: {x,z}[], pathIndex: {"x,z": i},
 *   hall: {x,z}, spawn: {x,z}, gate: {x,z} (dernière tuile de route), defaultRally: {x,z} }`.
 * Types de tuiles : 'grass' | 'road' | 'forest' | 'rock' | 'water'.
 * @param {number} [chapter=1]
 * @returns {object}
 */
export function getMap(chapter = 1) {
  return CARTES[chapter] ?? CARTES[1];
}

/**
 * Vrai si la tuile (x, z) est dans la carte.
 * @param {object} map
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
export function inBounds(map, x, z) {
  return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < map.w && z < map.h;
}

/**
 * Type de la tuile (x, z), ou null hors carte.
 * @param {object} map
 * @param {number} x
 * @param {number} z
 * @returns {'grass'|'road'|'forest'|'rock'|'water'|null}
 */
export function tileAt(map, x, z) {
  return inBounds(map, x, z) ? map.tiles[z][x] : null;
}

/**
 * Indice de la tuile dans `map.path`, ou -1 si elle n'est pas sur la route.
 * @param {object} map
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function pathIndexOf(map, x, z) {
  const i = map.pathIndex[`${x},${z}`];
  return i === undefined ? -1 : i;
}

/**
 * Vrai s'il existe une tuile du type donné à `dist` tuiles au plus (distance « carrée » :
 * max(|dx|, |dz|) ≤ dist, donc les diagonales comptent).
 * @param {object} map
 * @param {number} x
 * @param {number} z
 * @param {string} type type de tuile cherché ('forest', 'rock'…)
 * @param {number} dist
 * @returns {boolean}
 */
export function isNearTile(map, x, z, type, dist) {
  for (let dz = -dist; dz <= dist; dz++) {
    for (let dx = -dist; dx <= dist; dx++) {
      if (tileAt(map, x + dx, z + dz) === type) return true;
    }
  }
  return false;
}

/**
 * Centre d'une tuile en coordonnées 3D (y = 0). Accepte aussi des tuiles décimales
 * (positions d'unités en bataille).
 * @param {number} x tuile x (peut être décimal)
 * @param {number} z tuile z (peut être décimal)
 * @returns {{ wx: number, wz: number }}
 */
export function tileToWorld(x, z) {
  return {
    wx: (x - MAP_W / 2 + 0.5) * TILE,
    wz: (z - MAP_H / 2 + 0.5) * TILE,
  };
}

/**
 * Tuile (entière) qui contient le point 3D (wx, wz). Peut être hors carte : vérifier avec inBounds.
 * @param {number} wx
 * @param {number} wz
 * @returns {{ x: number, z: number }}
 */
export function worldToTile(wx, wz) {
  return {
    x: Math.round(wx / TILE + MAP_W / 2 - 0.5),
    z: Math.round(wz / TILE + MAP_H / 2 - 0.5),
  };
}

/**
 * Vrai si des soldats peuvent se tenir sur cette tuile (pas d'eau, pas de rocher).
 * @param {object} map
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
export function isWalkable(map, x, z) {
  const t = tileAt(map, x, z);
  return t === 'grass' || t === 'road' || t === 'forest';
}
