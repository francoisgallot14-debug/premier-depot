// Foule instanciée : toutes les unités d'un même archétype partagent un InstancedMesh
// (corps) + un second (bras armé, pivot à l'épaule). Aucune allocation par image.
import * as THREE from 'three';
import { UNIT_KEYS, getUnitParts, getCarryGeometries, getMaterials } from './models.js';

const _m = new THREE.Matrix4();
const _arm = new THREE.Matrix4();
const _piv = new THREE.Matrix4();
const _rot = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Crée le gestionnaire de foule.
 * @param {THREE.Object3D} parent objet auquel attacher les maillages
 * @param {{capacity?: number}} [opts] nombre max d'instances par archétype
 * @returns {{
 *   begin(): void,
 *   push(key: string, x: number, y: number, z: number, yaw: number, arm: number, lean: number, roll: number, scale: number, flash: number): void,
 *   carry(kind: string, x: number, y: number, z: number, yaw: number): void,
 *   end(): void, keyIndex(key: string): number, dispose(): void
 * }}
 */
export function createCrowd(parent, opts = {}) {
  const cap = opts.capacity || 72;
  const mats = getMaterials();
  const arche = [];
  const index = new Map();
  for (const key of UNIT_KEYS) {
    const parts = getUnitParts(key);
    const body = new THREE.InstancedMesh(parts.body, mats.lit, cap);
    const arm = new THREE.InstancedMesh(parts.arm, mats.lit, cap);
    for (const im of [body, arm]) {
      im.count = 0;
      im.frustumCulled = false; // les instances bougent : la sphère englobante serait fausse
      im.castShadow = true;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // couleur d'instance (éclair de coup) initialisée à blanc
      im.setColorAt(0, _c.setRGB(1, 1, 1));
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.visible = false;
      parent.add(im);
    }
    index.set(key, arche.length);
    arche.push({ key, body, arm, pivot: parts.pivot, scale: parts.scale, n: 0 });
  }
  // objets portés par les villageois
  const carryGeo = getCarryGeometries();
  const carry = {};
  const carryList = [];
  for (const k of Object.keys(carryGeo)) {
    const im = new THREE.InstancedMesh(carryGeo[k], mats.lit, 24);
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = true;
    im.visible = false;
    parent.add(im);
    carry[k] = { im, n: 0 };
    carryList.push(carry[k]);
  }

  function begin() {
    for (let i = 0; i < arche.length; i++) arche[i].n = 0;
    for (let i = 0; i < carryList.length; i++) carryList[i].n = 0;
  }

  /**
   * Ajoute une unité pour cette image.
   * arm : angle du bras (radians, positif = vers l'avant) ; lean : penché avant ;
   * roll : chute sur le côté (mort) ; flash : 0..1 éclair blanc.
   */
  function push(key, x, y, z, yaw, arm, lean, roll, scale, flash) {
    const ai = index.get(key);
    const a = arche[ai === undefined ? 0 : ai];
    if (a.n >= cap) return;
    const i = a.n++;
    const s = scale * a.scale;
    _e.set(lean, yaw, roll);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    a.body.setMatrixAt(i, _m);
    // bras : corps × translation(pivot) × rotation(arm)
    _piv.makeTranslation(a.pivot.x, a.pivot.y, a.pivot.z);
    _rot.makeRotationX(-arm);
    _arm.multiplyMatrices(_m, _piv).multiply(_rot);
    a.arm.setMatrixAt(i, _arm);
    const f = flash > 0 ? flash : 0;
    _c.setRGB(1 + f * 2.4, 1 + f * 1.9, 1 + f * 1.7);
    a.body.setColorAt(i, _c);
    a.arm.setColorAt(i, _c);
  }

  /** Objet porté (bûche/pierre/sac) au-dessus de l'épaule d'un villageois. */
  function carryItem(kind, x, y, z, yaw) {
    const c = carry[kind];
    if (!c || c.n >= 24) return;
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _p.set(x + Math.sin(yaw + 1.57) * 0.12, y + 0.56, z + Math.cos(yaw + 1.57) * 0.12);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    c.im.setMatrixAt(c.n++, _m);
  }

  function flush(im, n) {
    im.count = n;
    im.visible = n > 0;
    if (n > 0) {
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    }
  }
  function end() {
    for (let i = 0; i < arche.length; i++) {
      const a = arche[i];
      flush(a.body, a.n);
      flush(a.arm, a.n);
    }
    for (let i = 0; i < carryList.length; i++) {
      const c = carryList[i];
      c.im.count = c.n;
      c.im.visible = c.n > 0;
      if (c.n) c.im.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    begin, push, carry: carryItem, end,
    keyIndex: (key) => index.get(key) ?? -1,
    dispose() {
      for (const a of arche) { a.body.removeFromParent(); a.arm.removeFromParent(); a.body.dispose(); a.arm.dispose(); }
      for (const k in carry) { carry[k].im.removeFromParent(); carry[k].im.dispose(); }
    },
  };
}
