import { buttonRace } from "./ButtonRace.js";
import { actNatural } from "./ActNatural.js";
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
