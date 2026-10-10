import REG from './registry.json';
import type { Raw } from './fetch';
import { COINS, type Prices, type ReplayOut, type Tx } from './replay';
import { toFloat, lc, topicAddr } from './util';

const R: any = REG;
const L0 = Date.UTC(2019, 11, 3);
const dayDate = (d: number) => new Date(L0 + d * 86400e3).toISOString().slice(0, 10);
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export interface StakeRow { id: number; wallet: string; principal: number; shares: number; tshares: number; lockedDay: number; endDay: number; days: number; accrued: number; future: number; start_date: string; end_date: string; servedPct: number; pending: boolean; matured: boolean }

export function analyze(raw: Raw, L: Tx[], E: ReplayOut, PR: Prices) {
  const now: Record<string, number> = {}; const nowSrc: Record<string, string> = {};
  for (const c of COINS) { const p = PR.exactAt(c, raw.latestBlock); now[c] = p ?? PR.daily(c, raw.latestTs) ?? 0; nowSrc[c] = p != null ? 'live PulseX reserves' : 'daily'; }
  // ---- stakes (HEX contract state) ----
  const cur = raw.hex.currentDay, hi = raw.hex.dailyDataCount;
  const rate = (d: number) => { const x = raw.hex.daily[d]; if (!x) return 0; const sh = Number(x[1]); return sh > 0 ? Number(x[0]) / sh : 0; };
  let r30 = 0, n30 = 0; for (let d = hi - 30; d < hi; d++) if (raw.hex.daily[d]) { r30 += rate(d); n30++; }
  r30 = n30 ? r30 / n30 : 0;
  const stakes: StakeRow[] = [];
  for (const [w, list] of Object.entries(raw.hex.stakes)) for (const s of list) {
    const shares = Number(s.stakeShares); const endDay = s.lockedDay + s.stakedDays;
    let acc = 0; for (let d = s.lockedDay; d < Math.min(hi, endDay); d++) acc += shares * rate(d);
    const fut = r30 * shares * Math.max(0, endDay - Math.max(cur, s.lockedDay));
    stakes.push({ id: s.stakeId, wallet: w, principal: Number(s.stakedHearts) / 1e8, shares, tshares: shares / 1e12, lockedDay: s.lockedDay, endDay, days: s.stakedDays, accrued: acc / 1e8, future: fut / 1e8,
      start_date: dayDate(s.lockedDay), end_date: dayDate(endDay), servedPct: Math.max(0, Math.min(1, (cur - s.lockedDay) / s.stakedDays)), pending: s.lockedDay > cur, matured: cur >= endDay });
  }
  stakes.sort((a, b) => a.endDay - b.endDay);
  const accr = sum(stakes.map(s => s.accrued)), fut = sum(stakes.map(s => s.future)), tsh = sum(stakes.map(s => s.tshares)), princ = sum(stakes.map(s => s.principal));
  // ---- holdings (hold.py) ----
  const Pl = (a: string) => E.pools[a] ?? [0, 0];
  const percoin: Record<string, any> = {};
  for (const c of COINS) {
    let q = Pl(c)[0], cost = Pl(c)[1];
    if (c === 'HEX') { q = Pl('HEX')[0] + E.staked[0] + accr; cost = Pl('HEX')[1] + E.staked[1]; }
    percoin[c] = { qty: q, cost, value: q * now[c], avg: q > 0 ? cost / q : 0, now: now[c] };
  }
  const tv = sum(Object.values(percoin).map((v: any) => v.value)), tc = sum(Object.values(percoin).map((v: any) => v.cost));
  for (const v of Object.values<any>(percoin)) { v.pl = v.value - v.cost; v.plpct = v.cost ? v.pl / v.cost * 100 : null; v.share = tv ? v.value / tv * 100 : 0; v.rise = v.now ? (v.avg / v.now - 1) * 100 : null; }
  const tot = { cost: tc, value: tv, pl: tv - tc, plpct: tc ? (tv - tc) / tc * 100 : 0 };
  const hexQexAcc = Pl('HEX')[0] + E.staked[0];
  const hex = { liquid: Pl('HEX')[0], liquid_cost: Pl('HEX')[1], staked: E.staked[0], staked_cost: E.staked[1], accrued: accr, future: fut, tshares: tsh, principal: princ,
    stake_now: princ + accr, maturity: princ + accr + fut, avg_ex_accr: hexQexAcc > 0 ? (Pl('HEX')[1] + E.staked[1]) / hexQexAcc : 0, avg_incl: percoin.HEX.avg, n: stakes.length,
    interest_value: accr * now.HEX, maturity_value_now: (princ + accr + fut) * now.HEX, r30, currentDay: cur };
  const avgOffsetPct = hex.avg_ex_accr ? (1 - hex.avg_incl / hex.avg_ex_accr) * 100 : 0;
  // realized stake interest already paid into liquid HEX
  const ends = E.events.filter(e => e[1] === 'stake_end');
  const paidInterest = sum(ends.map(e => e[4]));
  // ---- ended-stake history ----
  const startDays = new Map<string, number>();
  for (const l of raw.stakeStarts) { const d0 = BigInt('0x' + l.data.slice(2, 66)); startDays.set(BigInt(l.topics[2]).toString(), Number((d0 >> 184n) & 0xffffn)); }
  const endRows = raw.stakeEnds.filter(l => parseInt(l.blockNumber, 16) > R.forkBlock).map(l => {
    const d = l.data.slice(2); const d0 = BigInt('0x' + d.slice(0, 64)), d1 = BigInt('0x' + d.slice(64, 128)); const M = (1n << 72n) - 1n;
    const id = BigInt(l.topics[2]).toString(); const served = Number((d1 >> 72n) & 0xffffn); const days = startDays.get(id) ?? 0;
    const ts = Number(d0 & ((1n << 40n) - 1n)); const block = parseInt(l.blockNumber, 16);
    const kind = served === 0 ? 'cancel' : served < days ? 'early' : 'full';
    const px = PR.at('HEX', ts, block);
    return { id, ts, block, hearts: Number((d0 >> 40n) & M) / 1e8, payout: Number((d0 >> 184n) & M) / 1e8, penalty: Number(d1 & M) / 1e8, served, days, kind, px: px[0] ?? 0, pxsrc: px[1] };
  });
  const stakeHist = {
    started: raw.stakeStarts.filter(l => parseInt(l.blockNumber, 16) > R.forkBlock).length, ended: endRows.length,
    early: endRows.filter(e => e.kind === 'early').length, full: endRows.filter(e => e.kind === 'full').length, cancel: endRows.filter(e => e.kind === 'cancel').length,
    penalty: sum(endRows.map(e => e.penalty)), payout: sum(endRows.map(e => e.payout)),
    penalty_usd: sum(endRows.map(e => e.penalty * e.px)), payout_usd: sum(endRows.map(e => e.payout * e.px)),
    byMonth: [] as { m: string; penalty: number; payout: number; n: number }[],
  };
  { const bm = new Map<string, { penalty: number; payout: number; n: number }>(); for (const e of endRows) { const m = new Date(e.ts * 1000).toISOString().slice(0, 7); const x = bm.get(m) ?? { penalty: 0, payout: 0, n: 0 }; x.penalty += e.penalty; x.payout += e.payout; x.n++; bm.set(m, x); } stakeHist.byMonth = [...bm.entries()].sort().map(([m, v]) => ({ m, ...v })); }
  // ---- effective price paid vs market (held lots, hold.py) ----
  const held = E.acq.filter(a => a.held_q > 1e-9);
  const effective: Record<string, any> = {};
  for (const c of COINS) {
    const l = held.filter(a => a.coin === c && a.market_price_at_block_usd && a.price_paid_per_coin_usd);
    const hq = sum(l.map(a => a.held_q)); const paid = sum(l.map(a => a.held_q * a.price_paid_per_coin_usd!)); const mk = sum(l.map(a => a.held_q * a.market_price_at_block_usd!));
    const all = held.filter(a => a.coin === c);
    effective[c] = { n: all.length, first: all.length ? all.map(a => a.date).sort()[0] : null, avg_paid: hq ? paid / hq : null, avg_mkt: hq ? mk / hq : null, prem: mk ? (paid / mk - 1) * 100 : null };
  }
  // best / worst lots still held
  const lotsR = held.filter(a => (a.usd_paid_at_block || a.usd_cost) >= 5 && a.price_paid_per_coin_usd && a.price_paid_per_coin_usd > 0 && (!a.market_price_at_block_usd || (a.price_paid_per_coin_usd / a.market_price_at_block_usd > 0.2 && a.price_paid_per_coin_usd / a.market_price_at_block_usd < 5)))
    .map(a => ({ date: a.date, coin: a.coin, amount: a.amount, held: a.held_q, ppc: a.price_paid_per_coin_usd!, mult: now[a.coin] / a.price_paid_per_coin_usd!, paid: a.held_q * a.price_paid_per_coin_usd!, nowv: a.held_q * now[a.coin], route: a.route, tx: a.tx }));
  const byMult = lotsR.filter(x => x.paid >= 5 && x.nowv >= 1).sort((a, b) => b.mult - a.mult);  // the part still held must be meaningful
  const best = byMult.slice(0, 5), worst = byMult.slice(-5).reverse();
  // ---- money in / ramps ----
  const IN = sum(E.moneyin.map(x => x.usd)), OUT = sum(E.moneyout.map(x => x.usd));
  const rampMap = new Map<string, any>();
  for (const r of R.ramps) rampMap.set(r.id, { id: r.id, name: r.name, color: r.color, category: r.category, usd: 0, mv: 0, n: 0, fee: 0, feeText: r.fee?.text, accuracy: r.accuracy, verified: r.verified, verifiedNote: r.verifiedNote, sources: r.sources ?? [], outUsd: 0, outN: 0, assets: {} as Record<string, number> });
  for (const x of E.moneyin) { const r = rampMap.get(x.ramp)!; r.usd += x.usd; r.mv += x.mv; r.n++; r.fee += x.fee; r.assets[x.asset] = (r.assets[x.asset] ?? 0) + x.usd; }
  for (const x of E.moneyout) { const r = rampMap.get(x.ramp) ?? rampMap.get('other')!; r.outUsd += x.usd; r.outN++; }
  const lib = rampMap.get('libertyswap'); lib.feeOutEst = lib.outUsd * (R.ramps.find((r: any) => r.id === 'libertyswap').feePctOut / 100);
  const ramps = [...rampMap.values()].filter(r => r.n || r.outN).map(r => ({ ...r, share: IN ? r.usd / IN * 100 : 0 })).sort((a, b) => b.usd - a.usd);
  const gp = E.fees.filter(f => f.ramp === 'GoPulse');
  const gasUsd = sum(E.gas.map(g => g[3])), gasPls = sum(E.gas.map(g => g[2]));
  const fees = { gopulse: { usd: sum(gp.map(f => f.usd)), vol: sum(gp.map(f => f.vol)), n: gp.length }, ramps: ramps.map(r => ({ id: r.id, name: r.name, fee: r.fee + (r.feeOutEst ?? 0), text: r.feeText })),
    gasUsd, gasPls, gasN: E.gas.length };
  const feesTotal = fees.gopulse.usd + sum(ramps.map(r => r.fee + (r.feeOutEst ?? 0))) + gasUsd;
  // timeline: cumulative in / out by month
  const mm = new Map<string, { in: number; out: number }>();
  for (const x of E.moneyin) { const m = x.date.slice(0, 7); const v = mm.get(m) ?? { in: 0, out: 0 }; v.in += x.usd; mm.set(m, v); }
  for (const x of E.moneyout) { const m = x.date.slice(0, 7); const v = mm.get(m) ?? { in: 0, out: 0 }; v.out += x.usd; mm.set(m, v); }
  let ci = 0, co = 0; const cumulative = [...mm.entries()].sort().map(([m, v]) => { ci += v.in; co += v.out; return { m, in: v.in, out: v.out, cumIn: ci, cumOut: co, net: ci - co }; });
  // monthly buys by coin
  const bm = new Map<string, Record<string, number>>();
  for (const a of E.acq) { const m = a.date.slice(0, 7); const r = bm.get(m) ?? {}; r[a.coin] = (r[a.coin] ?? 0) + (a.usd_paid_at_block || a.usd_cost); bm.set(m, r); }
  const buysByMonth = [...bm.entries()].sort().map(([m, v]) => ({ m, ...v }));
  // buy dots per coin
  const buys: Record<string, { ts: number; ppc: number; mkt: number | null; usd: number; held: number; amount: number; src: string }[]> = {};
  for (const c of COINS) buys[c] = E.acq.filter(a => a.coin === c && a.price_paid_per_coin_usd && a.price_paid_per_coin_usd > 0 && (a.usd_paid_at_block || a.usd_cost) >= 0.5)
    .filter(a => !a.market_price_at_block_usd || (a.price_paid_per_coin_usd! / a.market_price_at_block_usd > 0.2 && a.price_paid_per_coin_usd! / a.market_price_at_block_usd < 5))
    .map(a => ({ ts: a.ts, ppc: a.price_paid_per_coin_usd!, mkt: a.market_price_at_block_usd, usd: a.usd_paid_at_block || a.usd_cost, held: a.held_q, amount: a.amount, src: a.price_source }));
  // market line: daily prices from first buy
  const series: Record<string, [number, number][]> = {};
  for (const c of COINS) {
    const first = buys[c][0]?.ts ?? raw.latestTs - 365 * 86400; const P = PR.PX[c];
    series[c] = P ? [...P.entries()].filter(([d]) => d * 86400 >= first - 7 * 86400).sort((a, b) => a[0] - b[0]).map(([d, p]) => [d * 86400, p]) : [];
    series[c].push([raw.latestTs, now[c]]);
  }
  // ---- accuracy ----
  const ps: Record<string, number> = {}; for (const a of E.acq) ps[a.price_source] = (ps[a.price_source] ?? 0) + 1;
  const nAcq = E.acq.length; const exactN = (ps['exact-block'] ?? 0) + (ps['stablecoin'] ?? 0);
  const usdAcq = sum(E.acq.map(a => a.usd_paid_at_block || a.usd_cost)); const usdExact = sum(E.acq.filter(a => a.price_source === 'exact-block' || a.price_source === 'stablecoin').map(a => a.usd_paid_at_block || a.usd_cost));
  // reconciliation (replayed vs on-chain balance)
  const tokOf = (c: string) => R.assets[c].tokens.filter((t: string) => t !== 'PLS');
  const chainBal = (c: string) => sum(raw.addrs.map(a => { const b = raw.balNow[a] ?? {}; let v = 0; if (c === 'PLS') v += toFloat(BigInt(b['PLS'] ?? '0'), 18); for (const t of tokOf(c)) v += toFloat(BigInt(b[t] ?? '0'), R.assets[c].dec); return v; }));
  const recon: { coin: string; label: string; replay: number; chain: number; diff: number; usd: number; ok: boolean }[] = COINS.map(c => {
    const rep = Pl(c)[0], ch = chainBal(c); const diff = rep - ch; const usd = Math.abs(diff) * now[c];
    return { coin: c, label: c === 'HEX' ? 'HEX (liquid)' : c, replay: rep, chain: ch, diff, usd, ok: usd < 2 || Math.abs(diff) <= Math.max(1e-6, Math.abs(ch) * 0.001) };
  });
  const stakeRep = E.staked[0]; recon.push({ coin: 'HEX', label: 'HEX (staked principal)', replay: stakeRep, chain: princ, diff: stakeRep - princ, usd: Math.abs(stakeRep - princ) * now.HEX, ok: Math.abs(stakeRep - princ) * now.HEX < 2 || Math.abs(stakeRep - princ) <= princ * 0.001 });
  // bridged eHEX on PulseChain (its own token, not pHEX): shown separately, kept out of the PulseChain RH totals
  const ehexNow = PR.exactAt('EHEX', raw.latestBlock) ?? PR.daily('EHEX', raw.latestTs) ?? 0;
  const ehexChain = chainBal('EHEX'); const [eq, ec] = Pl('EHEX');
  const ehex = { qty: eq, cost: ec, avg: eq > 0 ? ec / eq : 0, now: ehexNow, value: eq * ehexNow, pl: eq * ehexNow - ec, plpct: ec ? (eq * ehexNow - ec) / ec * 100 : null, rise: ehexNow && eq ? ((ec / eq) / ehexNow - 1) * 100 : null };
  recon.push({ coin: 'EHEX', label: 'eHEX (bridged, PulseChain)', replay: eq, chain: ehexChain, diff: eq - ehexChain, usd: Math.abs(eq - ehexChain) * ehexNow, ok: Math.abs(eq - ehexChain) * ehexNow < 2 || Math.abs(eq - ehexChain) <= Math.max(1e-6, ehexChain * 0.001) });
  const gaps: { level: 'info' | 'warn'; text: string }[] = [];
  for (const [k, v] of Object.entries(E.warn)) {
    if (k.startsWith('short_')) { const a = k.slice(6); if ((COINS as readonly string[]).includes(a)) gaps.push({ level: v * (now[a] || 0) > 5 ? 'warn' : 'info', text: `${fmt(v)} ${a} (≈$${(v * (now[a] || 0)).toFixed(2)} today) was spent beyond what we could trace coming in, so it's counted at $0 cost. Usually dust or rounding.` }); }
  }
  if (E.warn.paid_with_unpriced_token) gaps.push({ level: 'warn', text: `${E.warn.paid_with_unpriced_token} buys were paid with a token we can't price; their cost is carried from what that token cost you (often $0 if it was an airdrop).` });
  if (E.warn.gopulse_fee_unmeasured) gaps.push({ level: 'info', text: `${E.warn.gopulse_fee_unmeasured} GoPulse swaps couldn't be fee-measured (explorer didn't answer).` });
  const cust = E.moneyin.filter(x => x.flag === 'spread_unknown'); if (cust.length) gaps.push({ level: 'info', text: `${cust.length} arrivals came from custodial services or exchange hot wallets ($${fmt(sum(cust.map(x => x.usd)))}). Their markup happened off-chain, so your real cost is likely a bit higher.` });
  const xchain = E.moneyin.filter(x => ['libertyswap', 'omnibridge', 'hyperlane'].includes(x.ramp)); if (xchain.length) gaps.push({ level: 'info', text: `${xchain.length} bridge arrivals were valued at the PulseChain arrival block (the other chain's side isn't read). For LibertySwap the published 0.3% fee is added back.` });
  if (E.forkCopy && Object.keys(E.forkCopy).length) gaps.push({ level: 'info', text: `Balances copied at the PulseChain fork (May 2023) are counted at $0 cost: ${Object.entries(E.forkCopy).map(([a, q]) => `${fmt(q)} ${a}`).join(', ')}.` });
  if (E.unpricedIn.length) gaps.push({ level: 'info', text: `${E.unpricedIn.length} arrivals had no price at that time (counted at $0).` });
  if (E.junkAssets.size) gaps.push({ level: 'info', text: `${E.junkAssets.size} other tokens (LP tokens, memecoins, spam) are ignored for holdings. LP positions are not counted.` });
  if (raw.statusFixed) gaps.push({ level: 'info', text: `${raw.statusFixed} transaction${raw.statusFixed === 1 ? '' : 's'} that the explorer listed as successful actually failed on-chain (checked against the node). They're treated as failed, so only gas was paid.` });
  const daily = ps['daily'] ?? 0; if (daily) gaps.push({ level: 'info', text: `${daily} buys used the day's price instead of the exact block, usually launch-week (May 2023) trades when pools were too thin for a reliable block price.` });
  // ---- address poisoning (lookalike / zero-value transfers) ----
  const own = raw.addrs; const sentTo = new Set<string>();
  for (const a of own) for (const x of raw.per[a].txlist) if (lc(x.from) === a && x.to) sentTo.add(lc(x.to));
  for (const a of own) for (const l of raw.per[a].logsOut) sentTo.add(topicAddr(l.topics[2]));
  const look = (x: string, y: string) => x !== y && x.slice(2, 6) === y.slice(2, 6) && x.slice(-4) === y.slice(-4);
  const targets = [...new Set([...own, ...sentTo])];
  const poison: { tx: string; ts: number; from: string; to: string; mimics: string; token: string; zero: boolean }[] = [];
  const seenP = new Set<string>();
  for (const a of own) for (const l of [...raw.per[a].logsIn, ...raw.per[a].logsOut]) {
    if (l.topics.length !== 3) continue;
    const fa = topicAddr(l.topics[1]), ta = topicAddr(l.topics[2]); const cp = fa === a ? ta : fa;
    const val = l.data === '0x' ? 0n : BigInt(l.data.slice(0, 66));
    const sym = raw.tokenMeta[lc(l.address)]?.sym ?? '?';
    const m = targets.find(t => look(cp, t));
    const zeroSpoof = val === 0n && fa === a && !own.includes(lc(raw.txInfo[lc(l.transactionHash)]?.from ?? a));
    if ((m || zeroSpoof) && !seenP.has(l.transactionHash + l.logIndex)) {
      seenP.add(l.transactionHash + l.logIndex);
      poison.push({ tx: lc(l.transactionHash), ts: raw.blockTs[parseInt(l.blockNumber, 16)] ?? 0, from: fa, to: ta, mimics: m ?? a, token: sym, zero: val === 0n });
    }
  }
  // ---- income ----
  const incomeBy: Record<string, { q: Record<string, number>; usd: number; n: number }> = {};
  for (const [, k, a, q, u] of E.income) { const x = (incomeBy[k] ??= { q: {}, usd: 0, n: 0 }); x.q[a] = (x.q[a] ?? 0) + q; x.usd += u; x.n++; }
  // ---- lots CSV (held) ----
  const lots = held.map(a => ({ date: a.date, coin: a.coin, amount: a.amount, held: a.held_q, held_staked: a.held_staked_q, cost_usd: a.usd_cost, held_cost_usd: a.held_cost, paid_per_coin: a.price_paid_per_coin_usd, market_per_coin: a.market_price_at_block_usd,
    price_source: a.price_source, route: a.route, method: a.method, paid_with: a.paid_with, wallet: a.wallet, block: a.block, tx: a.tx }));
  const walletsSummary = raw.addrs.map(a => ({ address: a, txs: raw.per[a].txlist.length, transfers: raw.per[a].logsIn.length + raw.per[a].logsOut.length, stakes: raw.hex.stakes[a]?.length ?? 0 }));
  return { asOf: raw.latestTs, block: raw.latestBlock, now, nowSrc, percoin, tot, hex, avgOffsetPct, paidInterest, stakes, stakeHist, effective, best, worst,
    moneyIn: { total: IN, n: E.moneyin.length, ramps }, moneyOutTotal: OUT, fees, feesTotal, venues: E.venues, cumulative, buysByMonth, buys, series,
    accuracy: { nAcq, exactN, pctExact: nAcq ? exactN / nAcq * 100 : 100, usdPctExact: usdAcq ? usdExact / usdAcq * 100 : 100, sources: ps, recon, allOk: recon.every(r => r.ok), gaps, txs: L.length },
    poison, incomeBy, lots, wallets: walletsSummary, freeheld: E.freeheld, forkCopy: E.forkCopy, ehex, eth: null as null | import('./eth').EthReport,
    sacrifice: null as null | { status: 'ok' | 'error'; txs: import('./sacrifice').SacTx[]; found: Record<import('./sacrifice').SacCoin, number>; manual: Record<import('./sacrifice').SacCoin, number>; unpriced: number; ethAtFork: number | null; recv: import('./replay').ReplayOut['sacRecv']; nfHeld: Record<string, number> } };
}
export type Report = ReturnType<typeof analyze>;
function fmt(n: number) { return n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2); }
