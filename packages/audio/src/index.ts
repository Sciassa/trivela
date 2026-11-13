/**
 * 8-bit audio engine: procedural chiptune music in layers and synthesised SFX.
 * Everything is generated with the Web Audio API (no third-party samples).
 * The AudioContext is created/resumed only by unlock(), called from the
 * "PREMI START" gesture, so mobile autoplay policies are respected.
 */

export type Sfx =
  | "blip"
  | "select"
  | "clue"
  | "buzz"
  | "correct"
  | "wrong"
  | "tick"
  | "siren"
  | "goal"
  | "post"
  | "boo"
  | "sad"
  | "slot"
  | "coin"
  | "reveal"
  | "fanfare";

export type Intensity = 0 | 1 | 2;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface AudioPrefs {
  music: number;
  sfx: number;
  muted: boolean;
}

function loadPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem("trivela.audio");
    if (raw) return { music: DEFAULT_MUSIC, sfx: 0.8, muted: false, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { music: DEFAULT_MUSIC, sfx: 0.8, muted: false };
}

/** The background music sits well under the effects by default. */
const DEFAULT_MUSIC = 0.3;
/** Mix level of the music bus at music = 1 (it was 0.35 with the old, brighter loop). */
const MUSIC_MIX = 0.24;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  /** Soft low-pass in front of the music: takes the edge off every note. */
  private musicBus: BiquadFilterNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private intensity: Intensity = 0;
  private playing = false;
  prefs: AudioPrefs = loadPrefs();

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** Must be called from a user gesture. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicBus = this.ctx.createBiquadFilter();
      this.musicBus.type = "lowpass";
      this.musicBus.frequency.value = 1500;
      this.musicBus.Q.value = 0.4;
      this.musicBus.connect(this.musicGain);
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      try {
        if (nav.audioSession) nav.audioSession.type = "playback";
      } catch {
        /* not supported */
      }
      document.addEventListener("visibilitychange", () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
      this.applyPrefs();
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  setPrefs(p: Partial<AudioPrefs>): void {
    this.prefs = { ...this.prefs, ...p };
    try {
      localStorage.setItem("trivela.audio", JSON.stringify(this.prefs));
    } catch {
      /* storage unavailable */
    }
    this.applyPrefs();
  }

  private applyPrefs() {
    if (!this.ctx || !this.musicGain || !this.sfxGain) return;
    const m = this.musicLevel();
    const s = this.prefs.muted ? 0 : this.prefs.sfx * 0.6;
    this.musicGain.gain.setTargetAtTime(m, this.ctx.currentTime, 0.05);
    this.sfxGain.gain.setTargetAtTime(s, this.ctx.currentTime, 0.02);
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    out: AudioNode,
    opts: { slideTo?: number; vibrato?: number; filter?: number } = {},
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = opts.vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(start);
      lfo.stop(start + dur);
    }
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.005);
    g.gain.setValueAtTime(vol, start + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, start + dur);
    let node: AudioNode = o.connect(g);
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(opts.filter, start);
      f.frequency.linearRampToValueAtTime(opts.filter * 3, start + dur * 0.3);
      f.frequency.linearRampToValueAtTime(opts.filter, start + dur);
      node = node.connect(f);
    }
    node.connect(out);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private noise(start: number, dur: number, vol: number, out: AudioNode, cutoff = 8000, type: BiquadFilterType = "lowpass") {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(f).connect(g).connect(out);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  play(name: Sfx): void {
    if (!this.ctx || !this.sfxGain || this.prefs.muted) return;
    const t = this.ctx.currentTime + 0.01;
    const o = this.sfxGain;
    this.duck();
    switch (name) {
      case "blip":
        this.tone(NOTE(84), t, 0.05, "square", 0.3, o);
        break;
      case "select":
        this.tone(NOTE(76), t, 0.05, "square", 0.3, o);
        this.tone(NOTE(83), t + 0.05, 0.08, "square", 0.3, o);
        break;
      case "clue":
        [72, 76, 79].forEach((n, i) => this.tone(NOTE(n), t + i * 0.05, 0.06, "square", 0.25, o));
        break;
      case "buzz":
        this.tone(NOTE(45), t, 0.35, "sawtooth", 0.4, o);
        this.tone(NOTE(46), t, 0.35, "square", 0.25, o);
        break;
      case "correct":
        [72, 76, 79, 84].forEach((n, i) => this.tone(NOTE(n), t + i * 0.07, 0.1, "square", 0.3, o));
        break;
      case "wrong":
        this.tone(NOTE(50), t, 0.18, "square", 0.35, o);
        this.tone(NOTE(44), t + 0.18, 0.3, "square", 0.35, o);
        break;
      case "tick":
        this.tone(NOTE(96), t, 0.02, "square", 0.15, o);
        break;
      case "siren":
        for (let i = 0; i < 3; i++) this.tone(NOTE(84), t + i * 0.3, 0.28, "square", 0.3, o, { slideTo: NOTE(72) });
        break;
      case "goal":
        this.noise(t, 0.25, 0.5, o, 3000, "highpass");
        this.noise(t + 0.05, 2.2, 0.6, o, 1200, "bandpass");
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(NOTE(n), t + 0.1 + i * 0.06, 0.12, "square", 0.22, o));
        this.say("Goool!");
        break;
      case "post":
        this.tone(NOTE(98), t, 0.6, "triangle", 0.4, o, { slideTo: NOTE(92) });
        this.tone(NOTE(105), t, 0.4, "square", 0.1, o);
        break;
      case "boo":
        this.noise(t, 1.4, 0.35, o, 500, "bandpass");
        this.tone(NOTE(40), t, 1.2, "sawtooth", 0.15, o, { vibrato: 6 });
        break;
      case "sad": {
        const notes = [58, 57, 56, 55];
        notes.forEach((n, i) => {
          const last = i === notes.length - 1;
          this.tone(NOTE(n), t + i * 0.42, last ? 1.3 : 0.38, "sawtooth", 0.35, o, { filter: 600, vibrato: last ? 5 : 0 });
        });
        break;
      }
      case "slot":
        for (let i = 0; i < 14; i++) this.tone(NOTE(72 + (i % 5) * 2), t + i * 0.05, 0.04, "square", 0.18, o);
        break;
      case "coin":
        this.tone(NOTE(83), t, 0.07, "square", 0.3, o);
        this.tone(NOTE(88), t + 0.07, 0.25, "square", 0.3, o);
        break;
      case "reveal":
        this.tone(NOTE(67), t, 0.08, "triangle", 0.4, o);
        this.tone(NOTE(79), t + 0.08, 0.15, "triangle", 0.4, o);
        break;
      case "fanfare":
        [67, 67, 67, 72, 76, 79, 76, 79, 84].forEach((n, i) =>
          this.tone(NOTE(n), t + i * 0.12, i === 8 ? 0.6 : 0.1, "square", 0.3, o),
        );
        break;
    }
  }

  private say(text: string) {
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "it-IT";
      u.rate = 0.7;
      u.pitch = 1.3;
      u.volume = Math.min(1, this.prefs.sfx);
      window.speechSynthesis.speak(u);
    } catch {
      /* speech not available */
    }
  }

  private musicLevel(): number {
    return this.prefs.muted ? 0 : this.prefs.music * MUSIC_MIX;
  }

  private duck() {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const base = this.musicLevel();
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(base * 0.35, now, 0.02);
    this.musicGain.gain.setTargetAtTime(base, now + 0.6, 0.3);
  }

  /**
   * Ambient loop, deliberately slow and soft: eight bars of Am9 - Fmaj7 - Cmaj7 - G6 (two bars each), a step being an eighth note.
   * Only sine and triangle waves, long attacks and releases, no noise: a background carpet, not a tune.
   * Intensity only nudges the tempo and adds a quiet pulse and a higher echo.
   */
  private static CHORDS = [
    { bass: 45, pad: [60, 64, 67, 71], arp: [57, 60, 64, 67, 71] },
    { bass: 41, pad: [57, 60, 64, 69], arp: [53, 57, 60, 64, 69] },
    { bass: 48, pad: [55, 59, 64, 67], arp: [52, 55, 59, 64, 67] },
    { bass: 43, pad: [55, 59, 62, 64], arp: [50, 55, 59, 62, 64] },
  ];
  private static ARP = [0, 2, 1, 3, 2, 4, 3, 1];
  /** Sparse bell-like notes (A minor pentatonic) over the 64 steps of the loop. */
  private static BELLS: Record<number, number> = { 4: 76, 10: 79, 20: 74, 26: 72, 36: 76, 42: 74, 52: 72, 58: 69, 60: 72 };
  private static BPM = [66, 72, 78] as const;

  setIntensity(level: Intensity): void {
    this.intensity = level;
  }

  startMusic(): void {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.ctx || !this.playing) return;
      while (this.nextTime < this.ctx.currentTime + 0.3) {
        this.scheduleStep(this.step, this.nextTime);
        this.nextTime += 60 / AudioEngine.BPM[this.intensity] / 2;
        this.step++;
      }
      this.timer = window.setTimeout(tick, 80);
    };
    tick();
  }

  stopMusic(): void {
    this.playing = false;
    if (this.timer) window.clearTimeout(this.timer);
  }

  /** A soft note: slow attack, long release, no hard edges. */
  private soft(freq: number, start: number, dur: number, type: "sine" | "triangle", vol: number, attack: number, release: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.setValueAtTime(vol, start + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, start + dur);
    o.connect(g).connect(this.musicBus!);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private scheduleStep(step: number, t: number) {
    const s = step % 64;
    const beat = 60 / AudioEngine.BPM[this.intensity] / 2; // one step
    const chord = AudioEngine.CHORDS[Math.floor(s / 16)]!;
    const inChord = s % 16;
    if (inChord === 0) {
      // pad: the whole chord, swelling slowly over two bars
      chord.pad.forEach((n, k) => this.soft(NOTE(n), t + k * 0.04, beat * 16, k % 2 ? "sine" : "triangle", 0.055, beat * 5, beat * 6));
      this.soft(NOTE(chord.bass), t, beat * 7, "sine", 0.2, 0.08, beat * 3);
    }
    if (inChord === 8) this.soft(NOTE(chord.bass), t, beat * 7, "sine", 0.16, 0.08, beat * 3);
    // a gentle arpeggio, one note every two steps
    if (s % 2 === 0) {
      const idx = AudioEngine.ARP[(s / 2) % AudioEngine.ARP.length]!;
      this.soft(NOTE(chord.arp[idx]!), t, beat * 3.2, "triangle", 0.045, 0.02, beat * 2.4);
    }
    const bell = AudioEngine.BELLS[s];
    if (bell) this.soft(NOTE(bell), t, beat * 6, "sine", 0.07, 0.01, beat * 5.5);
    if (this.intensity >= 1 && s % 8 === 0) this.soft(NOTE(chord.bass - 12), t, beat * 2.5, "sine", 0.16, 0.02, beat * 2); // quiet pulse
    if (this.intensity >= 2 && s % 4 === 2) this.soft(NOTE(chord.arp[AudioEngine.ARP[(s / 2) % 8]!]! + 12), t, beat * 2, "sine", 0.03, 0.02, beat * 1.6);
  }
}

export const audio = new AudioEngine();
