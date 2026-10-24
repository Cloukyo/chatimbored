// Pile-Up's tracks: a closed loop of control points, smoothed into a road. The server drives on it and the client
// draws it from the same samples, so both always agree where the road, the verge and the drop are.

export type TrackEdge = "wall" | "drop";

export type TrackTheme = "quarry" | "harbour" | "summit";

export type TrackDef = {
  id: string;
  name: string;
  theme: TrackTheme;
  // [x, y, half width of the road, what lies past the verge from this point to the next].
  points: Array<[number, number, number, TrackEdge]>;
  // Fractions of the lap where weapon crates sit, and how far across the road (-1 left verge to 1 right).
  crates: Array<[number, number]>;
};

export type TrackSample = {
  x: number;
  y: number;
  // Distance along the centre line from the start line.
  s: number;
  // Unit direction of travel.
  tx: number;
  ty: number;
  halfWidth: number;
  edge: TrackEdge;
};

export type Track = {
  def: TrackDef;
  samples: TrackSample[];
  length: number;
};

export type TrackSpot = {
  // Index of the nearest sample, a hint for the next lookup.
  index: number;
  // Distance along the lap, 0 to length.
  s: number;
  // Signed distance from the centre line; positive is to the right of the direction of travel.
  offset: number;
  sample: TrackSample;
};

// Rough ground either side of the road. Past it is a wall or a drop.
export const VERGE_WIDTH = 46;
const SAMPLES_PER_SEGMENT = 24;
// How far either side of the last known sample a lookup searches.
const SEARCH_WINDOW = 40;

export const TRACKS: TrackDef[] = [
  {
    id: "quarry",
    name: "Quarry Loop",
    theme: "quarry",
    points: [
      [0, 0, 130, "drop"],
      [900, -160, 125, "drop"],
      [1800, -20, 110, "wall"],
      [2500, -320, 105, "wall"],
      [3250, -120, 120, "drop"],
      [3600, 520, 115, "drop"],
      [3150, 1120, 100, "drop"],
      [2450, 980, 110, "wall"],
      [1900, 1520, 115, "drop"],
      [1100, 1720, 125, "drop"],
      [380, 1420, 105, "drop"],
      [-320, 1640, 110, "wall"],
      [-860, 1020, 120, "wall"],
      [-640, 300, 125, "drop"],
    ],
    crates: [[0.08, 0], [0.18, -0.5], [0.18, 0.5], [0.33, 0], [0.47, -0.4], [0.47, 0.4], [0.6, 0], [0.74, 0.5], [0.74, -0.5], [0.88, 0]],
  },
  {
    id: "harbour",
    name: "Harbour Hairpins",
    theme: "harbour",
    points: [
      [0, 0, 120, "drop"],
      [1200, -40, 120, "drop"],
      [2050, 160, 110, "wall"],
      [2450, 760, 100, "drop"],
      [2050, 1220, 105, "drop"],
      [1300, 1080, 110, "wall"],
      [700, 1300, 105, "drop"],
      [800, 1900, 115, "drop"],
      [1700, 2050, 120, "wall"],
      [2600, 2150, 110, "drop"],
      [2900, 2800, 105, "drop"],
      [2300, 3300, 110, "wall"],
      [1100, 3250, 120, "drop"],
      [100, 2950, 110, "drop"],
      [-400, 2200, 105, "wall"],
      [-200, 1400, 110, "drop"],
      [-600, 700, 115, "drop"],
    ],
    crates: [[0.05, 0], [0.15, 0.4], [0.15, -0.4], [0.29, 0], [0.42, 0.5], [0.42, -0.5], [0.56, 0], [0.69, 0.4], [0.69, -0.4], [0.83, 0], [0.93, 0.5]],
  },
  {
    id: "summit",
    name: "Summit Switchbacks",
    theme: "summit",
    points: [
      [0, 0, 125, "wall"],
      [1000, 80, 115, "drop"],
      [1700, -250, 105, "drop"],
      [2500, -100, 115, "wall"],
      [3000, 500, 110, "drop"],
      [2600, 1100, 100, "drop"],
      [1900, 900, 105, "drop"],
      [1200, 1150, 105, "wall"],
      [1150, 1650, 110, "wall"],
      [1850, 1900, 115, "drop"],
      [2200, 2300, 110, "drop"],
      [1700, 2750, 105, "drop"],
      [600, 2450, 110, "wall"],
      [100, 1700, 120, "drop"],
      [-500, 1200, 110, "drop"],
      [-450, 450, 120, "wall"],
    ],
    crates: [[0.06, 0], [0.17, 0.5], [0.17, -0.5], [0.3, 0], [0.43, 0.4], [0.43, -0.4], [0.57, 0], [0.7, 0.5], [0.7, -0.5], [0.85, 0]],
  },
];

const built = new Map<string, Track>();

export function trackById(id: string): Track {
  let track = built.get(id);
  if (!track) {
    const def = TRACKS.find((candidate) => candidate.id === id) ?? TRACKS[0];
    track = buildTrack(def);
    built.set(id, track);
  }
  return track;
}

// Catmull-Rom through the control points, then measured.
export function buildTrack(def: TrackDef): Track {
  const points = def.points;
  const count = points.length;
  const raw: Array<{ x: number; y: number; halfWidth: number; edge: TrackEdge }> = [];
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    for (let step = 0; step < SAMPLES_PER_SEGMENT; step += 1) {
      const t = step / SAMPLES_PER_SEGMENT;
      raw.push({
        x: catmull(p0[0], p1[0], p2[0], p3[0], t),
        y: catmull(p0[1], p1[1], p2[1], p3[1], t),
        halfWidth: p1[2] + (p2[2] - p1[2]) * t,
        edge: p1[3],
      });
    }
  }
  const samples: TrackSample[] = [];
  let s = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const here = raw[index];
    const next = raw[(index + 1) % raw.length];
    const before = raw[(index - 1 + raw.length) % raw.length];
    const dx = next.x - before.x;
    const dy = next.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    if (index > 0) s += Math.hypot(here.x - raw[index - 1].x, here.y - raw[index - 1].y);
    samples.push({ x: here.x, y: here.y, s, tx: dx / length, ty: dy / length, halfWidth: here.halfWidth, edge: here.edge });
  }
  const last = raw[raw.length - 1];
  const length = s + Math.hypot(raw[0].x - last.x, raw[0].y - last.y);
  return { def, samples, length };
}

// Where a point is on the track. With a hint, only nearby samples are searched, so a car can't jump to a parallel stretch.
export function locate(track: Track, x: number, y: number, hint?: number): TrackSpot {
  const samples = track.samples;
  const total = samples.length;
  let best = 0;
  let bestDistance = Infinity;
  const from = hint === undefined ? 0 : hint - SEARCH_WINDOW;
  const to = hint === undefined ? total - 1 : hint + SEARCH_WINDOW;
  for (let raw = from; raw <= to; raw += 1) {
    const index = ((raw % total) + total) % total;
    const sample = samples[index];
    const distance = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  // Project onto the segment towards whichever neighbour is closer.
  const sample = samples[best];
  const along = (x - sample.x) * sample.tx + (y - sample.y) * sample.ty;
  const offset = (x - sample.x) * -sample.ty + (y - sample.y) * sample.tx;
  const s = (((sample.s + along) % track.length) + track.length) % track.length;
  return { index: best, s, offset, sample };
}

// The centre line at a distance along the lap.
export function pointAt(track: Track, s: number): { x: number; y: number; tx: number; ty: number; halfWidth: number; index: number } {
  const wrapped = ((s % track.length) + track.length) % track.length;
  const samples = track.samples;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (samples[mid].s <= wrapped) low = mid;
    else high = mid - 1;
  }
  const a = samples[low];
  const b = samples[(low + 1) % samples.length];
  const span = (low + 1 < samples.length ? b.s : track.length) - a.s || 1;
  const t = (wrapped - a.s) / span;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    tx: a.tx,
    ty: a.ty,
    halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
    index: low,
  };
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
