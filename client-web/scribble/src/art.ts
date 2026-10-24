import { BRUSHES, CANVAS_H, CANVAS_W, INK, MAX_STROKE_POINTS, type Stroke } from "../../../shared/scribble/protocol.js";

// Canvases keep the game's fixed 800x600 space; CSS scales them to fit.
function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
  if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
  const context = canvas.getContext("2d")!;
  context.lineCap = "round";
  context.lineJoin = "round";
  return context;
}

function paint(context: CanvasRenderingContext2D, stroke: Stroke, upTo = stroke.p.length / 2): void {
  const count = Math.min(upTo, stroke.p.length / 2);
  if (count < 1) return;
  context.strokeStyle = INK[stroke.c] ?? INK[0];
  context.fillStyle = context.strokeStyle;
  context.lineWidth = BRUSHES[stroke.b] ?? BRUSHES[1];
  if (count === 1) {
    context.beginPath();
    context.arc(stroke.p[0], stroke.p[1], context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(stroke.p[0], stroke.p[1]);
  for (let index = 1; index < count; index += 1) context.lineTo(stroke.p[index * 2], stroke.p[index * 2 + 1]);
  context.stroke();
}

export function drawStrokes(canvas: HTMLCanvasElement, strokes: Stroke[], extra?: Stroke): void {
  const context = prepare(canvas);
  context.fillStyle = "#fffdf6";
  context.fillRect(0, 0, CANVAS_W, CANVAS_H);
  for (const stroke of strokes) paint(context, stroke);
  if (extra) paint(context, extra);
}

// Plays a drawing back stroke by stroke, the way it was drawn. Blind drawings are funnier when you watch them happen.
const played = new Set<string>();
export function replay(canvas: HTMLCanvasElement, strokes: Stroke[], key: string, seconds = 2.5): void {
  if (played.has(key) || strokes.length === 0) {
    drawStrokes(canvas, strokes);
    return;
  }
  played.add(key);
  const total = strokes.reduce((sum, stroke) => sum + stroke.p.length / 2, 0);
  const start = performance.now();
  const frame = (now: number) => {
    if (!canvas.isConnected) return;
    const shown = Math.min(total, ((now - start) / (seconds * 1000)) * total);
    const context = prepare(canvas);
    context.fillStyle = "#fffdf6";
    context.fillRect(0, 0, CANVAS_W, CANVAS_H);
    let left = shown;
    for (const stroke of strokes) {
      const points = stroke.p.length / 2;
      paint(context, stroke, Math.ceil(left));
      left -= points;
      if (left <= 0) break;
    }
    if (shown < total) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function artCanvas(strokes: Stroke[] | undefined, key?: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = "art";
  if (!strokes) drawStrokes(canvas, []);
  else if (key) replay(canvas, strokes, key);
  else drawStrokes(canvas, strokes);
  return canvas;
}

// The pad you draw on. Pen colour and brush come from the toolbar.
export class DrawPad {
  strokes: Stroke[] = [];
  ink = 0;
  brush = 1;
  // Blind rounds: you draw, but the page stays blank.
  blind = false;
  // The Forger: one stroke only, reported as it grows.
  onStroke?: (stroke: Stroke, done: boolean) => void;
  // Strokes drawn by others, shown underneath (The Forger's shared canvas).
  under: Stroke[] = [];
  locked = false;
  private current?: Stroke;
  private readonly context: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.context = prepare(canvas);
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", () => this.up());
    canvas.addEventListener("pointercancel", () => this.up());
    this.render();
  }

  private point(event: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [
      Math.round(((event.clientX - rect.left) / rect.width) * CANVAS_W),
      Math.round(((event.clientY - rect.top) / rect.height) * CANVAS_H),
    ];
  }

  private down(event: PointerEvent): void {
    if (this.locked || this.current) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    const [x, y] = this.point(event);
    this.current = { c: this.ink, b: this.brush, p: [x, y] };
    this.render();
    this.onStroke?.(this.current, false);
  }

  private move(event: PointerEvent): void {
    const stroke = this.current;
    if (!stroke) return;
    const events = event.getCoalescedEvents?.() ?? [event];
    for (const each of events.length > 0 ? events : [event]) {
      const [x, y] = this.point(each);
      const lastX = stroke.p[stroke.p.length - 2];
      const lastY = stroke.p[stroke.p.length - 1];
      if (Math.hypot(x - lastX, y - lastY) < 3) continue;
      stroke.p.push(x, y);
      if (stroke.p.length / 2 >= MAX_STROKE_POINTS) {
        this.up();
        return;
      }
    }
    this.render();
  }

  private up(): void {
    const stroke = this.current;
    if (!stroke) return;
    this.current = undefined;
    this.strokes.push(stroke);
    if (this.onStroke) {
      this.locked = true;
      this.onStroke(stroke, true);
    }
    this.render();
  }

  // The stroke being drawn right now, for streaming.
  get live(): Stroke | undefined {
    return this.current;
  }

  undo(): void {
    this.strokes.pop();
    this.render();
  }

  clear(): void {
    this.strokes = [];
    this.render();
  }

  render(): void {
    if (this.blind) {
      const context = this.context;
      context.fillStyle = "#fffdf6";
      context.fillRect(0, 0, CANVAS_W, CANVAS_H);
      // Just where your pen is now, nothing you've drawn.
      const stroke = this.current;
      if (stroke) {
        context.fillStyle = INK[stroke.c];
        context.beginPath();
        context.arc(stroke.p[stroke.p.length - 2], stroke.p[stroke.p.length - 1], 7, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
    drawStrokes(this.canvas, [...this.under, ...this.strokes], this.current);
  }
}
