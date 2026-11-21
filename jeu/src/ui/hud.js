// Bandeau du haut (ressources, population, vague, niveau), barre du bas (onglets + « Lancer la vague »),
// barre de bataille (vitesse, pause, déplacer l'armée, pièges), messages et bannières.
// Le HUD n'applique aucune règle : il affiche et transmet les intentions à main.js via cmd().
import { icon } from './icons.js';
import { el, esc, nb, reduceMotion } from './dom.js';

const RES = ['bois', 'pierre', 'nourriture'];
export const MAX_REPERES = 4; // chevrons « ennemis hors de l'écran » au plus
const ONGLETS = [
  { id: 'actions', nom: 'Actions', ic: 'actions' },
  { id: 'construire', nom: 'Construire', ic: 'construire' },
  { id: 'armee', nom: 'Armée', ic: 'armee' },
  { id: 'royaume', nom: 'Royaume', ic: 'royaume' },
];

/**
 * Crée le HUD dans le calque d'interface.
 * @param {HTMLElement} ui calque d'interface (au-dessus de la scène 3D)
 * @param {{ cmd: (name: string, data?: object) => void }} opts
 */
export function createHud(ui, { cmd }) {
  // --- bandeau du haut -------------------------------------------------------------------
  const hud = el('header', 'hud');
  hud.setAttribute('aria-label', 'Ressources du village');
  const chips = {};
  for (const r of RES) {
    const c = el('button', `chip c-res c-${r}`,
      `${icon(r, 'ic-' + r)}<b class="v">0</b><span class="cap">/100</span>`);
    c.type = 'button';
    c.dataset.cmd = 'info-chip';
    c.dataset.chip = r;
    chips[r] = { el: c, v: c.querySelector('.v'), cap: c.querySelector('.cap') };
    hud.append(c);
  }
  const menuBtn = el('button', 'btn btn-icone menu-btn', icon('menu'));
  menuBtn.type = 'button';
  menuBtn.dataset.cmd = 'menu';
  menuBtn.setAttribute('aria-label', 'Menu');
  hud.append(menuBtn);
  const ligne2 = el('div', 'ligne2');
  const mk = (cls, ic, chip) => {
    const c = el('button', `chip ${cls}`, `${icon(ic, 'ic-' + ic)}<b class="v">0</b><span class="cap"></span>`);
    c.type = 'button';
    c.dataset.cmd = 'info-chip';
    c.dataset.chip = chip;
    ligne2.append(c);
    return { el: c, v: c.querySelector('.v'), cap: c.querySelector('.cap') };
  };
  chips.villageois = mk('c-villageois', 'villageois', 'villageois');
  chips.soldats = mk('c-soldats', 'soldat', 'soldats');
  chips.vague = mk('c-vague', 'vague', 'vague');
  chips.niveau = mk('c-niveau', 'etoile', 'niveau');
  chips.niveau.el.querySelector('.ic').classList.add('ic-or');
  // version bataille de la 2e ligne : ennemis restants + vitesse + pause
  const ennemis = el('div', 'chip c-ennemis', `${icon('crane')}<b class="v">0</b><span class="lbl">restants</span><div class="barre rouge"><i></i></div>`);
  ennemis.setAttribute('role', 'status');
  ennemis.style.color = 'var(--texte)';
  ennemis.querySelector('.ic').style.color = 'var(--ennemi)';
  const ennemisV = ennemis.querySelector('.v');
  const ennemisLbl = ennemis.querySelector('.lbl');
  const ennemisBarre = ennemis.querySelector('.barre > i');
  const vitesseBtn = el('button', 'btn btn-icone vitesse', `${icon('vitesse')}`);
  vitesseBtn.type = 'button';
  vitesseBtn.dataset.cmd = 'vitesse';
  vitesseBtn.style.width = '58px';
  const vitesseLbl = el('b', '', '×1');
  vitesseLbl.style.fontSize = '13px';
  vitesseBtn.append(vitesseLbl);
  const pauseBtn = el('button', 'btn btn-icone pause', icon('pause'));
  pauseBtn.type = 'button';
  pauseBtn.dataset.cmd = 'pause';
  pauseBtn.setAttribute('aria-label', 'Pause');
  ligne2.append(ennemis, vitesseBtn, pauseBtn);
  hud.append(ligne2);

  // --- barre du bas (préparation) -----------------------------------------------------------
  const dock = el('nav', 'dock');
  dock.setAttribute('aria-label', 'Préparation');
  const onglets = el('div', 'onglets');
  const tabEls = {};
  for (const o of ONGLETS) {
    const b = el('button', 'onglet', `${icon(o.ic)}<span>${o.nom}</span>`);
    b.type = 'button';
    b.dataset.cmd = 'onglet';
    b.dataset.sheet = o.id;
    b.dataset.key = 'onglet-' + o.id;
    b.setAttribute('aria-pressed', 'false');
    onglets.append(b);
    tabEls[o.id] = b;
  }
  const badge = el('span', 'pastille', '5');
  tabEls.actions.append(badge);
  const badgeTalent = el('span', 'pastille point');
  badgeTalent.hidden = true;
  tabEls.royaume.append(badgeTalent);
  dock.append(onglets);
  const cta = el('button', 'cta', `${icon('lancer')}<span><b>Lancer la vague 1</b><small>3 ennemis</small></span>`);
  cta.type = 'button';
  cta.dataset.cmd = 'lancer';
  cta.dataset.key = 'cta';
  const ctaB = cta.querySelector('b');
  const ctaS = cta.querySelector('small');

  // --- barre de bataille ----------------------------------------------------------------------
  const battlebar = el('div', 'battlebar');
  const bouger = el('button', 'btn bouger', `${icon('drapeau')}<span>Déplacer l’armée</span>`);
  bouger.type = 'button';
  bouger.dataset.cmd = 'deplacer';
  bouger.dataset.key = 'deplacer';
  bouger.setAttribute('aria-pressed', 'false');
  const pieges = el('div', 'pieges');
  const aucun = el('div', 'aucun', 'Pas de piège sur la route');
  battlebar.append(bouger, pieges, aucun);
  const ancres = el('div', 'ancres passif');
  const voilePause = el('div', 'pause-voile passif', '<span>En pause</span>');
  voilePause.hidden = true;
  const infoMode = el('div', 'info-mode passif');
  infoMode.hidden = true;

  // ennemis hors de l'écran : petits chevrons rouges au bord, vers le groupe, avec leur nombre.
  // Toucher un chevron y amène la caméra.
  const reperes = el('div', 'reperes');
  const repereEls = [];
  for (let i = 0; i < MAX_REPERES; i++) {
    const r = el('button', 'repere', `<span class="pointe">${icon('chevron')}</span><b class="n">0</b>`);
    r.type = 'button';
    r.dataset.cmd = 'repere';
    r.dataset.i = String(i);
    r.dataset.key = `repere-${i}`;
    r.hidden = true;
    reperes.append(r);
    repereEls.push({ el: r, pointe: r.querySelector('.pointe'), n: r.querySelector('.n'), x: NaN, y: NaN, a: NaN, count: -1 });
  }

  const toasts = el('div', 'toasts passif');
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');

  ui.append(ancres, reperes, voilePause, hud, dock, cta, battlebar, infoMode, toasts);

  // --- état d'affichage -------------------------------------------------------------------------
  let mode = 'titre';
  let prev = null; // valeurs précédentes (pour les « +8 » qui flottent)
  let trapIds = []; // identifiants des pièges affichés (on ne reconstruit que si la liste change)
  let trapEls = []; // [{ id, bar, anchor, etat, sx, sy }]
  let finie = false;

  function setMode(m) {
    mode = m;
    // fin de vague, défaite, victoire : la fenêtre suffit (les « /0 » d'un village en ruine troubleraient)
    hud.hidden = m === 'titre' || m === 'fin';
    dock.hidden = m !== 'prep';
    cta.hidden = m !== 'prep';
    battlebar.hidden = m !== 'bataille';
    ancres.hidden = m !== 'bataille';
    reperes.hidden = m !== 'bataille';
    if (m !== 'bataille') updateReperes(null, 0);
    const bataille = m === 'bataille';
    hud.classList.toggle('bataille', bataille);
    ennemis.hidden = vitesseBtn.hidden = pauseBtn.hidden = !bataille;
    chips.villageois.el.hidden = chips.soldats.el.hidden = chips.niveau.el.hidden = bataille;
    if (!bataille) { voilePause.hidden = true; setMoveArmed(false); }
    if (bataille) { restants = -1; finie = false; battlebar.classList.remove('finie'); ancres.classList.remove('finie'); }
    if (m === 'titre') prev = null;
  }

  function setText(node, txt) { if (node.textContent !== txt) node.textContent = txt; }

  /** Affiche un « +8 » / « −3 » qui flotte sous une puce. */
  function floatDelta(chip, delta) {
    if (reduceMotion()) return;
    const f = el('span', `flottant ${delta > 0 ? 'plus' : 'moins'}`, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
    chip.append(f);
    f.addEventListener('animationend', () => f.remove());
    chip.classList.remove('gagne', 'perdu');
    void chip.offsetWidth; // relance l'animation
    chip.classList.add(delta > 0 ? 'gagne' : 'perdu');
  }

  /**
   * Met à jour le bandeau et la barre du bas.
   * @param {object} v vue calculée par main.js
   */
  function update(v) {
    for (const r of RES) {
      const c = chips[r];
      setText(c.v, String(v.resources[r]));
      setText(c.cap, '/' + v.cap);
      c.el.classList.toggle('plein', v.resources[r] >= v.cap);
      c.el.setAttribute('aria-label', `${r} : ${v.resources[r]} sur ${v.cap}`);
      if (prev && prev.resources[r] !== v.resources[r]) floatDelta(c.el, v.resources[r] - prev.resources[r]);
    }
    setText(chips.villageois.v, String(v.free));
    setText(chips.villageois.cap, '/' + v.villagers);
    chips.villageois.el.setAttribute('aria-label', `Villageois : ${v.free} libres sur ${v.villagers}`);
    if (prev && prev.villagers !== v.villagers) floatDelta(chips.villageois.el, v.villagers - prev.villagers);
    setText(chips.soldats.v, String(v.soldiers));
    setText(chips.soldats.cap, '/' + v.soldierCap);
    chips.soldats.el.setAttribute('aria-label', `Soldats : ${v.soldiers} sur ${v.soldierCap} places`);
    if (prev && prev.soldiers !== v.soldiers) floatDelta(chips.soldats.el, v.soldiers - prev.soldiers);
    setText(chips.vague.v, `Vague ${Math.min(v.wave + (v.phase === 'battle' ? 0 : 1), v.wavesTotal)}`);
    setText(chips.vague.cap, '/' + v.wavesTotal);
    if (v.phase === 'battle') setText(chips.vague.v, `Vague ${v.battleWave}`);
    chips.vague.el.setAttribute('aria-label', `Vague ${v.wave + 1} sur ${v.wavesTotal}`);
    setText(chips.niveau.v, String(v.level));
    setText(chips.niveau.cap, '');
    chips.niveau.el.setAttribute('aria-label', `Royaume niveau ${v.level}`);
    // barre du bas
    setText(badge, String(v.actionsLeft));
    badge.classList.toggle('vide', v.actionsLeft === 0);
    tabEls.actions.setAttribute('aria-label', `Actions, ${v.actionsLeft} restante${v.actionsLeft > 1 ? 's' : ''}`);
    badgeTalent.hidden = !(v.talentPoints > 0);
    if (v.next) {
      setText(ctaB, `Lancer la vague ${v.next.numero}`);
      setText(ctaS, v.next.resume);
    }
    prev = { resources: { ...v.resources }, villagers: v.villagers, soldiers: v.soldiers };
  }

  let recouvert = false;
  let feuilleOuverte = null;
  /** Onglet surligné (panneau ouvert). */
  function setSheet(name) {
    feuilleOuverte = name;
    for (const id in tabEls) tabEls[id].setAttribute('aria-pressed', String(id === name));
    cta.hidden = mode !== 'prep' || !!name || recouvert;
    dock.hidden = mode !== 'prep' || recouvert;
  }
  /** Mode construction / drapeau : la barre de construction remplace la barre du bas. */
  function setCovered(on) {
    recouvert = !!on;
    setSheet(feuilleOuverte);
  }

  function setMoveArmed(on) {
    bouger.setAttribute('aria-pressed', String(!!on));
    infoMode.hidden = !on;
    if (on) infoMode.textContent = "Touchez une case : l’armée y va.";
  }
  function setPaused(on) {
    voilePause.hidden = !on;
    pauseBtn.innerHTML = icon(on ? 'lecture' : 'pause');
    pauseBtn.setAttribute('aria-label', on ? 'Reprendre' : 'Pause');
  }
  function setSpeed(n) {
    vitesseLbl.textContent = '×' + n;
    vitesseBtn.setAttribute('aria-label', `Vitesse ×${n} (toucher pour changer)`);
  }

  /** Reconstruit les boutons de pièges quand la liste change. */
  function buildTraps(traps) {
    pieges.innerHTML = '';
    ancres.innerHTML = '';
    trapEls = traps.map((t) => {
      const mkBtn = (cls) => {
        const b = el('button', `piege-btn ${cls}`, `${icon('piege')}<span class="num">${t.n}</span>`);
        b.type = 'button';
        b.dataset.cmd = 'piege';
        b.dataset.id = String(t.id);
        b.dataset.key = `${cls || 'piege'}-${t.id}`;
        b.setAttribute('aria-label', `Déclencher le piège ${t.n}`);
        return b;
      };
      const bar = mkBtn('');
      const anchor = mkBtn('ancre');
      pieges.append(bar);
      ancres.append(anchor);
      return { id: t.id, bar, anchor, etat: -1, sx: NaN, sy: NaN };
    });
    trapIds = traps.map((t) => t.id);
    aucun.hidden = traps.length > 0;
  }

  function memesPieges(traps, n) {
    if (n !== trapIds.length) return false;
    for (let i = 0; i < n; i++) if (traps[i].id !== trapIds[i]) return false;
    return true;
  }
  function majPiege(node, t) {
    node.style.setProperty('--p', t.ready ? '1' : t.progress.toFixed(3));
    node.classList.toggle('pret', t.ready);
    node.classList.toggle('charge', !t.ready);
    node.classList.toggle('cible', t.ready && t.targeted);
    node.setAttribute('aria-label', t.ready ? `Déclencher le piège ${t.n}` : `Piège ${t.n} : recharge`);
  }

  let restants = -1;
  /**
   * Mise à jour de la bataille, à chaque image (peu d'écritures DOM, aucune allocation si rien ne change).
   * @param {{ remaining:number, total:number, over:boolean, count:number,
   *   traps:{id:number,n:number,ready:boolean,progress:number,targeted:boolean,sx:number,sy:number,visible:boolean}[] }} b
   *   (seuls les `count` premiers pièges sont lus : le tableau est réutilisé d'une image à l'autre)
   */
  function updateBattle(b) {
    if (b.remaining !== restants) {
      restants = b.remaining;
      setText(ennemisV, String(b.remaining));
      setText(ennemisLbl, b.remaining > 1 ? 'restants' : 'restant');
      ennemis.setAttribute('aria-label', `Ennemis restants : ${b.remaining} sur ${b.total}`);
      ennemisBarre.style.width = `${b.total ? Math.round((1 - b.remaining / b.total) * 100) : 0}%`;
    }
    // bataille finie : plus de leviers (les pièges disparaissent pendant la bannière de fin)
    if (b.over !== finie) {
      finie = b.over;
      battlebar.classList.toggle('finie', finie);
      ancres.classList.toggle('finie', finie);
    }
    const n = b.count ?? b.traps.length;
    if (!memesPieges(b.traps, n)) buildTraps(b.traps.slice(0, n));
    for (let i = 0; i < n; i++) {
      const t = b.traps[i];
      const e = trapEls[i];
      const etat = (t.ready ? 1000 : 0) + (t.targeted ? 100 : 0) + Math.round(t.progress * 40);
      if (etat !== e.etat) {
        e.etat = etat;
        majPiege(e.bar, t);
        majPiege(e.anchor, t);
      }
      if (e.anchor.hidden !== !t.visible) e.anchor.hidden = !t.visible;
      if (t.visible) {
        const sx = Math.round(t.sx);
        const sy = Math.round(t.sy);
        if (sx !== e.sx || sy !== e.sy) {
          e.sx = sx;
          e.sy = sy;
          e.anchor.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
        }
      }
    }
  }

  /**
   * Chevrons des ennemis hors de l'écran (aucune allocation : seuls les `n` premiers sont lus).
   * @param {{x:number, y:number, angle:number, count:number}[]|null} list position au bord (px de la toile),
   *   direction du groupe (radians, 0 = vers la droite), nombre d'ennemis
   * @param {number} n
   */
  function updateReperes(list, n) {
    for (let i = 0; i < MAX_REPERES; i++) {
      const e = repereEls[i];
      const on = !!list && i < n;
      if (e.el.hidden !== !on) e.el.hidden = !on;
      if (!on) continue;
      const r = list[i];
      const x = Math.round(r.x);
      const y = Math.round(r.y);
      const a = Math.round(r.angle * 20) / 20;
      if (x !== e.x || y !== e.y) { e.x = x; e.y = y; e.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; }
      if (a !== e.a) { e.a = a; e.pointe.style.transform = `rotate(${a}rad) translateX(21px)`; }
      if (r.count !== e.count) {
        e.count = r.count;
        e.n.textContent = String(r.count);
        e.el.setAttribute('aria-label', `${r.count} ${r.count > 1 ? 'ennemis approchent' : 'ennemi approche'} hors de vue : y regarder`);
      }
    }
  }

  /** Petit message en haut de l'écran (2 au plus quand un panneau est ouvert en portrait). */
  function toast(text, kind = '', ic = 'info') {
    const t = el('div', `toast ${kind}`, `${icon(ic)}<span>${esc(text)}</span>`);
    toasts.prepend(t);
    let portrait = false;
    try { portrait = window.matchMedia('(orientation: portrait)').matches; } catch { /* rien */ }
    const max = feuilleOuverte && portrait ? 2 : 3;
    while (toasts.children.length > max) toasts.lastChild.remove();
    const dur = kind === 'nouveau' ? 3600 : 2600;
    setTimeout(() => {
      t.classList.add('sort');
      setTimeout(() => t.remove(), 320);
    }, dur);
  }

  /** Grande bannière au centre (début / fin de vague). */
  function banner(title, sub = '', kind = '') {
    const b = el('div', `banniere passif ${kind}`, `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`);
    ui.append(b);
    setTimeout(() => b.remove(), 2500);
  }

  setMode('titre');
  return {
    setMode, update, updateBattle, updateReperes, setSheet, setCovered, setMoveArmed, setPaused, setSpeed, toast, banner,
    get mode() { return mode; },
    els: { hud, dock, cta, battlebar, tabs: tabEls, bouger, pieges, chips },
    nb,
  };
}
