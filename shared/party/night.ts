// Party Night: a run of crowd rounds played room by room through a mansion.
// Shared by the server (rules) and the web client (the board).

export type MansionRoomKey =
  | "bell_tower"
  | "gallery"
  | "library"
  | "garden"
  | "grand_hall"
  | "music_room"
  | "terrace"
  | "vault"
  | "post_room";

export type MansionRoom = {
  key: MansionRoomKey;
  name: string;
  minigameId: string;
  // Grid position on the board; rooms that share an edge are connected.
  col: number;
  row: number;
  // The mode tells each player something in words (e.g. Marked's target), which a shared screen can't show.
  needsPrivateText?: boolean;
};

export const MANSION_ROOMS: readonly MansionRoom[] = [
  { key: "bell_tower", name: "Bell Tower", minigameId: "crowd_bell_ringers", col: 0, row: 0 },
  { key: "gallery", name: "Gallery", minigameId: "crowd_marked", col: 1, row: 0, needsPrivateText: true },
  { key: "library", name: "Library", minigameId: "crowd_silent_witness", col: 2, row: 0 },
  { key: "garden", name: "Garden", minigameId: "crowd_lantern_festival", col: 0, row: 1 },
  { key: "grand_hall", name: "Grand Hall", minigameId: "crowd_act_natural", col: 1, row: 1 },
  { key: "music_room", name: "Music Room", minigameId: "crowd_freeze_frame", col: 2, row: 1 },
  { key: "terrace", name: "Terrace", minigameId: "crowd_closing_time", col: 0, row: 2 },
  { key: "vault", name: "Vault", minigameId: "crowd_heist_hour", col: 1, row: 2 },
  { key: "post_room", name: "Post Room", minigameId: "crowd_hot_parcel", col: 2, row: 2 },
];

export const NIGHT_LENGTHS = [4, 6, 8] as const;
export type NightLength = (typeof NIGHT_LENGTHS)[number];
export const NIGHT_OPTION_COUNT = 3;

export const NIGHT_POINTS = {
  soloWin: 5,
  teamWin: 3,
  takedown: 2,
  survive: 1,
  claimedRoom: 2,
  connectedPair: 1,
  contract: 2,
  wantedBounty: 3,
  hostTrick: 2,
  hostCap: 6,
  backedFinalist: 3,
  moleCaughtVoter: 3,
  moleUnnoticed: 8,
} as const;

// Everything on top of the basic points race. Each one is a switch in the lobby.
export type NightLayer =
  | "emptyingParty"
  | "ghosts"
  | "shop"
  | "contracts"
  | "suspicion"
  | "invite"
  | "wanted"
  | "nemesis"
  | "host"
  | "finale"
  | "mole"
  | "twists";

export type NightOptions = Record<NightLayer, boolean>;

export const NIGHT_LAYERS: ReadonlyArray<{
  key: NightLayer;
  name: string;
  blurb: string;
  onByDefault: boolean;
  // Needs each player to read something private, which a shared screen can't show.
  needsPrivateText?: boolean;
}> = [
  { key: "emptyingParty", name: "The party empties out", blurb: "Guests who die stay gone, so later rooms are thinner.", onByDefault: true },
  { key: "ghosts", name: "Ghosts", blurb: "Knocked-out players steer an NPC for the rest of the round.", onByDefault: true },
  { key: "shop", name: "Shop", blurb: "Spend tips on one perk between rounds.", onByDefault: true },
  { key: "suspicion", name: "Suspicion", blurb: "A hidden score. Act oddly and nearby guests start edging away from you.", onByDefault: true },
  { key: "invite", name: "Cursed invitation", blurb: "Passed by bumping into players. Whoever holds it when a round ends loses points.", onByDefault: true },
  { key: "finale", name: "Last Dance", blurb: "The top two duel in the Ballroom to decide the night.", onByDefault: true },
  { key: "host", name: "Party Host", blurb: "With 5 or more players, one player sits out each round and plays tricks on the crowd.", onByDefault: true },
  { key: "contracts", name: "Secret contracts", blurb: "A private side mission each round, worth 2 points.", onByDefault: true, needsPrivateText: true },
  { key: "mole", name: "The Mole", blurb: "One player has a secret objective all night. Everyone votes at the end.", onByDefault: true, needsPrivateText: true },
  { key: "wanted", name: "Wanted", blurb: "The leader gets a bounty and a vague public hint about where they are.", onByDefault: false },
  { key: "nemesis", name: "Nemesis", blurb: "Taking out whoever took you out pays double.", onByDefault: false },
  { key: "twists", name: "Stacking twists", blurb: "A new twist is added after every round and stays.", onByDefault: false },
];

export function defaultNightOptions(sharedScreen: boolean): NightOptions {
  return Object.fromEntries(
    NIGHT_LAYERS.map((layer) => [layer.key, layer.onByDefault && !(sharedScreen && layer.needsPrivateText)]),
  ) as NightOptions;
}

export const HOST_MIN_PLAYERS = 5;

export type PerkKey = "extra_shot" | "glimpse" | "clean_slate" | "pass_invite";

export const PERKS: ReadonlyArray<{ key: PerkKey; name: string; blurb: string; cost: number; needsPrivateText?: boolean; needs?: NightLayer }> = [
  { key: "extra_shot", name: "Extra shot", blurb: "One more shot next round, in modes that have shots.", cost: 3 },
  { key: "glimpse", name: "Glimpse", blurb: "For the first 3 seconds of next round, see one real player outlined.", cost: 4, needsPrivateText: true },
  { key: "clean_slate", name: "Clean slate", blurb: "Clears your suspicion.", cost: 3, needs: "suspicion" },
  { key: "pass_invite", name: "Pass the invite", blurb: "If you're holding the cursed invite, it goes to someone at random.", cost: 3, needs: "invite" },
];

export type TwistKey = "extra_shot" | "crowded" | "restless" | "short_fuse";

export const TWISTS: ReadonlyArray<{ key: TwistKey; name: string; blurb: string }> = [
  { key: "extra_shot", name: "Loaded", blurb: "Everyone with shots gets one more." },
  { key: "crowded", name: "Gatecrashers", blurb: "A dozen extra guests turn up in every room." },
  { key: "restless", name: "Restless crowd", blurb: "Guests hardly ever stand still." },
  { key: "short_fuse", name: "Short fuse", blurb: "Rounds last 60 seconds instead of 90." },
];

export type HostTrickKey = "toast" | "conga" | "spotlight";

export const HOST_TRICKS: ReadonlyArray<{ key: HostTrickKey; name: string; blurb: string }> = [
  { key: "toast", name: "Toast", blurb: "Nearby guests turn and walk towards the spot." },
  { key: "conga", name: "Conga", blurb: "Nearby guests fall into a line heading the same way." },
  { key: "spotlight", name: "Spotlight", blurb: "Guests under the beam stop dead for a moment." },
];
export const HOST_TRICKS_PER_ROUND = 3;

export type NightAward = { title: string; playerId: string; detail: string };

export function mansionRoom(key: string): MansionRoom | undefined {
  return MANSION_ROOMS.find((room) => room.key === key);
}

export function roomsConnected(a: MansionRoom, b: MansionRoom): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

export type NightRoundResult = {
  // "ballroom" is the Last Dance.
  room: MansionRoomKey | "ballroom";
  points: Record<string, number>;
  claimedBy?: string;
};

export type NightStanding = {
  playerId: string;
  points: number;
  rooms: number;
  connectedPairs: number;
  total: number;
};

export type NightSnapshot = {
  totalRounds: number;
  roundsPlayed: number;
  sharedScreen: boolean;
  options: NightOptions;
  guests: number;
  tips: Record<string, number>;
  // Perks bought for next round. Public, like a shop counter on a shared screen.
  perks: Record<string, PerkKey>;
  shopDone: string[];
  twists: TwistKey[];
  // This round's host, if anyone is hosting.
  hostId?: string;
  wantedId?: string;
  // victim -> who took them out last.
  nemesis: Record<string, string>;
  finalists?: string[];
  backers: Record<string, string>;
  finaleWinner?: string;
  // Who has voted on the Mole; the votes themselves stay hidden until the reveal.
  moleVoted: string[];
  moleReveal?: { moleId: string; targetId: string; objectiveMet: boolean; caught: boolean };
  awards?: NightAward[];
  // Only filled in for the player it belongs to.
  secret?: { moleTargetId?: string };
  points: Record<string, number>;
  claims: Partial<Record<MansionRoomKey, string>>;
  played: MansionRoomKey[];
  // While picking: the rooms on offer and who picks.
  offered: MansionRoomKey[];
  pickerId?: string;
  current?: MansionRoomKey;
  lastRound?: NightRoundResult;
  // Set once the night is over, best first.
  standings?: NightStanding[];
};
