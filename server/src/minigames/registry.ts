import { buttonRace } from "./ButtonRace.js";
import {
  crowdActNatural,
  crowdBellRingers,
  crowdClosingTime,
  crowdFreezeFrame,
  crowdHeistHour,
  crowdHotParcel,
  crowdLastDance,
  crowdLanternFestival,
  crowdMarked,
  crowdSilentWitness,
} from "./CrowdGames.js";
import { actNatural } from "./ActNatural.js";
import { lootAndLeave } from "./LootAndLeave.js";
import { luckySeven } from "./LuckySeven.js";
import { silentWitness } from "./SilentWitness.js";
import type { Minigame } from "./Minigame.js";

const minigames = new Map<string, Minigame>();

// Future minigames plug in here: implement Minigame, then register it.
export function registerMinigame(minigame: Minigame): void {
  minigames.set(minigame.id, minigame);
}

export function getMinigame(id: string): Minigame | undefined {
  return minigames.get(id);
}

export function listMinigames(): Minigame[] {
  return [...minigames.values()];
}

registerMinigame(buttonRace);
registerMinigame(actNatural);
registerMinigame(lootAndLeave);
registerMinigame(silentWitness);
registerMinigame(luckySeven);
registerMinigame(crowdActNatural);
registerMinigame(crowdSilentWitness);
registerMinigame(crowdLanternFestival);
registerMinigame(crowdBellRingers);
registerMinigame(crowdHeistHour);
registerMinigame(crowdMarked);
registerMinigame(crowdFreezeFrame);
registerMinigame(crowdHotParcel);
registerMinigame(crowdClosingTime);
registerMinigame(crowdLastDance);
