import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { EnvironmentEngine, TIME_PRESETS, type EngineSnapshot } from './env/engine';
import { computeAstro } from './env/astro';
import { samplePalette, cssColor } from './env/palette';
import { QUALITY, ORDER, detectQuality } from './env/performance';
import { WEATHER_ORDER, WEATHER_BLURB, forecastAt, compass, type ParamKey } from './env/weather';
import { WeatherIcon, MoonIcon, SoundIcon, BoltIcon } from './ui/icons';
import { Slider, Stat, Chip } from './ui/controls';

type Tab = 'weather' | 'time' | 'env' | 'perf';
const TABS: { id: Tab; label: string }[] = [
  { id: 'weather', label: 'Weather' }, { id: 'time', label: 'Time' }, { id: 'env', label: 'Environment' }, { id: 'perf', label: 'Quality' },
];
const SPEEDS = [1, 60, 300, 900, 3600];
const HOUR = 3600000;
const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const fmtVis = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);
const rainWord = (mm: number) => (mm < 0.5 ? 'drizzle' : mm < 2.5 ? 'light' : mm < 10 ? 'moderate' : mm < 30 ? 'heavy' : 'torrential');

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eng = useRef<EnvironmentEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('weather');
  const [open, setOpen] = useState(() => window.innerWidth > 800);
  const [autoQ, setAutoQ] = useState(true);
  const [sound, setSound] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [transition, setTransition] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const start = new Date();
    start.setHours(17, 20, 0, 0);
    let e: EnvironmentEngine;
    try {
      e = new EnvironmentEngine(canvas, detectQuality(), start.getTime());
    } catch {
      setErr('WebGL is not available on this device or browser.');
      return;
    }
    eng.current = e;
    e.setWeather('Fair', true);
    e.onUpdate = setSnap;
    e.start();
    return () => { e.dispose(); eng.current = null; };
  }, []);

  // Space toggles play / pause
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space' || (ev.target as HTMLElement | null)?.tagName === 'INPUT') return;
      ev.preventDefault();
      const e = eng.current;
      if (e) e.setPlaying(!e.playing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // camera drag
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onDown = (ev: RPointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: ev.clientX, y: ev.clientY };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const onMove = (ev: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current, e = eng.current;
    if (!d || !e) return;
    const k = 2.2 / window.innerHeight;
    e.rotate((ev.clientX - d.x) * k, (ev.clientY - d.y) * k);
    drag.current = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = () => { drag.current = null; };

  // timeline gradient from the baked palette (per day)
  const dayKey = snap ? Math.floor(snap.t / 86400000) : 0;
  const grad = useMemo(() => {
    const d = new Date(dayKey * 86400000);
    const stops: string[] = [];
    for (let i = 0; i <= 24; i += 2) {
      d.setHours(i % 24, 0, 0, 0);
      const p = samplePalette(computeAstro(d).sunElev);
      stops.push(`${cssColor(p.horizonS)} ${(i / 24) * 100}%`);
    }
    return `linear-gradient(90deg, ${stops.join(',')})`;
  }, [dayKey]);

  // deterministic forecast strip
  const fcKey = snap ? Math.floor(snap.t / HOUR) : 0;
  const forecast = useMemo(
    () => Array.from({ length: 8 }, (_, i) => { const t = (fcKey + 1 + i * 3) * HOUR; return { t, name: forecastAt(t) }; }),
    [fcKey],
  );

  const setParam = (k: ParamKey, v: number) => {
    eng.current?.setParam(k, v);
    setSnap(s => (s ? { ...s, params: { ...s.params, [k]: v } } : s));
  };

  const toggleSound = async () => {
    const e = eng.current;
    if (!e) return;
    const next = !sound;
    setSound(next);
    e.setVolume(volume);
    await e.setSound(next);
  };

  const resetEnv = () => {
    const e = eng.current;
    if (!e) return;
    e.setWeather('Fair');
    (['sunI', 'moonI', 'stars'] as const).forEach(k => setParam(k, 1));
    setParam('windDir', 40);
  };

  if (err) {
    return <div className="fixed inset-0 bg-slate-950 text-white/80 flex items-center justify-center p-6 text-center">{err}</div>;
  }

  const p = snap?.params;
  const a = snap?.astro;
  const mins = a ? a.hours * 60 : 0;
  const Q = snap ? QUALITY[snap.quality] : QUALITY.Low;
  const fpsClass = !snap ? '' : snap.fps > snap.targetFps * 0.85 ? 'text-emerald-300' : snap.fps > snap.targetFps * 0.55 ? 'text-amber-300' : 'text-rose-300';

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none font-sans text-white">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />

      {snap && p && a && (
        <>
          {/* HUD — left */}
          <div className="absolute top-3 left-3 max-w-[calc(100vw_-_9.5rem)] backdrop-blur-md bg-black/25 border border-white/10 rounded-2xl px-4 py-3 shadow-xl">
            <div className="text-3xl font-light tracking-wider tabular-nums leading-none">{fmt(mins)}</div>
            <div className="text-xs text-white/60 mt-1">
              {new Date(snap.t).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <WeatherIcon name={snap.weather} className="w-7 h-7 shrink-0 text-white/90" />
              <div className="text-xs leading-tight min-w-0">
                <div className="text-white/90 flex items-center gap-1.5">
                  {snap.weather}
                  {snap.auto && <span className="px-1 rounded bg-sky-300/25 text-[9px] uppercase tracking-wider">Auto</span>}
                </div>
                <div className="text-white/50 tabular-nums truncate">
                  {Math.round(snap.tempC)}°C · {compass(p.windDir)} {Math.round(snap.windKmh)} km/h · {fmtVis(snap.visKm)}
                </div>
                <div className="text-white/50 tabular-nums truncate">
                  {snap.rainMmH > 0
                    ? `Rain ${snap.rainMmH.toFixed(snap.rainMmH < 10 ? 1 : 0)} mm/h · ${rainWord(snap.rainMmH)}`
                    : p.rain > 0.02 ? 'Dry spell between showers' : 'No precipitation'}
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <MoonIcon age={a.moonAge} />
              <div className="leading-tight">
                <div className="text-white/90">{a.phaseName}</div>
                <div className="text-white/50">{Math.round(a.moonIllum * 100)}% lit</div>
              </div>
            </div>
            {snap.rainbow > 0.12 && (
              <button onClick={() => eng.current?.lookAt(snap.antiSolarAz, 0.2)}
                className="mt-2 w-full text-left text-[11px] px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20">
                <span className="rainbow-text font-semibold">Rainbow</span> to the {compass(snap.antiSolarAz)} · look ›
              </button>
            )}
          </div>

          {/* HUD — right */}
          <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
            <div className="pointer-events-none backdrop-blur-md bg-black/25 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-white/70 tabular-nums text-right">
              <div className={fpsClass}>{snap.fps.toFixed(0)} FPS</div>
              <div>{snap.quality} · {snap.res}</div>
              <div>Sun {a.sunElev.toFixed(1)}° / {a.sunAz.toFixed(0)}°</div>
            </div>
            <button onClick={toggleSound}
              className={`flex items-center gap-1.5 backdrop-blur-md border border-white/10 rounded-xl px-2.5 py-1.5 text-[11px] ${sound ? 'bg-sky-300/25 text-white' : 'bg-black/25 text-white/75 hover:bg-black/40'}`}>
              <SoundIcon on={sound} />
              {sound ? 'Sound on' : 'Sound off'}
            </button>
          </div>

          {/* Control panel */}
          <div className="absolute bottom-0 inset-x-0 p-2 sm:p-3 flex justify-center pointer-events-none"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
            <div className="w-full max-w-3xl pointer-events-auto backdrop-blur-xl bg-slate-900/45 border border-white/10 rounded-2xl shadow-2xl">
              <div className="flex items-center gap-2 px-3 pt-3">
                <button onClick={() => eng.current?.setPlaying(!snap.playing)} aria-label={snap.playing ? 'Pause' : 'Play'}
                  className="w-9 h-9 shrink-0 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-sm">
                  {snap.playing ? '❚❚' : '▶'}
                </button>
                <div className="relative flex-1 h-9 flex items-center">
                  <div className="absolute inset-x-0 h-2 rounded-full" style={{ background: grad }} />
                  <input type="range" min={0} max={1439} step={1} value={Math.floor(mins)} aria-label="Time of day"
                    onChange={e => eng.current?.setMinutes(parseFloat(e.target.value))} className="timeline relative w-full" />
                </div>
                <button onClick={() => setOpen(!open)} aria-label="Toggle panel"
                  className="px-2 h-9 shrink-0 rounded-lg bg-white/10 hover:bg-white/20 text-xs">{open ? '▾' : '▴'}</button>
              </div>
              <div className="flex justify-between px-12 text-[10px] text-white/40 tabular-nums">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </div>

              {open && (
                <div className="px-3 pb-3">
                  <div className="flex gap-1 my-2 overflow-x-auto">
                    {TABS.map(t => (
                      <button key={t.id} onClick={() => setTab(t.id)}
                        className={`px-3 py-1 rounded-lg text-xs whitespace-nowrap ${tab === t.id ? 'bg-white/25' : 'bg-white/5 hover:bg-white/10 text-white/70'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="max-h-[42vh] overflow-y-auto overscroll-contain pr-1">
                    {tab === 'weather' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                          {WEATHER_ORDER.map(w => (
                            <Chip key={w} active={!snap.auto && snap.weather === w} onClick={() => eng.current?.setWeather(w)}
                              title={WEATHER_BLURB[w]} className="flex items-center gap-1.5 px-2 py-1.5">
                              <WeatherIcon name={w} className="w-4 h-4 shrink-0" />
                              <span className="truncate">{w === 'Thunderstorm' ? 'Storm' : w}</span>
                            </Chip>
                          ))}
                          <Chip active={snap.auto} onClick={() => eng.current?.setAutoWeather(!snap.auto)}
                            title="Deterministic forecast driven by the simulated date & time" className="flex items-center gap-1.5 px-2 py-1.5">
                            <span className="w-4 h-4 shrink-0 grid place-items-center rounded-full border border-current text-[9px] font-bold">A</span>
                            <span className="truncate">Dynamic</span>
                          </Chip>
                        </div>
                        <p className="text-[11px] text-white/55">
                          {snap.auto
                            ? 'Dynamic weather follows the forecast below. It is a pure function of the simulated date and time, so scrubbing and replays always give the same weather.'
                            : snap.weather === 'Custom'
                              ? 'Custom mix. Every value blends smoothly, so there is no popping.'
                              : WEATHER_BLURB[snap.weather]}
                        </p>

                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Forecast · next 24 h</div>
                          <div className="grid grid-cols-8 gap-1">
                            {forecast.map(f => (
                              <div key={f.t} title={f.name} className="flex flex-col items-center gap-0.5 rounded-lg bg-white/5 py-1.5">
                                <span className="text-[10px] text-white/50 tabular-nums">{String(new Date(f.t).getHours()).padStart(2, '0')}</span>
                                <WeatherIcon name={f.name} className="w-4 h-4 text-white/85" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                          <Slider label="Rain" value={p.rain} min={0} max={1} onChange={v => setParam('rain', v)} />
                          <Slider label="Storm darkness" value={p.storm} min={0} max={1} onChange={v => setParam('storm', v)} />
                          <Slider label="Overcast deck" value={p.overcast} min={0} max={1} onChange={v => setParam('overcast', v)} />
                          <Slider label="Sea fog" value={p.fog} min={0} max={1} onChange={v => setParam('fog', v)} />
                          <Slider label="Wind strength" value={p.wind} min={0} max={1} display={`${Math.round(4 + p.wind * 82)} km/h`} onChange={v => setParam('wind', v)} />
                          <Slider label="Gustiness" value={p.gust} min={0} max={1} onChange={v => setParam('gust', v)} />
                          <Slider label="Lightning" value={p.lightning} min={0} max={1} onChange={v => setParam('lightning', v)} />
                          <Slider label="Transition time" value={transition} min={0.1} max={3} display={`${transition.toFixed(1)}×`}
                            onChange={v => { setTransition(v); eng.current?.setTransition(v); }} />
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button onClick={() => eng.current?.strike()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-200/15 hover:bg-amber-200/25 text-amber-100 text-xs">
                            <BoltIcon /> Trigger lightning
                          </button>
                          <div className="flex-1 min-w-[160px]">
                            <Slider label="Ambient volume" value={volume} min={0} max={1}
                              display={sound ? `${Math.round(volume * 100)}%` : 'sound off'}
                              onChange={v => { setVolume(v); eng.current?.setVolume(v); }} />
                          </div>
                        </div>
                      </div>
                    )}

                    {tab === 'time' && (
                      <div className="space-y-3">
                        <div className="grid grid-cols-4 gap-1.5">
                          {TIME_PRESETS.map(t => <Chip key={t} onClick={() => eng.current?.goToPreset(t)} className="py-1.5">{t}</Chip>)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-white/60">Speed</span>
                          {SPEEDS.map(s => (
                            <Chip key={s} active={snap.speed === s} onClick={() => eng.current?.setSpeed(s)} className="px-2 py-1">{s}×</Chip>
                          ))}
                          <span className="ml-auto text-white/60">Date</span>
                          <Chip onClick={() => eng.current?.shiftDays(-1)} className="px-2 py-1">−1d</Chip>
                          <Chip onClick={() => eng.current?.shiftDays(1)} className="px-2 py-1">+1d</Chip>
                          <Chip onClick={() => eng.current?.shiftDays(7)} className="px-2 py-1">+1w</Chip>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                          <Stat k="Sun elevation" v={`${a.sunElev.toFixed(1)}°`} />
                          <Stat k="Sun azimuth" v={`${a.sunAz.toFixed(0)}° ${compass(a.sunAz)}`} />
                          <Stat k="Moon elevation" v={`${a.moonElev.toFixed(1)}°`} />
                          <Stat k="Moon age" v={`${(a.moonAge * 29.53).toFixed(1)} d`} />
                        </div>
                      </div>
                    )}

                    {tab === 'env' && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                        <Slider label="Cloud coverage" value={p.cover} min={0} max={1} onChange={v => setParam('cover', v)} />
                        <Slider label="Cloud speed" value={p.cloudSpeed} min={0} max={2} onChange={v => setParam('cloudSpeed', v)} />
                        <Slider label="Wind direction" value={p.windDir} min={0} max={359} step={1}
                          display={`${Math.round(p.windDir)}° ${compass(p.windDir)}`} onChange={v => setParam('windDir', v)} />
                        <Slider label="Wave intensity" value={p.wave} min={0} max={1.5} onChange={v => setParam('wave', v)} />
                        <Slider label="Atmospheric haze" value={p.haze} min={0} max={1} onChange={v => setParam('haze', v)} />
                        <Slider label="Sun intensity" value={p.sunI} min={0} max={2} onChange={v => setParam('sunI', v)} />
                        <Slider label="Moon intensity" value={p.moonI} min={0} max={2} onChange={v => setParam('moonI', v)} />
                        <Slider label="Star visibility" value={p.stars} min={0} max={2} onChange={v => setParam('stars', v)} />
                        <button onClick={resetEnv} className="col-span-2 sm:col-span-4 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20">
                          Reset environment
                        </button>
                      </div>
                    )}

                    {tab === 'perf' && (
                      <div className="space-y-2 text-xs">
                        <div className="grid grid-cols-4 gap-1.5">
                          {ORDER.map(q => (
                            <Chip key={q} active={snap.quality === q} onClick={() => eng.current?.setQuality(q)} className="py-1.5">{q}</Chip>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-white/80">
                          <input type="checkbox" checked={autoQ} className="accent-sky-300"
                            onChange={e => { setAutoQ(e.target.checked); eng.current?.setAutoQuality(e.target.checked); }} />
                          Auto-degrade quality tier if performance drops
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                          <Stat k="Render scale" v={`${Math.round(snap.scale * 100)}%`} />
                          <Stat k="Frame target" v={`${snap.targetFps} FPS`} />
                          <Stat k="Wave octaves" v={`${Q.waves}`} />
                          <Stat k="Cloud octaves" v={`${Q.cloudOct}`} />
                          <Stat k="Rain depth layers" v={`${Q.precipLayers}`} />
                          <Stat k="Rain ripples" v={Q.rippleGrids > 0 ? `${Q.rippleGrids} grid${Q.rippleGrids > 1 ? 's' : ''}` : 'Off'} />
                          <Stat k="Scud & storm detail" v={Q.stormDetail ? 'On' : 'Off'} />
                          <Stat k="Cloud shadows on sea" v={Q.cloudShadow ? 'On' : 'Off'} />
                          <Stat k="Bolt branches" v={`${Q.boltBranches}`} />
                          <Stat k="Cloud reflections" v={Q.reflClouds ? 'On' : 'Off'} />
                          <Stat k="Fog wisps" v={Q.fogDetail ? 'On' : 'Off'} />
                          <Stat k="Draw calls" v="1" />
                        </div>
                        <p className="text-white/50 text-[11px]">
                          Everything is drawn in one analytic shader pass, with no ray marching, textures or particles. Weather features cost nothing while switched off.
                          Rain uses cylinder layers around the camera instead of particles. The cost is fixed however heavy the rain.
                          Dynamic resolution holds the frame target, and if lowering resolution doesn't help, the display's refresh cap is accepted instead of dropping quality.
                          Drag the view to look around. Space toggles play and pause.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
