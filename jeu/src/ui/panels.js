// Panneaux de l'interface : feuilles du bas (Actions, Construire, Armée, Royaume, Bâtiment),
// barre de construction, fenêtres (bilan, défaite, victoire, confirmation, options, menu) et écran titre.
// Tout est du HTML simple ; les boutons portent data-cmd, lu par main.js (délégation d'événements).
import * as C from '../core/index.js';
import { icon, ICONE_ACTION } from './icons.js';
import { el, esc, nb, pluriel, swapHTML, typoHTML } from './dom.js';

const NOMS_RES = { bois: 'Bois', pierre: 'Pierre', nourriture: 'Nourriture' };
const RES_FEMININ = { bois: false, pierre: true, nourriture: true }; // « pierre produite »
const ORDRE_CATEGORIES = ['habitat', 'production', 'stockage', 'defense', 'militaire'];
// Prénoms des soldats (affichage seulement : on s'attache mieux à « Aubin » qu'au « soldat 7 »)
const PRENOMS = ['Aubin', 'Gaspard', 'Hugues', 'Thibaut', 'Mathurin', 'Bertrand', 'Josse', 'Guillaume', 'Renaud',
  'Enguerrand', 'Colin', 'Perrin', 'Arnaud', 'Gautier', 'Yvon', 'Lambert', 'Odon', 'Baudouin', 'Raoul', 'Tristan',
  'Anselme', 'Jehan', 'Mahaut', 'Isabeau', 'Clémence', 'Aliénor', 'Bérenger', 'Foulques', 'Ermengarde', 'Sancie'];
const PRENOMS_FEMININS = new Set(['Mahaut', 'Isabeau', 'Clémence', 'Aliénor', 'Ermengarde', 'Sancie']);
const PLURIEL_ENNEMI = { archer_ennemi: 'archers ennemis', chef_de_guerre: 'chefs de guerre', belier: 'béliers' };

/** Nom affiché d'un soldat (fixe pour un identifiant donné). */
export function prenom(id) {
  return PRENOMS[(id * 7 + 3) % PRENOMS.length];
}

/** Accord d'un mot avec le soldat : accordSoldat(id, 'tombé') → « tombée » pour Clémence. */
export function accordSoldat(id, mot, feminin = mot + 'e') {
  return PRENOMS_FEMININS.has(prenom(id)) ? feminin : mot;
}

/** Accord d'un participe avec un bâtiment : accordBatiment('hutte', 'construit') → « construite ». */
export function accordBatiment(type, mot) {
  return C.BATIMENTS[type]?.feminin ? mot + 'e' : mot;
}

/** Nom d'ennemi au singulier ou au pluriel, en minuscules. */
export function nomEnnemi(type, n) {
  const nom = C.ENNEMIS[type]?.nom.toLowerCase() || type;
  return n > 1 ? (PLURIEL_ENNEMI[type] || nom + 's') : nom;
}

/** Résumé d'une vague pour le bouton « Lancer » : « 11 ennemis · nouveau : archers ennemis ». */
export function resumeVague(index) {
  const p = C.wavePreview(index);
  if (!p) return null;
  const deja = new Set();
  for (let i = 0; i < index; i++) for (const g of C.VAGUES[i].groupes) deja.add(g.type);
  const nouveaux = p.groupes.filter((g) => !deja.has(g.type));
  let resume = p.groupes.length === 1 ? `${p.total} ${nomEnnemi(p.groupes[0].type, p.total)}` : `${p.total} ennemis`;
  if (index > 0 && nouveaux.length) resume += ` · nouveau : ${nouveaux.map((g) => nomEnnemi(g.type, g.count)).join(', ')}`;
  const detail = p.groupes.map((g) => `${g.count} ${nomEnnemi(g.type, g.count)}`).join(', ');
  return { numero: p.numero, total: p.total, resume, detail };
}

/** Puces de coût, en rouge pour ce qui manque. */
function coutHTML(state, cout) {
  const parts = C.RESSOURCES.filter((r) => cout?.[r] > 0).map((r) => {
    const manque = state && state.resources[r] < cout[r];
    return `<span class="cout${manque ? ' manque' : ''}">${cout[r]}${icon(r, 'ic-' + r)}</span>`;
  });
  return parts.length ? `<span class="couts">${parts.join('')}</span>` : '<span class="cout gratuit">Gratuit</span>';
}

/** Ligne de résumé d'un type de bâtiment (chiffres tirés de data.js, talents compris). */
function resumeBatiment(state, type) {
  const d = C.BATIMENTS[type];
  const def = C.defenseStats(state, type);
  const p = [];
  if (d.production) p.push(`${d.emplois} emplois × ${d.production.parOuvrier} ${d.production.res}`);
  if (d.logement) p.push(`Loge ${d.logement} habitants`);
  if (d.stockage) p.push(`Stockage +${d.stockage}`);
  if (d.soldats) p.push(`+${d.soldats} places de soldats`);
  if (def.tour) p.push(`Portée ${nb(def.tour.portee)} · ${nb(def.tour.degats)} dégâts`);
  if (def.piege) p.push(`${nb(def.piege.degats)} dégâts · sur la route`);
  if (d.bloqueRoute) p.push(`${C.buildingMaxHp(state, type)} PV · barre la route`);
  if (d.debloqueEquipement) p.push('Lances, boucliers, arcs');
  if (d.pres) p.push(`près ${d.pres.tuile === 'rock' ? 'd’un rocher' : 'd’une forêt'}`);
  return p.join(' · ');
}

function pourquoi(reason, verrou = false) {
  return reason ? `<span class="pourquoi">${icon(verrou ? 'cadenas' : 'info')}${esc(reason)}</span>` : '';
}
function off(ok, reason) {
  return ok ? '' : ` aria-disabled="true" data-why="${esc(reason || 'Impossible pour le moment.')}"`;
}

/**
 * Crée les panneaux.
 * @param {HTMLElement} ui calque d'interface
 * @param {{ get: () => {state:object|null, meta:object, options:object, storageOk:boolean, hasSave:boolean, saveInfo:string} }} opts
 */
export function createPanels(ui, { get }) {
  const feuille = el('section', 'feuille');
  feuille.hidden = true;
  feuille.setAttribute('role', 'dialog');
  feuille.setAttribute('aria-modal', 'false');
  const placebar = el('div', 'placebar');
  placebar.hidden = true;
  const titre = el('div', 'titre');
  titre.hidden = true;
  const voiles = el('div', 'voiles');
  voiles.style.display = 'contents';
  ui.append(placebar, titre, feuille, voiles);

  let sheet = null; // { name, id? }
  let talentChoisi = null;
  const vus = new Set(); // bâtiments déjà vus dans le menu (pour l'étiquette « Nouveau »)
  const fenetres = []; // pile : { kind, node, onYes, onNo }

  // ------------------------------------------------------------------ feuilles
  function tete(ic, titreTxt, sous) {
    return `<div class="feuille-tete">${icon(ic, 'ic-titre')}<div class="titres"><h2 id="feuille-titre">${esc(titreTxt)}</h2>${sous ? `<p>${sous}</p>` : ''}</div>
      <button class="btn btn-icone btn-sobre" type="button" data-cmd="fermer" data-key="fermer" aria-label="Fermer">${icon('fermer')}</button></div>`;
  }

  function htmlActions(s) {
    const cartes = C.actionList(s).map((a) => {
      const gain = a.gain ? C.RESSOURCES.filter((r) => a.gain[r]).map((r) => `<span class="cout">+${a.gain[r]}${icon(r, 'ic-' + r)}</span>`).join('') : '';
      return `<button type="button" class="carte-btn${a.unlocked ? '' : ' verrou'}" data-cmd="action" data-id="${a.id}" data-key="action-${a.id}"${off(a.ok, a.reason)}>
        <span class="pict">${icon(a.unlocked ? ICONE_ACTION[a.id] : 'cadenas')}</span>
        <span class="corps"><span class="nom">${esc(a.nom)}</span><span class="desc">${esc(a.description)}</span>${a.ok ? '' : pourquoi(a.reason, !a.unlocked)}</span>
        ${gain ? `<span class="gain">${gain}</span>` : ''}</button>`;
    }).join('');
    const sous = `<b>${s.actionsLeft}</b> sur ${s.actionsMax} restantes · elles reviennent après chaque vague`;
    return tete('actions', 'Actions', sous) + `<div class="feuille-corps" data-scroll="actions"><div class="liste">${cartes}</div></div>`;
  }

  function carteBatiment(s, o) {
    const nouveau = o.unlocked && !vus.has(o.type);
    return `<button type="button" class="carte-btn compact${o.unlocked ? '' : ' verrou'}${nouveau ? ' nouveau' : ''}" data-cmd="construire" data-type="${o.type}" data-key="bat-${o.type}"${off(o.ok, o.reason)}>
      <span class="haut"><span class="pict">${icon(o.unlocked ? o.type : 'cadenas')}</span><span class="nom">${esc(o.nom)}</span></span>
      <span class="desc">${esc(resumeBatiment(s, o.type))}</span>
      ${o.unlocked ? coutHTML(s, o.cout) : ''}
      ${o.ok ? '' : pourquoi(o.reason, !o.unlocked)}</button>`;
  }

  // Ce qu'on peut construire d'abord (par catégorie), puis ce qui reste à débloquer.
  function htmlConstruire(s) {
    const opts = C.buildOptions(s);
    const parCat = {};
    for (const o of opts) if (o.unlocked) (parCat[o.categorie] ||= []).push(o);
    let corps = '';
    for (const cat of ORDRE_CATEGORIES) {
      const liste = parCat[cat];
      if (!liste) continue;
      corps += `<div class="section">${esc(C.CATEGORIES[cat])}</div><div class="grille">${liste.map((o) => carteBatiment(s, o)).join('')}</div>`;
    }
    const verrous = opts.filter((o) => !o.unlocked);
    if (verrous.length) {
      corps += `<div class="section">À débloquer</div><div class="grille">${verrous.map((o) => carteBatiment(s, o)).join('')}</div>`;
    }
    return tete('construire', 'Construire', 'Choisissez un bâtiment, puis une case sur la carte.')
      + `<div class="feuille-corps" data-scroll="construire">${corps}</div>`;
  }

  function htmlBatiment(s, id) {
    const info = C.buildingInfo(s, id);
    if (!info) return null;
    const def = C.BATIMENTS[info.type];
    const sous = info.destroyed ? '<span style="color:var(--danger-clair)">En ruine</span>' : esc(C.CATEGORIES[info.categorie] || '');
    let c = '';
    if (def.ciblable !== false) {
      const ratio = info.destroyed ? 0 : info.hp / Math.max(1, info.maxHp);
      c += `<div class="bloc pv${ratio < 0.5 ? ' bas' : ''}">${icon('coeur')}<div class="barre"><i style="width:${Math.round(ratio * 100)}%"></i></div><b>${info.destroyed ? 0 : Math.ceil(info.hp)} / ${info.maxHp} PV</b></div>`;
    }
    c += `<p class="note" style="margin:10px 0 0">${esc(info.description)}</p>`;
    if (info.emplois && !info.destroyed) {
      const libres = C.freeVillagers(s);
      const pr = info.production;
      const places = Array.from({ length: info.emplois }, (_, i) => `<i class="${i < info.workers ? 'plein' : ''}"></i>`).join('');
      c += `<div class="section" style="margin-top:16px">Ouvriers</div>
        <div class="bloc"><div class="ouvriers">
          <button type="button" class="btn btn-icone" data-cmd="ouvrier" data-id="${id}" data-delta="-1" data-key="moins" aria-label="Retirer un ouvrier"${off(info.workers > 0, 'Personne ne travaille ici.')}>${icon('moins')}</button>
          <div class="compte"><b>${info.workers} / ${info.emplois}</b><span>${pluriel(libres, 'villageois libre', 'villageois libres')}</span><div class="places">${places}</div></div>
          <button type="button" class="btn btn-icone" data-cmd="ouvrier" data-id="${id}" data-delta="1" data-key="plus" aria-label="Ajouter un ouvrier"${off(info.workers < info.emplois && libres > 0, info.workers >= info.emplois ? `Plus de place : ${info.workers}/${info.emplois}.` : 'Aucun villageois libre.')}>${icon('plus')}</button>
        </div>
        <p class="note">${icon(pr.res, 'ic-' + pr.res)}Produit <b>${pr.actuelle} ${pr.res}</b> à chaque bilan${info.workers < info.emplois ? ` · ${pr.avecUnDePlus} avec un ouvrier de plus` : ''}.</p></div>`;
    }
    const lignes = [];
    if (info.tour) lignes.push(`${icon('cible')}<span class="lib">${info.type === 'maison_commune' ? 'Frondes des villageois' : 'Archer de la tour'}</span><span class="val">portée ${nb(info.tour.portee)} · ${nb(info.tour.degats)} dégâts / ${nb(info.tour.cadence)} s</span>`);
    if (info.piege) lignes.push(`${icon('piege')}<span class="lib">Pieux</span><span class="val">${nb(info.piege.degats)} dégâts · rayon ${nb(info.piege.rayon)} · recharge ${nb(info.piege.recharge)} s</span>`);
    if (info.logement) lignes.push(`${icon('maison')}<span class="lib">Logement</span><span class="val">${info.logement} habitants</span>`);
    if (info.stockage) lignes.push(`${icon('entrepot')}<span class="lib">Stockage</span><span class="val">+${info.stockage} par ressource</span>`);
    if (info.soldats) lignes.push(`${icon('soldat')}<span class="lib">Armée</span><span class="val">+${info.soldats} places</span>`);
    if (lignes.length && !info.destroyed) c += `<ul class="lignes" style="margin-top:10px">${lignes.map((l) => `<li>${l}</li>`).join('')}</ul>`;
    if (info.piege && !info.destroyed) c += `<p class="note">${icon('info')}Pendant la bataille, touchez le piège (ou son bouton) quand des ennemis passent dessus.</p>`;
    if (def.bloqueRoute && !info.destroyed) {
      c += info.bloqueRoute
        ? `<p class="note" style="color:var(--ok-clair)">${icon('valide')}Barre la route : les ennemis doivent la casser pour passer.</p>`
        : `<p class="note attention">${icon('info')}Posée hors de la route : elle ne bloque pas les ennemis.</p>`;
    }
    // boutons
    let pied = '';
    if (info.destroyed && info.reconstruire) {
      const r = info.reconstruire;
      pied += `<button type="button" class="btn btn-or" data-cmd="reconstruire" data-id="${id}" data-key="reconstruire"${off(r.ok, r.reason)}>${icon('construire')}<span class="multi">Reconstruire${coutHTML(s, r.cout)}</span></button>`;
      if (info.demolir.ok) pied += `<button type="button" class="btn" data-cmd="demolir" data-id="${id}" data-key="deblayer">${icon('demolir')}Déblayer</button>`;
    } else if (!def.unique) {
      const d = info.demolir;
      const rend = d.ok ? C.costText(d.remboursement) : '';
      pied += `<button type="button" class="btn" data-cmd="demolir" data-id="${id}" data-key="demolir"${off(d.ok, d.reason)}>${icon('demolir')}<span class="multi">Démolir<small>${d.ok ? (rend === 'gratuit' ? 'rien n’est rendu' : 'rend ' + esc(rend)) : esc(d.reason)}</small></span></button>`;
    }
    if (pied) c += `<div class="rangee" style="margin-top:14px">${pied}</div>`;
    return tete(info.type, info.nom, sous) + `<div class="feuille-corps" data-scroll="bat">${c}</div>`;
  }

  function htmlArmee(s) {
    const cap = C.soldierCapacity(s);
    const libres = C.freeVillagers(s);
    let c = '<div class="section">Recruter</div><div class="rangee">';
    for (const kind of ['fantassin', 'archer']) {
      const r = C.canRecruit(s, kind);
      const cout = C.recruitCost(s, kind);
      c += `<button type="button" class="btn${kind === 'fantassin' && r.ok ? ' btn-or' : ''}" data-cmd="recruter" data-kind="${kind}" data-key="recruter-${kind}"${off(r.ok, r.reason)}>${icon(kind === 'archer' ? 'chasseur' : 'soldat')}<span class="multi">${kind === 'archer' ? 'Archer' : 'Fantassin'}${coutHTML(s, cout)}</span></button>`;
    }
    const raisonRecrue = C.canRecruit(s, 'fantassin');
    const debCaserne = C.BATIMENTS.caserne.deblocage;
    const sansCaserne = raisonRecrue.code === 'verrou' && !s.unlocked.includes('caserne') && debCaserne.batiment;
    const texteRecrue = sansCaserne
      ? `Il faut une caserne : construisez d’abord une ${C.BATIMENTS[debCaserne.batiment].nom.toLowerCase()} pour la débloquer.`
      : raisonRecrue.reason;
    c += `</div><p class="note">${raisonRecrue.ok ? 'Un villageois libre devient soldat : il ne travaille plus.' : `${icon('info')}${esc(texteRecrue)}`}</p>`;
    // équiper tous
    const fantassins = s.soldiers.filter((x) => x.kind === 'fantassin');
    if (fantassins.length) {
      c += '<div class="section">Équiper tous les fantassins <span style="opacity:.6;letter-spacing:.04em;text-transform:none">· prix par soldat</span></div><div class="rangee serree">';
      for (const eq of C.EQUIPEMENTS.slice(1)) {
        const cibles = fantassins.filter((x) => x.equip < eq.tier);
        let r = cibles.length ? C.canEquip(s, cibles[0].id, eq.tier) : { ok: false, reason: 'Tous les fantassins l’ont déjà.' };
        if (!r.ok && r.code === 'cout' && cibles.length) r = { ok: false, reason: r.reason };
        c += `<button type="button" class="btn" data-cmd="equiper-tous" data-tier="${eq.tier}" data-key="eqt-${eq.tier}"${off(r.ok, r.reason)}><span class="multi">${esc(eq.nom)}${coutHTML(s, eq.cout)}</span></button>`;
      }
      c += '</div>';
    }
    // drapeau
    c += `<div class="section">Ralliement</div><div class="rangee"><button type="button" class="btn" data-cmd="drapeau" data-key="drapeau">${icon('drapeau')}Placer le drapeau</button></div>
      <p class="note">Les soldats se battent autour du drapeau, dans un rayon de ${nb(C.COMBAT.laisse)} cases. Derrière une palissade ou un mur, ils le tiennent sans le franchir.</p>`;
    // liste des soldats
    c += `<div class="section" style="margin-top:18px">Soldats (${s.soldiers.length}/${cap})</div>`;
    if (!s.soldiers.length) c += '<p class="note attention">Aucun soldat : seules les défenses protègent le village.</p>';
    c += '<div class="soldats">';
    const atelier = C.hasBuilding(s, 'atelier');
    for (const so of s.soldiers) {
      const st = C.soldierStats(s, so);
      const archer = so.kind === 'archer';
      const tr = Array.from({ length: C.REGLES.entrainementMax }, (_, i) => `<i class="${i < so.training ? 'ok' : ''}"></i>`).join('');
      let boutons = '';
      if (!archer && so.equip < 3) {
        const t = so.equip + 1;
        const eq = C.EQUIPEMENTS[t];
        const r = C.canEquip(s, so.id, t);
        boutons += `<button type="button" class="btn" data-cmd="equiper" data-id="${so.id}" data-tier="${t}" data-key="eq-${so.id}"${off(r.ok, r.reason)}><span class="multi">${esc(eq.nom)}${coutHTML(s, eq.cout)}</span></button>`;
      }
      if (!archer && atelier) {
        const ok = C.canAfford(s, C.TYPES_SOLDATS.archer.cout);
        boutons += `<button type="button" class="btn" data-cmd="archer" data-id="${so.id}" data-key="ar-${so.id}" aria-label="Former ${esc(prenom(so.id))} à l’arc" title="Former un archer"${off(ok, C.missingText(s, C.TYPES_SOLDATS.archer.cout))}><span class="multi">Archer${coutHTML(s, C.TYPES_SOLDATS.archer.cout)}</span></button>`;
      }
      c += `<div class="soldat"><span class="pict">${icon(archer ? 'chasseur' : 'soldat')}</span>
        <div class="info"><div class="nom">${esc(prenom(so.id))}</div>
        <div class="det"><span>${archer ? 'Archer' : esc(st.equipNom)}</span><span>${st.maxHp} PV · ${nb(st.dmg)} dég.</span><span class="entrainement" title="Entraînement ${so.training}/${C.REGLES.entrainementMax}">${tr}</span></div></div>
        ${boutons ? `<div class="actions-s">${boutons}</div>` : ''}</div>`;
    }
    c += '</div>';
    if (s.soldiers.length) c += `<p class="note">Entraîner l’armée se fait avec une action (+${Math.round(C.REGLES.entrainementDegats * 100)} % de dégâts, +${C.REGLES.entrainementPv} PV par niveau).</p>`;
    const sous = `${s.soldiers.length}/${cap} soldats · ${pluriel(libres, 'villageois libre', 'villageois libres')}`;
    return tete('armee', 'Armée', sous) + `<div class="feuille-corps" data-scroll="armee">${c}</div>`;
  }

  function htmlRoyaume(meta, s) {
    const lp = C.levelProgress(meta);
    const blocNiveau = `<div class="bloc xp"><div class="niv">${meta.level}</div><div class="det"><b>Niveau ${meta.level}</b>
      <div class="barre"><i style="width:${Math.round(lp.ratio * 100)}%"></i></div>
      <span>${lp.xpInLevel} / ${lp.xpNeeded} XP vers le niveau ${meta.level + 1}</span></div></div>`;
    // Des points à dépenser : les talents d'abord, le niveau ensuite.
    const talentsDabord = meta.talentPoints > 0;
    let c = talentsDabord ? '' : blocNiveau;
    c += `<div class="section"${talentsDabord ? '' : ' style="margin-top:16px"'}>Talents · ${pluriel(meta.talentPoints, 'point', 'points')}</div>`;
    const tree = C.talentTree(meta);
    const tous = tree.flatMap((b) => b.talents);
    if (!talentChoisi || !C.TALENTS[talentChoisi]) talentChoisi = (tous.find((t) => t.available) || tous.find((t) => !t.owned) || tous[0]).id;
    c += '<div class="talents">';
    for (const br of tree) {
      c += `<div class="branche"><h3>${esc(br.nom)}</h3>`;
      for (const t of br.talents) {
        const cls = t.owned ? 'acquis' : t.available ? 'dispo' : '';
        const etat = t.owned ? `${icon('valide')}Acquis` : t.available ? `${icon('plus')}Disponible` : t.requiert && !meta.talents.includes(t.requiert) ? `${icon('cadenas')}Verrouillé` : `${t.cout} point`;
        c += `<button type="button" class="talent ${cls}${t.id === talentChoisi ? ' choisi' : ''}" data-cmd="talent-voir" data-id="${t.id}" data-key="tal-${t.id}" aria-pressed="${t.id === talentChoisi}"><span class="t-nom">${esc(t.nom)}</span><span class="t-etat">${etat}</span></button>`;
      }
      c += '</div>';
    }
    c += '</div>';
    const t = tous.find((x) => x.id === talentChoisi);
    if (t) {
      const req = t.requiert ? `<p class="note">Demande d’abord : ${esc(C.TALENTS[t.requiert].nom)}.</p>` : '';
      const btn = t.owned ? `<div class="note" style="color:var(--or-clair)">${icon('valide')}Talent acquis : il s'applique à toutes vos parties.</div>`
        : `<button type="button" class="btn btn-or" data-cmd="talent" data-id="${t.id}" data-key="talent-acheter"${off(t.available, t.reason)}>${icon('etoile')}Apprendre · ${pluriel(t.cout, 'point', 'points')}</button>`;
      c += `<div class="bloc talent-detail"><h4>${esc(t.nom)}</h4><p>${esc(t.description)}</p>${req}${btn}</div>`;
    }
    c += '<p class="note">Chaque niveau du royaume donne 1 point. Un talent s’applique tout de suite et aux parties suivantes.</p>';
    if (talentsDabord) c += `<div style="margin-top:14px">${blocNiveau}</div>`;
    // missions
    c += '<div class="section">Missions</div><div class="missions">';
    for (const m of C.missionList(meta, s)) {
      const faite = m.doneEver;
      c += `<div class="mission${faite ? ' faite' : ''}"><span class="coche">${icon('valide')}</span><div><div class="m-nom">${esc(m.nom)}</div><div class="m-rec">${faite ? 'Accomplie · ' : ''}${esc(m.recompenseTexte)}</div></div></div>`;
    }
    c += '</div>';
    const res = C.RESSOURCES.filter((r) => meta.reserves[r] > 0);
    c += `<div class="section" style="margin-top:18px">Réserves</div><p class="note">${res.length
      ? `Chaque nouvelle partie commence avec ${res.map((r) => `<b>+${meta.reserves[r]} ${r}</b>`).join(', ')}.`
      : 'Accomplissez des missions pour garder des ressources d’une partie à l’autre.'}</p>`;
    c += `<p class="note">Meilleure vague : ${meta.bestWave} · Chapitres gagnés : ${meta.chaptersWon.length}</p>`;
    const sous = `Niveau ${meta.level} · ${pluriel(meta.talentPoints, 'point de talent', 'points de talent')}`;
    return tete('royaume', 'Royaume', sous) + `<div class="feuille-corps" data-scroll="royaume">${c}</div>`;
  }

  /** Redessine la feuille ouverte (appelé après chaque changement d'état). */
  function render() {
    if (!sheet) return;
    const { state, meta } = get();
    let html = null;
    if (sheet.name === 'royaume') html = htmlRoyaume(meta, state);
    else if (!state) html = null;
    else if (sheet.name === 'actions') html = htmlActions(state);
    else if (sheet.name === 'construire') html = htmlConstruire(state);
    else if (sheet.name === 'armee') html = htmlArmee(state);
    else if (sheet.name === 'batiment') html = htmlBatiment(state, sheet.id);
    if (html === null) { closeSheet(); return; }
    const same = feuille.dataset.nom === sheet.name + (sheet.id || '');
    swapHTML(feuille, html);
    feuille.setAttribute('aria-labelledby', 'feuille-titre');
    if (!same) {
      feuille.dataset.nom = sheet.name + (sheet.id || '');
      const corps = feuille.querySelector('.feuille-corps');
      if (corps) corps.scrollTop = 0;
    }
  }

  function openSheet(name, id = null) {
    const was = sheet && sheet.name;
    sheet = { name, id };
    feuille.hidden = false;
    if (was !== name) {
      feuille.style.animation = 'none';
      void feuille.offsetWidth;
      feuille.style.animation = '';
    }
    render();
  }
  function closeSheet() {
    if (sheet && sheet.name === 'construire') {
      const { state } = get();
      if (state) for (const t of state.unlocked) vus.add(t);
    }
    sheet = null;
    feuille.hidden = true;
    feuille.dataset.nom = '';
  }

  // ------------------------------------------------------------------ barre de construction
  function showPlacebar(p) {
    const d = C.BATIMENTS[p.type];
    const { state } = get();
    const etat = p.x < 0 ? `<div class="etat">${icon('info')}Touchez une case dorée sur la carte.</div>`
      : p.ok && p.warn ? `<div class="etat attention">${icon('info')}${esc(p.warn)}</div>`
      : p.ok ? `<div class="etat ok">${icon('valide')}Bon emplacement.</div>`
        : `<div class="etat non">${icon('info')}${esc(p.reason)}</div>`;
    // Emplacement permis mais inutile (tour loin de la route…) : le bouton n'est plus doré.
    const inutile = p.ok && p.warn && p.warnFort;
    placebar.innerHTML = typoHTML(`<div class="ligne"><span class="pict">${icon(p.type)}</span><div class="titres"><b>${esc(d.nom)}</b>${etat}</div>${coutHTML(state, d.cout)}</div>
      <div class="boutons"><button type="button" class="btn" data-cmd="construire-annuler" data-key="annuler">Annuler</button>
      <button type="button" class="btn${inutile ? ' btn-attention' : ' btn-or'}" data-cmd="construire-ici" data-key="construire-ici"${off(p.ok, p.x < 0 ? 'Choisissez d’abord une case.' : p.reason)}>${icon('construire')}${inutile ? 'Construire quand même' : 'Construire ici'}</button></div>`);
    placebar.hidden = false;
  }
  function showRallybar() {
    placebar.innerHTML = typoHTML(`<div class="ligne"><span class="pict">${icon('drapeau')}</span><div class="titres"><b>Drapeau de ralliement</b><div class="etat">${icon('info')}Touchez une case : l’armée s’y postera.</div></div></div>
      <div class="boutons"><button type="button" class="btn" data-cmd="drapeau-fin" data-key="annuler">Terminé</button></div>`);
    placebar.hidden = false;
  }
  function hidePlacebar() { placebar.hidden = true; placebar.innerHTML = ''; }

  // ------------------------------------------------------------------ fenêtres
  function openModal(kind, html, { onYes = null, onNo = null, cls = '', closable = true } = {}) {
    const v = el('div', 'voile');
    v.innerHTML = typoHTML(`<div class="fenetre ${cls}" role="dialog" aria-modal="true" aria-labelledby="fen-${fenetres.length}">${closable ? `<button type="button" class="btn btn-icone fermer" data-cmd="modal-non" aria-label="Fermer">${icon('fermer')}</button>` : ''}${html.replace('<h2>', `<h2 id="fen-${fenetres.length}">`)}</div>`);
    voiles.append(v);
    fenetres.push({ kind, node: v, onYes, onNo, closable, focusBefore: document.activeElement });
    const first = v.querySelector('.fenetre-pied .btn-or, .fenetre-pied .btn-danger, .fenetre-pied .btn, .btn');
    if (first) first.focus({ preventScroll: true });
    return v;
  }
  function closeModal(answer = false) {
    const f = fenetres.pop();
    if (!f) return;
    f.node.remove();
    if (f.focusBefore && document.contains(f.focusBefore)) f.focusBefore.focus({ preventScroll: true });
    const fn = answer ? f.onYes : f.onNo;
    if (fn) fn();
  }
  function closeAllModals() {
    while (fenetres.length) fenetres.pop().node.remove();
  }
  function topModal() { return fenetres[fenetres.length - 1] || null; }

  /** Confirmation dans la page (jamais de confirm() du navigateur). */
  function confirmer({ titre: t, texte, oui = 'Confirmer', non = 'Annuler', danger = false, ic = 'info' }, onYes, onNo = null) {
    return openModal('confirm', `<div class="fenetre-corps"><div class="embleme${danger ? ' rouge' : ''}">${icon(ic)}</div><h2>${esc(t)}</h2><p class="sous">${texte}</p></div>
      <div class="fenetre-pied"><div class="rangee"><button type="button" class="btn" data-cmd="modal-non">${esc(non)}</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-or'}" data-cmd="modal-oui">${esc(oui)}</button></div></div>`, { onYes, onNo });
  }

  function lignesRapport(r) {
    let h = '';
    for (const res of C.RESSOURCES) {
      const p = r.production[res];
      if (!p || (!p.produced && !p.lost)) continue;
      const perte = p.lost ? ` <span class="perte">· ${p.lost} perdu${p.lost > 1 ? 's' : ''} (stock plein)</span>` : '';
      h += `<li>${icon(res, 'ic-' + res)}<span class="lib">${NOMS_RES[res]} produit${RES_FEMININ[res] ? 'e' : ''}${perte}</span><span class="val plus">+${p.gained}</span></li>`;
    }
    if (!C.RESSOURCES.some((res) => r.production[res]?.produced)) h += `<li>${icon('info')}<span class="lib">Aucune production : placez des villageois dans vos bâtiments.</span></li>`;
    h += `<li>${icon('nourriture', 'ic-nourriture')}<span class="lib">Repas du village${r.food.missing ? ` <span class="perte" style="color:var(--danger-clair)">· il manquait ${r.food.missing}</span>` : ''}</span><span class="val moins">−${r.food.eaten}</span></li>`;
    const pop = r.population;
    const det = [];
    if (pop.born) det.push(`+${pop.born} naissance${pop.born > 1 ? 's' : ''}`);
    if (pop.left) det.push(`${pop.left} parti${pop.left > 1 ? 's' : ''}`);
    if (pop.deserted) det.push(`${pop.deserted} déserteur${pop.deserted > 1 ? 's' : ''}`);
    h += `<li>${icon('villageois', 'ic-villageois')}<span class="lib">Population${det.length ? ` <span class="perte">· ${det.join(', ')}</span>` : ''}</span><span class="val">${pop.before} → ${pop.after}</span></li>`;
    if (r.repaired) h += `<li>${icon('construire')}<span class="lib">Bâtiments réparés gratuitement</span><span class="val">${r.repaired}</span></li>`;
    return `<ul class="lignes">${h}</ul>`;
  }

  /** ou : où dépenser les points depuis cet écran (bilan : l'onglet du bas ; fin de partie : le bouton). */
  function blocXp(r, meta, ou = 'onglet Royaume') {
    if (!r.xp) return '';
    const lp = C.levelProgress(meta);
    let h = `<div class="section" style="margin-top:16px">Royaume</div><div class="bloc xp"><div class="niv">${meta.level}</div><div class="det"><b>+${r.xp.gained} XP</b>
      <div class="barre"><i style="width:${Math.round(lp.ratio * 100)}%"></i></div><span>${lp.xpInLevel} / ${lp.xpNeeded} XP vers le niveau ${meta.level + 1}</span></div></div>`;
    if (r.xp.levelUp) h += `<div class="niveau-sup">${icon('hausse')}Niveau ${r.xp.level} ! +${pluriel(r.xp.levelsGained * C.META.pointsParNiveau, 'point', 'points')} de talent (${ou})</div>`;
    return h;
  }

  function blocMissions(r) {
    if (!r.missions?.length) return '';
    return `<div class="section" style="margin-top:16px">Missions accomplies</div><div class="missions">${r.missions.map((m) => `<div class="mission faite"><span class="coche">${icon('valide')}</span><div><div class="m-nom">${esc(m.nom)}</div><div class="m-rec">${m.rewarded ? esc(m.recompenseTexte) : 'Déjà récompensée'}</div></div></div>`).join('')}</div>`;
  }

  function statsCombat(r) {
    return `<div class="stats"><div class="stat bon"><div class="v">${icon('crane')}${r.kills}</div><div class="l">${r.kills > 1 ? 'ennemis tués' : 'ennemi tué'}</div></div>
      <div class="stat${r.soldiersLost ? ' mauvais' : ''}"><div class="v">${icon('soldat')}${r.soldiersLost}</div><div class="l">${r.soldiersLost > 1 ? 'soldats perdus' : 'soldat perdu'}</div></div>
      <div class="stat${r.buildingsLost ? ' mauvais' : ''}"><div class="v">${icon('maison')}${r.buildingsLost}</div><div class="l">${r.buildingsLost > 1 ? 'bâtiments détruits' : 'bâtiment détruit'}</div></div></div>`;
  }

  /** Bilan après une vague gagnée. */
  function openReport(r, meta, state) {
    const suivante = resumeVague(state.wave);
    // « retirés » est déjà dans le sous-titre, « Stock … plein » déjà sur la ligne de production
    const msgs = (r.messages || []).filter((m) => !/retirés/.test(m) && !/^Stock de .* plein/.test(m)).map((m) => `<p class="note">${icon('info')}${esc(m)}</p>`).join('');
    const nouveaux = r.unlocked?.length ? `<div class="section" style="margin-top:16px">Nouveau</div><p class="note" style="color:var(--or-clair)">${icon('etoile')}${r.unlocked.map((u) => esc(u.nom)).join(', ')}</p>` : '';
    const html = `<div class="fenetre-corps apparait"><div class="entete"><div class="embleme">${icon('trophee')}</div><h2>Vague ${r.wave} repoussée</h2>
      <p class="sous">${r.retreated ? 'Les derniers ennemis se sont retirés.' : r.soldiersLost || r.buildingsLost ? 'Le village tient, mais il a souffert.' : 'Le village tient bon.'}</p>
      ${statsCombat(r)}</div>
      <div><div class="section" style="margin-top:16px">Bilan du cycle</div>${lignesRapport(r)}${msgs}</div>
      <div>${blocXp(r, meta)}${blocMissions(r)}${nouveaux}</div></div>
      <div class="fenetre-pied">${suivante ? `<p class="note" style="margin:0 0 2px;text-align:center">Prochaine vague : ${esc(suivante.detail)}</p>` : ''}
      <button type="button" class="btn btn-or btn-large" data-cmd="continuer" data-key="continuer"><span class="multi" style="align-items:center">Continuer<small>préparer la vague ${r.wave + 1}</small></span>${icon('fleche')}</button></div>`;
    return openModal('bilan', html, { cls: 'bilan large', closable: false });
  }

  /** Bouton « Royaume » des écrans de fin : les talents se dépensent tout de suite, pour la partie suivante. */
  function boutonRoyaume(meta) {
    const pts = meta.talentPoints;
    return `<button type="button" class="btn${pts ? ' btn-attention' : ''}" data-cmd="fin-royaume" data-key="fin-royaume">${icon('etoile', 'ic-or')}<span class="multi">Royaume<small>${pts ? pluriel(pts, 'point', 'points') : `niveau ${meta.level}`}</small></span></button>`;
  }
  const OU_FIN = 'bouton « Royaume » ci-dessous';

  /** Écran de défaite. */
  function openDefeat(r, meta) {
    const html = `<div class="fenetre-corps apparait"><div class="entete"><div class="embleme rouge">${icon('crane')}</div><h2>Le village est tombé</h2>
      <p class="sous">Vague ${r.wave} sur ${r.wavesTotal}. Le royaume garde son expérience.</p>${statsCombat(r)}</div>
      <div>${blocXp(r, meta, OU_FIN)}</div>
      <div><div class="section" style="margin-top:16px">Et maintenant ?</div><p class="note">Le niveau du royaume, ses talents et ses réserves servent à la prochaine partie. Courage !</p></div></div>
      <div class="fenetre-pied"><button type="button" class="btn btn-or btn-large" data-cmd="recommencer" data-key="recommencer">Recommencer le chapitre</button>
      <div class="rangee">${boutonRoyaume(meta)}<button type="button" class="btn" data-cmd="titre" data-key="vers-titre">Écran titre</button></div></div>`;
    return openModal('defaite', html, { cls: 'defaite large', closable: false });
  }

  /** Écran de victoire du chapitre. */
  function openVictory(r, meta, state) {
    const st = state.stats;
    const pop = C.population(state);
    const debout = state.buildings.filter((b) => !b.destroyed).length;
    const html = `<div class="fenetre-corps apparait"><div class="entete"><div class="embleme">${icon('royaume')}</div><h2>Le royaume tient bon !</h2>
      <p class="sous">Les ${r.wavesTotal} vagues du chapitre 1 sont repoussées.</p>
      <div class="stats"><div class="stat bon"><div class="v">${icon('crane')}${st.kills}</div><div class="l">${st.kills > 1 ? 'ennemis tués' : 'ennemi tué'}</div></div>
      <div class="stat"><div class="v">${icon('villageois')}${pop}</div><div class="l">${pop > 1 ? 'habitants' : 'habitant'}</div></div>
      <div class="stat"><div class="v">${icon('maison')}${debout}</div><div class="l">${debout > 1 ? 'bâtiments debout' : 'bâtiment debout'}</div></div></div></div>
      <div>${blocXp(r, meta, OU_FIN)}<p class="note">Soldats perdus pendant le chapitre : ${st.soldiersLost} · bâtiments perdus : ${st.buildingsLost}.</p></div>
      <div>${blocMissions(r)}</div></div>
      <div class="fenetre-pied"><button type="button" class="btn btn-or btn-large" data-cmd="recommencer" data-key="rejouer">Rejouer le chapitre</button>
      <div class="rangee">${boutonRoyaume(meta)}<button type="button" class="btn" data-cmd="titre" data-key="vers-titre">Écran titre</button></div></div>`;
    return openModal('victoire', html, { cls: 'bilan large', closable: false });
  }

  /** Options : qualité, conseils, sauvegarde. */
  function openOptions() {
    const v = openModal('options', '<div class="contenu-options"></div>', { cls: '' });
    renderOptions();
    return v;
  }
  function renderOptions() {
    const f = fenetres.find((x) => x.kind === 'options');
    if (!f) return;
    const { options, storageOk, hasSave } = get();
    const q = options.qualite;
    const box = f.node.querySelector('.contenu-options');
    // le titre garde l'identifiant annoncé par la fenêtre (lecteurs d'écran) ; data-scroll garde le défilement
    const lid = f.node.querySelector('.fenetre').getAttribute('aria-labelledby');
    // titre hors de la zone qui défile : le contenu ne passe jamais sous la croix de fermeture
    swapHTML(box, `<div class="fenetre-tete"><h2 id="${lid}">Options</h2></div>
      <div class="fenetre-corps" data-scroll="options"><div class="option"><div class="lib"><b>Qualité graphique</b><span>Économie : sans ombres, plus fluide et moins gourmand.</span></div>
        <div class="segment" role="group" aria-label="Qualité"><button type="button" data-cmd="qualite" data-q="normale" data-key="q-normale" aria-pressed="${q === 'normale'}">Normale</button><button type="button" data-cmd="qualite" data-q="economie" data-key="q-economie" aria-pressed="${q === 'economie'}">Économie</button></div></div>
      <div class="option"><div class="lib"><b>Conseils</b><span>Petites aides pendant les premières vagues.</span></div>
        <button type="button" class="interrupteur" role="switch" data-cmd="conseils" data-key="conseils" aria-checked="${!!options.conseils}" aria-label="Conseils"></button></div>
      <div class="option"><div class="lib"><b>Revoir les conseils</b><span>Les conseils déjà fermés reviennent.</span></div>
        <button type="button" class="btn" data-cmd="conseils-revoir" data-key="conseils-revoir">Revoir</button></div>
      <div class="section" style="margin-top:16px">Sauvegarde</div>
      <p class="note${storageOk ? '' : ' attention'}">${storageOk ? `${icon('valide')}La partie est sauvegardée automatiquement sur cet appareil.` : `${icon('info')}Sauvegarde indisponible sur cet appareil : la partie sera perdue en fermant la page.`}</p>
      <div class="rangee" style="margin-top:10px"><button type="button" class="btn btn-danger" data-cmd="effacer-partie" data-key="effacer-partie"${off(hasSave, 'Aucune partie en cours.')}>${icon('demolir')}Effacer la partie</button>
      <button type="button" class="btn" data-cmd="effacer-tout" data-key="effacer-tout">Tout effacer</button></div>
      <p class="note">« Tout effacer » remet aussi le royaume à zéro (niveau, talents, missions, réserves).</p></div>
      <div class="fenetre-pied"><button type="button" class="btn btn-or" data-cmd="modal-non" data-key="opt-fermer">Fermer</button></div>`);
  }

  /** Menu de pause en jeu. */
  function openMenu(enBataille) {
    return openModal('menu', `<div class="fenetre-corps"><div class="embleme">${icon('royaume')}</div><h2>Menu</h2>
      <p class="sous">${enBataille ? 'La bataille est en pause.' : 'La partie est sauvegardée automatiquement.'}</p></div>
      <div class="fenetre-pied"><button type="button" class="btn btn-or btn-large" data-cmd="modal-non" data-key="reprendre">${icon('lecture')}Reprendre</button>
      <div class="rangee"><button type="button" class="btn" data-cmd="options" data-key="m-options">${icon('reglages')}Options</button>
      <button type="button" class="btn" data-cmd="titre" data-key="m-titre">${icon('maison')}Écran titre</button></div></div>`);
  }

  // ------------------------------------------------------------------ écran titre
  function showTitle() {
    const { hasSave, saveInfo, meta } = get();
    titre.innerHTML = typoHTML(`<div class="logo"><div class="ornement">${icon('royaume')}</div><h1>Projet Royaume</h1><div class="chap">Chapitre 1 · ${esc(C.CHAPITRES[1].nom)}</div></div>
      <div class="menu-titre">
        ${hasSave ? `<button type="button" class="btn btn-or" data-cmd="continuer-partie" data-key="t-continuer"><span class="multi">Continuer<small>${esc(saveInfo)}</small></span></button>` : ''}
        <button type="button" class="btn${hasSave ? '' : ' btn-or'}" data-cmd="nouvelle-partie" data-key="t-nouvelle">Nouvelle partie</button>
        <div class="rangee"><button type="button" class="btn" data-cmd="titre-royaume" data-key="t-royaume">${icon('etoile', 'ic-or')}<span class="multi">Royaume<small>niveau ${meta.level}${meta.talentPoints ? ` · ${pluriel(meta.talentPoints, 'point', 'points')}` : ''}</small></span></button>
        <button type="button" class="btn" data-cmd="options" data-key="t-options">${icon('reglages')}Options</button></div>
        <div class="pied">Sans publicité, sans achat : juste le jeu.</div>
      </div>`);
    titre.hidden = false;
  }
  function hideTitle() { titre.hidden = true; }

  return {
    openSheet, closeSheet, render,
    get sheet() { return sheet ? sheet.name : null; },
    get sheetId() { return sheet ? sheet.id : null; },
    selectTalent(id) {
      talentChoisi = id;
      render();
      // la fiche du talent (et « Apprendre ») est sous la grille : on la fait venir dans la vue
      const corps = feuille.querySelector('.feuille-corps');
      const det = feuille.querySelector('.talent-detail');
      if (!corps || !det) return;
      const rc = corps.getBoundingClientRect();
      const rd = det.getBoundingClientRect();
      const delta = rd.bottom + 8 - rc.bottom;
      const haut = rd.top - 8 - rc.top;
      const dy = delta > 0 ? Math.min(delta, haut) : haut < 0 ? haut : 0;
      // défilement immédiat : la feuille est redessinée juste après (la position est gardée)
      if (dy) corps.scrollTop += dy;
    },
    markSeen(types) { vus.clear(); for (const t of types) vus.add(t); },
    showPlacebar, showRallybar, hidePlacebar,
    openModal, closeModal, closeAllModals, topModal, confirmer,
    openReport, openDefeat, openVictory, openOptions, renderOptions, openMenu,
    showTitle, hideTitle,
    els: { feuille, placebar, titre },
  };
}
