import { useEffect, useMemo, useRef, useState } from 'react';
import { price as fp, usd, dateFmt, qty } from '../format';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null); const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(240, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Donut({ items, size = 210, center }: { items: { label: string; value: number; color: string }[]; size?: number; center?: React.ReactNode }) {
  const tot = items.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  const r = size / 2 - 14, c = size / 2, C = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs><filter id="dglow"><feGaussianBlur stdDeviation="3.5" /></filter></defs>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="18" />
        {items.map((x, i) => {
          const f = Math.max(0, x.value) / tot; const dash = Math.max(0, f * C - (f > 0.02 ? 3 : 0)); const off = -acc * C; acc += f;
          return <g key={i}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={x.color} strokeWidth="18" strokeDasharray={`${dash} ${C}`} strokeDashoffset={off} transform={`rotate(-90 ${c} ${c})`} opacity=".45" filter="url(#dglow)" />
            <circle cx={c} cy={c} r={r} fill="none" stroke={x.color} strokeWidth="16" strokeDasharray={`${dash} ${C}`} strokeDashoffset={off} transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt" />
          </g>;
        })}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  );
}

const tickP = (v: number) => v >= 1 ? '$' + v.toFixed(0) : '$' + v.toFixed(Math.max(0, Math.floor(-Math.log10(v) + 1e-9)) + 1).replace(/0+$/, '').replace(/\.$/, '');
const niceLogTicks = (lo: number, hi: number) => {
  const out: number[] = []; const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
  for (let e = a; e <= b; e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.9 && v <= hi * 1.1) out.push(v); }
  return out.length > 7 ? out.filter((_, i) => i % 2 === 0) : out;
};

export function BuyChart({ buys, series, avg, now, color, coin }: { buys: { ts: number; ppc: number; mkt: number | null; usd: number; held: number; amount: number; src: string }[]; series: [number, number][]; avg: number; now: number; color: string; coin: string }) {
  const [ref, W] = useWidth<HTMLDivElement>(); const H = Math.round(Math.min(360, Math.max(240, W * 0.52)));
  const [sel, setSel] = useState<number | null>(null);
  const padL = 58, padR = 12, padT = 14, padB = 28;
  const { x, y, t0, t1, lo, hi } = useMemo(() => {
    const ts = [...buys.map(b => b.ts), ...series.map(s => s[0])]; const t0 = Math.min(...ts), t1 = Math.max(...ts);
    const ps = [...buys.map(b => b.ppc), ...series.map(s => s[1]), avg, now].filter(v => v > 0);
    const lo = Math.min(...ps) * 0.85, hi = Math.max(...ps) * 1.15;
    const x = (t: number) => padL + (t - t0) / Math.max(1, t1 - t0) * (W - padL - padR);
    const y = (p: number) => padT + (1 - (Math.log(p) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (H - padT - padB);
    return { x, y, t0, t1, lo, hi };
  }, [buys, series, avg, now, W, H]);
  if (!buys.length) return <div className="empty-chart">No buys of {coin} found.</div>;
  const maxUsd = Math.max(...buys.map(b => b.usd));
  const big = W < 560 ? 4.5 : 7; const rr = (u: number) => (W < 560 ? 1.6 : 2.5) + big * Math.sqrt(u / maxUsd);
  const line = series.filter(s => s[1] > 0).map((s, i) => `${i ? 'L' : 'M'}${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`).join('');
  const years: number[] = []; for (let yv = new Date(t0 * 1000).getUTCFullYear() + 1; yv <= new Date(t1 * 1000).getUTCFullYear(); yv++) years.push(yv);
  const s = sel != null ? buys[sel] : null;
  return (
    <div ref={ref} className="chart-wrap">
      <svg width={W} height={H} className="chart" onClick={() => setSel(null)}>
        <defs>
          <linearGradient id={`mk-${coin}`} x1="0" x2="1"><stop offset="0" stopColor="#7f5cff" /><stop offset="1" stopColor="#18d4ff" /></linearGradient>
        </defs>
        {niceLogTicks(lo, hi).map(v => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="grid" /><text x={padL - 6} y={y(v) + 4} textAnchor="end" className="tick">{tickP(v)}</text></g>)}
        {years.map(yv => { const t = Date.UTC(yv, 0, 1) / 1000; return <g key={yv}><line x1={x(t)} x2={x(t)} y1={padT} y2={H - padB} className="grid" /><text x={x(t)} y={H - 8} textAnchor="middle" className="tick">{yv}</text></g>; })}
        <path d={line} fill="none" stroke={`url(#mk-${coin})`} strokeWidth="1.6" opacity=".9" />
        <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke="#ffd23f" strokeDasharray="5 4" strokeWidth="1.4" />
        <text x={padL + 6} y={y(avg) - 6} textAnchor="start" className="tick tick-strong" fill="#ffd23f">your average {fp(avg)}</text>
        {buys.map((b, i) => <circle key={i} cx={x(b.ts)} cy={y(b.ppc)} r={rr(b.usd)} fill={color} fillOpacity={b.held > 1e-9 ? 0.75 : 0.18} stroke={i === sel ? '#fff' : color} strokeOpacity={b.held > 1e-9 ? 0.9 : 0.35} strokeWidth={i === sel ? 2 : 0.8}
          onClick={ev => { ev.stopPropagation(); setSel(i); }} style={{ cursor: 'pointer' }} />)}
        <circle cx={x(t1)} cy={y(now)} r="5" fill="#fff" /><circle cx={x(t1)} cy={y(now)} r="10" fill="none" stroke="#fff" opacity=".35" className="pulse-ring" />
      </svg>
      <div className="chart-caption">
        {s ? <span><b>{dateFmt(s.ts)}</b> · {qty(s.amount)} {coin} for {usd(s.usd)} · paid <b>{fp(s.ppc)}</b> vs market {fp(s.mkt)} {s.mkt ? `(${((s.ppc / s.mkt - 1) * 100).toFixed(1)}%)` : ''} · {s.held > 1e-9 ? 'still held' : 'since sold/spent'}</span>
          : <span>Each dot is one buy (bigger = more dollars, faded = since sold). Line = market price. Tap a dot for details.</span>}
      </div>
    </div>
  );
}

export function Bars({ rows, height = 220, fmt = (v: number) => qty(v) }: { rows: { label: string; parts: { v: number; color: string; name: string }[] }[]; height?: number; fmt?: (v: number) => string }) {
  const [ref, W] = useWidth<HTMLDivElement>(); const H = height; const padB = 24, padT = 18;
  const max = Math.max(1, ...rows.map(r => r.parts.reduce((s, p) => s + p.v, 0)));
  const bw = Math.min(46, (W - 10) / Math.max(1, rows.length) * 0.66); const step = (W - 10) / Math.max(1, rows.length);
  return (
    <div ref={ref} className="chart-wrap">
      <svg width={W} height={H} className="chart">
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="grid" />
        {rows.map((r, i) => {
          let acc = 0; const cx = 5 + step * i + step / 2; const tot = r.parts.reduce((s, p) => s + p.v, 0);
          return <g key={i}>
            {r.parts.map((p, k) => { const h = p.v / max * (H - padB - padT); const yy = H - padB - acc - h; acc += h; return <rect key={k} x={cx - bw / 2} y={yy} width={bw} height={Math.max(0, h)} rx={k === r.parts.length - 1 ? 4 : 0} fill={p.color} />; })}
            <text x={cx} y={H - padB - acc - 5} textAnchor="middle" className="tick">{tot > 0 ? fmt(tot) : ''}</text>
            <text x={cx} y={H - 7} textAnchor="middle" className="tick">{r.label}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

export function AreaChart({ points, series }: { points: { label: string; t: number }[]; series: { name: string; color: string; values: number[] }[] }) {
  const [ref, W] = useWidth<HTMLDivElement>(); const H = Math.round(Math.min(280, Math.max(200, W * 0.42)));
  const padL = 54, padR = 10, padT = 12, padB = 26;
  if (!points.length) return <div className="empty-chart">No data.</div>;
  const raw = Math.max(1, ...series.flatMap(s => s.values)); const mag = 10 ** Math.floor(Math.log10(raw)); const stepv = [1, 2, 2.5, 5, 10].map(m => m * mag / 4).find(st => st * 4 >= raw) ?? mag; const max = stepv * 4;
  const x = (i: number) => padL + i / Math.max(1, points.length - 1) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const every = Math.ceil(points.length / Math.max(2, Math.floor(W / 90)));
  return (
    <div ref={ref} className="chart-wrap">
      <svg width={W} height={H} className="chart">
        <defs>{series.map((s, i) => <linearGradient key={i} id={`ar${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".45" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>)}</defs>
        {ticks.map((v, i) => <g key={i}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="grid" /><text x={padL - 6} y={y(v) + 4} textAnchor="end" className="tick">{v >= 1000 ? '$' + (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : usd(v, { cents: false })}</text></g>)}
        {series.map((s, i) => {
          const d = s.values.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');
          return <g key={i}><path d={`${d}L${x(s.values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={`url(#ar${i})`} /><path d={d} fill="none" stroke={s.color} strokeWidth="2" /></g>;
        })}
        {points.map((p, i) => i % every === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="tick">{p.label}</text> : null)}
      </svg>
    </div>
  );
}
