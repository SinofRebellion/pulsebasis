/// <reference lib="webworker" />
import { IDBKV } from './engine/cache';
import { runAll } from './engine/run';
import { stats, resetStats, isBusy } from './engine/net';

const kv = new IDBKV();
self.onmessage = async (e: MessageEvent) => {
  const { type, addrs, manual } = e.data || {};
  if (type === 'clear') { await kv.clear(); (self as any).postMessage({ type: 'cleared' }); return; }
  if (type !== 'run') return;
  resetStats(); const t0 = Date.now(); let attempts = 1;
  const runKey = 'ran:' + [...(addrs || [])].sort().join(','); const repeat = !!(await kv.get(runKey).catch(() => null));
  const health = (ok: boolean, cached = false) => ({ ok, ms: Date.now() - t0, attempts, cached, requests: stats.requests, retries: stats.retries, rateHits: stats.rateHits, rangeHits: stats.rangeHits, hosts: stats.hosts, wallets: (addrs || []).length });
  try {
    const prog = (p: any) => (self as any).postMessage({ type: 'progress', ...p });
    let r: Awaited<ReturnType<typeof runAll>>;
    for (let attempt = 0; ; attempt++) {
      try { r = await runAll(addrs, kv, prog, undefined, manual || {}); break; }
      catch (e: any) {
        if (attempt >= 4) throw e;   // each resume keeps everything already saved, so busy servers get several patient tries   // every call already retried patiently; don't keep the visitor waiting
        attempts++;
        console.warn('PulseBasis: run attempt', attempt + 1, 'failed, resuming:', String(e?.message || e).slice(0, 300));
        prog({ phase: 'Retrying', detail: 'A public server hiccuped. Resuming from what is already saved…', pct: 50 });
        await new Promise(res => setTimeout(res, [5000, 15000, 30000, 45000][attempt]));
      }
    }
    (self as any).postMessage({ type: 'done', report: r.report, ms: r.ms, timings: r.timings, requests: r.requests, health: health(true, repeat) });
    kv.set(runKey, Date.now()).catch(() => {});
  } catch (err: any) {
    // Raw server/RPC text is never shown to the visitor (it goes to the console only).
    console.warn('PulseBasis: run failed:', String(err?.message || err).slice(0, 300));
    (self as any).postMessage({ type: 'error', kind: isBusy(err) ? 'busy' : 'other', message: '', health: health(false, repeat) });
  }
};
