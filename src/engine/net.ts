import REG from './registry.json';
import { sleep } from './util';

class Limiter {
  active = 0; q: (() => void)[] = [];
  constructor(public max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>(r => this.q.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; const n = this.q.shift(); if (n) n(); }
  }
}
const limiters = new Map<string, Limiter>();
const lim = (host: string, max: number) => { let l = limiters.get(host); if (!l) { l = new Limiter(max); limiters.set(host, l); } return l; };

export const stats = { requests: 0, errors: 0, retries: 0, rateHits: 0, rangeHits: 0, hosts: {} as Record<string, { n: number; fail: number; slow: number }> };
export function resetStats() { Object.assign(stats, { requests: 0, errors: 0, retries: 0, rateHits: 0, rangeHits: 0, hosts: {} }); }
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return 'other'; } };
let rr = 0;
/* Endpoint health: an endpoint that fails 3 times in a row is benched for 3 minutes, and endpoints listed as
 * last resort (registry rpc.lastResort) are only tried after the preferred ones. */
const health = new Map<string, { bad: number; until: number }>();
const LAST = new Set<string>(((REG.rpc as any).lastResort ?? []).map(hostOf));
function markHost(url: string, ok: boolean) { const k = hostOf(url); const h = health.get(k) ?? { bad: 0, until: 0 }; if (ok) h.bad = 0; else if (++h.bad >= 3) { h.until = Date.now() + 180_000; h.bad = 0; } health.set(k, h); }
export function benched(url: string) { return (health.get(hostOf(url))?.until ?? 0) > Date.now(); }
/** Preferred healthy endpoints first, then last-resort, then benched ones (only if nothing else is left). */
export function orderEps(eps: string[]): string[] {
  const live = eps.filter(e => !benched(e)); const pre = live.filter(e => !LAST.has(hostOf(e)));
  return [...pre, ...live.filter(e => LAST.has(hostOf(e))), ...eps.filter(e => benched(e))];
}
/** Endpoint for attempt i: round-robin over the preferred healthy ones first; later attempts walk the full order. */
function pick(eps: string[], i: number): string {
  const o = orderEps(eps); const pre = o.filter(e => !benched(e) && !LAST.has(hostOf(e)));
  if (i < 2 && pre.length) return pre[rr++ % pre.length];
  return o[i % o.length];
}
export function resetHealth() { health.clear(); }

/* "Busy" = the server is overloaded or rate-limiting us (HTTP 429/502/503/504, JSON-RPC -32005/-32016/-32090,
 * "too busy", "rate limit", "capacity", network drops). Busy errors are retried with exponential backoff and
 * rotated across every endpoint; if they never clear, callers get a BusyError whose text is safe to show. */
const BUSY_RE = /(HTTP (429|502|503|504)|busy|rate.?limit|too many requests|capacity|overload|try again|temporarily|unavailable|exceeded|-32005|-32016|-32090|failed to fetch|networkerror|network error|load failed|aborted|abort|timed? ?out|ECONNRESET|socket hang up)/i;
const BUSY_CODES = new Set([-32005, -32016, -32090, 429]);
export const BUSY_TEXT = 'The free public servers are busy right now.';
export class BusyError extends Error { constructor() { super(BUSY_TEXT); this.name = 'BusyError'; } }
export function isBusy(e: any): boolean { return e instanceof BusyError || BUSY_CODES.has(e?.code) || e?.name === 'AbortError' || BUSY_RE.test(String(e?.message ?? e ?? '')); }
/** Exponential backoff with jitter: ~0.7s, 1.4s, 2.8s, 5.6s, 11s, then 15s. */
/** Test hook: return a fake Response (or null to pass through) to simulate busy servers; scale shortens waits. */
export const netTest: { fake: ((url: string, init?: RequestInit) => Response | null) | null; scale: number } = { fake: null, scale: 1 };
export const backoff = (i: number) => Math.min(15000, 700 * 2 ** i) * (0.75 + Math.random() * 0.5) * netTest.scale;
async function fetchJSON(url: string, init: RequestInit | undefined, timeoutMs = 60000): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    stats.requests++;
    const h = (stats.hosts[hostOf(url)] ??= { n: 0, fail: 0, slow: 0 }); h.n++; const t0 = Date.now();
    try {
      const r = (netTest.fake && netTest.fake(url, init)) || await fetch(url, { ...init, signal: ctl.signal });
      if (r.status === 429) stats.rateHits++;
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error('HTTP ' + r.status), { code: r.status === 429 ? 429 : undefined });
      const j = await r.json();
      if (j?.error && /rate|too many requests|exceeded/i.test(String(j.error.message || ''))) stats.rateHits++;
      if (j?.error && RANGE_RE.test(String(j.error.message || ''))) stats.rangeHits++;
      markHost(url, true); return j;
    } catch (e) { h.fail++; markHost(url, false); throw e; }
    finally { if (Date.now() - t0 > 10000) h.slow++; }
  } finally { clearTimeout(t); }
}

export class RpcError extends Error { constructor(msg: string, public code?: number) { super(msg); } }

/** One JSON-RPC call against the archive endpoints (round-robin, retry, failover). */
/** Calls that only read the newest state can also use the non-archive public nodes (they prune old state and old receipts). */
const latestOnly = (method: string, params: any[]) => method === 'eth_blockNumber' || (['eth_call', 'eth_getCode', 'eth_getBalance'].includes(method) && params[params.length - 1] === 'latest');
export async function rpc(method: string, params: any[], opts: { endpoints?: string[]; timeoutMs?: number; tries?: number } = {}): Promise<any> {
  const base = opts.endpoints ?? REG.rpc.archive;
  const extra: string[] = !opts.endpoints && latestOnly(method, params) ? ((REG.rpc as any).latestOnly ?? []) : [];
  const tries = opts.tries ?? 6; let err: any; let busyN = 0;
  for (let i = 0; i < tries + busyN; i++) {
    // after two misses, rotate over every endpoint that can answer this call
    const url = i >= 2 && extra.length ? pick([...base, ...extra], i) : pick(base, i);
    try {
      const j = await lim(url, 10).run(() => fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, opts.timeoutMs ?? 60000));
      if (j.error) {
        const m = String(j.error.message || j.error);
        // deterministic errors: don't hammer
        if (/execution reverted|invalid|limited to|too many|range/i.test(m) && !BUSY_RE.test(m) && !BUSY_CODES.has(j.error.code)) throw new RpcError(m, j.error.code);
        throw Object.assign(new Error(m), { code: j.error.code });
      }
      return j.result;
    } catch (e: any) {
      err = e; stats.errors++;
      if (e instanceof RpcError && !/too many|rate/i.test(e.message)) throw e;
      stats.retries++;
      const busy = isBusy(e); if (busy && busyN < 4) busyN++;       // busy servers get up to 4 extra, slower attempts
      await sleep(busy ? backoff(i) : 400 * (i + 1) + Math.random() * 300);
    }
  }
  if (isBusy(err)) { console.warn('PulseBasis: RPC still busy after retries:', String(err?.message || err).slice(0, 200)); throw new BusyError(); }
  throw err;
}

/** Batched JSON-RPC for cheap lookups (headers, txs, receipts, code). Falls back to singles on failure. */
export async function rpcBatch(reqs: [string, any[]][], size = 25): Promise<any[]> {
  const out: any[] = new Array(reqs.length);
  const groups: number[][] = [];
  for (let i = 0; i < reqs.length; i += size) groups.push(Array.from({ length: Math.min(size, reqs.length - i) }, (_, k) => i + k));
  await Promise.all(groups.map(async g => {
    let err: any;
    for (let t = 0; t < 9; t++) {
      const url = pick(REG.rpc.archive, t);
      try {
        const j = await lim(url, 10).run(() => fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(g.map((k, id) => ({ jsonrpc: '2.0', id, method: reqs[k][0], params: reqs[k][1] }))) }, 60000));
        if (!Array.isArray(j)) throw new Error('bad batch');
        const byId = new Map<number, any>(j.map((x: any) => [x.id, x]));
        const missing = g.filter((_, id) => !byId.get(id) || byId.get(id).error);
        if (missing.length > g.length / 2 && t < 8) throw new Error(g.some((_, id) => isBusy(byId.get(id)?.error ?? {})) ? 'busy batch' : 'batch errors');
        g.forEach((k, id) => { out[k] = byId.get(id)?.result ?? null; });
        // retry individually the few that failed
        for (const [id, k] of g.entries()) if (!byId.get(id) || byId.get(id).error) { try { out[k] = await rpc(reqs[k][0], reqs[k][1]); } catch { out[k] = null; } }
        return;
      } catch (e) { err = e; stats.retries++; if (!isBusy(e) && t >= 4) break; await sleep(isBusy(e) ? backoff(t) : 500 * (t + 1)); }
    }
    throw isBusy(err) ? new BusyError() : err;
  }));
  return out;
}

/* ------------------------------------------------------------------ eth_getLogs, robust
 * Public PulseChain RPCs cap eth_getLogs differently (rpc.pulsechain.com: none, publicnode: 50k blocks,
 * g4mm4: 1k–10k blocks, others time out on wide ranges). Strategy per range:
 *   1. one wide call on an uncapped endpoint (fast path),
 *   2. the PulseChain explorer's logs API (wide ranges, paginated by 1,000 results),
 *   3. adaptive splitting across every RPC: learns each endpoint's cap from its error message,
 *      halves on "too many results"/timeouts, grows back after successes, limited concurrency + backoff.
 * Raw endpoint errors are never shown to the user; a final failure throws a plain-language error. */
export type LogFilter = { address?: string; topics: (string | null | string[])[] };
const RANGE_RE = /(limited to (a )?\d+ ?block|block range|exceed(s|ed)? (the )?max(imum)? block range|ranges? over \d+ blocks|range (is )?too (large|wide|big)|max(imum)? range)/i;
const TOOMANY_RE = /(query returned more than|too many (results|logs|records)|response (size|is too)|result (set|window) too large|limit exceeded|log response size|query timeout|timed? ?out|-32005)/i;
const capOf = (m: string) => { const x = m.match(/(\d[\d,]*)\s*-?\s*block/i) || m.match(/range:?\s*(\d[\d,]*)/i) || m.match(/up to an? (\d+)/i); return x ? parseInt(x[1].replace(/,/g, ''), 10) : 0; };
export const logTuning = { forceCap: 0, disableExplorer: false };
const epCap = new Map<string, number>();
const hex = (n: number) => '0x' + n.toString(16);
const cleanLog = (l: any) => ({ ...l, topics: (l.topics || []).filter((t: any) => t != null) });

async function logsOnce(ep: string, filter: LogFilter, a: number, b: number, timeoutMs: number): Promise<any[]> {
  if (logTuning.forceCap && b - a + 1 > logTuning.forceCap) throw new RpcError(`eth_getLogs is limited to a ${logTuning.forceCap} block range (simulated)`);
  const j = await lim(ep, 6).run(() => fetchJSON(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }] }) }, timeoutMs));
  if (j?.error) throw new RpcError(String(j.error.message || JSON.stringify(j.error)), j.error.code);
  if (!Array.isArray(j?.result)) throw new Error('bad getLogs response');
  return j.result;
}

/** Explorer logs API (etherscan-compatible). Returns null if the filter can't be expressed or the explorer fails. */
async function logsExplorer(filter: LogFilter, a: number, b: number, onProgress?: (blk: number) => void): Promise<any[] | null> {
  if (logTuning.disableExplorer) return null;
  const q: Record<string, string> = { module: 'logs', action: 'getLogs' };
  if (filter.address) q.address = filter.address;
  const idx: number[] = [];
  filter.topics.forEach((t, i) => { if (t == null) return; if (Array.isArray(t)) { if (t.length !== 1) throw 0; t = t[0]; } q['topic' + i] = String(t); idx.push(i); });
  for (let i = 0; i < idx.length; i++) for (let k = i + 1; k < idx.length; k++) q[`topic${idx[i]}_${idx[k]}_opr`] = 'and';
  const out: any[] = []; const seen = new Set<string>(); let from = a;
  for (let guard = 0; guard < 5000; guard++) {
    let j: any;
    try { j = await scan({ ...q, fromBlock: from, toBlock: b }); } catch { return null; }
    const res = Array.isArray(j?.result) ? j.result : null;
    if (!res) { if (j?.status === '0' && /no (records|logs)/i.test(String(j?.message))) return out; return null; }
    let maxB = from;
    for (const l of res) { const k = l.transactionHash + ':' + l.logIndex; if (!seen.has(k)) { seen.add(k); out.push(cleanLog(l)); } maxB = Math.max(maxB, parseInt(l.blockNumber, 16)); }
    onProgress?.(maxB);
    if (res.length < 1000) return out;
    if (maxB === from) return null;      // >1000 matches in one block: let RPC handle it
    from = maxB;                          // inclusive: re-read the last block, dedupe above
  }
  return null;
}

async function logsAdaptive(filter: LogFilter, a: number, b: number, onProgress?: (done: number, total: number) => void): Promise<any[]> {
  const eps = [...new Set([...REG.rpc.logs, ...REG.rpc.logsChunked, ...REG.rpc.archive])];
  const total = b - a + 1; let done = 0; const out: any[] = [];
  let win = Math.max(...eps.map(e => epCap.get(e) ?? 200000));
  const jobs: { a: number; b: number; fails: number }[] = [];
  for (let x = a; x <= b; x += win) jobs.push({ a: x, b: Math.min(b, x + win - 1), fails: 0 });
  let k = 0;
  const worker = async () => {
    while (jobs.length) {
      const job = jobs.shift()!; const size = job.b - job.a + 1;
      const fit = eps.filter(e => (epCap.get(e) ?? Infinity) >= size); const ok = fit.filter(e => !benched(e)); const usable = ok.length ? ok : fit;
      if (!usable.length) { const cap = Math.max(...eps.map(e => epCap.get(e) ?? 0)) || 1000; for (let x = job.a; x <= job.b; x += cap) jobs.push({ a: x, b: Math.min(job.b, x + cap - 1), fails: 0 }); continue; }
      const ep = usable[k++ % usable.length];
      try {
        const r = await logsOnce(ep, filter, job.a, job.b, 45000);
        out.push(...r); done += size; onProgress?.(done, total);
        win = Math.min(win * 2, 1_000_000);
        // grow: if many jobs are left and they're small, merge the next ones back up to the window size
        if (jobs.length > 1 && jobs[0].b - jobs[0].a + 1 < win / 2) { const n = jobs[0]; const m = jobs[1]; if (n.b + 1 === m.a && (epCap.get(ep) ?? Infinity) >= m.b - n.a + 1) { jobs.splice(0, 2, { a: n.a, b: m.b, fails: 0 }); } }
      } catch (e: any) {
        const m = String(e?.message || e);
        if (RANGE_RE.test(m)) { const c = capOf(m); epCap.set(ep, c && c < size ? c : Math.max(1, Math.floor(size / 2))); jobs.unshift(job); continue; }
        if ((TOOMANY_RE.test(m) || e?.name === 'AbortError') && size > 1) { const mid = job.a + Math.floor(size / 2); jobs.unshift({ a: job.a, b: mid - 1, fails: 0 }, { a: mid, b: job.b, fails: 0 }); win = Math.max(1, Math.floor(size / 2)); continue; }
        job.fails++; stats.retries++;
        if (job.fails > 10) throw new BusyError();
        await sleep(isBusy(e) ? backoff(job.fails) : 500 * job.fails + Math.random() * 400); jobs.push(job);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

/** Set when any range had to come from the explorer (fast but its index has occasional gaps). */
export const logState = { approx: false };
export async function getLogsAll(filter: LogFilter, fromBlock: number, toBlock: number, onChunk?: (done: number, total: number) => void, exactOnly = false, explorer?: (a: number, b: number) => Promise<any[] | null>): Promise<any[]> {
  if (fromBlock > toBlock) return [];
  const span = toBlock - fromBlock + 1;
  // 1. one wide call per endpoint (exact, fastest). Capped endpoints answer instantly with their limit, which we learn.
  const eps = [...new Set([...REG.rpc.logs, ...REG.rpc.logsChunked, ...REG.rpc.archive])];
  for (const ep of eps) {
    if ((epCap.get(ep) ?? Infinity) < span) continue;
    const uncapped = REG.rpc.logs.includes(ep);
    for (let t = 0; t < (uncapped ? 2 : 1); t++) {
      try { return (await logsOnce(ep, filter, fromBlock, toBlock, uncapped ? 90000 : 30000)).map(cleanLog); }
      catch (e: any) { const m = String(e?.message || e); if (RANGE_RE.test(m)) { const c = capOf(m); epCap.set(ep, c && c < span ? c : Math.floor(span / 2)); break; } if (TOOMANY_RE.test(m) || e?.name === 'AbortError') break; await sleep(600); }
    }
  }
  // 2. if every endpoint is capped so tightly that exact splitting would take thousands of calls, use the explorer
  //    (the caller re-checks those results against receipts and balances and re-fetches exactly if anything is off)
  const bestCap = Math.max(...eps.map(e => epCap.get(e) ?? Infinity));
  if (!exactOnly && span / bestCap > 1500) {
    const ex = await (explorer ? explorer(fromBlock, toBlock) : logsExplorer(filter, fromBlock, toBlock, blk => onChunk?.(blk - fromBlock, span))).catch(() => null);
    if (ex) { logState.approx = true; return Object.assign(ex, { approx: true }); }
  }
  // 3. adaptive split over every RPC (exact)
  return (await logsAdaptive(filter, fromBlock, toBlock, onChunk)).map(cleanLog);
}

/** Blockscout etherscan-compatible API. */
export async function scan(params: Record<string, string | number>): Promise<any> {
  const url = REG.rpc.scan + '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  let err: any;
  for (let i = 0; i < 6; i++) {
    try {
      const j = await lim('scan', 4).run(() => fetchJSON(url, undefined, 90000));
      return j;
    } catch (e) { err = e; stats.retries++; await sleep(isBusy(e) ? backoff(i + 1) : 1000 * (i + 1)); }
  }
  throw isBusy(err) ? new BusyError() : err;
}
export async function scanV2(path: string): Promise<any> {
  let err: any;
  for (let i = 0; i < 4; i++) {
    try { return await lim('scan', 4).run(() => fetchJSON(REG.rpc.scanV2 + path, undefined, 45000)); }
    catch (e) { err = e; await sleep(isBusy(e) ? backoff(i + 1) : 800 * (i + 1)); }
  }
  throw isBusy(err) ? new BusyError() : err;
}
export async function graphql(url: string, query: string): Promise<any> {
  let err: any;
  for (let i = 0; i < 5; i++) {
    try {
      const j = await lim('graph', 4).run(() => fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) }, 90000));
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
      return j.data;
    } catch (e) { err = e; await sleep(isBusy(e) ? backoff(i + 1) : 1000 * (i + 1)); }
  }
  throw isBusy(err) ? new BusyError() : err;
}

/* Free explorers rate-limit per visitor: Blockscout's classic API allows only a few calls per second and Routescan's
 * keyless tier 2/s. Parallel bursts from one scan (Ethereum HEX + sacrifices at once) were tripping those limits, so
 * these hosts get fewer parallel requests and a minimum gap between request starts. */
const PACE: Record<string, [number, number]> = { 'eth.blockscout.com': [2, 250], 'api.routescan.io': [1, 600] };
const nextAt = new Map<string, number>();
async function pace(h: string, gap: number) { if (!gap) return; const now = Date.now(); const t = Math.max(now, nextAt.get(h) ?? 0); nextAt.set(h, t + gap); if (t > now) await sleep(t - now); }
/** GET JSON from any public API (Ethereum explorer, price API) with per-host concurrency + retries. */
export async function getJSON(url: string, tries = 4, timeoutMs = 45000): Promise<any> {
  let err: any; const h = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  for (let i = 0; i < tries; i++) {
    try { const [n, gap] = PACE[h] ?? [4, 0]; return await lim(h, n).run(async () => { await pace(h, gap); return fetchJSON(url, undefined, timeoutMs); }); }
    catch (e) { err = e; stats.retries++; await sleep(isBusy(e) ? backoff(i + 1) : 800 * (i + 1) + Math.random() * 400); }
  }
  throw isBusy(err) ? new BusyError() : err;
}
