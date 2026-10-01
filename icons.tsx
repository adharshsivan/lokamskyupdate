import type { ReactNode } from 'react';
import type { WeatherName } from '../env/weather';

const CLOUD = 'M7.5 18.5h9.2a3.8 3.8 0 0 0 .4-7.58A5.2 5.2 0 0 0 7.1 11.6a3.45 3.45 0 0 0 .4 6.9z';
const MASK = 'rgba(15,23,42,0.85)';

function Sun({ cx = 12, cy = 12, r = 4, ray = 2.2 }: { cx?: number; cy?: number; r?: number; ray?: number }) {
  const lines: ReactNode[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a), r0 = r + 1.7;
    lines.push(<line key={i} x1={cx + c * r0} y1={cy + s * r0} x2={cx + c * (r0 + ray)} y2={cy + s * (r0 + ray)} />);
  }
  return <g><circle cx={cx} cy={cy} r={r} />{lines}</g>;
}

export function WeatherIcon({ name, className = 'w-5 h-5' }: { name: WeatherName | 'Custom'; className?: string }) {
  const up = 'translate(0 -3)';
  let body: ReactNode = null;
  switch (name) {
    case 'Clear':
      body = <Sun />; break;
    case 'Fair':
    case 'Custom':
      body = <><Sun cx={9} cy={8.5} r={3} ray={1.6} /><path d={CLOUD} transform="translate(2 2)" fill={MASK} /></>; break;
    case 'Overcast':
      body = <><path d={CLOUD} transform="translate(-2.5 -4) scale(.9)" opacity={0.5} /><path d={CLOUD} transform="translate(1.5 0)" fill={MASK} /></>; break;
    case 'Haze':
      body = <><Sun cy={9} r={3.4} ray={1.6} /><path d="M4 16h16M6 19.5h12M8 23h8" opacity={0.8} /></>; break;
    case 'Fog':
      body = <><path d={CLOUD} transform={up} /><path d="M4 18.5h16M6 21.5h12" /></>; break;
    case 'Showers':
      body = <><Sun cx={8} cy={7} r={2.6} ray={1.5} /><path d={CLOUD} transform="translate(1.5 -2)" fill={MASK} /><path d="M10 19l-1 2.5M14 19l-1 2.5" /></>; break;
    case 'Rain':
      body = <><path d={CLOUD} transform={up} /><path d="M8.5 18.5l-1.2 3M12.5 18.5l-1.2 3M16.5 18.5l-1.2 3" /></>; break;
    case 'Thunderstorm':
      body = <><path d={CLOUD} transform={up} fill="currentColor" fillOpacity={0.18} /><path d="M13 15.5l-2.5 3.8h3l-2.2 3.7" /><path d="M8 18.5l-1 2.5M17 18.5l-1 2.5" /></>; break;
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {body}
    </svg>
  );
}

export function MoonIcon({ age, size = 28 }: { age: number; size?: number }) {
  // terminator drawn as an ellipse from the computed phase — not an image swap
  const r = 14, ph = age * 2 * Math.PI, k = Math.cos(ph);
  const waxing = age < 0.5;
  const rx = Math.abs(k) * r;
  const lit = `M ${r} 0 A ${r} ${r} 0 0 ${waxing ? 1 : 0} ${r} ${2 * r} A ${rx} ${r} 0 0 ${(k > 0) === waxing ? 0 : 1} ${r} 0`;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <circle cx={r} cy={r} r={r} fill="#1e2536" />
      <path d={lit} fill="#e8ecf2" />
    </svg>
  );
}

export function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" fillOpacity={0.2} />
      {on ? <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
      <path d="M13.5 2 5 13.5h5.5L9 22l9-12.5h-5.6z" />
    </svg>
  );
}
