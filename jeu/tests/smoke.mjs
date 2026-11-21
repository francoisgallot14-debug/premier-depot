// Test de bout en bout : ouvre dist/royaume.html (file://) dans Chromium, en portrait puis en paysage,
// et joue un premier cycle comme un joueur : actions, bûcheron + ouvrier, palissade SUR la route,
// piège, vague 1 en ×2, armée déplacée, piège déclenché, bilan, Continuer, puis rechargement de
// la page et « Continuer » sur l'écran titre. Échoue à la moindre erreur dans la console.
// Lancer : npm run build && npm run smoke      Captures : test-output/smoke/
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..');
const PAGE = join(RACINE, 'dist', 'royaume.html');
const SORTIE = join(RACINE, 'test-output', 'smoke');

// Playwright est installé globalement (pas dans node_modules du projet)
function chargerPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req('playwright'); } catch { /* on essaie le dossier global */ }
  const global = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return createRequire(join(global, 'noop.js'))('playwright');
}

if (!existsSync(PAGE)) {
  console.error('dist/royaume.html est absent : lancer « npm run build » d’abord.');
  process.exit(1);
}
mkdirSync(SORTIE, { recursive: true });
const { chromium } = chargerPlaywright();

const ORIENTATIONS = [
  { nom: 'portrait', viewport: { width: 390, height: 844 } },
  { nom: 'paysage', viewport: { width: 844, height: 390 } },
];

let echecs = 0;
const verifier = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function scenario(browser, o) {
  const context = await browser.newContext({ viewport: o.viewport, deviceScaleFactor: 1, hasTouch: false });
  const page = await context.newPage();
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(`console : ${m.text()}`); });
  page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
  page.on('dialog', async (d) => { erreurs.push(`fenêtre du navigateur interdite (${d.type()}) : ${d.message()}`); await d.dismiss(); });
  // le jeu doit marcher hors ligne : les polices en ligne sont remplacées par rien
  await page.route(/^https?:\/\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));

  const capture = (nom) => page.screenshot({ path: join(SORTIE, `${o.nom}-${nom}.png`) });
  const etat = (fn, arg) => page.evaluate(fn, arg);
  const R = () => window.__royaume;
  /** Touche le centre d'une tuile après avoir centré la caméra dessus (comme un joueur qui fait glisser la vue). */
  async function toucherTuile(x, z) {
    await etat(([tx, tz]) => window.__royaume.focusTile(tx, tz), [x, z]);
    await page.waitForTimeout(120);
    const p = await etat(([tx, tz]) => window.__royaume.tileScreen(tx, tz), [x, z]);
    verifier(p.visible, `tuile (${x}, ${z}) hors de l'écran`);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  async function construire(type, tuile = null) {
    if (!(await page.$('.feuille:not([hidden]) [data-type]'))) await page.click('[data-sheet="construire"]');
    await page.click(`[data-type="${type}"]`);
    verifier((await etat(() => window.__royaume.mode)) === 'placement', `${type} : le mode construction ne s'ouvre pas`);
    if (tuile) await toucherTuile(tuile.x, tuile.z);
    await page.click('[data-cmd="construire-ici"]');
    await page.waitForTimeout(150);
    const b = await etat((t) => window.__royaume.state.buildings.find((x) => x.type === t), type);
    verifier(b, `${type} n'a pas été construit`);
    return b;
  }

  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForFunction(() => window.__royaume && window.__royaume.ready, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  verifier(await page.isVisible('[data-cmd="nouvelle-partie"]'), 'écran titre : pas de bouton « Nouvelle partie »');
  verifier(!(await page.$('[data-cmd="continuer-partie"]')), 'écran titre : « Continuer » sans sauvegarde');
  await capture('1-titre');

  // --- nouvelle partie, actions ---------------------------------------------------------------
  await page.click('[data-cmd="nouvelle-partie"]');
  await page.waitForTimeout(600);
  verifier((await etat(() => window.__royaume.state.phase)) === 'prep', 'la partie ne commence pas en préparation');
  await capture('2-preparation');
  await page.click('[data-sheet="actions"]');
  for (const id of ['couper_bois', 'couper_bois', 'couper_bois', 'tailler_pierre', 'chasser']) {
    await page.click(`[data-id="${id}"]`);
    await page.waitForTimeout(60);
  }
  const apresActions = await etat(() => ({ ...window.__royaume.state.resources, actions: window.__royaume.state.actionsLeft }));
  verifier(apresActions.actions === 0, `actions non dépensées (${apresActions.actions} restantes)`);
  verifier(apresActions.bois === 54 && apresActions.pierre === 15 && apresActions.nourriture === 36, `ressources inattendues après les actions : ${JSON.stringify(apresActions)}`);
  await page.waitForTimeout(500);

  // --- bûcheron + ouvrier ------------------------------------------------------------------
  await page.click('[data-sheet="construire"]');
  await page.waitForTimeout(250);
  await capture('3-construire');
  const buch = await construire('bucheron');
  verifier((await etat(() => window.__royaume.sheet)) === 'batiment', 'le panneau du bûcheron ne s’ouvre pas après construction');
  await page.click('[data-key="plus"]');
  const ouvriers = await etat((id) => window.__royaume.state.buildings.find((b) => b.id === id).workers, buch.id);
  verifier(ouvriers === 1, `ouvrier non placé (${ouvriers})`);
  await capture('4-batiment');
  await page.click('[data-cmd="fermer"]');

  // --- palissade sur la route, piège ----------------------------------------------------------
  const pal = await construire('palissade', { x: 11, z: 12 });
  verifier(pal.x === 11 && pal.z === 12, `palissade posée en (${pal.x}, ${pal.z}) au lieu de (11, 12)`);
  const piege = await construire('piege', { x: 13, z: 11 });
  verifier(piege.x === 13 && piege.z === 11, `piège posé en (${piege.x}, ${piege.z})`);
  await page.waitForTimeout(300);

  // --- vague 1 -----------------------------------------------------------------------------
  await page.click('[data-cmd="lancer"]');
  if (await page.$('.voile [data-cmd="modal-oui"]')) await page.click('.voile [data-cmd="modal-oui"]');
  await page.waitForFunction(() => window.__royaume.state.phase === 'battle' && window.__royaume.battle);
  await page.click('.vitesse');
  verifier((await etat(() => window.__royaume.speed)) === 2, 'le bouton ×2 ne change pas la vitesse');
  await page.waitForTimeout(1500);
  // déplacer l'armée
  await page.click('[data-cmd="deplacer"]');
  verifier((await etat(() => window.__royaume.mode)) === 'deplacer', '« Déplacer l’armée » ne s’arme pas');
  await toucherTuile(10, 13);
  const rally = await etat(() => window.__royaume.battle.rally);
  verifier(rally.x === 10 && rally.z === 13, `l'armée n'a pas été déplacée (${JSON.stringify(rally)})`);
  await capture('5-bataille');
  // déclenche le piège quand un ennemi passe dessus (ou au bout de 40 s de jeu)
  await page.waitForFunction((p) => {
    const b = window.__royaume.battle;
    if (!b || b.over) return true;
    return b.time > 40 || b.units.some((u) => u.side === 'enemy' && u.state !== 'dead' && Math.hypot(u.x - p.x, u.z - p.z) < 1.2);
  }, piege, { timeout: 90000, polling: 50 });
  const enCours = await etat(() => !!window.__royaume.battle && !window.__royaume.battle.over);
  if (enCours) {
    await page.click('.battlebar .piege-btn');
    const pret = await etat((id) => window.__royaume.battle && window.__royaume.battle.buildings.find((b) => b.id === id).trap.ready, piege.id);
    verifier(pret === false, 'le piège ne s’est pas déclenché');
    await capture('6-piege');
  } else {
    console.warn(`  (${o.nom}) la vague a fini avant le piège : déclenchement non vérifié`);
  }
  // accélère la fin de la vague (le moteur logiciel du navigateur de test est lent)
  await etat(() => window.__royaume.setTestSpeed(4));

  // --- bilan, continuer -------------------------------------------------------------------
  await page.waitForSelector('.fenetre.bilan', { timeout: 180000 });
  await page.waitForTimeout(700);
  await capture('7-bilan');
  const apresVague = await etat(() => ({ wave: window.__royaume.state.wave, phase: window.__royaume.state.phase }));
  verifier(apresVague.wave === 1 && apresVague.phase === 'report', `bilan inattendu : ${JSON.stringify(apresVague)}`);
  await page.click('[data-cmd="continuer"]');
  await page.waitForTimeout(400);
  const avant = await etat(() => {
    const s = window.__royaume.state;
    return { phase: s.phase, wave: s.wave, res: s.resources, bat: s.buildings.map((b) => `${b.type}@${b.x},${b.z}:${b.workers}`).sort().join('|'), sol: s.soldiers.length, vil: s.villagers };
  });
  verifier(avant.phase === 'prep' && avant.wave === 1, `pas de retour en préparation : ${JSON.stringify(avant)}`);
  verifier(await page.isVisible('[data-cmd="lancer"]'), 'bouton « Lancer la vague 2 » absent');
  await capture('8-preparation-2');

  // --- rechargement : Continuer -----------------------------------------------------------
  await page.reload();
  await page.waitForFunction(() => window.__royaume && window.__royaume.ready, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  verifier(await page.isVisible('[data-cmd="continuer-partie"]'), 'pas de « Continuer » après rechargement');
  await page.click('[data-cmd="nouvelle-partie"]');
  verifier(await page.isVisible('.voile [data-cmd="modal-non"]'), '« Nouvelle partie » ne demande pas de confirmation dans la page');
  await page.click('.voile .fenetre-pied [data-cmd="modal-non"]');
  await page.click('[data-cmd="continuer-partie"]');
  await page.waitForTimeout(500);
  const apres = await etat(() => {
    const s = window.__royaume.state;
    return { phase: s.phase, wave: s.wave, res: s.resources, bat: s.buildings.map((b) => `${b.type}@${b.x},${b.z}:${b.workers}`).sort().join('|'), sol: s.soldiers.length, vil: s.villagers };
  });
  verifier(JSON.stringify(apres) === JSON.stringify(avant), `la partie rechargée diffère :\n  avant ${JSON.stringify(avant)}\n  après ${JSON.stringify(apres)}`);
  await capture('9-continuer');

  verifier(erreurs.length === 0, `erreurs dans la page :\n  ${erreurs.join('\n  ')}`);
  await context.close();
}

const browser = await chromium.launch();
for (const o of ORIENTATIONS) {
  const t0 = Date.now();
  try {
    await scenario(browser, o);
    console.log(`OK    ${o.nom.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    echecs++;
    console.error(`ÉCHEC ${o.nom.padEnd(9)} ${e.message}`);
  }
}
await browser.close();
console.log(echecs ? `${echecs} scénario(s) en échec.` : `Tout va bien. Captures : test-output/smoke/`);
process.exit(echecs ? 1 : 0);
