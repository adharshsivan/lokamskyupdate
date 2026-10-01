// Performance manager: quality tiers, device detection, dynamic resolution & auto-degradation.
export type QualityName = 'Low' | 'Medium' | 'High' | 'Ultra';

export interface QualitySettings {
  name: QualityName;
  maxDpr: number;
  baseScale: number;
  waves: number;
  cloudOct: number;
  /** cloud self-shadowing + cloud shadows drifting across the sea */
  cloudShadow: boolean;
  reflClouds: boolean;
  cirrus: boolean;
  starLayers: number;
  /** rain streak depth layers */
  precipLayers: number;
  /** distance (m) of the nearest rain layer — Low starts further out: fewer, finer streaks */
  rainR0: number;
  /** lightning branch count */
  boltBranches: number;
  /** scud layer, stratocumulus deck structure, fibrous rain shafts */
  stormDetail: boolean;
  /** raindrop ripple grids on the ocean surface (0 = off) */
  rippleGrids: number;
  /** drifting fog wisps close to the camera */
  fogDetail: boolean;
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  Low: {
    name: 'Low', maxDpr: 1, baseScale: 0.6, waves: 5, cloudOct: 3, cloudShadow: false, reflClouds: false, cirrus: false,
    starLayers: 1, precipLayers: 2, rainR0: 2.2, boltBranches: 0, stormDetail: false, rippleGrids: 0, fogDetail: false,
  },
  Medium: {
    name: 'Medium', maxDpr: 1.25, baseScale: 0.8, waves: 8, cloudOct: 4, cloudShadow: true, reflClouds: false, cirrus: false,
    starLayers: 1, precipLayers: 3, rainR0: 1.6, boltBranches: 1, stormDetail: true, rippleGrids: 1, fogDetail: false,
  },
  High: {
    name: 'High', maxDpr: 1.5, baseScale: 1, waves: 12, cloudOct: 5, cloudShadow: true, reflClouds: true, cirrus: true,
    starLayers: 2, precipLayers: 4, rainR0: 1.3, boltBranches: 2, stormDetail: true, rippleGrids: 2, fogDetail: true,
  },
  Ultra: {
    name: 'Ultra', maxDpr: 2, baseScale: 1, waves: 18, cloudOct: 6, cloudShadow: true, reflClouds: true, cirrus: true,
    starLayers: 2, precipLayers: 5, rainR0: 1.3, boltBranches: 3, stormDetail: true, rippleGrids: 2, fogDetail: true,
  },
};
export const ORDER: QualityName[] = ['Low', 'Medium', 'High', 'Ultra'];

export function detectQuality(): QualityName {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 700;
  if (mobile) return 'Low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'High' : 'Medium';
}

/**
 * Measures frame rate in 0.5 s windows and scales the render resolution to hold the target.
 * If resolution scaling does not help (display refresh cap such as iOS Low Power Mode at 30 Hz),
 * the target is adapted instead of needlessly degrading quality.
 */
export class PerformanceManager {
  dynScale = 1;
  fps = 60;
  target = 60;
  autoTier = true;
  onDowngrade: (() => void) | null = null;
  private acc = 0;
  private frames = 0;
  private slowStreak = 0;
  private fpsAtFull = 0;

  reset() {
    this.acc = 0; this.frames = 0; this.slowStreak = 0; this.dynScale = 1; this.fpsAtFull = 0;
  }

  /** Call every frame with the real frame delta (seconds). */
  tick(dt: number) {
    this.acc += dt; this.frames++;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc; this.acc = 0; this.frames = 0;
    if (this.dynScale >= 0.999) this.fpsAtFull = this.fps;
    if (this.fps < this.target * 0.84) {
      if (this.dynScale > 0.5) {
        this.dynScale = Math.max(0.5, this.dynScale - 0.1);
      } else if (this.fpsAtFull > 0 && this.fps < this.fpsAtFull * 1.08) {
        // Quartering the pixel count did not help: refresh-capped or CPU bound. Accept the cap.
        this.target = Math.max(24, Math.round(this.fps));
        this.dynScale = 1; this.slowStreak = 0;
      } else if (++this.slowStreak >= 4 && this.autoTier && this.onDowngrade) {
        this.slowStreak = 0; this.dynScale = 0.8; this.onDowngrade();
      }
    } else if (this.fps > this.target * 0.95) {
      this.dynScale = Math.min(1, this.dynScale + 0.05); this.slowStreak = 0;
    }
  }
}
