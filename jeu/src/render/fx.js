// Effets : particules (poussière, fumée, feu, étincelles, débris), flèches, chiffres de dégâts,
// barres de vie, ondes au sol. Tout est en réserves pré-allouées (aucune allocation par image).
import * as THREE from 'three';
import { getArrowGeometry, getMaterials, PALETTE as C } from './models.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _Z = new THREE.Vector3(0, 0, 1);

/** Préréglages de particules : [réserve, durée, taille début, taille fin, gravité, freinage]. */
const KINDS = {
  dust: { pool: 'puff', life: 0.9, s0: 0.12, s1: 0.38, grav: -0.3, drag: 3.0, c0: 0xd9c49a, c1: 0xeee2c4 },
  smoke: { pool: 'puff', life: 2.4, s0: 0.1, s1: 0.44, grav: -0.08, drag: 0.6, c0: 0x4a4541, c1: 0x9a948d },
  chimney: { pool: 'puff', life: 2.8, s0: 0.04, s1: 0.2, grav: -0.03, drag: 0.4, c0: 0xcfc9c0, c1: 0xeeebe6 },
  hit: { pool: 'puff', life: 0.35, s0: 0.08, s1: 0.2, grav: 0, drag: 6, c0: 0xffffff, c1: 0xf0e0c0 },
  fire: { pool: 'glow', life: 0.55, s0: 0.16, s1: 0.04, grav: -1.6, drag: 1.2, c0: 0xffd257, c1: 0xff5a1e },
  spark: { pool: 'glow', life: 0.45, s0: 0.05, s1: 0.02, grav: 7, drag: 0.8, c0: 0xfff2a8, c1: 0xffa040 },
  gold: { pool: 'glow', life: 1.8, s0: 0.07, s1: 0.04, grav: 1.6, drag: 1.4, c0: 0xffe58a, c1: 0xffc23a },
  wood: { pool: 'chunk', life: 2.2, s0: 0.11, s1: 0.09, grav: 9.8, drag: 0.3, c0: C.bois, c1: C.boisSombre },
  stone: { pool: 'chunk', life: 2.4, s0: 0.12, s1: 0.1, grav: 9.8, drag: 0.3, c0: C.pierre, c1: C.pierreSombre },
  leaf: { pool: 'chunk', life: 1.6, s0: 0.06, s1: 0.05, grav: 2.0, drag: 2.5, c0: 0x8fbf4f, c1: 0x6a9a3c },
};

/** Couleurs des chiffres de dégâts (sRGB direct, lisibles sur l'herbe). */
const NUM_COLORS = {
  ennemi: [1.0, 0.95, 0.75], // dégâts infligés aux ennemis
  allie: [1.0, 0.42, 0.36], // dégâts subis par nos soldats
  batiment: [1.0, 0.66, 0.25],
  soin: [0.5, 1.0, 0.55],
  piege: [1.0, 0.85, 0.3],
};
const BAR_COLORS = {
  allie: [0.36, 0.62, 1.0],
  ennemi: [0.95, 0.3, 0.24],
  batiment: [0.45, 0.85, 0.4],
};

function makePool(geo, material, n, parent, castShadow) {
  const im = new THREE.InstancedMesh(geo, material, n);
  im.count = 0;
  im.frustumCulled = false;
  im.castShadow = castShadow;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.setColorAt(0, _c.setRGB(1, 1, 1));
  im.instanceColor.setUsage(THREE.DynamicDrawUsage);
  parent.add(im);
  return {
    im, n,
    life: new Float32Array(n), max: new Float32Array(n),
    px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    s0: new Float32Array(n), s1: new Float32Array(n), grav: new Float32Array(n), drag: new Float32Array(n),
    r0: new Float32Array(n), g0: new Float32Array(n), b0: new Float32Array(n),
    r1: new Float32Array(n), g1: new Float32Array(n), b1: new Float32Array(n),
    rot: new Float32Array(n), spin: new Float32Array(n), ground: new Float32Array(n),
    cursor: 0,
  };
}

/** Atlas des chiffres dessiné une fois dans une toile (remplissage blanc, contour sombre). */
const GLYPHS = '0123456789+-!';
function makeDigitAtlas() {
  const cw = 48, ch = 64;
  const cv = document.createElement('canvas');
  cv.width = cw * GLYPHS.length;
  cv.height = ch;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.font = '900 50px "Inter", "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (let i = 0; i < GLYPHS.length; i++) {
    const x = i * cw + cw / 2, y = ch / 2 + 2;
    g.lineWidth = 11;
    g.strokeStyle = 'rgba(0,0,0,1)';
    g.strokeText(GLYPHS[i], x, y);
    g.fillStyle = '#ffffff';
    g.fillText(GLYPHS[i], x, y);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/**
 * Crée le système d'effets.
 * @param {THREE.Scene} scene
 * @param {{heightAt?: (x:number, z:number) => number, quality?: string}} [opts]
 * @returns {{
 *   update(dt: number): void,
 *   emit(kind: string, x: number, y: number, z: number, count?: number, spread?: number, speed?: number): void,
 *   dust(x: number, y: number, z: number, n?: number): void,
 *   smoke(x: number, y: number, z: number, n?: number): void,
 *   chimney(x: number, y: number, z: number): void,
 *   fire(x: number, y: number, z: number, n?: number): void,
 *   sparks(x: number, y: number, z: number, n?: number): void,
 *   hitPuff(x: number, y: number, z: number): void,
 *   debris(x: number, y: number, z: number, n?: number, kind?: 'wood'|'stone'): void,
 *   collapse(x: number, y: number, z: number, wood: boolean): void,
 *   trapBurst(x: number, y: number, z: number): void,
 *   celebrate(x: number, y: number, z: number): void,
 *   ring(x: number, y: number, z: number, radius: number, color?: number, life?: number): void,
 *   arrow(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dur?: number): void,
 *   number(x: number, y: number, z: number, value: number, kind?: string, key?: object|null): void,
 *   beginBars(): void, bar(x: number, y: number, z: number, frac: number, kind?: string, width?: number): void, endBars(): void,
 *   setQuality(q: string): void, clear(): void, dispose(): void
 * }}
 */
export function createFx(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'effets';
  scene.add(group);
  const mats = getMaterials();
  const heightAt = opts.heightAt || (() => 0);
  let density = opts.quality === 'economie' ? 0.6 : 1;

  // --- particules -----------------------------------------------------------------
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const sparkGeo = new THREE.IcosahedronGeometry(1, 0);
  const chunkGeo = new THREE.BoxGeometry(1, 0.6, 0.8);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
  // fumée : boules douces et translucides (pas de facettes, sinon on dirait des cailloux)
  const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, depthWrite: false });
  const pools = {
    puff: makePool(puffGeo, puffMat, 480, group, false),
    glow: makePool(sparkGeo, glowMat, 280, group, false),
    chunk: makePool(chunkGeo, mats.lit.clone(), 220, group, true),
  };
  pools.chunk.im.material.vertexColors = false;
  const poolList = [pools.puff, pools.glow, pools.chunk];
  pools.puff.im.renderOrder = 2;
  pools.glow.im.renderOrder = 3;

  /** Émet une particule ; renvoie l'indice ou -1. */
  function spawn(kind, x, y, z, vx, vy, vz, sizeMul = 1, lifeMul = 1) {
    const K = KINDS[kind];
    const P = pools[K.pool];
    // tampon circulaire : on écrase la plus ancienne si tout est plein
    let i = -1;
    for (let tries = 0; tries < P.n; tries++) {
      const j = (P.cursor + tries) % P.n;
      if (P.life[j] <= 0) { i = j; break; }
    }
    if (i < 0) i = P.cursor;
    P.cursor = (i + 1) % P.n;
    const life = K.life * lifeMul * (0.8 + Math.random() * 0.4);
    P.life[i] = life; P.max[i] = life;
    P.px[i] = x; P.py[i] = y; P.pz[i] = z;
    P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.s0[i] = K.s0 * sizeMul; P.s1[i] = K.s1 * sizeMul;
    P.grav[i] = K.grav; P.drag[i] = K.drag;
    _c.set(K.c0); _c2.set(K.c1);
    P.r0[i] = _c.r; P.g0[i] = _c.g; P.b0[i] = _c.b;
    P.r1[i] = _c2.r; P.g1[i] = _c2.g; P.b1[i] = _c2.b;
    P.rot[i] = Math.random() * 6.28;
    P.spin[i] = (Math.random() - 0.5) * (K.pool === 'chunk' ? 14 : 2);
    P.ground[i] = K.pool === 'chunk' ? heightAt(x, z) : -99;
    return i;
  }

  /** Émission générique : n particules dans une sphère, vitesse aléatoire. */
  function emit(kind, x, y, z, count = 6, spread = 0.3, speed = 1) {
    const n = Math.max(1, Math.round(count * density));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const up = Math.random();
      spawn(kind, x + Math.cos(a) * r, y + up * spread * 0.5, z + Math.sin(a) * r,
        Math.cos(a) * speed * (0.4 + Math.random()), speed * (0.3 + up), Math.sin(a) * speed * (0.4 + Math.random()));
    }
  }

  function updatePool(P, dt) {
    const im = P.im;
    let k = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      if (P.life[i] <= 0) continue;
      const f = Math.exp(-P.drag[i] * dt);
      P.vx[i] *= f; P.vz[i] *= f; P.vy[i] = P.vy[i] * f - P.grav[i] * dt;
      P.px[i] += P.vx[i] * dt; P.py[i] += P.vy[i] * dt; P.pz[i] += P.vz[i] * dt;
      if (P.py[i] < P.ground[i] + 0.05) {
        // rebond amorti des débris
        P.py[i] = P.ground[i] + 0.05;
        P.vy[i] = Math.abs(P.vy[i]) > 1 ? -P.vy[i] * 0.3 : 0;
        P.vx[i] *= 0.6; P.vz[i] *= 0.6; P.spin[i] *= 0.6;
      }
      P.rot[i] += P.spin[i] * dt;
      const t = 1 - P.life[i] / P.max[i];
      let s = P.s0[i] + (P.s1[i] - P.s0[i]) * (1 - (1 - t) * (1 - t));
      if (t < 0.12) s *= t / 0.12;
      if (t > 0.7) s *= (1 - t) / 0.3;
      _e.set(P.rot[i] * 0.7, P.rot[i], 0);
      _q.setFromEuler(_e);
      _p.set(P.px[i], P.py[i], P.pz[i]);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      im.setMatrixAt(k, _m);
      _c.setRGB(P.r0[i] + (P.r1[i] - P.r0[i]) * t, P.g0[i] + (P.g1[i] - P.g0[i]) * t, P.b0[i] + (P.b1[i] - P.b0[i]) * t);
      im.setColorAt(k, _c);
      k++;
    }
    im.count = k;
    im.visible = k > 0;
    if (k) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
  }

  // --- flèches -----------------------------------------------------------------------
  const ARROWS = 96;
  const arrowGeo = getArrowGeometry();
  const arrowIm = new THREE.InstancedMesh(arrowGeo, mats.lit, ARROWS);
  arrowIm.count = 0;
  arrowIm.frustumCulled = false;
  arrowIm.castShadow = true;
  arrowIm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(arrowIm);
  const ar = {
    t: new Float32Array(ARROWS).fill(-1), dur: new Float32Array(ARROWS),
    x0: new Float32Array(ARROWS), y0: new Float32Array(ARROWS), z0: new Float32Array(ARROWS),
    x1: new Float32Array(ARROWS), y1: new Float32Array(ARROWS), z1: new Float32Array(ARROWS),
    arc: new Float32Array(ARROWS), cursor: 0,
  };

  function arrow(x0, y0, z0, x1, y1, z1, dur = 0.3) {
    let i = -1;
    for (let k = 0; k < ARROWS; k++) {
      const j = (ar.cursor + k) % ARROWS;
      if (ar.t[j] < 0) { i = j; break; }
    }
    if (i < 0) i = ar.cursor;
    ar.cursor = (i + 1) % ARROWS;
    ar.t[i] = 0; ar.dur[i] = Math.max(0.08, dur);
    ar.x0[i] = x0; ar.y0[i] = y0; ar.z0[i] = z0;
    ar.x1[i] = x1; ar.y1[i] = y1; ar.z1[i] = z1;
    const dist = Math.hypot(x1 - x0, z1 - z0);
    ar.arc[i] = 0.25 + dist * 0.09;
  }

  function updateArrows(dt) {
    let k = 0;
    for (let i = 0; i < ARROWS; i++) {
      if (ar.t[i] < 0) continue;
      ar.t[i] += dt;
      const u = ar.t[i] / ar.dur[i];
      if (u >= 1) {
        ar.t[i] = -1;
        spawn('hit', ar.x1[i], ar.y1[i], ar.z1[i], 0, 0.3, 0, 0.7);
        continue;
      }
      const a = ar.arc[i];
      _p.set(ar.x0[i] + (ar.x1[i] - ar.x0[i]) * u, ar.y0[i] + (ar.y1[i] - ar.y0[i]) * u + a * 4 * u * (1 - u), ar.z0[i] + (ar.z1[i] - ar.z0[i]) * u);
      _d.set(ar.x1[i] - ar.x0[i], ar.y1[i] - ar.y0[i] + a * 4 * (1 - 2 * u), ar.z1[i] - ar.z0[i]).normalize();
      _q.setFromUnitVectors(_Z, _d);
      _s.set(1.25, 1.25, 1.25);
      _m.compose(_p, _q, _s);
      arrowIm.setMatrixAt(k++, _m);
    }
    arrowIm.count = k;
    arrowIm.visible = k > 0;
    if (k) arrowIm.instanceMatrix.needsUpdate = true;
  }

  // --- billboards instanciés (chiffres et barres) ------------------------------------------
  function billboardGeometry(max, attrs) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.index = q.index;
    g.setAttribute('position', q.attributes.position);
    g.setAttribute('uv', q.attributes.uv);
    const out = { g };
    for (const [name, size] of attrs) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      out[name] = a;
    }
    g.instanceCount = 0;
    return out;
  }

  // chiffres de dégâts
  const NUM_MAX = 72, GLYPH_MAX = NUM_MAX * 4;
  const digitTex = makeDigitAtlas();
  const dg = billboardGeometry(GLYPH_MAX, [['iPos', 3], ['iData', 4], ['iCol', 3]]);
  const digitMat = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: digitTex } },
    vertexShader: `
      attribute vec3 iPos; attribute vec4 iData; attribute vec3 iCol;
      varying vec2 vUv; varying vec4 vCol;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float k = clamp(-mv.z / 26.0, 0.8, 1.9);
        float size = iData.z * k;
        mv.xy += (position.xy * vec2(0.75, 1.0) + vec2(iData.x, 0.0)) * size;
        gl_Position = projectionMatrix * mv;
        vUv = vec2((iData.y + uv.x) / ${GLYPHS.length}.0, uv.y);
        vCol = vec4(iCol, iData.w);
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vCol;
      void main() {
        vec4 t = texture2D(uAtlas, vUv);
        if (t.a < 0.02) discard;
        vec3 c = mix(vec3(0.16, 0.09, 0.05), vCol.rgb, t.r);
        gl_FragColor = vec4(c, t.a * vCol.a);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const digits = new THREE.Mesh(dg.g, digitMat);
  digits.frustumCulled = false;
  digits.renderOrder = 20;
  group.add(digits);
  const nums = {
    t: new Float32Array(NUM_MAX).fill(-1), x: new Float32Array(NUM_MAX), y: new Float32Array(NUM_MAX), z: new Float32Array(NUM_MAX),
    g: new Int8Array(NUM_MAX * 4), n: new Int8Array(NUM_MAX), r: new Float32Array(NUM_MAX), gg: new Float32Array(NUM_MAX), b: new Float32Array(NUM_MAX),
    size: new Float32Array(NUM_MAX), drift: new Float32Array(NUM_MAX), cursor: 0,
    v: new Float32Array(NUM_MAX), pop: new Float32Array(NUM_MAX), key: new Array(NUM_MAX).fill(null),
  };
  const FUSION = 0.45; // secondes : des coups sur la même cible dans ce délai s'additionnent (pas de « 10 1010 »)

  /** Écrit les chiffres de la valeur dans l'emplacement i (au plus 4). */
  function glyphes(i, v, kind) {
    const s = String(Math.min(v, 9999));
    let n = 0;
    if (kind === 'soin') nums.g[i * 4 + n++] = 10;
    for (let k = 0; k < s.length && n < 4; k++) nums.g[i * 4 + n++] = s.charCodeAt(k) - 48;
    nums.n[i] = n;
    nums.size[i] = v >= 20 ? 0.55 : 0.42; // plus petits que les unités : la mêlée reste lisible
  }

  /**
   * Chiffre de dégâts flottant. `key` (facultatif) désigne la cible : plusieurs coups rapprochés sur
   * la même cible (tours qui tirent ensemble) sont cumulés en un seul chiffre au lieu de s'empiler.
   */
  function number(x, y, z, value, kind = 'ennemi', key = null) {
    let v = Math.round(Math.abs(value));
    if (!Number.isFinite(v)) return;
    if (key !== null) {
      for (let j = 0; j < NUM_MAX; j++) {
        if (nums.t[j] < 0 || nums.t[j] > FUSION || nums.key[j] !== key) continue;
        const col = NUM_COLORS[kind] || NUM_COLORS.ennemi;
        if (nums.r[j] !== col[0] || nums.gg[j] !== col[1] || nums.b[j] !== col[2]) continue;
        nums.v[j] += v;
        glyphes(j, nums.v[j], kind);
        nums.pop[j] = 0; // le chiffre « rebondit » à chaque coup ajouté
        return;
      }
    }
    let i = -1;
    for (let k = 0; k < NUM_MAX; k++) {
      const j = (nums.cursor + k) % NUM_MAX;
      if (nums.t[j] < 0) { i = j; break; }
    }
    if (i < 0) i = nums.cursor;
    nums.cursor = (i + 1) % NUM_MAX;
    nums.t[i] = 0;
    nums.x[i] = x + (Math.random() - 0.5) * 0.3; nums.y[i] = y; nums.z[i] = z + (Math.random() - 0.5) * 0.3;
    nums.drift[i] = (Math.random() - 0.5) * 0.4;
    nums.v[i] = v;
    nums.pop[i] = 0;
    nums.key[i] = key;
    glyphes(i, v, kind);
    const col = NUM_COLORS[kind] || NUM_COLORS.ennemi;
    nums.r[i] = col[0]; nums.gg[i] = col[1]; nums.b[i] = col[2];
  }

  function updateNumbers(dt) {
    let k = 0;
    const P = dg.iPos.array, D = dg.iData.array, Cc = dg.iCol.array;
    for (let i = 0; i < NUM_MAX; i++) {
      if (nums.t[i] < 0) continue;
      nums.t[i] += dt;
      nums.pop[i] += dt;
      const t = nums.t[i] / 1.05;
      if (t >= 1) { nums.t[i] = -1; nums.key[i] = null; continue; }
      const rise = 0.35 + 1.1 * (1 - (1 - t) * (1 - t));
      const tp = nums.pop[i] / 1.05;
      const pop = tp < 0.12 ? 0.6 + (tp / 0.12) * 0.7 : tp < 0.25 ? 1.3 - ((tp - 0.12) / 0.13) * 0.3 : 1;
      const alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      const n = nums.n[i];
      for (let c = 0; c < n && k < GLYPH_MAX; c++) {
        P[k * 3] = nums.x[i] + nums.drift[i] * t; P[k * 3 + 1] = nums.y[i] + rise; P[k * 3 + 2] = nums.z[i];
        D[k * 4] = (c - (n - 1) / 2) * 0.62; D[k * 4 + 1] = nums.g[i * 4 + c]; D[k * 4 + 2] = nums.size[i] * pop; D[k * 4 + 3] = alpha;
        Cc[k * 3] = nums.r[i]; Cc[k * 3 + 1] = nums.gg[i]; Cc[k * 3 + 2] = nums.b[i];
        k++;
      }
    }
    dg.g.instanceCount = k;
    digits.visible = k > 0;
    if (k) { dg.iPos.needsUpdate = true; dg.iData.needsUpdate = true; dg.iCol.needsUpdate = true; }
  }

  // barres de vie
  const BAR_MAX = 140;
  const bg = billboardGeometry(BAR_MAX, [['iPos', 3], ['iData', 4], ['iCol', 3]]);
  const barMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec3 iPos; attribute vec4 iData; attribute vec3 iCol;
      varying vec2 vUv; varying vec4 vData; varying vec3 vCol;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        float k = clamp(-mv.z / 26.0, 0.85, 1.8);
        mv.xy += position.xy * vec2(iData.y, 0.15) * k;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vData = iData; vCol = iCol;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec4 vData; varying vec3 vCol;
      void main() {
        float bx = 0.035 / max(vData.y, 0.2);
        bool border = vUv.y < 0.22 || vUv.y > 0.78 || vUv.x < bx || vUv.x > 1.0 - bx;
        vec3 c;
        if (border) c = vec3(0.08, 0.06, 0.05);
        else if ((vUv.x - bx) / (1.0 - 2.0 * bx) <= vData.x) c = vCol * (vUv.y > 0.55 ? 1.15 : 0.92);
        else c = vec3(0.22, 0.18, 0.16);
        gl_FragColor = vec4(c, vData.z);
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const bars = new THREE.Mesh(bg.g, barMat);
  bars.frustumCulled = false;
  bars.renderOrder = 15;
  group.add(bars);
  let barN = 0;
  function beginBars() { barN = 0; }
  /** Ajoute une barre de vie pour cette image (frac 0..1). */
  function bar(x, y, z, frac, kind = 'ennemi', width = 0.7) {
    if (barN >= BAR_MAX) return;
    const P = bg.iPos.array, D = bg.iData.array, Cc = bg.iCol.array;
    const i = barN++;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    D[i * 4] = Math.max(0, Math.min(1, frac)); D[i * 4 + 1] = width; D[i * 4 + 2] = 0.95; D[i * 4 + 3] = 0;
    let col = BAR_COLORS[kind] || BAR_COLORS.ennemi;
    if (kind === 'batiment' && frac < 0.5) col = frac < 0.25 ? BAR_COLORS.ennemi : NUM_COLORS.batiment;
    Cc[i * 3] = col[0]; Cc[i * 3 + 1] = col[1]; Cc[i * 3 + 2] = col[2];
  }
  function endBars() {
    bg.g.instanceCount = barN;
    bars.visible = barN > 0;
    if (barN) { bg.iPos.needsUpdate = true; bg.iData.needsUpdate = true; bg.iCol.needsUpdate = true; }
  }

  // --- ondes au sol ----------------------------------------------------------------------------
  const ringGeo = new THREE.RingGeometry(0.82, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 4;
    group.add(m);
    rings.push({ m, t: -1, life: 0.6, r: 1 });
  }
  let ringCursor = 0;
  function ring(x, y, z, radius, color = 0xfff1c8, life = 0.6) {
    const R = rings[ringCursor];
    ringCursor = (ringCursor + 1) % rings.length;
    R.t = 0; R.life = life; R.r = radius;
    R.m.position.set(x, y + 0.06, z);
    R.m.material.color.set(color);
    R.m.visible = true;
  }
  function updateRings(dt) {
    for (const R of rings) {
      if (R.t < 0) continue;
      R.t += dt;
      const t = R.t / R.life;
      if (t >= 1) { R.t = -1; R.m.visible = false; continue; }
      const s = R.r * (0.25 + 0.75 * (1 - (1 - t) * (1 - t)));
      R.m.scale.set(s, 1, s);
      R.m.material.opacity = 0.75 * (1 - t);
    }
  }

  // --- effets composés --------------------------------------------------------------------------
  const api = {
    update(dt) {
      for (let i = 0; i < poolList.length; i++) updatePool(poolList[i], dt);
      updateArrows(dt);
      updateNumbers(dt);
      updateRings(dt);
    },
    emit,
    dust(x, y, z, n = 8) { emit('dust', x, y + 0.1, z, n, 0.45, 1.1); },
    smoke(x, y, z, n = 1) {
      for (let k = 0; k < n; k++) spawn('smoke', x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2 + 0.15, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2 + 0.1);
    },
    chimney(x, y, z) { spawn('chimney', x, y, z, 0.12 + Math.random() * 0.06, 0.45, 0.06 + Math.random() * 0.05); },
    fire(x, y, z, n = 1) {
      for (let k = 0; k < n; k++) spawn('fire', x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, 0, 0.6 + Math.random() * 0.5, 0, 1.2);
    },
    sparks(x, y, z, n = 6) { emit('spark', x, y, z, n, 0.08, 2.4); },
    hitPuff(x, y, z) { emit('hit', x, y, z, 3, 0.12, 0.8); emit('spark', x, y, z, 2, 0.05, 1.8); },
    debris(x, y, z, n = 10, kind = 'wood') { emit(kind, x, y, z, n, 0.4, 3.2); },
    /** Effondrement d'un bâtiment : débris, poussière, fumée, onde. */
    collapse(x, y, z, wood) {
      emit(wood ? 'wood' : 'stone', x, y + 0.6, z, 22, 0.6, 3.6);
      emit(wood ? 'stone' : 'wood', x, y + 0.4, z, 6, 0.5, 2.6);
      emit('dust', x, y + 0.2, z, 18, 0.9, 1.8);
      for (let k = 0; k < 8; k++) api.smoke(x, y + 0.5 + k * 0.1, z);
      api.fire(x, y + 0.3, z, 6);
      ring(x, y, z, 2.4, 0xe8d2a8, 0.7);
    },
    /** Piège déclenché : poussière, éclats, onde dorée. */
    trapBurst(x, y, z) {
      emit('dust', x, y + 0.1, z, 16, 0.7, 2.2);
      emit('wood', x, y + 0.3, z, 8, 0.4, 3.0);
      emit('leaf', x, y + 0.3, z, 8, 0.5, 2.0);
      ring(x, y, z, 2.2, 0xffd36a, 0.55);
    },
    /** Victoire de vague : gerbe dorée. */
    celebrate(x, y, z) {
      emit('gold', x, y + 2.5, z, 40, 0.4, 4.5);
      ring(x, y, z, 3.5, 0xffe08a, 1.0);
    },
    ring, arrow, number,
    beginBars, bar, endBars,
    setQuality(q) { density = q === 'economie' ? 0.6 : 1; },
    /** Efface tous les effets en cours. */
    clear() {
      for (const k in pools) { pools[k].life.fill(0); pools[k].im.count = 0; }
      ar.t.fill(-1); nums.t.fill(-1); nums.key.fill(null);
      for (const R of rings) { R.t = -1; R.m.visible = false; }
    },
    dispose() {
      group.removeFromParent();
      puffGeo.dispose(); sparkGeo.dispose(); chunkGeo.dispose(); glowMat.dispose(); puffMat.dispose(); pools.chunk.im.material.dispose();
      arrowGeo.dispose(); digitTex.dispose(); digitMat.dispose(); dg.g.dispose(); barMat.dispose(); bg.g.dispose();
      ringGeo.dispose();
      for (const R of rings) R.m.material.dispose();
      for (const k in pools) pools[k].im.dispose();
      arrowIm.dispose();
    },
  };
  return api;
}
