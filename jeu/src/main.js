// Point d'entrée du jeu : démarrage, écran titre, machine à phases
// (titre → préparation → bataille → bilan → préparation… / défaite / victoire), câblage entre
// le cœur (règles), le rendu 3D et l'interface. Sauvegarde automatique à chaque étape.
import * as C from './core/index.js';
import { createRenderer } from './render/scene.js';
import { createCameraController } from './render/camera.js';
import { createWorld } from './render/world.js';
import { createHud } from './ui/hud.js';
import { createPanels, prenom, resumeVague, accordSoldat, accordBatiment } from './ui/panels.js';
import { createTutorial } from './ui/tutorial.js';
import { el, esc, pluriel } from './ui/dom.js';

const NOMS_RES = { bois: 'Bois', pierre: 'Pierre', nourriture: 'Nourriture' };

function demarrer() {
  const app = document.getElementById('royaume') || document.body.appendChild(el('div'));
  app.className = 'app';
  app.lang = 'fr';
  app.innerHTML = '';
  app.dataset.ecran = 'titre';
  const canvas = el('canvas', 'scene');
  canvas.setAttribute('aria-label', 'Vue 3D du village');
  const ui = el('div', 'ui');
  app.append(canvas, ui);

  // --- sauvegarde, options, progression du royaume ---------------------------------------
  const storage = C.createStorage(() => window.localStorage);
  const options = C.loadOptions(storage);
  let meta = C.loadMeta(storage);
  const map = C.getMap(1);

  // --- 3D ------------------------------------------------------------------------------------
  let ctx;
  try {
    ctx = createRenderer(canvas, { quality: options.qualite });
  } catch (e) {
    app.innerHTML = `<div class="erreur-fatale"><div><h2>Projet Royaume</h2><p>Votre appareil n’arrive pas à afficher la 3D (WebGL).
      Essayez un autre navigateur, ou activez l’accélération matérielle.</p><p><small>${esc(e && e.message)}</small></p></div></div>`;
    console.warn('WebGL indisponible', e);
    return;
  }
  let cam = null;
  let G = null; // état de l'interface, défini plus bas
  const world = createWorld(ctx.scene, map, {
    camera: ctx.camera,
    canvas,
    defs: C.BATIMENTS,
    quality: ctx.quality,
    formation: { spacing: C.COMBAT.espacementFormation, perRow: C.COMBAT.soldatsParRang },
    leash: C.COMBAT.laisse, // même rayon que les règles (data.js)
    onShake: (s) => cam && cam.shake(s),
    maxHpOf: (b) => C.buildingMaxHpFor(b.type, (G && G.state ? G.state.talents : meta.talents)),
  });
  const hallW = C.tileToWorld(map.hall.x, map.hall.z);
  cam = createCameraController(ctx.camera, canvas, world.bounds, { target: { x: hallW.wx, z: hallW.wz }, distance: 40 });

  // --- interface -------------------------------------------------------------------------------
  G = {
    screen: 'titre',  // 'titre' | 'jeu'
    state: null,      // partie en cours
    battle: null,     // bataille en cours
    acc: 0,           // temps accumulé pour les pas fixes
    speed: 1,
    paused: false,
    menuPaused: false,
    ending: -1,       // secondes avant le bilan, une fois la bataille finie
    mode: null,       // null | 'placement' | 'drapeau' | 'deplacer'
    place: null,      // { type, x, z, ok, reason }
    selected: null,   // id du bâtiment sélectionné
    usedMove: false,
    usedTrap: false,
    warnedStorage: false,
    tutoT: 0,
  };
  const hud = createHud(ui, { cmd });
  const panels = createPanels(ui, {
    get: () => ({
      state: G.state,
      meta,
      options,
      storageOk: storage.available && !storage.failed,
      hasSave: C.hasSavedGame(storage),
      saveInfo: infoSauvegarde(),
    }),
  });
  const tuto = createTutorial(ui, {
    getOptions: () => options,
    saveOptions: (o) => C.saveOptions(storage, o),
  });

  // Délégation : tout bouton avec data-cmd passe par cmd() ; un bouton grisé explique pourquoi.
  ui.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cmd]');
    if (!t || !ui.contains(t)) return;
    if (t.getAttribute('aria-disabled') === 'true') {
      if (t.dataset.why) hud.toast(t.dataset.why, 'mauvais', 'info');
      return;
    }
    cmd(t.dataset.cmd, { ...t.dataset });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = panels.topModal();
    if (top) { if (top.closable) cmd('modal-non'); return; }
    if (G.mode === 'placement') cmd('construire-annuler');
    else if (G.mode === 'drapeau') cmd('drapeau-fin');
    else if (G.mode === 'deplacer') cmd('deplacer');
    else if (panels.sheet) cmd('fermer');
    else if (G.screen === 'jeu') cmd('menu');
  });

  // ------------------------------------------------------------------ outils
  function infoSauvegarde() {
    const s = C.loadGame(storage);
    if (!s) return '';
    return `Vague ${Math.min(s.wave + 1, s.wavesTotal)} sur ${s.wavesTotal} · ${pluriel(C.population(s), 'habitant')}`;
  }

  function save() {
    if (!G.state) return;
    C.saveGame(storage, G.state);
    if ((storage.failed || !storage.available) && !G.warnedStorage) {
      G.warnedStorage = true;
      hud.toast('Sauvegarde indisponible : la partie ne sera pas gardée.', 'mauvais', 'info');
    }
  }
  function saveMeta() { C.saveMeta(storage, meta); }

  function view() {
    const s = G.state;
    return {
      resources: s.resources,
      cap: C.storageCap(s),
      free: C.freeVillagers(s),
      villagers: s.villagers,
      soldiers: s.soldiers.length,
      soldierCap: C.soldierCapacity(s),
      wave: s.wave,
      wavesTotal: s.wavesTotal,
      phase: s.phase,
      battleWave: G.battle ? G.battle.waveNumber : s.wave + 1,
      level: meta.level,
      talentPoints: meta.talentPoints,
      actionsLeft: s.actionsLeft,
      actionsMax: s.actionsMax,
      next: resumeVague(s.wave),
    };
  }

  /** Recalcule tout ce qui s'affiche (peu coûteux : appelé après chaque changement). */
  function refresh() {
    const s = G.state;
    if (G.screen === 'jeu' && s) {
      hud.update(view());
      world.syncState(s);
    }
    panels.render();
    if (panels.sheet !== 'batiment' && G.selected !== null) { G.selected = null; world.setSelected(null); }
    hud.setSheet(G.screen === 'jeu' ? panels.sheet : null);
    hud.setCovered(G.mode === 'placement' || G.mode === 'drapeau');
    app.dataset.mode = G.screen === 'titre' ? 'titre' : s && s.phase === 'battle' ? 'bataille' : s && s.phase === 'prep' ? 'prep' : 'fin';
    tutoCheck();
  }

  function tutoCheck() {
    const sel = G.selected !== null && G.state ? C.getBuilding(G.state, G.selected) : null;
    tuto.check({
      screen: G.screen, mode: G.mode, sheet: panels.sheet, s: G.state, b: G.battle, map,
      modal: !!panels.topModal(),
      selEmplois: !!(sel && !sel.destroyed && C.BATIMENTS[sel.type].emplois > 0 && sel.workers === 0),
      usedMove: G.usedMove, usedTrap: G.usedTrap,
    });
    const h = tuto.el.hidden ? 0 : tuto.el.offsetHeight + 8;
    app.style.setProperty('--conseil-h', h + 'px');
  }

  /** Haut de la zone de carte libre (sous le bandeau et sous le conseil affiché), en pixels de la toile. */
  function hautLibre() {
    const top = canvas.getBoundingClientRect().top;
    let bas = hud.els.hud.hidden ? 0 : hud.els.hud.getBoundingClientRect().bottom - top;
    if (!tuto.el.hidden) bas = Math.max(bas, tuto.el.getBoundingClientRect().bottom - top);
    return bas;
  }

  function isPortrait() { return app.clientHeight >= app.clientWidth; }

  /** Cadre la caméra sur le village (début de partie, retour de bataille). */
  function frameVillage(immediate = false) {
    const p = isPortrait();
    const t = C.tileToWorld(11, p ? 13.6 : 13);
    cam.setTarget(t.wx, t.wz, immediate);
    cam.setDistance(p ? 33 : 23, immediate);
    cam.setYaw(0, immediate);
  }

  // ------------------------------------------------------------------ écrans
  /** Plus de pause en dehors d'une bataille (sinon le monde resterait figé). */
  function finPause() {
    G.paused = false;
    G.menuPaused = false;
    G.ending = -1;
    hud.setPaused(false);
  }

  function showTitle() {
    G.screen = 'titre';
    app.dataset.ecran = 'titre';
    finPause();
    endModes();
    closeSheet();
    panels.closeAllModals();
    G.battle = null;
    G.state = null;
    world.syncBattle(null);
    hud.setMode('titre');
    const saved = C.loadGame(storage);
    const preview = saved && saved.phase !== 'defeat' && saved.phase !== 'victory' ? saved : C.newGame(meta, { seed: 1 });
    world.syncState(preview);
    cam.setPitchOverride(34);
    cam.setAutoRotate(0.05);
    cam.setTarget(hallW.wx, hallW.wz - 4);
    cam.setDistance(isPortrait() ? 44 : 38);
    panels.showTitle();
    refresh();
  }

  function enterGame() {
    G.screen = 'jeu';
    app.dataset.ecran = 'jeu';
    finPause();
    panels.hideTitle();
    panels.closeAllModals();
    closeSheet();
    cam.setPitchOverride(null);
    cam.setAutoRotate(0);
    frameVillage();
    G.battle = null;
    G.speed = 1;
    world.syncBattle(null);
    panels.markSeen(G.state.unlocked);
    hud.setMode('titre'); // remet à zéro les « +8 » flottants
    const s = G.state;
    if (s.phase === 'report' && s.lastReport) {
      hud.setMode('fin');
      panels.openReport(s.lastReport, meta, s);
    } else if (s.phase === 'defeat' && s.lastReport) {
      hud.setMode('fin');
      panels.openDefeat(s.lastReport, meta);
    } else if (s.phase === 'victory' && s.lastReport) {
      hud.setMode('fin');
      panels.openVictory(s.lastReport, meta, s);
    } else {
      if (s.phase !== 'prep') s.phase = 'prep';
      hud.setMode('prep');
      save(); // sauvegarde au début de chaque préparation
    }
    refresh();
  }

  function newGame() {
    G.state = C.newGame(meta, { seed: Date.now() });
    G.usedMove = G.usedTrap = false;
    enterGame();
  }

  function continueGame() {
    const s = C.loadGame(storage);
    if (!s) { hud.toast('Aucune partie à continuer.', 'mauvais'); showTitle(); return; }
    C.applyTalentsToState(s, meta.talents); // talents achetés depuis l'écran titre
    G.state = s;
    enterGame();
  }

  // ------------------------------------------------------------------ feuilles et sélection
  function closeSheet() {
    if (G.screen === 'titre' && panels.sheet) { panels.showTitle(); cam.setAutoRotate(0.05); } // Royaume ouvert depuis l'écran titre
    panels.closeSheet();
    if (G.selected !== null) { G.selected = null; world.setSelected(null); }
  }
  function toggleSheet(name) {
    if (panels.sheet === name) { closeSheet(); return; }
    endModes();
    if (G.selected !== null) { G.selected = null; world.setSelected(null); }
    panels.openSheet(name);
  }
  function selectBuilding(id) {
    const b = C.getBuilding(G.state, id);
    if (!b) return;
    endModes();
    G.selected = id;
    world.setSelected(b.x, b.z);
    panels.openSheet('batiment', id);
    hud.setSheet('batiment');
    revealTile(b.x, b.z);
  }

  /** Déplace doucement la caméra si le bâtiment est caché par un panneau ou le bandeau. */
  function revealTile(x, z) {
    const sp = world.tileToScreen(x, z, 0.6);
    const f = panels.els.feuille;
    // position de mise en page (sans l'animation d'entrée du panneau)
    const ouvert = !f.hidden;
    const haut = hautLibre() + 40;
    const cs = cam.getState();
    const w = C.tileToWorld(x, z);
    if (isPortrait()) {
      const bas = (ouvert ? f.offsetTop : canvas.clientHeight - 170) - 50;
      if (sp.visible && sp.y > haut && sp.y < bas) return;
      const off = cs.distance * 0.24; // la tuile remonte au-dessus du panneau
      cam.setTarget(w.wx + Math.sin(cs.yaw) * off, w.wz + Math.cos(cs.yaw) * off);
    } else {
      const droite = (ouvert ? f.offsetLeft : canvas.clientWidth) - 60;
      if (sp.visible && sp.x > 40 && sp.x < droite && sp.y > haut) return;
      const off = ouvert ? cs.distance * 0.32 : 0; // la tuile passe à gauche du volet
      cam.setTarget(w.wx + Math.cos(cs.yaw) * off, w.wz - Math.sin(cs.yaw) * off);
    }
  }

  function endModes() {
    if (G.mode === 'placement') {
      world.clearGhost();
      world.setHints(null);
      panels.hidePlacebar();
    } else if (G.mode === 'drapeau') {
      world.showRallyRange(false);
      panels.hidePlacebar();
    } else if (G.mode === 'deplacer') {
      world.showRallyRange(false);
      hud.setMoveArmed(false);
    }
    G.mode = null;
    G.place = null;
  }

  // ------------------------------------------------------------------ construction
  function startPlacement(type) {
    const s = G.state;
    const tiles = C.validTiles(s, type);
    if (!tiles.length) { hud.toast('Aucun emplacement possible pour ce bâtiment.', 'mauvais'); return; }
    closeSheet();
    endModes();
    G.mode = 'placement';
    G.place = { type, x: -1, z: -1, ok: false, reason: '' };
    world.setHints(tiles);
    const best = meilleureCase(type, tiles);
    movePlacement(best.x, best.z, true);
  }

  /** Tuiles de route à portée d'une tour posée en (x, z) (les dernières, près du village, comptent plus). */
  function couvertureRoute(portee, x, z) {
    let score = 0;
    for (let i = 0; i < map.path.length; i++) {
      const t = map.path[i];
      if (Math.hypot(t.x - x, t.z - z) <= portee) score += 1 + i / map.path.length;
    }
    return score;
  }

  /**
   * Case proposée d'office : sur la route pour ce qui la barre (ou un piège), à portée de la route pour
   * une tour (celle qui en couvre le plus, près de la vue), sinon près du centre de la vue.
   */
  function meilleureCase(type, tiles) {
    const def = C.BATIMENTS[type];
    let pool = tiles;
    if (def.bloqueRoute || def.placement === 'route') {
      const route = tiles.filter((t) => map.tiles[t.z][t.x] === 'road');
      if (route.length) pool = route;
    }
    const cs = cam.getState();
    const c = C.worldToTile(cs.x, cs.z);
    if (def.tour) {
      let best = null;
      let bs = -Infinity;
      for (const t of pool) {
        const cov = couvertureRoute(def.tour.portee, t.x, t.z);
        if (cov <= 0) continue;
        const sc = cov - 0.6 * Math.hypot(t.x - c.x, t.z - c.z);
        if (sc > bs) { bs = sc; best = t; }
      }
      if (best) return best;
    }
    let best = pool[0];
    let bd = Infinity;
    for (const t of pool) {
      const d = Math.hypot(t.x - c.x, t.z - c.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /**
   * Avertissement si l'emplacement est permis mais peu utile. fort : vraiment inutile (le bouton
   * devient « Construire quand même ») ; sinon simple conseil.
   */
  function avertissement(type, x, z) {
    const def = C.BATIMENTS[type];
    const surRoute = map.tiles[z][x] === 'road';
    if (def.bloqueRoute && !surRoute) return { texte: 'Hors de la route : elle ne bloquera pas les ennemis.', fort: true };
    if (def.tour && couvertureRoute(def.tour.portee, x, z) <= 0) {
      return { texte: 'Trop loin de la route : la tour ne tirera sur personne.', fort: true };
    }
    if (def.piege) {
      // un piège sert surtout là où les ennemis s'entassent : juste devant une palissade ou un mur
      const i = C.pathIndexOf(map, x, z);
      const devantMur = G.state.buildings.some((b) => !b.destroyed && C.BATIMENTS[b.type].bloqueRoute
        && C.pathIndexOf(map, b.x, b.z) > i && C.pathIndexOf(map, b.x, b.z) <= i + 2);
      if (!devantMur) return { texte: 'Plus efficace juste devant une palissade ou un mur.', fort: false };
    }
    return null;
  }

  function movePlacement(x, z, recentrer = false) {
    const p = G.place;
    const c = C.canPlace(G.state, p.type, x, z);
    const w = c.ok ? avertissement(p.type, x, z) : null;
    Object.assign(p, { x, z, ok: c.ok, reason: c.ok ? '' : c.reason, warn: w ? w.texte : '', warnFort: !!(w && w.fort) });
    world.setGhost(p.type, x, z, c.ok, C.BATIMENTS[p.type].tour?.portee || 0);
    panels.showPlacebar(p);
    if (recentrer) {
      const sp = world.tileToScreen(x, z, 0);
      const r = canvas.getBoundingClientRect();
      const bas = r.height - (panels.els.placebar.offsetHeight + 40);
      if (!sp.visible || sp.y < hautLibre() + 24 || sp.y > bas) {
        const w = C.tileToWorld(x, z);
        cam.setTarget(w.wx, w.wz);
      }
    }
  }

  function confirmPlacement() {
    const p = G.place;
    if (!p || p.x < 0) return;
    const r = C.build(G.state, p.type, p.x, p.z);
    if (!r.ok) { hud.toast(r.reason, 'mauvais'); movePlacement(p.x, p.z); return; }
    const def = C.BATIMENTS[p.type];
    save();
    tuto.markSeen('placer'); // le geste est appris : le conseil ne revient plus
    hud.toast(`${def.nom} : ${accordBatiment(p.type, 'construit')} !`, 'bon', 'valide');
    toastNouveautes(r.unlocked);
    endModes();
    if (def.emplois > 0) { refresh(); selectBuilding(r.building.id); }
  }

  /** Un seul message pour tout ce qui vient d'être débloqué : « Nouveau : Carrière, Tour de guet ». */
  function toastNouveautes(liste) {
    if (liste && liste.length) hud.toast(`Nouveau : ${liste.map((u) => u.nom).join(', ')}`, 'nouveau', 'etoile');
  }

  // ------------------------------------------------------------------ préparation : petites commandes
  function result(r, okText = null, kind = 'bon', ic = 'valide') {
    if (!r.ok) { hud.toast(r.reason, 'mauvais', 'info'); return false; }
    save();
    if (okText) hud.toast(okText, kind, ic);
    return true;
  }

  function doAction(id) {
    const r = C.doAction(G.state, id);
    if (!r.ok) { result(r); return; }
    save();
    const avecGain = C.ACTIONS[id].gain;
    if (!avecGain || (r.lost && Object.keys(r.lost).length)) hud.toast(r.message, 'bon', id === 'explorer' ? 'boussole' : 'valide');
    if (G.state.actionsLeft === 0) setTimeout(() => { if (panels.sheet === 'actions') { closeSheet(); refresh(); } }, 450);
  }

  function askDemolish(id) {
    const info = C.buildingInfo(G.state, id);
    if (!info) return;
    if (info.destroyed) {
      panels.confirmer({ titre: 'Déblayer les ruines ?', texte: 'Rien n’est récupéré, mais la case redevient libre.', oui: 'Déblayer', ic: 'demolir' }, () => {
        if (result(C.demolish(G.state, id), 'Ruines déblayées.')) closeSheet();
        refresh();
      });
      return;
    }
    const rend = C.costText(info.demolir.remboursement || {});
    panels.confirmer({
      titre: `Démolir : ${info.nom} ?`,
      texte: `${rend === 'gratuit' ? 'Rien n’est récupéré.' : `Vous récupérez <b>${esc(rend)}</b>.`}${info.workers ? ' Les ouvriers redeviennent libres.' : ''}`,
      oui: 'Démolir', danger: true, ic: 'demolir',
    }, () => {
      const r = C.demolish(G.state, id);
      if (result(r, r.message)) closeSheet();
      refresh();
    });
  }

  function askLaunch() {
    const s = G.state;
    if (s.phase !== 'prep') return;
    if (s.actionsLeft > 0) {
      panels.confirmer({
        titre: `Il reste ${pluriel(s.actionsLeft, 'action')}`,
        texte: 'Les actions ne se gardent pas d’un cycle à l’autre. Lancer la vague quand même ?',
        oui: 'Lancer la vague', non: 'Utiliser mes actions', ic: 'actions',
      }, () => { startWave(); refresh(); }, () => { panels.openSheet('actions'); refresh(); });
      return;
    }
    startWave();
  }

  // ------------------------------------------------------------------ bataille
  function startWave() {
    const s = G.state;
    endModes();
    closeSheet();
    save(); // la partie est gardée telle qu'avant la vague (une page rechargée reprend ici)
    const r = C.startBattle(s);
    if (!r.ok) { hud.toast(r.reason, 'mauvais'); return; }
    G.battle = r.battle;
    G.acc = 0;
    G.paused = false;
    G.menuPaused = false;
    G.ending = -1;
    hud.setMode('bataille');
    hud.setPaused(false);
    hud.setSpeed(G.speed);
    world.setMinDamageNumber(G.speed > 1 ? 4 : 0);
    zonesLibres();
    world.syncState(s);
    tutoCheck(); // les conseils de préparation s'effacent avant de cadrer
    const der = G.battle.waveNumber === s.wavesTotal;
    hud.banner(`Vague ${G.battle.waveNumber}`, der ? 'La dernière : le chef de guerre arrive !' : 'Ils arrivent par la route !');
    cadrerBataille(G.battle);
  }

  /**
   * Cadre la bataille sur les défenses, entre le bandeau du haut et la barre de bataille.
   * On essaie du plus large au plus serré : tout (route avant le 1er obstacle, murs, pièges, tours,
   * drapeau, Maison commune), puis sans la Maison commune ni la fin de route, puis le seul lieu du
   * combat (le premier mur debout et les ennemis qui s'y pressent). Le premier cadre qui tient sans
   * trop reculer gagne : les soldats restent assez grands pour être vus.
   */
  function cadrerBataille(b) {
    const P = map.path;
    // premier obstacle debout sur la route : c'est là que l'ennemi s'arrête et que l'on se bat
    let premier = P.length;
    for (const bb of b.buildings) {
      if (bb.blocks && !bb.destroyed) premier = Math.min(premier, C.pathIndexOf(map, bb.x, bb.z));
    }
    const arret = Math.min(premier, P.length - 1);
    const pArret = P[arret];
    const route = (i0, i1) => P.slice(Math.max(0, i0), Math.min(P.length, i1 + 1));
    // lieu du combat : la file d'ennemis devant l'obstacle (ou devant la Maison commune s'il n'y en a pas)
    const combat = premier < P.length ? route(arret - 4, arret + 1) : [...route(arret - 4, arret), map.hall];
    const defenses = [];
    const prochesDefenses = [];
    for (const bb of b.buildings) {
      if (bb.destroyed || bb.type === 'maison_commune' || !(bb.trap || bb.tower || bb.blocks)) continue;
      defenses.push(bb);
      if (Math.max(Math.abs(bb.x - pArret.x), Math.abs(bb.z - pArret.z)) <= 4) prochesDefenses.push(bb);
    }
    const debut = Math.max(0, Math.min(premier - 5, P.length - 12));
    // le drapeau compte large : les soldats se rangent autour de lui
    const drapeau = { x: b.rally.x, z: b.rally.z, marge: 1.6 };
    const essais = [
      [map.hall, drapeau, ...route(debut, P.length - 1), ...defenses],
      [map.hall, drapeau, ...combat, ...prochesDefenses],
      [drapeau, ...combat, ...prochesDefenses],
      [drapeau, ...combat],
      combat,
    ];
    const r = canvas.getBoundingClientRect();
    const bas = hud.els.battlebar.getBoundingClientRect().top - r.top - 8;
    // marges : les boutons de pièges (44 px) restent entiers
    const zones = [{ left: 30, right: r.width - 30, top: hautLibre() + 28, bottom: bas, width: r.width, height: r.height }];
    const portrait = isPortrait();
    // écran couché : le conseil n'occupe que la gauche ; la bande à sa droite, plus haute, sert aussi
    if (!portrait && !tuto.el.hidden && !hud.els.hud.hidden) {
      const c = tuto.el.getBoundingClientRect();
      zones.push({ left: c.right - r.left + 12, right: r.width - 30, top: hud.els.hud.getBoundingClientRect().bottom - r.top + 12, bottom: bas, width: r.width, height: r.height });
    }
    // distances : pas trop près (garder du contexte), pas trop loin (soldats lisibles ; l'écran couché est bas)
    const dMin = portrait ? 30 : 20;
    const dConfort = portrait ? 40 : 23; // couché : comme le cadrage du village (23)
    const cadrer = (tuiles, dMax) => {
      const pts = pointsDeTuiles(tuiles);
      let meilleur = null;
      for (const z of zones) {
        if (z.right - z.left < 120 || z.bottom - z.top < 80) continue;
        const f = cam.fitPoints(pts, z, dMin, dMax);
        if (!meilleur || (f.fits && (!meilleur.fits || f.distance < meilleur.distance))) meilleur = f;
      }
      return meilleur || cam.fitPoints(pts, zones[0], dMin, dMax);
    };
    let f = null;
    for (const tuiles of essais) {
      f = cadrer(tuiles, dConfort);
      if (f.fits) break;
    }
    // même le lieu du combat ne tient pas de près : on recule autant qu'il faut, centré sur lui
    if (!f.fits) f = cadrer(combat, Infinity);
    // (l'orientation choisie par le joueur est gardée)
    cam.setTarget(f.x, f.z);
    cam.setDistance(f.distance);
  }

  /** Coins des tuiles (± marge en tuiles), au sol et à hauteur d'homme : ce que la caméra doit voir. */
  function pointsDeTuiles(tuiles) {
    const pts = [];
    for (const t of tuiles) {
      const w = C.tileToWorld(t.x, t.z);
      const m = (t.marge ?? 0.45) * C.TILE;
      for (const [dx, dz] of [[-m, -m], [m, -m], [-m, m], [m, m]]) {
        pts.push({ x: w.wx + dx, y: 0, z: w.wz + dz }, { x: w.wx + dx, y: 1.6, z: w.wz + dz });
      }
    }
    return pts;
  }

  function scanEvents(b) {
    for (const e of b.events) {
      if (!e) continue;
      if (e.type === 'death' && e.side === 'ally') {
        const u = b.unitIndex.get(e.unitId);
        if (u && u.soldierId != null) hud.toast(`${prenom(u.soldierId)} est ${accordSoldat(u.soldierId, 'tombé')} au combat.`, 'mauvais', 'crane');
      } else if (e.type === 'building_destroyed') {
        const d = C.BATIMENTS[e.buildingType];
        if (d) hud.toast(`${d.nom} : ${accordBatiment(e.buildingType, 'détruit')} !`, 'mauvais', 'maison');
      }
    }
  }

  function startEnding() {
    const b = G.battle;
    G.ending = 2.2;
    G.mode === 'deplacer' && endModes();
    if (b.result === 'defeat') hud.banner('Le village tombe…', '', 'rouge');
    else {
      hud.banner('Vague repoussée !', b.retreated ? 'Les derniers ennemis se retirent.' : '');
      const h = world.tileToWorld(map.hall.x, map.hall.z);
      world.fx.celebrate(h.x, h.y, h.z);
    }
  }

  function endBattle() {
    const s = G.state;
    const b = G.battle;
    const report = C.finishBattle(s, b, meta);
    saveMeta();
    save();
    G.battle = null;
    G.paused = false;
    world.syncBattle(null);
    world.syncState(s);
    hud.setMode('fin');
    frameVillage();
    if (s.phase === 'defeat') panels.openDefeat(report, meta);
    else if (s.phase === 'victory') panels.openVictory(report, meta, s);
    else panels.openReport(report, meta, s);
    refresh();
  }

  function continueAfterReport() {
    const r = C.continueToPrep(G.state);
    if (!r.ok) return;
    panels.closeAllModals();
    hud.setMode('prep');
    C.applyTalentsToState(G.state, meta.talents); // au cas où un talent aurait été appris entre-temps
    save(); // sauvegarde au début de chaque préparation
    const r2 = G.state.lastReport;
    toastNouveautes(r2 && r2.unlocked);
    if (meta.talentPoints > 0 && G.state.wave <= 3) hud.toast('Point de talent à dépenser : onglet Royaume.', 'nouveau', 'etoile');
  }

  function fireTrap(id) {
    if (!G.battle || G.battle.over) return; // pendant la bannière de fin : plus de levier
    const r = C.triggerTrap(G.battle, id);
    if (!r.ok) { hud.toast(r.reason, 'mauvais', 'horloge'); return; }
    G.usedTrap = true;
    tuto.markSeen('piege');
    hud.toast(r.hits ? `Piège : ${pluriel(r.hits, 'ennemi touché', 'ennemis touchés')} !` : 'Le piège n’a touché personne.', r.hits ? 'bon' : '', 'piege');
  }

  function toggleMoveArmy(force) {
    const on = typeof force === 'boolean' ? force : G.mode !== 'deplacer';
    if (on) { endModes(); G.mode = 'deplacer'; world.showRallyRange(true); hud.setMoveArmed(true); } else if (G.mode === 'deplacer') endModes();
  }

  function onTap(cx, cy) {
    if (G.screen !== 'jeu' || !G.state || panels.topModal()) return;
    const s = G.state;
    const p = world.pickTile(cx, cy);
    if (s.phase === 'battle' && G.battle) {
      if (!p || G.battle.over) return;
      if (G.mode === 'deplacer') {
        const r = C.moveArmy(G.battle, p);
        if (r.ok) { world.setRally(p.x, p.z); G.usedMove = true; tuto.markSeen('armee'); toggleMoveArmy(false); } else hud.toast(r.reason, 'mauvais');
      } else {
        const trap = G.battle.buildings.find((b) => b.trap && !b.destroyed && b.x === p.x && b.z === p.z);
        if (trap) fireTrap(trap.id);
      }
      refresh();
      return;
    }
    if (s.phase !== 'prep') return;
    if (G.mode === 'placement') { if (p) movePlacement(p.x, p.z); refresh(); return; }
    if (G.mode === 'drapeau') {
      if (p && result(C.setRally(s, p))) world.setRally(p.x, p.z);
      refresh();
      return;
    }
    const b = p ? C.buildingAt(s, p.x, p.z) : null;
    if (b) selectBuilding(b.id);
    else if (panels.sheet) closeSheet();
    refresh();
  }
  cam.onTap(onTap);

  // ------------------------------------------------------------------ menu, options, sauvegarde
  function openMenu() {
    if (G.state && G.state.phase === 'battle' && !G.paused) {
      G.paused = true;
      G.menuPaused = true;
      hud.setPaused(true);
    }
    panels.openMenu(G.state && G.state.phase === 'battle');
    const f = panels.topModal();
    // en refermant le menu, la bataille reprend si c'est lui qui l'avait mise en pause
    if (f) f.onNo = () => {
      if (G.menuPaused) { G.paused = false; G.menuPaused = false; hud.setPaused(false); }
    };
  }

  function askToTitle() {
    if (G.state && G.state.phase === 'battle') {
      panels.confirmer({
        titre: 'Quitter la bataille ?',
        texte: 'La bataille sera perdue de vue : vous reprendrez à la <b>préparation de cette vague</b>.',
        oui: 'Quitter', danger: true, ic: 'maison',
      }, () => showTitle());
      return;
    }
    showTitle();
  }

  function askNewGame() {
    if (C.hasSavedGame(storage)) {
      panels.confirmer({
        titre: 'Nouvelle partie ?',
        texte: `La partie en cours (${esc(infoSauvegarde())}) sera remplacée. Le royaume garde son niveau, ses talents et ses réserves.`,
        oui: 'Commencer', danger: true, ic: 'royaume',
      }, () => newGame());
      return;
    }
    newGame();
  }

  function setQuality(q) {
    options.qualite = q === 'economie' ? 'economie' : 'normale';
    C.saveOptions(storage, options);
    const r = ctx.setQuality(options.qualite);
    world.setQuality(options.qualite);
    if (r.needsReload) hud.toast('Le lissage des bords changera au prochain lancement.', '', 'info');
    panels.renderOptions();
  }

  function eraseGame() {
    panels.confirmer({
      titre: 'Effacer la partie ?',
      texte: 'Le village en cours sera perdu. Le royaume (niveau, talents, réserves) est gardé.',
      oui: 'Effacer', danger: true, ic: 'demolir',
    }, () => {
      C.clearGame(storage);
      hud.toast('Partie effacée.', '', 'demolir');
      showTitle();
    });
  }

  function eraseAll() {
    panels.confirmer({
      titre: 'Tout effacer ?',
      texte: 'La partie <b>et</b> le royaume (niveau, talents, missions, réserves) repartent de zéro.',
      oui: 'Tout effacer', danger: true, ic: 'demolir',
    }, () => {
      C.clearGame(storage);
      C.clearMeta(storage);
      meta = C.newMeta();
      options.tutoVus = [];
      C.saveOptions(storage, options);
      hud.toast('Tout est effacé.', '', 'demolir');
      showTitle();
    });
  }

  function chipInfo(chip) {
    const s = G.state;
    if (!s) return;
    if (chip === 'niveau') { toggleSheet('royaume'); return; }
    const cap = C.storageCap(s);
    let t = '';
    if (NOMS_RES[chip]) {
      const conseil = C.hallInRuins(s) ? 'La Maison commune est en ruine : reconstruisez-la pour stocker davantage.'
        : s.resources[chip] >= cap ? 'Stock plein : un entrepôt en stocke plus.' : 'Les entrepôts augmentent le stockage.';
      t = `${NOMS_RES[chip]} : ${s.resources[chip]} sur ${cap}. ${conseil}`;
    } else if (chip === 'villageois') {
      t = `${pluriel(C.freeVillagers(s), 'villageois libre', 'villageois libres')} sur ${s.villagers}. Logement : ${C.population(s)}/${C.housingCapacity(s)}.`;
    } else if (chip === 'soldats') {
      t = `${pluriel(s.soldiers.length, 'soldat')} sur ${C.soldierCapacity(s)} places. Une caserne en ajoute ${C.BATIMENTS.caserne.soldats}.`;
    } else if (chip === 'vague') {
      const v = resumeVague(G.battle ? G.battle.waveIndex : s.wave);
      t = v ? `Vague ${v.numero} : ${v.detail}.` : 'Toutes les vagues sont repoussées.';
    }
    if (t) hud.toast(t, '', 'info');
  }

  // ------------------------------------------------------------------ commandes de l'interface
  function cmd(name, d = {}) {
    const s = G.state;
    const enPrep = s && s.phase === 'prep' && G.screen === 'jeu';
    switch (name) {
      // préparation
      case 'onglet': if (enPrep || d.sheet === 'royaume') toggleSheet(d.sheet); break;
      case 'fermer': closeSheet(); break;
      case 'action': if (enPrep) doAction(d.id); break;
      case 'construire': if (enPrep) startPlacement(d.type); break;
      case 'construire-annuler': endModes(); break;
      case 'construire-ici': if (enPrep) confirmPlacement(); break;
      case 'ouvrier': if (enPrep) result(C.assign(s, +d.id, +d.delta)); break;
      case 'demolir': if (enPrep) askDemolish(+d.id); break;
      case 'reconstruire': if (enPrep) {
        const t = C.getBuilding(s, +d.id)?.type;
        result(C.rebuild(s, +d.id), `${C.BATIMENTS[t]?.nom || 'Bâtiment'} : ${accordBatiment(t, 'reconstruit')} !`);
      } break;
      case 'recruter': if (enPrep) {
        const r = C.recruit(s, d.kind);
        result(r, r.ok ? `${prenom(r.soldier.id)} rejoint l’armée.` : null, 'bon', 'soldat');
      } break;
      case 'equiper': if (enPrep) {
        const so = s.soldiers.find((x) => x.id === +d.id);
        result(C.equip(s, +d.id, +d.tier), so ? `${prenom(so.id)} reçoit : ${C.EQUIPEMENTS[+d.tier].nom.toLowerCase()}.` : null, 'bon', 'soldat');
      } break;
      case 'equiper-tous': if (enPrep) {
        const r = C.equipAll(s, +d.tier);
        result(r, r.ok ? `${pluriel(r.count, 'fantassin équipé', 'fantassins équipés')} : ${C.EQUIPEMENTS[+d.tier].nom.toLowerCase()}${r.reason ? ' (pas assez pour tous)' : ''}.` : null, 'bon', 'soldat');
      } break;
      case 'archer': if (enPrep) result(C.convertToArcher(s, +d.id), `${prenom(+d.id)} devient ${accordSoldat(+d.id, 'archer', 'archère')}.`, 'bon', 'chasseur'); break;
      case 'drapeau': if (enPrep) { closeSheet(); endModes(); G.mode = 'drapeau'; world.showRallyRange(true); panels.showRallybar(); } break;
      case 'drapeau-fin': endModes(); break;
      case 'talent-voir': panels.selectTalent(d.id); break;
      case 'talent': {
        const r = C.buyTalent(meta, d.id, G.state && G.state.phase !== 'battle' ? G.state : null);
        if (r.ok) {
          saveMeta();
          if (G.state) save();
          hud.toast(`Talent appris : ${C.TALENTS[d.id].nom}`, 'nouveau', 'etoile');
        } else hud.toast(r.reason, 'mauvais');
      } break;
      case 'lancer': if (enPrep) askLaunch(); break;
      case 'continuer': continueAfterReport(); break;
      // bataille
      case 'vitesse': G.speed = G.speed === 1 ? 2 : 1; hud.setSpeed(G.speed); world.setMinDamageNumber(G.speed > 1 ? 4 : 0); break;
      case 'pause': G.paused = !G.paused; G.menuPaused = false; hud.setPaused(G.paused); break;
      case 'deplacer': if (G.battle) toggleMoveArmy(); break;
      case 'piege': fireTrap(+d.id); break;
      // menus
      case 'menu': if (G.screen === 'jeu') openMenu(); break;
      case 'options': panels.openOptions(); break;
      case 'qualite': setQuality(d.q); break;
      case 'conseils': options.conseils = !options.conseils; C.saveOptions(storage, options); panels.renderOptions(); break;
      case 'conseils-revoir': tuto.reset(); options.conseils = true; C.saveOptions(storage, options); panels.renderOptions(); hud.toast('Les conseils reviendront au bon moment.', '', 'livre'); break;
      case 'conseil-fermer': tuto.dismiss(); break;
      case 'effacer-partie': eraseGame(); break;
      case 'effacer-tout': eraseAll(); break;
      case 'modal-oui': panels.closeModal(true); break;
      case 'modal-non': panels.closeModal(false); break;
      // écran titre, fin de partie
      case 'continuer-partie': continueGame(); break;
      case 'nouvelle-partie': askNewGame(); break;
      case 'titre-royaume': panels.hideTitle(); toggleSheet('royaume'); break;
      case 'recommencer': newGame(); break;
      case 'titre': askToTitle(); break;
      case 'info-chip': chipInfo(d.chip); break;
      default: break;
    }
    refresh();
  }

  // ------------------------------------------------------------------ boucle de jeu
  const trapOut = [];
  let zoneHaut = 0;
  let zoneBas = 0;
  function zonesLibres() {
    zoneHaut = hud.els.hud.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top;
    zoneBas = hud.els.battlebar.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 10;
  }
  window.addEventListener('resize', () => setTimeout(() => { if (G.battle) zonesLibres(); }, 50));

  // Objets réutilisés d'une image à l'autre (aucune allocation par image pendant la bataille).
  const trapInfos = [];
  const vueBataille = { remaining: 0, total: 0, over: false, count: 0, traps: trapInfos };
  function battleHud(b) {
    let n = 0;
    for (const bb of b.buildings) {
      if (!bb.trap || bb.destroyed) continue;
      const o = trapOut[n] || (trapOut[n] = { x: 0, y: 0, visible: false });
      const t = trapInfos[n] || (trapInfos[n] = { id: 0, n: 0, ready: false, progress: 0, targeted: false, sx: 0, sy: 0, visible: false });
      n++;
      world.tileToScreen(bb.x, bb.z, 2.1, o);
      let targeted = false;
      if (bb.trap.ready) {
        const rr = bb.trap.radius + C.COMBAT.margeRayonPiege;
        for (const u of b.units) {
          if (u.side === 'enemy' && u.state !== 'dead' && Math.hypot(u.x - bb.x, u.z - bb.z) <= rr) { targeted = true; break; }
        }
      }
      t.id = bb.id; t.n = n; t.ready = bb.trap.ready; t.progress = bb.trap.progress; t.targeted = targeted;
      t.sx = o.x; t.sy = o.y; t.visible = o.visible && o.y > zoneHaut + 24 && o.y < zoneBas - 24;
    }
    vueBataille.remaining = C.enemiesRemaining(b);
    vueBataille.total = b.totalEnemies;
    vueBataille.over = b.over;
    vueBataille.count = n;
    hud.updateBattle(vueBataille);
  }

  ctx.start((dt) => {
    const s = G.state;
    const b = G.battle;
    if (b && s && s.phase === 'battle') {
      if (!G.paused && !b.over) {
        G.acc += dt * G.speed;
        while (G.acc >= C.COMBAT.pas && !b.over) {
          C.stepBattle(b, C.COMBAT.pas);
          G.acc -= C.COMBAT.pas;
          scanEvents(b);
          world.consumeEvents(b.events);
        }
      }
      world.syncBattle(b, Math.min(1, G.acc / C.COMBAT.pas));
      if (b.over) {
        if (G.ending < 0) startEnding();
        else if (!G.paused) { G.ending -= dt; if (G.ending <= 0) endBattle(); }
      }
      if (G.battle) battleHud(b);
      G.tutoT += dt;
      if (G.tutoT > 0.5) { G.tutoT = 0; tutoCheck(); }
    }
    cam.update(dt);
    ctx.setFogForDistance(cam.getState().distance);
    world.update(G.paused && G.battle ? 0 : dt); // la pause ne fige que la bataille
  });

  // Accès pour les tests automatiques (lecture surtout ; aucune règle contournée)
  window.__royaume = {
    get state() { return G.state; },
    get battle() { return G.battle; },
    get meta() { return meta; },
    get screen() { return G.screen; },
    get mode() { return G.mode; },
    get sheet() { return panels.sheet; },
    get speed() { return G.speed; },
    /** Caméra (cible, distance, orientation) : vérifier un cadrage. */
    get camera() { return cam.getState(); },
    /** Position écran (px) du centre d'une tuile. */
    tileScreen(x, z, h = 0) {
      const r = canvas.getBoundingClientRect();
      const p = world.tileToScreen(x, z, h);
      return { x: r.left + p.x, y: r.top + p.y, visible: p.visible };
    },
    /** Centre la caméra sur une tuile (tests). */
    focusTile(x, z, distance) {
      const w = C.tileToWorld(x, z);
      cam.setTarget(w.wx, w.wz, true);
      if (distance) cam.setDistance(distance, true);
      cam.update(0.016);
    },
    /** Accélère la simulation (tests uniquement). */
    setTestSpeed(n) { G.speed = n; hud.setSpeed(n); },
    core: C,
    ready: true,
  };

  showTitle();
}

try {
  demarrer();
} catch (e) {
  console.error(e);
  const box = document.getElementById('royaume') || document.body;
  box.innerHTML = `<div class="erreur-fatale"><div><h2>Projet Royaume</h2><p>Le jeu n’a pas pu démarrer.</p><p><small>${esc(e && e.message)}</small></p></div></div>`;
}
