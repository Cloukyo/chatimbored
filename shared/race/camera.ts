// The shared screen, as the server judges it and the client draws it. Like Mashed's camera it sits behind the pack and
// looks down the road, so it turns with the track. Seen from behind and above, the ground it covers is a trapezoid:
// narrow at the bottom of the screen, near the camera, and wide at the top, far away. Off that and you're off the screen.

export type ScreenView = {
  // The middle of the screen, on the ground.
  x: number;
  y: number;
  // Across the far (top) edge, and from the near edge to the far edge, in world units.
  width: number;
  height: number;
  // Which way the camera faces, in radians: up the screen points this way.
  angle: number;
};

// How wide the near edge is next to the far edge. Matches a camera pitched about 50° down on a 16:9 screen.
export const NEAR_RATIO = 0.55;

// A point in the screen's own terms: across (positive to the right) and along (positive up the screen, away from the camera).
export function toScreenSpace(view: ScreenView, x: number, y: number): { across: number; along: number } {
  const dx = x - view.x;
  const dy = y - view.y;
  const cos = Math.cos(view.angle);
  const sin = Math.sin(view.angle);
  return { across: -dx * sin + dy * cos, along: dx * cos + dy * sin };
}

export function fromScreenSpace(view: ScreenView, across: number, along: number): { x: number; y: number } {
  const cos = Math.cos(view.angle);
  const sin = Math.sin(view.angle);
  return { x: view.x + along * cos - across * sin, y: view.y + along * sin + across * cos };
}

// Half the screen's width at a given distance along it.
export function halfWidthAt(view: ScreenView, along: number): number {
  const t = Math.max(0, Math.min(1, along / view.height + 0.5));
  return (view.width / 2) * (NEAR_RATIO + (1 - NEAR_RATIO) * t);
}

// How far inside the screen a point is: negative once it's off, by that much.
export function insideBy(view: ScreenView, x: number, y: number): number {
  const { across, along } = toScreenSpace(view, x, y);
  return Math.min(view.height / 2 - Math.abs(along), halfWidthAt(view, along) - Math.abs(across));
}

// Pulls a point back onto the screen, keeping it `margin` in from the edges.
export function clampToScreen(view: ScreenView, x: number, y: number, margin = 0): { x: number; y: number } {
  const { across, along } = toScreenSpace(view, x, y);
  const limitAlong = Math.max(0, view.height / 2 - margin);
  const clampedAlong = Math.max(-limitAlong, Math.min(limitAlong, along));
  const limitAcross = Math.max(0, halfWidthAt(view, clampedAlong) - margin);
  return fromScreenSpace(view, Math.max(-limitAcross, Math.min(limitAcross, across)), clampedAlong);
}

// The four corners on the ground: near left, near right, far right, far left.
export function screenCorners(view: ScreenView): Array<{ x: number; y: number }> {
  const near = halfWidthAt(view, -view.height / 2);
  const far = halfWidthAt(view, view.height / 2);
  return [
    fromScreenSpace(view, -near, -view.height / 2),
    fromScreenSpace(view, near, -view.height / 2),
    fromScreenSpace(view, far, view.height / 2),
    fromScreenSpace(view, -far, view.height / 2),
  ];
}
