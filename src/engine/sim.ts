// "What if I buy now?" math. Pure, client-side; ignores slippage, optional fee % taken from the dollars spent.
export interface SimIn { qty: number; cost: number; now: number; spend: number; feePct?: number; freeQty?: number }
export function parseUsd(s: string): number { const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; }
export function simulate({ qty, cost, now, spend, feePct = 0, freeQty = 0 }: SimIn) {
  const fee = spend * Math.min(Math.max(feePct, 0), 100) / 100;
  const got = now > 0 ? (spend - fee) / now : 0;
  const avg = qty > 0 ? cost / qty : 0, nq = qty + got, nc = cost + spend, navg = nq > 0 ? nc / nq : 0;
  const rise = (a: number) => (now > 0 && a > 0 ? (a / now - 1) * 100 : 0);
  const exQ = Math.max(0, qty - freeQty), avgEx = exQ > 0 ? cost / exQ : 0, navgEx = exQ + got > 0 ? nc / (exQ + got) : 0;
  return {
    got, fee, avg, newAvg: navg, lowerPct: avg > 0 ? (1 - navg / avg) * 100 : 0,
    riseBefore: rise(avg), riseAfter: rise(navg),
    plBefore: qty * now - cost, plAfter: nq * now - nc, valueAfter: nq * now, costAfter: nc, qtyAfter: nq,
    avgEx, newAvgEx: navgEx, lowerPctEx: avgEx > 0 ? (1 - navgEx / avgEx) * 100 : 0,
  };
}
export const FEES = [{ id: 'none', label: 'No fee', pct: 0 }, { id: 'liberty', label: 'LibertySwap 0.3%', pct: 0.3 }, { id: 'custom', label: 'Custom %', pct: NaN }] as const;
