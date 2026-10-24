// Every sound in the game is synthesised with Web Audio, so there are no files to load.
// Browsers only allow audio after the first click or key press, so nothing plays until then.

export type Cue =
  | "shot"
  | "down"
  | "strike"
  | "bump"
  | "bell"
  | "chime"
  | "vault"
  | "step"
  | "tick"
  | "click"
  | "start"
  | "win"
  | "lose"
  | "reveal";

type Volumes = { music: number; effects: number };

const VOLUME_KEY = "morbid-masquerade:volume";
// The waltz: A minor, three beats to the bar.
const WALTZ_BPM = 138;
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 59, 62], // G
  [52, 56, 59], // E
  [57, 60, 64],
  [50, 53, 57], // Dm
  [52, 56, 59],
  [57, 60, 64],
];
const MELODY_SCALE = [69, 71, 72, 74, 76, 77, 79, 80, 81];

class Sound {
  private context?: AudioContext;
  private music?: GainNode;
  private effects?: GainNode;
  private crowd?: { gain: GainNode; source: AudioBufferSourceNode };
  private noise?: AudioBuffer;
  private volumes: Volumes = readVolumes();
  private musicTimer?: number;
  private nextBeatTime = 0;
  private beat = 0;
  private melodyNote = 4;
  private tense = false;
  private playingMusic = false;

  constructor() {
    const unlock = () => this.start();
    for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, unlock, { once: true, capture: true });
  }

  get settings(): Volumes {
    return { ...this.volumes };
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = volumes;
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
    } catch {
      // Volume just won't be remembered.
    }
    if (this.music) this.music.gain.value = volumes.music * 0.35;
    if (this.effects) this.effects.gain.value = volumes.effects;
  }

  // Called on any user gesture; also safe to call again.
  start(): void {
    if (this.context) {
      if (this.context.state === "suspended") void this.context.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    this.context = context;
    this.music = context.createGain();
    this.music.gain.value = this.volumes.music * 0.35;
    this.music.connect(context.destination);
    this.effects = context.createGain();
    this.effects.gain.value = this.volumes.effects;
    this.effects.connect(context.destination);
    this.noise = makeNoise(context);
    this.startMusic();
  }

  play(cue: Cue, pan = 0): void {
    const context = this.context;
    if (!context || !this.effects || context.state !== "running") return;
    const now = context.currentTime;
    const out = context.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.effects);
    switch (cue) {
      case "shot":
        this.noiseBurst(out, now, 0.18, 0.9, "highpass", 900);
        this.tone(out, now, 140, 0.18, 0.7, "sine", 50);
        break;
      case "down":
        this.tone(out, now, 110, 0.35, 0.6, "sine", 45);
        this.noiseBurst(out, now, 0.25, 0.3, "lowpass", 600);
        break;
      case "strike":
        this.noiseBurst(out, now, 0.14, 0.5, "bandpass", 2400, 600);
        break;
      case "bump":
        this.tone(out, now, 220, 0.08, 0.35, "triangle", 160);
        break;
      case "bell":
        for (const [ratio, gain] of [[1, 0.5], [2.4, 0.25], [4.1, 0.12]]) this.tone(out, now, 392 * ratio, 1.6, gain, "sine");
        break;
      case "chime":
        [659, 880, 1047].forEach((frequency, index) => this.tone(out, now + index * 0.07, frequency, 0.6, 0.25, "sine"));
        break;
      case "vault":
        this.tone(out, now, 180, 0.12, 0.5, "square", 120);
        this.tone(out, now + 0.12, 260, 0.2, 0.3, "triangle");
        break;
      case "step":
        this.noiseBurst(out, now, 0.05, 0.12, "lowpass", 900);
        break;
      case "tick":
        this.tone(out, now, 1200, 0.05, 0.25, "square");
        break;
      case "click":
        this.tone(out, now, 660, 0.06, 0.15, "triangle");
        break;
      case "start":
        [57, 64, 69, 72].forEach((note, index) => this.tone(out, now + index * 0.11, midi(note), 0.5, 0.3, "triangle"));
        break;
      case "win":
        [60, 64, 67, 72].forEach((note, index) => this.tone(out, now + index * 0.12, midi(note), 0.9, 0.3, "triangle"));
        break;
      case "lose":
        [69, 65, 62, 57].forEach((note, index) => this.tone(out, now + index * 0.16, midi(note), 0.8, 0.28, "triangle"));
        break;
      case "reveal":
        [57, 60, 64, 69, 72].forEach((note) => this.tone(out, now, midi(note), 1.6, 0.14, "sine"));
        break;
    }
  }

  // The low hubbub of a full room, while a round is on.
  setCrowd(on: boolean): void {
    const context = this.context;
    if (!context || !this.effects || !this.noise) return;
    if (on && !this.crowd) {
      const source = context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 420;
      filter.Q.value = 0.7;
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(0.05, context.currentTime + 1.5);
      source.connect(filter).connect(gain).connect(this.effects);
      source.start();
      this.crowd = { gain, source };
    } else if (!on && this.crowd) {
      const { gain, source } = this.crowd;
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.8);
      source.stop(context.currentTime + 0.9);
      this.crowd = undefined;
    }
  }

  // The last stretch of a round: the waltz speeds up and climbs.
  setTense(tense: boolean): void {
    this.tense = tense;
  }

  private startMusic(): void {
    if (this.playingMusic || !this.context) return;
    this.playingMusic = true;
    this.nextBeatTime = this.context.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
  }

  // Schedules beats a little ahead of time so timer jitter doesn't show.
  private scheduleMusic(): void {
    const context = this.context!;
    const out = this.music!;
    while (this.nextBeatTime < context.currentTime + 0.25) {
      const time = this.nextBeatTime;
      const beatInBar = this.beat % 3;
      const chord = CHORDS[Math.floor(this.beat / 3) % CHORDS.length];
      const lift = this.tense ? 12 : 0;
      if (beatInBar === 0) {
        this.tone(out, time, midi(chord[0] - 24 + lift), 0.5, 0.45, "triangle");
      } else {
        for (const note of chord) this.tone(out, time, midi(note - 12 + lift), 0.18, 0.12, "sine");
      }
      // A wandering melody on most downbeats, staying near the chord.
      if (beatInBar !== 2 && Math.random() < 0.7) {
        this.melodyNote = Math.max(0, Math.min(MELODY_SCALE.length - 1, this.melodyNote + Math.round((Math.random() - 0.5) * 3)));
        this.tone(out, time, midi(MELODY_SCALE[this.melodyNote] - 12 + lift), beatInBar === 0 ? 0.5 : 0.3, 0.12, "sine");
      }
      this.beat += 1;
      this.nextBeatTime += 60 / (this.tense ? WALTZ_BPM * 1.3 : WALTZ_BPM);
    }
  }

  private tone(out: AudioNode, at: number, frequency: number, length: number, volume: number, wave: OscillatorType, slideTo?: number): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, at + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(gain).connect(out);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  }

  private noiseBurst(out: AudioNode, at: number, length: number, volume: number, type: BiquadFilterType, frequency: number, sweepTo?: number): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise!;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(out);
    source.start(at, Math.random());
    source.stop(at + length + 0.05);
  }
}

function midi(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function makeNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function readVolumes(): Volumes {
  try {
    const stored = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null") as Volumes | null;
    if (stored && typeof stored.music === "number" && typeof stored.effects === "number") return stored;
  } catch {
    // Fall through to the defaults.
  }
  return { music: 0.6, effects: 0.8 };
}

export const sound = new Sound();
