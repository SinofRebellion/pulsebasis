export const COIN_COLORS: Record<string, string> = { HEX: '#ff3d9a', PLS: '#a259ff', PLSX: '#18d4ff', INC: '#3fe0a0', PRVX: '#ffb020' };
export const COIN_NAMES: Record<string, string> = { HEX: '', PLS: 'PulseChain', PLSX: 'PulseX', INC: 'Incentive', PRVX: 'ProveX' };
export function usd(n: number | null | undefined, opts: { sign?: boolean; cents?: boolean } = {}) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n); const cents = opts.cents ?? a < 1000;
  const s = a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (n < 0 ? '−' : opts.sign && n > 0 ? '+' : '') + '$' + s;
}
/** Tiny coin prices: $0.00275, $0.00000931 */
export function price(n: number | null | undefined) {
  if (n == null || !isFinite(n) || n === 0) return '—';
  if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (n >= 0.01) return '$' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const z = Math.floor(-Math.log10(n)); return '$' + n.toFixed(z + 4);
}
export function qty(n: number | null | undefined, maxFrac = 0) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e7) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString('en-US', { maximumFractionDigits: a < 10 ? 2 : maxFrac });
}
export const qtyFull = (n: number) => Math.round(n).toLocaleString('en-US');
export function pct(n: number | null | undefined, d = 1, sign = true) {
  if (n == null || !isFinite(n)) return '—';
  return (sign && n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d) + '%';
}
export const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
export const dateFmt = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const monthFmt = (m: string) => { const [y, mo] = m.split('-'); return new Date(Date.UTC(+y, +mo - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }); };
export const isoDate = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
