// Low-level helpers: hex/BigInt, ABI encoding for the handful of calls we need, Multicall3.
export const ZERO = '0x0000000000000000000000000000000000000000';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const STAKE_START_TOPIC = '0x14872dc760f33532684e68e1b6d5fd3f71ba7b07dee76bdb2b084f28b74233ef';
export const STAKE_END_TOPIC = '0x72d9c5a7ab13846e08d9c838f9e866a1bb4a66a2fd3ba3c9e7da3cf9e394dfd7';
export const SEL = {
  currentDay: '5c9302c9', stakeCount: '33060d90', stakeLists: '2607443b', balanceOf: '70a08231',
  symbol: '95d89b41', decimals: '313ce567', dailyDataRange: '6a210a0e', globalInfo: 'f04b5fa0',
  tryAggregate: 'bce38bd7', getEthBalance: '4d2301cc', getReserves: '0902f1ac', name: '06fdde03',
  stakeStart: '0x52a438b8', stakeEnd: '0x343009a2',
};
export const pad32 = (h: string) => h.replace(/^0x/, '').padStart(64, '0');
export const addrTopic = (a: string) => '0x' + pad32(a.toLowerCase());
export const topicAddr = (t: string) => ('0x' + t.slice(26)).toLowerCase();
export const u = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');
export const big = (h: string) => (h && h !== '0x' ? BigInt(h.startsWith('0x') ? h : '0x' + h) : 0n);
/** Convert integer amount to float like Python int/10**dec (correct to ~1e-16 relative). */
export function toFloat(v: bigint, dec: number): number {
  if (v === 0n) return 0;
  const neg = v < 0n; if (neg) v = -v;
  const d = 10n ** BigInt(dec);
  const ip = v / d, fp = v % d;
  const r = Number(ip) + Number(fp) / Number(d);
  return neg ? -r : r;
}
export const mask = (bits: number) => (1n << BigInt(bits)) - 1n;

export interface Call { target: string; data: string }
/** Encode Multicall3.tryAggregate(false, calls) */
export function encodeTryAggregate(calls: Call[]): string {
  const n = calls.length;
  let head = SEL.tryAggregate + u(0) + u(0x40) + u(n);
  const bodies: string[] = []; const offs: number[] = [];
  let off = n * 32;
  for (const c of calls) {
    const d = c.data.replace(/^0x/, '');
    const dlen = d.length / 2; const padded = d.padEnd(Math.ceil(dlen / 32) * 64, '0');
    const body = pad32(c.target) + u(0x40) + u(dlen) + padded;
    offs.push(off); bodies.push(body); off += body.length / 2;
  }
  return '0x' + head + offs.map(u).join('') + bodies.join('');
}
/** Decode tryAggregate result → array of hex return data (or null if failed). */
export function decodeTryAggregate(res: string): (string | null)[] {
  const b = res.replace(/^0x/, '');
  const W = (o: number) => Number(BigInt('0x' + b.slice(o * 2, o * 2 + 64)));
  const base = W(0); const L = W(base); const out: (string | null)[] = [];
  for (let i = 0; i < L; i++) {
    const to = base + 32 + W(base + 32 + i * 32);
    const ok = W(to); const bo = to + W(to + 32); const bl = W(bo);
    out.push(ok ? '0x' + b.slice((bo + 32) * 2, (bo + 32 + bl) * 2) : null);
  }
  return out;
}
export function words(h: string | null | undefined): bigint[] {
  if (!h) return [];
  const b = h.replace(/^0x/, ''); const out: bigint[] = [];
  for (let i = 0; i + 64 <= b.length; i += 64) out.push(BigInt('0x' + b.slice(i, i + 64)));
  return out;
}
export function decodeString(h: string | null): string | null {
  if (!h || h === '0x') return null;
  const b = h.replace(/^0x/, '');
  try {
    if (b.length === 64) { // bytes32
      const bytes = b.match(/../g)!.map(x => parseInt(x, 16)).filter(x => x);
      return new TextDecoder().decode(new Uint8Array(bytes));
    }
    const off = Number(BigInt('0x' + b.slice(0, 64))); const len = Number(BigInt('0x' + b.slice(off * 2, off * 2 + 64)));
    const s = b.slice(off * 2 + 64, off * 2 + 64 + len * 2);
    const bytes = new Uint8Array(s.match(/../g)?.map(x => parseInt(x, 16)) ?? []);
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const lc = (s: string | null | undefined) => (s || '').toLowerCase();
/** Very small concurrency pool. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers); return out;
}
export const chunk = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
