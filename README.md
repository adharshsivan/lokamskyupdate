# Environment system: integration notes

Each module stands alone and has no React dependency. `engine.ts` is only the default orchestrator.

| Module | Responsibility |
| --- | --- |
| `astro.ts` | Deterministic sun and moon positions, real lunar phase, sidereal star rotation |
| `palette.ts` | Precomputed sky and sun colours per sun elevation, plus weather grading (`applyWeather`) |
| `weather.ts` | Presets, smooth transitions that rise and fall at different rates, seekable forecast (`forecastAt`), wind gusts (`gustAt`), passing shower cells (`showerAt`), HUD stats |
| `lightning.ts` | Seeded strike scheduler, stepped leader, multi-stroke flicker envelopes, bolt/sheet types, thunder events |
| `audio.ts` | Procedural Web Audio ambience (rain, wind, sea, thunder); no asset files |
| `performance.ts` | Low/Medium/High/Ultra tiers, dynamic resolution, refresh-cap aware auto-degrade |
| `shaders.ts` / `renderer.ts` | One draw call per frame, a tier-specific shader variant, WebGL context-loss recovery |

```ts
const env = new EnvironmentEngine(canvas, detectQuality(), Date.now());
env.start();
env.setWeather('Thunderstorm');       // smooth transition; set the 2nd arg to true for instant
env.setAutoWeather(true);             // deterministic forecast driven by simulated time
env.goToPreset('Golden Hour');        // eased time jump
env.setParam('rain', 0.4);            // any EnvParams key
env.strike();                         // manual lightning
await env.setSound(true);             // call from a user gesture
```

**Driving your own renderer.** Each frame, read `env.live`, `env.params`, `env.lightning.flash` and `computeAstro(date)`. `env.live` holds the weather as it actually is at the camera, after gusts and passing showers: rain rate, gusting wind, storm darkness, spray and so on. Use it for gameplay, particles or physics.

Feed `applyWeather(samplePalette(elev), { ...params, storm: live.storm, rain: live.rain }, elev).sun` to your directional light, and use `zenith`/`horizon` as the ambient and fog colours. That keeps your scene lighting consistent with the sky.

**Weather features.**
- Rain is drawn on cylinder layers around the camera. Streak length follows each drop's real fall speed, near drops are blurred as if out of focus, and drops take their colour from the sky.
- Distant rain shafts lean with the wind and follow the cloud field.
- Rain makes rings and splashes on the water, and wind tears spray off the sea.
- Storms add fast low scud under the deck and lightning that lights the clouds from inside.
- Sea fog forms drifting banks, and a fogbow appears when the sun shines on thin fog.
- Thin cloud shows a 22° halo and a watery sun. Cloud shadows drift across the sea.
