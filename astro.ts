// Time & astronomy system — deterministic, pure functions of the simulated date.
export const LATITUDE = 38;
const D2R = Math.PI / 180;

export type Vec3 = [number, number, number];

export interface SkyAstro {
  sunDir: Vec3; moonDir: Vec3;
  sunElev: number; sunAz: number;
  moonElev: number; moonAz: number;
  moonAge: number; moonIllum: number; phaseName: string;
  sidereal: number; hours: number;
}

export function dayOfYear(d: Date) {
  const start = new Date(d.getFullYear(), 0, 0);
  return (d.getTime() - start.getTime()) / 86400000;
}

function dirFrom(Hdeg: number, declDeg: number): Vec3 {
  const phi = LATITUDE * D2R, H = Hdeg * D2R, dl = declDeg * D2R;
  const east = -Math.cos(dl) * Math.sin(H);
  const north = Math.cos(phi) * Math.sin(dl) - Math.sin(phi) * Math.cos(dl) * Math.cos(H);
  const up = Math.sin(phi) * Math.sin(dl) + Math.cos(phi) * Math.cos(dl) * Math.cos(H);
  return [east, up, north];
}

export function phaseName(age: number) {
  const a = age * 29.53;
  if (a < 1.2 || a > 28.3) return 'New Moon';
  if (a < 6.4) return 'Waxing Crescent';
  if (a < 8.4) return 'First Quarter';
  if (a < 13.8) return 'Waxing Gibbous';
  if (a < 15.8) return 'Full Moon';
  if (a < 21.1) return 'Waning Gibbous';
  if (a < 23.1) return 'Last Quarter';
  return 'Waning Crescent';
}

/**
 * @param hoursOverride optional fixed local time-of-day (used while tweening across days so the
 * sun does not spin through several day/night cycles — keeps transitions free of strobing).
 */
export function computeAstro(date: Date, hoursOverride?: number): SkyAstro {
  const hours = hoursOverride ?? (date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3.6e6);
  const N = dayOfYear(date);
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + N)) / 365);
  const H = (hours - 12) * 15;
  const sunDir = dirFrom(H, decl);
  const jd = date.getTime() / 86400000 + 2440587.5;
  let age = ((jd - 2451550.1) / 29.530588853) % 1;
  if (age < 0) age += 1;
  const moonH = H - age * 360;
  const moonDecl = decl * Math.cos(age * 2 * Math.PI) + 5.1 * Math.sin(jd * 0.2299);
  const moonDir = dirFrom(moonH, moonDecl);
  const el = (v: Vec3) => Math.asin(Math.max(-1, Math.min(1, v[1]))) / D2R;
  const az = (v: Vec3) => ((Math.atan2(v[0], v[2]) / D2R) + 360) % 360;
  return {
    sunDir, moonDir,
    sunElev: el(sunDir), sunAz: az(sunDir),
    moonElev: el(moonDir), moonAz: az(moonDir),
    moonAge: age, moonIllum: (1 - Math.cos(age * 2 * Math.PI)) / 2,
    phaseName: phaseName(age),
    sidereal: (hours / 24 + N / 365.25) * 2 * Math.PI,
    hours,
  };
}

/** Find minute-of-day where sun crosses an elevation (morning or evening). */
export function findSunTime(date: Date, elev: number, morning: boolean): number {
  const d = new Date(date);
  let prev = -999, best = morning ? 360 : 1140;
  for (let m = 0; m <= 1440; m += 2) {
    d.setHours(0, m, 0, 0);
    const e = computeAstro(d).sunElev;
    if (prev !== -999) {
      if (morning && prev < elev && e >= elev) { best = m; break; }
      if (!morning && prev > elev && e <= elev) best = m;
    }
    prev = e;
  }
  return best;
}
