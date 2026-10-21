// Wire types for the crowd engine. Shared by the server and the web client.
// A client only ever sees anonymous entities: players and NPCs look identical on the wire.

export type CrowdVector = { x: number; y: number };

export type CrowdModeId = "act_natural" | "silent_witness";

export type CrowdRole = "runner" | "killer" | "hunter";

export type CrowdInput = {
  kind: "crowd";
  // Increases by one per input the client sends; echoed back as `ack` for prediction.
  seq: number;
  // Any non-zero direction moves at full walk/run speed, so analog sticks can't give a player away.
  move: CrowdVector;
  run: boolean;
  // World point to shoot towards, if the player fired this input.
  shoot?: CrowdVector;
  // Mode action, e.g. the Killer's strike in Silent Witness.
  act: boolean;
};

export const CROWD_STATE = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  DEAD: 3,
  SICK: 4,
} as const;

export type CrowdEntityState = (typeof CROWD_STATE)[keyof typeof CROWD_STATE];

export type CrowdEvent =
  | { id: number; type: "shot"; from: CrowdVector; to: CrowdVector }
  | { id: number; type: "down"; entity: number }
  | { id: number; type: "escaped"; entity: number }
  | { id: number; type: "message"; text: string };

export type CrowdReveal = {
  entity: number;
  playerId: string;
  role: CrowdRole;
  alive: boolean;
};

export type CrowdResult = {
  // "player" means winnerPlayerId escaped or survived; the others are team results.
  winner: "player" | "killer" | "hunters" | "none";
  winnerPlayerId?: string;
  reveal: CrowdReveal[];
};

export type CrowdView = {
  mode: CrowdModeId;
  arena: { width: number; height: number; exitX?: number };
  tick: number;
  // Your own entity id and the last input seq the server applied for you.
  you: number;
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
  hud: { kills?: number; killTarget?: number };
  result?: CrowdResult;
};
