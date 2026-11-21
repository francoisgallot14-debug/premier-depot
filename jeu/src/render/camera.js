// Contrôle de caméra tactile + souris : glisser = déplacer, pincer = zoom, tourner à deux doigts,
// clic droit = rotation, molette = zoom. Mouvements amortis, cible bornée à la carte.
import * as THREE from 'three';

/** Réglages de la caméra (visuels, pas des règles de jeu). */
const CAM = {
  distMin: 14, distMax: 46, distDefaut: 30,
  pitchProche: 42, pitchLoin: 57, // inclinaison (degrés) selon le zoom : plus rasante de près
  amorti: 10, // vitesse de rattrapage
  seuilTap: 8, // pixels : au-delà c'est un glisser
  inertie: 4.5,
};

const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Crée le contrôleur de caméra orbitale.
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} dom élément qui reçoit les gestes (la toile)
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds bornes de la cible (unités monde)
 * @param {{distance?: number, yaw?: number, target?: {x:number,z:number}}} [opts]
 * @returns {{
 *   update(dt: number): boolean,
 *   onTap(fn: (clientX: number, clientY: number) => void): () => void,
 *   setTarget(x: number, z: number, immediate?: boolean): void,
 *   setDistance(d: number, immediate?: boolean): void,
 *   setYaw(rad: number, immediate?: boolean): void,
 *   setPitchOverride(deg: number|null): void,
 *   setAutoRotate(radPerSec: number): void,
 *   setBounds(b: object): void,
 *   shake(strength: number): void,
 *   getState(): {x:number,z:number,distance:number,yaw:number,pitch:number},
 *   enabled: boolean, dispose(): void
 * }}
 */
export function createCameraController(camera, dom, bounds, opts = {}) {
  let B = { ...bounds };
  // état courant (lissé) et objectif
  const cur = { x: 0, z: 0, dist: CAM.distDefaut, yaw: 0 };
  const goal = { x: 0, z: 0, dist: CAM.distDefaut, yaw: 0 };
  if (opts.target) { cur.x = goal.x = opts.target.x; cur.z = goal.z = opts.target.z; }
  if (opts.distance) cur.dist = goal.dist = clampDist(opts.distance);
  if (opts.yaw) cur.yaw = goal.yaw = opts.yaw;
  let pitchOverride = null, autoRotate = 0, shakeAmt = 0, shakeT = 0;
  const vel = { x: 0, z: 0 }; // inertie du glisser
  const tapListeners = [];
  const pointers = new Map(); // id -> {x, y, sx, sy}
  let gesture = null; // {kind:'pan'|'rotate'|'multi', moved, startT, ...}
  let lastMoveT = 0;

  function clampDist(d) { return Math.min(CAM.distMax, Math.max(CAM.distMin, d)); }
  function clampTarget(o) {
    o.x = Math.min(B.maxX, Math.max(B.minX, o.x));
    o.z = Math.min(B.maxZ, Math.max(B.minZ, o.z));
  }
  function pitchFor(dist) {
    if (pitchOverride != null) return THREE.MathUtils.degToRad(pitchOverride);
    const t = (dist - CAM.distMin) / (CAM.distMax - CAM.distMin);
    return THREE.MathUtils.degToRad(CAM.pitchProche + (CAM.pitchLoin - CAM.pitchProche) * t);
  }
  function applyCamera() {
    const p = pitchFor(cur.dist);
    const h = Math.cos(p) * cur.dist;
    let sx = 0, sz = 0;
    if (shakeAmt > 0) {
      sx = Math.sin(shakeT * 53) * shakeAmt;
      sz = Math.cos(shakeT * 47) * shakeAmt;
    }
    camera.position.set(cur.x + Math.sin(cur.yaw) * h + sx, Math.sin(p) * cur.dist, cur.z + Math.cos(cur.yaw) * h + sz);
    camera.lookAt(cur.x + sx * 0.5, 0, cur.z + sz * 0.5);
  }

  /** Point du sol (y=0) sous un point écran ; false si le rayon rate le sol. */
  function groundAt(clientX, clientY, out) {
    const r = dom.getBoundingClientRect();
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    return _ray.ray.intersectPlane(_plane, out) !== null;
  }

  /** Déplace la cible pour que le point sol sous (x0,y0) passe sous (x1,y1). */
  function panScreen(x0, y0, x1, y1) {
    applyCamera();
    camera.updateMatrixWorld();
    if (!groundAt(x0, y0, _a) || !groundAt(x1, y1, _b)) return;
    const dx = _a.x - _b.x, dz = _a.z - _b.z;
    cur.x += dx; cur.z += dz;
    clampTarget(cur);
    goal.x = cur.x; goal.z = cur.z;
    const now = performance.now();
    const dtm = Math.max(8, now - lastMoveT) / 1000;
    lastMoveT = now;
    // vitesse lissée pour l'élan au relâcher
    vel.x = vel.x * 0.5 + (dx / dtm) * 0.5;
    vel.z = vel.z * 0.5 + (dz / dtm) * 0.5;
  }

  function twoFingerState() {
    const it = pointers.values();
    const p1 = it.next().value, p2 = it.next().value;
    return {
      mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2,
      d: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
      a: Math.atan2(p2.y - p1.y, p2.x - p1.x),
    };
  }

  function onPointerDown(e) {
    if (!api.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try { dom.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    vel.x = vel.z = 0;
    autoRotate = 0;
    if (pointers.size === 1) {
      gesture = {
        kind: e.pointerType === 'mouse' && e.button === 2 ? 'rotate' : 'pan',
        moved: false, multi: false, startT: performance.now(),
      };
      lastMoveT = performance.now();
    } else {
      // 2 doigts (ou plus : paume, prise en main) : le geste repart des deux premiers doigts
      gesture = { kind: 'multi', moved: true, multi: true, last: twoFingerState() };
    }
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (gesture.kind === 'multi' && pointers.size >= 2) {
      const s = twoFingerState();
      const l = gesture.last;
      // pincer = zoom, tourner = rotation, milieu = déplacement
      goal.dist = clampDist(goal.dist * (l.d / s.d));
      cur.dist = clampDist(cur.dist * (l.d / s.d));
      let da = s.a - l.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      cur.yaw -= da; goal.yaw -= da;
      panScreen(l.mx, l.my, s.mx, s.my);
      vel.x = vel.z = 0;
      gesture.last = s;
      return;
    }
    if (!gesture.moved && Math.hypot(p.x - p.sx, p.y - p.sy) < CAM.seuilTap) return;
    if (!gesture.moved) {
      gesture.moved = true;
      // le premier déplacement rattrape le seuil d'un coup (pas de saut)
      if (gesture.kind === 'pan') panScreen(p.sx, p.sy, px, py);
    }
    if (gesture.kind === 'rotate') {
      const dx = p.x - px;
      cur.yaw -= dx * 0.008; goal.yaw = cur.yaw;
    } else if (gesture.kind === 'pan') {
      panScreen(px, py, p.x, p.y);
    }
  }

  function onPointerUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    try { dom.releasePointerCapture(e.pointerId); } catch { /* rien */ }
    if (!gesture) return;
    if (pointers.size === 0) {
      const g = gesture;
      gesture = null;
      if (!g.moved && !g.multi && g.kind === 'pan' && e.type === 'pointerup') {
        for (const fn of tapListeners) fn(e.clientX, e.clientY);
        vel.x = vel.z = 0;
      } else if (g.kind === 'pan' && g.moved && performance.now() - lastMoveT > 90) {
        vel.x = vel.z = 0; // doigt immobile avant de lâcher : pas d'élan
      }
      if (g.kind !== 'pan') vel.x = vel.z = 0;
    } else if (pointers.size === 1) {
      // on repasse à un doigt : reprise d'un déplacement simple, plus de tap possible
      const rest = pointers.values().next().value;
      rest.sx = rest.x; rest.sy = rest.y;
      gesture = { kind: 'pan', moved: true, multi: true, startT: performance.now() };
      vel.x = vel.z = 0;
    } else {
      // il reste 2 doigts ou plus, mais plus forcément les mêmes : on repart d'eux (pas de saut)
      gesture = { kind: 'multi', moved: true, multi: true, last: twoFingerState() };
      vel.x = vel.z = 0;
    }
  }

  function onWheel(e) {
    if (!api.enabled) return;
    e.preventDefault();
    const k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))));
    goal.dist = clampDist(goal.dist * k);
    autoRotate = 0;
  }

  function onContext(e) { e.preventDefault(); }

  // Clavier (bonus ordinateur) : flèches/ZQSD déplacent, A/E tournent, +/- zooment
  const keys = new Set();
  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.type === 'keydown') keys.add(e.key.toLowerCase()); else keys.delete(e.key.toLowerCase());
  }
  function onBlur() { keys.clear(); }

  dom.style.touchAction = 'none';
  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', onBlur);

  /** Avance l'amortissement ; renvoie vrai si la caméra a bougé. */
  function update(dt) {
    const ox = cur.x, oz = cur.z, od = cur.dist, oy = cur.yaw;
    if (keys.size && api.enabled) {
      const sp = cur.dist * 0.9 * dt;
      let fx = 0, fz = 0;
      if (keys.has('arrowup') || keys.has('z') || keys.has('w')) fz -= 1;
      if (keys.has('arrowdown') || keys.has('s')) fz += 1;
      if (keys.has('arrowleft') || keys.has('q')) fx -= 1;
      if (keys.has('arrowright') || keys.has('d')) fx += 1;
      if (fx || fz) {
        const c = Math.cos(cur.yaw), s = Math.sin(cur.yaw);
        goal.x += (fx * c + fz * s) * sp;
        goal.z += (-fx * s + fz * c) * sp;
      }
      if (keys.has('a')) goal.yaw += dt * 1.5;
      if (keys.has('e')) goal.yaw -= dt * 1.5;
      if (keys.has('+') || keys.has('=')) goal.dist = clampDist(goal.dist * (1 - dt));
      if (keys.has('-')) goal.dist = clampDist(goal.dist * (1 + dt));
    }
    if (autoRotate) goal.yaw += autoRotate * dt;
    // élan après un glisser
    if (!gesture && (vel.x || vel.z)) {
      goal.x += vel.x * dt; goal.z += vel.z * dt;
      const f = Math.exp(-CAM.inertie * dt);
      vel.x *= f; vel.z *= f;
      if (Math.abs(vel.x) + Math.abs(vel.z) < 0.05) vel.x = vel.z = 0;
    }
    clampTarget(goal);
    const k = 1 - Math.exp(-CAM.amorti * dt);
    if (!gesture || gesture.kind !== 'pan') {
      cur.x += (goal.x - cur.x) * k;
      cur.z += (goal.z - cur.z) * k;
    }
    cur.dist += (goal.dist - cur.dist) * k;
    cur.yaw += (goal.yaw - cur.yaw) * k;
    if (shakeAmt > 0) {
      shakeT += dt;
      shakeAmt = Math.max(0, shakeAmt - dt * 1.6);
    }
    applyCamera();
    return ox !== cur.x || oz !== cur.z || od !== cur.dist || oy !== cur.yaw || shakeAmt > 0;
  }

  // Caméra d'essai pour cadrer sans toucher à la vraie
  const essai = camera.clone();
  const _ray2 = new THREE.Raycaster();
  function placerEssai(x, z, d, yaw) {
    const p = pitchFor(d);
    const h = Math.cos(p) * d;
    essai.position.set(x + Math.sin(yaw) * h, Math.sin(p) * d, z + Math.cos(yaw) * h);
    essai.lookAt(x, 0, z);
    essai.updateMatrixWorld();
  }
  function solEssai(px, py, w, hgt, out) {
    _ndc.set((px / w) * 2 - 1, -(py / hgt) * 2 + 1);
    _ray2.setFromCamera(_ndc, essai);
    return _ray2.ray.intersectPlane(_plane, out) !== null;
  }

  /**
   * Cherche la cible et la plus petite distance qui font tenir ces points (monde) dans une zone
   * de l'écran (pixels CSS de la toile), avec l'orientation actuelle. N'applique rien.
   * @param {{x:number, y?:number, z:number}[]} pts
   * @param {{left:number, top:number, right:number, bottom:number, width:number, height:number}} zone
   * @param {number} [minDist] distance minimale (garder un peu de contexte autour)
   * @param {number} [maxDist] distance maximale essayée (au-delà, les unités deviennent trop petites)
   * @returns {{x:number, z:number, distance:number, fits:boolean}}
   */
  function fitPoints(pts, zone, minDist = CAM.distMin, maxDist = CAM.distMax) {
    if (!pts.length || zone.width <= 0 || zone.height <= 0) return { x: goal.x, z: goal.z, distance: goal.dist, fits: false };
    essai.fov = camera.fov;
    essai.aspect = zone.width / zone.height;
    essai.updateProjectionMatrix();
    const yaw = goal.yaw;
    let mx = 0, mz = 0;
    for (const q of pts) { mx += q.x; mz += q.z; }
    mx /= pts.length; mz /= pts.length;
    const zw = zone.right - zone.left, zh = zone.bottom - zone.top;
    const zcx = (zone.left + zone.right) / 2, zcy = (zone.top + zone.bottom) / 2;
    const dMax = clampDist(Math.max(minDist, maxDist));
    let best = { x: mx, z: mz, distance: dMax, fits: false };
    for (let d = clampDist(minDist); d <= dMax + 1e-6; d += 1) {
      let x = mx, z = mz, w = 0, h = 0;
      for (let it = 0; it < 4; it++) {
        placerEssai(x, z, d, yaw);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const q of pts) {
          _p.set(q.x, q.y || 0, q.z).project(essai);
          const sx = (_p.x * 0.5 + 0.5) * zone.width, sy = (-_p.y * 0.5 + 0.5) * zone.height;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
        w = x1 - x0; h = y1 - y0;
        // le centre du cadre projeté glisse vers le centre de la zone libre
        if (!solEssai((x0 + x1) / 2, (y0 + y1) / 2, zone.width, zone.height, _a) || !solEssai(zcx, zcy, zone.width, zone.height, _b)) break;
        x += _a.x - _b.x; z += _a.z - _b.z;
      }
      best = { x, z, distance: d, fits: w <= zw && h <= zh };
      if (best.fits) return best;
    }
    return best;
  }

  const api = {
    enabled: true,
    update,
    fitPoints,
    /** Abonne une fonction aux « taps » (appui bref sans glisser). Renvoie le désabonnement. */
    onTap(fn) {
      tapListeners.push(fn);
      return () => { const i = tapListeners.indexOf(fn); if (i >= 0) tapListeners.splice(i, 1); };
    },
    /** Centre la caméra sur un point monde. */
    setTarget(x, z, immediate = false) {
      goal.x = x; goal.z = z; clampTarget(goal);
      if (immediate) { cur.x = goal.x; cur.z = goal.z; applyCamera(); }
    },
    /** Change la distance (bornée 14–46). */
    setDistance(d, immediate = false) {
      goal.dist = clampDist(d);
      if (immediate) { cur.dist = goal.dist; applyCamera(); }
    },
    /** Change l'orientation (radians, 0 = caméra au sud regardant le nord). */
    setYaw(rad, immediate = false) {
      goal.yaw = rad;
      if (immediate) { cur.yaw = rad; applyCamera(); }
    },
    /** Force une inclinaison (degrés), ou null pour l'inclinaison automatique. */
    setPitchOverride(deg) { pitchOverride = deg; applyCamera(); },
    /** Rotation automatique lente (écran titre) ; 0 pour arrêter. */
    setAutoRotate(radPerSec) { autoRotate = radPerSec; },
    /** Change les bornes de la cible. */
    setBounds(b) { B = { ...b }; clampTarget(goal); },
    /** Petite secousse (bâtiment détruit…). */
    shake(strength = 0.3) { shakeAmt = Math.max(shakeAmt, strength); },
    /** État courant (pour sauvegarde éventuelle des options de vue). */
    getState() { return { x: cur.x, z: cur.z, distance: cur.dist, yaw: cur.yaw, pitch: THREE.MathUtils.radToDeg(pitchFor(cur.dist)) }; },
    /** Retire les écouteurs. */
    dispose() {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      tapListeners.length = 0;
    },
  };
  applyCamera();
  return api;
}
