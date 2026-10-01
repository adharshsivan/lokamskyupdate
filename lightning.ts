// Lightning system — seeded (deterministic) strike scheduling, multi-stroke flicker envelopes,
// cloud-to-ground bolts vs. intra-cloud sheet flashes, and thunder events with distance delay.
// Zero allocations per frame (stroke pools are reused).
import type { Vec3 } from './astro';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StrikeKind = 'bolt' | 'sheet';
export interface StrikeEvent { distKm: number; kind: StrikeKind; delay: number; }

const MAX_STROKES = 4;

export class LightningSystem {
  /** global flash intensity for the shader (HDR) */
  flash = 0;
  /** visible bolt channel intensity */
  bolt = 0;
  kind: StrikeKind = 'bolt';
  distKm = 6;
  seed = 0;
  /** bolt top as tangent of elevation (cloud base height / distance) */
  top = 0.25;
  /** horizontal unit direction (x = east, z = north) */
  az: [number, number] = [0, 1];
  /** direction of the flash centre inside the cloud */
  dir: Vec3 = [0, 0.3, 0.95];
  /** stepped-leader progress: the channel grows down from the cloud base (1 = fully connected) */
  leader = 1;
  onStrike: ((e: StrikeEvent) => void) | null = null;

  private rng = mulberry32(90210);
  private timer = 0;
  private next = 2.5;
  private age = 99;
  private leaderDur = 0;
  private strokeT = new Float32Array(MAX_STROKES);
  private strokeA = new Float32Array(MAX_STROKES);
  private strokes = 0;

  /** @param spread half-angle (rad) around the view direction where most strikes land */
  update(dt: number, rate: number, camYaw: number, spread = 0.75) {
    this.age += dt;
    if (rate > 0.005) {
      this.timer += dt;
      if (this.timer >= this.next) {
        this.timer = 0;
        this.trigger(camYaw, spread);
        this.next = this.interval(rate);
      }
    } else {
      this.timer = 0;
    }
    let f = 0, b = 0, leader = 1;
    if (this.age < this.leaderDur) {
      // faint stepped leader works its way down before the first return stroke
      leader = this.age / this.leaderDur;
      b = 0.22; f = 0.035;
    } else if (this.age < 3) {
      const t0 = this.age - this.leaderDur;
      for (let i = 0; i < this.strokes; i++) {
        const t = t0 - this.strokeT[i];
        if (t >= 0) {
          f += this.strokeA[i] * Math.exp(-t / 0.075);
          b += this.strokeA[i] * Math.exp(-t / 0.11);
        }
      }
    }
    this.leader = leader;
    const falloff = Math.min(1.6, 3.5 / this.distKm);
    this.flash = f * falloff * (this.kind === 'sheet' ? 0.85 : 1);
    this.bolt = this.kind === 'bolt' ? Math.min(b, 1.5) : 0;
  }

  private interval(rate: number) {
    const mean = 14 - 11.5 * Math.min(1, rate);
    return Math.max(0.7, -Math.log(1 - this.rng()) * mean);
  }

  /** Fire a strike now (biased toward the camera view so it is usually seen). */
  trigger(camYaw: number, spread = 0.75) {
    const r = this.rng;
    this.kind = r() < 0.6 ? 'bolt' : 'sheet';
    const yaw = r() < 0.75 ? camYaw + (r() - 0.5) * 2 * spread : r() * Math.PI * 2;
    this.az = [Math.sin(yaw), Math.cos(yaw)];
    this.distKm = 2.5 + Math.pow(r(), 0.8) * 11;
    this.top = Math.min(0.55, Math.max(0.08, 1.4 / this.distKm));
    this.seed = Math.floor(r() * 1000);
    const e = Math.atan(this.top * (this.kind === 'bolt' ? 0.85 : 1.25));
    this.dir = [this.az[0] * Math.cos(e), Math.sin(e), this.az[1] * Math.cos(e)];
    this.strokes = 1 + Math.floor(r() * 3.2);
    let t = 0;
    for (let i = 0; i < this.strokes; i++) {
      this.strokeT[i] = t;
      this.strokeA[i] = i === 0 ? 1 : 0.45 + r() * 0.5;
      t += 0.05 + r() * 0.13;
    }
    this.leaderDur = this.kind === 'bolt' ? 0.045 + r() * 0.05 : 0;
    this.age = 0;
    // stylised speed of sound: keeps the flash→thunder gap readable (≈ real ratio compressed ×7)
    this.onStrike?.({ distKm: this.distKm, kind: this.kind, delay: this.leaderDur + 0.35 + this.distKm * 0.42 });
  }
}
