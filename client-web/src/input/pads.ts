import type { CrowdVector } from "../../../shared/crowd/protocol.js";

// Standard-mapping gamepad buttons (Xbox labels; PlayStation is cross, circle, square, triangle).
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

const STICK_DEADZONE = 0.4;

export function readPad(index: number): Gamepad | undefined {
  return navigator.getGamepads?.()[index] ?? undefined;
}

export function connectedPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((pad): pad is Gamepad => Boolean(pad?.connected));
}

export function pressed(pad: Gamepad, button: number): boolean {
  const state = pad.buttons[button];
  return Boolean(state && (state.pressed || state.value > 0.5));
}

// Left stick or d-pad, as a raw direction. The server snaps it to 8 directions at full speed.
export function padMove(pad: Gamepad): CrowdVector {
  const x = (pressed(pad, PAD.RIGHT) ? 1 : 0) - (pressed(pad, PAD.LEFT) ? 1 : 0);
  const y = (pressed(pad, PAD.DOWN) ? 1 : 0) - (pressed(pad, PAD.UP) ? 1 : 0);
  if (x !== 0 || y !== 0) return { x, y };
  return stick(pad, 0, 1);
}

export function padAim(pad: Gamepad): CrowdVector {
  return stick(pad, 2, 3);
}

function stick(pad: Gamepad, xAxis: number, yAxis: number): CrowdVector {
  const x = pad.axes[xAxis] ?? 0;
  const y = pad.axes[yAxis] ?? 0;
  return Math.hypot(x, y) < STICK_DEADZONE ? { x: 0, y: 0 } : { x, y };
}

// Remembers last frame's buttons so callers can react to a press once.
export class PadEdges {
  private readonly previous = new Map<number, boolean[]>();

  // Buttons that went down since the last call for this pad.
  poll(pad: Gamepad): Set<number> {
    const now = pad.buttons.map((_button, index) => pressed(pad, index));
    const before = this.previous.get(pad.index) ?? [];
    this.previous.set(pad.index, now);
    return new Set(now.flatMap((down, index) => (down && !before[index] ? [index] : [])));
  }
}

// Private cues for whoever holds this controller. Silently does nothing where rumble isn't supported.
export function rumble(index: number, pulses: Array<{ ms: number; strong: number; gapMs?: number }>): void {
  let delay = 0;
  for (const pulse of pulses) {
    window.setTimeout(() => {
      readPad(index)
        ?.vibrationActuator?.playEffect("dual-rumble", {
          duration: pulse.ms,
          strongMagnitude: pulse.strong,
          weakMagnitude: Math.min(1, pulse.strong + 0.2),
        })
        .catch(() => undefined);
    }, delay);
    delay += pulse.ms + (pulse.gapMs ?? 120);
  }
}

export const CUES = {
  // One long buzz: you have the role that matters this round (Killer, Ringer).
  special: [{ ms: 700, strong: 0.9 }],
  // Two short buzzes: you're one of the many.
  ordinary: [{ ms: 120, strong: 0.5 }, { ms: 120, strong: 0.5 }],
  tick: [{ ms: 90, strong: 0.6 }],
  heartbeat: [{ ms: 80, strong: 0.7, gapMs: 90 }, { ms: 80, strong: 0.5 }],
  dark: [{ ms: 160, strong: 0.25 }],
  down: [{ ms: 500, strong: 0.4 }],
  // Three soft taps now and then: you're holding the cursed invitation.
  invite: [{ ms: 60, strong: 0.3, gapMs: 120 }, { ms: 60, strong: 0.3, gapMs: 120 }, { ms: 60, strong: 0.3 }],
};
