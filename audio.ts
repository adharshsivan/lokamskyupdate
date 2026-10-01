// Procedural ambience via Web Audio — no audio files, ~1 MB of generated noise buffers.
// Rain hiss + patter, gusting wind, ocean swell, and distance-dependent thunder.
export interface AmbienceInput { rain: number; wind: number; wave: number; storm: number; }

export class AmbientAudio {
  enabled = false;
  volume = 0.7;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainG: GainNode | null = null;
  private rainLP: BiquadFilterNode | null = null;
  private patterG: GainNode | null = null;
  private windG: GainNode | null = null;
  private windBP: BiquadFilterNode | null = null;
  private seaG: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;

  get supported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
  }

  async setEnabled(on: boolean) {
    if (on && !this.ctx) this.init();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.enabled = on;
    if (on) { try { await ctx.resume(); } catch { /* ignored */ } }
    this.master.gain.setTargetAtTime(on ? this.volume : 0, ctx.currentTime, 0.25);
    // when muted, suspend the graph after the fade-out → zero audio CPU / battery cost
    if (!on) setTimeout(() => { if (!this.enabled && this.ctx === ctx) ctx.suspend().catch(() => undefined); }, 1200);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  private init() {
    if (!this.supported) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const len = Math.floor(ctx.sampleRate * 3);
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      w[i] = r;
      last = (last + 0.02 * r) / 1.02;
      b[i] = last * 3.5;
    }
    this.white = white; this.brown = brown;

    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);
    this.master = master;

    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2);
      return s;
    };
    const lfo = (freq: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator(); o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = depth;
      o.connect(g); g.connect(target); o.start();
    };

    // rain hiss
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
    const rainLP = ctx.createBiquadFilter(); rainLP.type = 'lowpass'; rainLP.frequency.value = 3000;
    const rainG = ctx.createGain(); rainG.gain.value = 0;
    loop(white).connect(hp); hp.connect(rainLP); rainLP.connect(rainG); rainG.connect(master);
    this.rainLP = rainLP; this.rainG = rainG;

    // rain patter (mid band with slow flutter)
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1;
    const patterG = ctx.createGain(); patterG.gain.value = 0;
    const flutter = ctx.createGain(); flutter.gain.value = 1;
    lfo(0.35, 0.25, flutter.gain);
    loop(white).connect(bp); bp.connect(flutter); flutter.connect(patterG); patterG.connect(master);
    this.patterG = patterG;

    // wind: resonant band sweeping slowly, with gusts
    const windBP = ctx.createBiquadFilter(); windBP.type = 'bandpass'; windBP.frequency.value = 420; windBP.Q.value = 0.9;
    lfo(0.07, 170, windBP.frequency);
    const gust = ctx.createGain(); gust.gain.value = 1;
    lfo(0.11, 0.35, gust.gain);
    const windG = ctx.createGain(); windG.gain.value = 0;
    loop(white).connect(windBP); windBP.connect(gust); gust.connect(windG); windG.connect(master);
    this.windBP = windBP; this.windG = windG;

    // ocean swell
    const seaLP = ctx.createBiquadFilter(); seaLP.type = 'lowpass'; seaLP.frequency.value = 420;
    const swell = ctx.createGain(); swell.gain.value = 1;
    lfo(0.085, 0.45, swell.gain);
    const seaG = ctx.createGain(); seaG.gain.value = 0;
    loop(brown).connect(seaLP); seaLP.connect(swell); swell.connect(seaG); seaG.connect(master);
    this.seaG = seaG;
  }

  /** Call a few times per second with current weather. */
  update(p: AmbienceInput) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.rainG || !this.rainLP || !this.patterG || !this.windG || !this.windBP || !this.seaG) return;
    const t = ctx.currentTime;
    this.rainG.gain.setTargetAtTime(Math.pow(p.rain, 1.2) * 0.5, t, 0.6);
    this.rainLP.frequency.setTargetAtTime(1600 + p.rain * 6500, t, 0.6);
    this.patterG.gain.setTargetAtTime(p.rain * 0.22, t, 0.6);
    this.windG.gain.setTargetAtTime(0.03 + Math.pow(p.wind, 1.5) * 0.55, t, 0.9);
    this.windBP.frequency.setTargetAtTime(340 + p.wind * 380 + p.storm * 120, t, 1.2);
    this.seaG.gain.setTargetAtTime(0.16 + Math.min(1.5, p.wave) * 0.22, t, 1.2);
  }

  /** Schedule thunder: near strikes crack sharply, distant ones rumble low. */
  thunder(distKm: number, delay: number, sheet: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.master || !this.brown || !this.white) return;
    const t0 = ctx.currentTime + delay;
    const near = Math.max(0, Math.min(1, 1 - (distKm - 2.5) / 6));
    const src = ctx.createBufferSource();
    src.buffer = this.brown; src.loop = true;
    src.playbackRate.value = 0.55 + Math.random() * 0.25;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170 + near * 900;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const peak = (sheet ? 0.5 : 0.95) * (0.35 + near * 0.9);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + (near > 0.5 ? 0.04 : 0.4));
    let tt = t0 + 0.45;
    for (let i = 0; i < 4; i++) {
      tt += 0.25 + Math.random() * 0.7;
      g.gain.linearRampToValueAtTime(peak * (0.25 + Math.random() * 0.75) * (1 - i * 0.15), tt);
    }
    const end = Math.max(tt + 1.4, t0 + 3.5 + (1 - near) * 3);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 2); src.stop(end + 0.1);
    if (near > 0.55 && !sheet) {
      const c = ctx.createBufferSource(); c.buffer = this.white;
      const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 900;
      const cg = ctx.createGain(); cg.gain.value = 0.0001;
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(0.6 * near, t0 + 0.012);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      c.connect(chp); chp.connect(cg); cg.connect(this.master);
      c.start(t0); c.stop(t0 + 0.45);
    }
  }

  dispose() {
    if (this.ctx) { this.ctx.close().catch(() => undefined); this.ctx = null; }
    this.enabled = false;
  }
}
