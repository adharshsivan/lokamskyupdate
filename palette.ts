// Baked atmospheric lookup: colors precomputed per sun elevation (sRGB), interpolated on CPU.
// Weather grading (overcast, storm light, haze, fog) is applied on the CPU as well so the shader
// receives final colors as a handful of uniforms.
import type { Vec3 } from './astro';

type Key = [number, Vec3, Vec3, Vec3]; // elev, zenith, horizon, sun
const KEYS: Key[] = [
  [-90, [0.012, 0.018, 0.04], [0.02, 0.03, 0.06], [0, 0, 0]],
  [-18, [0.014, 0.022, 0.05], [0.03, 0.045, 0.085], [0, 0, 0]],
  [-10, [0.03, 0.055, 0.12], [0.09, 0.11, 0.19], [0.12, 0.06, 0.08]],
  [-5, [0.07, 0.12, 0.26], [0.38, 0.3, 0.4], [0.55, 0.22, 0.2]],
  [-1, [0.14, 0.22, 0.45], [0.88, 0.5, 0.36], [1.0, 0.4, 0.2]],
  [3, [0.22, 0.36, 0.64], [1.0, 0.62, 0.38], [1.0, 0.52, 0.24]],
  [8, [0.26, 0.47, 0.8], [0.98, 0.8, 0.62], [1.0, 0.74, 0.48]],
  [20, [0.2, 0.46, 0.88], [0.7, 0.83, 0.96], [1.0, 0.92, 0.8]],
  [50, [0.13, 0.4, 0.88], [0.64, 0.8, 0.96], [1.0, 0.97, 0.93]],
  [90, [0.12, 0.38, 0.87], [0.62, 0.79, 0.96], [1.0, 0.98, 0.95]],
];

const lin = (c: Vec3): Vec3 => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const luma = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ONE: Vec3 = [1, 1, 1];

export interface Palette { zenith: Vec3; horizon: Vec3; sun: Vec3; zenithS: Vec3; horizonS: Vec3; exposure: number; night: number; }

export function samplePalette(elev: number): Palette {
  let i = 0;
  while (i < KEYS.length - 2 && elev > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = Math.min(1, Math.max(0, (elev - a[0]) / (b[0] - a[0])));
  t = t * t * (3 - 2 * t);
  const z = mix(a[1], b[1], t), h = mix(a[2], b[2], t), s = mix(a[3], b[3], t);
  const s01 = Math.min(1, Math.max(0, (2 - elev) / 14));
  const night = s01 * s01 * (3 - 2 * s01);
  return { zenith: lin(z), horizon: lin(h), sun: lin(s), zenithS: z, horizonS: h, exposure: 1 + night * 2.6, night };
}

export interface WeatherLook { overcast: number; storm: number; fog: number; haze: number; rain: number; }

/** Grade the clear-sky palette for the current weather. Pure & continuous → no popping. */
export function applyWeather(p: Palette, w: WeatherLook, sunElev: number): Palette {
  const oc = w.overcast, st = w.storm, fg = w.fog, rn = w.rain;
  const hz = clamp01((w.haze - 0.45) / 0.55);
  // low sun tints the grey deck warm
  const warm = clamp01((14 - Math.abs(sunElev - 2)) / 14);
  const tint = mix([0.92, 0.98, 1.07], [1.1, 0.95, 0.84], warm * 0.55);
  const lum = luma(p.zenith) * 0.45 + luma(p.horizon) * 0.55;
  // overcast: flat grey sky; storms darken overhead but keep a luminous horizon band
  const gz = scale(tint, lum * 0.92 * (1 - st * 0.72));
  const gh = scale(tint, lum * 1.06 * (1 - st * 0.35));
  let zen = mix(p.zenith, gz, oc * 0.92);
  let hor = mix(p.horizon, gh, oc * 0.85);
  // storm light: cold blue overhead, faint teal-green cast near the horizon
  zen = mul(zen, mix(ONE, [0.84, 0.94, 1.0], st * 0.6));
  hor = mul(hor, mix(ONE, [0.86, 1.0, 0.95], st * 0.55));
  // falling rain: flatter, darker, cool blue-grey light
  zen = mix(zen, scale([0.93, 0.97, 1.03], luma(zen) * 0.88), rn * 0.35);
  hor = mix(hor, scale([0.93, 0.97, 1.03], luma(hor) * 0.9), rn * 0.3);
  // milky aerosol haze
  const hazeTint = mix([1.02, 1.0, 0.96], [1.12, 0.96, 0.82], warm * 0.6);
  zen = mix(zen, scale(hazeTint, luma(zen) * 1.15 + luma(hor) * 0.2), hz * 0.6);
  hor = mix(hor, scale(hazeTint, luma(hor) * 1.12), hz * 0.45);
  // fog veil
  const fogG = scale([0.95, 0.98, 1.03], (luma(zen) * 0.4 + luma(hor) * 0.6) * 1.1);
  zen = mix(zen, fogG, fg * 0.5);
  hor = mix(hor, fogG, fg * 0.6);
  // direct sunlight is blocked by cloud decks / fog and reddened by haze
  let sun = scale(p.sun, (1 - oc * 0.82) * (1 - st * 0.5) * (1 - fg * 0.6) * (1 - hz * 0.3) * (1 - rn * 0.3));
  sun = mul(sun, mix(ONE, [1.0, 0.84, 0.64], hz * 0.6));
  return { ...p, zenith: zen, horizon: hor, sun, exposure: p.exposure * (1 + oc * 0.22 + fg * 0.1 + st * 0.12) };
}

export function cssColor(c: Vec3) {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}
