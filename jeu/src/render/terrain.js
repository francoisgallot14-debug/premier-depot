// Terrain : une île low-poly (falaises, mer animée, ruisseau, pont d'arrivée de la route),
// arbres, rochers et petit décor instanciés. Construit une seule fois à partir de la carte.
import * as THREE from 'three';
import {
  PALETTE as C, ModelBuilder, makeRng, getMaterials, SHARED_UNIFORMS,
  getTreeGeometries, getRockGeometries, getDecorGeometries,
} from './models.js';

/** Taille d'une tuile en unités monde (contrat §2 de la spécification). */
export const TILE = 2;
const BORD = 5; // tuiles de terre décorative autour de la zone jouable
const SUB = 2; // subdivisions par tuile
const MER_Y = -1.05; // niveau de la mer
const FOND_Y = -2.7; // pied des falaises

/** Hauteur visée au centre de chaque type de tuile. */
const HAUTEUR = { grass: 0, road: -0.13, forest: 0.07, rock: 0.2, water: -0.6 };
/** Couleur de base par type de tuile. */
const COULEUR = {
  grass: C.herbe, road: C.route, forest: C.herbeForet, rock: 0x8f9a7e, water: 0x6f8a62,
};

const _col = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Bruit lisse peu coûteux (somme de sinus), déterministe. */
function smoothNoise(x, z, seed) {
  return (
    Math.sin(x * 0.61 + seed * 1.3) * Math.cos(z * 0.53 - seed * 0.7) * 0.5 +
    Math.sin(x * 1.37 - z * 0.91 + seed * 2.1) * 0.3 +
    Math.cos(x * 2.9 + z * 2.3 + seed) * 0.2
  );
}

/** Matériau d'eau : facettes scintillantes et houle douce (sommets animés). */
function waterMaterial(color, opacity, amp) {
  const m = new THREE.MeshPhongMaterial({
    color, flatShading: true, shininess: 70, specular: 0x9fd6e8,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHARED_UNIFORMS.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 wpos = modelMatrix * vec4(position, 1.0);
      transformed.y += (sin(wpos.x * 0.55 + uTime * 1.25) * 0.6 + cos(wpos.z * 0.47 + uTime * 0.95) * 0.5
        + sin((wpos.x + wpos.z) * 1.3 + uTime * 2.1) * 0.25) * ${amp.toFixed(3)};`
    );
  };
  m.customProgramCacheKey = () => 'eau' + amp;
  return m;
}

/** Mer : comme l'eau, plus des hauts-fonds turquoise et une écume animée le long des côtes. */
function seaMaterial(maskTex, min, size) {
  const m = waterMaterial(C.mer, 1, 0.07);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader) => {
    base(shader);
    shader.uniforms.uMask = { value: maskTex };
    shader.uniforms.uMaskMin = { value: new THREE.Vector2(min.x, min.y) };
    shader.uniforms.uMaskSize = { value: size };
    shader.uniforms.uShallow = { value: new THREE.Color(C.merClaire) };
    shader.vertexShader = 'uniform vec2 uMaskMin; uniform float uMaskSize; varying vec2 vMaskUv;\n' + shader.vertexShader.replace(
      'transformed.y +=',
      'vMaskUv = (wpos.xz - uMaskMin) / uMaskSize;\n      transformed.y +='
    );
    shader.fragmentShader = 'uniform sampler2D uMask; uniform float uTime; uniform vec3 uShallow; varying vec2 vMaskUv;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec4 mk = texture2D(uMask, vMaskUv);
        // hauts-fonds clairs près des côtes
        diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, smoothstep(0.02, 0.75, mk.g) * 0.85);
        // écume : bande qui ondule au pied des falaises
        float e = mk.r;
        float rip = 0.5 + 0.5 * sin(e * 26.0 - uTime * 1.8 + (vMaskUv.x + vMaskUv.y) * 60.0);
        float foam = smoothstep(0.16, 0.34, e) * (0.45 + 0.55 * rip) * (1.0 - smoothstep(0.34, 0.42, e) * 0.0);
        foam = max(foam * smoothstep(0.16, 0.3, e), smoothstep(0.36, 0.5, e));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 0.97), clamp(foam, 0.0, 1.0));`
      );
  };
  m.customProgramCacheKey = () => 'mer';
  return m;
}

/** Flou « boîte » séparable, en place, répété `passes` fois. */
function boxBlur(src, n, r, passes) {
  const tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < n; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * n + Math.min(n - 1, Math.max(0, x))];
      for (let x = 0; x < n; x++) {
        tmp[y * n + x] = acc / (2 * r + 1);
        acc += src[y * n + Math.min(n - 1, x + r + 1)] - src[y * n + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
      for (let y = 0; y < n; y++) {
        src[y * n + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
      }
    }
  }
}

/**
 * Construit le terrain.
 * @param {{w:number,h:number,tiles:string[][],path:{x:number,z:number}[]}} map carte du chapitre
 * @param {{seed?: number}} [opts]
 * @returns {{
 *   group: THREE.Group,
 *   heightAt(wx: number, wz: number): number,
 *   tileHeight(x: number, z: number): number,
 *   setTileOccupied(x: number, z: number, occupied: boolean): void,
 *   exit: {x:number,z:number,dx:number,dz:number}|null,
 *   halfW: number, halfH: number,
 *   dispose(): void
 * }}
 */
export function createTerrain(map, opts = {}) {
  const W = map.w, H = map.h;
  const seed = (opts.seed ?? 7) >>> 0;
  const rng = makeRng(seed * 31 + 5);
  const group = new THREE.Group();
  group.name = 'terrain';
  const mats = getMaterials();
  const disposables = [];

  const tileAt = (x, z) => (x >= 0 && z >= 0 && x < W && z < H ? map.tiles[z][x] : null);

  // Sortie de la route (bord de carte du premier point du chemin) : un pont y arrive
  let exit = null;
  if (map.path && map.path.length) {
    const p0 = map.path[0];
    let dx = 0, dz = 0;
    if (p0.z === 0) dz = -1; else if (p0.z === H - 1) dz = 1; else if (p0.x === 0) dx = -1; else if (p0.x === W - 1) dx = 1;
    if (dx || dz) exit = { x: p0.x, z: p0.z, dx, dz };
  }
  // Sorties d'eau au bord (cascades) : pas de terre décorative devant
  const outlets = [];
  for (let x = 0; x < W; x++) {
    if (tileAt(x, 0) === 'water') outlets.push({ x, z: 0, dx: 0, dz: -1 });
    if (tileAt(x, H - 1) === 'water') outlets.push({ x, z: H - 1, dx: 0, dz: 1 });
  }
  for (let z = 0; z < H; z++) {
    if (tileAt(0, z) === 'water') outlets.push({ x: 0, z, dx: -1, dz: 0 });
    if (tileAt(W - 1, z) === 'water') outlets.push({ x: W - 1, z, dx: 1, dz: 0 });
  }
  const gaps = exit ? [exit, ...outlets] : outlets;

  // --- grille de sommets -----------------------------------------------------
  const NX = (W + 2 * BORD) * SUB, NZ = (H + 2 * BORD) * SUB;
  const VX = NX + 1, VZ = NZ + 1;
  const heights = new Float32Array(VX * VZ);
  const land = new Uint8Array(VX * VZ); // 0 mer, 1 bordure, 2 zone jouable
  const outside = (tx, tz) => Math.max(0, -tx, tx - W, -tz, tz - H);

  for (let j = 0; j < VZ; j++) {
    for (let i = 0; i < VX; i++) {
      const tx = -BORD + i / SUB, tz = -BORD + j / SUB;
      const k = j * VX + i;
      const d = outside(tx, tz);
      if (d === 0) {
        land[k] = 2;
        // moyenne des hauteurs des tuiles jouables qui touchent ce sommet
        let sum = 0, n = 0;
        const x0 = Number.isInteger(tx) ? tx - 1 : Math.floor(tx), x1 = Math.floor(tx);
        const z0 = Number.isInteger(tz) ? tz - 1 : Math.floor(tz), z1 = Math.floor(tz);
        for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
          const t = tileAt(xx, zz);
          if (t) { sum += HAUTEUR[t] ?? 0; n++; }
        }
        let h = n ? sum / n : 0;
        const t = tileAt(Math.min(W - 1, Math.floor(tx)), Math.min(H - 1, Math.floor(tz)));
        const allRoad = n && sum / n <= HAUTEUR.road + 0.001;
        h += smoothNoise(tx * 1.7, tz * 1.7, seed) * (allRoad ? 0.01 : 0.035);
        if (t === 'rock' && !Number.isInteger(tx) && !Number.isInteger(tz)) h += 0.1 + rng() * 0.22;
        heights[k] = h;
      } else {
        // côte irrégulière : bruit selon la position
        let thr = 1.1 + (smoothNoise(tx * 0.45, tz * 0.45, seed + 3) + 1) * 1.7;
        for (const g of gaps) {
          // pas de terre devant la route ni devant les cascades
          const ex = g.x + 0.5, ez = g.z + 0.5;
          const along = (tx - ex) * g.dx + (tz - ez) * g.dz;
          const perp = Math.abs((tx - ex) * g.dz) + Math.abs((tz - ez) * g.dx);
          if (along > 0 && perp < 1.6 + along * 0.3) thr = Math.min(thr, 0.01);
        }
        if (d < thr) {
          land[k] = 1;
          heights[k] = 0.12 + Math.max(0, smoothNoise(tx * 0.33, tz * 0.33, seed + 9)) * 0.9 * Math.min(1, d / 2) + rng() * 0.05;
        } else {
          heights[k] = FOND_Y + rng() * 0.3;
        }
      }
    }
  }
  const H_ = (i, j) => heights[j * VX + i];

  // --- maillage du sol (non indexé, couleur par facette) ------------------------
  const triCount = NX * NZ * 2;
  const pos = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  let pi = 0;
  const baseX = -(W / 2 + BORD) * TILE, baseZ = -(H / 2 + BORD) * TILE;
  const step = TILE / SUB;
  const tileVar = new Float32Array(W * H);
  for (let i = 0; i < tileVar.length; i++) tileVar[i] = (rng() - 0.5) * 0.05;

  function faceColor(i, j, hmin, hmax, havg) {
    const cx = -BORD + (i + 0.5) / SUB, cz = -BORD + (j + 0.5) / SUB;
    const tx = Math.floor(cx), tz = Math.floor(cz);
    const t = tileAt(tx, tz);
    if (hmin < -0.32 && !(t === 'water' && hmin > -0.7)) return true; // falaise : couleur par sommet
    if (t) {
      _col.set(COULEUR[t] ?? C.herbe);
      const v = tileVar[tz * W + tx];
      _col.getHSL(_hsl);
      _col.setHSL(_hsl.h + v * 0.15, _hsl.s, _hsl.l + v);
      if (t === 'water' && havg > -0.32) _col.set(C.sable);
      if (t === 'road') {
        // bords de route plus clairs si la facette touche l'herbe
        const lx = cx - tx, lz = cz - tz;
        const nx = lx < 0.5 ? tx - 1 : tx + 1, nz = lz < 0.5 ? tz - 1 : tz + 1;
        const a = tileAt(nx, tz), b = tileAt(tx, nz);
        if ((a && a !== 'road') || (b && b !== 'road')) _col.offsetHSL(0, -0.05, 0.035);
      }
    } else {
      // bordure décorative : herbe un peu plus sombre et dense
      _col.set(0x6f9d43);
      const n = smoothNoise(cx * 0.8, cz * 0.8, seed + 4);
      _col.offsetHSL(n * 0.015, 0, n * 0.03 + (havg - 0.2) * 0.05);
    }
    return false;
  }
  const _cTop = new THREE.Color(0x9a7650), _cMid = new THREE.Color(0x7d6650), _cBot = new THREE.Color(0x5b5f5e);
  /** Couleur de falaise selon la hauteur du sommet : terre en haut, roche grise en bas. */
  function cliffColor(h, jit, out) {
    const t = Math.min(1, Math.max(0, (0.1 - h) / 2.2));
    if (t < 0.45) out.copy(_cTop).lerp(_cMid, t / 0.45); else out.copy(_cMid).lerp(_cBot, (t - 0.45) / 0.55);
    out.offsetHSL(0, 0, jit);
    return out;
  }
  const _cv = new THREE.Color();

  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const h00 = H_(i, j), h10 = H_(i + 1, j), h01 = H_(i, j + 1), h11 = H_(i + 1, j + 1);
      const x0 = baseX + i * step, x1 = x0 + step, z0 = baseZ + j * step, z1 = z0 + step;
      const flip = (i + j) % 2 === 0;
      const tris = flip
        ? [[x0, h00, z0, x0, h01, z1, x1, h11, z1], [x0, h00, z0, x1, h11, z1, x1, h10, z0]]
        : [[x0, h00, z0, x0, h01, z1, x1, h10, z0], [x1, h10, z0, x0, h01, z1, x1, h11, z1]];
      for (const t of tris) {
        const hmin = Math.min(t[1], t[4], t[7]), hmax = Math.max(t[1], t[4], t[7]);
        const cliff = faceColor(i, j, hmin, hmax, (t[1] + t[4] + t[7]) / 3);
        const jit = (rng() - 0.5) * 0.025;
        for (let v = 0; v < 9; v++) pos[pi + v] = t[v];
        if (cliff) {
          const fj = (rng() - 0.5) * 0.06;
          for (let v = 0; v < 9; v += 3) {
            cliffColor(t[v + 1], fj, _cv);
            col[pi + v] = _cv.r; col[pi + v + 1] = _cv.g; col[pi + v + 2] = _cv.b;
          }
        } else {
          _col.getHSL(_hsl);
          _col.setHSL(_hsl.h, _hsl.s, Math.max(0, _hsl.l + jit));
          for (let v = 0; v < 9; v += 3) { col[pi + v] = _col.r; col[pi + v + 1] = _col.g; col[pi + v + 2] = _col.b; }
        }
        pi += 9;
      }
    }
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  groundGeo.computeVertexNormals();
  groundGeo.computeBoundingSphere();
  const ground = new THREE.Mesh(groundGeo, mats.lit);
  ground.receiveShadow = true;
  ground.name = 'sol';
  group.add(ground);
  disposables.push(groundGeo);

  // --- mer : masque terre/mer flouté (écume, hauts-fonds) ----------------------------
  const MS = 128, PAD = 16;
  const mSize = NX * step + PAD * 2;
  const mMin = { x: baseX - PAD, y: baseZ - PAD };
  const sharp = new Float32Array(MS * MS);
  for (let y = 0; y < MS; y++) for (let x = 0; x < MS; x++) {
    const wx = mMin.x + ((x + 0.5) / MS) * mSize, wz = mMin.y + ((y + 0.5) / MS) * mSize;
    const i = Math.round((wx - baseX) / step), j = Math.round((wz - baseZ) / step);
    if (i < 0 || j < 0 || i >= VX || j >= VZ) continue;
    // terre au-dessus de la mer seulement (le lit du ruisseau compte comme terre)
    sharp[y * MS + x] = heights[j * VX + i] > MER_Y - 0.2 ? 1 : 0;
  }
  const wide = sharp.slice();
  boxBlur(sharp, MS, 1, 2);
  boxBlur(wide, MS, 3, 3);
  const maskData = new Uint8Array(MS * MS * 4);
  for (let k = 0; k < MS * MS; k++) {
    maskData[k * 4] = Math.round(sharp[k] * 255);
    maskData[k * 4 + 1] = Math.round(wide[k] * 255);
    maskData[k * 4 + 3] = 255;
  }
  const maskTex = new THREE.DataTexture(maskData, MS, MS, THREE.RGBAFormat, THREE.UnsignedByteType);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
  maskTex.needsUpdate = true;
  disposables.push(maskTex);

  const seaGeo = new THREE.PlaneGeometry(240, 240, 80, 80).toNonIndexed();
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = seaMaterial(maskTex, mMin, mSize);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.y = MER_Y;
  sea.receiveShadow = true;
  sea.name = 'mer';
  group.add(sea);
  disposables.push(seaGeo, seaMat);

  // --- ruisseau (surface d'eau sur les tuiles d'eau) ----------------------------------
  const wb = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (tileAt(x, z) !== 'water') continue;
    // déborde un peu sur les voisines d'eau pour une surface continue
    const x0 = baseX + (x + BORD) * TILE - (tileAt(x - 1, z) === 'water' ? 0.05 : -0.3);
    const x1 = baseX + (x + BORD + 1) * TILE + (tileAt(x + 1, z) === 'water' ? 0.05 : -0.3);
    const z0 = baseZ + (z + BORD) * TILE - (tileAt(x, z - 1) === 'water' ? 0.05 : -0.3);
    const z1 = baseZ + (z + BORD + 1) * TILE + (tileAt(x, z + 1) === 'water' ? 0.05 : -0.3);
    const n = 3;
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const ax = x0 + (x1 - x0) * a / n, bx = x0 + (x1 - x0) * (a + 1) / n;
      const az = z0 + (z1 - z0) * b / n, bz = z0 + (z1 - z0) * (b + 1) / n;
      wb.push(ax, 0, az, ax, 0, bz, bx, 0, az, bx, 0, az, ax, 0, bz, bx, 0, bz);
    }
  }
  // cascades : rideau d'eau qui tombe dans la mer
  for (const o of outlets) {
    const cx = baseX + (o.x + BORD + 0.5) * TILE, cz = baseZ + (o.z + BORD + 0.5) * TILE;
    const ex = cx + o.dx * TILE * 0.5, ez = cz + o.dz * TILE * 0.5;
    const px = o.dz ? 0.7 : 0, pz = o.dx ? 0.7 : 0;
    const top = 0, bot = MER_Y - 0.15 + 0.2;
    const out = 0.35;
    const n = 4;
    for (let s = 0; s < n; s++) {
      const y0 = top + (bot - top) * s / n, y1 = top + (bot - top) * (s + 1) / n;
      const o0 = out * (s / n) ** 0.6, o1 = out * ((s + 1) / n) ** 0.6;
      const ax = ex - px + o.dx * o0, az = ez - pz + o.dz * o0, bx = ex + px + o.dx * o0, bz = ez + pz + o.dz * o0;
      const cx2 = ex - px + o.dx * o1, cz2 = ez - pz + o.dz * o1, dx2 = ex + px + o.dx * o1, dz2 = ez + pz + o.dz * o1;
      wb.push(ax, y0, az, cx2, y1, cz2, bx, y0, bz, bx, y0, bz, cx2, y1, cz2, dx2, y1, dz2);
    }
  }
  if (wb.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wb, 3));
    g.computeVertexNormals();
    const wm = waterMaterial(C.eau, 0.82, 0.03);
    wm.side = THREE.DoubleSide;
    const water = new THREE.Mesh(g, wm);
    water.position.y = -0.22;
    water.renderOrder = 1;
    water.name = 'ruisseau';
    group.add(water);
    disposables.push(g, wm);
  }

  // --- pont d'arrivée de la route ------------------------------------------------------
  if (exit) {
    const b = new ModelBuilder(77);
    const len = 46;
    const segs = Math.round(len / 0.5);
    for (let s = 0; s < segs; s++) {
      const d = s * 0.5 + 0.25;
      const y = -0.1 - Math.max(0, d - 6) * 0.012;
      b.boxB(1.7, 0.08, 0.44, s % 3 ? C.bois : C.boisClair, 0, y - 0.08, d, 0);
    }
    for (let d = 1.5; d < len; d += 3) {
      const y = -0.1 - Math.max(0, d - 6) * 0.012;
      for (const sx of [-0.9, 0.9]) {
        b.boxB(0.12, y + 2.2 + 0.5, 0.12, C.boisSombre, sx, -2.2, d);
      }
      b.box(0.08, 0.06, 3.0, C.boisSombre, -0.9, y + 0.42, d + 1.5);
      b.box(0.08, 0.06, 3.0, C.boisSombre, 0.9, y + 0.42, d + 1.5);
    }
    // lanternes de pierre à l'entrée du pont
    b.boxB(0.3, 0.7, 0.3, C.pierre, -1.15, -0.2, 0.3);
    b.boxB(0.3, 0.7, 0.3, C.pierre, 1.15, -0.2, 0.3);
    b.cone(0.24, 0.3, 4, C.tuileSombre, -1.15, 0.65, 0.3, 0, Math.PI / 4);
    b.cone(0.24, 0.3, 4, C.tuileSombre, 1.15, 0.65, 0.3, 0, Math.PI / 4);
    const g = b.build();
    const bridge = new THREE.Mesh(g.lit, mats.lit);
    bridge.castShadow = true;
    bridge.receiveShadow = true;
    const sx = baseX + (exit.x + BORD + 0.5) * TILE + exit.dx * TILE * 0.5;
    const sz = baseZ + (exit.z + BORD + 0.5) * TILE + exit.dz * TILE * 0.5;
    bridge.position.set(sx, 0, sz);
    bridge.rotation.y = Math.atan2(exit.dx, exit.dz);
    bridge.name = 'pont';
    group.add(bridge);
    disposables.push(g.lit);
  }

  // --- arbres, rochers, décor (instanciés) ------------------------------------------------
  const trees = getTreeGeometries();
  const rocks = getRockGeometries();
  const decor = getDecorGeometries();
  disposables.push(trees.pine, trees.round, trees.birch, rocks.big, rocks.small, decor.tuft, decor.flowers, decor.bush, decor.pebbles);
  const treeList = { pine: [], round: [], birch: [] };
  const rockList = { big: [], small: [] };
  const decorList = { tuft: [], flowers: [], bush: [], pebbles: [] };

  function heightAt(wx, wz) {
    const fi = (wx - baseX) / step, fj = (wz - baseZ) / step;
    const i = Math.max(0, Math.min(NX - 1, Math.floor(fi))), j = Math.max(0, Math.min(NZ - 1, Math.floor(fj)));
    const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
    const a = H_(i, j), b = H_(i + 1, j), c = H_(i, j + 1), d = H_(i + 1, j + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  // direction de la route (pour poser les cailloux sur ses bords)
  const pIndex = new Map();
  (map.path || []).forEach((p, i) => pIndex.set(p.z * W + p.x, i));
  function pathIndexOf(x, z) { const i = pIndex.get(z * W + x); return i === undefined ? -1 : i; }
  function pathDirX(i) {
    const P = map.path, a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    return Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
  }
  const tileWX = (x) => (x - W / 2 + 0.5) * TILE;
  const tileWZ = (z) => (z - H / 2 + 0.5) * TILE;

  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const t = tileAt(x, z);
    const cx = tileWX(x), cz = tileWZ(z);
    if (t === 'forest') {
      const n = 2 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const ox = (rng() - 0.5) * 1.5, oz = (rng() - 0.5) * 1.5;
        const r = rng();
        const kind = r < 0.55 ? 'pine' : r < 0.85 ? 'round' : 'birch';
        treeList[kind].push([cx + ox, cz + oz, 0.85 + rng() * 0.45, rng() * 6.28, -1]);
      }
    } else if (t === 'rock') {
      rockList.big.push([cx + (rng() - 0.5) * 0.5, cz + (rng() - 0.5) * 0.5, 0.9 + rng() * 0.5, rng() * 6.28, -1]);
      const n = 1 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) rockList.small.push([cx + (rng() - 0.5) * 1.6, cz + (rng() - 0.5) * 1.6, 0.7 + rng() * 0.6, rng() * 6.28, -1]);
    } else if (t === 'road') {
      const ti = z * W + x;
      const n = 1 + Math.floor(rng() * 2.5);
      for (let k = 0; k < n; k++) {
        // surtout sur les bords de la route
        const side = rng() < 0.5 ? -1 : 1;
        const along = (rng() - 0.5) * 1.6, across = side * (0.45 + rng() * 0.45);
        const pi = pathIndexOf(x, z);
        const alongX = pi >= 0 ? pathDirX(pi) : 0;
        const ox = alongX ? along : across, oz = alongX ? across : along;
        decorList.pebbles.push([cx + ox, cz + oz, 0.8 + rng() * 0.7, rng() * 6.28, ti]);
      }
    } else if (t === 'grass') {
      // petit décor : touffes, fleurs, buissons (cachés si on construit sur la tuile)
      let nearRoad = false;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (tileAt(x + ax, z + az) === 'road') nearRoad = true;
      const ti = z * W + x;
      const n = rng() < 0.75 ? 1 + Math.floor(rng() * 2.2) : 0;
      for (let k = 0; k < n; k++) {
        const r = rng();
        const kind = r < 0.62 ? 'tuft' : r < 0.9 || nearRoad ? 'flowers' : 'bush';
        decorList[kind].push([cx + (rng() - 0.5) * 1.7, cz + (rng() - 0.5) * 1.7, 0.8 + rng() * 0.6, rng() * 6.28, ti]);
      }
    }
  }
  // bordure : bosquets et rochers en grappes
  for (let j = 0; j < NZ; j += 1) for (let i = 0; i < NX; i += 1) {
    const k = j * VX + i;
    if (land[k] !== 1 || land[k + 1] === 0 || land[k + VX] === 0 || land[k + VX + 1] === 0) continue;
    const tx = -BORD + (i + 0.5) / SUB, tz = -BORD + (j + 0.5) / SUB;
    if (outside(tx, tz) < 0.7) continue;
    const wx = baseX + (i + 0.5) * step, wz = baseZ + (j + 0.5) * step;
    const dens = smoothNoise(tx * 0.5, tz * 0.5, seed + 11);
    if (dens > -0.1 && rng() < 0.55) {
      const r = rng();
      const kind = r < 0.5 ? 'pine' : r < 0.82 ? 'round' : 'birch';
      treeList[kind].push([wx + (rng() - 0.5) * 0.8, wz + (rng() - 0.5) * 0.8, 0.9 + rng() * 0.6, rng() * 6.28, -1]);
    } else if (rng() < 0.05) {
      rockList.small.push([wx, wz, 0.8 + rng() * 0.8, rng() * 6.28, -1]);
    } else if (rng() < 0.25) {
      decorList.tuft.push([wx + (rng() - 0.5), wz + (rng() - 0.5), 1, rng() * 6.28, -1]);
    }
  }

  const tileDecor = new Map(); // tuile -> [{mesh, idx}]
  function makeInstanced(geo, material, list, { shadow = true, tint = null } = {}) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, z, s, ry, ti] = list[i];
      _p.set(x, heightAt(x, z) - 0.02, z);
      _e.set(0, ry, 0);
      _q.setFromEuler(_e);
      _s.set(s, s * (0.9 + ((i * 37) % 10) * 0.025), s);
      _m4.compose(_p, _q, _s);
      im.setMatrixAt(i, _m4);
      if (tint) im.setColorAt(i, tint(i));
      if (ti >= 0) {
        let arr = tileDecor.get(ti);
        if (!arr) tileDecor.set(ti, (arr = []));
        arr.push({ mesh: im, idx: i, m: _m4.clone() });
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  }
  for (const k of ['pine', 'round', 'birch']) makeInstanced(trees[k], mats.sway, treeList[k]);
  const rockTint = (i) => _col.set(C.roche).offsetHSL(0, 0, ((i * 53) % 9 - 4) * 0.02);
  makeInstanced(rocks.big, mats.lit, rockList.big, { tint: rockTint });
  makeInstanced(rocks.small, mats.lit, rockList.small, { tint: rockTint });
  makeInstanced(decor.tuft, mats.lit, decorList.tuft, { shadow: false });
  makeInstanced(decor.flowers, mats.lit, decorList.flowers, { shadow: false });
  makeInstanced(decor.bush, mats.lit, decorList.bush, { shadow: true });
  makeInstanced(decor.pebbles, mats.lit, decorList.pebbles, { shadow: false });

  const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** Cache/montre le décor d'une tuile (quand on y bâtit). */
  function setTileOccupied(x, z, occupied) {
    const arr = tileDecor.get(z * W + x);
    if (!arr) return;
    for (const d of arr) {
      d.mesh.setMatrixAt(d.idx, occupied ? _zero : d.m);
      d.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Hauteur au centre d'une tuile jouable. */
  function tileHeight(x, z) {
    const i = (x + BORD) * SUB + SUB / 2, j = (z + BORD) * SUB + SUB / 2;
    if (i < 0 || j < 0 || i >= VX || j >= VZ) return 0;
    return H_(i, j);
  }

  return {
    group, heightAt, tileHeight, setTileOccupied, exit,
    halfW: (W / 2) * TILE, halfH: (H / 2) * TILE,
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    },
  };
}
