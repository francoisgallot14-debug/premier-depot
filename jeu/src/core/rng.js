// Hasard déterministe (mulberry32) : même graine = même partie.
// Le cœur du jeu n'utilise jamais le hasard natif de JavaScript, sinon les
// tests et les sauvegardes ne seraient plus reproductibles.

/**
 * Transforme n'importe quelle graine (nombre ou texte) en entier 32 bits non signé.
 * @param {number|string} seed
 * @returns {number}
 */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.floor(seed) >>> 0);
  const s = String(seed ?? '');
  // Hachage FNV-1a : rapide et suffisant pour une graine.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mélange plusieurs entiers en une seule graine (ex. graine de partie + numéro de vague).
 * @param {...number} parts
 * @returns {number} entier 32 bits non signé
 */
export function mixSeeds(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= (normalizeSeed(p) + 0x7f4a7c15 + (h << 6) + (h >>> 2)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  }
  return h >>> 0;
}

/**
 * Un pas de mulberry32 sur un état explicite (fonction pure).
 * @param {number} s état courant (entier 32 bits)
 * @returns {{ value: number, state: number }} value dans [0, 1[, nouvel état
 */
export function mulberry32Step(s) {
  const a = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a >>> 0 };
}

/**
 * Crée un générateur aléatoire déterministe.
 * L'état courant est lisible/réglable via `rng.state` (pour la sauvegarde).
 * @param {number|string} seed
 * @returns {{ state: number, next(): number, range(min:number, max:number): number,
 *   int(min:number, max:number): number, chance(p:number): boolean,
 *   pick<T>(arr:T[]): T, weighted<T>(arr:T[], key?:string): T }}
 */
export function createRng(seed) {
  const rng = {
    state: normalizeSeed(seed),
    /** Nombre dans [0, 1[. */
    next() {
      const r = mulberry32Step(rng.state);
      rng.state = r.state;
      return r.value;
    },
    /** Nombre réel dans [min, max[. */
    range(min, max) {
      return min + (max - min) * rng.next();
    },
    /** Entier dans [min, max] (bornes incluses). */
    int(min, max) {
      return min + Math.floor(rng.next() * (max - min + 1));
    },
    /** Vrai avec la probabilité p. */
    chance(p) {
      return rng.next() < p;
    },
    /** Élément au hasard d'un tableau. */
    pick(arr) {
      return arr[Math.floor(rng.next() * arr.length)];
    },
    /** Élément au hasard pondéré par le champ `key` (défaut « poids »). */
    weighted(arr, key = 'poids') {
      let total = 0;
      for (const it of arr) total += it[key] || 0;
      let r = rng.next() * total;
      for (const it of arr) {
        r -= it[key] || 0;
        if (r < 0) return it;
      }
      return arr[arr.length - 1];
    },
  };
  return rng;
}

/**
 * Générateur lié à une partie : lit `state.rngState` et le met à jour à chaque tirage,
 * pour que la sauvegarde reprenne exactement la même suite de hasard.
 * @param {{ rngState: number }} state
 * @returns {ReturnType<typeof createRng>}
 */
export function stateRng(state) {
  const rng = createRng(state.rngState >>> 0);
  const baseNext = rng.next;
  rng.next = () => {
    rng.state = state.rngState >>> 0;
    const v = baseNext();
    state.rngState = rng.state;
    return v;
  };
  return rng;
}
