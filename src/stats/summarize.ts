// Turns anonymous events into the owner dashboard numbers + a traffic-light "Server health" verdict.
export type Ev = { t: number; k: 'visit' | 'scan' | 'selftest'; m?: boolean; ref?: string; ok?: boolean; cached?: boolean; ms?: number; att?: number; w?: number; req?: number; rt?: number; rl?: number; rg?: number; h?: Record<string, [number, number, number]> };

/** Test / local referrers never belong in the owner's referral list. */
export const isLocalRef = (r: string) => /(^|\.)(local|localhost|internal|test|example|invalid)$|^localhost|^127\.|^0\.0\.0\.0|^10\.|^192\.168\.|^\[?::1|^probe\b/i.test(r.trim().replace(/:\d+$/, '').replace(/^https?:\/\//, '').split('/')[0]);
export const SERVER_NAMES: Record<string, string> = {
  'rpc.pulsechain.com': 'PulseChain main server',
  'rpc-pulsechain.g4mm4.io': 'Backup server (G4MM4)',
  'pulsechain-rpc.publicnode.com': 'Backup server (PublicNode)',
  'api.scan.pulsechain.com': 'PulseChain explorer',
  'graph.pulsechain.com': 'PulseX price history',
  'eth.blockscout.com': 'Ethereum explorer',
  'api.routescan.io': 'Ethereum backup explorer (Routescan)',
  'rpc.pulsechainrpc.com': 'Backup server (pulsechainrpc.com)',
  'rpc.pulsechainstats.com': 'Backup server (pulsechainstats.com)',
  'ethereum-rpc.publicnode.com': 'Ethereum server (PublicNode)',
  'eth.drpc.org': 'Ethereum server (dRPC)',
  'eth-mainnet.public.blastapi.io': 'Ethereum server (Blast)',
  'coins.llama.fi': 'Price history (DefiLlama)',
};
// A scan "struggled" if it needed 2+ automatic restarts or was very slow (3x the usual time).
// One automatic retry that then succeeds is normal and does not count as trouble.
export const struggled = (e: Ev, normalSec = DEFAULT_NORMAL_SEC) => (e.att ?? 1) >= 3 || (e.ms ?? 0) / 1000 > 3 * normalSec;
export const MIN_SCANS = 10;
export const DEFAULT_NORMAL_SEC = 120;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function health(scans24: Ev[], normalSec: number | null) {
  const n = scans24.length; const normal = normalSec ?? DEFAULT_NORMAL_SEC;
  const fails = scans24.filter(e => !e.ok).length, strug = scans24.filter(e => e.ok && struggled(e, normal)).length;
  const fresh = scans24.filter(e => e.ok && !e.cached).map(e => (e.ms ?? 0) / 1000);
  const med = median(fresh);
  const failP = pct(fails, n), strugP = pct(strug + fails, n), slowX = med != null && normal ? med / normal : 1;
  const base = { n, fails, struggled: strug, failPct: failP, troublePct: strugP, medianSec: med, normalSec: normal };
  if (n < MIN_SCANS) return { ...base, level: 'green' as const, title: 'All good', why: n ? `Not enough scans yet to judge (${n} in the last 24 hours, ${fails ? `${fails} didn't finish` : 'all finished'}).` : 'No scans in the last 24 hours yet, so nothing to worry about.' };
  if ((failP >= 10 && fails >= 3) || slowX > 2.5)
    return { ...base, level: 'red' as const, title: 'Time to add backup servers', why: failP >= 10 && fails >= 3 ? `${failP}% of scans in the last 24 hours didn't finish (${fails} of ${n}). The free public servers can't keep up.` : `Scans are much slower than usual: a typical scan took ${Math.round(med!)} seconds, normally about ${Math.round(normal)}. The free public servers can't keep up.` };
  if (failP >= 5 || strugP >= 30 || slowX >= 1.5)
    return { ...base, level: 'yellow' as const, title: 'Getting busy', why: slowX >= 1.5 ? `Scans are slower than usual: a typical scan took ${Math.round(med!)} seconds, normally about ${Math.round(normal)}.` : failP >= 5 ? `${failP}% of scans in the last 24 hours didn't finish (${fails} of ${n}). Worth watching.` : `${strugP}% of scans in the last 24 hours needed several retries or were very slow. Worth watching.` };
  return { ...base, level: 'green' as const, title: 'All good', why: `${n} scans in the last 24 hours, ${fails ? `${fails} didn't finish` : 'all finished'}${med != null ? `, and a typical scan took ${Math.round(med)} seconds` : ''}.` };
}

export function summarize(events: Ev[], now = Date.now()) {
  const d1 = now - 86400e3, d7 = now - 7 * 86400e3;
  const selftests = events.filter(e => e.k === 'selftest').length;
  const ev7 = events.filter(e => e.k !== 'selftest' && e.t >= d7 && e.t <= now), ev1 = ev7.filter(e => e.t >= d1);
  const scans7 = ev7.filter(e => e.k === 'scan'), scans1 = ev1.filter(e => e.k === 'scan');
  const visits7 = ev7.filter(e => e.k === 'visit'), visits1 = ev1.filter(e => e.k === 'visit');
  // "normal" scan time = median fresh scan over the previous 6 days (falls back to all 7 days, then a default)
  const older = scans7.filter(e => e.t < d1 && e.ok && !e.cached).map(e => (e.ms ?? 0) / 1000);
  const all7 = scans7.filter(e => e.ok && !e.cached).map(e => (e.ms ?? 0) / 1000);
  const normal = older.length >= 5 ? median(older) : all7.length >= 5 ? median(all7) : null;
  const H = health(scans1, normal);
  const refs = new Map<string, number>(); for (const v of visits7) { if (v.ref && isLocalRef(v.ref)) continue; const r = v.ref || 'Direct / unknown'; refs.set(r, (refs.get(r) ?? 0) + 1); }
  const perDay: { day: string; visits: number; scans: number; failed: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * 86400e3).toISOString().slice(0, 10);
    const es = ev7.filter(e => new Date(e.t).toISOString().slice(0, 10) === day);
    perDay.push({ day, visits: es.filter(e => e.k === 'visit').length, scans: es.filter(e => e.k === 'scan').length, failed: es.filter(e => e.k === 'scan' && !e.ok).length });
  }
  const srv = new Map<string, { req: number; fail: number; slow: number; scans: number }>();
  for (const s of scans1) for (const [h, [n, f, sl]] of Object.entries(s.h ?? {})) { const x = srv.get(h) ?? { req: 0, fail: 0, slow: 0, scans: 0 }; x.req += n; x.fail += f; x.slow += sl; x.scans++; srv.set(h, x); }
  const servers = [...srv].map(([h, x]) => {
    const fp = x.req ? x.fail / x.req : 0, sp = x.req ? x.slow / x.req : 0;
    const status = fp >= 0.1 ? 'bad' : fp >= 0.02 || sp >= 0.05 ? 'busy' : 'ok';
    return { host: h, name: SERVER_NAMES[h] ?? h, status, label: status === 'bad' ? 'Failing often' : status === 'busy' ? 'Slow at times' : 'Working fine', failPct: Math.round(fp * 1000) / 10, slowPct: Math.round(sp * 1000) / 10, requests: x.req };
  }).sort((a, b) => b.requests - a.requests);
  const fresh1 = scans1.filter(e => e.ok && !e.cached).map(e => (e.ms ?? 0) / 1000);
  return {
    asOf: now, selftests, health: H,
    visits: { day: visits1.length, week: visits7.length },
    scans: { day: scans1.length, week: scans7.length, finishedDay: scans1.filter(e => e.ok).length, failedDay: scans1.filter(e => !e.ok).length, finishedWeek: scans7.filter(e => e.ok).length, failedWeek: scans7.filter(e => !e.ok).length },
    typicalScanSec: median(fresh1), normalScanSec: normal, repeatScanShare: pct(scans7.filter(e => e.cached).length, scans7.length),
    walletsPerScan: scans7.length ? Math.round((scans7.reduce((s, e) => s + (e.w ?? 1), 0) / scans7.length) * 10) / 10 : null,
    phoneShare: pct(visits7.filter(e => e.m).length, visits7.length),
    rangeLimitScans: scans1.filter(e => (e.rg ?? 0) > 0).length, rateLimitScans: scans1.filter(e => (e.rl ?? 0) > 0).length,
    refs: [...refs].sort((a, b) => b[1] - a[1]).slice(0, 6), perDay, servers,
  };
}
