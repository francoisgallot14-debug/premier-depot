// =====================================================================
//  Projet Royaume — données d'équilibrage (chapitre 1)
//  TOUS les chiffres réglables du jeu sont ici. Le reste du code ne fait
//  que lire ces tableaux : changer une valeur ici change le jeu partout.
//  Après une modification, lancer « npm test » puis « npm run balance ».
// =====================================================================

// ---------------------------------------------------------------------
//  Carte
// ---------------------------------------------------------------------
export const MAP_W = 22; // largeur de la carte, en tuiles
export const MAP_H = 22; // hauteur de la carte, en tuiles
export const TILE = 2;   // taille d'une tuile, en unités 3D

// Chapitres (un seul pour l'instant)
export const CHAPITRES = {
  1: {
    nom: 'Le Val des Ormes',  // nom affiché du chapitre
    vagues: 10,                // nombre de vagues à repousser pour gagner
  },
};

// ---------------------------------------------------------------------
//  Ressources
// ---------------------------------------------------------------------
export const RESSOURCES = ['bois', 'pierre', 'nourriture'];

export const NOMS_RESSOURCES = {
  bois: 'bois',
  pierre: 'pierre',
  nourriture: 'nourriture',
};

// ---------------------------------------------------------------------
//  Début de partie (chapitre 1)
// ---------------------------------------------------------------------
export const DEPART = {
  ressources: { bois: 30, pierre: 10, nourriture: 30 }, // stock de départ (+ réserves du royaume, plafonné)
  villageois: 5,                                          // villageois au départ
  soldats: [                                              // petite armée mal équipée (à mains nues)
    { kind: 'fantassin', equip: 0 },
    { kind: 'fantassin', equip: 0 },
    { kind: 'fantassin', equip: 0 },
  ],
  actions: 5,                                             // actions par cycle
  debloques: ['hutte', 'bucheron', 'chasseur', 'palissade', 'piege'], // bâtiments disponibles dès le début
  graine: 1,                                              // graine aléatoire par défaut (l'interface en fournit une)
};

// ---------------------------------------------------------------------
//  Règles générales de la phase de préparation et du bilan
// ---------------------------------------------------------------------
export const REGLES = {
  remboursementDemolition: 0.5, // part du coût rendue quand on démolit (arrondi vers le bas)
  stockageMinimum: 60,          // même sans Maison commune, on peut entasser un peu : évite tout blocage (60 = son bois de reconstruction)
  departsSansToit: 1,           // villageois sans toit (logement détruit) qui quittent le village à chaque bilan
  mangeParVillageois: 1,        // nourriture mangée par villageois à chaque bilan
  mangeParSoldat: 1,            // nourriture mangée par soldat à chaque bilan
  manqueParDepart: 5,           // 1 habitant part par tranche de 5 nourriture manquante (minimum 1)
  croissanceParCycle: 1,        // nouveaux villageois par bilan (s'il y a de la place et à manger)
  nourritureMinCroissance: 10,  // nourriture qu'il doit rester après le repas pour que le village grandisse
  coutRecrue: { nourriture: 10 }, // coût d'une recrue (un villageois devient fantassin)
  entrainementMax: 3,           // niveau d'entraînement maximum
  entrainementDegats: 0.10,     // +10 % de dégâts par niveau d'entraînement
  entrainementPv: 5,            // +5 PV max par niveau d'entraînement
  journalMax: 40,               // nombre de lignes gardées dans l'historique
};

// ---------------------------------------------------------------------
//  Actions manuelles (1 action chacune)
// ---------------------------------------------------------------------
export const ORDRE_ACTIONS = ['couper_bois', 'tailler_pierre', 'chasser', 'entrainer', 'explorer'];

export const ACTIONS = {
  couper_bois: {
    nom: 'Couper du bois',
    description: 'Les villageois vont couper du bois à la main.',
    gain: { bois: 8 },          // ressources gagnées
    deblocage: { depart: true },
  },
  tailler_pierre: {
    nom: 'Tailler la pierre',
    description: 'On taille quelques blocs dans les rochers.',
    gain: { pierre: 5 },
    deblocage: { depart: true },
  },
  chasser: {
    nom: 'Chasser',
    description: 'Une partie de chasse dans les bois.',
    gain: { nourriture: 6 },
    deblocage: { depart: true },
  },
  entrainer: {
    nom: "Entraîner l’armée",
    description: "Tous les soldats gagnent 1 niveau d’entraînement (max 3) : +10 % de dégâts et +5 PV par niveau.",
    gain: null,
    deblocage: { depart: true },
  },
  explorer: {
    nom: 'Explorer',
    description: 'Des éclaireurs fouillent les environs. On ne sait jamais ce qu’ils rapporteront.',
    gain: null,
    deblocage: { vague: 2 },    // disponible après la vague 2
  },
};

// Résultats possibles d'une exploration (tirés au hasard selon le poids)
export const EXPLORATION = [
  { poids: 3, type: 'ressource', res: 'bois', min: 10, max: 25,
    texte: 'Vos éclaireurs rapportent {n} bois d’une coupe abandonnée.' },
  { poids: 2, type: 'ressource', res: 'pierre', min: 10, max: 20,
    texte: 'Vos éclaireurs trouvent un vieux mur écroulé : {n} pierre récupérée.' },
  { poids: 3, type: 'ressource', res: 'nourriture', min: 10, max: 25,
    texte: 'Vos éclaireurs reviennent avec {n} nourriture (baies et gibier).' },
  { poids: 2, type: 'villageois',
    texte: 'Un voyageur égaré décide de rejoindre le village.',
    texteSansPlace: 'Un voyageur voulait rester, mais il n’y a plus de place pour le loger.' },
  { poids: 2, type: 'rien',
    texte: 'Les éclaireurs reviennent bredouilles.' },
];

// ---------------------------------------------------------------------
//  Bâtiments (1 tuile chacun)
//  placement : 'herbe' | 'route' | 'route_ou_herbe' | 'aucun'
//  pres      : doit être à « distance » tuiles au plus d'une tuile de ce type
//  deblocage : { depart: true } | { batiment: type } (1er construit) | { vague: n } (vague n terminée)
// ---------------------------------------------------------------------
export const ORDRE_BATIMENTS = [
  'hutte', 'bucheron', 'chasseur', 'carriere', 'champ', 'entrepot',
  'palissade', 'piege', 'tour_guet', 'mur_pierre', 'tour_pierre',
  'caserne', 'atelier',
];

export const CATEGORIES = {
  centre: 'Centre',
  habitat: 'Habitat',
  production: 'Production',
  stockage: 'Stockage',
  defense: 'Défense',
  militaire: 'Armée',
};

export const BATIMENTS = {
  maison_commune: {
    nom: 'Maison commune',
    feminin: true,                   // « construite », « détruite »
    description: 'Le cœur du village : un peu de stockage et de logement. Les villageois s’y défendent à coups de fronde. Si tous les bâtiments tombent, la partie est perdue.',
    categorie: 'centre',
    cout: { bois: 60, pierre: 30 }, // coût de reconstruction si elle est détruite
    pv: 300,                         // points de vie
    emplois: 0,                      // postes de travail
    production: null,                // { res, parOuvrier } par cycle
    logement: 8,                     // habitants logés
    stockage: 100,                   // capacité ajoutée par ressource
    soldats: 3,                      // places de soldats
    placement: 'aucun',
    pres: null,
    unique: true,                    // ne peut pas être construite ni démolie
    bloqueRoute: false,
    tour: { portee: 3, degats: 3, cadence: 1.5 }, // frondes des villageois : dernier rempart
    piege: null,
    deblocage: { depart: true },
  },
  hutte: {
    nom: 'Hutte',
    feminin: true,                   // « construite », « détruite »
    description: 'Une hutte au toit de chaume. Loge 4 habitants de plus.',
    categorie: 'habitat',
    cout: { bois: 20 },
    pv: 60,
    emplois: 0,
    production: null,
    logement: 4,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: null,
    piege: null,
    deblocage: { depart: true },
  },
  bucheron: {
    nom: 'Cabane de bûcheron',
    feminin: true,                   // « construite », « détruite »
    description: 'Deux bûcherons y travaillent. À construire près d’une forêt.',
    categorie: 'production',
    cout: { bois: 15 },
    pv: 60,
    emplois: 2,
    production: { res: 'bois', parOuvrier: 8 },
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: { tuile: 'forest', distance: 2 },
    bloqueRoute: false,
    tour: null,
    piege: null,
    deblocage: { depart: true },
  },
  chasseur: {
    nom: 'Cabane de chasseur',
    feminin: true,                   // « construite », « détruite »
    description: 'Deux chasseurs ramènent du gibier. À construire près d’une forêt.',
    categorie: 'production',
    cout: { bois: 15 },
    pv: 60,
    emplois: 2,
    production: { res: 'nourriture', parOuvrier: 6 },
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: { tuile: 'forest', distance: 2 },
    bloqueRoute: false,
    tour: null,
    piege: null,
    deblocage: { depart: true },
  },
  carriere: {
    nom: 'Carrière',
    feminin: true,                   // « construite », « détruite »
    description: 'Deux tailleurs extraient la pierre. À construire près d’un rocher.',
    categorie: 'production',
    cout: { bois: 20 },
    pv: 80,
    emplois: 2,
    production: { res: 'pierre', parOuvrier: 5 },
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: { tuile: 'rock', distance: 2 },
    bloqueRoute: false,
    tour: null,
    piege: null,
    deblocage: { batiment: 'bucheron' },
  },
  champ: {
    nom: 'Champ',
    description: 'Des rangs de blé. Trois paysans nourrissent bien le village.',
    categorie: 'production',
    cout: { bois: 20, pierre: 5 },
    pv: 50,
    emplois: 3,
    production: { res: 'nourriture', parOuvrier: 7 },
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: null,
    piege: null,
    deblocage: { vague: 3 },
  },
  entrepot: {
    nom: 'Entrepôt',
    description: 'Un grand hangar : +100 de stockage pour chaque ressource.',
    categorie: 'stockage',
    cout: { bois: 25, pierre: 10 },
    pv: 100,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 100,
    soldats: 0,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: null,
    piege: null,
    deblocage: { batiment: 'carriere' },
  },
  caserne: {
    nom: 'Caserne',
    feminin: true,                   // « construite », « détruite »
    description: 'Permet de recruter des soldats : +5 places dans l’armée.',
    categorie: 'militaire',
    cout: { bois: 30, pierre: 10 },
    pv: 150,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 5,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: null,
    piege: null,
    permetRecrutement: true,
    deblocage: { batiment: 'carriere' },
  },
  atelier: {
    nom: "Atelier d’armes",
    description: 'Fabrique lances, boucliers et arcs : de meilleurs soldats et des archers.',
    categorie: 'militaire',
    cout: { bois: 25, pierre: 15 },
    pv: 120,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: null,
    piege: null,
    debloqueEquipement: true,
    deblocage: { batiment: 'caserne' },
  },
  palissade: {
    nom: 'Palissade',
    feminin: true,                   // « construite », « détruite »
    description: 'Des pieux pointus. Posée SUR la route, elle arrête les ennemis qui doivent la casser.',
    categorie: 'defense',
    cout: { bois: 6 },
    pv: 80,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'route_ou_herbe',
    pres: null,
    bloqueRoute: true,  // bloque seulement si elle est posée sur la route
    mur: true,          // profite du talent « Pieux durcis »
    tour: null,
    piege: null,
    deblocage: { depart: true },
  },
  mur_pierre: {
    nom: 'Mur de pierre',
    description: 'Un mur solide. Posé sur la route, il retient les ennemis bien plus longtemps.',
    categorie: 'defense',
    cout: { pierre: 10 },
    pv: 220,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'route_ou_herbe',
    pres: null,
    bloqueRoute: true,
    mur: true,
    tour: null,
    piege: null,
    deblocage: { batiment: 'carriere' },
  },
  tour_guet: {
    nom: 'Tour de guet',
    feminin: true,                   // « construite », « détruite »
    description: 'Un archer tire sur les ennemis proches. À poser près de la route.',
    categorie: 'defense',
    cout: { bois: 25 },
    pv: 100,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: { portee: 3.5, degats: 3, cadence: 1.0 }, // portée en tuiles, dégâts par flèche, secondes entre deux tirs
    piege: null,
    deblocage: { batiment: 'bucheron' },
  },
  tour_pierre: {
    nom: 'Tour de pierre',
    feminin: true,                   // « construite », « détruite »
    description: 'Une tour haute et solide : tire plus loin et plus fort.',
    categorie: 'defense',
    cout: { bois: 10, pierre: 20 },
    pv: 220,
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'herbe',
    pres: null,
    bloqueRoute: false,
    tour: { portee: 4.5, degats: 8, cadence: 0.9 },
    piege: null,
    deblocage: { batiment: 'carriere' }, // la carrière fournit la pierre : la tour suit tout de suite
  },
  piege: {
    nom: 'Piège à pieux',
    description: 'Une fosse cachée sur la route. Placez-la juste devant une palissade ou un mur : les ennemis s’y entassent. Pendant la bataille, touchez-la pour la déclencher.',
    categorie: 'defense',
    cout: { bois: 10 },
    pv: 0,
    ciblable: false,   // les ennemis ne l'attaquent pas
    emplois: 0,
    production: null,
    logement: 0,
    stockage: 0,
    soldats: 0,
    placement: 'route',
    pres: null,
    bloqueRoute: false,
    tour: null,
    piege: { degats: 35, rayon: 1, recharge: 15 }, // dégâts, rayon (tuiles), secondes de recharge
    deblocage: { depart: true },
  },
};

// ---------------------------------------------------------------------
//  Armée : types de soldats et équipement
// ---------------------------------------------------------------------
export const TYPES_SOLDATS = {
  fantassin: {
    nom: 'Fantassin',
    pv: 30,          // PV de base (avant équipement et entraînement)
    degats: null,    // donnés par l'équipement
    cadence: 1.0,    // secondes entre deux coups
    vitesse: 1.6,    // tuiles par seconde
    portee: 0.9,     // allonge (tuiles)
    cout: null,      // en plus du coût de recrue
    requiert: null,
  },
  archer: {
    nom: 'Archer',
    pv: 22,
    degats: 6,
    cadence: 1.0,
    vitesse: 1.4,
    portee: 5,       // tire par-dessus nos murs sur les ennemis qui s'y entassent
    cout: { bois: 8 },   // pour former un archer (recrue ou conversion)
    requiert: 'atelier',
  },
};

export const EQUIPEMENTS = [
  { tier: 0, nom: 'Mains nues',        degats: 3, pvBonus: 0,  cout: {},                      requiert: null },
  { tier: 1, nom: 'Gourdin',           degats: 5, pvBonus: 0,  cout: { bois: 3 },             requiert: null },
  { tier: 2, nom: 'Lance',             degats: 7, pvBonus: 0,  cout: { bois: 6, pierre: 2 },  requiert: 'atelier' },
  { tier: 3, nom: 'Lance et bouclier', degats: 7, pvBonus: 15, cout: { bois: 8, pierre: 4 },  requiert: 'atelier' },
];

// ---------------------------------------------------------------------
//  Ennemis
//  cible : 'tout' (soldats puis bâtiments) | 'soldats_puis_tours' (archers) | 'batiments' (bélier)
//  resistanceTours (facultatif) : part des dégâts des tours ignorée (0,5 = moitié)
// ---------------------------------------------------------------------
export const ENNEMIS = {
  pillard: {
    nom: 'Pillard',
    pv: 20, degats: 3, cadence: 1.0, vitesse: 1.2, portee: 0.9,
    cible: 'tout', taille: 1.0,
  },
  soudard: {
    nom: 'Soudard',
    pv: 40, degats: 5, cadence: 1.0, vitesse: 1.0, portee: 0.9,
    resistanceTours: 0.4, // cotte de mailles : les tours seules ne suffisent plus, l'armée doit tenir le mur
    cible: 'tout', taille: 1.1,
  },
  archer_ennemi: {
    nom: 'Archer ennemi',
    pv: 18, degats: 4, cadence: 1.4, vitesse: 1.1, portee: 4,
    porteeBatiments: 3, // doit s'approcher pour atteindre un bâtiment (une tour de guet le voit venir)
    degatsBatiments: 2, // une flèche abîme peu le bois et la pierre
    cible: 'soldats_puis_tours', taille: 1.0,
  },
  belier: {
    nom: 'Bélier',
    pv: 150, degats: 25, cadence: 2.0, vitesse: 0.6, portee: 0.9,
    resistanceTours: 0.5, // les flèches des tours glissent sur son toit : il faut l'armée au mur
    cible: 'batiments', taille: 1.6,
  },
  chef_de_guerre: {
    nom: 'Chef de guerre',
    pv: 320, degats: 9, cadence: 1.2, vitesse: 0.9, portee: 1.0, // un sommet, pas un mur : 9 dégâts (12 tuaient toute l'armée)
    resistanceTours: 0.5, // bouclier et armure : les tours seules ne suffisent pas
    cible: 'tout', taille: 1.4,
  },
};

// ---------------------------------------------------------------------
//  Vagues du chapitre 1 : les groupes arrivent dans l'ordre de la liste,
//  un ennemi toutes les « intervalle » secondes.
//  force (facultatif)       : multiplie les PV des ennemis de la vague (1 = normal).
//  forceDegats (facultatif) : multiplie les dégâts des ennemis contre nos soldats (1 = normal) ;
//                             les murs n'y sont pas sensibles. Ce sont les vagues 6 à 9 qui usent l'armée.
//  Rampe visée (npm run balance) : premiers soldats perdus vers la vague 6, puis un peu plus à chaque
//  vague ; la 10e est la plus dure (le chef de guerre) sans être un mur.
// ---------------------------------------------------------------------
export const VAGUES = [
  { // 1 : de quoi coûter un soldat à qui ne prépare rien
    groupes: [{ type: 'pillard', count: 4 }],
    intervalle: 1.5,
  },
  { // 2
    groupes: [{ type: 'pillard', count: 5 }],
    intervalle: 2.0,
  },
  { // 3
    groupes: [{ type: 'pillard', count: 3 }, { type: 'soudard', count: 2 }, { type: 'pillard', count: 3 }],
    intervalle: 1.8,
  },
  { // 4 (2 soudards seulement : ils encaissent les flèches des tours)
    groupes: [{ type: 'pillard', count: 4 }, { type: 'archer_ennemi', count: 2 }, { type: 'soudard', count: 2 }, { type: 'pillard', count: 2 }],
    intervalle: 1.7,
  },
  { // 5 : la difficulté monte ensuite à chaque vague (force)
    groupes: [{ type: 'pillard', count: 4 }, { type: 'soudard', count: 3 }, { type: 'belier', count: 1 }, { type: 'archer_ennemi', count: 3 }, { type: 'pillard', count: 3 }],
    intervalle: 1.6,
    force: 1.1,
  },
  { // 6 : des vétérans qui frappent fort : les premiers soldats tombent
    groupes: [{ type: 'pillard', count: 5 }, { type: 'archer_ennemi', count: 3 }, { type: 'soudard', count: 5 }, { type: 'belier', count: 1 }, { type: 'pillard', count: 4 }],
    intervalle: 1.5,
    force: 1.3,
    forceDegats: 1.6,
  },
  { // 7
    groupes: [{ type: 'soudard', count: 4 }, { type: 'pillard', count: 5 }, { type: 'belier', count: 1 }, { type: 'archer_ennemi', count: 4 }, { type: 'soudard', count: 3 }, { type: 'belier', count: 1 }, { type: 'pillard', count: 4 }],
    intervalle: 1.4,
    force: 1.4,
    forceDegats: 1.6,
  },
  { // 8
    groupes: [{ type: 'pillard', count: 6 }, { type: 'soudard', count: 5 }, { type: 'archer_ennemi', count: 5 }, { type: 'belier', count: 2 }, { type: 'soudard', count: 4 }, { type: 'pillard', count: 5 }],
    intervalle: 1.3,
    force: 1.5,
    forceDegats: 1.6,
  },
  { // 9 : trois béliers, les murs souffrent
    groupes: [{ type: 'soudard', count: 5 }, { type: 'pillard', count: 6 }, { type: 'archer_ennemi', count: 6 }, { type: 'belier', count: 2 }, { type: 'soudard', count: 5 }, { type: 'belier', count: 1 }, { type: 'pillard', count: 6 }],
    intervalle: 1.2,
    force: 1.6,
    forceDegats: 1.6,
  },
  { // 10 : le chef de guerre arrive en dernier, avec sa garde. Un peu moins de force que la 9 :
    //      le chef suffit à en faire la vague la plus dure (avant, c'était un mur : toute l'armée y restait).
    groupes: [{ type: 'pillard', count: 7 }, { type: 'soudard', count: 4 }, { type: 'archer_ennemi', count: 6 }, { type: 'belier', count: 2 }, { type: 'soudard', count: 4 }, { type: 'pillard', count: 6 }, { type: 'chef_de_guerre', count: 1 }, { type: 'soudard', count: 2 }],
    intervalle: 1.2,
    force: 1.5,
  },
];

// ---------------------------------------------------------------------
//  Bataille (simulation)
// ---------------------------------------------------------------------
export const COMBAT = {
  pas: 1 / 30,              // durée d'un pas de simulation (secondes)
  dureeMax: 600,            // au-delà, les ennemis restants se retirent (évite tout blocage)
  delaiPremierEnnemi: 1.5,  // pause avant l'arrivée du premier ennemi (secondes)
  laisse: 3.5,              // les soldats engagent les ennemis à moins de 3,5 tuiles du point de ralliement
  riposte: 2.5,             // … et jusqu'à 2,5 tuiles de plus contre un ennemi qui attaque nos soldats
  porteeEngagement: 1.5,    // un ennemi engage un soldat à moins de 1,5 tuile
  decrochage: 2.2,          // au-delà de cette distance, l'ennemi lâche le duel et reprend la route
  porteeBatiment: 1.35,     // distance au centre d'un bâtiment pour le frapper au corps à corps
  allongeMur: 2.3,          // par-dessus un mur ou une palissade, on se frappe à la lance : allonge (tuiles)
  posteMur: 0.8,            // nos soldats se postent à cette distance derrière le mur (côté village)
  ecartPosteMur: 0.6,       // … étalés sur le côté selon leur place dans la formation (× décalage de formation)
  piedDuMur: 0.45,          // un ennemi est « au pied du mur » à moins de porteeBatiment + 0,45 tuile de lui
  margeRayonPiege: 0.3,     // tolérance ajoutée au rayon des pièges (taille d'un homme)
  dureeAnimAttaque: 0.35,   // durée d'un coup (pour l'animation de fente)
  dureeFlecheTour: 0.3,     // temps de vol d'une flèche de tour (secondes)
  dureeFlecheArcher: 0.35,  // temps de vol d'une flèche d'archer (secondes)
  rayonSeparation: 0.55,    // deux unités d'un même camp s'écartent à moins de cette distance
  forceSeparation: 4,       // vitesse à laquelle elles s'écartent
  decalageLateral: 0.22,    // écart aléatoire des ennemis autour du centre de la route (tuiles)
  espacementFormation: 0.7, // distance entre deux soldats en formation (tuiles)
  soldatsParRang: 4,        // soldats par rang de formation
  limiteEvenements: 4000,   // sécurité : taille max de la liste d'événements si personne ne la vide
};

// ---------------------------------------------------------------------
//  Progression du royaume (conservée entre les parties)
// ---------------------------------------------------------------------
export const META = {
  xpBaseVague: 10,      // XP par vague gagnée…
  xpParNumeroVague: 5,  // … + 5 × numéro de la vague…
  xpParEnnemi: 1,       // … + 1 par ennemi tué
  xpVictoire: 150,      // bonus de victoire du chapitre
  xpParNiveau: 100,     // passer du niveau n au niveau n+1 coûte 100 × n XP
  pointsParNiveau: 1,   // points de talent gagnés par niveau
};

export const BRANCHES_TALENTS = [
  { id: 'economie', nom: 'Économie' },
  { id: 'defense', nom: 'Défense' },
  { id: 'armee', nom: 'Armée' },
];

// effet : modificateurs additionnés (voir meta.js / talentEffects)
export const TALENTS = {
  bras_supplementaires: {
    nom: 'Bras supplémentaires', branche: 'economie', cout: 1, requiert: null,
    description: '+1 action à chaque cycle.',
    effet: { actions: 1 },
  },
  bucherons_aguerris: {
    nom: 'Bûcherons aguerris', branche: 'economie', cout: 1, requiert: null,
    description: '+25 % de bois produit par les bûcherons.',
    effet: { productionBois: 0.25 },
  },
  greniers: {
    nom: 'Greniers', branche: 'economie', cout: 1, requiert: 'bucherons_aguerris',
    description: '+50 de stockage pour chaque ressource.',
    effet: { stockage: 50 },
  },
  natalite: {
    nom: 'Natalité', branche: 'economie', cout: 1, requiert: 'greniers',
    description: '+1 nouveau villageois par cycle (s’il y a de la place et à manger).',
    effet: { croissance: 1 },
  },
  pieux_durcis: {
    nom: 'Pieux durcis', branche: 'defense', cout: 1, requiert: null,
    description: '+50 % de PV pour les palissades et les murs.',
    effet: { pvMurs: 0.5 },
  },
  archers_de_tour: {
    nom: 'Archers de tour', branche: 'defense', cout: 1, requiert: 'pieux_durcis',
    description: '+25 % de dégâts pour les tours.',
    effet: { degatsTours: 0.25 },
  },
  pieges_affutes: {
    nom: 'Pièges affûtés', branche: 'defense', cout: 1, requiert: null,
    description: '+25 % de dégâts des pièges et recharge 30 % plus rapide.',
    effet: { degatsPieges: 0.25, rechargePieges: -0.3 },
  },
  discipline: {
    nom: 'Discipline', branche: 'armee', cout: 1, requiert: null,
    description: '+15 % de dégâts pour les soldats.',
    effet: { degatsSoldats: 0.15 },
  },
  veterans: {
    nom: 'Vétérans', branche: 'armee', cout: 1, requiert: 'discipline',
    description: 'Les nouvelles recrues arrivent avec 1 niveau d’entraînement.',
    effet: { entrainementRecrues: 1 },
  },
  rations: {
    nom: 'Rations', branche: 'armee', cout: 1, requiert: null,
    description: 'Recruter ne coûte plus que 5 nourriture.',
    effet: { reductionRecrue: 5 },
  },
};

// ---------------------------------------------------------------------
//  Missions du chapitre 1 (récompensées une seule fois par royaume)
//  condition.type : voir meta.js / checkMissions
// ---------------------------------------------------------------------
export const MISSIONS = [
  {
    id: 'tour_avant_v3',
    nom: 'Construire une tour avant la vague 3',
    condition: { type: 'tour_avant_vague', vague: 3 },
    recompense: { xp: 30, reserves: { bois: 10 } },
  },
  {
    id: 'sans_perte',
    nom: 'Gagner une vague (dès la 4e) sans perdre de soldat',
    condition: { type: 'vague_sans_perte', aPartirDe: 4 },
    recompense: { xp: 40, reserves: { nourriture: 10 } },
  },
  {
    id: 'habitants_15',
    nom: 'Atteindre 15 habitants',
    condition: { type: 'population', n: 15 },
    recompense: { xp: 40, reserves: { nourriture: 10 } },
  },
  {
    id: 'lances_5',
    nom: "Équiper 5 soldats d’une lance",
    condition: { type: 'soldats_equipes', tier: 2, n: 5 },
    recompense: { xp: 40, reserves: { pierre: 10 } },
  },
  {
    id: 'pieges_10',
    nom: 'Tuer 10 ennemis avec des pièges',
    condition: { type: 'tues_par_pieges', n: 10 },
    recompense: { xp: 40, reserves: { bois: 10 } },
  },
  {
    id: 'chapitre_1',
    nom: 'Repousser les 10 vagues du chapitre 1',
    condition: { type: 'chapitre_gagne' },
    recompense: { xp: 50, reserves: { bois: 10, pierre: 10 } },
  },
];

// ---------------------------------------------------------------------
//  Sauvegarde
// ---------------------------------------------------------------------
export const SAUVEGARDE = {
  partie: 'royaume.partie.v1',   // partie en cours
  meta: 'royaume.meta.v1',       // progression du royaume
  options: 'royaume.options.v1', // options (qualité, conseils…)
};

export const OPTIONS_DEFAUT = {
  qualite: 'normale', // 'normale' | 'economie'
  conseils: true,     // afficher les conseils du tutoriel
  tutoVus: [],        // conseils déjà vus ou fermés (ils ne reviennent plus)
};
