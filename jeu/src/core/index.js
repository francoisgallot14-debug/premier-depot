// Point d'entrée du cœur du jeu (logique pure : ni DOM, ni three.js).
// Le moteur 3D et l'interface importent tout d'ici :
//   import * as Core from './core/index.js';
//
// Cycle de jeu (main.js) :
//   storage = createStorage(() => window.localStorage)   (jamais d'exception ; storage.failed → « sauvegarde indisponible »)
//   meta = loadMeta(storage)        state = newGame(meta, { seed: Date.now() })
//   ou : state = loadGame(storage) puis applyTalentsToState(state, meta.talents) (talents achetés depuis l'écran titre)
//   prep    : doAction / build / assign / recruit / equip / demolish / rebuild / buyTalent…
//             (sauvegarder après chaque action : saveGame(storage, state))
//   bataille: saveGame → r = startBattle(state) → stepBattle(r.battle) à 1/30 s, lire/vider battle.events,
//             leviers triggerTrap / moveArmy ; quand battle.over → finishBattle(state, battle, meta)
//             → saveMeta + saveGame ; state.phase vaut 'report' | 'victory' | 'defeat'
//   bilan   : afficher state.lastReport, puis continueToPrep(state) → 'prep' → saveGame

export * from './data.js';
export {
  normalizeSeed, mixSeeds, mulberry32Step, createRng, stateRng,
} from './rng.js';
export {
  getMap, inBounds, tileAt, pathIndexOf, isNearTile, tileToWorld, worldToTile, isWalkable,
} from './map.js';
export {
  STATE_VERSION, newGame, cloneState, serialize, deserialize, createStorage,
  saveGame, loadGame, hasSavedGame, clearGame, saveMeta, loadMeta, clearMeta, saveOptions, loadOptions,
} from './state.js';
export {
  costText, missingFor, canAfford, missingText, addLog,
  getBuilding, buildingAt, countBuildings, hasBuilding,
  storageCap, hallInRuins, housingCapacity, population, soldierCapacity, freeVillagers,
  buildingMaxHp, soldierStats, defenseStats, productionOf, productionForecast, isDefeated,
  checkUnlocks, canDoAction, actionList, doAction,
  canPlace, validTiles, buildOptions, build, demolish, rebuild, buildingInfo, assign,
  recruitCost, canRecruit, recruit, canEquip, equip, equipAll, convertToArcher, setRally, rallyCheck,
  wavePreview, endOfCycle, continueToPrep,
} from './economy.js';
export {
  createBattle, stepBattle, triggerTrap, moveArmy, enemiesRemaining, runBattle, startBattle, finishBattle,
} from './battle.js';
export {
  META_VERSION, newMeta, normalizeMeta, xpForNextLevel, totalXpForLevel, levelProgress, addXp, waveXp,
  talentEffects, buildingMaxHpFor, canBuyTalent, buyTalent, applyTalentsToState, talentTree,
  rewardText, checkMissions, missionList,
} from './meta.js';
