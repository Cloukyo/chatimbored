// Pile-Up's sound effects, synthesised with Web Audio so there are no files to load.
// Browsers only allow audio after the first click or key press, so nothing plays until then.

export type Effect = "boom" | "bonk" | "pickup" | "fire" | "gun" | "shotgun" | "flash" | "stall" | "whistle" | "splash" | "beep" | "go" | "fanfare" | "honk";

const MUTE_KEY = "pile-up:muted";

class Sound {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  muted = readMuted();

  constructor() {
    const unlock = () => this.start();
    for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, unlock, { capture: true });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // It just won't be remembered.
    }
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  play(effect: Effect, strength = 1): void {
    const context = this.context;
    if (!context || this.muted || context.state !== "running") return;
    const now = context.currentTime;
    switch (effect) {
      case "boom":
        this.burst(now, 0.7 * strength, 0.6, 900, 80);
        this.tone(now, "sine", 90, 35, 0.5, 0.6 * strength);
        break;
      case "bonk":
        this.tone(now, "square", 420 + Math.random() * 200, 140, 0.12, 0.18 * strength);
        this.burst(now, 0.2 * strength, 0.08, 2500, 600);
        break;
      case "pickup":
        [660, 880, 1320].forEach((frequency, index) => this.tone(now + index * 0.06, "triangle", frequency, frequency, 0.08, 0.2));
        break;
      case "fire":
        this.burst(now, 0.3, 0.25, 3000, 400);
        break;
      case "gun":
        // A rattle of eight shots, matching the burst.
        for (let index = 0; index < 8; index += 1) this.burst(now + index * 0.05, 0.25, 0.04, 5000, 1500);
        break;
      case "shotgun":
        this.burst(now, 0.6, 0.3, 3000, 200);
        this.burst(now + 0.02, 0.4, 0.2, 2500, 200);
        break;
      case "flash":
        this.burst(now, 0.6, 0.15, 8000, 3000);
        this.tone(now + 0.05, "sine", 4200, 4000, 1.4, 0.06);
        break;
      case "stall":
        [0, 0.12, 0.26].forEach((at) => this.tone(now + at, "square", 70, 50, 0.1, 0.18));
        break;
      case "whistle":
        // A slide whistle going down: the cartoon exit.
        this.tone(now, "sine", 1500, 220, 0.9, 0.22);
        break;
      case "splash":
        this.burst(now, 0.35, 0.5, 4000, 300);
        this.tone(now, "sine", 300, 80, 0.4, 0.2);
        break;
      case "beep":
        this.tone(now, "square", 520, 520, 0.15, 0.15);
        break;
      case "go":
        this.tone(now, "square", 1040, 1040, 0.35, 0.18);
        break;
      case "fanfare":
        [523, 659, 784, 1047].forEach((frequency, index) => this.tone(now + index * 0.12, "square", frequency, frequency, index === 3 ? 0.5 : 0.12, 0.14));
        break;
      case "honk":
        this.tone(now, "sawtooth", 330, 310, 0.25, 0.15);
        this.tone(now, "sawtooth", 415, 395, 0.25, 0.12);
        break;
    }
  }

  private start(): void {
    if (this.context) {
      if (this.context.state === "suspended") void this.context.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(context.destination);
    const length = context.sampleRate;
    this.noise = context.createBuffer(1, length, context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  }

  private tone(at: number, type: OscillatorType, from: number, to: number, seconds: number, volume: number): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + seconds);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    oscillator.connect(gain).connect(this.master!);
    oscillator.start(at);
    oscillator.stop(at + seconds + 0.05);
  }

  private burst(at: number, volume: number, seconds: number, fromHz: number, toHz: number): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise!;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(fromHz, at);
    filter.frequency.exponentialRampToValueAtTime(toHz, at + seconds);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(at, Math.random() * 0.5);
    source.stop(at + seconds + 0.05);
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export const sound = new Sound();
