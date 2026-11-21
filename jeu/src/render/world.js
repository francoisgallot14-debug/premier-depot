// Le monde 3D : terrain, bâtiments (avec ruines, dégâts, fumée), vie du village en préparation,
// unités de bataille interpolées, fantôme de placement, sélection, drapeau de ralliement, sélection
// de tuile par rayon. Ne modifie jamais l'état du jeu : il ne fait que le lire.
import * as THREE from 'three';
import { createTerrain, TILE } from './terrain.js';
import { createCrowd } from './units.js';
import { createFx } from './fx.js';
import {
  createBuildingModel, getBuildingGeometry, getRuinGeometry, getMaterials, getFlagGeometry,
  getRallyPoleGeometry, unitKeyFor, BUILDING_INFO, SHARED_UNIFORMS, hashStr,
} from './models.js';

export { TILE };

/** Types de bâtiments « linéaires » orientés selon la route. */
const LINEAIRES = { palissade: true, mur_pierre: true };
/** Ressource portée au retour par les villageois selon le lieu de travail. */
const PORTE = { bucheron: 'bois', carriere: 'pierre', chasseur: 'nourriture', champ: 'nourriture' };
/** Rotation de base de certains modèles (porte vers la caméra par défaut). */
const ROT_BASE = { entrepot: -Math.PI / 2, chasseur: -Math.PI / 2 };
const MAX_MARCHEURS = 12;
/** En bataille, les unités sont grandies pour rester lisibles sur un téléphone. */
const ECHELLE_BATAILLE = 1.4;
/** Taille d'affichage par défaut si l'unité n'en donne pas (le cœur fournit `size`). */
const TAILLE_DEFAUT = { en_soudard: 1.1, en_belier: 1.6, en_chef: 1.4 };
const HAUTEUR_UNITE = 0.9;
/** Amplitude du geste d'attaque : les lanciers et archers font un geste court (estoc, tir). */
const GESTE = { ally_f2: 0.4, ally_f3: 0.4, ally_archer: 0.55, en_archer: 0.55 };

const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
/** Côté d'une unité/événement : true = ennemi, false = allié, null = inconnu. */
function sideOf(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  if (v === 'enemy') return true; // formes du cœur : chemin rapide sans allocation
  if (v === 'ally') return false;
  const s = String(v).toLowerCase();
  if (s.startsWith('en') || s === 'foe' || s === 'red' || s === 'attaquant') return true; // enemy / ennemi
  if (s.startsWith('al') || s.startsWith('sol') || s === 'player' || s === 'joueur' || s === 'army' || s === 'armee' || s === 'blue') return false;
  return null;
}

/**
 * API du monde 3D (renvoyée par createWorld).
 * @typedef {object} World
 * @property {(state: object) => void} syncState Lit l'état du jeu (bâtiments, ruines, PV, ouvriers,
 *   soldats, drapeau). Appeler après chaque changement d'état (peu coûteux, peut l'être à chaque image).
 * @property {(battle: object|null, alpha?: number) => void} syncBattle Lit la bataille à chaque image
 *   (battle.units, battle.buildings, battle.rally) ; alpha = fraction 0..1 entre deux pas fixes.
 *   null quitte le mode bataille (retour aux villageois et à la formation au drapeau).
 * @property {(events: object[]) => void} consumeEvents Transforme battle.events en effets puis vide le tableau.
 * @property {(type: string, x: number, z: number, valid: boolean, rangeTiles?: number) => void} setGhost
 *   Fantôme de placement (vert/rouge) + grille ; rangeTiles > 0 dessine la portée d'une tour.
 * @property {() => void} clearGhost Retire le fantôme et la grille.
 * @property {(tiles: {x: number, z: number}[]|null) => void} setHints Surligne les cases possibles (mode construction).
 * @property {(clientX: number, clientY: number) => ({x: number, z: number}|null)} pickTile Tuile sous le doigt.
 * @property {(x: number, z: number, height?: number, out?: object) => {x: number, y: number, visible: boolean}} tileToScreen
 *   Position écran (px CSS relatifs à la toile) d'une tuile, pour ancrer un bouton.
 * @property {(x: number, z: number, animate?: boolean) => void} setRally Déplace le drapeau de ralliement.
 * @property {(on: boolean) => void} showRallyRange Cercle d'action de l'armée (mode « Déplacer l'armée »).
 * @property {(x: number|null, z?: number) => void} setSelected Surligne une tuile (null pour effacer).
 * @property {(x: number, z: number) => {x: number, y: number, z: number}} tileToWorld Centre 3D d'une tuile.
 * @property {{minX: number, maxX: number, minZ: number, maxZ: number}} bounds Bornes pour la caméra.
 * @property {(dt: number) => void} update Anime tout (à appeler à chaque image, dt en secondes).
 * @property {(q: string) => void} setQuality Densité des effets ('economie' | 'normale').
 * @property {() => {buildings: number, ruins: number, battleUnits: number, walkers: number}} getStats Compteurs (tests).
 * @property {object} fx Effets (voir fx.js), ex. world.fx.celebrate(x, y, z).
 * @property {object} terrain Terrain (heightAt, tileHeight…).
 * @property {boolean} battleActive Vrai entre le premier syncBattle(battle) et syncBattle(null).
 * @property {() => void} dispose Libère tout.
 */

/**
 * Crée le monde 3D.
 * @param {THREE.Scene} scene scène three.js (voir createRenderer)
 * @param {{w:number,h:number,tiles:string[][],path:{x:number,z:number}[],hall:{x:number,z:number},spawn:{x:number,z:number},defaultRally:{x:number,z:number}}} map carte (spec §2)
 * @param {{
 *   camera: THREE.Camera, canvas: HTMLElement,
 *   defs?: Object<string, {pv?: number}>, // table des bâtiments de data.js (pour les PV max)
 *   quality?: string, seed?: number,
 *   onShake?: (strength: number) => void, // secousse caméra (bâtiment détruit, piège)
 *   formation?: {spacing: number, perRow: number}, // formation au drapeau en préparation (COMBAT.espacementFormation / soldatsParRang)
 *   maxHpOf?: (building: object) => number // PV max réels (talents compris), ex. (b) => buildingMaxHp(state, b)
 * }} opts
 * @returns {World}
 */
export function createWorld(scene, map, opts = {}) {
  const camera = opts.camera;
  const canvas = opts.canvas;
  const defs = opts.defs || {};
  const onShake = opts.onShake || null;
  const formation = { spacing: 0.7, perRow: 4, ...(opts.formation || {}) };
  // rayon d'action de l'armée autour du drapeau : donné par main.js (COMBAT.laisse de data.js)
  const LEASH_TUILES = num(opts.leash, 3.5);
  const W = map.w, H = map.h;
  const root = new THREE.Group();
  root.name = 'monde';
  scene.add(root);
  const mats = getMaterials();

  const terrain = createTerrain(map, { seed: opts.seed ?? 7 });
  root.add(terrain.group);
  const fx = createFx(root, { heightAt: terrain.heightAt, quality: opts.quality });
  const crowd = createCrowd(root, { capacity: 72 });

  // Taille de la toile gardée en mémoire (lire getBoundingClientRect à chaque image forcerait
  // un recalcul de mise en page) : mise à jour au redimensionnement.
  const rectToile = { left: 0, top: 0, width: 0, height: 0 };
  function lireRect() {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    rectToile.left = r.left; rectToile.top = r.top; rectToile.width = r.width; rectToile.height = r.height;
  }
  lireRect();
  let observateur = null;
  if (canvas && typeof ResizeObserver !== 'undefined') {
    observateur = new ResizeObserver(lireRect);
    observateur.observe(canvas);
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', lireRect);

  const tileWX = (x) => (x - W / 2 + 0.5) * TILE;
  const tileWZ = (z) => (z - H / 2 + 0.5) * TILE;
  const tileAt = (x, z) => (x >= 0 && z >= 0 && x < W && z < H ? map.tiles[z][x] : null);

  // index du chemin par tuile (orientation des palissades/murs)
  const pathIndex = new Int16Array(W * H).fill(-1);
  (map.path || []).forEach((p, i) => { if (p.x >= 0 && p.z >= 0 && p.x < W && p.z < H) pathIndex[p.z * W + p.x] = i; });

  // ---------------------------------------------------------------------------------
  // Bâtiments
  // ---------------------------------------------------------------------------------
  const recs = new Map(); // id -> rec
  const recList = []; // mêmes enregistrements, parcourus à chaque image sans allocation
  const occupied = new Int32Array(W * H).fill(0); // id+1 du bâtiment sur la tuile (0 = libre)
  let syncStamp = 0;
  let firstSync = true;

  function hpMaxOf(type, b) {
    if (opts.maxHpOf && b) {
      const v = opts.maxHpOf(b);
      if (v > 0) return v;
    }
    const d = defs[type];
    return num(b && (b.hpMax ?? b.maxHp ?? b.pvMax), num(d && (d.pv ?? d.hp), 0));
  }

  /** Orientation de la route en une tuile du chemin : 0 si elle va surtout selon z, π/2 selon x. */
  function roadAcross(pi) {
    const P = map.path;
    const a = P[Math.max(0, pi - 1)], b = P[Math.min(P.length - 1, pi + 1)];
    // la route va surtout selon z : le mur s'étend selon x (rotation 0) pour la barrer
    return Math.abs(b.z - a.z) >= Math.abs(b.x - a.x) ? 0 : Math.PI / 2;
  }

  /** Orientation d'un mur/palissade : en travers de la route, sinon raccordé aux voisins. */
  function linearYaw(x, z) {
    const pi = pathIndex[z * W + x];
    if (pi >= 0) return roadAcross(pi);
    const linAt = (xx, zz) => {
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) return false;
      const id = occupied[zz * W + xx] - 1;
      const r = id >= 0 ? recs.get(id) : null;
      return !!(r && LINEAIRES[r.type]);
    };
    const ex = linAt(x - 1, z) || linAt(x + 1, z), ez = linAt(x, z - 1) || linAt(x, z + 1);
    if (ex && !ez) return 0;
    if (ez && !ex) return Math.PI / 2;
    // sinon : prolonge la barrière de la route la plus proche
    let best = 1e9, yaw = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
      const p = pathIndex[zz * W + xx];
      if (p < 0) continue;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; yaw = roadAcross(p); }
    }
    return yaw;
  }

  /** Réoriente les murs/palissades hors route (quand un voisin apparaît ou disparaît). */
  function reorientLinears() {
    for (const r of recList) {
      if (!LINEAIRES[r.type] || pathIndex[r.z * W + r.x] >= 0) continue;
      r.group.rotation.y = r.ruin.rotation.y = linearYaw(r.x, r.z);
    }
  }

  function yawFor(type, x, z, id) {
    if (LINEAIRES[type]) return linearYaw(x, z);
    if (type === 'piege') return 0;
    const j = ((hashStr(type + ':' + x + ':' + z) % 100) / 100 - 0.5) * 0.12;
    return (ROT_BASE[type] || 0) + (type === 'maison_commune' ? 0 : j) + (type === 'hutte' ? (id % 4) * 0.7 : 0);
  }

  function makeRec(b) {
    const group = createBuildingModel(b.type);
    const wx = tileWX(b.x), wz = tileWZ(b.z);
    const wy = terrain.tileHeight(b.x, b.z);
    group.position.set(wx, wy, wz);
    group.rotation.y = yawFor(b.type, b.x, b.z, b.id);
    root.add(group);
    const ruin = new THREE.Group();
    const rg = getRuinGeometry(b.type);
    const rl = new THREE.Mesh(rg.lit, mats.lit);
    rl.castShadow = true; rl.receiveShadow = true;
    ruin.add(rl);
    if (rg.glow) ruin.add(new THREE.Mesh(rg.glow, mats.glow));
    ruin.position.copy(group.position);
    ruin.rotation.y = group.rotation.y;
    ruin.visible = false;
    root.add(ruin);
    const info = BUILDING_INFO[b.type] || BUILDING_INFO.hutte;
    return {
      id: b.id, type: b.type, x: b.x, z: b.z, wx, wy, wz, group, ruin, info,
      destroyed: false, hp: 0, hpMax: hpMaxOf(b.type, b), ratio: 1,
      pop: firstSync ? 1 : 0, flash: 0, smokeT: Math.random(), chimT: Math.random() * 2, ruinSmoke: 0,
      trapT: -1, trapReady: true, trapProgress: 1, seen: 0, mat: 'lit', ringT: 0,
      archerYaw: Math.PI, archerShot: 9, archerLook: Math.random() * 6,
    };
  }

  function setRecMaterial(r) {
    const want = r.flash > 0 ? 'flash' : r.ratio < 0.5 ? 'damaged' : 'lit';
    if (r.type === 'piege' && want !== 'lit') return;
    if (want !== r.mat) {
      r.mat = want;
      r.group.userData.lit.material = mats[want];
    }
  }

  function setDestroyed(r, destroyed, animate) {
    if (r.destroyed === destroyed) return;
    r.destroyed = destroyed;
    r.group.visible = !destroyed;
    r.ruin.visible = destroyed;
    if (destroyed && animate) {
      fx.collapse(r.wx, r.wy, r.wz, r.info.wood);
      r.ruinSmoke = 9;
      if (onShake) onShake(0.35);
    }
    if (!destroyed) {
      r.pop = animate ? 0 : 1;
      if (animate) fx.dust(r.wx, r.wy, r.wz, 12);
    }
  }

  function applyHp(r, hp, hpMax) {
    if (hpMax > 0) r.hpMax = hpMax;
    r.hp = hp;
    r.ratio = r.hpMax > 0 ? Math.max(0, Math.min(1, hp / r.hpMax)) : 1;
  }

  function removeRec(r, animate = false) {
    if (animate) {
      // démolition : un nuage de poussière et quelques débris
      fx.dust(r.wx, r.wy, r.wz, 14);
      fx.debris(r.wx, r.wy + 0.4, r.wz, 8, r.info.wood ? 'wood' : 'stone');
    }
    const li = recList.indexOf(r);
    if (li >= 0) recList.splice(li, 1);
    r.group.removeFromParent();
    r.ruin.removeFromParent();
    if (occupied[r.z * W + r.x] === r.id + 1) occupied[r.z * W + r.x] = 0;
    terrain.setTileOccupied(r.x, r.z, false);
    recs.delete(r.id);
  }

  // ---------------------------------------------------------------------------------
  // Drapeau de ralliement
  // ---------------------------------------------------------------------------------
  const rally = new THREE.Group();
  const poleGeo = getRallyPoleGeometry();
  const pole = new THREE.Mesh(poleGeo, mats.lit);
  pole.castShadow = true;
  rally.add(pole);
  const rallyFlag = new THREE.Mesh(getFlagGeometry(), mats.flag);
  rallyFlag.position.set(0.03, 1.55, 0);
  rallyFlag.scale.setScalar(0.75);
  rallyFlag.castShadow = true;
  rally.add(rallyFlag);
  const leashGeo = new THREE.RingGeometry(0.955, 1, 72);
  leashGeo.rotateX(-Math.PI / 2);
  // dessiné par-dessus le relief (sinon l'herbe, plus haute que la route, en cache des morceaux)
  const leashMat = new THREE.MeshBasicMaterial({ color: 0xc4e2ff, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false });
  const leash = new THREE.Mesh(leashGeo, leashMat);
  leash.scale.setScalar(LEASH_TUILES * TILE);
  leash.position.y = 0.08;
  leash.visible = false;
  leash.renderOrder = 3;
  rally.add(leash);
  const leashFillGeo = new THREE.CircleGeometry(1, 48);
  leashFillGeo.rotateX(-Math.PI / 2);
  const leashFill = new THREE.Mesh(leashFillGeo, new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.14, depthWrite: false, depthTest: false }));
  leashFill.scale.setScalar(LEASH_TUILES * TILE);
  leashFill.position.y = 0.07;
  leashFill.visible = false;
  leashFill.renderOrder = 2;
  rally.add(leashFill);
  root.add(rally);
  const rallyTile = { x: -1, z: -1 };
  const rallyAnim = { fx: 0, fz: 0, tx: 0, tz: 0, t: 1 };

  function setRally(x, z, animate = true) {
    if (x === rallyTile.x && z === rallyTile.z) return;
    const first = rallyTile.x < 0;
    rallyTile.x = x; rallyTile.z = z;
    rallyAnim.fx = rally.position.x; rallyAnim.fz = rally.position.z;
    rallyAnim.tx = tileWX(x); rallyAnim.tz = tileWZ(z);
    rallyAnim.t = first || !animate ? 1 : 0;
    if (rallyAnim.t >= 1) rally.position.set(rallyAnim.tx, terrain.heightAt(rallyAnim.tx, rallyAnim.tz), rallyAnim.tz);
    else fx.ring(rallyAnim.tx, terrain.heightAt(rallyAnim.tx, rallyAnim.tz), rallyAnim.tz, 1.6, 0x9cc8ff, 0.5);
  }
  const dr = map.defaultRally || map.hall || { x: W >> 1, z: H >> 1 };
  setRally(dr.x, dr.z, false);

  // ---------------------------------------------------------------------------------
  // Sélection, fantôme de placement, grille
  // ---------------------------------------------------------------------------------
  // carré doré (anneau à 4 côtés) tracé par-dessus le décor
  const selGeo = new THREE.RingGeometry(1.36, 1.56, 4, 1, Math.PI / 4);
  selGeo.rotateX(-Math.PI / 2);
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffd95a, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false });
  const selection = new THREE.Mesh(selGeo, selMat);
  selection.visible = false;
  selection.renderOrder = 12;
  root.add(selection);

  const ghost = new THREE.Group();
  ghost.visible = false;
  root.add(ghost);
  const ghostMesh = new THREE.Mesh(getBuildingGeometry('hutte').lit, mats.ghostOk);
  ghostMesh.renderOrder = 6;
  ghost.add(ghostMesh);
  const tileFillGeo = new THREE.PlaneGeometry(TILE * 0.96, TILE * 0.96);
  tileFillGeo.rotateX(-Math.PI / 2);
  const tileFillMat = new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0.32, depthWrite: false });
  const tileFill = new THREE.Mesh(tileFillGeo, tileFillMat);
  tileFill.position.y = 0.06;
  tileFill.renderOrder = 4;
  ghost.add(tileFill);
  const rangeGeo = new THREE.RingGeometry(0.965, 1, 72);
  rangeGeo.rotateX(-Math.PI / 2);
  const rangeMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.85, depthWrite: false });
  const rangeRing = new THREE.Mesh(rangeGeo, rangeMat);
  rangeRing.position.y = 0.09;
  rangeRing.renderOrder = 4;
  ghost.add(rangeRing);
  const rangeFill = new THREE.Mesh(leashFillGeo, new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.12, depthWrite: false }));
  rangeFill.position.y = 0.08;
  rangeFill.renderOrder = 3;
  ghost.add(rangeFill);
  let ghostT = 0;

  // grille de placement (visible avec le fantôme)
  const gl = [];
  const x0 = -W / 2 * TILE, z0 = -H / 2 * TILE;
  for (let i = 0; i <= W; i++) gl.push(x0 + i * TILE, 0.05, z0, x0 + i * TILE, 0.05, z0 + H * TILE);
  for (let j = 0; j <= H; j++) gl.push(x0, 0.05, z0 + j * TILE, x0 + W * TILE, 0.05, z0 + j * TILE);
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.visible = false;
  grid.renderOrder = 2;
  root.add(grid);

  // cases où le bâtiment choisi peut être posé (mode construction) : carrés dorés avec un contour
  // clair, qui tranchent sur l'herbe verte (le tutoriel parle de « cases dorées »)
  const hintGeo = new THREE.PlaneGeometry(TILE * 0.84, TILE * 0.84);
  hintGeo.rotateX(-Math.PI / 2);
  const hintMat = new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.3, depthWrite: false });
  const hints = new THREE.InstancedMesh(hintGeo, hintMat, W * H);
  hints.count = 0;
  hints.frustumCulled = false;
  hints.renderOrder = 3;
  hints.visible = false;
  root.add(hints);
  // contour carré : anneau à 4 côtés tourné de 45°
  const hintEdgeGeo = new THREE.RingGeometry(TILE * 0.6, TILE * 0.66, 4, 1, Math.PI / 4);
  hintEdgeGeo.rotateX(-Math.PI / 2);
  const hintEdgeMat = new THREE.MeshBasicMaterial({ color: 0xfff2c2, transparent: true, opacity: 0.8, depthWrite: false });
  const hintEdges = new THREE.InstancedMesh(hintEdgeGeo, hintEdgeMat, W * H);
  hintEdges.count = 0;
  hintEdges.frustumCulled = false;
  hintEdges.renderOrder = 4;
  hintEdges.visible = false;
  root.add(hintEdges);
  const _hm = new THREE.Matrix4();
  /** Surligne une liste de tuiles ({x, z}) ; null ou [] pour effacer. */
  function setHints(tiles) {
    let n = 0;
    if (Array.isArray(tiles)) {
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (!t || t.x < 0 || t.z < 0 || t.x >= W || t.z >= H) continue;
        _hm.makeTranslation(tileWX(t.x), terrain.tileHeight(t.x, t.z) + 0.09, tileWZ(t.z));
        hints.setMatrixAt(n, _hm);
        hintEdges.setMatrixAt(n, _hm);
        n++;
      }
    }
    hints.count = hintEdges.count = n;
    hints.instanceMatrix.needsUpdate = true;
    hintEdges.instanceMatrix.needsUpdate = true;
    hints.visible = hintEdges.visible = n > 0;
  }

  let ghostType = null;
  function setGhost(type, x, z, valid, rangeTiles = 0) {
    if (type !== ghostType) {
      ghostType = type;
      ghostMesh.geometry = getBuildingGeometry(type).lit;
    }
    const wx = tileWX(x), wz = tileWZ(z);
    ghost.position.set(wx, terrain.tileHeight(x, z), wz);
    ghostMesh.rotation.y = yawFor(type, x, z, 0);
    ghostMesh.material = valid ? mats.ghostOk : mats.ghostBad;
    tileFillMat.color.set(valid ? 0x7dff8a : 0xff5a4a);
    const r = num(rangeTiles, 0) * TILE;
    rangeRing.visible = rangeFill.visible = r > 0;
    if (r > 0) { rangeRing.scale.set(r, 1, r); rangeFill.scale.set(r, 1, r); }
    ghost.visible = true;
    grid.visible = true;
    if (x >= 0 && z >= 0 && x < W && z < H) terrain.setTileOccupied(x, z, true);
    if (ghostTile.x >= 0 && (ghostTile.x !== x || ghostTile.z !== z) && !occupied[ghostTile.z * W + ghostTile.x]) {
      terrain.setTileOccupied(ghostTile.x, ghostTile.z, false);
    }
    ghostTile.x = x; ghostTile.z = z;
  }
  const ghostTile = { x: -1, z: -1 };
  function clearGhost() {
    ghost.visible = false;
    grid.visible = false;
    if (ghostTile.x >= 0 && !occupied[ghostTile.z * W + ghostTile.x]) terrain.setTileOccupied(ghostTile.x, ghostTile.z, false);
    ghostTile.x = ghostTile.z = -1;
  }

  // ---------------------------------------------------------------------------------
  // Vie du village (préparation) : villageois qui vont travailler, soldats au drapeau
  // ---------------------------------------------------------------------------------
  const walkers = [];
  for (let i = 0; i < MAX_MARCHEURS + 3; i++) {
    walkers.push({
      active: false, key: 'vil_' + (i % 3), pts: new Float32Array(160), n: 0, seg: 0, segT: 0, dir: 1,
      state: 0, timer: 0, carry: null, x: 0, z: 0, yaw: 0, phase: Math.random() * 6, lane: ((i * 7) % 5 - 2) * 0.13,
      workType: '', idle: false, homeX: 0, homeZ: 0, speed: 1.05 + (i % 4) * 0.08,
    });
  }
  let walkerSig = -1;
  let prepSoldiers = null;
  const bfsPrev = new Int16Array(W * H);
  const bfsQueue = new Int16Array(W * H);

  function walkable(x, z, ax, az, bx, bz) {
    const t = tileAt(x, z);
    if (!t || t === 'water' || t === 'forest' || t === 'rock') return (x === ax && z === az) || (x === bx && z === bz);
    if (occupied[z * W + x] && !((x === ax && z === az) || (x === bx && z === bz))) {
      const r = recs.get(occupied[z * W + x] - 1);
      return !!(r && (r.type === 'piege' || r.type === 'champ' || r.destroyed));
    }
    return true;
  }

  /** Chemin en tuiles (BFS) écrit dans w.pts en coordonnées monde, extrémités au bord des tuiles. */
  function planPath(w, ax, az, bx, bz) {
    bfsPrev.fill(-1);
    let head = 0, tail = 0;
    const start = az * W + ax, goal = bz * W + bx;
    bfsQueue[tail++] = start;
    bfsPrev[start] = start;
    while (head < tail) {
      const c = bfsQueue[head++];
      if (c === goal) break;
      const cx = c % W, cz = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const ni = nz * W + nx;
        if (bfsPrev[ni] >= 0 || !walkable(nx, nz, ax, az, bx, bz)) continue;
        bfsPrev[ni] = c;
        bfsQueue[tail++] = ni;
      }
    }
    let n = 0;
    if (bfsPrev[goal] < 0) {
      w.pts[0] = tileWX(ax); w.pts[1] = tileWZ(az); w.pts[2] = tileWX(bx); w.pts[3] = tileWZ(bz);
      n = 2;
    } else {
      // remonte le chemin (de l'arrivée vers le départ) puis inverse
      let c = goal;
      while (n < 78) {
        w.pts[n * 2] = tileWX(c % W); w.pts[n * 2 + 1] = tileWZ((c / W) | 0);
        n++;
        if (c === start) break;
        c = bfsPrev[c];
      }
      for (let i = 0; i < n / 2; i++) {
        const j = n - 1 - i;
        let t = w.pts[i * 2]; w.pts[i * 2] = w.pts[j * 2]; w.pts[j * 2] = t;
        t = w.pts[i * 2 + 1]; w.pts[i * 2 + 1] = w.pts[j * 2 + 1]; w.pts[j * 2 + 1] = t;
      }
    }
    // raccourcit les extrémités : on sort par la « porte » du bâtiment
    if (n >= 2) {
      for (const [a, b] of [[0, 1], [n - 1, n - 2]]) {
        const dx = w.pts[b * 2] - w.pts[a * 2], dz = w.pts[b * 2 + 1] - w.pts[a * 2 + 1];
        const L = Math.hypot(dx, dz) || 1;
        const cut = Math.min(0.85, L * 0.45);
        w.pts[a * 2] += (dx / L) * cut; w.pts[a * 2 + 1] += (dz / L) * cut;
      }
    }
    w.n = n;
  }

  function computeWalkers(state) {
    const hall = map.hall;
    let sig = 17, total = 0;
    for (const b of state.buildings || []) {
      if (b.destroyed) continue;
      const wk = num(b.workers, 0);
      if (wk > 0) sig = (sig * 31 + b.id * 7 + wk * 131 + b.x * 3 + b.z) | 0;
      total += wk;
    }
    const free = Math.max(0, num(state.villagers, 0) - total);
    const idleN = Math.min(3, free);
    sig = (sig * 31 + idleN) | 0;
    let hallRec = null;
    for (const r of recList) if (r.type === 'maison_commune') hallRec = r;
    sig = (sig * 31 + (hallRec && !hallRec.destroyed ? 1 : 0)) | 0;
    if (sig === walkerSig) return;
    walkerSig = sig;
    for (const w of walkers) w.active = false;
    if (!hallRec || hallRec.destroyed) return;
    let wi = 0;
    for (const b of state.buildings || []) {
      if (b.destroyed) continue;
      const wk = num(b.workers, 0);
      for (let k = 0; k < wk && wi < MAX_MARCHEURS; k++) {
        const w = walkers[wi++];
        w.active = true; w.idle = false; w.workType = b.type;
        planPath(w, hall.x, hall.z, b.x, b.z);
        w.seg = 0; w.segT = 0; w.dir = 1; w.carry = null;
        // départs décalés pour que tout le monde ne marche pas en file indienne
        w.state = 3; w.timer = k * 1.7 + (wi % 3) * 0.6;
        w.x = w.pts[0]; w.z = w.pts[1];
      }
    }
    for (let k = 0; k < idleN; k++) {
      const w = walkers[MAX_MARCHEURS + k];
      w.active = true; w.idle = true; w.carry = null;
      w.homeX = tileWX(hall.x); w.homeZ = tileWZ(hall.z) + TILE * 0.9;
      w.x = w.homeX + (k - 1) * 0.6; w.z = w.homeZ + 0.3;
      w.pts[0] = w.x; w.pts[1] = w.z; w.pts[2] = w.x; w.pts[3] = w.z; w.n = 2;
      w.state = 1; w.timer = 1 + k; w.seg = 0; w.segT = 0;
    }
  }

  function updateWalker(w, dt) {
    if (w.state === 0) {
      // marche le long du chemin (dir = 1 aller, -1 retour)
      const n = w.n;
      const i0 = w.dir > 0 ? w.seg : n - 1 - w.seg;
      const i1 = i0 + w.dir;
      if (w.seg >= n - 1 || i1 < 0 || i1 >= n) { w.state = 1; w.timer = w.idle ? 2 + Math.random() * 3 : w.dir > 0 ? 2.5 + Math.random() * 2 : 1 + Math.random(); return; }
      const ax = w.pts[i0 * 2], az = w.pts[i0 * 2 + 1], bx = w.pts[i1 * 2], bz = w.pts[i1 * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az) || 0.001;
      w.segT += (w.speed * dt) / L;
      if (w.segT >= 1) { w.seg++; w.segT = 0; return; }
      const px = -(bz - az) / L * w.lane, pz = (bx - ax) / L * w.lane;
      w.x = ax + (bx - ax) * w.segT + px;
      w.z = az + (bz - az) * w.segT + pz;
      w.yaw += angleDiff(w.yaw, Math.atan2(bx - ax, bz - az)) * Math.min(1, dt * 10);
      w.phase += dt * 9;
    } else {
      // pause : au travail (on s'active) ou à la maison commune
      w.timer -= dt;
      if (w.timer > 0) return;
      if (w.idle) {
        // flânerie autour de la maison commune
        const a = Math.random() * Math.PI * 2, r = 0.8 + Math.random() * 2.2;
        w.pts[0] = w.x; w.pts[1] = w.z;
        w.pts[2] = w.homeX + Math.cos(a) * r; w.pts[3] = w.homeZ + Math.abs(Math.sin(a)) * r;
        w.n = 2; w.dir = 1; w.seg = 0; w.segT = 0; w.state = 0;
        return;
      }
      const atWork = w.dir > 0 && w.state === 1;
      if (atWork) { w.dir = -1; w.carry = PORTE[w.workType] || null; } else { w.dir = 1; w.carry = null; }
      w.seg = 0; w.segT = 0; w.state = 0;
    }
  }

  // ---------------------------------------------------------------------------------
  // Unités de bataille (interpolées, animées)
  // ---------------------------------------------------------------------------------
  const VIS_MAX = 160;
  const visPool = [];
  for (let i = 0; i < VIS_MAX; i++) {
    visPool.push({
      used: false, enemy: false, id: 0, key: 'ally_f0', type: '', px: 0, pz: 0, cx: 0, cz: 0, tx: 0, tz: 0,
      wx: 0, wz: 0, yaw: 0, phase: 0, lunge: 0, lastEvLunge: -9, autoT: 0, flash: 0, hp: 1, hpMax: 1,
      dying: false, deathT: 0, roll: 0, seen: 0, appear: 1, moving: 0, engaged: false, targetId: null, scale: 1,
      cadence: 1, fresh: false, size: 1, facing: null, lungeExt: false, retreat: false, targetBuilding: null,
    });
  }
  const visAlly = new Map();
  const visEnemy = new Map();
  let battleActive = false;
  let battleRef = null;
  let lastTick = null;
  let battleStamp = 0;
  let clock = 0;

  function getVis(enemy, id, create) {
    const map_ = enemy ? visEnemy : visAlly;
    let v = map_.get(id);
    if (v || !create) return v || null;
    for (const p of visPool) if (!p.used) { v = p; break; }
    if (!v) return null;
    v.used = true; v.enemy = enemy; v.id = id; v.dying = false; v.deathT = 0; v.lunge = 0; v.flash = 0;
    v.appear = 0; v.phase = Math.random() * 6; v.lastEvLunge = -9; v.autoT = Math.random(); v.roll = 0;
    v.facing = null; v.lungeExt = false; v.retreat = false; v.targetBuilding = null; v.targetId = null;
    v.scale = 0.95 + ((hashStr(String(id)) % 100) / 100) * 0.1;
    v.fresh = true;
    map_.set(id, v);
    return v;
  }
  function freeVis(v) {
    (v.enemy ? visEnemy : visAlly).delete(v.id);
    v.used = false;
  }
  function clearBattleVis() {
    for (const v of visPool) v.used = false;
    visAlly.clear(); visEnemy.clear();
  }

  function readUnit(u, enemy, tickChanged, hasTick, alpha) {
    if (!u) return;
    const id = u.id ?? u.uid;
    if (id === undefined) return;
    const dead = u.state === 'dead' || u.dead === true || u.alive === false || num(u.hp, 1) <= 0;
    const v = getVis(enemy, id, !dead);
    if (!v) return;
    v.seen = battleStamp;
    const ux = num(u.x ?? (u.pos && u.pos.x), v.cx), uz = num(u.z ?? (u.pos && u.pos.z), v.cz);
    const type = u.type ?? u.kind ?? (enemy ? 'pillard' : 'fantassin');
    v.type = type;
    v.key = unitKeyFor(enemy, type, num(u.equip, 0));
    v.size = num(u.size, TAILLE_DEFAUT[v.key] || 1);
    if (v.fresh) {
      v.px = v.cx = v.tx = ux; v.pz = v.cz = v.tz = uz;
      v.wx = tileWX(ux); v.wz = tileWZ(uz);
      v.yaw = typeof u.facing === 'number' ? u.facing : enemy ? 0 : Math.PI;
      v.fresh = false;
    } else if (u.prevX !== undefined || u.px !== undefined) {
      v.px = num(u.prevX ?? u.px, ux); v.pz = num(u.prevZ ?? u.pz, uz); v.cx = ux; v.cz = uz;
    } else if (hasTick) {
      if (tickChanged) { v.px = v.cx; v.pz = v.cz; v.cx = ux; v.cz = uz; }
    } else {
      v.px = v.cx = ux; v.pz = v.cz = uz;
    }
    v.tx = v.px + (v.cx - v.px) * alpha;
    v.tz = v.pz + (v.cz - v.pz) * alpha;
    v.hp = num(u.hp, v.hp);
    v.hpMax = num(u.maxHp ?? u.hpMax ?? u.pvMax, Math.max(v.hpMax, v.hp));
    // cible : unité ou bâtiment (les identifiants des deux ne sont pas dans le même espace)
    const tid = u.targetId ?? (typeof u.target === 'number' ? u.target : u.target && u.target.id) ?? null;
    if (u.targetKind === 'building') { v.targetBuilding = tid; v.targetId = null; } else { v.targetId = tid; v.targetBuilding = null; }
    const st = typeof u.state === 'string' ? u.state : '';
    v.engaged = tid !== null || st === 'attack' || st === 'fight' || st === 'combat' || st === 'attaque';
    v.cadence = num(u.cadence ?? u.attackInterval, v.key === 'en_belier' ? 2 : 1);
    v.facing = typeof u.facing === 'number' ? u.facing : null;
    // animation de coup fournie par le cœur (0 → 1 pendant le coup, 1 au repos)
    if (typeof u.attackProgress === 'number') {
      v.lungeExt = true;
      v.lunge = u.attackProgress < 1 ? 1 - u.attackProgress : 0;
    }
    if (typeof u.hitTime === 'number' && u.hitTime < 0.2) v.flash = Math.max(v.flash, 1 - u.hitTime / 0.2);
    if (dead && !v.dying) { v.retreat = !!u.retreated; startDeath(v); }
  }

  function startDeath(v) {
    if (v.dying) return;
    v.dying = true;
    v.deathT = 0;
    v.flash = v.retreat ? 0 : 1;
    v.roll = (hashStr('m' + v.id) % 2 ? 1 : -1);
    const y = terrain.heightAt(v.wx, v.wz);
    if (v.retreat) return;
    if (v.key === 'en_belier') {
      fx.debris(v.wx, y + 0.5, v.wz, 16, 'wood');
      fx.dust(v.wx, y, v.wz, 12);
    } else {
      fx.dust(v.wx, y, v.wz, 5);
    }
  }

  /** Lit toutes les unités (formes acceptées : units[] avec side, ou enemies[] + soldiers[]). */
  function readUnits(battle, tickChanged, hasTick, a) {
    if (Array.isArray(battle.units)) {
      const U = battle.units;
      for (let i = 0; i < U.length; i++) {
        const u = U[i];
        let e = sideOf(u.side ?? u.team ?? u.camp);
        if (e === null) e = u.enemy === true || (u.kind !== 'fantassin' && u.kind !== 'archer' && u.type !== 'fantassin');
        readUnit(u, e, tickChanged, hasTick, a);
      }
      return;
    }
    const E = battle.enemies;
    if (Array.isArray(E)) for (let i = 0; i < E.length; i++) readUnit(E[i], true, tickChanged, hasTick, a);
    const S = battle.soldiers || battle.allies;
    if (Array.isArray(S)) for (let i = 0; i < S.length; i++) readUnit(S[i], false, tickChanged, hasTick, a);
  }

  /**
   * Lit l'état de la bataille pour l'image (à appeler chaque image pendant la vague).
   * @param {object|null} battle objet de battle.js, ou null pour quitter le mode bataille
   * @param {number} [alpha] fraction 0..1 entre deux pas de simulation (interpolation)
   */
  function syncBattle(battle, alpha = 1) {
    if (!battle) {
      if (battleActive) { battleActive = false; battleRef = null; clearBattleVis(); }
      return;
    }
    if (battle !== battleRef) {
      clearBattleVis();
      battleRef = battle;
      lastTick = null;
    }
    battleActive = true;
    battleStamp++;
    const tick = battle.tick ?? battle.steps ?? battle.step ?? battle.frame ?? battle.time ?? battle.t;
    const hasTick = typeof tick === 'number';
    const tickChanged = hasTick && tick !== lastTick;
    lastTick = tick;
    const a = Math.max(0, Math.min(1, num(alpha, 1)));
    readUnits(battle, tickChanged, hasTick, a);
    // unités disparues des listes : elles meurent
    for (let i = 0; i < VIS_MAX; i++) {
      const v = visPool[i];
      if (v.used && v.seen !== battleStamp && !v.dying) startDeath(v);
    }
    // bâtiments vus par la bataille (PV en direct, destruction)
    const BB = battle.buildings;
    if (Array.isArray(BB)) {
      for (let i = 0; i < BB.length; i++) {
        const b = BB[i];
        const r = recs.get(b.id);
        if (!r) continue;
        applyHp(r, num(b.hp, r.hp), num(b.maxHp ?? b.hpMax, 0));
        if (b.destroyed && !r.destroyed) setDestroyed(r, true, true);
        if (typeof b.hitTime === 'number' && b.hitTime < 0.1) r.flash = Math.max(r.flash, 0.1 - b.hitTime);
        if (r.type === 'piege') readTrap(r, b.trap || b);
        const tw = b.tower;
        if (tw) {
          if (typeof tw.facing === 'number') r.archerYaw = tw.facing;
          if (typeof tw.shotTime === 'number') r.archerShot = tw.shotTime;
        }
      }
    }
    const T = battle.traps;
    if (Array.isArray(T)) {
      for (let i = 0; i < T.length; i++) {
        const r = recs.get(T[i].buildingId ?? T[i].id);
        if (r) readTrap(r, T[i]);
      }
    }
    if (battle.rally && typeof battle.rally.x === 'number') setRally(Math.round(battle.rally.x), Math.round(battle.rally.z));
  }

  function readTrap(r, t) {
    const cd = num(t.cooldown ?? t.recharge ?? t.reload ?? t.timer, 0);
    const max = num(t.cooldownMax ?? t.rechargeMax ?? t.rechargeTotal, 0);
    if (!t) return;
    if (t.ready !== undefined) r.trapReady = !!t.ready;
    else if (t.charged !== undefined) r.trapReady = !!t.charged;
    else if (t.charge !== undefined) r.trapReady = num(t.charge, 1) >= 1;
    else r.trapReady = cd <= 0;
    r.trapProgress = r.trapReady ? 1 : t.progress !== undefined ? num(t.progress, 0)
      : t.charge !== undefined ? num(t.charge, 0) : max > 0 ? 1 - cd / max : 0;
  }

  // ---------------------------------------------------------------------------------
  // Événements de bataille → effets
  // ---------------------------------------------------------------------------------
  function evXZ(e, keyObj, kx, kz, out) {
    const o = e[keyObj];
    if (o && typeof o.x === 'number') { out.x = o.x; out.z = o.z; return true; }
    if (typeof e[kx] === 'number' && typeof e[kz] === 'number') { out.x = e[kx]; out.z = e[kz]; return true; }
    return false;
  }
  const _from = { x: 0, z: 0 }, _to = { x: 0, z: 0 };

  function findVis(id, enemyHint) {
    if (id === undefined || id === null) return null;
    if (enemyHint === true) return visEnemy.get(id) || null;
    if (enemyHint === false) return visAlly.get(id) || null;
    return visEnemy.get(id) || visAlly.get(id) || null;
  }
  function shootHeightAt(tx, tz) {
    const x = Math.round(tx), z = Math.round(tz);
    if (x < 0 || z < 0 || x >= W || z >= H) return 0.55;
    const id = occupied[z * W + x] - 1;
    const r = id >= 0 ? recs.get(id) : null;
    return r && r.info.shoot ? r.wy + r.info.shoot : 0.55;
  }

  /**
   * Consomme les événements de bataille (puis vide le tableau, comme prévu par la spec §5).
   * @param {Array<object>} events battle.events
   */
  function consumeEvents(events) {
    if (!events || !events.length) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e) continue;
      switch (e.type) {
        case 'arrow': {
          let okF = evXZ(e, 'from', 'fromX', 'fromZ', _from) || evXZ(e, 'from', 'x0', 'z0', _from) || evXZ(e, 'source', 'sx', 'sz', _from);
          let okT = evXZ(e, 'to', 'toX', 'toZ', _to) || evXZ(e, 'to', 'x1', 'z1', _to) || evXZ(e, 'target', 'tx', 'tz', _to);
          const towerSrc = e.sourceKind === 'tower' || (e.buildingId ?? e.towerId) !== undefined;
          const srcRec = towerSrc ? recs.get(e.buildingId ?? e.towerId ?? e.sourceId) || null : null;
          const srcVis = towerSrc ? null : findVis(e.sourceId ?? e.attackerId, sideOf(e.side ?? e.sourceSide));
          if (!okF) {
            if (srcRec) { _from.x = srcRec.x; _from.z = srcRec.z; okF = true; } else if (srcVis) { _from.x = srcVis.cx; _from.z = srcVis.cz; okF = true; }
          }
          if (!okT) {
            const v = findVis(e.targetId, sideOf(e.side) === null ? null : !sideOf(e.side));
            if (v) { _to.x = v.cx; _to.z = v.cz; okT = true; }
          }
          if (!okF || !okT) break;
          let y0;
          if (towerSrc) {
            y0 = shootHeightAt(_from.x, _from.z);
            if (srcRec) { srcRec.archerShot = 0; srcRec.archerYaw = Math.atan2(_to.x - _from.x, _to.z - _from.z); }
          } else {
            y0 = terrain.heightAt(tileWX(_from.x), tileWZ(_from.z)) + 0.55 * (srcVis ? srcVis.size : 1);
          }
          let y1 = terrain.heightAt(tileWX(_to.x), tileWZ(_to.z)) + 0.45;
          if (e.targetKind === 'building') {
            const tr = recs.get(e.targetId);
            if (tr) y1 = tr.wy + Math.min(1.4, tr.info.top * 0.5);
          }
          const dur = num(e.duration ?? e.dur ?? e.travel ?? e.flight, 0.3);
          fx.arrow(tileWX(_from.x), y0, tileWZ(_from.z), tileWX(_to.x), y1, tileWZ(_to.z), dur);
          // l'archer qui tire bande son arc (si le cœur ne l'anime pas déjà)
          if (srcVis && !srcVis.lungeExt) { srcVis.lunge = 1; srcVis.lastEvLunge = clock; }
          break;
        }
        case 'hit': {
          const enemyHint = sideOf(e.targetSide ?? e.side ?? e.team ?? (e.enemy === true ? 'enemy' : undefined));
          const tv = findVis(e.targetId ?? e.target ?? e.id, enemyHint);
          const amount = num(e.amount ?? e.dmg ?? e.damage ?? e.degats ?? e.value, 0);
          let wx, wz, y, isEnemy;
          if (tv) {
            tv.flash = 1;
            wx = tv.wx; wz = tv.wz; isEnemy = tv.enemy;
            y = terrain.heightAt(wx, wz) + (HAUTEUR_UNITE + 0.2) * tv.scale * tv.size * ECHELLE_BATAILLE * (tv.key === 'en_belier' ? 0.8 : 1);
          } else if (evXZ(e, 'pos', 'x', 'z', _to)) {
            wx = tileWX(_to.x); wz = tileWZ(_to.z); y = terrain.heightAt(wx, wz) + 0.95; isEnemy = enemyHint !== false;
          } else break;
          const cause = e.cause ?? e.source;
          if (cause === undefined || cause === 'melee') {
            const av = findVis(e.sourceId ?? e.attackerId, tv ? !tv.enemy : null);
            if (av && !av.lungeExt) { av.lunge = 1; av.lastEvLunge = clock; }
          }
          // même cible touchée plusieurs fois d'un coup : un seul chiffre cumulé (clé = visuel de la cible)
          if (amount > 0 && (amount >= minNombre || cause === 'trap')) fx.number(wx, y, wz, amount, cause === 'trap' ? 'piege' : isEnemy ? 'ennemi' : 'allie', tv || null);
          fx.hitPuff(wx, y - 0.45, wz);
          break;
        }
        case 'death': {
          const enemyHint = sideOf(e.side ?? e.team ?? (e.enemy === true ? 'enemy' : undefined));
          const v = findVis(e.unitId ?? e.id ?? e.targetId, enemyHint);
          if (v) startDeath(v);
          break;
        }
        case 'trap': {
          const r = recs.get(e.buildingId ?? e.id);
          if (r) {
            r.trapT = 0;
            r.trapReady = false;
            r.trapProgress = 0;
            fx.trapBurst(r.wx, r.wy, r.wz);
            if (onShake) onShake(0.18);
          } else if (evXZ(e, 'pos', 'x', 'z', _to)) {
            fx.trapBurst(tileWX(_to.x), 0, tileWZ(_to.z));
          }
          break;
        }
        case 'building_hit': {
          const r = recs.get(e.buildingId ?? e.id ?? e.targetId);
          if (!r) break;
          const amount = num(e.amount ?? e.dmg ?? e.damage ?? e.degats, 0);
          r.flash = 0.12;
          if (typeof e.hp === 'number') applyHp(r, e.hp, num(e.maxHp ?? e.hpMax, 0));
          else if (amount > 0 && r.hpMax > 0) applyHp(r, Math.max(0, r.hp - amount), 0);
          const top = r.wy + Math.min(2.2, r.info.top) * 0.7;
          if (amount > 0) fx.number(r.wx, r.wy + r.info.top + 0.3, r.wz, amount, 'batiment', r);
          fx.debris(r.wx + (Math.random() - 0.5), top, r.wz + (Math.random() - 0.5), 3, r.info.wood ? 'wood' : 'stone');
          fx.dust(r.wx, r.wy + 0.2, r.wz, 2);
          break;
        }
        case 'building_destroyed': {
          const r = recs.get(e.buildingId ?? e.id);
          if (r) { applyHp(r, 0, 0); setDestroyed(r, true, true); }
          break;
        }
        case 'spawn': {
          let ok = evXZ(e, 'pos', 'x', 'z', _to);
          if (!ok && map.spawn) { _to.x = map.spawn.x; _to.z = map.spawn.z; ok = true; }
          if (ok) {
            const wx = tileWX(_to.x), wz = tileWZ(_to.z), y = terrain.heightAt(wx, wz);
            fx.dust(wx, y, wz, 6);
            fx.ring(wx, y, wz, 1.2, 0xffb090, 0.45);
          }
          break;
        }
        case 'wave_won': {
          const h = map.hall;
          if (h && !e.retreated) fx.celebrate(tileWX(h.x), terrain.tileHeight(h.x, h.z), tileWZ(h.z));
          break;
        }
        default: break;
      }
    }
    events.length = 0;
  }

  // ---------------------------------------------------------------------------------
  // Synchronisation avec l'état du jeu
  // ---------------------------------------------------------------------------------
  /**
   * Met à jour les bâtiments, le drapeau, les soldats et villageois d'après l'état (spec §3).
   * Peu coûteux : peut être appelé à chaque changement d'état (ou chaque image).
   * @param {object} state état du jeu
   */
  function syncState(state) {
    if (!state) return;
    syncStamp++;
    let linChanged = false;
    const list = state.buildings || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let r = recs.get(b.id);
      if (r && (r.type !== b.type || r.x !== b.x || r.z !== b.z)) { removeRec(r, false); r = null; }
      let isNew = false;
      if (!r) {
        isNew = true;
        r = makeRec(b);
        recs.set(b.id, r);
        recList.push(r);
        occupied[b.z * W + b.x] = b.id + 1;
        terrain.setTileOccupied(b.x, b.z, true);
        if (!firstSync) fx.dust(r.wx, r.wy, r.wz, 14);
        if (LINEAIRES[b.type]) linChanged = true;
      }
      r.seen = syncStamp;
      if (!battleActive) {
        applyHp(r, num(b.hp, r.hpMax), hpMaxOf(b.type, b));
        setDestroyed(r, !!b.destroyed, !firstSync && !isNew);
        if (isNew && b.destroyed) r.pop = 1;
        if (r.type === 'piege') { r.trapReady = true; r.trapProgress = 1; }
      } else if (b.destroyed && !r.destroyed) {
        setDestroyed(r, true, true);
      }
    }
    for (let i = recList.length - 1; i >= 0; i--) {
      const r = recList[i];
      if (r.seen !== syncStamp) { if (LINEAIRES[r.type]) linChanged = true; removeRec(r, !firstSync); }
    }
    // les murs voisins se réorientent pour se raccorder
    if (linChanged) reorientLinears();
    if (state.rally && typeof state.rally.x === 'number') setRally(state.rally.x, state.rally.z);
    prepSoldiers = state.soldiers || null;
    if (state.phase && state.phase !== 'battle' && battleActive) syncBattle(null);
    computeWalkers(state);
    firstSync = false;
  }

  // ---------------------------------------------------------------------------------
  // Image par image
  // ---------------------------------------------------------------------------------
  let selT = 0;
  let showLeash = false;
  let minNombre = 0; // dégâts sous ce seuil : pas de chiffre flottant (vitesse ×2, moins de fouillis)

  // Anneaux d'équipe (instanciés, un maillage par camp)
  const ringGeo = new THREE.RingGeometry(0.3, 0.52, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const ringAllyMat = new THREE.MeshBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.75, depthWrite: false });
  const ringEnemyMat = new THREE.MeshBasicMaterial({ color: 0xff4a38, transparent: true, opacity: 0.75, depthWrite: false });
  const ringsAlly = new THREE.InstancedMesh(ringGeo, ringAllyMat, VIS_MAX);
  const ringsEnemy = new THREE.InstancedMesh(ringGeo, ringEnemyMat, VIS_MAX);
  for (const im of [ringsAlly, ringsEnemy]) {
    im.count = 0; im.frustumCulled = false; im.renderOrder = 3; im.visible = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(im);
  }
  const _rm = new THREE.Matrix4();

  function pushBattleUnits(dt) {
    const k = 1 - Math.exp(-dt * 18);
    let nA = 0, nE = 0;
    for (let i = 0; i < VIS_MAX; i++) {
      const v = visPool[i];
      if (!v.used) continue;
      const twx = tileWX(v.tx), twz = tileWZ(v.tz);
      const ox = v.wx, oz = v.wz;
      if (!v.dying) {
        v.wx += (twx - v.wx) * k;
        v.wz += (twz - v.wz) * k;
      }
      const dx = v.wx - ox, dz = v.wz - oz;
      const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      v.moving += ((sp > 0.15 ? 1 : 0) - v.moving) * Math.min(1, dt * 8);
      v.appear = Math.min(1, v.appear + dt * 3);
      v.flash = Math.max(0, v.flash - dt * 5);
      if (!v.lungeExt) v.lunge = Math.max(0, v.lunge - dt * 2.6);
      // orientation : celle du cœur, sinon le sens de la marche, sinon vers la cible
      let goalYaw = v.yaw;
      if (v.facing !== null) goalYaw = v.facing;
      else if (sp > 0.2) goalYaw = Math.atan2(dx, dz);
      else if (v.targetId !== null) {
        const t = findVis(v.targetId, !v.enemy);
        if (t) goalYaw = Math.atan2(t.wx - v.wx, t.wz - v.wz);
      } else if (v.targetBuilding !== null) {
        const r = recs.get(v.targetBuilding);
        if (r) goalYaw = Math.atan2(r.wx - v.wx, r.wz - v.wz);
      }
      if (!v.dying) v.yaw += angleDiff(v.yaw, goalYaw) * Math.min(1, dt * 10);
      // coups automatiques seulement si personne ne fournit l'animation
      if (!v.dying && !v.lungeExt && v.engaged && v.moving < 0.3 && clock - v.lastEvLunge > 2.5) {
        v.autoT -= dt;
        if (v.autoT <= 0) { v.autoT = v.cadence; v.lunge = 1; }
      }
      v.phase += dt * (6 + 5 * v.moving);
      const y0 = terrain.heightAt(v.wx, v.wz);
      let y = y0 + Math.abs(Math.sin(v.phase)) * 0.06 * v.moving;
      let lean = 0.1 * v.moving;
      let arm = Math.sin(v.phase) * 0.45 * v.moving;
      let roll = 0;
      let fwd = 0;
      const isRam = v.key === 'en_belier';
      if (v.lunge > 0) {
        const u = 1 - v.lunge; // 0 → 1 pendant le coup
        if (isRam) {
          fwd = u < 0.4 ? -0.25 * (u / 0.4) : u < 0.55 ? -0.25 + 0.6 * ((u - 0.4) / 0.15) : 0.35 * (1 - (u - 0.55) / 0.45);
        } else {
          // armer (bras en arrière, en haut) puis frapper vers l'avant ; geste court pour lances et arcs
          const g = GESTE[v.key] || 1;
          arm = (u < 0.35 ? -1.3 * (u / 0.35) : u < 0.55 ? -1.3 + 3.0 * ((u - 0.35) / 0.2) : 1.7 * (1 - (u - 0.55) / 0.45)) * g;
          lean = u < 0.35 ? -0.08 : u < 0.6 ? 0.22 : 0.22 * (1 - (u - 0.6) / 0.4);
          fwd = u > 0.35 && u < 0.75 ? (g < 1 ? 0.24 : 0.12) * Math.sin(((u - 0.35) / 0.4) * Math.PI) : 0;
        }
      }
      if (isRam) { arm = 0; lean = 0; y = y0 + Math.abs(Math.sin(v.phase * 0.5)) * 0.02 * v.moving; }
      let scale = v.scale * v.size * ECHELLE_BATAILLE * (0.4 + 0.6 * easeOutBack(v.appear));
      if (v.dying) {
        v.deathT += dt;
        const t = v.deathT;
        let end = 1.9;
        if (v.retreat) {
          // retraite : ils s'enfoncent dans la brume sans tomber
          scale *= Math.max(0, 1 - t / 0.8);
          end = 0.8;
        } else if (isRam) {
          scale *= Math.max(0, 1 - t / 0.5);
          end = 0.5;
        } else {
          const f = Math.min(1, t / 0.35);
          roll = v.roll * f * f * 1.45;
          lean = -0.3 * f;
          arm = 0.4 * f;
          if (t > 1.3) y -= (t - 1.3) * 0.6;
          if (t > 1.6) scale *= Math.max(0, 1 - (t - 1.6) / 0.3);
        }
        if (t > end) { freeVis(v); continue; }
      }
      const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
      crowd.push(v.key, v.wx + s * fwd, y, v.wz + c * fwd, v.yaw, arm, lean, roll, scale, v.flash);
      // anneau au sol : bleu pour nos soldats, rouge pour l'ennemi (plus grand pour les gros)
      if (!v.dying) {
        const r = (v.size > 1.2 ? 1.5 : 1) * Math.min(1, v.appear * 2);
        _rm.makeScale(r, 1, r).setPosition(v.wx, y0 + 0.05, v.wz);
        if (v.enemy) ringsEnemy.setMatrixAt(nE++, _rm); else ringsAlly.setMatrixAt(nA++, _rm);
      }
      if (!v.dying && v.hpMax > 0 && v.hp < v.hpMax) {
        const top = isRam ? 1.25 * 0.75 : HAUTEUR_UNITE;
        fx.bar(v.wx, y0 + top * v.size * v.scale * ECHELLE_BATAILLE + 0.25, v.wz, v.hp / v.hpMax, v.enemy ? 'ennemi' : 'allie', v.size > 1.2 ? 1.1 : 0.78);
      }
    }
    finirAnneaux(nA, nE);
  }
  function finirAnneaux(nA, nE) {
    ringsAlly.count = nA; ringsEnemy.count = nE;
    ringsAlly.visible = nA > 0; ringsEnemy.visible = nE > 0;
    if (nA) ringsAlly.instanceMatrix.needsUpdate = true;
    if (nE) ringsEnemy.instanceMatrix.needsUpdate = true;
  }

  // Ordre de formation identique à celui du cœur : fantassins devant (nord), archers derrière
  const formOrder = [];
  function pushPrepFigures(dt) {
    const S = prepSoldiers;
    if (S && S.length) {
      const fxp = rally.position.x, fzp = rally.position.z;
      formOrder.length = 0;
      for (let i = 0; i < S.length; i++) if (S[i].kind !== 'archer') formOrder.push(S[i]);
      const nbF = formOrder.length;
      for (let i = 0; i < S.length; i++) if (S[i].kind === 'archer') formOrder.push(S[i]);
      const e = formation.spacing * TILE, per = formation.perRow;
      const rowsF = Math.ceil(nbF / per);
      for (let i = 0; i < formOrder.length && i < 48; i++) {
        const so = formOrder[i];
        const archer = i >= nbF;
        const j = archer ? i - nbF : i;
        const n = archer ? formOrder.length - nbF : nbF;
        const rang = Math.floor(j / per);
        const dansRang = Math.min(per, n - rang * per);
        const col = j % per;
        const wx = fxp + (col - (dansRang - 1) / 2) * e;
        const wz = fzp + ((archer ? rowsF : 0) + rang - 0.5) * e;
        const t = clock + i * 1.37;
        // regard vers le nord, avec de petits coups d'œil de temps en temps
        const glance = Math.sin(t * 0.13) > 0.55 ? Math.sin(t * 0.7) * 0.6 : 0;
        const yaw = Math.PI + glance;
        const y = terrain.heightAt(wx, wz) + Math.sin(t * 2.1) * 0.006;
        const key = unitKeyFor(false, so.kind, num(so.equip, 0));
        crowd.push(key, wx, y, wz, yaw, Math.sin(t * 1.3) * 0.05, 0, 0, 0.97 + (i % 3) * 0.02, 0);
      }
    }
    // villageois au travail
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      if (!w.active) continue;
      updateWalker(w, dt);
      const y0 = terrain.heightAt(w.x, w.z);
      const moving = w.state === 0;
      let arm = moving ? Math.sin(w.phase) * 0.5 : 0;
      let lean = moving ? 0.06 : 0;
      if (!moving && !w.idle && w.dir > 0) {
        // au travail : coups d'outil réguliers, tourné vers le bâtiment
        const u = (clock * 1.4 + i * 0.3) % 1;
        arm = u < 0.5 ? -1.2 * (u / 0.5) : -1.2 + 2.6 * Math.min(1, (u - 0.5) / 0.15);
        lean = 0.1;
      }
      if (w.carry) arm = -2.6; // bras levé pour tenir la charge
      const y = y0 + (moving ? Math.abs(Math.sin(w.phase)) * 0.05 : 0);
      crowd.push(w.key, w.x, y, w.z, w.yaw, arm, lean, 0, 0.92, 0);
      if (w.carry) crowd.carry(w.carry, w.x, y, w.z, w.yaw);
    }
  }

  /** Archers postés en haut des tours (visent leur cible en bataille, guettent sinon). */
  function pushTowerArchers(dt) {
    for (let i = 0; i < recList.length; i++) {
      const r = recList[i];
      const a = r.info.archer;
      if (!a || r.destroyed || r.pop < 0.6) continue;
      r.archerShot += dt;
      let yaw = r.archerYaw;
      if (!battleActive) {
        r.archerLook += dt * 0.25;
        yaw = Math.PI + Math.sin(r.archerLook) * 1.1;
      }
      const sh = r.archerShot;
      const arm = sh < 0.35 ? (sh < 0.15 ? 1.5 * (sh / 0.15) : 1.5) : sh < 0.6 ? 1.5 * (1 - (sh - 0.35) / 0.25) : 0;
      const cs = Math.cos(r.group.rotation.y), sn = Math.sin(r.group.rotation.y);
      const s = r.group.scale.x;
      crowd.push('ally_archer', r.wx + (a[0] * cs + a[2] * sn) * s, r.wy + a[1] * s, r.wz + (-a[0] * sn + a[2] * cs) * s, yaw, arm, 0, 0, 0.95, r.flash > 0 ? 0.6 : 0);
    }
  }

  function updateBuildings(dt) {
    for (let i = 0; i < recList.length; i++) {
      const r = recList[i];
      if (r.pop < 1) {
        r.pop = Math.min(1, r.pop + dt / 0.55);
        const s = Math.max(0.01, easeOutBack(r.pop));
        r.group.scale.set(s, s, s);
      }
      if (r.flash > 0) r.flash = Math.max(0, r.flash - dt);
      if (!r.destroyed) setRecMaterial(r);
      if (r.destroyed) {
        if (r.ruinSmoke > 0) {
          r.ruinSmoke -= dt;
          r.smokeT -= dt;
          if (r.smokeT <= 0) { r.smokeT = 0.3; fx.smoke(r.wx, r.wy + 0.3, r.wz); }
        }
        continue;
      }
      // fumée et flammes si très abîmé
      if (r.ratio < 0.5 && r.type !== 'piege') {
        r.smokeT -= dt;
        if (r.smokeT <= 0) {
          r.smokeT = r.ratio < 0.25 ? 0.18 : 0.32;
          const h = r.wy + Math.min(1.6, r.info.top * 0.6);
          fx.smoke(r.wx + (Math.random() - 0.5) * 0.6, h, r.wz + (Math.random() - 0.5) * 0.6);
          if (r.ratio < 0.25) fx.fire(r.wx, h - 0.2, r.wz, 2);
        }
      }
      // cheminées et forge : la vie du village
      const ch = r.info.chimneys;
      if (ch && ch.length) {
        r.chimT -= dt;
        if (r.chimT <= 0) {
          r.chimT = 0.45 + Math.random() * 0.3;
          const c = ch[0];
          const cs = Math.cos(r.group.rotation.y), sn = Math.sin(r.group.rotation.y);
          fx.chimney(r.wx + c[0] * cs + c[2] * sn, r.wy + c[1], r.wz - c[0] * sn + c[2] * cs);
          if (r.info.forge && Math.random() < 0.35) {
            const f = r.info.forge;
            fx.sparks(r.wx + f[0] * cs + f[2] * sn, r.wy + f[1], r.wz - f[0] * sn + f[2] * cs, 2);
          }
        }
      }
      // piège : pieux qui jaillissent puis rechargement
      if (r.type === 'piege') {
        const sp = r.group.userData.spikes;
        let y = -0.3;
        if (r.trapT >= 0) {
          r.trapT += dt;
          const t = r.trapT;
          y = t < 0.1 ? -0.3 + 0.38 * (t / 0.1) : t < 0.7 ? 0.08 : t < 1.1 ? 0.08 - 0.6 * ((t - 0.7) / 0.4) : -0.52;
          if (t > 1.1) r.trapT = -1;
        } else if (!r.trapReady) {
          y = -0.52 + 0.18 * Math.max(0, Math.min(1, r.trapProgress));
        }
        sp.position.y = y;
        // anneau doré qui pulse quand le piège est armé (on peut le toucher)
        if (battleActive && r.trapReady && r.trapT < 0) {
          r.ringT = (r.ringT || 0) - dt;
          if (r.ringT <= 0) { r.ringT = 1.1; fx.ring(r.wx, r.wy, r.wz, 1.25, 0xffd36a, 0.9); }
        }
      }
      if (battleActive && r.hpMax > 0 && r.ratio < 1 && r.type !== 'piege') {
        fx.bar(r.wx, r.wy + r.info.top + 0.45, r.wz, r.ratio, 'batiment', 1.2);
      }
    }
  }

  /**
   * Avance les animations (à appeler à chaque image, après syncState/syncBattle).
   * @param {number} dt secondes écoulées
   */
  function update(dt) {
    clock += dt;
    SHARED_UNIFORMS.uTime.value = clock;
    fx.beginBars();
    updateBuildings(dt);
    crowd.begin();
    if (battleActive) pushBattleUnits(dt);
    else { pushPrepFigures(dt); if (ringsAlly.visible || ringsEnemy.visible) finirAnneaux(0, 0); }
    pushTowerArchers(dt);
    crowd.end();
    fx.endBars();
    // drapeau de ralliement : petit saut quand il change de place
    if (rallyAnim.t < 1) {
      rallyAnim.t = Math.min(1, rallyAnim.t + dt / 0.45);
      const t = rallyAnim.t, e = 1 - (1 - t) * (1 - t);
      const x = rallyAnim.fx + (rallyAnim.tx - rallyAnim.fx) * e, z = rallyAnim.fz + (rallyAnim.tz - rallyAnim.fz) * e;
      rally.position.set(x, terrain.heightAt(x, z) + Math.sin(t * Math.PI) * 0.8, z);
    }
    leash.visible = leashFill.visible = showLeash;
    if (showLeash) leashMat.opacity = 0.65 + Math.sin(clock * 4) * 0.2;
    if (selection.visible) {
      selT += dt;
      selMat.opacity = 0.65 + Math.sin(selT * 5) * 0.25;
      const s = 1 + Math.sin(selT * 5) * 0.03;
      selection.scale.set(s, 1, s);
    }
    if (hints.visible) {
      hintMat.opacity = 0.28 + Math.sin(clock * 3) * 0.08;
      hintEdgeMat.opacity = 0.7 + Math.sin(clock * 3) * 0.2;
    }
    if (ghost.visible) {
      ghostT += dt;
      ghostMesh.position.y = 0.06 + Math.sin(ghostT * 4) * 0.05;
      ghostMesh.material.opacity = 0.42 + Math.sin(ghostT * 4) * 0.1;
    }
    fx.update(dt);
  }

  /**
   * Tuile sous un point écran (rayon vers le plan du sol), ou null hors carte.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x:number, z:number}|null}
   */
  function pickTile(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    _ray.setFromCamera(_ndc, camera);
    // le sol n'est pas tout à fait plat : on vise la hauteur moyenne de la zone touchée
    _plane.constant = 0;
    if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
    const h = terrain.heightAt(_hit.x, _hit.z);
    _plane.constant = -h;
    if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
    _plane.constant = 0;
    const x = Math.floor(_hit.x / TILE + W / 2), z = Math.floor(_hit.z / TILE + H / 2);
    if (x < 0 || z < 0 || x >= W || z >= H) return null;
    return { x, z };
  }

  /**
   * Position écran (pixels CSS, relatifs à la toile) d'une tuile, pour ancrer de l'interface
   * (ex. bouton de piège). Passer `out` pour éviter toute allocation à chaque image.
   * @param {number} x tuile x (décimale acceptée)
   * @param {number} z tuile z
   * @param {number} [height] hauteur au-dessus du sol (unités monde)
   * @param {{x:number,y:number,visible:boolean}} [out]
   * @returns {{x:number, y:number, visible:boolean}}
   */
  function tileToScreen(x, z, height = 0, out = { x: 0, y: 0, visible: false }) {
    const wx = tileWX(x), wz = tileWZ(z);
    _v.set(wx, terrain.heightAt(wx, wz) + height, wz).project(camera);
    if (!rectToile.width) lireRect();
    out.x = (_v.x * 0.5 + 0.5) * rectToile.width;
    out.y = (-_v.y * 0.5 + 0.5) * rectToile.height;
    out.visible = _v.z < 1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1;
    return out;
  }

  return {
    syncState,
    syncBattle,
    consumeEvents,
    setGhost,
    clearGhost,
    setHints,
    pickTile,
    tileToScreen,
    /** Déplace le drapeau de ralliement (tuile). */
    setRally,
    /** Montre/cache le cercle d'action de l'armée (mode « Déplacer l'armée »). */
    showRallyRange(on) { showLeash = !!on; },
    /** Seuil des chiffres de dégâts (0 = tous ; 4 en vitesse ×2 pour alléger la mêlée). */
    setMinDamageNumber(n) { minNombre = num(n, 0); },
    /** Surligne une tuile (bâtiment sélectionné) ; null pour effacer. */
    setSelected(x, z) {
      if (x === null || x === undefined || x < 0) { selection.visible = false; return; }
      const wx = tileWX(x), wz = tileWZ(z);
      selection.position.set(wx, terrain.tileHeight(x, z) + 0.07, wz);
      selection.visible = true;
      selT = 0;
    },
    /** Coordonnées monde du centre d'une tuile. */
    tileToWorld(x, z) { return { x: tileWX(x), y: terrain.tileHeight(x, z), z: tileWZ(z) }; },
    /** Bornes de la carte pour la caméra (unités monde). */
    bounds: { minX: -W / 2 * TILE, maxX: W / 2 * TILE, minZ: -H / 2 * TILE, maxZ: H / 2 * TILE },
    update,
    /** Change la densité des effets selon la qualité. */
    setQuality(q) { fx.setQuality(q); },
    /** Accès aux effets (pour l'interface : célébrations, etc.). */
    fx,
    /** Accès bas niveau (tests, démo). */
    terrain,
    get battleActive() { return battleActive; },
    /** Compteurs pour les tests : bâtiments, ruines, unités de bataille, villageois en marche. */
    getStats() {
      let ruins = 0, units = 0, walking = 0;
      for (let i = 0; i < recList.length; i++) if (recList[i].destroyed) ruins++;
      for (let i = 0; i < VIS_MAX; i++) if (visPool[i].used) units++;
      for (let i = 0; i < walkers.length; i++) if (walkers[i].active) walking++;
      return { buildings: recList.length, ruins, battleUnits: units, walkers: walking };
    },
    /** Libère tout ce que le monde a créé. */
    dispose() {
      root.removeFromParent();
      crowd.dispose();
      fx.dispose();
      terrain.dispose();
      poleGeo.dispose(); leashGeo.dispose(); leashFillGeo.dispose(); leashMat.dispose(); selGeo.dispose(); selMat.dispose();
      tileFillGeo.dispose(); tileFillMat.dispose(); hintGeo.dispose(); hintMat.dispose(); rangeGeo.dispose(); rangeMat.dispose(); gridGeo.dispose(); gridMat.dispose();
      hintEdgeGeo.dispose(); hintEdgeMat.dispose(); ringGeo.dispose(); ringAllyMat.dispose(); ringEnemyMat.dispose();
      if (observateur) observateur.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', lireRect);
      recs.clear();
      recList.length = 0;
    },
  };
}
