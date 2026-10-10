import type { KV } from './cache';
import { collect, senderInfo, verifyStatuses, type Progress, type Raw } from './fetch';
import { buildLedger, Prices, replay } from './replay';
import { analyze } from './analyze';
import { stats } from './net';
import { collectEth, analyzeEth, type EthReport } from './eth';

export async function runAll(addrs: string[], kv: KV, progress: Progress, rawOverride?: Raw) {
  const t0 = Date.now();
  // Ethereum HEX runs alongside PulseChain and can never break the PulseChain report.
  const ethP: Promise<EthReport> = rawOverride ? Promise.resolve({ status: 'skipped', message: '' }) : Promise.race([
    collectEth(addrs, kv, () => {}).then(analyzeEth),
    new Promise<EthReport>(res => setTimeout(() => res({ status: 'error', message: 'Ethereum took too long to answer.' }), 240000)),
  ]).catch(() => ({ status: 'error' as const, message: "Couldn't read Ethereum right now." }));
  let raw = rawOverride ?? await collect(addrs, kv, progress);
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
  progress({ phase: 'Finishing', detail: 'Reading HEX on Ethereum…', pct: 99 });
  rep.eth = await ethP;
  if (rep.eth.status === 'ok') { rep.accuracy.recon.push(...rep.eth.recon); rep.accuracy.allOk = rep.accuracy.recon.every(r => r.ok); }
  progress({ phase: 'Done', detail: '', pct: 100 });
  return { report: rep, ms: Date.now() - t0, timings: raw.timings, requests: stats.requests, replay: E };
}
