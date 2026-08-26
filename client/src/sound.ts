/** SE: アセットなしでWebAudio合成。ノイズ＋低音サブで「打撃感」を作る */
let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

/** 音量（0〜1）: localStorage保存 */
const VOL_KEY = "dopagaki-volume";
let volumes = { sfx: 1, bgm: 1 };
try {
  const raw = localStorage.getItem(VOL_KEY);
  if (raw) volumes = { ...volumes, ...(JSON.parse(raw) as Partial<typeof volumes>) };
} catch {
  // 読めない環境では既定値
}

export function getVolumes(): { sfx: number; bgm: number } {
  return { ...volumes };
}

export function setVolume(channel: "sfx" | "bgm", value: number): void {
  volumes[channel] = Math.min(1, Math.max(0, value));
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify(volumes));
  } catch {
    // 保存できなくても続行
  }
}

type Channel = "sfx" | "bgm";

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, freqEnd?: number, ch: Channel = "sfx"): void {
  const a = ac();
  if (!a) return;
  gain *= volumes[ch];
  if (gain <= 0.0002) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

/** ノイズバースト（打撃のアタック・シュッという抜け） */
function noise(dur: number, gain: number, filterFreq: number, kind: BiquadFilterType = "bandpass", delay = 0, ch: Channel = "sfx"): void {
  const a = ac();
  if (!a) return;
  gain *= volumes[ch];
  if (gain <= 0.0002) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.3, a.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = kind;
  f.frequency.setValueAtTime(filterFreq, t0);
  f.Q.setValueAtTime(1.2, t0);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

/** 低音サブの「ドン」（ピッチ急降下） */
function thump(startFreq: number, endFreq: number, dur: number, gain: number, delay = 0): void {
  tone(startFreq, dur, "sine", gain, delay, endFreq);
}

/** 簡易BGM: 2音ベースのパルスループ。danger=trueでテンポ・音程が上がる（残り1機演出） */
class SimpleBgm {
  private timer: number | null = null;
  private danger = false;
  private beat = 0;

  start(): void {
    if (this.timer !== null) return;
    this.beat = 0;
    this.schedule();
  }

  private schedule(): void {
    const interval = this.danger ? 240 : 480;
    this.timer = window.setTimeout(() => {
      const root = this.danger ? 98 : 65.4; // G2 / C2
      const seq = this.danger ? [1, 1.5, 1.19, 1.5] : [1, 1, 1.19, 1];
      const f = root * (seq[this.beat % 4] ?? 1);
      tone(f, this.danger ? 0.12 : 0.2, "triangle", 0.03, 0, undefined, "bgm");
      if (this.beat % 4 === 0) noise(0.03, 0.008, 6000, "highpass", 0, "bgm"); // ハイハット代わり
      this.beat += 1;
      this.timer = null;
      this.schedule();
    }, interval);
  }

  setDanger(v: boolean): void {
    this.danger = v;
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

export const BGM = new SimpleBgm();

export const SFX = {
  shoot(): void {
    noise(0.04, 0.05, 2500, "bandpass");
    tone(700, 0.03, "square", 0.02, 0, 300);
  },
  swing(): void {
    noise(0.09, 0.05, 900, "bandpass");
  },
  /** 打撃: ノイズのアタック＋低音サブ。連続ヒットでピッチ上昇（SPEC 14章） */
  hit(combo: number): void {
    const rise = Math.pow(1.06, Math.min(combo, 12));
    noise(0.06, 0.09, 1400 * rise, "bandpass");
    thump(150 * rise, 55, 0.1, 0.14);
  },
  /** 中心ヒットは別の音: 高く抜ける＋重いサブ */
  center(): void {
    noise(0.07, 0.1, 3200, "highpass");
    thump(220, 60, 0.14, 0.18);
    tone(1760, 0.09, "sine", 0.05, 0.01);
  },
  /** 刀の弾弾き: 短く軽快な金属音（裁定25） */
  deflect(): void {
    noise(0.035, 0.07, 7000, "highpass");
    tone(2600, 0.06, "triangle", 0.05, 0, 1400);
  },
  guard(): void {
    noise(0.05, 0.06, 5000, "highpass"); // 金属質のカキン
    tone(1500, 0.05, "square", 0.03, 0, 900);
  },
  guardBreak(): void {
    noise(0.2, 0.12, 800, "lowpass");
    thump(200, 40, 0.3, 0.2);
  },
  kill(): void {
    noise(0.18, 0.14, 1000, "lowpass");
    thump(110, 35, 0.32, 0.24);
    tone(880, 0.12, "square", 0.05, 0.03, 440);
  },
  heal(): void {
    tone(660, 0.1, "sine", 0.04, 0, 990);
  },
  bigHit(): void {
    noise(0.12, 0.16, 2200, "bandpass");
    thump(260, 45, 0.22, 0.26);
    tone(1568, 0.16, "square", 0.07, 0.02);
    tone(2093, 0.18, "sine", 0.05, 0.04);
  },
  allyDown(): void {
    tone(392, 0.18, "square", 0.08);
    tone(311, 0.3, "square", 0.08, 0.16);
    thump(120, 50, 0.25, 0.12, 0.1);
  },
  /** LINK成立の和音（SPEC 7.2） */
  link(): void {
    tone(523, 0.5, "sine", 0.07);
    tone(659, 0.5, "sine", 0.07, 0.02);
    tone(784, 0.6, "sine", 0.07, 0.04);
    noise(0.25, 0.03, 7000, "highpass", 0.02); // きらめき
  },
};
