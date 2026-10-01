// EnvironmentEngine — orchestrates the independent modules (time/astro, palette, weather, lightning,
// audio, performance, renderer). Game code can drive it directly; the React UI is only a client.
import { computeAstro, findSunTime, type SkyAstro, type Vec3 } from './astro';
import { samplePalette, applyWeather } from './palette';
import { EnvRenderer } from './renderer';
import { PerformanceManager, QUALITY, ORDER, type QualityName } from './performance';
import {
  WeatherSystem, DEFAULT_PARAMS, WEATHER_KEYS, derivedStats, gustAt, showerAt,
  type EnvParams, type ParamKey, type WeatherName,
} from './weather';
import { LightningSystem } from './lightning';
import { AmbientAudio, type AmbienceInput } from './audio';

export type TimePreset = 'Dawn' | 'Sunrise' | 'Noon' | 'Golden Hour' | 'Sunset' | 'Dusk' | 'Night' | 'Midnight';
export const TIME_PRESETS: TimePreset[] = ['Dawn', 'Sunrise', 'Noon', 'Golden Hour', 'Sunset', 'Dusk', 'Night', 'Midnight'];

export interface EngineSnapshot {
  t: number;
  astro: SkyAstro;
  params: EnvParams;
  fps: number;
  targetFps: number;
  scale: number;
  res: string;
  quality: QualityName;
  weather: WeatherName | 'Custom';
  auto: boolean;
  rainbow: number;
  antiSolarAz: number;
  tempC: number;
  windKmh: number;
  visKm: number;
  rainMmH: number;
  playing: boolean;
  speed: number;
}

/** Live weather after gusts and passing shower cells — what the renderer and audio actually use. */
export interface LiveWeather {
  rain: number; wind: number; storm: number; gust: number; shafts: number; spray: number; scud: number;
  halo: number; fogbow: number; rainbow: number;
}

/** Fog layer thickness above the camera — must match FOG_TOP in the shader. */
const FOG_TOP = 56;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
const isWeatherKey = (k: string) => (WEATHER_KEYS as readonly string[]).includes(k);

function set3(dst: Float32Array, v: Vec3) { dst[0] = v[0]; dst[1] = v[1]; dst[2] = v[2]; }
function set4(dst: Float32Array, a: number, b: number, c: number, d: number) { dst[0] = a; dst[1] = b; dst[2] = c; dst[3] = d; }

export class EnvironmentEngine {
  readonly renderer: EnvRenderer;
  readonly perf = new PerformanceManager();
  readonly weather = new WeatherSystem();
  readonly lightning = new LightningSystem();
  readonly audio = new AmbientAudio();
  readonly params: EnvParams = { ...DEFAULT_PARAMS };
  readonly target: EnvParams = { ...DEFAULT_PARAMS };
  readonly live: LiveWeather = { rain: 0, wind: 0, storm: 0, gust: 0, shafts: 0, spray: 0, scud: 0, halo: 0, fogbow: 0, rainbow: 0 };
  quality: QualityName;
  simT: number;
  playing = true;
  speed = 60;
  yaw = -Math.PI / 2 + 0.3;
  pitch = 0.1;
  onUpdate: ((s: EngineSnapshot) => void) | null = null;
  onQualityChange: ((q: QualityName) => void) | null = null;

  private canvas: HTMLCanvasElement;
  private tween: { from: number; to: number; s: number } | null = null;
  private dayTween: { from: number; to: number; s: number; hours: number } | null = null;
  private camTween: { y0: number; y1: number; p0: number; p1: number; s: number } | null = null;
  private raf = 0;
  private last = 0;
  private realT = 0;
  private cloudT = 0;
  private uiAcc = 1;
  private audioAcc = 0;
  private readonly amb: AmbienceInput = { rain: 0, wind: 0, wave: 0, storm: 0 };
  private readonly U = {
    uRW: new Float32Array(4), uP0: new Float32Array(4), uP1: new Float32Array(4), uP2: new Float32Array(4),
    uW0: new Float32Array(4), uW1: new Float32Array(4), uW2: new Float32Array(4), uL0: new Float32Array(4), uL1: new Float32Array(4),
    uSun: new Float32Array(3), uMoon: new Float32Array(3), uSunCol: new Float32Array(3), uZen: new Float32Array(3),
    uHor: new Float32Array(3), uFlashDir: new Float32Array(3), uCam: new Float32Array(9),
  };

  constructor(canvas: HTMLCanvasElement, quality: QualityName, startTime: number) {
    this.canvas = canvas;
    this.renderer = new EnvRenderer(canvas);
    this.quality = quality;
    this.simT = startTime;
    this.setQuality(quality);
    this.perf.onDowngrade = () => {
      const i = ORDER.indexOf(this.quality);
      if (i > 0) { this.setQuality(ORDER[i - 1]); this.onQualityChange?.(this.quality); }
    };
    this.lightning.onStrike = e => this.audio.thunder(e.distKm, e.delay, e.kind === 'sheet');
  }

  start() { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.audio.dispose();
    this.renderer.dispose();
  }

  // ---------------- quality ----------------
  setQuality(q: QualityName) {
    let ok = this.renderer.setQuality(QUALITY[q]);
    // graceful fallback if a heavier variant fails to compile on this GPU
    let i = ORDER.indexOf(q);
    while (!ok && i > 0) { i--; q = ORDER[i]; ok = this.renderer.setQuality(QUALITY[q]); }
    this.quality = q;
    this.perf.reset();
  }
  setAutoQuality(on: boolean) { this.perf.autoTier = on; }

  // ---------------- time ----------------
  setPlaying(on: boolean) { this.playing = on; }
  setSpeed(s: number) { this.speed = s; }
  /** Cancelling a date glide snaps to its target date (time-of-day stays continuous). */
  private finishDayTween() {
    if (this.dayTween) { this.simT = this.dayTween.to; this.dayTween = null; }
  }
  setMinutes(m: number) {
    this.finishDayTween();
    const d = new Date(this.simT); d.setHours(0, m, 0, 0);
    this.simT = d.getTime(); this.tween = null;
  }
  goToMinutes(m: number) {
    this.finishDayTween();
    const cur = minutesOf(new Date(this.simT));
    let delta = m - cur;
    if (delta < -720) delta += 1440;
    if (delta > 720) delta -= 1440;
    this.tween = { from: this.simT, to: this.simT + delta * 60000, s: 0 };
  }
  goToPreset(name: TimePreset) {
    const d = new Date(this.simT);
    const m: Record<TimePreset, () => number> = {
      Dawn: () => findSunTime(d, -6, true), Sunrise: () => findSunTime(d, 0, true), Noon: () => 12 * 60,
      'Golden Hour': () => findSunTime(d, 6, false), Sunset: () => findSunTime(d, 0, false), Dusk: () => findSunTime(d, -6, false),
      Night: () => 22 * 60, Midnight: () => 0,
    };
    this.goToMinutes(m[name]());
  }
  /** Move the calendar date keeping the time of day (smooth: moon phase/position glide, no day/night strobing). */
  shiftDays(n: number) {
    this.finishDayTween();
    const d = new Date(this.simT);
    const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    const to = new Date(d); to.setDate(to.getDate() + n);
    this.tween = null;
    this.dayTween = { from: this.simT, to: to.getTime(), s: 0, hours };
  }

  // ---------------- camera ----------------
  rotate(dx: number, dy: number) {
    this.camTween = null;
    this.yaw -= dx;
    this.pitch = Math.max(-0.5, Math.min(1.2, this.pitch + dy));
  }
  lookAt(azDeg: number, pitch = 0.15) {
    let d = (azDeg * Math.PI) / 180 - this.yaw;
    d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    this.camTween = { y0: this.yaw, y1: this.yaw + d, p0: this.pitch, p1: pitch, s: 0 };
  }

  // ---------------- weather ----------------
  setWeather(name: WeatherName, instant = false) {
    this.weather.setAuto(false);
    this.weather.apply(name, this.target, instant ? this.params : undefined);
  }
  setAutoWeather(on: boolean) { this.weather.setAuto(on); }
  setTransition(x: number) { this.weather.transition = x; }
  setParam(k: ParamKey, v: number) {
    this.params[k] = v;
    this.target[k] = v;
    if (isWeatherKey(k)) { this.weather.setAuto(false); this.weather.label = 'Custom'; }
  }
  strike() { this.lightning.trigger(this.yaw, this.halfFov() * 0.8); }

  /** horizontal half field-of-view (rad) — focal length 1.55 in the shader */
  private halfFov() {
    return Math.atan(this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight) / 1.55);
  }

  // ---------------- audio ----------------
  async setSound(on: boolean) { await this.audio.setEnabled(on); if (on) this.audio.update(this.amb); }
  setVolume(v: number) { this.audio.setVolume(v); }

  /** Gusts, passing shower cells and optical phenomena derived from the smoothed parameters. */
  private updateLive(dt: number, sunElev: number, sunY: number) {
    const P = this.params, W = this.live;
    const g = gustAt(this.realT);
    // rain from a stratiform deck is steady; without one it falls from passing convective cells
    // (fully dry, sunny gaps between showers when there is no deck)
    const convective = 1 - smooth(0.15, 0.6, P.overcast);
    const cell = showerAt(this.realT);
    W.gust = g;
    W.wind = clamp01(P.wind * (1 + (g - 0.45) * 0.9 * P.gust));
    W.rain = clamp01(P.rain * (1 - convective * (1 - cell)) * (1 + (g - 0.5) * 0.4 * P.gust));
    W.storm = clamp01(P.storm + convective * cell * P.rain * 0.3);
    W.shafts = clamp01(P.rain * (0.8 + 0.5 * convective));
    W.spray = smooth(0.55, 1, W.wind) * (0.7 + 0.3 * g);
    W.scud = clamp01((W.storm * 0.8 + W.rain * 0.6 - 0.15) * Math.min(1, P.cover * 1.2));
    this.weather.updateMoisture(dt, W.rain);
    // 22° halo needs a thin ice veil: some deck, but no storm, rain or fog
    W.halo = smooth(0.1, 0.32, P.overcast) * (1 - smooth(0.55, 0.8, P.overcast)) * (1 - W.storm) * (1 - clamp01(W.rain * 3)) * (1 - P.fog);
    const sunVis = (1 - P.overcast) ** 2 * (1 - P.fog) ** 2 * Math.min(1, P.sunI);
    const elevF = smooth(-1, 4, sunElev) * (1 - smooth(34, 42, sunElev));
    W.rainbow = Math.min(1, this.weather.moisture * 1.7) * sunVis * elevF;
    // fogbow: low sun shining down through a thin fog layer (same extinction model as the shader)
    const sigma = 0.004 * P.fog + 0.028 * Math.pow(P.fog, 1.6);
    const tSun = Math.exp((-sigma * FOG_TOP) / Math.max(0.05, sunY));
    W.fogbow = smooth(0.12, 0.45, P.fog) * Math.sqrt(tSun) * elevF * (1 - P.overcast * 0.8) * Math.min(1, P.sunI);
  }

  // ---------------- frame ----------------
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.realT += dt;

    // deterministic time progression (+ eased preset jumps)
    let hoursOverride: number | undefined;
    if (this.dayTween) {
      const tw = this.dayTween;
      tw.s = Math.min(1, tw.s + dt / 1.8);
      const k = tw.s * tw.s * (3 - 2 * tw.s);
      this.simT = tw.from + (tw.to - tw.from) * k;
      hoursOverride = tw.hours;
      if (tw.s >= 1) { this.simT = tw.to; this.dayTween = null; hoursOverride = undefined; }
    } else if (this.tween) {
      const tw = this.tween;
      tw.s = Math.min(1, tw.s + dt / 1.6);
      const k = tw.s < 0.5 ? 4 * tw.s ** 3 : 1 - (-2 * tw.s + 2) ** 3 / 2;
      this.simT = tw.from + (tw.to - tw.from) * k;
      if (tw.s >= 1) this.tween = null;
    } else if (this.playing) {
      this.simT += dt * 1000 * this.speed;
    }
    if (this.camTween) {
      const c = this.camTween;
      c.s = Math.min(1, c.s + dt / 1.2);
      const k = c.s * c.s * (3 - 2 * c.s);
      this.yaw = c.y0 + (c.y1 - c.y0) * k;
      this.pitch = c.p0 + (c.p1 - c.p0) * k;
      if (c.s >= 1) this.camTween = null;
    }

    const P = this.params;
    this.weather.update(dt, P, this.target, this.simT, this.playing ? this.speed : 1);

    const date = new Date(this.simT);
    const a = computeAstro(date, hoursOverride);
    this.updateLive(dt, a.sunElev, a.sunDir[1]);
    const W = this.live;
    this.cloudT += dt * P.cloudSpeed * 0.06 * (1 + Math.min(this.playing ? this.speed : 0, 900) / 300) * (1 + W.wind * 1.2);
    const pal = applyWeather(samplePalette(a.sunElev), { overcast: P.overcast, storm: W.storm, fog: P.fog, haze: P.haze, rain: W.rain }, a.sunElev);

    const lRate = P.lightning * clamp01((P.cover - 0.45) / 0.4) * clamp01(P.overcast * 1.2 + P.storm);
    this.lightning.update(dt, lRate, this.yaw, Math.max(0.3, this.halfFov() * 1.3));
    this.perf.tick(dt);

    // dynamic resolution
    const q = QUALITY[this.quality];
    const scale = q.baseScale * this.perf.dynScale;
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    const w = Math.max(160, Math.round(this.canvas.clientWidth * dpr * scale));
    const h = Math.max(120, Math.round(this.canvas.clientHeight * dpr * scale));
    this.renderer.resize(w, h);

    // camera basis
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const f0 = sy * cp, f1 = sp, f2 = cy * cp;
    const r0 = cy, r2 = -sy; // right vector (horizontal)
    const u0 = f1 * r2, u1 = f2 * r0 - f0 * r2, u2 = -f1 * r0;

    const wd = (P.windDir * Math.PI) / 180;
    const moonUp = a.moonElev > 0 ? 1 : 0;
    const stars = P.stars * pal.night * (1 - P.cover * 0.5) * (1 - P.overcast) * (1 - Math.min(1, P.fog * 1.5)) * (1 - a.moonIllum * 0.4 * moonUp);
    const L = this.lightning;

    const U = this.U;
    set4(U.uRW, w, h, Math.sin(wd), Math.cos(wd));
    set4(U.uP0, this.realT, this.cloudT, a.sidereal, 4);
    set4(U.uP1, P.sunI, P.moonI * 0.55, stars, Math.max(0.04, a.moonIllum));
    set4(U.uP2, P.cover, P.wave, P.haze, pal.exposure);
    set4(U.uW0, P.overcast, W.storm, W.rain, W.shafts);
    set4(U.uW1, P.fog, W.wind, W.rainbow, W.spray);
    set4(U.uW2, W.fogbow, W.halo, W.scud, W.gust);
    set4(U.uL0, L.flash, L.bolt, L.seed, L.top);
    set4(U.uL1, L.az[0], L.az[1], (2 / (h * 1.55)) * (1.1 + 4 / L.distKm), L.leader);
    set3(U.uSun, a.sunDir); set3(U.uMoon, a.moonDir);
    set3(U.uSunCol, pal.sun); set3(U.uZen, pal.zenith); set3(U.uHor, pal.horizon);
    set3(U.uFlashDir, L.dir);
    const C = U.uCam;
    C[0] = r0; C[1] = 0; C[2] = r2; C[3] = u0; C[4] = u1; C[5] = u2; C[6] = f0; C[7] = f1; C[8] = f2;
    this.renderer.render(U);

    this.audioAcc += dt;
    if (this.audioAcc > 0.2) {
      this.audioAcc = 0;
      const am = this.amb;
      am.rain = W.rain; am.wind = W.wind; am.wave = P.wave; am.storm = W.storm;
      this.audio.update(am);
    }

    this.uiAcc += dt;
    if (this.uiAcc >= 0.12 && this.onUpdate) {
      this.uiAcc = 0;
      const st = derivedStats(P, date, a.hours, W.rain, W.wind);
      this.onUpdate({
        t: this.simT, astro: a, params: { ...P }, fps: this.perf.fps, targetFps: this.perf.target, scale,
        res: `${w}×${h}`, quality: this.quality, weather: this.weather.label, auto: this.weather.auto, rainbow: W.rainbow,
        antiSolarAz: (a.sunAz + 180) % 360, tempC: st.tempC, windKmh: st.windKmh, visKm: st.visKm, rainMmH: st.rainMmH,
        playing: this.playing, speed: this.speed,
      });
    }
  };
}
