import REG from './registry.json';
import type { KV } from './cache';
import { rpc, rpcBatch, getLogsAll, scan, scanV2, graphql } from './net';
import { TRANSFER_TOPIC, STAKE_START_TOPIC, STAKE_END_TOPIC, SEL, addrTopic, pad32, u, encodeTryAggregate, decodeTryAggregate, words, decodeString, pool, chunk, lc, toFloat, type Call } from './util';

export type Progress = (p: { phase: string; detail: string; pct: number }) => void;

export interface AddrData { txlist: any[]; internal: any[]; logsIn: any[]; logsOut: any[] }
export interface Raw {
  addrs: string[];
  latestBlock: number; latestTs: number;
  per: Record<string, AddrData>;
  stakeStarts: any[]; stakeEnds: any[];
  tokenMeta: Record<string, { sym: string; dec: number; name?: string }>;
  blockTs: Record<number, number>;
  txInfo: Record<string, { from: string; to: string; func: string }>;
  isContract: Record<string, boolean>;
  gp: Record<string, { int: [string, string, string][]; tt: [string, string, string, string][] } | null>;
  reserves: Record<number, Record<string, [string, string] | null>>;
  daily: Record<string, { date: number; priceUSD: string; totalLiquidityUSD: string }[]>;
  hex: { currentDay: number; dailyDataCount: number; daily: Record<number, [string, string]>; stakes: Record<string, { stakeId: number; stakedHearts: string; stakeShares: string; lockedDay: number; stakedDays: number; unlockedDay: number }[]> };
  balNow: Record<string, Record<string, string>>;
  balFork: Record<string, Record<string, string>>;
  senders: Record<string, { txs: number; name: string | null; contract: boolean }>;
  timings: Record<string, number>;
  statusFixed?: number;
  approxLogs?: string[];
  resGap?: number;
}

const HEXA = REG.contracts.HEX;
const MC = REG.contracts.MULTICALL3;
const hx = (n: number) => '0x' + n.toString(16);

/** Multicall at a given block, auto-splitting large call sets. */
export async function multicall(calls: Call[], block: number | 'latest', size = 120): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const c of chunk(calls, size)) out.push(...await mcPart(c, block));
  return out;
}
/* One hostile/broken token (e.g. a scam contract that burns all gas) can make the whole batch fail with
 * "out of gas" or a revert. Split the batch in half until the bad call is isolated; that call alone reads as null. */
async function mcPart(c: Call[], block: number | 'latest'): Promise<(string | null)[]> {
  try {
    const r = await rpc('eth_call', [{ to: MC, data: encodeTryAggregate(c) }, block === 'latest' ? 'latest' : hx(block)], { timeoutMs: 60000 });
    return decodeTryAggregate(r);
  } catch (e: any) {
    if (!/out of gas|gas required|execution reverted|invalid opcode|stack/i.test(String(e?.message || e))) throw e;
    if (c.length === 1) return [null];
    const m = Math.ceil(c.length / 2);
    return [...await mcPart(c.slice(0, m), block), ...await mcPart(c.slice(m), block)];
  }
}

async function cached<T>(kv: KV, key: string, fn: () => Promise<T>): Promise<T> {
  const v = await kv.get<T>(key); if (v !== undefined) return v;
  const r = await fn(); await kv.set(key, r); return r;
}

/* Explorer account lists (txlist / txlistinternal). Busy wallets have 100k+ rows, and the explorer's page-number
 * paging is slow, capped, and inconsistent on deep pages (internal page 1 and 2 overlap). So we walk by block:
 * each call asks for start_block=<last block seen> (inclusive, deduped), the block range is split into parallel
 * segments, and progress is saved to the cache after every segment so Resume continues instead of restarting. */
const rowKey = (x: any) => lc(x.hash ?? x.transactionHash) + ':' + (x.index ?? x.traceId ?? x.transactionIndex ?? '') + ':' + lc(x.from) + ':' + lc(x.to) + ':' + x.value;
async function scanRange(action: string, address: string, b0: number, b1: number, onPage?: (n: number) => void): Promise<any[]> {
  const off = 250; const out: any[] = []; const seen = new Set<string>(); let from = b0; let page = 1;
  for (let guard = 0; guard < 20000; guard++) {
    const j = await scan({ module: 'account', action, address, start_block: from, end_block: b1, page, offset: off, sort: 'asc' });
    const res = Array.isArray(j?.result) ? j.result : [];
    if (!Array.isArray(j?.result) && j?.message && !/no (transactions|internal)/i.test(j.message) && j.status !== '0') throw new Error('explorer: ' + j.message);
    let maxB = from;
    for (const x of res) { const b = +x.blockNumber; if (b < b0 || b > b1) continue; const k = rowKey(x); if (!seen.has(k)) { seen.add(k); out.push(x); } maxB = Math.max(maxB, b); }
    onPage?.(res.length);
    if (res.length < off) break;
    if (maxB === from) page++;            // one block holds a full page: page within that block
    else { from = maxB; page = 1; }       // inclusive restart at the last block, deduped above
  }
  return out;
}
async function scanAll(kv: KV, action: string, address: string, latest: number, onPage?: (n: number) => void): Promise<any[]> {
  const key = `scan:${action}:${address}`; const safe = latest - 64;
  const c = await kv.get<{ to: number; rows: any[]; segs?: Record<string, any[]> }>(key);
  const start = c ? c.to + 1 : 0; const rows: any[] = c ? c.rows : [];
  if (start > latest) return rows;
  // Old history (copied from Ethereum) is sparse; split the PulseChain part into 4 parallel segments.
  const bounds: [number, number][] = [];
  const pStart = Math.max(start, REG.forkBlock + 1);
  if (start <= REG.forkBlock) bounds.push([start, REG.forkBlock]);
  const N = latest - pStart > 200_000 ? 4 : 1; const step = Math.ceil((latest - pStart + 1) / N);
  for (let i = 0; i < N; i++) { const a = pStart + i * step; if (a <= latest) bounds.push([a, Math.min(latest, a + step - 1)]); }
  const segs = c?.segs ?? {};
  const got = await Promise.all(bounds.map(async ([a, b]) => {
    const sk = a + '-' + b; if (segs[sk]) return segs[sk];
    const r = await scanRange(action, address, a, b, onPage);
    if (b <= safe) { segs[sk] = r; await kv.set(key, { to: start - 1, rows, segs }); }   // finished segment survives a failed run
    return r;
  }));
  const seen = new Set(rows.map(rowKey));
  for (const r of got) for (const x of r) { const k = rowKey(x); if (!seen.has(k)) { seen.add(k); rows.push(x); } }
  rows.sort((x, y) => +x.blockNumber - +y.blockNumber);
  await kv.set(key, { to: safe, rows: rows.filter(x => +x.blockNumber <= safe) });
  return rows;
}

/** Incremental log fetch: cached logs up to block N, then N+1..latest in segments, saving after each segment
 *  so a long first run resumes where it stopped. */
/** Explorer v2 token transfers for one wallet and direction (complete in testing, unlike the v1 logs index),
 *  converted to eth_getLogs shape. Block numbers come from the block hashes (batched RPC, no range limits). */
function explorerTransfers(kv: KV, addr: string, dir: 'to' | 'from') {
  let all: Promise<any[] | null> | null = null;
  const load = async (): Promise<any[] | null> => {
    const items: any[] = []; let q = '';
    for (let page = 0; ; page++) {
      if (page >= 2000) return null;          // too big for the explorer: fall back to exact RPC reads, never silently cut
      const d = await scanV2(`/addresses/${addr}/token-transfers?filter=${dir}&type=ERC-20${q}`);
      if (!Array.isArray(d?.items)) return null;
      items.push(...d.items);
      const np = d.next_page_params; if (!np) break;
      q = '&' + new URLSearchParams(Object.entries(np).map(([k, v]) => [k, String(v)])).toString();
    }
    const hashes = [...new Set(items.map(x => lc(x.block_hash)))];
    const cachedB = await kv.getMany<number>(hashes.map(h => 'bh:' + h)); const bn = new Map<string, number>();
    hashes.forEach((h, i) => { if (cachedB[i] != null) bn.set(h, cachedB[i]!); });
    const need = hashes.filter(h => !bn.has(h));
    for (const part of chunk(need, 200)) {
      const rs = await rpcBatch(part.map(h => ['eth_getBlockByHash', [h, false]] as [string, any[]]), 20);
      const ent: [string, any][] = [];
      part.forEach((h, i) => { if (rs[i]?.number) { const n = parseInt(rs[i].number, 16); bn.set(h, n); ent.push(['bh:' + h, n]); } });
      await kv.setMany(ent);
    }
    const out: any[] = [];
    const wpls = lc(REG.contracts.WPLS), Z = '0x0000000000000000000000000000000000000000';
    for (const x of items) {
      // Blockscout lists WPLS Deposit/Withdrawal as mint/burn transfers; on-chain they are not Transfer logs.
      if (lc(x.token?.address ?? '') === wpls && (lc(x.from?.hash ?? Z) === Z || lc(x.to?.hash ?? Z) === Z)) continue;
      const b = bn.get(lc(x.block_hash)); if (b == null || x.total?.value == null) return null;
      out.push({ address: lc(x.token.address), topics: [TRANSFER_TOPIC, addrTopic(lc(x.from?.hash ?? '0x0000000000000000000000000000000000000000')), addrTopic(lc(x.to?.hash ?? '0x0000000000000000000000000000000000000000'))], data: '0x' + BigInt(x.total.value).toString(16).padStart(64, '0'),
        blockNumber: '0x' + b.toString(16), transactionHash: lc(x.tx_hash), logIndex: '0x' + Number(x.log_index).toString(16), _src: 'explorer' });
    }
    return out;
  };
  return async (a: number, b: number) => { all ??= load().catch(() => null); const r = await all; return r ? r.filter(l => { const n = parseInt(l.blockNumber, 16); return n >= a && n <= b; }) : null; };
}

async function incLogs(kv: KV, key: string, filter: any, from: number, latest: number, exact = false, explorer?: (a: number, b: number) => Promise<any[] | null>): Promise<any[] & { approx?: boolean }> {
  let c = await kv.get<{ to: number; logs: any[]; approx?: boolean }>(key);
  if (exact && c?.approx) c = undefined;          // re-read explorer-sourced ranges exactly
  let start = c ? c.to + 1 : from;
  const logs: any[] = c ? c.logs : []; let approx = !!c?.approx;
  const seen = new Set(logs.map(l => l.transactionHash + l.logIndex));
  const SEG = 4_000_000; const safe = latest - 64;
  while (start <= latest) {
    const end = Math.min(latest, start + SEG - 1);
    const fresh: any = await getLogsAll(filter, start, end, undefined, exact, explorer);
    if (fresh.approx) approx = true;
    for (const l of fresh) { const k = l.transactionHash + l.logIndex; if (!seen.has(k)) { seen.add(k); logs.push(l); } }
    // keep a safety margin of 64 blocks for reorgs; saved after every segment so a long run can resume
    const savedTo = Math.min(end, safe);
    await kv.set(key, { to: savedTo, logs: logs.filter(l => parseInt(l.blockNumber, 16) <= savedTo), approx });
    start = end + 1;
  }
  return Object.assign(logs, { approx });
}

export async function collect(addrsIn: string[], kv: KV, progress: Progress, opts: { exactLogs?: boolean } = {}): Promise<Raw> {
  const T0 = Date.now(); const timings: Record<string, number> = {};
  const addrs = [...new Set(addrsIn.map(lc))];
  const P = (phase: string, detail: string, pct: number) => progress({ phase, detail, pct });
  P('Connecting', 'Reading the latest PulseChain block…', 1);
  const latestBlock = parseInt(await rpc('eth_blockNumber', []), 16);
  const lb = await rpc('eth_getBlockByNumber', [hx(latestBlock), false]);
  const latestTs = parseInt(lb.timestamp, 16);

  // 1. histories
  const per: Record<string, AddrData> = {};
  const approxAddrs = new Set<string>();
  let doneA = 0;
  P('Downloading history', `0 of ${addrs.length} wallets`, 3);
  await pool(addrs, 3, async a => {
    let pages = 0; const tick = (n: number) => { pages++; if (pages % 5 === 0) P('Downloading history', `${doneA} of ${addrs.length} wallets · ~${(pages * 250).toLocaleString()} transactions read (busy wallets take a few minutes)`, 3 + Math.min(10, pages / 60)); };
    const [txlist, internal] = await Promise.all([scanAll(kv, 'txlist', a, latestBlock, tick), scanAll(kv, 'txlistinternal', a, latestBlock, tick)]);
    P('Downloading history', `${doneA} of ${addrs.length} wallets · ${(txlist.length + internal.length).toLocaleString()} transactions read · now reading token transfers (busy wallets take a few minutes)…`, 14);
    const logsIn = await incLogs(kv, `logs:in:${a}`, { topics: [TRANSFER_TOPIC, null, addrTopic(a)] }, REG.forkBlock + 1, latestBlock, opts.exactLogs, explorerTransfers(kv, a, 'to'));
    const logsOut = await incLogs(kv, `logs:out:${a}`, { topics: [TRANSFER_TOPIC, addrTopic(a)] }, REG.forkBlock + 1, latestBlock, opts.exactLogs, explorerTransfers(kv, a, 'from'));
    if (logsIn.approx || logsOut.approx) approxAddrs.add(a);
    per[a] = { txlist, internal, logsIn, logsOut };
    doneA++; P('Downloading history', `${doneA} of ${addrs.length} wallets · ${txlist.length + internal.length + logsIn.length + logsOut.length} records`, 3 + 22 * doneA / addrs.length);
  });
  timings.history = Date.now() - T0;
  // stake logs (from genesis so fork-copied stakes are known)
  P('Reading HEX stakes', 'StakeStart / StakeEnd events…', 26);
  const stakeStarts: any[] = []; const stakeEnds: any[] = [];
  await pool(addrs, 3, async a => {
    stakeStarts.push(...await incLogs(kv, `logs:ss:${a}`, { address: HEXA, topics: [STAKE_START_TOPIC, addrTopic(a)] }, REG.hexDeployBlock, latestBlock, opts.exactLogs));
    stakeEnds.push(...await incLogs(kv, `logs:se:${a}`, { address: HEXA, topics: [STAKE_END_TOPIC, addrTopic(a)] }, REG.hexDeployBlock, latestBlock, opts.exactLogs));
  });

  // 1b. Explorer-sourced logs can have gaps. Fill them from the receipts of every transaction the wallets sent
  //     (exact, no range limits); anything still off is caught by reconciliation and re-read exactly.
  if (approxAddrs.size) {
    const own = new Set(addrs); const hs: string[] = []; const seenH = new Set<string>();
    for (const a of addrs) for (const x of per[a].txlist) { const h = lc(x.hash); if (!seenH.has(h) && x.isError === '0' && +x.blockNumber > REG.forkBlock) { seenH.add(h); hs.push(h); } }
    P('Downloading history', `Double-checking ${hs.length} transactions' token transfers…`, 25);
    const cachedR = await kv.getMany<any[]>(hs.map(h => 'rlogs:' + h)); const need = hs.filter((_, i) => !cachedR[i]);
    const got = new Map<string, any[]>(); hs.forEach((h, i) => { if (cachedR[i]) got.set(h, cachedR[i]!); });
    for (const part of chunk(need, 200)) {
      const rs = await rpcBatch(part.map(h => ['eth_getTransactionReceipt', [h]] as [string, any[]]), 20);
      const ent: [string, any][] = [];
      part.forEach((h, i) => { const r = rs[i]; if (!r) return; const tl = (r.logs || []).filter((l: any) => l.topics?.[0] === TRANSFER_TOPIC && l.topics.length === 3).map((l: any) => ({ address: lc(l.address), topics: l.topics, data: l.data, blockNumber: l.blockNumber, transactionHash: lc(l.transactionHash), logIndex: l.logIndex })); got.set(h, tl); ent.push(['rlogs:' + h, tl]); });
      await kv.setMany(ent);
    }
    for (const a of approxAddrs) {
      const d = per[a]; const have = new Set([...d.logsIn, ...d.logsOut].map(l => lc(l.transactionHash) + parseInt(l.logIndex, 16)));
      const t = addrTopic(a);
      for (const tl of got.values()) for (const l of tl) {
        const k = l.transactionHash + parseInt(l.logIndex, 16); if (have.has(k)) continue;
        if (l.topics[2] === t) { d.logsIn.push(l); have.add(k); } else if (l.topics[1] === t) { d.logsOut.push(l); have.add(k); }
      }
    }
  }

  // 2. tx set, block timestamps, tx senders
  const fork = REG.forkBlock;
  const txHasInfo = new Set<string>(); const blocks = new Set<number>(); const tokens = new Set<string>();
  const allTx = new Map<string, number>();
  for (const a of addrs) {
    const d = per[a];
    for (const x of d.txlist) { txHasInfo.add(lc(x.hash)); allTx.set(lc(x.hash), +x.blockNumber); }
    for (const x of d.internal) allTx.set(lc(x.transactionHash), +x.blockNumber);
    for (const l of [...d.logsIn, ...d.logsOut]) { const b = parseInt(l.blockNumber, 16); allTx.set(lc(l.transactionHash), b); if (b > fork) { blocks.add(b); tokens.add(lc(l.address)); } }
  }
  for (const l of stakeEnds) { const b = parseInt(l.blockNumber, 16); if (b > fork) blocks.add(b); }
  const blockTs: Record<number, number> = {};
  for (const a of addrs) for (const x of [...per[a].txlist, ...per[a].internal]) blockTs[+x.blockNumber] = +x.timeStamp;
  const needTs = [...blocks].filter(b => blockTs[b] === undefined);
  P('Indexing', `${allTx.size} transactions · ${needTs.length} block times`, 30);
  const tsc = await kv.getMany<number>(needTs.map(b => 'blk:' + b));
  const missTs = needTs.filter((_, i) => tsc[i] === undefined);
  needTs.forEach((b, i) => { if (tsc[i] !== undefined) blockTs[b] = tsc[i]!; });
  if (missTs.length) {
    const r = await rpcBatch(missTs.map(b => ['eth_getBlockByNumber', [hx(b), false]] as [string, any[]]));
    const ent: [string, any][] = [];
    missTs.forEach((b, i) => { if (r[i]) { blockTs[b] = parseInt(r[i].timestamp, 16); ent.push(['blk:' + b, blockTs[b]]); } });
    await kv.setMany(ent);
  }
  const needTx = [...allTx.entries()].filter(([h, b]) => b > fork && !txHasInfo.has(h)).map(([h]) => h);
  const txInfo: Raw['txInfo'] = {};
  const txc = await kv.getMany<any>(needTx.map(h => 'tx:' + h));
  const missTx = needTx.filter((_, i) => !txc[i]);
  needTx.forEach((h, i) => { if (txc[i]) txInfo[h] = txc[i]; });
  if (missTx.length) {
    P('Indexing', `Looking up ${missTx.length} incoming transactions…`, 34);
    const r = await rpcBatch(missTx.map(h => ['eth_getTransactionByHash', [h]] as [string, any[]]));
    const ent: [string, any][] = [];
    missTx.forEach((h, i) => { const t = r[i]; if (t) { txInfo[h] = { from: lc(t.from), to: lc(t.to), func: (t.input || '0x').slice(0, 10) }; ent.push(['tx:' + h, txInfo[h]]); } });
    await kv.setMany(ent);
  }
  timings.index = Date.now() - T0;

  // 3. token metadata
  const toks = [...tokens];
  const tokenMeta: Raw['tokenMeta'] = {};
  const mc = await kv.getMany<any>(toks.map(t => 'meta:' + t));
  const missM = toks.filter((_, i) => !mc[i]);
  toks.forEach((t, i) => { if (mc[i]) tokenMeta[t] = mc[i]; });
  if (missM.length) {
    P('Indexing', `Reading ${missM.length} token contracts…`, 37);
    const calls: Call[] = missM.flatMap(t => [{ target: t, data: '0x' + SEL.symbol }, { target: t, data: '0x' + SEL.decimals }, { target: t, data: '0x' + SEL.name }]);
    const r = await multicall(calls, 'latest', 150);
    const ent: [string, any][] = [];
    missM.forEach((t, i) => {
      const sym = decodeString(r[i * 3]) ?? t.slice(0, 8); const decW = words(r[i * 3 + 1])[0]; const name = decodeString(r[i * 3 + 2]) ?? undefined;
      tokenMeta[t] = { sym, dec: decW !== undefined && decW < 80n ? Number(decW) : 18, name }; ent.push(['meta:' + t, tokenMeta[t]]);
    });
    await kv.setMany(ent);
  }

  // 4. HEX state
  P('Reading HEX stakes', 'Current stakes, T-shares and daily payouts…', 40);
  const gi = await multicall([{ target: HEXA, data: '0x' + SEL.currentDay }, { target: HEXA, data: '0x' + SEL.globalInfo }], 'latest');
  const currentDay = Number(words(gi[0])[0]); const giw = words(gi[1]);
  const dailyDataCount = Number(giw[4] ?? BigInt(currentDay)); // globalInfo() returns uint256[13] (static) – index 4 = dailyDataCount
  const counts = await multicall(addrs.map(a => ({ target: HEXA, data: '0x' + SEL.stakeCount + pad32(a) })), 'latest');
  const stakes: Raw['hex']['stakes'] = {};
  const scalls: Call[] = []; const sidx: [string, number][] = [];
  addrs.forEach((a, i) => { const n = Number(words(counts[i])[0] ?? 0n); stakes[a] = []; for (let k = 0; k < n; k++) { scalls.push({ target: HEXA, data: '0x' + SEL.stakeLists + pad32(a) + u(k) }); sidx.push([a, k]); } });
  const sl = await multicall(scalls, 'latest', 100);
  sl.forEach((r, i) => {
    const w = words(r); if (w.length < 7) return;
    stakes[sidx[i][0]].push({ stakeId: Number(w[0]), stakedHearts: w[1].toString(), stakeShares: w[2].toString(), lockedDay: Number(w[3]), stakedDays: Number(w[4]), unlockedDay: Number(w[5]) });
  });
  const allSt = Object.values(stakes).flat();
  const dd: Record<number, [string, string]> = {};
  const hiDay = Math.min(currentDay, dailyDataCount || currentDay);
  if (allSt.length) {
    const lo = Math.max(0, Math.min(...allSt.map(s => s.lockedDay), hiDay - 30));
    const days = Array.from({ length: Math.max(0, hiDay - lo) }, (_, i) => lo + i);
    const dc = await kv.getMany<[string, string]>(days.map(d => 'hexday:' + d));
    const miss = days.filter((_, i) => !dc[i]);
    days.forEach((d, i) => { if (dc[i]) dd[d] = dc[i]!; });
    // contiguous ranges of missing days → dailyDataRange(begin,end)
    const ranges: [number, number][] = [];
    for (const d of miss) { const l = ranges[ranges.length - 1]; if (l && l[1] === d) l[1] = d + 1; else ranges.push([d, d + 1]); }
    const ent: [string, any][] = [];
    for (const [b0, e0] of ranges) for (let b = b0; b < e0; b += 400) {
      const e = Math.min(e0, b + 400);
      const r = await rpc('eth_call', [{ to: HEXA, data: '0x' + SEL.dailyDataRange + u(b) + u(e) }, 'latest']);
      const w = words(r).slice(2);
      w.forEach((v, i) => { const pay = v & ((1n << 72n) - 1n); const sh = (v >> 72n) & ((1n << 72n) - 1n); dd[b + i] = [pay.toString(), sh.toString()]; ent.push(['hexday:' + (b + i), dd[b + i]]); });
    }
    await kv.setMany(ent);
  }

  // 5. balances now and at the fork (opening balances = fork copies)
  const assetToks: [string, string][] = [];
  for (const [k, a] of Object.entries(REG.assets)) for (const t of a.tokens) if (t !== 'PLS') assetToks.push([k, t]);
  const balCalls = (a: string): Call[] => [{ target: MC, data: '0x' + SEL.getEthBalance + pad32(a) }, ...assetToks.map(([, t]) => ({ target: t, data: '0x' + SEL.balanceOf + pad32(a) }))];
  const decodeBal = (r: (string | null)[], off: number) => {
    const o: Record<string, string> = { 'PLS': (words(r[off])[0] ?? 0n).toString() };
    assetToks.forEach(([, t], i) => { o[t] = (words(r[off + 1 + i])[0] ?? 0n).toString(); });
    return o;
  };
  const balNow: Raw['balNow'] = {}; const balFork: Raw['balFork'] = {};
  {
    const calls = addrs.flatMap(balCalls); const n = 1 + assetToks.length;
    const r = await multicall(calls, latestBlock);
    addrs.forEach((a, i) => { balNow[a] = decodeBal(r, i * n); });
    const fk = await cached(kv, 'fork:' + addrs.slice().sort().join(','), async () => {
      const rf = await multicall(calls, fork);
      const o: Raw['balFork'] = {}; addrs.forEach((a, i) => { o[a] = decodeBal(rf, i * n); }); return o;
    });
    Object.assign(balFork, fk);
  }
  timings.state = Date.now() - T0;

  // 6. GoPulse fee legs (measured on-chain)
  const GP = REG.venues.find(v => v.id === 'gopulse')!;
  const gpTo = new Set(GP.to);
  const gpHashes = new Set<string>();
  for (const a of addrs) for (const x of per[a].txlist) if (gpTo.has(lc(x.to)) && x.isError === '0' && +x.blockNumber > fork) gpHashes.add(lc(x.hash));
  const gp: Raw['gp'] = {};
  const gph = [...gpHashes]; const gpc = await kv.getMany<any>(gph.map(h => 'gp:' + h));
  const missG = gph.filter((_, i) => !gpc[i]); gph.forEach((h, i) => { if (gpc[i]) gp[h] = gpc[i]; });
  if (missG.length) {
    let n = 0;
    const rc = await rpcBatch(missG.map(h => ['eth_getTransactionReceipt', [h]] as [string, any[]]));
    const ent: [string, any][] = [];
    await pool(missG, 4, async (h, i) => {
      const j = await scan({ module: 'account', action: 'txlistinternal', txhash: h }).catch(() => null);
      const ints = Array.isArray(j?.result) ? j.result.filter((x: any) => x.isError === '0').map((x: any) => [lc(x.from), lc(x.to), x.value]) : [];
      const tt = (rc[i]?.logs || []).filter((l: any) => l.topics?.[0] === TRANSFER_TOPIC && l.topics.length === 3).map((l: any) => [lc(l.address), '0x' + l.topics[1].slice(26), '0x' + l.topics[2].slice(26), BigInt(l.data === '0x' ? 0 : l.data).toString()]);
      gp[h] = rc[i] && j ? { int: ints, tt } : null; if (gp[h]) ent.push(['gp:' + h, gp[h]]);
      n++; if (n % 10 === 0) P('Measuring fees', `GoPulse fee legs ${n} of ${missG.length}`, 44 + 6 * n / missG.length);
    });
    await kv.setMany(ent);
  }
  timings.fees = Date.now() - T0;

  // 7. contract flags for counterparties (labels)
  const cps = new Set<string>();
  for (const a of addrs) {
    for (const x of per[a].txlist) if (lc(x.from) === a && x.to) cps.add(lc(x.to));
    for (const l of per[a].logsOut) cps.add('0x' + l.topics[2].slice(26));
  }
  const cpl = [...cps]; const isContract: Record<string, boolean> = {};
  const cc = await kv.getMany<boolean>(cpl.map(a => 'code:' + a));
  const missC = cpl.filter((_, i) => cc[i] === undefined); cpl.forEach((a, i) => { if (cc[i] !== undefined) isContract[a] = cc[i]!; });
  if (missC.length) {
    const r = await rpcBatch(missC.map(a => ['eth_getCode', [a, 'latest']] as [string, any[]]));
    const ent: [string, any][] = [];
    missC.forEach((a, i) => { isContract[a] = !!r[i] && r[i] !== '0x'; ent.push(['code:' + a, isContract[a]]); });
    await kv.setMany(ent);
  }

  // 7b. Fill gaps in the explorer's internal-transaction index: for wallet-sent contract calls that show no
  // incoming value at all (e.g. a router sending native PLS back), read the call trace from the archive RPC.
  {
    const own = new Set(addrs); const hasIn = new Set<string>(); const internalKey = new Set<string>();
    for (const a of addrs) {
      for (const x of per[a].internal) { hasIn.add(lc(x.transactionHash)); internalKey.add(lc(x.transactionHash) + lc(x.from) + lc(x.to) + x.value); }
      for (const l of per[a].logsIn) if (!own.has('0x' + l.topics[1].slice(26))) hasIn.add(lc(l.transactionHash));
    }
    const SKIP = new Set(['0xa9059cbb', '0x095ea7b3', '0x', '0x52a438b8', '0xd0e30db0', '0x23b872dd']);
    const cand: { h: string; b: number; ts: number }[] = []; const seenH = new Set<string>();
    for (const a of addrs) for (const x of per[a].txlist) {
      const h = lc(x.hash);
      if (seenH.has(h) || lc(x.from) !== a || x.isError !== '0' || +x.blockNumber <= fork || !x.to) continue;
      seenH.add(h);
      if (SKIP.has((x.input || '0x').slice(0, 10)) || lc(x.to) === HEXA || hasIn.has(h) || isContract[lc(x.to)] === false) continue;
      cand.push({ h, b: +x.blockNumber, ts: +x.timeStamp });
    }
    if (cand.length) {
      P('Indexing', `Checking ${cand.length} contract calls for missing PLS returns…`, 48);
      const tc = await kv.getMany<any[]>(cand.map(c => 'trace:' + c.h));
      const ent: [string, any][] = [];
      let nt = 0;
      await pool(cand, 6, async (c, i) => {
        if (++nt % 200 === 0) P('Indexing', `Checking contract calls for missing PLS returns: ${nt} of ${cand.length}`, 48 + 2 * nt / cand.length);
        let tr = tc[i];
        if (!tr) {
          const r = await rpc('trace_transaction', [c.h]).catch(() => null);
          if (!Array.isArray(r)) return;
          const top = r.find((x: any) => !x.traceAddress?.length);
          tr = top?.error ? [] : r.filter((x: any) => !x.error && x.traceAddress?.length && x.action?.value && BigInt(x.action.value) > 0n).map((x: any) => [lc(x.action.from), lc(x.action.to), BigInt(x.action.value).toString()]);
          ent.push(['trace:' + c.h, tr]);
        }
        for (const [f, t, v] of tr) {
          if (!own.has(t) && !own.has(f)) continue;
          const k = c.h + f + t + v; if (internalKey.has(k)) continue; internalKey.add(k);
          const rec = { transactionHash: c.h, blockNumber: String(c.b), timeStamp: String(c.ts), from: f, to: t, value: v, isError: '0', _src: 'trace' };
          per[own.has(t) ? t : f].internal.push(rec);
        }
      });
      await kv.setMany(ent);
    }
  }

  // 8. daily prices (subgraph tokenDayDatas), incremental
  P('Pricing', 'Daily price history (PulseX v1 + v2)…', 50);
  const daily: Raw['daily'] = {};
  const subJobs: [string, string, string][] = [];
  for (const [k, a] of Object.entries(REG.assets) as [string, any][]) if (a.subgraphToken) for (const v of ['v1', 'v2']) subJobs.push([`${v}_${k}`, (REG.rpc.subgraphs as any)[v], a.subgraphToken]);
  await pool(subJobs, 4, async ([key, url, tok]) => {
    const c = await kv.get<{ at: number; rows: any[] }>('daily:' + key);
    let rows = c?.rows ?? [];
    if (!c || Date.now() - c.at > 3 * 3600e3) {
      let last = rows.length ? rows[rows.length - 2]?.date ?? 0 : 0;
      rows = rows.filter(r => r.date <= last);
      for (let i = 0; i < 20; i++) {
        const q = `{tokenDayDatas(first:1000,orderBy:date,orderDirection:asc,where:{token:"${tok}",date_gt:${last}}){date priceUSD totalLiquidityUSD}}`;
        const d = (await graphql(url, q).catch(() => null))?.tokenDayDatas;
        if (!d) break;
        rows.push(...d); if (d.length < 1000) break; last = d[d.length - 1].date;
      }
      await kv.set('daily:' + key, { at: Date.now(), rows });
    }
    daily[key] = rows;
  });
  timings.daily = Date.now() - T0;

  // 9. exact-block reserves (pool state at block-1) for every block with activity, + latest
  const pairKeys = Object.keys(REG.pairs);
  const pairCalls: Call[] = pairKeys.map(k => ({ target: (REG.pairs as any)[k].pair, data: '0x' + SEL.getReserves }));
  // Only blocks where a priced coin actually moves need pool reserves. Junk-token airdrops and sub-$0.50 PLS
  // reflections paid out by dividend-token contracts (internal transfers) (tens of thousands per wallet for some holders) are counted as free
  // anyway, so they fall back to the daily price instead of costing one archive call each.
  const pricedTok = new Set<string>(); for (const a of Object.values<any>(REG.assets)) for (const t of a.tokens) if (t !== 'PLS') pricedTok.add(lc(t));
  const plsDay = new Map<number, number>(); for (const k of ['v1_PLS', 'v2_PLS']) for (const r of daily[k] ?? []) { const p = parseFloat(r.priceUSD); if (p > 0 && !plsDay.has(Math.floor(r.date / 86400))) plsDay.set(Math.floor(r.date / 86400), p); }
  const plsUsd = (wei: string, ts: number) => { const d = Math.floor(ts / 86400); for (let k = 0; k < 60; k++) { const p = plsDay.get(d - k) ?? plsDay.get(d + k); if (p) return toFloat(BigInt(wei || '0'), 18) * p; } return Infinity; };
  const sentByUs = new Set<string>(); for (const a of addrs) for (const x of per[a].txlist) if (lc(x.from) === a) sentByUs.add(lc(x.hash));
  const priceBlocks = new Set<number>();
  for (const l of stakeEnds) priceBlocks.add(parseInt(l.blockNumber, 16));
  for (const a of addrs) {
    const d = per[a];
    for (const x of d.txlist) if (sentByUs.has(lc(x.hash)) || x.value !== '0') priceBlocks.add(+x.blockNumber);   // direct sends (ramps, exchanges): always exact
    for (const x of d.internal) if (sentByUs.has(lc(x.transactionHash)) || plsUsd(x.value, +x.timeStamp) >= 0.5) priceBlocks.add(+x.blockNumber);
    for (const l of [...d.logsIn, ...d.logsOut]) if (pricedTok.has(lc(l.address)) || sentByUs.has(lc(l.transactionHash))) priceBlocks.add(parseInt(l.blockNumber, 16));
  }
  let resBlocks = [...new Set([...priceBlocks].filter(b => b > fork).map(b => b - 1))].sort((a, b) => a - b);
  // Very busy wallets (bots) can need 100k+ exact-block reads (~50 min). Above MAX, read one pool snapshot per
  // `gap` blocks instead, and price each tx from the nearest snapshot (minutes away, still far closer than daily).
  const MAX_RES = 15000; let resGap = 0;
  if (resBlocks.length > MAX_RES) {
    for (resGap = 10; ; resGap = Math.ceil(resGap * 1.5)) {
      const seenB = new Set<number>(); const keep = resBlocks.filter(b => { const k = Math.floor(b / resGap); if (seenB.has(k)) return false; seenB.add(k); return true; });
      if (keep.length <= MAX_RES || resGap > 20000) { resBlocks = keep; break; }
    }
  }
  timings.resSkipped = new Set([...blocks, ...[...allTx.values()].filter(b => b > fork)]).size - resBlocks.length;
  const reserves: Raw['reserves'] = {};
  const rc = await kv.getMany<any>(resBlocks.map(b => 'res:' + b));
  const missR = resBlocks.filter((_, i) => !rc[i]); resBlocks.forEach((b, i) => { if (rc[i]) reserves[b] = rc[i]; });
  let nr = 0; const tR = Date.now();
  const decodeRes = (r: (string | null)[]) => { const o: Record<string, [string, string] | null> = {}; pairKeys.forEach((k, i) => { const w = words(r[i]); o[k] = w.length >= 2 ? [w[0].toString(), w[1].toString()] : null; }); return o; };
  P('Pricing', `Exact-block prices: ${resBlocks.length - missR.length} cached, ${missR.length} to fetch`, 55);
  let buf: [string, any][] = [];
  await pool(missR, 12, async b => {
    const r = await multicall(pairCalls, b, 200).catch(() => null);
    if (!r) return;
    reserves[b] = decodeRes(r); buf.push(['res:' + b, reserves[b]]);
    nr++;
    if (buf.length >= 100) { const e = buf; buf = []; await kv.setMany(e); }
    if (nr % 20 === 0) {
      const el = (Date.now() - tR) / 1000; const eta = Math.round(el / nr * (missR.length - nr));
      P('Pricing', `Exact-block prices: ${nr} of ${missR.length} blocks${eta > 5 ? ` · ~${eta}s left` : ''}`, 55 + 40 * nr / missR.length);
    }
  });
  await kv.setMany(buf);
  reserves[latestBlock] = decodeRes(await multicall(pairCalls, latestBlock, 200));
  timings.reserves = Date.now() - T0;

  return { resGap, addrs, latestBlock, latestTs, per, stakeStarts, stakeEnds, tokenMeta, blockTs, txInfo, isContract, gp, reserves, daily,
    hex: { currentDay, dailyDataCount: hiDay, daily: dd, stakes }, balNow, balFork, senders: {}, timings, approxLogs: [...approxAddrs] };
}

/** Sender info for unknown money-in counterparties (for hot-wallet heuristic and contract names). */
export async function senderInfo(kv: KV, addrs: string[]): Promise<Raw['senders']> {
  const out: Raw['senders'] = {};
  await pool(addrs, 4, async a => {
    out[a] = await cached(kv, 'sender:' + a, async () => {
      const [c, i] = await Promise.all([scanV2(`/addresses/${a}/counters`).catch(() => null), scanV2(`/addresses/${a}`).catch(() => null)]);
      return { txs: +(c?.transactions_count ?? 0), name: i?.name ?? null, contract: !!i?.is_contract };
    });
  });
  return out;
}

/** The explorer occasionally reports a reverted transaction as successful. When the PLS balance doesn't reconcile,
 *  re-check every PLS-carrying transaction's status against the archive node's receipt and fix the raw data. */
export async function verifyStatuses(raw: Raw, kv: KV, progress?: Progress): Promise<number> {
  const own = new Set(raw.addrs); const hs = new Set<string>();
  for (const a of raw.addrs) for (const x of raw.per[a].txlist) if (x.isError === '0' && x.value && x.value !== '0' && +x.blockNumber > REG.forkBlock) hs.add(lc(x.hash));
  for (const a of raw.addrs) for (const x of raw.per[a].internal) if (x.isError === '0' && x._src !== 'trace' && (own.has(lc(x.to)) || own.has(lc(x.from)))) hs.add(lc(x.transactionHash));
  const list = [...hs]; if (!list.length) return 0;
  progress?.({ phase: 'Double-checking', detail: `Verifying ${list.length} PLS transfers against the chain…`, pct: 97 });
  const cached = await kv.getMany<string>(list.map(h => 'st:' + h)); const need = list.filter((_, i) => cached[i] == null);
  const st = new Map<string, string>(); list.forEach((h, i) => { if (cached[i] != null) st.set(h, cached[i]!); });
  for (const part of chunk(need, 100)) {
    const rs = await rpcBatch(part.map(h => ['eth_getTransactionReceipt', [h]] as [string, any[]]), 25);
    const ent: [string, any][] = [];
    part.forEach((h, i) => { const s = rs[i]?.status; if (s) { st.set(h, s); ent.push(['st:' + h, s]); } });
    await kv.setMany(ent);
  }
  let fixed = 0; const bad = new Set([...st].filter(([, s]) => s === '0x0').map(([h]) => h));
  for (const a of raw.addrs) {
    for (const x of raw.per[a].txlist) if (bad.has(lc(x.hash)) && x.isError === '0') { x.isError = '1'; fixed++; }
    for (const x of raw.per[a].internal) if (bad.has(lc(x.transactionHash))) x.isError = '1';
  }
  raw.statusFixed = (raw.statusFixed ?? 0) + bad.size;
  return fixed;
}
