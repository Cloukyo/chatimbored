// The ballroom band, synthesised: a written waltz in A minor played by strings, a plucked bass and a piano,
// a music-box version of the same tune for the lobby, and extra drums and tremolo for the end of a round.

export type MusicScene = "lobby" | "round" | "finale";

type Note = [pitch: number, beats: number];

// Sixteen bars, three beats each. 0 is a rest.
const CHORDS: number[][] = [
  [45, 57, 60, 64], // Am
  [45, 57, 60, 64],
  [50, 57, 62, 65], // Dm
  [50, 57, 62, 65],
  [40, 56, 59, 62], // E7
  [40, 56, 59, 62],
  [45, 57, 60, 64], // Am
  [45, 57, 60, 64],
  [41, 57, 60, 65], // F
  [41, 57, 60, 65],
  [50, 57, 62, 65], // Dm
  [45, 57, 60, 64], // Am
  [50, 57, 62, 65], // Dm
  [40, 56, 59, 62], // E7
  [45, 57, 60, 64], // Am
  [45, 57, 60, 64],
];

const MELODY: Note[][] = [
  [[76, 2], [77, 1]],
  [[76, 1], [75, 1], [76, 1]],
  [[77, 2], [81, 1]],
  [[74, 3]],
  [[80, 1], [81, 1], [83, 1]],
  [[74, 2], [71, 1]],
  [[72, 1], [71, 1], [69, 1]],
  [[69, 2], [0, 1]],
  [[72, 2], [77, 1]],
  [[76, 1], [74, 1], [72, 1]],
  [[74, 2], [77, 1]],
  [[76, 3]],
  [[77, 1], [76, 1], [74, 1]],
  [[80, 2], [74, 1]],
  [[72, 2], [71, 1]],
  [[69, 3]],
];

// A second voice for the repeat, a sixth below, so each pass round sounds a little fuller.
const COUNTER: Note[][] = [
  [[72, 3]], [[72, 3]], [[69, 3]], [[65, 3]], [[68, 3]], [[71, 3]], [[64, 3]], [[64, 3]],
  [[65, 3]], [[67, 3]], [[65, 3]], [[64, 3]], [[65, 3]], [[68, 3]], [[64, 3]], [[64, 3]],
];

const BARS = CHORDS.length;
const TEMPO = { lobby: 96, round: 138, finale: 126 };
const TENSE_SPEEDUP = 1.25;

export class Band {
  private scene: MusicScene = "lobby";
  private tense = false;
  private beat = 0;
  private pass = 0;
  private nextBeatTime = 0;
  private timer?: number;
  private readonly bus: GainNode;

  constructor(
    private readonly context: AudioContext,
    out: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    // A dry signal plus a long, soft reverb, like a band at the far end of a hall.
    this.bus = context.createGain();
    const reverb = context.createConvolver();
    reverb.buffer = hallImpulse(context);
    const wet = context.createGain();
    wet.gain.value = 0.32;
    this.bus.connect(out);
    this.bus.connect(reverb).connect(wet).connect(out);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.nextBeatTime = this.context.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  // A new scene starts its tune from the top on the next beat.
  setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.beat = 0;
    this.pass = 0;
  }

  setTense(tense: boolean): void {
    this.tense = tense;
  }

  // Schedules beats a little ahead of time so timer jitter doesn't show.
  private schedule(): void {
    while (this.nextBeatTime < this.context.currentTime + 0.3) {
      const length = 60 / (TEMPO[this.scene] * (this.tense ? TENSE_SPEEDUP : 1));
      this.playBeat(this.nextBeatTime, length);
      this.beat += 1;
      if (this.beat >= BARS * 3) {
        this.beat = 0;
        this.pass += 1;
      }
      this.nextBeatTime += length;
    }
  }

  private playBeat(at: number, length: number): void {
    const bar = Math.floor(this.beat / 3);
    const beatInBar = this.beat % 3;
    const chord = CHORDS[bar];
    const melodyNote = noteStartingAt(MELODY[bar], beatInBar);
    const counterNote = noteStartingAt(COUNTER[bar], beatInBar);

    if (this.scene === "lobby") {
      // Music box: the tune an octave up, the chord rolled under it on the downbeat.
      if (melodyNote && melodyNote[0]) this.musicBox(at, melodyNote[0] + 12, 0.24);
      if (beatInBar === 0) chord.slice(1).forEach((note, index) => this.musicBox(at + index * length * 0.33, note + 12, 0.09));
      return;
    }

    const urgent = this.tense || this.scene === "finale";
    // Oom-pah-pah: a plucked bass on one, the piano on two and three.
    if (beatInBar === 0) this.bass(at, chord[0], length * 2);
    else this.piano(at, chord.slice(1), length * 0.8);

    if (melodyNote && melodyNote[0]) this.strings(at, melodyNote[0], melodyNote[1] * length * 0.95, 0.13);
    if (this.pass % 2 === 1 && counterNote && counterNote[0]) this.strings(at, counterNote[0], counterNote[1] * length * 0.95, 0.06);

    if (urgent) {
      // Timpani on the downbeat and nervous tremolo strings on the chord.
      if (beatInBar === 0) this.timpani(at, chord[0]);
      for (let step = 0; step < 4; step += 1) this.strings(at + (step * length) / 4, chord[1] - 12, length / 5, 0.025);
    }
  }

  // Two slightly detuned saws through a soft filter, with vibrato that comes in after the attack.
  private strings(at: number, note: number, length: number, volume: number): void {
    const context = this.context;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + Math.min(0.08, length * 0.3));
    gain.gain.setValueAtTime(volume, at + length * 0.75);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.15);
    filter.connect(gain).connect(this.bus);
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5.5;
    const depth = context.createGain();
    depth.gain.setValueAtTime(0, at);
    depth.gain.linearRampToValueAtTime(midi(note) * 0.005, at + Math.min(0.3, length));
    vibrato.connect(depth);
    for (const detune of [-6, 6]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = midi(note);
      oscillator.detune.value = detune;
      depth.connect(oscillator.frequency);
      oscillator.connect(filter);
      oscillator.start(at);
      oscillator.stop(at + length + 0.2);
    }
    vibrato.start(at);
    vibrato.stop(at + length + 0.2);
  }

  private bass(at: number, note: number, length: number): void {
    this.voice(at, midi(note), "triangle", 0.32, length, 700);
  }

  private piano(at: number, notes: number[], length: number): void {
    for (const note of notes) {
      this.voice(at, midi(note), "triangle", 0.05, length, 2600);
      this.voice(at, midi(note) * 2, "sine", 0.015, length * 0.6, 4000);
    }
  }

  private musicBox(at: number, note: number, volume: number): void {
    this.voice(at, midi(note), "sine", volume, 1.4, 8000);
    this.voice(at, midi(note) * 3, "sine", volume * 0.12, 0.5, 8000);
  }

  private timpani(at: number, note: number): void {
    const context = this.context;
    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(midi(note) * 1.05, at);
    oscillator.frequency.exponentialRampToValueAtTime(midi(note), at + 0.15);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.4, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
    oscillator.connect(gain).connect(this.bus);
    oscillator.start(at);
    oscillator.stop(at + 1);
    const thud = context.createBufferSource();
    thud.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;
    const thudGain = context.createGain();
    thudGain.gain.setValueAtTime(0.25, at);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    thud.connect(filter).connect(thudGain).connect(this.bus);
    thud.start(at, Math.random());
    thud.stop(at + 0.15);
  }

  // A plucked or struck note: quick attack, then it dies away.
  private voice(at: number, frequency: number, wave: OscillatorType, volume: number, length: number, brightness: number): void {
    const context = this.context;
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(brightness, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, brightness / 4), at + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(filter).connect(gain).connect(this.bus);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  }
}

function noteStartingAt(notes: Note[], beat: number): Note | undefined {
  let position = 0;
  for (const note of notes) {
    if (position === beat) return note;
    position += note[1];
  }
  return undefined;
}

// Decaying stereo noise: a cheap, smooth hall reverb.
function hallImpulse(context: AudioContext): AudioBuffer {
  const seconds = 2.4;
  const buffer = context.createBuffer(2, Math.round(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length) ** 3;
  }
  return buffer;
}

export function midi(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}
