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
} as const;

export function mansionRoom(key: string): MansionRoom | undefined {
  return MANSION_ROOMS.find((room) => room.key === key);
}

export function roomsConnected(a: MansionRoom, b: MansionRoom): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

export type NightRoundResult = {
  room: MansionRoomKey;
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
  points: Record<string, number>;
  claims: Partial<Record<MansionRoomKey, string>>;
  played: MansionRoomKey[];
  // While picking: the rooms on offer and who picks.
  options: MansionRoomKey[];
  pickerId?: string;
  current?: MansionRoomKey;
  lastRound?: NightRoundResult;
  // Set once the night is over, best first.
  standings?: NightStanding[];
};
