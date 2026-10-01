// Weather system — presets, asymmetric smoothing (storms build clouds first, then rain; clearing
// stops rain first, then clouds break), a deterministic seekable forecast, gusts and shower cells.
import { dayOfYear } from './astro';

export type WeatherName = 'Clear' | 'Fair' | 'Overcast' | 'Haze' | 'Fog' | 'Showers' | 'Rain' | 'Thunderstorm';
export const WEATHER_ORDER: WeatherName[] = ['Clear', 'Fair', 'Overcast', 'Haze', 'Fog', 'Showers', 'Rain', 'Thunderstorm'];

export interface EnvParams {
  cover: number; cloudSpeed: number; windDir: number; wave: number; haze: number;
  sunI: number; moonI: number; stars: number;
  overcast: number; storm: number; rain: number; fog: number; wind: number; lightning: number; gust: number;
}
export type ParamKey = keyof EnvParams;

export const WEATHER_KEYS = ['cover', 'cloudSpeed', 'wave', 'haze', 'overcast', 'storm', 'rain', 'fog', 'wind', 'lightning', 'gust'] as const;
export type WeatherKey = (typeof WEATHER_KEYS)[number];
type WeatherState = Record<WeatherKey, number>;

const S = (cover: number, cloudSpeed: number, wave: number, haze: number, overcast: number, storm: number,
  rain: number, fog: number, wind: number, lightning: number, gust: number): WeatherState =>
  ({ cover, cloudSpeed, wave, haze, overcast, storm, rain, fog, wind, lightning, gust });

//                            cover cSpd  wave  haze  ovc  storm rain  fog   wind  light gust
export const PRESETS: Record<WeatherName, WeatherState> = {
  Clear: S(0.1, 0.35, 0.4, 0.2, 0, 0, 0, 0, 0.18, 0, 0.2),
  Fair: S(0.46, 0.55, 0.58, 0.38, 0, 0, 0, 0, 0.32, 0, 0.3),
  Overcast: S(0.88, 0.6, 0.72, 0.55, 0.82, 0.12, 0, 0.05, 0.42, 0, 0.3),
  Haze: S(0.15, 0.3, 0.35, 1, 0, 0, 0, 0.15, 0.1, 0, 0.1),
  Fog: S(0.5, 0.2, 0.22, 0.7, 0.45, 0, 0, 0.9, 0.06, 0, 0.05),
  Showers: S(0.72, 0.9, 0.8, 0.4, 0.12, 0.35, 0.6, 0.04, 0.5, 0, 0.6),
  Rain: S(0.95, 1, 1, 0.6, 0.92, 0.45, 0.75, 0.2, 0.6, 0.04, 0.45),
  Thunderstorm: S(1, 1.5, 1.4, 0.6, 1, 1, 1, 0.22, 1, 0.85, 0.9),
};

export const WEATHER_BLURB: Record<WeatherName, string> = {
  Clear: 'High pressure, crisp light and a calm swell',
  Fair: 'Scattered cumulus casting drifting shadows on the sea',
  Overcast: 'Stratus deck, with a watery sun through the thinner patches',
  Haze: 'Warm aerosol haze: a milky sky, a bright aureole and a dim, reddened sun',
  Fog: 'Drifting sea-fog banks, with a silver sun visible through the fog overhead',
  Showers: 'Passing downpours with sunny spells. Watch for rain shafts and rainbows',
  Rain: 'Steady stratiform rain, ragged low cloud and a roughened sea',
  Thunderstorm: 'Squall line: lightning, gusty downpours, spray and whitecaps',
};

export const DEFAULT_PARAMS: EnvParams = { windDir: 40, sunI: 1, moonI: 1, stars: 1, ...PRESETS.Fair };

/** [rise τ, fall τ] in seconds at transition = 1 */
const TAU: Record<WeatherKey, [number, number]> = {
  cover: [2.2, 3.5], cloudSpeed: [2, 3], wave: [4, 5.5], haze: [3, 3.5], overcast: [2.5, 4.5], storm: [3, 3],
  rain: [3.5, 1.6], fog: [4, 4.5], wind: [2, 3], lightning: [4.5, 1.2], gust: [3, 3],
};

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class WeatherSystem {
  auto = false;
  /** multiplier on all transition time constants */
  transition = 1;
  label: WeatherName | 'Custom' = 'Fair';
  /** airborne droplets; lingers after the rain stops (drives rainbows) */
  moisture = 0;
  private autoName: WeatherName | null = null;

  apply(name: WeatherName, target: EnvParams, current?: EnvParams) {
    const s = PRESETS[name];
    for (const k of WEATHER_KEYS) {
      target[k] = s[k];
      if (current) current[k] = s[k];
    }
    this.label = name;
  }

  setAuto(on: boolean) { this.auto = on; this.autoName = null; }

  update(dt: number, cur: EnvParams, tgt: EnvParams, simT: number, simSpeed: number) {
    if (this.auto) {
      const n = forecastAt(simT);
      if (n !== this.autoName) { this.autoName = n; this.apply(n, tgt); }
    }
    // in forecast mode transitions are tied to simulated time so fast-forwarding keeps up
    const ts = this.transition * (this.auto ? clamp(900 / Math.max(1, simSpeed), 0.12, 1) : 1);
    for (const k of WEATHER_KEYS) {
      const c = cur[k], t = tgt[k];
      if (c === t) continue;
      const tau = Math.max(1e-3, TAU[k][t > c ? 0 : 1] * ts);
      const nv = c + (t - c) * (1 - Math.exp(-dt / tau));
      cur[k] = Math.abs(nv - t) < 1e-4 ? t : nv;
    }
  }

  /** Wetness of the air around the observer, from the rain actually falling here. */
  updateMoisture(dt: number, rainLocal: number) {
    const k = 1 - Math.exp(-dt / (rainLocal > this.moisture ? 2.5 : 22));
    this.moisture += (rainLocal - this.moisture) * k;
  }
}

// ---------- deterministic noise helpers ----------
function h1(n: number) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function vnoise(x: number) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; }

/** Wind gust factor 0..1 (real time, deterministic): slow swells with sharper gust peaks. */
export function gustAt(t: number) {
  const g = vnoise(t * 0.23 + 3.1) * 0.65 + vnoise(t * 0.9 + 11.7) * 0.35;
  return g * g * (3 - 2 * g);
}

/** Convective shower cell over the observer: 0 = dry gap, 1 = downpour (~20–40 s cycles). */
export function showerAt(t: number) {
  const s = vnoise(t / 21 + 5.3) * 0.75 + vnoise(t / 6.5 + 1.9) * 0.25;
  return smooth(0.32, 0.62, s);
}

// ---------- deterministic forecast (pure function of simulated time → seekable) ----------
const BLOCK = 2 * 3600 * 1000;

export function forecastAt(t: number): WeatherName {
  const block = Math.floor(t / BLOCK);
  const days = (block * BLOCK) / 86400000;
  // slow "pressure systems" + faster mesoscale variation
  const p = vnoise(days / 1.9) * 0.62 + vnoise(days / 0.55 + 31.7) * 0.38;
  const h = h1(block * 0.618 + 7.3);
  const d = new Date(block * BLOCK);
  const m = d.getMonth(), hr = d.getHours();
  const summer = m >= 5 && m <= 7;
  if (p > 0.62) return summer && h > 0.72 ? 'Haze' : 'Clear';
  if (p > 0.54) return 'Fair';
  if (p > 0.46) return hr >= 2 && hr <= 8 && h > 0.4 ? 'Fog' : 'Overcast';
  if (p > 0.38) return 'Showers';
  if (p > 0.29) return 'Rain';
  return summer || h > 0.35 ? 'Thunderstorm' : 'Rain';
}

export function derivedStats(p: EnvParams, date: Date, hours: number, rainLocal: number, windEff: number) {
  const N = dayOfYear(date);
  const temp = 14 - 9 * Math.cos((2 * Math.PI * (N - 20)) / 365)
    + 4.5 * Math.sin((2 * Math.PI * (hours - 9)) / 24) * (1 - p.overcast * 0.6)
    - rainLocal * 3 - p.storm * 2 - p.fog * 1.5;
  const windKmh = 4 + windEff * 82;
  const rainMmH = rainLocal < 0.02 ? 0 : 0.2 + rainLocal * rainLocal * 45;
  const visKm = Math.max(0.1, 40 * Math.pow(1 - p.fog, 2.5) * (1 - rainLocal * 0.6) * (1 - p.haze * 0.45));
  return { tempC: temp, windKmh, visKm, rainMmH };
}

export function compass(deg: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
