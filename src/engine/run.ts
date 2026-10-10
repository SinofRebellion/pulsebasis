import type { KV } from './cache';
import { collect, senderInfo, verifyStatuses, type Progress, type Raw } from './fetch';
import { buildLedger, Prices, replay } from './replay';
import { analyze } from './analyze';
import { stats } from './net';

export async function runAll(addrs: string[], kv: KV, progress: Progress, rawOverride?: Raw) {
  const t0 = Date.now();
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
  progress({ phase: 'Done', detail: '', pct: 100 });
  return { report: rep, ms: Date.now() - t0, timings: raw.timings, requests: stats.requests, replay: E };
}
