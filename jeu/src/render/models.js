// Modèles low-poly procéduraux : bâtiments, ruines, unités, arbres, rochers, décor.
// Tout est fusionné en une géométrie à couleurs de sommets par modèle (1 appel de dessin),
// et les géométries sont mises en cache : chaque type n'est construit qu'une seule fois.
import * as THREE from 'three';

/** Petit générateur pseudo-aléatoire déterministe (mulberry32) pour le rendu. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Palette commune (couleurs sRGB). Chaleureuse, saturée mais douce. */
export const PALETTE = {
  herbe: 0x77a546, herbeClaire: 0x8bb654, herbeSombre: 0x5f8d3a, herbeForet: 0x527c33,
  route: 0xd2a865, routeSombre: 0xbb8f50, terre: 0x8a6542, terreSombre: 0x6b4c31, falaise: 0x9a7b56,
  roche: 0x858c96, rocheClaire: 0x9ba3ad, rocheSombre: 0x646b75, sable: 0xd9c08a,
  eau: 0x46b2c8, mer: 0x266d97, merClaire: 0x52c3c4,
  bois: 0x9c6b3f, boisSombre: 0x6b4528, boisClair: 0xc0915a, boisBrule: 0x2e2622,
  paille: 0xe3c26a, pailleSombre: 0xc9a24a,
  tuile: 0xb5523b, tuileSombre: 0x8e3f2e, ardoise: 0x56606e, toitVert: 0x5f7a45,
  enduit: 0xf0e4c8, pierre: 0xb9b1a3, pierreSombre: 0x948c80, pierreClaire: 0xd2cbbd,
  fer: 0xa3acb6, ferSombre: 0x5c636b,
  bleu: 0x3f6fd6, bleuSombre: 0x2c4f9e, or: 0xe9c046,
  rouge: 0xc4402f, rougeSombre: 0x8e2b22, brun: 0x7a4a2a,
  peau: 0xf1c49b, peau2: 0xd9a477, cheveux: 0x5a3a22, pantalon: 0x4a3c30,
  feuille: 0x4f9440, feuilleClaire: 0x6aab4a, sapin: 0x2f6e44, sapinClair: 0x3f8452,
  ble: 0xe8c65a, bleVert: 0xa9c54e, terreLabour: 0x7a5432,
  fenetre: 0xffd27a, braise: 0xff7a2a,
  fleurBlanche: 0xf6f1df, fleurJaune: 0xf2cf4a, fleurRose: 0xe98aa6, fleurBleue: 0x8fb4f0,
};

// Objets temporaires réutilisés (pas d'allocation pendant la construction en boucle)
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Prisme triangulaire (pignon) : base au sol y=0, faîte le long de x. */
function prismGeometry(w, d, h) {
  const a = w / 2, b = d / 2;
  const v = [
    // pignon x-
    -a, 0, b, -a, h, 0, -a, 0, -b,
    // pignon x+
    a, 0, -b, a, h, 0, a, 0, b,
    // pan avant (z+)
    -a, 0, b, a, 0, b, a, h, 0,
    -a, 0, b, a, h, 0, -a, h, 0,
    // pan arrière (z-)
    a, 0, -b, -a, 0, -b, -a, h, 0,
    a, 0, -b, -a, h, 0, a, h, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

/**
 * Constructeur de modèle : empile des primitives colorées puis fusionne tout.
 * Deux « emplacements » : `lit` (éclairé) et `glow` (lumineux, non éclairé : fenêtres, braises).
 */
export class ModelBuilder {
  /** @param {number} [seed] graine des petites variations de couleur */
  constructor(seed = 1) {
    this.slots = { lit: { pos: [], col: [] }, glow: { pos: [], col: [] } };
    this.rng = makeRng(seed);
    this.jitter = 0.035;
  }

  /** Ajoute une géométrie transformée (consommée puis libérée). */
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, slot = 'lit') {
    const g = geo.index ? geo.toNonIndexed() : geo;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    _c.set(color);
    if (this.jitter > 0) {
      // Légère variation de teinte pour un rendu « fait main »
      _c.getHSL(_hsl);
      const j = this.jitter;
      _c.setHSL(_hsl.h + (this.rng() - 0.5) * j * 0.3, _hsl.s, Math.min(1, Math.max(0, _hsl.l + (this.rng() - 0.5) * j)));
    }
    const P = g.attributes.position.array;
    const S = this.slots[slot];
    for (let i = 0; i < P.length; i += 3) {
      S.pos.push(P[i], P[i + 1], P[i + 2]);
      S.col.push(_c.r, _c.g, _c.b);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }

  /** Pavé centré en (x,y,z). */
  box(w, h, d, col, x, y, z, ry = 0, rx = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), col, x, y, z, rx, ry, rz);
  }
  /** Pavé posé au sol (y = bas). */
  boxB(w, h, d, col, x, yb, z, ry = 0) {
    return this.box(w, h, d, col, x, yb + h / 2, z, ry);
  }
  /** Cylindre (ou tronc de cône) centré. */
  cyl(rt, rb, h, seg, col, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1), col, x, y, z, rx, ry, rz);
  }
  /** Cône centré à mi-hauteur. */
  cone(r, h, seg, col, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.ConeGeometry(r, h, seg, 1), col, x, y, z, rx, ry, rz);
  }
  /** Icosaèdre (boule low-poly), déformable. */
  ico(r, col, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
    return this.add(new THREE.IcosahedronGeometry(r, 0), col, x, y, z, 0, ry, 0, sx, sy, sz);
  }
  /** Dodécaèdre (rocher), déformable. */
  dodeca(r, col, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0) {
    return this.add(new THREE.DodecahedronGeometry(r, 0), col, x, y, z, rx, ry, 0, sx, sy, sz);
  }
  /** Pignon triangulaire plein (base à y). */
  prism(w, d, h, col, x, y, z, ry = 0) {
    return this.add(prismGeometry(w, d, h), col, x, y, z, 0, ry, 0);
  }
  /** Toit à deux pans épais : faîte le long de x, largeur d, hauteur h, base à y. */
  roof(w, d, h, col, x, y, z, ry = 0, thick = 0.08, over = 0.12) {
    const a = Math.atan2(h, d / 2);
    const len = Math.hypot(d / 2, h) + over;
    const sa = Math.sin(a), ca = Math.cos(a);
    const cy = y + h / 2 + ca * thick / 2 - sa * over / 2;
    const cz = d / 4 + sa * thick / 2 + ca * over / 2;
    // on incline d'abord le pan (autour de x), puis on tourne le tout (autour de y)
    for (const side of [1, -1]) {
      const g = new THREE.BoxGeometry(w + over * 2, thick, len);
      g.rotateX(a * side);
      g.translate(0, cy, cz * side);
      g.rotateY(ry);
      g.translate(x, 0, z);
      this.add(g, col);
    }
    // faîtage
    const r = new THREE.BoxGeometry(w + over * 2 + 0.02, thick * 1.2, thick * 1.6);
    r.translate(0, y + h + thick * 0.5, 0);
    r.rotateY(ry);
    r.translate(x, 0, z);
    return this.add(r, col);
  }
  /** Poutre (ou cône si r1 = 0) tendue entre deux points. */
  beam(x0, y0, z0, x1, y1, z1, r, col, seg = 6, r1 = r) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    const g = new THREE.CylinderGeometry(r1, r, len, seg, 1);
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_up, _v);
    _p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    return this.add(g, col);
  }
  /** Pavé lumineux (fenêtre, braises). */
  glowBox(w, h, d, col, x, y, z, ry = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), col, x, y, z, 0, ry, 0, 1, 1, 1, 'glow');
  }

  /** Fusionne en géométries finales `{ lit, glow }` (glow peut être null). */
  build() {
    const out = { lit: null, glow: null };
    for (const k of ['lit', 'glow']) {
      const S = this.slots[k];
      if (!S.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(S.col, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out[k] = g;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Matériaux partagés (créés une fois, réutilisés par tous les maillages)
// ---------------------------------------------------------------------------

/** Uniformes partagés par les shaders animés (drapeaux, arbres, eau). */
export const SHARED_UNIFORMS = { uTime: { value: 0 } };

function withFlag(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHARED_UNIFORMS.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Le drapeau ondule d'autant plus qu'on s'éloigne du mât
      float fw = max(position.x, 0.0);
      float ph = modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.4;
      transformed.z += sin(uTime * 5.0 + position.x * 5.5 + ph) * 0.11 * fw;
      transformed.y += sin(uTime * 3.1 + position.x * 4.0 + ph) * 0.035 * fw;`
    );
  };
  material.customProgramCacheKey = () => 'drapeau';
  return material;
}

function withSway(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHARED_UNIFORMS.uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Balancement doux des feuillages selon la hauteur
      float hh = max(position.y - 0.45, 0.0);
      #ifdef USE_INSTANCING
        vec2 wp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
      #else
        vec2 wp = vec2(modelMatrix[3].x, modelMatrix[3].z);
      #endif
      float sw = sin(uTime * 1.3 + wp.x * 0.37 + wp.y * 0.23) + 0.4 * sin(uTime * 2.7 + wp.x * 0.9);
      transformed.x += sw * hh * 0.035;
      transformed.z += cos(uTime * 1.1 + wp.y * 0.31) * hh * 0.025;`
    );
  };
  material.customProgramCacheKey = () => 'balance';
  return material;
}

/** Fabrique (paresseuse) des matériaux partagés. */
let _mats = null;
export function getMaterials() {
  if (_mats) return _mats;
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  _mats = {
    /** Matériau principal à couleurs de sommets. */
    lit,
    /** Bâtiment abîmé : teinte suie (multiplie les couleurs de sommets). */
    damaged: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: new THREE.Color(0.62, 0.54, 0.48) }),
    /** Éclair de coup reçu. */
    flash: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: new THREE.Color(2.2, 1.7, 1.5) }),
    /** Parties lumineuses non éclairées. */
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    /** Drapeaux animés. */
    flag: withFlag(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })),
    /** Feuillages animés (instanciés). */
    sway: withSway(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })),
    /** Fantôme de placement valide / invalide. */
    ghostOk: new THREE.MeshLambertMaterial({ color: 0x8dffa0, emissive: 0x1f6a2a, transparent: true, opacity: 0.62, flatShading: true }),
    ghostBad: new THREE.MeshLambertMaterial({ color: 0xff6a5a, emissive: 0x6a1a12, transparent: true, opacity: 0.62, flatShading: true }),
  };
  return _mats;
}

// ---------------------------------------------------------------------------
// Bâtiments : un modèle par type, silhouettes bien distinctes
// ---------------------------------------------------------------------------

const C = PALETTE;

/** Socle de terre sous un bâtiment : cache les petits écarts du terrain. */
function plinth(b, w, d, col = C.terre) {
  b.box(w, 0.3, d, col, 0, -0.13, 0);
}

function windowGlow(b, x, y, z, ry = 0, w = 0.16, h = 0.2) {
  b.box(w + 0.07, h + 0.07, 0.04, C.boisSombre, x, y, z, ry);
  b.glowBox(w, h, 0.06, C.fenetre, x, y, z, ry);
}

function barrel(b, x, z, s = 1) {
  b.cyl(0.11 * s, 0.11 * s, 0.26 * s, 7, C.bois, x, 0.13 * s, z);
  b.cyl(0.115 * s, 0.115 * s, 0.03 * s, 7, C.ferSombre, x, 0.06 * s, z);
  b.cyl(0.115 * s, 0.115 * s, 0.03 * s, 7, C.ferSombre, x, 0.2 * s, z);
}

function crate(b, x, z, s = 1, ry = 0, yb = 0) {
  b.boxB(0.24 * s, 0.22 * s, 0.24 * s, C.boisClair, x, yb, z, ry);
  b.boxB(0.26 * s, 0.03 * s, 0.26 * s, C.bois, x, yb + 0.2 * s, z, ry);
}

function logPile(b, x, z, ry = 0, n = 3) {
  // Bûches empilées en pyramide
  const cr = Math.cos(ry), sr = Math.sin(ry);
  let k = 0;
  for (let row = 0; row < n; row++) {
    for (let i = 0; i < n - row; i++) {
      const lx = (i - (n - row - 1) / 2) * 0.2;
      const ly = 0.09 + row * 0.17;
      b.cyl(0.09, 0.09, 0.75, 7, k++ % 2 ? C.bois : C.boisSombre, x + cr * lx, ly, z - sr * lx, Math.PI / 2, ry, 0);
      // extrémités claires (bois coupé)
      b.cyl(0.075, 0.075, 0.02, 7, C.boisClair, x + cr * lx + sr * 0.38, ly, z - sr * lx + cr * 0.38, Math.PI / 2, ry, 0);
    }
  }
}

function fencePost(b, x, z, h = 0.35) {
  b.boxB(0.06, h, 0.06, C.boisSombre, x, 0, z);
}

const BUILDERS = {
  maison_commune(b) {
    plinth(b, 1.9, 1.6, C.pierreSombre);
    // soubassement de pierre
    b.boxB(1.72, 0.28, 1.3, C.pierre, 0, 0, 0);
    // murs en torchis et colombages
    b.boxB(1.6, 0.95, 1.2, C.enduit, 0, 0.28, 0);
    for (const x of [-0.79, -0.27, 0.27, 0.79]) {
      b.boxB(0.08, 0.95, 1.24, C.boisSombre, x, 0.28, 0);
    }
    b.boxB(1.64, 0.07, 1.24, C.boisSombre, 0, 0.7, 0);
    // pignons et grand toit
    b.prism(1.6, 1.2, 0.34, C.enduit, 0, 1.23, 0);
    b.roof(1.6, 1.24, 0.95, C.tuile, 0, 1.23, 0, 0, 0.09, 0.16);
    // tour-lanterne sur le faîte
    b.boxB(0.36, 0.3, 0.36, C.boisSombre, -0.25, 2.12, 0);
    b.cone(0.32, 0.4, 4, C.tuileSombre, -0.25, 2.62, 0, 0, Math.PI / 4);
    // porte et fenêtres
    b.boxB(0.34, 0.55, 0.06, C.boisSombre, 0, 0.28, 0.62);
    b.boxB(0.4, 0.06, 0.08, C.bois, 0, 0.83, 0.63);
    windowGlow(b, -0.52, 0.95, 0.61);
    windowGlow(b, 0.52, 0.95, 0.61);
    windowGlow(b, 0.81, 0.92, 0, Math.PI / 2);
    // cheminée
    b.boxB(0.24, 1.2, 0.24, C.pierreSombre, 0.55, 1.2, -0.3);
    b.boxB(0.3, 0.08, 0.3, C.pierre, 0.55, 2.4, -0.3);
    // mât du drapeau
    b.cyl(0.035, 0.045, 3.1, 6, C.boisSombre, 0.88, 1.55, 0.72);
    b.ico(0.06, C.or, 0.88, 3.12, 0.72);
    // abords : tonneaux, caisses
    barrel(b, -0.7, 0.78);
    barrel(b, -0.5, 0.86, 0.85);
    crate(b, 0.48, 0.82, 0.9, 0.3);
  },

  hutte(b) {
    plinth(b, 1.3, 1.3);
    // anneau de pierres
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.dodeca(0.09, C.pierre, Math.cos(a) * 0.56, 0.04, Math.sin(a) * 0.56);
    }
    b.cyl(0.52, 0.56, 0.62, 9, 0xb48a5a, 0, 0.31, 0);
    // bandes de clayonnage
    b.cyl(0.535, 0.545, 0.05, 9, C.boisSombre, 0, 0.2, 0);
    b.cyl(0.525, 0.53, 0.05, 9, C.boisSombre, 0, 0.45, 0);
    // toit de chaume conique
    b.cone(0.82, 0.95, 9, C.paille, 0, 1.05, 0);
    b.cone(0.3, 0.3, 9, C.pailleSombre, 0, 1.55, 0);
    b.cyl(0.84, 0.8, 0.05, 9, C.pailleSombre, 0, 0.6, 0);
    // porte
    b.boxB(0.26, 0.42, 0.08, C.boisSombre, 0, 0, 0.53);
    windowGlow(b, 0.38, 0.38, 0.39, Math.PI / 4, 0.1, 0.12);
    // petit tas de bois
    b.cyl(0.05, 0.05, 0.4, 6, C.bois, -0.55, 0.05, 0.42, 0, 0.5, Math.PI / 2);
    b.cyl(0.05, 0.05, 0.4, 6, C.boisSombre, -0.55, 0.13, 0.4, 0, 0.6, Math.PI / 2);
  },

  bucheron(b) {
    plinth(b, 1.7, 1.5);
    // cabane en rondins
    b.boxB(0.95, 0.62, 0.8, C.bois, -0.3, 0, -0.25);
    for (let i = 0; i < 4; i++) b.cyl(0.05, 0.05, 0.97, 6, C.boisSombre, -0.3, 0.1 + i * 0.15, 0.16, 0, 0, Math.PI / 2);
    b.prism(0.95, 0.8, 0.28, C.bois, -0.3, 0.62, -0.25);
    b.roof(0.95, 0.84, 0.5, C.toitVert, -0.3, 0.62, -0.25, 0, 0.07, 0.12);
    b.boxB(0.26, 0.42, 0.05, C.boisSombre, -0.3, 0, 0.16);
    windowGlow(b, -0.6, 0.38, 0.16, 0, 0.12, 0.12);
    // grosse pile de bûches
    logPile(b, 0.45, 0.35, Math.PI / 2, 3);
    // billot et hache
    b.cyl(0.14, 0.16, 0.24, 8, C.boisClair, 0.35, 0.12, -0.45);
    b.cyl(0.02, 0.02, 0.38, 5, C.boisSombre, 0.37, 0.36, -0.45, 0, 0, 0.35);
    b.boxB(0.12, 0.08, 0.03, C.fer, 0.31, 0.46, -0.45, 0);
    // copeaux
    b.boxB(0.08, 0.02, 0.05, C.boisClair, 0.15, 0, -0.25, 0.6);
    b.boxB(0.07, 0.02, 0.04, C.boisClair, 0.55, 0, -0.3, 1.2);
  },

  chasseur(b) {
    plinth(b, 1.7, 1.5);
    // grande tente de peaux (silhouette en A jusqu'au sol)
    b.prism(1.15, 1.1, 1.0, 0xc49a6c, 0.15, 0, -0.25);
    b.prism(1.17, 0.5, 0.46, 0xa87b52, 0.15, 0.54, -0.25);
    // perches croisées au sommet
    b.beam(-0.42, 0.75, -0.25, -0.62, 1.3, -0.25, 0.03, C.boisSombre, 4);
    b.beam(-0.42, 0.75, -0.25, -0.25, 1.3, -0.25, 0.03, C.boisSombre, 4);
    b.beam(0.72, 0.75, -0.25, 0.55, 1.3, -0.25, 0.03, C.boisSombre, 4);
    b.beam(0.72, 0.75, -0.25, 0.9, 1.3, -0.25, 0.03, C.boisSombre, 4);
    // entrée sombre sur le pignon avant (côté +x tourné vers l'avant)
    b.prism(0.04, 0.42, 0.55, 0x3a2a1e, 0.74, 0, -0.25);
    // bois de cerf au-dessus de l'entrée
    b.cyl(0.015, 0.025, 0.3, 4, C.enduit, 0.76, 0.68, -0.33, 0.6, 0, 0);
    b.cyl(0.015, 0.025, 0.3, 4, C.enduit, 0.76, 0.68, -0.17, -0.6, 0, 0);
    // feu de camp avec broche
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.dodeca(0.06, C.pierreSombre, 0.45 + Math.cos(a) * 0.16, 0.03, 0.55 + Math.sin(a) * 0.16);
    }
    b.glowBox(0.12, 0.06, 0.12, C.braise, 0.45, 0.04, 0.55, 0.5);
    b.boxB(0.03, 0.4, 0.03, C.boisSombre, 0.25, 0, 0.55);
    b.boxB(0.03, 0.4, 0.03, C.boisSombre, 0.65, 0, 0.55);
    b.cyl(0.012, 0.012, 0.5, 4, C.boisSombre, 0.45, 0.38, 0.55, 0, 0, Math.PI / 2);
    b.ico(0.07, 0x8a4a2a, 0.45, 0.33, 0.55, 1.4, 0.8, 0.8);
    // séchoir à peaux sur le côté
    b.boxB(0.05, 0.8, 0.05, C.bois, -0.78, 0, 0.2);
    b.boxB(0.05, 0.8, 0.05, C.bois, -0.78, 0, 0.78);
    b.cyl(0.025, 0.025, 0.65, 5, C.boisSombre, -0.78, 0.78, 0.49, Math.PI / 2);
    b.box(0.03, 0.4, 0.22, 0xd9b38a, -0.78, 0.55, 0.36);
    b.box(0.03, 0.34, 0.2, 0x8a5a36, -0.78, 0.58, 0.63);
  },

  carriere(b) {
    plinth(b, 1.8, 1.8, 0x8f8576);
    // fosse de pierre taillée
    b.boxB(1.5, 0.06, 1.3, 0x9a9184, 0, 0, 0);
    // blocs taillés empilés
    const blocks = [
      [-0.45, 0, -0.35, 0.4, 0.3, 0.32, 0.1], [-0.05, 0, -0.4, 0.36, 0.28, 0.3, -0.15], [-0.25, 0.3, -0.38, 0.36, 0.26, 0.3, 0.05],
      [0.45, 0, 0.35, 0.34, 0.26, 0.3, 0.3], [0.5, 0.26, 0.38, 0.28, 0.22, 0.26, 0.4], [0.05, 0, 0.5, 0.3, 0.22, 0.28, -0.2],
    ];
    for (const [x, y, z, w, h, d, r] of blocks) b.boxB(w, h, d, C.pierreClaire, x, y + 0.04, z, r);
    // gros rocher entamé
    b.dodeca(0.42, C.roche, 0.45, 0.32, -0.35, 1, 0.85, 1, 0.4);
    b.boxB(0.3, 0.2, 0.05, C.pierreClaire, 0.3, 0.2, -0.1, 0.4);
    // chèvre de levage (trépied) avec un bloc suspendu
    const top = [-0.35, 1.45, 0.25];
    for (const [fx, fz] of [[-0.8, 0.0], [0.05, 0.05], [-0.4, 0.75]]) {
      b.beam(fx, 0, fz, top[0], top[1], top[2], 0.045, C.bois, 5, 0.035);
    }
    b.cyl(0.008, 0.008, 0.7, 3, 0xd8c8a0, top[0], 1.1, top[2]);
    b.boxB(0.26, 0.2, 0.22, C.pierreClaire, top[0], 0.55, top[2], 0.3);
    // brouette
    b.boxB(0.3, 0.12, 0.22, C.bois, 0.6, 0.1, -0.7, 0.4);
    b.cyl(0.08, 0.08, 0.04, 8, C.boisSombre, 0.75, 0.08, -0.62, 0, 0.4, Math.PI / 2);
  },

  tour_guet(b) {
    plinth(b, 1.4, 1.4);
    const H = 2.15;
    // quatre pieds légèrement inclinés
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.beam(sx * 0.54, -0.05, sz * 0.54, sx * 0.4, H, sz * 0.4, 0.07, C.bois, 6, 0.055);
    }
    // croisillons
    for (const [ry, off] of [[0, 0.46], [0, -0.46], [Math.PI / 2, 0.46], [Math.PI / 2, -0.46]]) {
      const ox = ry ? off : 0, oz = ry ? 0 : off;
      b.box(1.12, 0.05, 0.05, C.boisSombre, ox, 0.95, oz, ry, 0, 0.75);
      b.box(1.12, 0.05, 0.05, C.boisSombre, ox, 0.95, oz, ry, 0, -0.75);
    }
    // plateforme et garde-corps de planches
    b.boxB(1.1, 0.1, 1.1, C.boisClair, 0, H, 0);
    for (const [ry, off] of [[0, 0.52], [0, -0.52], [Math.PI / 2, 0.52], [Math.PI / 2, -0.52]]) {
      b.boxB(1.1, 0.32, 0.06, C.bois, ry ? off : 0, H + 0.1, ry ? 0 : off, ry);
    }
    // toit pointu sur poteaux
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.boxB(0.05, 0.62, 0.05, C.boisSombre, sx * 0.48, H + 0.1, sz * 0.48);
    b.cone(0.85, 0.72, 4, C.paille, 0, H + 1.08, 0, 0, Math.PI / 4);
    b.cyl(0.02, 0.02, 0.5, 4, C.boisSombre, 0, H + 1.6, 0);
    // échelle
    b.beam(-0.13, 0, 0.9, -0.13, H + 0.05, 0.6, 0.022, C.boisSombre, 4);
    b.beam(0.13, 0, 0.9, 0.13, H + 0.05, 0.6, 0.022, C.boisSombre, 4);
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.6) / 6.6;
      b.box(0.28, 0.03, 0.03, C.boisSombre, 0, t * H, 0.9 - t * 0.3);
    }
  },

  champ(b) {
    // terre labourée et rangs de blé
    b.boxB(1.86, 0.08, 1.86, C.terreLabour, 0, -0.04, 0);
    for (let i = 0; i < 5; i++) {
      const x = -0.72 + i * 0.36;
      b.boxB(0.2, 0.06, 1.66, 0x664628, x, 0.04, 0);
      // épis : petites tiges dorées le long du rang
      for (let k = 0; k < 6; k++) {
        const z = -0.7 + k * 0.28 + (i % 2) * 0.1;
        b.cone(0.09, 0.34, 4, k % 3 === 0 ? C.bleVert : C.ble, x, 0.25, z, 0, k * 0.7);
      }
    }
    // clôture basse aux coins
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9], [0, 0.92], [0, -0.92]]) fencePost(b, x, z, 0.3);
    b.box(1.8, 0.04, 0.04, C.bois, 0, 0.22, 0.92);
    b.box(1.8, 0.04, 0.04, C.bois, 0, 0.22, -0.92);
    // épouvantail
    b.boxB(0.05, 0.85, 0.05, C.boisSombre, 0.55, 0, 0.55);
    b.box(0.6, 0.05, 0.05, C.boisSombre, 0.55, 0.65, 0.55);
    b.boxB(0.2, 0.28, 0.12, 0x6d5bb5, 0.55, 0.45, 0.55);
    b.ico(0.1, C.paille, 0.55, 0.88, 0.55);
    b.cone(0.17, 0.12, 7, C.pailleSombre, 0.55, 0.98, 0.55);
  },

  entrepot(b) {
    plinth(b, 1.95, 1.6, C.pierreSombre);
    b.boxB(1.75, 0.18, 1.3, C.pierre, 0, 0, 0);
    // grange en planches rouge-brun
    b.boxB(1.65, 0.85, 1.2, 0x9a5236, 0, 0.18, 0);
    for (const x of [-0.8, 0.8]) b.boxB(0.08, 0.85, 1.24, C.boisSombre, x, 0.18, 0);
    b.prism(1.2, 1.65, 0.3, 0x9a5236, 0, 1.03, 0, Math.PI / 2);
    b.roof(1.2, 1.7, 0.75, C.ardoise, 0, 1.03, 0, Math.PI / 2, 0.08, 0.14);
    // grandes portes doubles sur le pignon (face +x tournée vers l'avant après rotation)
    b.boxB(0.06, 0.62, 0.55, C.boisClair, 0.83, 0.18, 0);
    b.box(0.07, 0.05, 0.7, C.boisSombre, 0.84, 0.5, 0, 0, 0.72);
    b.box(0.07, 0.05, 0.7, C.boisSombre, 0.84, 0.5, 0, 0, -0.72);
    b.boxB(0.04, 0.24, 0.24, C.boisSombre, 0.83, 0.98, 0);
    // abords : caisses, tonneaux, sacs
    crate(b, 0.2, 0.78, 1, 0.2);
    crate(b, -0.1, 0.8, 0.85, -0.3);
    crate(b, 0.05, 0.78, 0.75, 0.6, 0.2);
    barrel(b, -0.55, 0.78);
    barrel(b, -0.75, 0.62, 0.9);
    b.ico(0.12, 0xd8c69a, 0.55, 0.1, 0.78, 1, 0.75, 1);
    b.ico(0.11, 0xcdb88a, 0.7, 0.1, 0.68, 1, 0.75, 1);
  },

  caserne(b) {
    plinth(b, 1.95, 1.6, C.pierreSombre);
    // longue bâtisse : rez de pierre, étage en colombage
    b.boxB(1.7, 0.55, 1.05, C.pierre, 0, 0, -0.15);
    b.boxB(1.66, 0.42, 1.0, C.enduit, 0, 0.55, -0.15);
    for (const x of [-0.82, -0.41, 0, 0.41, 0.82]) b.boxB(0.07, 0.42, 1.03, C.boisSombre, x, 0.55, -0.15);
    b.prism(1.66, 1.0, 0.2, C.enduit, 0, 0.97, -0.15);
    b.roof(1.66, 1.04, 0.62, C.tuileSombre, 0, 0.97, -0.15, 0, 0.08, 0.14);
    b.boxB(0.36, 0.48, 0.06, C.boisSombre, -0.3, 0, 0.39);
    windowGlow(b, 0.35, 0.3, 0.38, 0, 0.14, 0.14);
    windowGlow(b, 0.35, 0.76, 0.36, 0, 0.14, 0.14);
    windowGlow(b, -0.6, 0.76, 0.36, 0, 0.14, 0.14);
    // boucliers bleus accrochés
    for (const x of [-0.65, 0.05, 0.65]) {
      b.cyl(0.11, 0.11, 0.03, 8, C.bleu, x, 0.4, 0.4, Math.PI / 2);
      b.cyl(0.04, 0.04, 0.04, 6, C.or, x, 0.4, 0.42, Math.PI / 2);
    }
    // râtelier de lances
    b.box(0.6, 0.05, 0.05, C.boisSombre, 0.45, 0.35, 0.68);
    for (let i = 0; i < 4; i++) {
      b.cyl(0.015, 0.015, 0.95, 4, C.bois, 0.25 + i * 0.13, 0.47, 0.72, -0.12);
      b.cone(0.03, 0.09, 4, C.fer, 0.25 + i * 0.13, 0.97, 0.66, -0.12);
    }
    // mannequin d'entraînement
    b.boxB(0.05, 0.7, 0.05, C.boisSombre, -0.7, 0, 0.62);
    b.box(0.4, 0.05, 0.05, C.boisSombre, -0.7, 0.55, 0.62);
    b.boxB(0.2, 0.3, 0.14, C.paille, -0.7, 0.32, 0.62);
    b.ico(0.08, C.paille, -0.7, 0.72, 0.62);
    // grand mât de bannière
    b.cyl(0.035, 0.045, 2.6, 6, C.boisSombre, 0.88, 1.3, 0.55);
    b.ico(0.055, C.or, 0.88, 2.62, 0.55);
  },

  mur_pierre(b) {
    // segment de mur occupant toute la largeur de la tuile (se raccorde aux voisins)
    b.boxB(2.04, 0.18, 0.78, C.pierreSombre, 0, -0.1, 0);
    const rows = [[0.0, 0.32], [0.32, 0.3], [0.62, 0.3]];
    let k = 0;
    for (const [y, h] of rows) {
      let x = -1.0 + (k % 2) * 0.2;
      while (x < 1.0) {
        const w = Math.min(0.42 + ((k * 37) % 5) * 0.03, 1.0 - x);
        b.boxB(w - 0.02, h - 0.02, 0.62, k % 3 === 0 ? C.pierreClaire : k % 3 === 1 ? C.pierre : 0xa89f92, x + w / 2, y, 0);
        x += w;
        k++;
      }
    }
    // chemin de ronde et créneaux
    b.boxB(2.04, 0.08, 0.7, C.pierreSombre, 0, 0.92, 0);
    for (let i = 0; i < 4; i++) b.boxB(0.3, 0.28, 0.66, C.pierre, -0.75 + i * 0.5, 1.0, 0);
  },

  atelier(b) {
    plinth(b, 1.8, 1.6);
    // appentis ouvert sur poteaux
    for (const [x, z] of [[-0.75, -0.6], [0.75, -0.6], [0.75, 0.45], [-0.75, 0.45]]) b.boxB(0.08, 0.95, 0.08, C.boisSombre, x, 0, z);
    b.boxB(1.55, 0.5, 0.06, C.bois, 0, 0, -0.62);
    b.prism(1.55, 1.15, 0.2, C.bois, 0, 0.95, -0.08);
    b.roof(1.55, 1.2, 0.55, 0x7a4a33, 0, 0.95, -0.08, 0, 0.08, 0.14);
    // forge de pierre et braises
    b.boxB(0.6, 0.45, 0.5, C.pierreSombre, -0.45, 0, -0.3);
    b.glowBox(0.42, 0.06, 0.32, C.braise, -0.45, 0.46, -0.3);
    b.boxB(0.28, 1.65, 0.28, C.pierreSombre, -0.55, 0.45, -0.45);
    b.boxB(0.34, 0.08, 0.34, C.pierre, -0.55, 2.1, -0.45);
    // enclume
    b.boxB(0.12, 0.25, 0.12, C.boisSombre, 0.25, 0, 0.05);
    b.boxB(0.3, 0.1, 0.13, C.ferSombre, 0.25, 0.25, 0.05);
    b.cone(0.06, 0.12, 4, C.ferSombre, 0.42, 0.3, 0.05, 0, 0, -Math.PI / 2);
    // meule
    b.cyl(0.2, 0.2, 0.08, 10, C.pierreClaire, 0.55, 0.32, -0.25, 0, 0, Math.PI / 2);
    b.boxB(0.05, 0.3, 0.05, C.bois, 0.55, 0, -0.18);
    b.boxB(0.05, 0.3, 0.05, C.bois, 0.55, 0, -0.32);
    // armes exposées
    b.cyl(0.016, 0.016, 0.9, 4, C.bois, 0.7, 0.45, 0.62, 0.15);
    b.cone(0.035, 0.1, 4, C.fer, 0.7, 0.92, 0.55, 0.15);
    b.cyl(0.14, 0.14, 0.03, 8, C.bleu, 0.35, 0.22, 0.66, 1.3);
  },

  tour_pierre(b) {
    plinth(b, 1.6, 1.6, C.pierreSombre);
    // fût rond en pierre, légèrement évasé à la base
    b.cyl(0.66, 0.74, 0.4, 10, C.pierreSombre, 0, 0.2, 0);
    b.cyl(0.6, 0.66, 2.6, 10, C.pierre, 0, 1.7, 0);
    // bandeaux de pierre
    b.cyl(0.63, 0.63, 0.07, 10, C.pierreClaire, 0, 1.2, 0);
    // meurtrières
    for (const a of [0.3, 2.4, 4.4]) {
      b.box(0.08, 0.32, 0.06, 0x2a2622, Math.sin(a) * 0.61, 1.65, Math.cos(a) * 0.61, a);
    }
    b.boxB(0.28, 0.45, 0.06, C.boisSombre, 0, 0.12, 0.69);
    // couronne en encorbellement et créneaux
    b.cyl(0.78, 0.62, 0.22, 10, C.pierreSombre, 0, 3.1, 0);
    b.cyl(0.78, 0.78, 0.12, 10, C.pierre, 0, 3.27, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      b.boxB(0.26, 0.3, 0.2, C.pierreClaire, Math.sin(a) * 0.68, 3.32, Math.cos(a) * 0.68, a);
    }
    // mât de fanion (à l'arrière, l'archer se tient devant)
    b.cyl(0.025, 0.03, 1.0, 5, C.boisSombre, -0.36, 3.8, -0.36);
  },

  palissade(b) {
    // rangée de pieux appointés sur toute la largeur de la tuile
    b.boxB(2.0, 0.08, 0.36, C.terreSombre, 0, -0.06, 0);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = -0.86 + (i / (n - 1)) * 1.72;
      const h = 0.85 + ((i * 53) % 7) * 0.035;
      const lx = ((i * 31) % 5 - 2) * 0.025, lz = ((i * 17) % 3 - 1) * 0.03;
      b.beam(x, -0.05, 0, x + lx, h, lz, 0.12, i % 2 ? C.bois : 0x8a5d36, 6, 0.11);
      const k = 0.24 / h;
      b.beam(x + lx, h, lz, x + lx * (1 + k), h + 0.24, lz * (1 + k), 0.11, C.boisClair, 6, 0.0);
    }
    // traverses liées
    b.box(1.95, 0.06, 0.07, C.boisSombre, 0, 0.3, 0.12);
    b.box(1.95, 0.06, 0.07, C.boisSombre, 0, 0.62, 0.12);
    // étais à l'arrière
    b.box(0.06, 0.65, 0.06, C.boisSombre, -0.6, 0.3, -0.22, 0, 0.55);
    b.box(0.06, 0.65, 0.06, C.boisSombre, 0.6, 0.3, -0.22, 0, 0.55);
  },

  piege(b) {
    // fosse sombre encadrée de rondins, à moitié couverte de branchages
    b.boxB(1.35, 0.05, 1.35, 0x2b211a, 0, -0.02, 0);
    for (const [ry, off] of [[0, 0.68], [0, -0.68], [Math.PI / 2, 0.68], [Math.PI / 2, -0.68]]) {
      b.cyl(0.07, 0.07, 1.46, 6, C.boisSombre, ry ? off : 0, 0.05, ry ? 0 : off, 0, ry, Math.PI / 2);
    }
    b.box(0.5, 0.03, 0.12, 0x6d8a3c, -0.35, 0.05, 0.3, 0.4);
    b.box(0.45, 0.03, 0.1, 0x5f7a35, 0.32, 0.05, -0.38, -0.6);
    b.box(0.4, 0.03, 0.1, 0x7a6a3c, 0.3, 0.05, 0.36, 1.1);
  },
};

/** Forme des pieux du piège (maillage séparé, animé quand le piège se déclenche). */
function buildSpikes(b) {
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) {
      const x = -0.42 + i * 0.28 + ((k * 7) % 3 - 1) * 0.03;
      const z = -0.42 + k * 0.28 + ((i * 5) % 3 - 1) * 0.03;
      b.cyl(0.03, 0.05, 0.3, 5, C.boisClair, x, 0.15, z);
      b.cone(0.03, 0.22, 5, 0xe8dcc0, x, 0.41, z);
    }
  }
}

/** Positions locales utiles par type : sommet du drapeau, cheminées, hauteur de tir. */
export const BUILDING_INFO = {
  maison_commune: { flag: [0.88, 3.0, 0.72], flagSize: 1, chimneys: [[0.55, 2.5, -0.3]], top: 2.6, wood: false },
  hutte: { chimneys: [[0, 1.75, 0]], top: 1.6, wood: true },
  bucheron: { chimneys: [], top: 1.2, wood: true },
  chasseur: { chimneys: [[0.45, 0.2, 0.55]], top: 1.2, wood: true },
  carriere: { chimneys: [], top: 1.4, wood: false },
  tour_guet: { flag: null, chimneys: [], top: 2.6, shoot: 2.7, archer: [0, 2.25, 0], wood: true },
  champ: { chimneys: [], top: 0.6, wood: true },
  entrepot: { chimneys: [], top: 1.8, wood: true },
  caserne: { flag: [0.88, 2.5, 0.55], flagSize: 0.85, chimneys: [], top: 1.6, wood: false },
  mur_pierre: { chimneys: [], top: 1.2, wood: false },
  atelier: { chimneys: [[-0.55, 2.2, -0.45]], top: 1.6, wood: true, forge: [-0.45, 0.55, -0.3] },
  tour_pierre: { flag: [-0.36, 4.25, -0.36], flagSize: 0.6, chimneys: [], top: 3.5, shoot: 3.75, archer: [0.12, 3.33, 0.15], wood: false },
  palissade: { chimneys: [], top: 1.0, wood: true },
  piege: { chimneys: [], top: 0.3, wood: true },
};

const _geoCache = new Map();

/**
 * Géométries fusionnées d'un type de bâtiment (mises en cache).
 * @param {string} type identifiant du bâtiment (ex. 'hutte')
 * @returns {{lit: THREE.BufferGeometry, glow: THREE.BufferGeometry|null, spikes?: THREE.BufferGeometry}}
 */
export function getBuildingGeometry(type) {
  let g = _geoCache.get(type);
  if (g) return g;
  const fn = BUILDERS[type] || BUILDERS.hutte;
  const b = new ModelBuilder(hashStr(type));
  fn(b);
  g = b.build();
  if (type === 'piege') {
    const s = new ModelBuilder(7);
    buildSpikes(s);
    g.spikes = s.build().lit;
  }
  _geoCache.set(type, g);
  return g;
}

/** Géométrie de drapeau subdivisée (couleurs de sommets : bleu royal à liseré doré). */
let _flagGeo = null;
export function getFlagGeometry() {
  if (_flagGeo) return _flagGeo;
  const g = new THREE.PlaneGeometry(0.9, 0.56, 8, 2).toNonIndexed();
  g.translate(0.45, -0.28, 0);
  const P = g.attributes.position.array;
  const col = new Float32Array(P.length);
  const blue = new THREE.Color(C.bleu), gold = new THREE.Color(C.or);
  for (let i = 0; i < P.length; i += 9) {
    // couleur par triangle : bande dorée au centre
    const cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3;
    const c = cy > -0.34 && cy < -0.22 ? gold : blue;
    for (let k = 0; k < 9; k += 3) { col[i + k] = c.r; col[i + k + 1] = c.g; col[i + k + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  _flagGeo = g;
  return g;
}

/**
 * Crée l'objet 3D d'un bâtiment.
 * @param {string} type identifiant du bâtiment
 * @returns {THREE.Group} groupe avec userData { lit, glow, flag, spikes, info }
 */
export function createBuildingModel(type) {
  const mats = getMaterials();
  const geo = getBuildingGeometry(type);
  const group = new THREE.Group();
  const lit = new THREE.Mesh(geo.lit, mats.lit);
  lit.castShadow = true;
  lit.receiveShadow = true;
  group.add(lit);
  let glow = null;
  if (geo.glow) {
    glow = new THREE.Mesh(geo.glow, mats.glow);
    group.add(glow);
  }
  const info = BUILDING_INFO[type] || BUILDING_INFO.hutte;
  let flag = null;
  if (info.flag) {
    flag = new THREE.Mesh(getFlagGeometry(), mats.flag);
    flag.position.set(info.flag[0], info.flag[1], info.flag[2]);
    flag.scale.setScalar(info.flagSize || 1);
    flag.castShadow = true;
    group.add(flag);
  }
  let spikes = null;
  if (geo.spikes) {
    spikes = new THREE.Mesh(geo.spikes, mats.lit);
    spikes.position.y = -0.3;
    spikes.castShadow = true;
    group.add(spikes);
  }
  group.userData = { lit, glow, flag, spikes, info, type };
  return group;
}

// ---------------------------------------------------------------------------
// Ruines (bâtiment détruit)
// ---------------------------------------------------------------------------

const _ruinCache = new Map();

/**
 * Géométrie de ruine pour un type (bois calciné ou pierres écroulées).
 * @param {string} type
 * @returns {THREE.BufferGeometry}
 */
export function getRuinGeometry(type) {
  let g = _ruinCache.get(type);
  if (g) return g;
  const info = BUILDING_INFO[type] || BUILDING_INFO.hutte;
  const b = new ModelBuilder(hashStr(type) + 99);
  const r = makeRng(hashStr(type) * 7 + 3);
  const linear = type === 'mur_pierre' || type === 'palissade';
  if (type === 'piege') {
    b.boxB(1.35, 0.04, 1.35, 0x2b211a, 0, -0.02, 0);
    b.cyl(0.07, 0.07, 1.2, 6, C.boisBrule, 0.1, 0.05, 0.6, 0, 0.3, Math.PI / 2);
    b.cyl(0.07, 0.07, 0.9, 6, C.boisBrule, -0.6, 0.05, 0, 0, 1.5, Math.PI / 2);
  } else if (linear) {
    b.boxB(2.0, 0.06, 0.6, 0x3b332c, 0, -0.03, 0);
    for (let i = 0; i < 6; i++) {
      const x = -0.85 + i * 0.34;
      if (info.wood) {
        const h = 0.15 + r() * 0.35;
        b.cyl(0.1, 0.12, h, 6, C.boisBrule, x, h / 2, (r() - 0.5) * 0.2, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6);
      } else {
        const h = 0.15 + r() * 0.45;
        b.boxB(0.3, h, 0.55, r() < 0.5 ? C.pierre : C.pierreSombre, x, 0, 0, (r() - 0.5) * 0.3);
        b.dodeca(0.12 + r() * 0.08, C.pierre, x + 0.1, 0.06, 0.45 * (r() < 0.5 ? 1 : -1));
      }
    }
  } else {
    // sol noirci
    b.boxB(1.6, 0.06, 1.4, 0x4a4036, 0, -0.04, 0);
    b.boxB(1.2, 0.05, 1.0, 0x3a322b, 0.05, -0.01, 0.05, 0.3);
    if (!info.wood) {
      // pans de mur encore debout
      b.boxB(0.9, 0.55 + r() * 0.3, 0.16, C.pierre, -0.25, 0, -0.55, 0.05);
      b.boxB(0.16, 0.4 + r() * 0.3, 0.7, C.pierreSombre, 0.62, 0, -0.1, 0.1);
      b.boxB(0.4, 0.3, 0.16, C.pierre, 0.35, 0, 0.55, -0.1);
    } else {
      // poteaux calcinés debout
      b.boxB(0.1, 0.7 + r() * 0.3, 0.1, C.boisBrule, -0.55, 0, -0.45);
      b.boxB(0.1, 0.45 + r() * 0.3, 0.1, C.boisBrule, 0.5, 0, -0.4);
      b.boxB(0.1, 0.35, 0.1, C.boisBrule, 0.45, 0, 0.45);
    }
    // poutres effondrées
    for (let i = 0; i < 4; i++) {
      b.box(0.9 + r() * 0.4, 0.09, 0.09, i % 2 ? C.boisBrule : 0x4a3426, (r() - 0.5) * 0.7, 0.12 + i * 0.05, (r() - 0.5) * 0.7, r() * 3, 0, (r() - 0.5) * 0.5);
    }
    // gravats
    for (let i = 0; i < 9; i++) {
      const col = info.wood ? (i % 3 ? 0x5a4a3c : C.pierreSombre) : (i % 2 ? C.pierre : C.pierreSombre);
      b.dodeca(0.08 + r() * 0.1, col, (r() - 0.5) * 1.3, 0.05, (r() - 0.5) * 1.1, 1, 0.7, 1, r() * 3);
    }
    // braises qui rougeoient encore
    b.glowBox(0.12, 0.03, 0.1, C.braise, 0.1, 0.03, 0.2, 0.4);
    b.glowBox(0.08, 0.03, 0.12, 0xff9a3a, -0.3, 0.03, -0.1, 1.1);
  }
  g = b.build();
  _ruinCache.set(type, g);
  return g;
}

// ---------------------------------------------------------------------------
// Unités : corps + bras droit (pivot à l'épaule) pour l'animation d'attaque
// ---------------------------------------------------------------------------

/** Clés des archétypes d'unités (un InstancedMesh par clé et par partie). */
export const UNIT_KEYS = [
  'ally_f0', 'ally_f1', 'ally_f2', 'ally_f3', 'ally_archer',
  'en_pillard', 'en_soudard', 'en_archer', 'en_chef', 'en_belier',
  'vil_0', 'vil_1', 'vil_2',
];

/**
 * Clé d'archétype pour une unité de combat.
 * @param {boolean} enemy vrai pour un ennemi
 * @param {string} type 'fantassin'|'archer' ou type d'ennemi
 * @param {number} [equip] niveau d'équipement 0..3 (fantassins)
 * @returns {string}
 */
export function unitKeyFor(enemy, type, equip = 0) {
  if (enemy) {
    switch (type) {
      case 'soudard': return 'en_soudard';
      case 'archer_ennemi': case 'archer': return 'en_archer';
      case 'chef_de_guerre': case 'chef': return 'en_chef';
      case 'belier': return 'en_belier';
      default: return 'en_pillard';
    }
  }
  if (type === 'archer') return 'ally_archer';
  return ALLY_KEYS[Math.max(0, Math.min(3, equip | 0))];
}
const ALLY_KEYS = ['ally_f0', 'ally_f1', 'ally_f2', 'ally_f3'];

const SHOULDER = [0.17, 0.47, 0];

/** Silhouette humaine commune (sans le bras droit). */
function humanBody(b, o) {
  const tunic = o.tunic, legs = o.legs || C.pantalon;
  // jambes et bottes
  b.boxB(0.09, 0.2, 0.1, legs, -0.065, 0.02, 0);
  b.boxB(0.09, 0.2, 0.1, legs, 0.065, 0.02, 0);
  b.boxB(0.1, 0.05, 0.13, 0x3a2a1e, -0.065, 0, 0.015);
  b.boxB(0.1, 0.05, 0.13, 0x3a2a1e, 0.065, 0, 0.015);
  // tunique (légèrement évasée) et ceinture
  b.cyl(0.13, 0.16, 0.3, 6, tunic, 0, 0.36, 0, 0, Math.PI / 6);
  b.cyl(0.145, 0.145, 0.04, 6, o.belt || 0x4a3020, 0, 0.27, 0, 0, Math.PI / 6);
  if (o.armor) b.cyl(0.14, 0.155, 0.16, 6, o.armor, 0, 0.42, 0, 0, Math.PI / 6);
  // bras gauche
  b.box(0.07, 0.22, 0.08, o.sleeve || tunic, -0.17, 0.38, 0, 0, 0, -0.12);
  b.box(0.06, 0.06, 0.06, C.peau, -0.19, 0.26, 0.01);
  // tête
  b.ico(0.105, o.skin || C.peau, 0, 0.6, 0, 1, 1.05, 1);
  // coiffe
  switch (o.head) {
    case 'cheveux': b.ico(0.1, o.hair || C.cheveux, 0, 0.64, -0.02, 1.05, 0.75, 1.05); break;
    case 'capuche': b.cone(0.13, 0.2, 6, o.hood, 0, 0.7, -0.01); b.box(0.2, 0.08, 0.08, o.hood, 0, 0.55, -0.07); break;
    case 'bonnet': b.cyl(0.08, 0.11, 0.09, 6, o.hat, 0, 0.67, 0); break;
    case 'casque': b.ico(0.115, C.fer, 0, 0.64, 0, 1.03, 0.82, 1.03); b.box(0.025, 0.09, 0.03, C.fer, 0, 0.58, 0.1); break;
    case 'chapeau': b.cyl(0.17, 0.17, 0.025, 8, C.paille, 0, 0.66, 0); b.cone(0.09, 0.12, 8, C.paille, 0, 0.73, 0); break;
    case 'chef':
      b.ico(0.12, C.ferSombre, 0, 0.64, 0, 1.05, 0.85, 1.05);
      b.box(0.03, 0.1, 0.03, C.ferSombre, 0, 0.58, 0.11);
      b.box(0.04, 0.2, 0.22, C.rouge, 0, 0.8, -0.04);
      b.cone(0.03, 0.12, 4, C.enduit, -0.12, 0.72, 0, 0, 0, 0.9);
      b.cone(0.03, 0.12, 4, C.enduit, 0.12, 0.72, 0, 0, 0, -0.9);
      break;
    default: break;
  }
  if (o.cape) b.box(0.24, 0.36, 0.03, o.cape, 0, 0.36, -0.12, 0, 0.12);
  if (o.quiver) {
    b.cyl(0.04, 0.04, 0.24, 5, C.brun, 0.06, 0.42, -0.11, 0.3, 0, -0.4);
    b.cone(0.03, 0.06, 4, C.enduit, 0.11, 0.56, -0.15, 0.3, 0, -0.4);
  }
  if (o.shield) {
    // bouclier rond sur le bras gauche
    b.cyl(0.15, 0.15, 0.035, 8, o.shield, -0.24, 0.38, 0.05, 0, 0, Math.PI / 2);
    b.cyl(0.05, 0.05, 0.045, 6, o.boss || C.or, -0.255, 0.38, 0.05, 0, 0, Math.PI / 2);
  }
  if (o.bow) {
    // arc tenu à gauche, devant
    b.box(0.025, 0.5, 0.025, C.boisSombre, -0.2, 0.42, 0.14, 0, 0, 0);
    b.box(0.025, 0.14, 0.025, C.boisSombre, -0.2, 0.67, 0.1, -0.5);
    b.box(0.025, 0.14, 0.025, C.boisSombre, -0.2, 0.17, 0.1, 0.5);
    b.box(0.006, 0.6, 0.006, C.enduit, -0.2, 0.42, 0.06);
  }
}

/** Bras droit + arme, autour du pivot d'épaule (origine). Bras vers le bas (-y). */
function rightArm(b, o) {
  b.box(0.07, 0.22, 0.08, o.sleeve || o.tunic, 0, -0.1, 0);
  b.box(0.065, 0.065, 0.065, C.peau, 0, -0.22, 0.01);
  switch (o.weapon) {
    case 'gourdin':
      b.cyl(0.05, 0.025, 0.4, 5, C.bois, 0, -0.18, 0.17, Math.PI / 2 - 0.35);
      b.ico(0.075, C.boisSombre, 0, -0.11, 0.35, 1, 1, 1.25);
      break;
    case 'lance': {
      // lance tenue en biais, pointe vers l'avant et le haut (le talon touche presque le sol)
      const phi = 0.95, dy = Math.cos(phi), dz = Math.sin(phi);
      b.cyl(0.016, 0.016, 0.95, 4, C.bois, 0, -0.22, 0.1, phi);
      b.cone(0.032, 0.13, 4, C.fer, 0, -0.22 + dy * 0.54, 0.1 + dz * 0.54, phi);
      break;
    }
    case 'epee':
      b.box(0.1, 0.02, 0.03, C.ferSombre, 0, -0.22, 0.06);
      b.box(0.035, 0.02, 0.36, C.fer, 0, -0.2, 0.25, -0.1);
      break;
    case 'hache':
      b.cyl(0.02, 0.02, 0.42, 5, C.boisSombre, 0, -0.2, 0.15, Math.PI / 2 - 0.3);
      b.box(0.03, 0.12, 0.1, C.fer, 0, -0.1, 0.33);
      break;
    case 'grandehache':
      b.cyl(0.025, 0.025, 0.7, 5, C.boisSombre, 0, -0.18, 0.22, Math.PI / 2 - 0.35);
      b.box(0.035, 0.22, 0.14, C.fer, 0, -0.04, 0.5);
      b.box(0.035, 0.1, 0.06, C.ferSombre, 0, -0.04, 0.42);
      break;
    case 'fleche':
      b.cyl(0.008, 0.008, 0.3, 3, C.boisClair, 0, -0.22, 0.1, Math.PI / 2);
      break;
    case 'outil':
      b.cyl(0.018, 0.018, 0.34, 4, C.bois, 0, -0.2, 0.1, Math.PI / 2 - 0.4);
      b.box(0.03, 0.06, 0.08, C.fer, 0, -0.12, 0.25);
      break;
    default: break; // poings nus
  }
}

const UNIT_STYLES = {
  ally_f0: { tunic: C.bleu, head: 'cheveux', weapon: null },
  ally_f1: { tunic: C.bleu, head: 'cheveux', hair: 0x8a5a2a, weapon: 'gourdin' },
  ally_f2: { tunic: C.bleu, head: 'bonnet', hat: 0x7a5236, weapon: 'lance', belt: 0x3a2a1e },
  ally_f3: { tunic: C.bleu, head: 'casque', weapon: 'lance', shield: C.bleu, boss: C.or, armor: 0x8a6a4a },
  ally_archer: { tunic: 0x4f80d8, head: 'capuche', hood: 0x5a7a3a, weapon: 'fleche', bow: true, quiver: true },
  en_pillard: { tunic: 0xa8432f, sleeve: 0x7a4a2a, head: 'capuche', hood: 0x6b4a2f, weapon: 'hache', legs: 0x3e3226 },
  en_soudard: { tunic: C.rouge, head: 'casque', weapon: 'epee', shield: C.rougeSombre, boss: C.ferSombre, armor: 0x6a6f78 },
  en_archer: { tunic: 0x9a3a2c, head: 'capuche', hood: C.rougeSombre, weapon: 'fleche', bow: true, quiver: true },
  en_chef: { tunic: 0x4a4f57, sleeve: 0x3a3e45, head: 'chef', weapon: 'grandehache', cape: C.rougeSombre, armor: 0x5c636b, belt: C.rouge },
  vil_0: { tunic: 0x6d8f4a, head: 'chapeau', weapon: 'outil' },
  vil_1: { tunic: 0xc49a4a, head: 'cheveux', hair: 0x3a2618, weapon: null, skin: C.peau2 },
  vil_2: { tunic: 0xa86a3f, head: 'bonnet', hat: 0xe0d2b0, weapon: null },
};

/** Bélier : chariot couvert à roues, le tronc est la « partie bras » (il cogne). */
function buildRam(body, arm) {
  // châssis et roues
  body.boxB(0.62, 0.08, 1.3, C.boisSombre, 0, 0.18, 0);
  for (const [x, z] of [[-0.36, -0.42], [0.36, -0.42], [-0.36, 0.42], [0.36, 0.42]]) {
    body.cyl(0.17, 0.17, 0.08, 8, C.bois, x, 0.17, z, 0, 0, Math.PI / 2);
    body.cyl(0.05, 0.05, 0.1, 6, C.ferSombre, x, 0.17, z, 0, 0, Math.PI / 2);
  }
  // montants et toit de peaux
  for (const [x, z] of [[-0.28, -0.55], [0.28, -0.55], [-0.28, 0.5], [0.28, 0.5]]) body.boxB(0.06, 0.55, 0.06, C.boisSombre, x, 0.26, z);
  body.roof(1.3, 0.66, 0.42, 0x7a5a3a, 0, 0.8, 0, Math.PI / 2, 0.06, 0.08);
  body.box(0.02, 0.3, 1.0, 0x6a4a2e, 0.33, 0.62, 0);
  // tronc-bélier à tête de fer (pivot au centre, avance vers +z)
  arm.cyl(0.11, 0.11, 1.35, 7, C.bois, 0, 0, 0.15, Math.PI / 2);
  arm.cyl(0.13, 0.115, 0.22, 7, C.ferSombre, 0, 0, 0.85, Math.PI / 2);
  arm.cyl(0.115, 0.115, 0.04, 7, C.ferSombre, 0, 0, -0.2, Math.PI / 2);
  arm.cyl(0.006, 0.006, 0.3, 3, 0xd8c8a0, 0, 0.15, -0.1);
  arm.cyl(0.006, 0.006, 0.3, 3, 0xd8c8a0, 0, 0.15, 0.4);
}

const _unitCache = new Map();

/**
 * Géométries d'un archétype d'unité.
 * @param {string} key une des UNIT_KEYS
 * @returns {{body: THREE.BufferGeometry, arm: THREE.BufferGeometry, pivot: THREE.Vector3, height: number, scale: number}}
 */
export function getUnitParts(key) {
  let u = _unitCache.get(key);
  if (u) return u;
  const body = new ModelBuilder(hashStr(key));
  const arm = new ModelBuilder(hashStr(key) + 1);
  body.jitter = 0.02;
  arm.jitter = 0.02;
  let pivot, height, scale = 1;
  if (key === 'en_belier') {
    buildRam(body, arm);
    pivot = new THREE.Vector3(0, 0.55, 0);
    height = 1.25;
    scale = 0.75; // le cœur annonce une taille 1.6 pour le bélier
  } else {
    const o = UNIT_STYLES[key] || UNIT_STYLES.ally_f0;
    humanBody(body, o);
    rightArm(arm, o);
    pivot = new THREE.Vector3(SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    height = 0.78;
    scale = 1.12; // un peu plus grands que nature : lisibles sur téléphone
  }
  u = { body: body.build().lit, arm: arm.build().lit, pivot, height, scale };
  _unitCache.set(key, u);
  return u;
}

/** Petits objets portés par les villageois (bûche, pierre, sac). */
export function getCarryGeometries() {
  const log = new ModelBuilder(3);
  log.cyl(0.06, 0.06, 0.42, 6, C.bois, 0, 0, 0, 0, 0, Math.PI / 2);
  log.cyl(0.05, 0.05, 0.01, 6, C.boisClair, 0.21, 0, 0, 0, 0, Math.PI / 2);
  const stone = new ModelBuilder(4);
  stone.box(0.16, 0.12, 0.14, C.pierreClaire, 0, 0, 0, 0.3);
  const sack = new ModelBuilder(5);
  sack.ico(0.1, 0xd8c69a, 0, 0, 0, 1, 0.85, 0.9);
  sack.cyl(0.03, 0.04, 0.05, 5, 0xb8a47a, 0, 0.09, 0);
  return { bois: log.build().lit, pierre: stone.build().lit, nourriture: sack.build().lit };
}

// ---------------------------------------------------------------------------
// Nature : arbres, rochers, petit décor
// ---------------------------------------------------------------------------

/** Géométries d'arbres (sapin, feuillu, bouleau) à instancier. */
export function getTreeGeometries() {
  const pine = new ModelBuilder(11);
  pine.cyl(0.07, 0.1, 0.5, 5, C.boisSombre, 0, 0.25, 0);
  pine.cone(0.62, 0.8, 7, C.sapin, 0, 0.8, 0);
  pine.cone(0.5, 0.7, 7, C.sapinClair, 0, 1.25, 0, 0, 0.3);
  pine.cone(0.34, 0.6, 7, C.sapin, 0, 1.68, 0, 0, 0.6);
  const round = new ModelBuilder(12);
  round.cyl(0.07, 0.11, 0.7, 5, C.bois, 0, 0.35, 0);
  round.ico(0.5, C.feuille, 0, 1.05, 0, 1, 0.9, 1);
  round.ico(0.36, C.feuilleClaire, 0.22, 1.32, 0.1, 1, 0.9, 1);
  round.ico(0.3, C.feuille, -0.25, 0.9, -0.12);
  const birch = new ModelBuilder(13);
  birch.cyl(0.05, 0.07, 1.0, 5, 0xe8e2d4, 0, 0.5, 0);
  birch.box(0.06, 0.04, 0.06, 0x3a3530, 0, 0.42, 0.04);
  birch.ico(0.34, 0x9cc25a, 0, 1.15, 0, 0.9, 1.25, 0.9);
  birch.ico(0.24, 0x86b04a, 0.12, 1.45, 0.04, 1, 1.1, 1);
  return { pine: pine.build().lit, round: round.build().lit, birch: birch.build().lit };
}

/** Géométries de rochers (couleur de base blanche : teinte par instance). */
export function getRockGeometries() {
  const big = new ModelBuilder(21);
  big.jitter = 0;
  big.dodeca(0.55, 0xffffff, 0, 0.3, 0, 1.15, 0.8, 1, 0.3);
  big.dodeca(0.3, 0xe4e4e4, 0.45, 0.15, 0.25, 1, 0.8, 1.1, 1.1);
  const small = new ModelBuilder(22);
  small.jitter = 0;
  small.dodeca(0.28, 0xf2f2f2, 0, 0.14, 0, 1.2, 0.75, 1, 0.8);
  return { big: big.build().lit, small: small.build().lit };
}

/** Petit décor d'herbe : touffes, fleurs, buissons. */
export function getDecorGeometries() {
  const tuft = new ModelBuilder(31);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    tuft.cone(0.04, 0.22, 3, i % 2 ? C.herbeClaire : 0x7aa848, Math.cos(a) * 0.06, 0.1, Math.sin(a) * 0.06, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
  }
  const flowers = new ModelBuilder(32);
  flowers.jitter = 0;
  const fc = [C.fleurBlanche, C.fleurJaune, C.fleurRose, C.fleurBleue];
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4, r = 0.08 + (i % 2) * 0.07;
    flowers.cyl(0.008, 0.008, 0.12, 3, 0x5a8a3a, Math.cos(a) * r, 0.06, Math.sin(a) * r);
    flowers.ico(0.035, fc[i % 4], Math.cos(a) * r, 0.13, Math.sin(a) * r);
  }
  const bush = new ModelBuilder(33);
  bush.ico(0.22, 0x5a9a3e, 0, 0.14, 0, 1.2, 0.8, 1);
  bush.ico(0.16, 0x6aab4a, 0.15, 0.18, 0.06);
  bush.ico(0.05, C.fleurRose, 0.05, 0.3, 0.12);
  const pebbles = new ModelBuilder(34);
  pebbles.dodeca(0.07, 0xb7a58a, 0, 0.02, 0, 1.3, 0.5, 1, 0.3);
  pebbles.dodeca(0.05, 0x9c9184, 0.16, 0.015, 0.09, 1.2, 0.5, 1, 1.2);
  pebbles.dodeca(0.04, 0xc4b394, -0.1, 0.012, 0.14, 1, 0.5, 1.2, 2.1);
  return { tuft: tuft.build().lit, flowers: flowers.build().lit, bush: bush.build().lit, pebbles: pebbles.build().lit };
}

/** Géométrie de flèche orientée vers +z. */
export function getArrowGeometry() {
  const b = new ModelBuilder(41);
  b.jitter = 0;
  b.cyl(0.012, 0.012, 0.55, 3, C.boisClair, 0, 0, 0, Math.PI / 2);
  b.cone(0.03, 0.09, 4, C.ferSombre, 0, 0, 0.31, Math.PI / 2);
  b.box(0.005, 0.06, 0.1, 0xf4f0e6, 0, 0, -0.24);
  b.box(0.06, 0.005, 0.1, 0xf4f0e6, 0, 0, -0.24);
  return b.build().lit;
}

/** Drapeau de ralliement : mât (le tissu utilise getFlagGeometry). */
export function getRallyPoleGeometry() {
  const b = new ModelBuilder(51);
  b.cyl(0.03, 0.04, 1.6, 6, C.boisSombre, 0, 0.8, 0);
  b.ico(0.05, C.or, 0, 1.62, 0);
  b.cyl(0.14, 0.18, 0.08, 7, C.pierreSombre, 0, 0.03, 0);
  return b.build().lit;
}

/** Hache de chaîne simple (FNV-1a) pour dériver des graines. */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
