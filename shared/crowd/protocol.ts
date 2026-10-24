// Wire types for the crowd engine. Shared by the server and the web client.
// A client only ever sees anonymous entities: players and NPCs look identical on the wire.

export type CrowdVector = { x: number; y: number };

export type CrowdModeId =
  | "act_natural"
  | "silent_witness"
  | "lantern_festival"
  | "bell_ringers"
  | "heist_hour"
  | "marked"
  | "freeze_frame"
  | "hot_parcel"
  | "closing_time"
  | "last_dance";

// "lookout" watches from above and has no figure in the crowd.
// "backer" is a Last Dance spectator steering a ghost; "host" is Party Night's trickster, watching from above.
export type CrowdRole = "runner" | "killer" | "hunter" | "ringer" | "lookout" | "backer" | "host";

export type CrowdInput = {
  kind: "crowd";
  // Increases by one per input the client sends; echoed back as `ack` for prediction.
  seq: number;
  // Any non-zero direction moves at full walk/run speed, so analog sticks can't give a player away.
  move: CrowdVector;
  run: boolean;
  // World point to shoot at, if the player fired this input.
  shoot?: CrowdVector;
  // The entity the player pointed at when firing. They are the one shot, whoever stands in between.
  shootAt?: number;
  // Mode action, e.g. the Killer's strike in Silent Witness.
  act: boolean;
};

export const CROWD_STATE = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  DEAD: 3,
  SICK: 4,
  STUNNED: 5,
} as const;

export type CrowdEntityState = (typeof CROWD_STATE)[keyof typeof CROWD_STATE];

// Fixed objects on the map. `on` is public (a rung bell, a vault on cooldown); per-player progress goes in `mine`.
export type CrowdPropKind = "lantern" | "bell" | "vault";
export type CrowdProp = { id: number; kind: CrowdPropKind; x: number; y: number; on: boolean };

export type CrowdEvent =
  | { id: number; type: "shot"; from: CrowdVector; to: CrowdVector }
  | { id: number; type: "down"; entity: number }
  | { id: number; type: "escaped"; entity: number }
  | { id: number; type: "message"; text: string }
  // A prop was used by someone. Everyone sees the flash, but not who did it.
  | { id: number; type: "flare"; prop: number }
  | { id: number; type: "strike"; at: CrowdVector }
  // Someone bumped into someone, e.g. trying to pass the parcel.
  | { id: number; type: "bump"; at: CrowdVector };

// Closing Time's lit area. Anywhere outside it is dark.
export type CrowdZone = { x: number; y: number; r: number };

export type CrowdReveal = {
  entity: number;
  playerId: string;
  role: CrowdRole;
  alive: boolean;
};

export type CrowdResult = {
  // "player" means winnerPlayerId escaped or survived; the others are team results.
  winner: "player" | "killer" | "hunters" | "ringers" | "lookouts" | "none";
  winnerPlayerId?: string;
  // Set for team wins: every player with this role scores.
  winnerRole?: CrowdRole;
  reveal: CrowdReveal[];
};

export type CrowdView = {
  mode: CrowdModeId;
  arena: { width: number; height: number; exitX?: number };
  tick: number;
  // Your own entity id (0 for a lookout, who has none) and the last input seq the server applied for you.
  // While you're a ghost it's the NPC you're steering.
  you: number;
  ghost?: boolean;
  ack: number;
  role: CrowdRole;
  alive: boolean;
  shots: number;
  canAct: boolean;
  canRun: boolean;
  // Flat list, 5 numbers per entity: id, x, y, facing (0-7, clockwise from east), state.
  e: number[];
  // Recent public events; clients de-duplicate by id.
  events: CrowdEvent[];
  props: CrowdProp[];
  zone?: CrowdZone;
  // Props this player has personally used, e.g. lanterns they lit.
  mine: number[];
  hud: {
    kills?: number;
    killTarget?: number;
    progress?: number;
    goal?: number;
    // Marked: your secret target's name and a rough, periodically refreshed idea of where they are.
    markName?: string;
    hint?: CrowdVector;
    // Hot Parcel: only the holder sees these.
    holding?: boolean;
    fuseSeconds?: number;
    // Closing Time: how long you've been in the dark, out of how long you can last.
    darkMs?: number;
    darkLimitMs?: number;
  };
  result?: CrowdResult;
  // Party Night extras for this player. Everything in here is either public or this player's own.
  party?: CrowdPartyView;
};

export type CrowdPartyView = {
  contract?: string;
  contractDone?: boolean;
  holdingInvite?: boolean;
  // A purchased glimpse: one real player's entity, shown to you briefly.
  glimpse?: number;
  // Public: the leader's rough whereabouts.
  wanted?: string;
  nemesisName?: string;
  // The Party Host's tools.
  trick?: string;
  tricksLeft?: number;
  // Host's overhead view online: where the players are.
  players?: number[];
};
