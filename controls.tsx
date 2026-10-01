import type { ReactNode } from 'react';

export function Slider({ label, value, min, max, step = 0.01, display, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; display?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-[11px] text-white/60 mb-1">
        <span>{label}</span>
        <span className="text-white/90 tabular-nums">{display ?? value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-sky-300" />
    </label>
  );
}

export function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-white/5 rounded-lg px-2 py-1.5">
      <div className="text-white/50">{k}</div>
      <div className="text-white/90 tabular-nums">{v}</div>
    </div>
  );
}

export function Chip({ active, onClick, children, className = '', title }: {
  active?: boolean; onClick: () => void; children: ReactNode; className?: string; title?: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`rounded-lg text-xs transition-colors ${active ? 'bg-sky-300/35 text-white ring-1 ring-sky-200/40' : 'bg-white/10 hover:bg-white/20 text-white/85'} ${className}`}>
      {children}
    </button>
  );
}
