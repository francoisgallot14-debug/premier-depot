# Projet Royaume — document de conception

> Nom provisoire. Ce document résume les décisions prises ensemble. Il évolue avec le jeu.

## L'intention

- Un jeu **fait par un passionné, pour des passionnés**.
- **Aucune pub, aucun achat, aucune mécanique pensée pour rendre accro.** Juste du gameplay.
- Joueur cible : quelqu'un **bien installé** (4 h de train, avion) qui veut jouer longtemps, comme sur un ordi.
- **Mobile, hors ligne**, en 3D low poly stylisée et soignée (références visuelles : *Bad North*, *Townscaper*).

## Le cœur du plaisir

**La progression lente** : voir son domaine grandir petit à petit, du hameau au château puis au royaume.
Il n'y a pas de héros : **le vrai personnage, c'est le royaume**.

## Le genre

Jeu de **gestion** + **défense par vagues** (style tower defense), univers **médiéval réaliste** (pas de magie).

## La boucle de jeu (un cycle)

1. **Préparation** (pas de chrono, on prend son temps)
   - On dispose de quelques **actions** par cycle (5 au départ).
   - Au début, on fait tout **à la main** : « Couper du bois », « Tailler la pierre », « Chasser »…
   - On construit des bâtiments et on y place des **villageois** : la production devient **automatique**.
   - Les actions libérées servent à des choses nouvelles (entraîner l'armée, explorer…).
   - On construit les **défenses** (palissades, tours, pièges) et on gère l'**armée** (recruter, équiper).
2. **La vague** (temps réel, on regarde l'action en 3D)
   - Une armée ennemie arrive par la route. Le gros de la bataille est **automatique**.
   - Le joueur garde des **leviers** : déclencher les pièges, déplacer son armée.
3. **Bilan**
   - La **production arrive par bloc** (ce que les villageois ont produit pendant le cycle).
   - La population mange, grandit si on a de la place et de la nourriture.
   - Le royaume gagne de l'**expérience**.
   - On décide quand **lancer la vague suivante**.

## Les règles importantes

- **Les villageois travaillent, seule l'armée se bat.**
- Recruter un soldat = un villageois en moins pour travailler (vrai choix à faire).
- Un **soldat mort est perdu** pour de bon.
- Un **bâtiment détruit doit être reconstruit intégralement** (coût complet). Un bâtiment seulement abîmé est réparé gratuitement entre deux vagues.
- La partie est **perdue quand tous les bâtiments sont détruits**.
- Les batailles se jouent surtout **sur les défenses** : le but est que l'ennemi n'atteigne jamais le village.
- Les vagues sont **de plus en plus dures**. Une seule bataille par cycle.

## Le départ (chapitre 1)

- Un seul bâtiment : la **Maison commune** (un peu de stockage, un peu de logement).
- Quelques ressources : **bois, pierre, nourriture**.
- Quelques villageois, et une **petite armée mal équipée** (à mains nues).

## La progression

- **Dans un chapitre** : nouveaux bâtiments, nouveaux métiers, nouvelles défenses se **débloquent** au fur et à mesure (ex. : construire une cabane de bûcheron débloque la carrière, la carrière débloque la caserne et les murs de pierre…).
- **Entre les chapitres** (progression globale, conservée) :
  - le **royaume gagne de l'XP** → des **talents** (savoir-faire, traditions) ;
  - les **missions** rapportent des **réserves de ressources** gardées pour les parties suivantes.

## Structure

- Des **chapitres** (niveaux). On commence par **un seul chapitre** pour tester le rythme.
- Nombre de vagues du chapitre 1 : **10 pour l'instant** (à ajuster après les tests).

## Technique (résumé)

- Jeu web 3D (Three.js) dans un **seul fichier** `dist/royaume.html` : il marche **sans connexion** une fois chargé.
- Plus tard : un vrai fichier `.apk` Android, construit automatiquement sur GitHub (sans ordi).
- Tous les chiffres d'équilibrage (coûts, production, vagues…) sont dans **`src/core/data.js`**, rangés comme des tableaux faciles à modifier.

## À décider plus tard

- Le **nom** du jeu.
- Le nombre de vagues et la difficulté exacte.
- Les chapitres suivants (nouvelles cartes, nouvelles ressources comme le fer, l'or…).
- Les royaumes rivaux, le commerce, la diplomatie.
