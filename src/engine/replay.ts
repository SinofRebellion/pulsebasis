// Faithful port of the reference Python engine (ledger.py + engine.py + hold.py + analysis.py parts).
import REG from './registry.json';
import type { Raw } from './fetch';
import { ZERO, lc, toFloat, big, topicAddr } from './util';

const R: any = REG;
export const COINS = ['HEX', 'PLS', 'PLSX', 'INC', 'PRVX'] as const;
export type Coin = typeof COINS[number];
const HEX = R.contracts.HEX as string;
const WPLS = R.contracts.WPLS as string;
const MASTERCHEF = R.income.masterchef as string;
const rampById = (id: string) => R.ramps.find((r: any) => r.id === id);
const venueById = (id: string) => R.venues.find((r: any) => r.id === id);
const LIB = new Set<string>(rampById('libertyswap').match.txTo);
const LIB_OUT = new Set<string>(rampById('libertyswap').outTo);
const CUSTODIAL = new Set<string>(rampById('custodial').match.from);
const OMNI_OUT = new Set<string>(rampById('omnibridge').outTo);
const GOPULSE = venueById('gopulse').to[0] as string;
const GPFEE = venueById('gopulse').feeCollector[0] as string;
const MINT_RAMPS: { id: string; toks: Set<string> }[] = ['omnibridge', 'hyperlane', 'coast'].map(id => ({ id, toks: new Set<string>(rampById(id).match.mintFromZero) }));
const VENUE_BY_TO = new Map<string, string>(); for (const v of R.venues) for (const t of v.to) VENUE_BY_TO.set(t, v.name);

const AMAP: Record<string, string> = { PLS: 'PLS' };
for (const [k, a] of Object.entries<any>(R.assets)) for (const t of a.tokens) AMAP[t] = k;
const DEC: Record<string, number> = {}; for (const [k, a] of Object.entries<any>(R.assets)) DEC[k] = a.dec;
const TOKP: Record<string, string[]> = {}; for (const [k, a] of Object.entries<any>(R.assets)) if (a.pairs.length) TOKP[k] = a.pairs;

export interface Flow { w: string; tok: string; v: number; cp: string }
export interface Tx { hash: string; block: number; ts: number; flows: Flow[]; gas: Record<string, number>; to: string | null; from: string | null; func: string | null; err: boolean }

export function buildLedger(raw: Raw): Tx[] {
  const txs = new Map<string, Tx>();
  const fork = R.forkBlock as number;
  const T = (h: string, blk: number, ts?: number) => {
    h = lc(h);
    let t = txs.get(h);
    if (!t) { t = { hash: h, block: blk, ts: ts ?? 0, flows: [], gas: {}, to: null, from: null, func: null, err: false }; txs.set(h, t); }
    if (ts && !t.ts) t.ts = ts;
    return t;
  };
  for (const a of raw.addrs) {
    const d = raw.per[a];
    for (const x of d.txlist) {
      if (+x.blockNumber <= fork) continue;
      const t = T(x.hash, +x.blockNumber, +x.timeStamp);
      t.to = lc(x.to) || null; t.from = lc(x.from); t.func = (x.input || '0x').slice(0, 10);
      if (lc(x.from) === a) t.gas[a] = toFloat(BigInt(x.gasUsed) * BigInt(x.gasPrice), 18);
      if (x.isError !== '0') { t.err = true; continue; }
      const v = toFloat(BigInt(x.value), 18);
      if (v) {
        const fa = lc(x.from), ta = lc(x.to);
        if (fa === a) t.flows.push({ w: a, tok: 'PLS', v: -v, cp: ta });
        if (ta === a) t.flows.push({ w: a, tok: 'PLS', v, cp: fa });
      }
    }
    for (const x of d.internal) {
      if (x.isError !== '0' || +x.blockNumber <= fork) continue;
      const t = T(x.transactionHash, +x.blockNumber, +x.timeStamp);
      const v = toFloat(BigInt(x.value), 18);
      const fa = lc(x.from), ta = lc(x.to);
      if (v && fa === a) t.flows.push({ w: a, tok: 'PLS', v: -v, cp: ta });
      if (v && ta === a) t.flows.push({ w: a, tok: 'PLS', v, cp: fa });
    }
    const seen = new Set<string>();
    for (const l of [...d.logsIn, ...d.logsOut]) {
      if (l.topics.length !== 3) continue;
      const key = lc(l.transactionHash) + ':' + l.logIndex;
      if (seen.has(key)) continue; seen.add(key);
      const blk = parseInt(l.blockNumber, 16); if (blk <= fork) continue;
      const tok = lc(l.address); const m = raw.tokenMeta[tok] ?? { sym: tok, dec: 18 };
      const v = l.data !== '0x' ? toFloat(big(l.data.slice(0, 66)), m.dec) : 0;
      const fa = topicAddr(l.topics[1]), ta = topicAddr(l.topics[2]);
      const t = T(l.transactionHash, blk);
      if (fa === a) t.flows.push({ w: a, tok, v: -v, cp: ta });
      if (ta === a) t.flows.push({ w: a, tok, v, cp: fa });
    }
  }
  for (const t of txs.values()) if (!t.ts) t.ts = raw.blockTs[t.block] ?? 0;
  return [...txs.values()].sort((x, y) => x.block - y.block || (x.hash < y.hash ? -1 : x.hash > y.hash ? 1 : 0));
}

// ---------------- prices ----------------
export class Prices {
  PX: Record<string, Map<number, number>> = {};
  constructor(private raw: Raw) {
    for (const a of Object.keys(R.assets)) {
      const best = new Map<number, [number, number]>();
      for (const v of ['v1', 'v2']) for (const r of raw.daily[`${v}_${a}`] ?? []) {
        const p = parseFloat(r.priceUSD), liq = parseFloat(r.totalLiquidityUSD), d = Math.floor(r.date / 86400);
        if (!(p > 0) || liq < 1000) continue;
        const b = best.get(d); if (!b || liq > b[1]) best.set(d, [p, liq]);
      }
      this.PX[a] = new Map([...best.entries()].map(([d, v]) => [d, v[0]]));
    }
  }
  daily(a: string, ts: number): number | null {
    if (a === 'USD') return 1;
    const P = this.PX[a]; if (!P || !P.size) return null;
    const d = Math.floor(ts / 86400);
    for (let k = 0; k < 60; k++) { if (P.has(d - k)) return P.get(d - k)!; if (P.has(d + k)) return P.get(d + k)!; }
    return null;
  }
  private wr(k: string, r: [string, string]): [number, bigint] {
    return R.pairs[k].wpls_is_t0 ? [toFloat(BigInt(r[0]), 18), BigInt(r[1])] : [toFloat(BigInt(r[1]), 18), BigInt(r[0])];
  }
  /** state = block whose post-state to read (b-1 for "right before tx in block b") */
  plsAt(state: number): number | null {
    const RS = this.raw.reserves[state]; if (!RS) return null;
    let best: [number, number] | null = null;
    for (const k of R.stablePairs) {
      const r = RS[k]; if (!r) continue;
      const [w, o] = this.wr(k, r); const s = toFloat(o, R.stableDec[k.split('_')[1]]);
      if (w <= 0 || s < 500) continue;
      if (!best || s > best[0]) best = [s, s / w];
    }
    return best ? best[1] : null;
  }
  exactAt(a: string, state: number): number | null {
    const pu = this.plsAt(state); if (pu == null) return null;
    if (a === 'PLS') return pu;
    const RS = this.raw.reserves[state] ?? {}; let best: [number, number] | null = null;
    for (const k of TOKP[a] ?? []) {
      const r = RS[k]; if (!r) continue;
      const [w, o] = this.wr(k, r); const q = toFloat(o, DEC[a]);
      if (q <= 0 || w * pu < 1000) continue;
      if (!best || w > best[0]) best = [w, w / q * pu];
    }
    return best ? best[1] : null;
  }
  /** price at tx in block b (pool state at b-1), with outlier guard vs daily; falls back to daily. */
  at(a: string, ts: number, b: number): [number | null, 'stablecoin' | 'exact-block' | 'daily' | 'none'] {
    if (a === 'USD') return [1, 'stablecoin'];
    const p = this.exactAt(a, b - 1);
    if (p != null) { const d = this.daily(a, ts); if (d == null || (p / d > 0.2 && p / d < 5)) return [p, 'exact-block']; }
    const d = this.daily(a, ts); return [d, d != null ? 'daily' : 'none'];
  }
  now(a: string): number | null {
    if (a === 'USD') return 1;
    return this.exactAt(a, this.raw.latestBlock) ?? this.daily(a, this.raw.latestTs);
  }
}

// ---------------- replay ----------------
interface Lot { q: number; c: number; sq: number; sc: number; q0: number; c0: number; kind: string; ts: number | null }
export interface Acq { date: string; ts: number; block: number; wallet: string; coin: string; amount: number; paid_with: string; usd_cost: number; mv_at_time: number | null;
  usd_paid_at_block: number; price_paid_per_coin_usd: number | null; market_price_at_block_usd: number | null; market_price_source: string; price_source: string; route: string; method: string; source: string; tx: string;
  held_q: number; held_cost: number; held_staked_q: number; ramp?: string }
export interface MoneyIn { date: string; ts: number; block: number; psrc: string; kind: string; ramp: string; asset: string; amount: number; usd: number; mv: number; fee: number; cp: string; tx: string; wallet: string; flag?: string }
export interface MoneyOut { date: string; ts: number; block: number; psrc: string; kind: string; ramp: string; asset: string; amount: number; usd: number; cost: number; cp: string; tx: string }

export interface ReplayOut {
  pools: Record<string, [number, number]>; staked: [number, number];
  acq: Acq[]; moneyin: MoneyIn[]; moneyout: MoneyOut[]; income: [number, string, string, number, number][];
  gas: [number, string, number, number, number][]; fees: { ts: number; ramp: string; tx: string; usd: number; vol: number }[];
  events: any[]; warn: Record<string, number>; pstat: Record<string, number>; freeheld: Record<string, number>;
  unknownSenders: Set<string>; unpricedIn: { tok: string; sym: string; tx: string; ts: number }[]; junkAssets: Set<string>;
  forkCopy: Record<string, number>; venues: Record<string, { n: number; usd: number; coins: Record<string, number> }>;
  lotsHeld: Record<string, { q: number; c: number; free: number }>;
}
const dstr = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

export function replay(raw: Raw, L: Tx[], PR: Prices, senders: Raw['senders'] = {}): ReplayOut {
  const OWN = new Set(raw.addrs);
  const meta = raw.tokenMeta;
  const asset = (tok: string): string => {
    if (AMAP[tok]) return AMAP[tok];
    const m = meta[tok]; const s = m?.sym ?? '';
    if (s.includes('LP') || s === 'PLP' || /pulsex ?lp|liquidity|uni-v2/i.test(m?.name ?? '')) return 'LP:' + tok;
    return 'JUNK:' + tok;
  };
  const isJL = (a: string) => a.startsWith('LP:') || a.startsWith('JUNK:');
  const pstat: Record<string, number> = {};
  let CURB = 0;
  const mv = (a: string, q: number, ts: number) => { const [p, s] = PR.at(a, ts, CURB); pstat[s] = (pstat[s] ?? 0) + 1; return p == null ? null : p * q; };
  const mvs_ = (a: string, q: number, ts: number): [number | null, string, number | null] => { const [p, s] = PR.at(a, ts, CURB); return [p == null ? null : p * q, s, p]; };
  const price_b = (a: string, ts: number) => PR.at(a, ts, CURB);

  // stake-end events by tx
  const SE = new Map<string, { hearts: number; payout: number; penalty: number }[]>();
  for (const l of raw.stakeEnds) {
    const d = l.data.slice(2); const d0 = BigInt('0x' + d.slice(0, 64)); const d1 = BigInt('0x' + d.slice(64, 128));
    const M = (1n << 72n) - 1n;
    const e = { hearts: Number((d0 >> 40n) & M), payout: Number((d0 >> 184n) & M), penalty: Number(d1 & M) };
    const h = lc(l.transactionHash); if (!SE.has(h)) SE.set(h, []); SE.get(h)!.push(e);
  }
  const pools: Record<string, [number, number]> = {};
  const P = (a: string) => (pools[a] ??= [0, 0]);
  let staked: [number, number] = [0, 0];
  const events: any[] = [], acq: (Acq & { _lot?: Lot })[] = [], moneyin: MoneyIn[] = [], moneyout: MoneyOut[] = [], income: ReplayOut['income'] = [], gas: ReplayOut['gas'] = [], fees: ReplayOut['fees'] = [];
  const warn: Record<string, number> = {}; const W_ = (k: string, v = 1) => { warn[k] = (warn[k] ?? 0) + v; };
  const LOTS: Record<string, Lot[]> = {}; const LAST: Record<string, Lot> = {};
  const unknownSenders = new Set<string>(); const unpricedIn: ReplayOut['unpricedIn'] = []; const junkAssets = new Set<string>();
  const venues: ReplayOut['venues'] = {};
  const _scale = (a: string, f: number, toStake = false) => { for (const l of LOTS[a] ?? []) { const mq = l.q * f, mc = l.c * f; l.q -= mq; l.c -= mc; if (toStake) { l.sq += mq; l.sc += mc; } } };
  const take = (a: string, q: number, toStake = false): number => {
    const p = P(a);
    if (p[0] > 1e-12) _scale(a, Math.min(1, q / p[0]), toStake);
    if (p[0] <= 1e-12) { W_('short_' + a, q); return 0; }
    const f = Math.min(1, q / p[0]); const c = p[1] * f;
    if (q > p[0] * 1.0001) W_('short_' + a, q - p[0]);
    p[0] = Math.max(0, p[0] - q); p[1] -= c;
    if (p[0] <= 1e-9) { p[0] = 0; p[1] = 0; }
    return c;
  };
  const add = (a: string, q: number, c: number, kind = 'acq', ts: number | null = null) => {
    const p = P(a); p[0] += q; p[1] += c;
    const l: Lot = { q, c, sq: 0, sc: 0, q0: q, c0: c, kind, ts }; (LOTS[a] ??= []).push(l); LAST[a] = l;
  };

  // ---- opening balances copied at the PulseChain fork ($0 cost) ----
  const forkCopy: Record<string, number> = {};
  for (const a of raw.addrs) {
    const fb = raw.balFork[a] ?? {};
    for (const [tok, v] of Object.entries(fb)) {
      const as = tok === 'PLS' ? 'PLS' : AMAP[tok]; if (!as) continue;
      const q = toFloat(BigInt(v), tok === 'PLS' ? 18 : DEC[as]); if (q <= 0) continue;
      forkCopy[as] = (forkCopy[as] ?? 0) + q;
    }
  }
  // stakes alive at the fork (started on Ethereum before the fork, not ended before it)
  const fork = R.forkBlock as number; let forkStaked = 0;
  {
    const endedPre = new Set<string>(); for (const l of raw.stakeEnds) if (parseInt(l.blockNumber, 16) <= fork) endedPre.add(lc(l.topics[1]) + BigInt(l.topics[2]).toString());
    for (const l of raw.stakeStarts) {
      if (parseInt(l.blockNumber, 16) > fork) continue;
      if (endedPre.has(lc(l.topics[1]) + BigInt(l.topics[2]).toString())) continue;
      const d0 = BigInt('0x' + l.data.slice(2, 66)); forkStaked += Number((d0 >> 40n) & ((1n << 72n) - 1n)) / 1e8;
    }
  }
  for (const [as, q] of Object.entries(forkCopy)) { add(as, q, 0, 'free', null); income.push([L[0]?.ts ?? 0, 'Copied at the PulseChain fork', as, q, 0]); }
  if (forkStaked > 0) { staked = [forkStaked, 0]; (LOTS['HEX'] ??= []).push({ q: 0, c: 0, sq: forkStaked, sc: 0, q0: forkStaked, c0: 0, kind: 'free', ts: null }); forkCopy['HEX staked'] = forkStaked; }

  for (const t of L) {
    const ts = t.ts, h = t.hash; CURB = t.block;
    const snd = raw.txInfo[h];
    const sender = lc(t.from || snd?.from || ''); const to = lc(t.to || snd?.to || '');
    const ours = OWN.has(sender);
    for (const [w, g] of Object.entries(t.gas)) if (g > 0) { const c = take('PLS', g); gas.push([ts, w, g, mv('PLS', g, ts) ?? 0, c]); }
    if (t.err) continue;
    const net: Record<string, number> = {}; const cps: Record<string, Set<string>> = {}; const wal: Record<string, Set<string>> = {};
    for (const { w, tok, v, cp } of t.flows) {
      if (OWN.has(cp)) continue;
      const a = asset(tok);
      if (cp === MASTERCHEF && a.startsWith('LP:')) continue;
      if (cp === WPLS && a === 'PLS') continue;
      net[a] = (net[a] ?? 0) + v; (cps[a] ??= new Set()).add(cp); (wal[a] ??= new Set()).add(w);
    }
    for (const a of Object.keys(net)) if (!(Math.abs(net[a]) > 1e-12)) delete net[a];
    if (!Object.keys(net).length) continue;
    const ins: Record<string, number> = {}, outs: Record<string, number> = {};
    for (const [a, v] of Object.entries(net)) { if (v > 0) ins[a] = v; else outs[a] = -v; }
    const Wl = [...new Set(Object.values(wal).flatMap(s => [...s]))].sort().join(',');
    // HEX stake start
    if (ours && to === HEX && t.func === '0x52a438b8' && 'HEX' in outs && cps['HEX']?.has(ZERO)) {
      const q = outs['HEX']; delete outs['HEX']; const c = take('HEX', q, true); staked[0] += q; staked[1] += c;
      events.push([ts, 'stake_start', q, c]);
    }
    if (ours && to === HEX && t.func === '0x343009a2' && (SE.has(h) || ('HEX' in ins && cps['HEX']?.has(ZERO)))) {
      let Rq = 0;
      if ('HEX' in ins && cps['HEX']?.has(ZERO)) { Rq = ins['HEX']; delete ins['HEX']; }
      const es = SE.get(h) ?? [];
      let Pp = es.reduce((s, e) => s + e.hearts, 0) / 1e8; const pay = es.reduce((s, e) => s + e.payout, 0) / 1e8; const pen = es.reduce((s, e) => s + e.penalty, 0) / 1e8;
      if (!es.length) { W_('stakeend_noevent'); Pp = Rq; }
      const f = staked[0] > 0 ? Math.min(1, Pp / staked[0]) : 0; const c = staked[1] * f; staked[0] -= Pp; staked[1] -= c;
      if (staked[0] < 1e-6) staked = [Math.max(staked[0], 0), Math.max(staked[1], 0)];
      P('HEX')[0] += Rq; P('HEX')[1] += c;
      for (const l of LOTS['HEX'] ?? []) { const rq = l.sq * f, rc = l.sc * f; l.sq -= rq; l.sc -= rc; l.q += rq * (Pp > 0 ? Rq / Pp : 1); l.c += rc; }
      events.push([ts, 'stake_end', Pp, Rq, pay, pen, c, mv('HEX', 1, ts), t.block]);
      if (pay > 0) income.push([ts, 'HEX stake interest', 'HEX', pay, mv('HEX', pay, ts) ?? 0]);
    }
    for (const a of Object.keys(ins)) {
      // PLSX minted straight to the wallet = the PulseX sacrifice airdrop/claim: free coins, $0 cost
      if (a === 'PLSX' && cps[a]?.size === 1 && cps[a]?.has(ZERO) && !Object.keys(outs).length) {
        const q = ins[a]; delete ins[a]; add('PLSX', q, 0, 'free', ts); income.push([ts, 'PulseX sacrifice airdrop (PLSX)', 'PLSX', q, mv('PLSX', q, ts) ?? 0]); continue;
      }
      if (a === 'COM' && cps[a]?.has(ZERO) && !Object.keys(outs).length) {
        const q = ins[a]; delete ins[a]; add('COM', q, 0, 'free', ts); income.push([ts, 'Communis (COM) bonus', 'COM', q, mv('COM', q, ts) ?? 0]);
      }
    }
    const nIn = Object.keys(ins).length, nOut = Object.keys(outs).length;
    if (!nIn && !nOut) continue;
    if (nIn && nOut) {
      let cost = 0; const desc: string[] = [];
      for (const [a, q] of Object.entries(outs)) { cost += take(a, q); desc.push(`${fmtq(q)} ${symOf(a, meta)}`); }
      const mvs: Record<string, number | null> = {};
      for (const [a, q] of Object.entries(ins)) mvs[a] = isJL(a) ? null : mv(a, q, ts);
      const tot = Object.values(mvs).reduce<number>((s, v) => s + (v || 0), 0);
      const outsrc = new Set<string>(); let outmv = 0;
      for (const [a, q] of Object.entries(outs)) { if (isJL(a)) continue; const [v, sr] = mvs_(a, q, ts); outmv += v || 0; outsrc.add(sr); }
      const venue = VENUE_BY_TO.get(to) ?? (ours ? 'PulseX / other DEX' : LIB.has(to) ? 'LibertySwap (cross-chain buy)' : 'Other');
      for (const [a, q] of Object.entries(ins)) {
        const share = tot > 0 ? (mvs[a] || 0) / tot : 1 / nIn;
        const c = cost * share; add(a, q, c, 'acq', ts);
        if (isJL(a)) junkAssets.add(a);
        if ((COINS as readonly string[]).includes(a)) {
          const onlyUSD = Object.keys(outs).length === 1 && 'USD' in outs;
          const src = onlyUSD ? 'USD stablecoin paid (exact)' : 'cost carried from coins swapped';
          const [mp, msrc] = price_b(a, ts); const gv = outmv * share;
          const psrc = onlyUSD ? 'stablecoin' : ([...outsrc].every(s => s === 'exact-block' || s === 'stablecoin') && outsrc.size > 0 ? 'exact-block' : 'daily');
          const unpricedPay = Object.keys(outs).every(isJL);
          if (unpricedPay) W_('paid_with_unpriced_token');
          acq.push({ date: dstr(ts), ts, block: t.block, wallet: Wl, coin: a, amount: q, paid_with: desc.join(' + '), usd_cost: c, mv_at_time: mvs[a], usd_paid_at_block: gv,
            price_paid_per_coin_usd: q ? gv / q : null, market_price_at_block_usd: mp, market_price_source: msrc, price_source: unpricedPay ? 'carried (unpriced token)' : psrc, _lot: LAST[a],
            route: to === GOPULSE ? 'GoPulse' : venue, method: 'swap', source: src, tx: h, held_q: 0, held_cost: 0, held_staked_q: 0 });
          const vv = (venues[venue] ??= { n: 0, usd: 0, coins: {} }); vv.n++; vv.usd += gv; vv.coins[a] = (vv.coins[a] ?? 0) + gv;
        }
      }
      events.push([ts, 'swap', { ...outs }, { ...ins }, cost, to]);
      if (to === GOPULSE) {
        const d = raw.gp[h] ?? { int: [], tt: [] };
        const fq = d.int.filter(([f, tt]) => f === GOPULSE && tt === GPFEE).reduce((s, [, , v]) => s + toFloat(BigInt(v), 18), 0);
        let fu = mv('PLS', fq, ts) ?? 0;
        for (const [tok, f, tt, v] of d.tt) if (f === GOPULSE && tt === GPFEE) {
          const aa = asset(tok); const dec = meta[tok]?.dec ?? DEC[aa] ?? 18;
          fu += !isJL(aa) ? (mv(aa, toFloat(BigInt(v), dec), ts) ?? 0) : 0;
        }
        fees.push({ ts, ramp: 'GoPulse', tx: h, usd: fu, vol: outmv });
        if (!raw.gp[h]) W_('gopulse_fee_unmeasured');
      }
      continue;
    }
    if (nIn) {
      const cpall = new Set<string>(); for (const a of Object.keys(ins)) for (const c of cps[a] ?? []) cpall.add(c);
      const insKeys = Object.keys(ins);
      let kind: string, gross = 1, ramp = 'other', flat = 0, flag: string | undefined, outside = false;
      const mintRamp = cpall.size === 1 && cpall.has(ZERO) ? MINT_RAMPS.find(m => insKeys.every(a => [...(cps[a] ?? [])].length && t.flows.some(f => f.v > 0 && asset(f.tok) === a && m.toks.has(f.tok)))) : undefined;
      const sInfo = [...cpall].map(c => senders[c]).filter(Boolean);
      if (LIB.has(to) && !ours) { kind = 'LibertySwap bridge-in'; gross = 1 / (1 - rampById('libertyswap').feePctIn / 100); ramp = 'libertyswap'; }
      else if (CUSTODIAL.has(sender) || [...cpall].some(c => CUSTODIAL.has(c))) { kind = 'Swap service payout (SwapToPulse / ChangeNOW-type)'; ramp = 'custodial'; flag = 'spread_unknown'; }
      else if (insKeys.length === 1 && insKeys[0] === 'WETH' && cpall.size === 1 && cpall.has(ZERO)) { kind = 'ETH bridged in from Ethereum (OmniBridge)'; ramp = 'omnibridge'; }
      else if ([...cpall].every(c => c === MASTERCHEF) || (insKeys.every(a => a === 'INC') && to === MASTERCHEF)) { kind = 'farm_reward'; gross = 0; ramp = 'farm'; }
      else if (mintRamp) {
        const rr = rampById(mintRamp.id); ramp = mintRamp.id; kind = rr.name + ' arrival'; outside = true;
        if (rr.valuation === 'arrival_gross_flat') { gross = 1 / (1 - rr.feePctIn / 100); flat = rr.feeFlatUsd; }
      }
      else if (sInfo.some(s => s!.contract && s!.name && /escrow/i.test(s!.name))) { kind = 'P2P escrow release (ProveX-type)'; ramp = 'provex'; gross = 1 / (1 - rampById('provex').feePctIn / 100); outside = true; }
      else if (sInfo.some(s => !s!.contract && s!.txs >= rampById('hotwallet').match.fromEoaMinTxs)) { kind = 'Exchange / service hot wallet (likely)'; ramp = 'hotwallet'; flag = 'spread_unknown'; outside = true; }
      else { kind = 'Received from an outside wallet'; outside = true; for (const c of cpall) if (c !== ZERO) unknownSenders.add(c); }
      const isOutsideRule = kind === 'Received from an outside wallet' || outside;
      for (const [a, q] of Object.entries(ins)) {
        const m = isJL(a) ? null : mv(a, q, ts);
        if (isJL(a) || m == null || kind === 'farm_reward' || (isOutsideRule && (m || 0) < 1.0)) {
          add(a, q, 0, 'free', ts);
          if (isJL(a)) junkAssets.add(a);
          if (!isJL(a) && m == null) unpricedIn.push({ tok: a, sym: a, tx: h, ts });
          if (kind === 'farm_reward' || (COINS as readonly string[]).includes(a)) income.push([ts, kind === 'farm_reward' ? 'PulseX farm reward' : 'free/dust received', a, q, m || 0]);
          continue;
        }
        const c = m * gross + (flat && a === 'USD' ? flat : 0); add(a, q, c, 'acq', ts);
        const ps = a === 'USD' ? 'stablecoin' : price_b(a, ts)[1];
        moneyin.push({ date: dstr(ts), ts, block: t.block, psrc: ps, kind, ramp, asset: a, amount: q, usd: c, mv: m, fee: c - m, cp: [...cpall].sort().join(',').slice(0, 42), tx: h, wallet: Wl, flag });
        if (c - m > 1e-9) fees.push({ ts, ramp: rampById(ramp).name, tx: h, usd: c - m, vol: m });
        if ((COINS as readonly string[]).includes(a)) {
          const [mp, msrc] = price_b(a, ts);
          acq.push({ date: dstr(ts), ts, block: t.block, wallet: Wl, coin: a, amount: q, paid_with: 'USD via ' + kind, usd_cost: c, mv_at_time: m, usd_paid_at_block: c,
            price_paid_per_coin_usd: c / q, market_price_at_block_usd: mp, market_price_source: msrc, price_source: msrc, _lot: LAST[a], route: rampById(ramp).name, method: 'purchase',
            source: 'market price at arrival block' + (gross > 1 ? ` + ${((1 - 1 / gross) * 100).toFixed(2)}% fee` : ''), tx: h, held_q: 0, held_cost: 0, held_staked_q: 0, ramp });
        }
      }
      continue;
    }
    if (nOut) {
      const cpall = new Set<string>(); for (const a of Object.keys(outs)) for (const c of cps[a] ?? []) cpall.add(c);
      let kind: string, ramp = 'other';
      if (LIB_OUT.has(to)) { kind = 'LibertySwap bridge-out'; ramp = 'libertyswap'; }
      else if (OMNI_OUT.has(to)) { kind = 'Bridged to Ethereum (OmniBridge)'; ramp = 'omnibridge'; }
      else {
        const dst = [...cpall][0];
        const plsBig = Object.keys(outs).every(k => k === 'PLS') && Math.max(...Object.values(outs)) > 100000;
        kind = raw.isContract[dst] === false && plsBig ? 'Sent to exchange deposit address (likely)' : 'Sent to outside address'; ramp = kind.startsWith('Sent to exchange') ? 'hotwallet' : 'other';
      }
      for (const [a, q] of Object.entries(outs)) {
        const c = take(a, q); const m = isJL(a) ? null : mv(a, q, ts);
        if (isJL(a) || (m || 0) < 1.0) continue;
        moneyout.push({ date: dstr(ts), ts, block: t.block, psrc: a === 'USD' ? 'stablecoin' : price_b(a, ts)[1], kind, ramp, asset: a, amount: q, usd: m!, cost: c, cp: [...cpall].sort().join(',').slice(0, 42), tx: h });
      }
    }
  }
  for (const x of acq) { const l = x._lot!; delete x._lot; x.held_q = l.q + l.sq; x.held_cost = l.c + l.sc; x.held_staked_q = l.sq; }
  const freeheld: Record<string, number> = {}; const lotsHeld: ReplayOut['lotsHeld'] = {};
  for (const a of COINS) {
    freeheld[a] = (LOTS[a] ?? []).filter(l => l.kind === 'free').reduce((s, l) => s + l.q + l.sq, 0);
    lotsHeld[a] = { q: (LOTS[a] ?? []).reduce((s, l) => s + l.q + l.sq, 0), c: (LOTS[a] ?? []).reduce((s, l) => s + l.c + l.sc, 0), free: freeheld[a] };
  }
  return { pools, staked, acq, moneyin, moneyout, income, gas, fees, events, warn, pstat, freeheld, unknownSenders, unpricedIn, junkAssets, forkCopy, venues, lotsHeld };
}
function fmtq(q: number) { return q >= 1000 ? Math.round(q).toLocaleString('en-US') : q.toPrecision(4); }
function symOf(a: string, meta: Raw['tokenMeta']) { if (a.includes(':')) return meta[a.split(':')[1]]?.sym ?? a.split(':')[0]; return a; }
