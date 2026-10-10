// Sacrifices on Ethereum (PulseChain -> PLS, PulseX -> PLSX, ProveX -> PRVX): what the analyzed wallets sent, valued in USD
// at the time sent (stablecoins at $1, everything else from DefiLlama's price at that hour). Fail-soft: on error the
// report says the cost couldn't be read and the manual entry still works.
import REG from './registry.json';
import type { KV } from './cache';
import { rpc, getJSON, benched } from './net';
import { lc, toFloat, pool } from './util';
import { pricesAt, hourOf } from './eth';

export type SacCoin = 'PLS' | 'PLSX' | 'PRVX';
export const SAC_COINS: SacCoin[] = ['PLS', 'PLSX', 'PRVX'];
const X: any = (REG as any).ethereum; const S: any = (REG as any).sacrifices;
export const SAC_LIST: { id: string; coin: SacCoin; name: string; address: string; from: string; to: string; ethBlocks: [number, number]; chains: string; credit: string; distributor?: string }[] = S.list;
export const PRVX_DISTRIBUTOR: string = SAC_LIST.find(s => s.coin === 'PRVX')!.distributor!;

export interface SacTx { coin: SacCoin; ts: number; tx: string; from: string; token: string; sym: string; amount: number; usd: number | null; how: 'stablecoin' | 'price at the time' | 'no price' }
export interface SacFound { status: 'ok' | 'error'; txs: SacTx[]; usd: Record<SacCoin, number>; unpriced: number; ethAtFork: number | null }

const BY_ADDR = new Map(SAC_LIST.map(s => [s.address, s]));
const sleepJ = (ms: number) => new Promise(r => setTimeout(r, ms + Math.random() * 1000));
/** One page from an Etherscan-style API; a "busy"/malformed answer throws so the caller can back off or switch. */
async function page1(base: string, qs: string, empty: RegExp): Promise<any[]> {
  const j = await getJSON(`${base}?${qs}`, 2);
  if (Array.isArray(j?.result)) return j.result;
  if (empty.test(String(j?.message ?? ''))) return [];
  throw new Error('explorer busy');
}
/** txlist/tokentx with patient backoff. Blockscout first; plain transactions can also come from Routescan
 *  (identical results). Routescan's token-transfer index is incomplete, so tokens fall back to Transfer logs. */
async function scanAll(action: 'txlist' | 'tokentx', a: string, b0: number, b1: number): Promise<any[]> {
  const bases = [X.scan, ...(action === 'txlist' ? (X.scanFallback ?? []) : [])] as string[];
  const empty = /no (transactions|token transfers) found/i;
  for (let k = 0; k < 4; k++) {
    const order = [...bases.filter(b => !benched(b)), ...bases.filter(b => benched(b))];
    for (const base of order) {
      try {
        const out: any[] = [];
        for (let page = 1; page <= 10; page++) {
          const r = await page1(base, `module=account&action=${action}&address=${a}&startblock=${b0}&endblock=${b1}&page=${page}&offset=1000&sort=asc`, empty);
          out.push(...r); if (r.length < 1000) break;
        }
        return out;
      } catch { /* try the next source */ }
    }
    if (action === 'tokentx' && k >= 1 && (X.scanFallback ?? []).length) { const v = await tokentxViaLogs(a, b0, b1).catch(() => null); if (v) return v; }
    await sleepJ([2000, 5000, 10000, 15000][k]);
  }
  throw new Error('explorer busy');
}
/** Token sends from this wallet to each sacrifice address, from Transfer logs (any token), shaped like tokentx rows. */
async function tokentxViaLogs(a: string, b0: number, b1: number): Promise<any[]> {
  const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; const pad = (x: string) => '0x' + x.slice(2).padStart(64, '0');
  const rows: any[] = [];
  for (const s of SAC_LIST) {
    const base = (X.scanFallback as string[])[0];
    const r = await page1(base, `module=logs&action=getLogs&fromBlock=${Math.max(b0, s.ethBlocks[0])}&toBlock=${Math.min(b1, s.ethBlocks[1])}&topic0=${T}&topic1=${pad(a)}&topic2=${pad(s.address)}&topic0_1_opr=and&topic1_2_opr=and&topic0_2_opr=and`, /no (records|logs)/i);
    for (const l of r) if ((l.topics || []).length === 3) rows.push({ blockNumber: String(parseInt(l.blockNumber, 16)), timeStamp: String(parseInt(l.timeStamp, 16)), hash: lc(l.transactionHash), from: a, to: s.address, contractAddress: lc(l.address), value: BigInt(l.data && l.data !== '0x' ? l.data : '0x0').toString() });
  }
  // symbol + decimals for each token (one call each, current state)
  const toks = [...new Set(rows.map(r => r.contractAddress))]; const meta: Record<string, [string, number]> = {};
  await pool(toks, 3, async t => {
    const d = await rpc('eth_call', [{ to: t, data: '0x313ce567' }, 'latest'], { endpoints: X.rpc, tries: 4, timeoutMs: 20000 }).catch(() => null);
    meta[t] = [X.stables[t]?.[0] ?? '?', d && d !== '0x' ? Number(BigInt(d)) : (X.stables[t]?.[1] ?? 18)];
  });
  for (const r of rows) { r.tokenSymbol = meta[r.contractAddress][0]; r.tokenDecimal = String(meta[r.contractAddress][1]); }
  return rows;
}

/** Sacrifice transfers sent by these wallets on Ethereum (cached forever: the windows are closed). */
async function sacTxsOf(kv: KV, a: string): Promise<Omit<SacTx, 'usd' | 'how'>[]> {
  const key = 'sac:v1:' + a; const c = await kv.get<any[]>(key); if (c) return c;
  // one request per kind over all three windows: the explorer's classic API allows only a few calls per minute
  const ranges: [number, number][] = [[Math.min(...SAC_LIST.map(s => s.ethBlocks[0])), Math.max(...SAC_LIST.map(s => s.ethBlocks[1]))]];
  const out: Omit<SacTx, 'usd' | 'how'>[] = [];
  for (const [b0, b1] of ranges) {
    const txs = await scanAll('txlist', a, b0, b1); const tts = await scanAll('tokentx', a, b0, b1);
    const ok = (s: any, x: any) => s && +x.blockNumber >= s.ethBlocks[0] && +x.blockNumber <= s.ethBlocks[1] && lc(x.from) === a;
    for (const x of txs) { const s = BY_ADDR.get(lc(x.to)); if (ok(s, x) && x.isError === '0' && x.value !== '0') out.push({ coin: s!.coin, ts: +x.timeStamp, tx: lc(x.hash), from: a, token: 'ETH', sym: 'ETH', amount: toFloat(BigInt(x.value), 18) }); }
    for (const x of tts) { const s = BY_ADDR.get(lc(x.to)); if (ok(s, x) && x.value !== '0') out.push({ coin: s!.coin, ts: +x.timeStamp, tx: lc(x.hash), from: a, token: lc(x.contractAddress), sym: x.tokenSymbol || '?', amount: toFloat(BigInt(x.value), +(x.tokenDecimal || 18)) }); }
  }
  await kv.set(key, out); return out;
}

export async function collectSacrifices(addrs: string[], kv: KV): Promise<SacFound> {
  const usd: Record<SacCoin, number> = { PLS: 0, PLSX: 0, PRVX: 0 };
  try {
    const raw = (await pool(addrs, 1, a => sacTxsOf(kv, a))).flat();
    // prices: one DefiLlama series per token, at the hour of each transfer
    const byTok = new Map<string, number[]>(); for (const t of raw) if (!X.stables[t.token]) (byTok.get(t.token) ?? byTok.set(t.token, []).get(t.token)!).push(t.ts);
    const px: Record<string, Record<number, number>> = {};
    await pool([...byTok], 3, async ([tok, tss]) => { px[tok] = await pricesAt(kv, tok === 'ETH' ? 'coingecko:ethereum' : 'ethereum:' + tok, tss).catch(() => ({})); });
    let unpriced = 0;
    const txs: SacTx[] = raw.map(t => {
      if (X.stables[t.token]) return { ...t, usd: t.amount, how: 'stablecoin' as const };
      const p = px[t.token]?.[hourOf(t.ts)]; if (p == null) { unpriced++; return { ...t, usd: null, how: 'no price' as const }; }
      return { ...t, usd: p * t.amount, how: 'price at the time' as const };
    }).sort((x, y) => x.ts - y.ts);
    for (const t of txs) usd[t.coin] += t.usd ?? 0;
    // ETH held at the fork was copied 1:1 as PLS; anything above that in the launch balance came from the sacrifice
    let ethAtFork: number | null = 0;
    const key = 'sac:ethfork:' + [...addrs].sort().join(','); const c = await kv.get<number>(key);
    if (c != null) ethAtFork = c;
    else {
      for (const a of addrs) {
        let v: any = null;
        for (const ep of X.rpcHistory as string[]) { v = await rpc('eth_getBalance', [a, '0x' + (X.forkBlock as number).toString(16)], { endpoints: [ep], tries: 2, timeoutMs: 15000 }).catch(() => null); if (v) break; }
        if (v == null) { ethAtFork = null; break; }
        ethAtFork += toFloat(BigInt(v), 18);
      }
      if (ethAtFork != null) await kv.set(key, ethAtFork);
    }
    return { status: 'ok', txs, usd, unpriced, ethAtFork };
  } catch (e: any) { console.warn("PulseBasis: sacrifice lookup failed:", String(e?.message || e).slice(0, 200)); return { status: 'error', txs: [], usd, unpriced: 0, ethAtFork: null }; }
}
