// Moteur de rendu : renderer three.js, lumières de fin d'après-midi, brume, qualité, boucle.
import * as THREE from 'three';

/** Couleurs d'ambiance (ciel brumeux doré, lumière chaude). */
const AMBIANCE = {
  brume: 0xb8d4da,
  ciel: 0xc4dcf0,
  solHemi: 0x5a4a32,
  soleil: 0xffdcaa,
};

/** Réglages par niveau de qualité. */
const QUALITES = {
  economie: { pixelRatioMax: 1, shadows: false, antialias: false },
  normale: { pixelRatioMax: 2, shadows: true, antialias: true },
};

/**
 * Normalise un nom de qualité ('economie' | 'normale', accents tolérés).
 * @param {string} q
 * @returns {'economie'|'normale'}
 */
export function normalizeQuality(q) {
  const s = String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return s === 'economie' ? 'economie' : 'normale';
}

/**
 * Crée le renderer, la scène, la caméra et les lumières.
 * @param {HTMLCanvasElement} canvas toile de rendu (taille pilotée par CSS)
 * @param {{quality?: 'economie'|'normale'}} [opts]
 * @returns {{
 *   renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement,
 *   sun: THREE.DirectionalLight, quality: string,
 *   setQuality(q: string): {needsReload: boolean},
 *   resize(): void, render(): void,
 *   start(onFrame: (dt: number, time: number) => void): void, stop(): void, isRunning(): boolean,
 *   setFogForDistance(d: number): void, fitShadow(halfSize: number): void, dispose(): void
 * }}
 */
export function createRenderer(canvas, opts = {}) {
  let quality = normalizeQuality(opts.quality);
  const Q = QUALITES[quality];
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: Q.antialias,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = Q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const createdAntialias = Q.antialias;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(AMBIANCE.brume);
  scene.fog = new THREE.Fog(AMBIANCE.brume, 50, 140);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 400);
  camera.position.set(0, 30, 24);
  camera.lookAt(0, 0, 0);

  // Lumière du ciel (bleutée) et du sol (chaude)
  const hemi = new THREE.HemisphereLight(AMBIANCE.ciel, AMBIANCE.solHemi, 1.0);
  scene.add(hemi);
  // Soleil de fin d'après-midi, venant du sud-ouest, ombres douces
  const sun = new THREE.DirectionalLight(AMBIANCE.soleil, 2.7);
  const sunDir = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  /** Cadre la caméra d'ombre sur la carte (demi-taille en unités monde). */
  function fitShadow(halfSize) {
    const c = sun.shadow.camera;
    c.left = -halfSize; c.right = halfSize; c.top = halfSize; c.bottom = -halfSize;
    c.near = 1; c.far = 160;
    c.updateProjectionMatrix();
    sun.target.position.set(0, 0, 0);
    sun.position.copy(sunDir).multiplyScalar(70);
  }
  fitShadow(30);

  /** Applique pixelRatio et ombres selon la qualité. */
  function applyQuality() {
    const q = QUALITES[quality];
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(Math.min(dpr, q.pixelRatioMax));
    if (renderer.shadowMap.enabled !== q.shadows) {
      renderer.shadowMap.enabled = q.shadows;
      sun.castShadow = q.shadows;
      // Les matériaux doivent être recompilés quand on change les ombres
      scene.traverse((o) => {
        if (o.material) {
          const m = Array.isArray(o.material) ? o.material : [o.material];
          for (const mm of m) mm.needsUpdate = true;
        }
      });
    }
    resize();
  }

  /** Ajuste la taille du tampon à la taille CSS de la toile. */
  function resize() {
    const w = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const h = Math.max(1, canvas.clientHeight || canvas.height || 1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** Change la qualité ; l'antialiasing ne change qu'au prochain lancement. */
  function setQuality(q) {
    quality = normalizeQuality(q);
    api.quality = quality;
    applyQuality();
    return { needsReload: QUALITES[quality].antialias !== createdAntialias };
  }

  /** Brume adaptée au zoom : l'île reste nette, l'horizon se fond. */
  function setFogForDistance(d) {
    scene.fog.near = d * 1.1 + 8;
    scene.fog.far = d * 2.2 + 40;
  }

  // Boucle de rendu, mise en pause quand l'onglet est caché (économie de batterie)
  let raf = 0, running = false, last = 0, time = 0, onFrameCb = null;
  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 1 / 60;
    last = now;
    time += dt;
    if (onFrameCb) onFrameCb(dt, time);
    renderer.render(scene, camera);
    if (running && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function onVisibility() {
    if (!running) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  /** Démarre la boucle ; onFrame(dt, temps) est appelé avant chaque image. */
  function start(onFrame) {
    onFrameCb = onFrame || onFrameCb;
    if (running) return;
    running = true;
    last = 0;
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }
  /** Arrête la boucle. */
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
  }
  const onWinResize = () => resize();
  window.addEventListener('resize', onWinResize);

  const api = {
    renderer, scene, camera, canvas, sun, hemi, quality,
    setQuality, resize, fitShadow, setFogForDistance,
    render: () => renderer.render(scene, camera),
    start, stop,
    isRunning: () => running,
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onWinResize);
      if (ro) ro.disconnect();
      renderer.dispose();
    },
  };
  applyQuality();
  return api;
}
