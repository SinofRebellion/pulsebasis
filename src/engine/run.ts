import type { KV } from './cache';
import { collect, senderInfo, verifyStatuses, type Progress, type Raw } from './fetch';
import { buildLedger, Prices, replay as replay0 } from './replay';
import { analyze } from './analyze';
import { stats } from './net';
import { collectEth, analyzeEth, type EthReport } from './eth';
import { collectSacrifices, SAC_COINS, type SacFound, type SacCoin } from './sacrifice';
import type { Prices as PricesT, Tx } from './replay';

export type ManualSac = Partial<Record<SacCoin, number>>;

export async function runAll(addrs: string[], kv: KV, progress: Progress, rawOverride?: Raw, manual: ManualSac = {}) {
  const t0 = Date.now();
  // Ethereum HEX runs alongside PulseChain and can never break the PulseChain report.
  const ethP: Promise<EthReport> = rawOverride ? Promise.resolve({ status: 'skipped', message: '' }) : Promise.race([
    collectEth(addrs, kv, () => {}).then(analyzeEth),
    new Promise<EthReport>(res => setTimeout(() => res({ status: 'error', message: 'Ethereum took too long to answer.' }), 240000)),
  ]).catch(() => ({ status: 'error' as const, message: "Couldn't read Ethereum right now." }));
  const sacP: Promise<SacFound> = rawOverride ? Promise.resolve({ status: 'ok', txs: [], usd: { PLS: 0, PLSX: 0, PRVX: 0 }, unpriced: 0, ethAtFork: null }) : Promise.race([
    collectSacrifices(addrs, kv),
    new Promise<SacFound>(res => setTimeout(() => { console.warn('PulseBasis: sacrifice lookup timed out'); res({ status: 'error', txs: [], usd: { PLS: 0, PLSX: 0, PRVX: 0 }, unpriced: 0, ethAtFork: null }); }, 240000)),
  ]);
  let raw = rawOverride ?? await collect(addrs, kv, progress);
  progress({ phase: 'Crunching', detail: 'Checking sacrifices on Ethereum…', pct: 95 });
  const sacF = await sacP;
  const cost = Object.fromEntries(SAC_COINS.map(c => [c, (sacF.usd[c] || 0) + Math.max(0, +(manual[c] ?? 0) || 0)])) as Record<SacCoin, number>;
  // pass 1 finds how many coins each sacrifice produced; pass 2 spreads the sacrifice cost over them
  const replay = (r: Raw, L: Tx[], PR: PricesT, snd: Raw['senders']) => {
    const base = { cost, ethAtFork: sacF.ethAtFork };
    const e1 = replay0(r, L, PR, snd, base);
    if (!SAC_COINS.some(c => cost[c] > 0 && e1.sacRecv[c].q > 0)) return e1;
    return replay0(r, L, PR, snd, { ...base, qty: Object.fromEntries(SAC_COINS.map(c => [c, e1.sacRecv[c].q])) as Record<SacCoin, number> });
  };
  progress({ phase: 'Crunching', detail: 'Replaying every transaction…', pct: 96 });
  const L = buildLedger(raw); const PR = new Prices(raw);
  let E = replay(raw, L, PR, raw.senders);
  if (!rawOverride && E.unknownSenders.size) {
    progress({ phase: 'Crunching', detail: `Identifying ${E.unknownSenders.size} senders (exchanges, escrows)…`, pct: 97 });
    raw.senders = await senderInfo(kv, [...E.unknownSenders].slice(0, 300));
    E = replay(raw, L, PR, raw.senders);
  }
  let rep = analyze(raw, L, E, PR);
  // Explorer-sourced logs that still don't reconcile: re-read those wallets' logs exactly from the RPCs.
  const tokenMiss = rep.accuracy.recon.filter(x => !x.ok && x.label !== 'PLS');
  if ((globalThis as any).process?.env?.DEBUG_RECON) console.error('RECON1', JSON.stringify(rep.accuracy.recon));
  if (!rawOverride && raw.approxLogs?.length && tokenMiss.length) {
    progress({ phase: 'Double-checking', detail: 'A balance didn\'t match, so we\'re re-reading those transfers directly from the chain…', pct: 60 });
    raw = await collect(addrs, kv, progress, { exactLogs: true });
    const Lx = buildLedger(raw); const PRx = new Prices(raw);
    E = replay(raw, Lx, PRx, raw.senders);
    if (E.unknownSenders.size) { raw.senders = await senderInfo(kv, [...E.unknownSenders].slice(0, 300)); E = replay(raw, Lx, PRx, raw.senders); }
    rep = analyze(raw, Lx, E, PRx);
  }
  const plsRow = rep.accuracy.recon.find(x => x.label === 'PLS');
  if (!rawOverride && plsRow && !plsRow.ok && await verifyStatuses(raw, kv, progress)) {
    const L2 = buildLedger(raw); const PR2 = new Prices(raw);
    E = replay(raw, L2, PR2, raw.senders); rep = analyze(raw, L2, E, PR2);
  }
  rep.sacrifice = { status: sacF.status, txs: sacF.txs, found: sacF.usd, manual: Object.fromEntries(SAC_COINS.map(c => [c, Math.max(0, +(manual[c] ?? 0) || 0)])) as Record<SacCoin, number>, unpriced: sacF.unpriced, ethAtFork: sacF.ethAtFork, recv: E.sacRecv, nfHeld: E.sacnfHeld };
  progress({ phase: 'Finishing', detail: 'Reading HEX on Ethereum…', pct: 99 });
  rep.eth = await ethP;
  if (rep.eth.status === 'ok') { rep.accuracy.recon.push(...rep.eth.recon); rep.accuracy.allOk = rep.accuracy.recon.every(r => r.ok); }
  progress({ phase: 'Done', detail: '', pct: 100 });
  return { report: rep, ms: Date.now() - t0, timings: raw.timings, requests: stats.requests, replay: E };
}
