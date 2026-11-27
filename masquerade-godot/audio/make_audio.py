#!/usr/bin/env python3
"""Bakes the game's sounds and music into files, from the same recipes as the web version
(client-web/src/audio/sound.ts and music.ts), so the Godot game has no synthesiser to run.
These are stand-ins until real recordings or a composed score replace them.

Usage, from the repo root:  python3 masquerade-godot/audio/make_audio.py
Needs numpy and ffmpeg (for the .ogg music loops)."""

import os
import subprocess
import wave

import numpy as np

RATE = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)


def midi(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def osc(freq, n, wave_type):
    """freq: a number or an array of n frequencies (for slides and vibrato)."""
    freq = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    phase = np.cumsum(freq) / RATE
    frac = phase % 1.0
    if wave_type == "sine":
        return np.sin(2 * np.pi * phase)
    if wave_type == "triangle":
        return 4 * np.abs(frac - 0.5) - 1
    if wave_type == "sawtooth":
        return 2 * frac - 1
    if wave_type == "square":
        return np.where(frac < 0.5, 1.0, -1.0)
    raise ValueError(wave_type)


def filtered(signal, kind, cutoff, q=0.7):
    """A gentle filter applied in the frequency domain (close enough to Web Audio's biquads here)."""
    if len(signal) == 0:
        return signal
    spectrum = np.fft.rfft(signal)
    f = np.fft.rfftfreq(len(signal), 1 / RATE)
    ratio = np.maximum(f, 1e-6) / cutoff
    if kind == "lowpass":
        gain = 1 / np.sqrt(1 + ratio ** 4)
    elif kind == "highpass":
        gain = 1 / np.sqrt(1 + ratio ** -4)
    else:  # bandpass
        width = 1 / max(q, 0.1)
        gain = 1 / np.sqrt(1 + ((ratio - 1 / ratio) / width) ** 2)
    return np.fft.irfft(spectrum * gain, len(signal))


def envelope(n, volume, attack=0.01):
    """Exponential rise to `volume`, then an exponential fall to silence at the end."""
    t = np.arange(n) / RATE
    a = max(1, int(attack * RATE))
    env = np.empty(n)
    rise = min(a, n)
    env[:rise] = 0.0001 * (volume / 0.0001) ** (np.arange(rise) / a)
    if n > rise:
        fall = np.arange(n - rise) / (n - rise)
        env[rise:] = volume * (0.0001 / volume) ** fall
    return env


def tone(buf, at, freq, length, volume, wave_type, slide_to=None):
    start = int(at * RATE)
    n = int(length * RATE)
    if slide_to:
        freq = freq * (slide_to / freq) ** (np.arange(n) / n)
    part = osc(freq, n, wave_type) * envelope(n, volume)
    add(buf, start, part)


def noise_burst(buf, at, length, volume, kind, cutoff, sweep_to=None):
    start = int(at * RATE)
    n = int(length * RATE)
    noise = rng.uniform(-1, 1, n)
    centre = cutoff if not sweep_to else (cutoff * sweep_to) ** 0.5
    part = filtered(noise, kind, centre) * volume * (0.0001 / volume) ** (np.arange(n) / n)
    add(buf, start, part)


def add(buf, start, part):
    end = min(len(buf), start + len(part))
    if end > start:
        buf[start:end] += part[: end - start]


# ---------------------------------------------------------------- effects

def effect(name):
    buf = np.zeros(int(RATE * 2.2))
    if name == "shot":
        noise_burst(buf, 0, 0.18, 0.9, "highpass", 900)
        tone(buf, 0, 140, 0.18, 0.7, "sine", 50)
    elif name == "down":
        tone(buf, 0, 110, 0.35, 0.6, "sine", 45)
        noise_burst(buf, 0, 0.25, 0.3, "lowpass", 600)
    elif name == "strike":
        noise_burst(buf, 0, 0.14, 0.5, "bandpass", 2400, 600)
    elif name == "bump":
        tone(buf, 0, 220, 0.08, 0.35, "triangle", 160)
    elif name == "bell":
        for ratio, gain in [(1, 0.5), (2.4, 0.25), (4.1, 0.12)]:
            tone(buf, 0, 392 * ratio, 1.6, gain, "sine")
    elif name == "chime":
        for index, frequency in enumerate([659, 880, 1047]):
            tone(buf, index * 0.07, frequency, 0.6, 0.25, "sine")
    elif name == "vault":
        tone(buf, 0, 180, 0.12, 0.5, "square", 120)
        tone(buf, 0.12, 260, 0.2, 0.3, "triangle")
    elif name == "step":
        noise_burst(buf, 0, 0.05, 0.12, "lowpass", 900)
    elif name == "tick":
        tone(buf, 0, 1200, 0.05, 0.25, "square")
    elif name == "click":
        tone(buf, 0, 660, 0.06, 0.15, "triangle")
    elif name == "start":
        for index, note in enumerate([57, 64, 69, 72]):
            tone(buf, index * 0.11, midi(note), 0.5, 0.3, "triangle")
    elif name == "win":
        for index, note in enumerate([60, 64, 67, 72]):
            tone(buf, index * 0.12, midi(note), 0.9, 0.3, "triangle")
    elif name == "lose":
        for index, note in enumerate([69, 65, 62, 57]):
            tone(buf, index * 0.16, midi(note), 0.8, 0.28, "triangle")
    elif name == "reveal":
        for note in [57, 60, 64, 69, 72]:
            tone(buf, 0, midi(note), 1.6, 0.14, "sine")
    # Trim the silence at the end.
    loud = np.nonzero(np.abs(buf) > 0.0005)[0]
    return buf[: (loud[-1] + 1 if len(loud) else 1)]


EFFECTS = ["shot", "down", "strike", "bump", "bell", "chime", "vault", "step", "tick", "click", "start", "win", "lose", "reveal"]

# ---------------------------------------------------------------- the band

CHORDS = [
    [45, 57, 60, 64], [45, 57, 60, 64], [50, 57, 62, 65], [50, 57, 62, 65],
    [40, 56, 59, 62], [40, 56, 59, 62], [45, 57, 60, 64], [45, 57, 60, 64],
    [41, 57, 60, 65], [41, 57, 60, 65], [50, 57, 62, 65], [45, 57, 60, 64],
    [50, 57, 62, 65], [40, 56, 59, 62], [45, 57, 60, 64], [45, 57, 60, 64],
]
MELODY = [
    [(76, 2), (77, 1)], [(76, 1), (75, 1), (76, 1)], [(77, 2), (81, 1)], [(74, 3)],
    [(80, 1), (81, 1), (83, 1)], [(74, 2), (71, 1)], [(72, 1), (71, 1), (69, 1)], [(69, 2), (0, 1)],
    [(72, 2), (77, 1)], [(76, 1), (74, 1), (72, 1)], [(74, 2), (77, 1)], [(76, 3)],
    [(77, 1), (76, 1), (74, 1)], [(80, 2), (74, 1)], [(72, 2), (71, 1)], [(69, 3)],
]
COUNTER = [[(n, 3)] for n in [72, 72, 69, 65, 68, 71, 64, 64, 65, 67, 65, 64, 65, 68, 64, 64]]


def note_at(notes, beat):
    position = 0
    for note in notes:
        if position == beat:
            return note
        position += note[1]
    return None


def voice(buf, at, freq, wave_type, volume, length, brightness):
    start = int(at * RATE)
    n = int(length * RATE)
    part = osc(freq, n, wave_type)
    part = filtered(part, "lowpass", max(200, brightness / 2)) * envelope(n, volume, 0.006)
    add(buf, start, part)


def strings(buf, at, note, length, volume):
    start = int(at * RATE)
    n = int((length + 0.15) * RATE)
    t = np.arange(n) / RATE
    depth = np.minimum(1, t / min(0.3, length)) * midi(note) * 0.005
    vibrato = np.sin(2 * np.pi * 5.5 * t) * depth
    part = sum(osc(midi(note) * 2 ** (d / 1200) + vibrato, n, "sawtooth") for d in (-6, 6))
    part = filtered(part, "lowpass", 2400)
    env = np.full(n, volume)
    attack = max(1, int(min(0.08, length * 0.3) * RATE))
    env[:attack] = np.linspace(0, volume, attack)
    hold = int(length * 0.75 * RATE)
    if n > hold:
        env[hold:] = volume * (0.0001 / volume) ** (np.arange(n - hold) / (n - hold))
    add(buf, start, part * env)


def timpani(buf, at, note):
    start = int(at * RATE)
    n = int(1.0 * RATE)
    freq = midi(note) * (1.05 - 0.05 * np.minimum(1, np.arange(n) / (0.15 * RATE)))
    add(buf, start, osc(freq, n, "sine") * 0.4 * (0.0001 / 0.4) ** (np.arange(n) / (0.9 * RATE)).clip(0, 1))
    noise_burst(buf, at, 0.12, 0.25, "lowpass", 300)


def band(scene, tempo, urgent, passes):
    beat_len = 60 / tempo
    beats = len(CHORDS) * 3 * passes
    length = beats * beat_len
    buf = np.zeros(int((length + 3) * RATE))
    for index in range(beats):
        at = index * beat_len
        beat = index % (len(CHORDS) * 3)
        pass_number = index // (len(CHORDS) * 3)
        bar, in_bar = beat // 3, beat % 3
        chord = CHORDS[bar]
        melody = note_at(MELODY[bar], in_bar)
        counter = note_at(COUNTER[bar], in_bar)
        if scene == "lobby":
            # Music box: the tune an octave up, the chord rolled under it on the downbeat.
            if melody and melody[0]:
                voice(buf, at, midi(melody[0] + 12), "sine", 0.24, 1.4, 8000)
                voice(buf, at, midi(melody[0] + 12) * 3, "sine", 0.24 * 0.12, 0.5, 8000)
            if in_bar == 0:
                for k, note in enumerate(chord[1:]):
                    voice(buf, at + k * beat_len * 0.33, midi(note + 12), "sine", 0.09, 1.4, 8000)
            continue
        # Oom-pah-pah: a plucked bass on one, the piano on two and three.
        if in_bar == 0:
            voice(buf, at, midi(chord[0]), "triangle", 0.32, beat_len * 2, 700)
        else:
            for note in chord[1:]:
                voice(buf, at, midi(note), "triangle", 0.05, beat_len * 0.8, 2600)
                voice(buf, at, midi(note) * 2, "sine", 0.015, beat_len * 0.48, 4000)
        if melody and melody[0]:
            strings(buf, at, melody[0], melody[1] * beat_len * 0.95, 0.13)
        if pass_number % 2 == 1 and counter and counter[0]:
            strings(buf, at, counter[0], counter[1] * beat_len * 0.95, 0.06)
        if urgent:
            if in_bar == 0:
                timpani(buf, at, chord[0])
            for step in range(4):
                strings(buf, at + step * beat_len / 4, chord[1] - 12, beat_len / 5, 0.025)
    return hall(buf, int(length * RATE))


def hall(dry, loop_samples):
    """A long soft reverb in stereo, then the tail folded back to the start so the loop is seamless."""
    n = int(2.4 * RATE)
    out = []
    for channel in range(2):
        impulse = rng.uniform(-1, 1, n) * (1 - np.arange(n) / n) ** 3
        impulse /= np.sqrt(np.sum(impulse ** 2))
        size = 1 << int(np.ceil(np.log2(len(dry) + n)))
        wet = np.fft.irfft(np.fft.rfft(dry, size) * np.fft.rfft(impulse, size), size)[: len(dry)]
        mixed = dry + wet * 0.32 * 6
        looped = mixed[:loop_samples].copy()
        tail = mixed[loop_samples:]
        looped[: len(tail)] += tail[:loop_samples]
        out.append(looped)
    stereo = np.stack(out, axis=1)
    return stereo / max(1e-6, np.max(np.abs(stereo))) * 0.8


def hubbub():
    """The low murmur of a full room, as a loop."""
    n = RATE * 6
    noise = filtered(rng.uniform(-1, 1, n), "bandpass", 420, 0.7)
    fade = int(RATE * 0.5)
    noise[:fade] = noise[:fade] * np.linspace(0, 1, fade) + noise[-fade:] * np.linspace(1, 0, fade)
    noise = noise[: n - fade]
    noise = noise / np.max(np.abs(noise)) * 0.5
    return np.stack([noise, np.roll(noise, RATE)], axis=1)


def write_wav(path, samples):
    samples = np.atleast_2d(samples.T).T if samples.ndim == 1 else samples
    data = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as out:
        out.setnchannels(1 if samples.ndim == 1 else samples.shape[1])
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(data.tobytes())


def write_ogg(path, samples):
    temporary = path + ".tmp.wav"
    write_wav(temporary, samples)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", temporary, "-c:a", "libvorbis", "-q:a", "4", path], check=True)
    os.remove(temporary)


def main():
    os.makedirs(os.path.join(HERE, "sfx"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "music"), exist_ok=True)
    for name in EFFECTS:
        write_wav(os.path.join(HERE, "sfx", name + ".wav"), effect(name))
    tracks = {
        "lobby": ("lobby", 96, False, 1),
        "round": ("round", 138, False, 2),
        "round_tense": ("round", 138 * 1.25, True, 2),
        "finale": ("finale", 126, True, 2),
    }
    for name, (scene, tempo, urgent, passes) in tracks.items():
        write_ogg(os.path.join(HERE, "music", name + ".ogg"), band(scene, tempo, urgent, passes))
        print("music", name)
    write_ogg(os.path.join(HERE, "music", "hubbub.ogg"), hubbub())


if __name__ == "__main__":
    main()
