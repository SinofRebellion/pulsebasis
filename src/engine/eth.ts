// Original HEX on Ethereum: balances, buys (cost at the time), stakes and the May 2023 fork snapshot.
// Data: Ethereum explorer (token transfers + HEX event logs), public Ethereum RPCs (current state, receipts),
// DefiLlama (ETH and HEX USD prices at a timestamp). Everything here is fail-soft: if Ethereum can't be
// read, the PulseChain report is unaffected and the section says so.
import REG from './registry.json';
import type { KV } from './cache';
import { rpc, getJSON, benched } from './net';
import { SEL, ZERO, pad32, u, words, encodeTryAggregate, decodeTryAggregate, chunk, pool, lc, toFloat, type Call } from './util';

const X: any = (REG as any).ethereum;
const HEX = X.hex as string;
const M72 = (1n << 72n) - 1n;
const L0 = Date.UTC(2019, 11, 3) / 1000;
const ownT = (a: string) => '0x' + pad32(a);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Etherscan-style log APIs in failover order (Blockscout, then keyless Routescan). Healthy hosts first. */
const scanBases = () => { const all = [X.scan, ...(X.scanFallback ?? [])] as string[]; return [...all.filter(u => !benched(u)), ...all.filter(u => benched(u))]; };
/** Set when Ethereum history had to come from a fallback source or could not be fully read. */
export const ethReadState = { fallbackUsed: false, incomplete: false };
async function scanLogs(qs: string): Promise<any[]> {
  let last: any;
  for (const base of scanBases()) {
    try {
      const j = await getJSON(`${base}?${qs}`, 3);
      if (Array.isArray(j?.result)) { if (base !== X.scan) ethReadState.fallbackUsed = true; return j.result; }
      if (j?.status === '0' && /no (records|logs)/i.test(String(j?.message))) { if (base !== X.scan) ethReadState.fallbackUsed = true; return []; }
      last = new Error('bad answer from ' + base);
    } catch (e) { last = e; }
  }
  throw last ?? new Error('Ethereum explorer did not answer');
}
/** Paged getLogs (1000 per answer), inclusive re-read of the last block, deduped by tx:logIndex. */
async function logsPaged(filter: string, from: number): Promise<any[]> {
  const out = new Map<string, any>(); let max = from;
  for (let g = 0; g < 200; g++) {
    const res = await scanLogs(`module=logs&action=getLogs&address=${HEX}&fromBlock=${from}&toBlock=latest&${filter}`);
    for (const l of res) { const b = parseInt(l.blockNumber, 16); max = Math.max(max, b); out.set(lc(l.transactionHash) + ':' + parseInt(l.logIndex, 16), l); }
    if (res.length < 1000) break;
    from = max;
  }
  return [...out.values()];
}
/** Fallback for HEX transfers when the Blockscout v2 API fails: Transfer logs where the wallet is sender or receiver. */
async function transfersViaLogs(a: string): Promise<EthTransfer[]> {
  const [outL, inL] = await Promise.all([logsPaged(`topic0=${TRANSFER}&topic1=${ownT(a)}&topic0_1_opr=and`, 0), logsPaged(`topic0=${TRANSFER}&topic2=${ownT(a)}&topic0_2_opr=and`, 0)]);
  const m = new Map<string, EthTransfer>();
  for (const l of [...outL, ...inL]) {
    const t: EthTransfer = { b: parseInt(l.blockNumber, 16), li: parseInt(l.logIndex, 16) || 0, ts: parseInt(l.timeStamp, 16), tx: lc(l.transactionHash), from: '0x' + l.topics[1].slice(26), to: '0x' + l.topics[2].slice(26), v: BigInt(l.data).toString() };
    m.set(t.tx + ':' + t.li, t);
  }
  ethReadState.fallbackUsed = true;
  return [...m.values()];
}

export interface EthTransfer { b: number; li: number; ts: number; tx: string; from: string; to: string; v: string }
export interface EthLog { b: number; li: number; ts: number; tx: string; topics: string[]; data: string }
export interface EthRaw {
  addrs: string[]; latestTs: number; currentDay: number;
  transfers: EthTransfer[]; ss: EthLog[]; se: EthLog[]; le: EthLog[]; lx: EthLog[];
  pay: Record<string, { from: string; ethWei: string; stables: [string, string][] } | null>;   // tx -> what our wallets paid
  bal: Record<string, string>; stakes: Record<string, { stakeId: number; stakedHearts: string; stakeShares: string; lockedDay: number; stakedDays: number }[]>;
  daily: Record<number, [string, string]>; px: { HEX: Record<number, number>; ETH: Record<number, number> }; nowHex: number; nowEth: number; capped: number;
}

const erpc = (method: string, params: any[]) => rpc(method, params, { endpoints: X.rpc, tries: 6, timeoutMs: 30000 });
async function emulticall(calls: Call[]): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const c of chunk(calls, 100)) out.push(...decodeTryAggregate(await erpc('eth_call', [{ to: X.multicall3, data: encodeTryAggregate(c) }, 'latest'])));
  return out;
}

/** Old transactions/receipts: some public nodes are pruned and answer null, so try each history-capable node. */
async function hist(method: string, h: string): Promise<any> {
  for (const ep of X.rpcHistory as string[]) {
    const r = await rpc(method, [h], { endpoints: [ep], tries: 2, timeoutMs: 15000 }).catch(() => null);
    if (r) return r;
  }
  return null;
}
/** Fallback: what our wallets paid in a transaction, from the Ethereum explorer. */
async function explorerPay(h: string, own: Set<string>) {
  const [tx, tt] = await Promise.all([getJSON(`${X.scanV2}/transactions/${h}`).catch(() => null), getJSON(`${X.scanV2}/transactions/${h}/token-transfers?type=ERC-20`).catch(() => null)]);
  if (!tx?.hash) return null;
  const from = lc(tx.from?.hash); const st: [string, string][] = [];
  for (const x of tt?.items ?? []) { const tk = lc(x.token?.address ?? x.token?.address_hash); if ((X.stables[tk] || tk === X.weth) && own.has(lc(x.from?.hash))) st.push([tk, String(x.total?.value ?? '0')]); }
  return { from, ethWei: own.has(from) ? String(tx.value ?? '0') : '0', stables: st };
}
/** HEX token transfers for one wallet (newest first from the explorer), cached and topped up incrementally. */
async function transfersOf(kv: KV, a: string): Promise<EthTransfer[]> {
  const key = 'eth:tt:' + a; const c = await kv.get<{ items: EthTransfer[]; max: number }>(key);
  const have = new Map((c?.items ?? []).map(t => [t.tx + ':' + t.li, t])); const max = c?.max ?? -1;
  let q = ''; let newMax = max;
  for (let page = 0; page < 400; page++) {
    // A failed or malformed page must never be cached as "complete": fall back to the log APIs for the full history.
    const d = await getJSON(`${X.scanV2}/addresses/${a}/token-transfers?type=ERC-20&token=${HEX}${q}`).catch(() => null);
    if (!Array.isArray(d?.items)) { const items = await transfersViaLogs(a); await kv.set(key, { items, max: Math.max(0, ...items.map(t => t.b)) }); return items; }
    const items: any[] = d.items; let stop = false;
    for (const x of items) {
      const b = Number(x.block_number); if (b <= max) { stop = true; continue; }
      newMax = Math.max(newMax, b);
      const t: EthTransfer = { b, li: Number(x.log_index), ts: Math.floor(Date.parse(x.timestamp) / 1000), tx: lc(x.transaction_hash), from: lc(x.from?.hash ?? ZERO), to: lc(x.to?.hash ?? ZERO), v: String(x.total?.value ?? '0') };
      have.set(t.tx + ':' + t.li, t);
    }
    if (stop || !d?.next_page_params) break;
    q = '&' + new URLSearchParams(Object.entries(d.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  const items = [...have.values()]; await kv.set(key, { items, max: newMax }); return items;
}

/** HEX contract events for one wallet via the explorer's logs API (topic1 = wallet), cached incrementally. */
async function logsOf(kv: KV, a: string, topic: string): Promise<EthLog[]> {
  const key = `eth:lg:${topic.slice(0, 10)}:${a}`; const c = await kv.get<{ items: EthLog[]; max: number }>(key);
  const have = new Map((c?.items ?? []).map(l => [l.tx + ':' + l.li, l])); let from = (c?.max ?? 0) + 1; let max = c?.max ?? 0;
  for (let g = 0; g < 200; g++) {
    const res = await scanLogs(`module=logs&action=getLogs&address=${HEX}&fromBlock=${from}&toBlock=latest&topic0=${topic}&topic1=${ownT(a)}&topic0_1_opr=and`);
    for (const l of res) { const b = parseInt(l.blockNumber, 16); max = Math.max(max, b); have.set(lc(l.transactionHash) + ':' + parseInt(l.logIndex, 16), { b, li: parseInt(l.logIndex, 16) || 0, ts: parseInt(l.timeStamp, 16), tx: lc(l.transactionHash), topics: (l.topics || []).filter((t: any) => t), data: l.data }); }
    if (res.length < 1000) break;
    from = max;   // inclusive re-read of the last block, deduped above
  }
  const items = [...have.values()]; await kv.set(key, { items, max }); return items;
}

/** USD prices at timestamps (DefiLlama batchHistorical, nearest within 12h), cached per coin+hour. */
export async function pricesAt(kv: KV, coin: string, tss: number[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {}; const hrs = [...new Set(tss.map(t => Math.floor(t / 3600) * 3600))];
  const cached = await kv.getMany<number>(hrs.map(h => `eth:px:${coin}:${h}`)); const need: number[] = [];
  hrs.forEach((h, i) => { if (cached[i] != null) out[h] = cached[i]!; else need.push(h); });
  const ent: [string, any][] = [];
  for (const part of chunk(need, 80)) {
    const j = await getJSON(`${X.prices}/batchHistorical?coins=${encodeURIComponent(JSON.stringify({ [coin]: part }))}&searchWidth=12h`).catch(() => null);
    const ps: any[] = j?.coins?.[coin]?.prices ?? [];
    for (const h of part) {
      let best: any = null; for (const p of ps) if (!best || Math.abs(p.timestamp - h) < Math.abs(best.timestamp - h)) best = p;
      if (best && Math.abs(best.timestamp - h) < 13 * 3600) { out[h] = best.price; ent.push([`eth:px:${coin}:${h}`, best.price]); }
    }
  }
  await kv.setMany(ent); return out;
}
export const hourOf = (ts: number) => Math.floor(ts / 3600) * 3600;

export async function collectEth(addrs: string[], kv: KV, P: (detail: string) => void): Promise<EthRaw> {
  ethReadState.fallbackUsed = false; ethReadState.incomplete = false;
  const own = new Set(addrs);
  P('Reading HEX on Ethereum…');
  // current state: balances, stakes, day
  const calls: Call[] = [{ target: HEX, data: '0x' + SEL.currentDay }, ...addrs.flatMap(a => [{ target: HEX, data: '0x' + SEL.balanceOf + pad32(a) }, { target: HEX, data: '0x' + SEL.stakeCount + pad32(a) }])];
  const r = await emulticall(calls);
  const currentDay = Number(words(r[0])[0] ?? 0n); const bal: EthRaw['bal'] = {}; const stakes: EthRaw['stakes'] = {};
  const scalls: Call[] = []; const sidx: string[] = [];
  addrs.forEach((a, i) => { bal[a] = String(words(r[1 + i * 2])[0] ?? 0n); const n = Number(words(r[2 + i * 2])[0] ?? 0n); stakes[a] = []; for (let k = 0; k < n; k++) { scalls.push({ target: HEX, data: '0x' + SEL.stakeLists + pad32(a) + u(k) }); sidx.push(a); } });
  const sl = scalls.length ? await emulticall(scalls) : [];
  sl.forEach((x, i) => { const w = words(x); if (w.length >= 6) stakes[sidx[i]].push({ stakeId: Number(w[0]), stakedHearts: w[1].toString(), stakeShares: w[2].toString(), lockedDay: Number(w[3]), stakedDays: Number(w[4]) }); });
  // history
  const T: Record<string, EthTransfer> = {}; const ss: EthLog[] = [], se: EthLog[] = [], le: EthLog[] = [], lx: EthLog[] = [];
  for (const a of addrs) {
    for (const t of await transfersOf(kv, a)) T[t.tx + ':' + t.li] = t;
    if (!Object.values(T).some(t => t.from === a || t.to === a) && !stakes[a].length) continue;   // never touched HEX on Ethereum
    P('Reading Ethereum HEX stakes and lobby entries…');
    const [s1, s2, s3, s4] = await Promise.all([logsOf(kv, a, X.topics.stakeStart), logsOf(kv, a, X.topics.stakeEnd), logsOf(kv, a, X.topics.lobbyEnter), logsOf(kv, a, X.topics.lobbyExit)]);
    ss.push(...s1); se.push(...s2); le.push(...s3); lx.push(...s4);
  }
  const transfers = Object.values(T);
  // what did we pay in the transactions where HEX arrived from someone else?
  const special = new Set([...se, ...lx, ...ss].map(l => l.tx));
  let cand = [...new Set(transfers.filter(t => own.has(t.to) && !own.has(t.from) && t.from !== ZERO && !special.has(t.tx)).map(t => t.tx))];
  const CAP = 600; const capped = Math.max(0, cand.length - CAP); cand = cand.slice(-CAP);
  const pay: EthRaw['pay'] = {}; const pc = await kv.getMany<any>(cand.map(h => 'eth:pay:' + h)); const ent: [string, any][] = [];
  if (cand.length) P(`Checking what was paid in ${cand.length} Ethereum HEX buys…`);
  await pool(cand.map((h, i) => [h, i] as const), 6, async ([h, i]) => {
    if (pc[i] !== undefined) { pay[h] = pc[i]; return; }
    const [tx, rc] = await Promise.all([hist('eth_getTransactionByHash', h), hist('eth_getTransactionReceipt', h)]);
    if (!tx || !rc) { const ex = await explorerPay(h, own); pay[h] = ex; if (ex) ent.push(['eth:pay:' + h, ex]); return; }
    const from = lc(tx.from); const st: [string, string][] = [];
    for (const l of rc.logs || []) {
      const tk = lc(l.address); if (!(X.stables[tk] || tk === X.weth) || l.topics?.[0] !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' || l.topics.length < 3) continue;
      if (own.has('0x' + l.topics[1].slice(26))) st.push([tk, BigInt(l.data.slice(0, 66)).toString()]);
    }
    pay[h] = { from, ethWei: own.has(from) ? BigInt(tx.value).toString() : '0', stables: st };
    ent.push(['eth:pay:' + h, pay[h]]);
  });
  await kv.setMany(ent);
  // daily payouts for accrued interest on active stakes
  P('Reading Ethereum HEX daily payouts…');
  const daily: EthRaw['daily'] = {}; const all = Object.values(stakes).flat();
  if (all.length) {
    const lo = Math.max(0, Math.min(...all.map(s => s.lockedDay), currentDay - 30)); const days = Array.from({ length: Math.max(0, currentDay - lo) }, (_, i) => lo + i);
    const dc = await kv.getMany<[string, string]>(days.map(d => 'ehexday:' + d)); const miss: number[] = [];
    days.forEach((d, i) => { if (dc[i]) daily[d] = dc[i]!; else miss.push(d); });
    const ranges: [number, number][] = []; for (const d of miss) { const l = ranges[ranges.length - 1]; if (l && l[1] === d) l[1] = d + 1; else ranges.push([d, d + 1]); }
    const de: [string, any][] = [];
    for (const [b0, e0] of ranges) for (let b = b0; b < e0; b += 400) {
      const e = Math.min(e0, b + 400); const w = words(await erpc('eth_call', [{ to: HEX, data: '0x' + SEL.dailyDataRange + u(b) + u(e) }, 'latest'])).slice(2);
      w.forEach((v, i) => { daily[b + i] = [(v & M72).toString(), ((v >> 72n) & M72).toString()]; if (b + i < currentDay - 1) de.push(['ehexday:' + (b + i), daily[b + i]]); });
    }
    await kv.setMany(de);
  }
  // prices
  P('Pricing Ethereum HEX buys…');
  const needHex = transfers.filter(t => own.has(t.to) && !own.has(t.from) && t.from !== ZERO).map(t => t.ts).concat(se.map(l => l.ts));
  const needEth = [...cand.map(h => transfers.find(t => t.tx === h)!.ts), ...le.map(l => l.ts)];
  const anything = transfers.length || all.length;
  const [pxHex, pxEth, now] = anything ? await Promise.all([pricesAt(kv, 'ethereum:' + HEX, needHex), pricesAt(kv, 'coingecko:ethereum', needEth), getJSON(`${X.prices}/prices/current/ethereum:${HEX},coingecko:ethereum`).catch(() => null)]) : [{}, {}, null];
  return { addrs, latestTs: Math.floor(Date.now() / 1000), currentDay, transfers, ss, se, le, lx, pay, bal, stakes, daily, px: { HEX: pxHex, ETH: pxEth },
    nowHex: now?.coins?.['ethereum:' + HEX]?.price ?? 0, nowEth: now?.coins?.['coingecko:ethereum']?.price ?? 0, capped };
}

/* ---------------------------------------------------------------- replay (average cost, one person) */
export function analyzeEth(R: EthRaw) {
  const own = new Set(R.addrs); const fork = X.forkBlock as number;
  const hx = (h: number) => R.px.HEX[hourOf(h)] ?? null, ex = (h: number) => R.px.ETH[hourOf(h)] ?? null;
  const special = new Map<string, string>(); for (const l of R.ss) special.set(l.tx, 'ss'); for (const l of R.lx) special.set(l.tx, 'lx'); for (const l of R.se) special.set(l.tx, 'se');
  type E = { b: number; li: number; ts: number; k: string; x: any };
  const evs: E[] = [];
  for (const t of R.transfers) evs.push({ b: t.b, li: t.li, ts: t.ts, k: 'tt', x: t });
  for (const l of R.ss) evs.push({ b: l.b, li: l.li, ts: l.ts, k: 'ss', x: l });
  for (const l of R.se) evs.push({ b: l.b, li: l.li, ts: l.ts, k: 'se', x: l });
  for (const l of R.le) evs.push({ b: l.b, li: l.li, ts: l.ts, k: 'le', x: l });
  for (const l of R.lx) evs.push({ b: l.b, li: l.li, ts: l.ts, k: 'lx', x: l });
  evs.sort((a, b) => a.b - b.b || a.li - b.li);
  let lq = 0, lc_ = 0; const st = new Map<string, [number, number]>();  // stakeId -> [hearts, cost]
  const lobby = new Map<string, number>();  // entryId -> USD
  const buys: { ts: number; q: number; usd: number; ppc: number; mkt: number | null; how: string; tx: string }[] = [];
  const income = { interest: 0, interestUsd: 0, penalty: 0, lobbyHex: 0, lobbyUsd: 0, claims: 0, outsideUsd: 0, outsideN: 0 };
  let forkSnap: { liquid: number; staked: number } | null = null; let short = 0; let unpricedEth = 0;
  const take = (q: number) => { if (q > lq + 1e-9) { short += q - lq; q = lq; } const c = lq > 0 ? lc_ * q / lq : 0; lq -= q; lc_ -= c; if (lq < 1e-9) { lq = 0; lc_ = 0; } return c; };
  const stakedQ = () => [...st.values()].reduce((s, v) => s + v[0], 0);
  for (const e of evs) {
    if (!forkSnap && e.b > fork) forkSnap = { liquid: lq, staked: stakedQ() };
    if (e.k === 'tt') {
      const t = e.x as EthTransfer; const q = Number(BigInt(t.v)) / 1e8; const fo = own.has(t.from), to = own.has(t.to);
      if (fo && to) continue;
      const sp = special.get(t.tx);
      if (to && t.from === ZERO) { if (sp === 'se' || sp === 'lx') continue; lq += q; income.claims += q; continue; }      // claims / other mints: free
      if (fo && t.to === ZERO) { if (sp === 'ss') continue; take(q); continue; }                                        // burn
      if (fo) { take(q); continue; }                                                                                   // sold / sent away
      // arrived from someone else: did our wallets pay for it in the same transaction?
      const p = R.pay[t.tx]; let usd = 0, how = '';
      if (p) {
        for (const [tk, v] of p.stables) { const s = X.stables[tk]; if (s) usd += toFloat(BigInt(v), s[1]); }
        const wethOut = p.stables.filter(([tk]) => tk === X.weth).reduce((s, [, v]) => s + toFloat(BigInt(v), 18), 0);
        const eth = toFloat(BigInt(p.ethWei), 18) + wethOut;
        if (eth > 0) { const pe = ex(t.ts); if (pe) usd += eth * pe; else unpricedEth++; }
        if (usd > 0) how = p.stables.some(([tk]) => X.stables[tk]) ? 'Bought with stablecoins' : 'Bought with ETH';
      }
      const mkt = hx(t.ts);
      if (!how) { const mv = mkt ? q * mkt : 0; if (mv >= 1) { usd = mv; how = 'Received from an outside wallet (valued at the market price)'; income.outsideUsd += mv; income.outsideN++; } }
      lq += q; lc_ += usd;
      if (usd > 0) buys.push({ ts: t.ts, q, usd, ppc: usd / q, mkt, how, tx: t.tx });
      continue;
    }
    const d0 = BigInt('0x' + (e.x.data as string).slice(2, 66)); const id = BigInt(e.x.topics[2] ?? '0x0').toString();
    if (e.k === 'ss') { const h = Number((d0 >> 40n) & M72) / 1e8; const c = take(h); st.set(id, [h, c]); continue; }
    if (e.k === 'se') {
      const d1 = BigInt('0x' + (e.x.data as string).slice(66, 130)); const h = Number((d0 >> 40n) & M72) / 1e8, pay = Number((d0 >> 184n) & M72) / 1e8, pen = Number(d1 & M72) / 1e8;
      const s = st.get(id); let c = 0;
      if (s) { c = s[1]; st.delete(id); } else { /* stake started before our history: nothing to move */ }
      const back = Math.max(0, h + pay - pen); lq += back; lc_ += c;
      income.interest += pay; income.penalty += pen; const px = hx(e.ts); if (px) income.interestUsd += pay * px;
      continue;
    }
    if (e.k === 'le') { const raw = (d0 >> 40n); const eth = toFloat(raw, 18); const pe = ex(e.ts); if (!pe) unpricedEth++; lobby.set(id, (lobby.get(id) ?? 0) + eth * (pe ?? 0)); continue; }
    if (e.k === 'lx') { const q = Number((d0 >> 40n) & M72) / 1e8; const usd = lobby.get(id) ?? 0; lobby.delete(id); lq += q; lc_ += usd; income.lobbyHex += q; income.lobbyUsd += usd; if (usd > 0) buys.push({ ts: e.ts, q, usd, ppc: usd / q, mkt: hx(e.ts), how: 'Adoption Amplifier lobby (paid ETH)', tx: e.x.tx }); continue; }
  }
  if (!forkSnap) forkSnap = { liquid: lq, staked: stakedQ() };
  // current stakes (contract state)
  const hi = R.currentDay; const rate = (d: number) => { const x = R.daily[d]; if (!x) return 0; const sh = Number(x[1]); return sh > 0 ? Number(x[0]) / sh : 0; };
  let r30 = 0, n30 = 0; for (let d = hi - 30; d < hi; d++) if (R.daily[d]) { r30 += rate(d); n30++; } r30 = n30 ? r30 / n30 : 0;
  const stakes = Object.entries(R.stakes).flatMap(([w, l]) => l.map(s => {
    const sh = Number(s.stakeShares); const end = s.lockedDay + s.stakedDays; let acc = 0; for (let d = s.lockedDay; d < Math.min(hi, end); d++) acc += sh * rate(d);
    return { id: s.stakeId, wallet: w, principal: Number(s.stakedHearts) / 1e8, tshares: sh / 1e12, accrued: acc / 1e8, future: r30 * sh * Math.max(0, end - Math.max(hi, s.lockedDay)) / 1e8, end_date: new Date((L0 + end * 86400) * 1000).toISOString().slice(0, 10), matured: hi >= end };
  }));
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const princ = sum(stakes.map(s => s.principal)), accr = sum(stakes.map(s => s.accrued)), sq = stakedQ(), sc = sum([...st.values()].map(v => v[1]));
  const chainLiquid = sum(R.addrs.map(a => Number(BigInt(R.bal[a] ?? '0')) / 1e8));
  const now = R.nowHex; const qty = lq + princ + accr; const cost = lc_ + sc;
  const okQ = (a: number, b: number) => Math.abs(a - b) * now < 2 || Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.001);
  const recon = [
    { coin: 'ETHHEX', label: 'HEX on Ethereum (liquid)', replay: lq, chain: chainLiquid, diff: lq - chainLiquid, usd: Math.abs(lq - chainLiquid) * now, ok: okQ(lq, chainLiquid) },
    { coin: 'ETHHEX', label: 'HEX on Ethereum (staked principal)', replay: sq, chain: princ, diff: sq - princ, usd: Math.abs(sq - princ) * now, ok: okQ(sq, princ) },
  ];
  const any = R.transfers.length > 0 || stakes.length > 0;
  return { status: 'ok' as const, any, qty, liquid: chainLiquid, staked: princ, accrued: accr, future: sum(stakes.map(s => s.future)), tshares: sum(stakes.map(s => s.tshares)), nStakes: stakes.length, stakes,
    cost, avg: qty > 0 ? cost / qty : 0, avgExInterest: lq + princ > 0 ? cost / (lq + princ) : 0, now, value: qty * now, pl: qty * now - cost, plpct: cost ? (qty * now - cost) / cost * 100 : null,
    rise: now && qty ? ((cost / qty) / now - 1) * 100 : null, nBuys: buys.length, buys: buys.slice(-400), income, forkSnap, recon, allOk: recon.every(r => r.ok), short, unpricedEth, capped: R.capped, ethPrice: R.nowEth };
}
export type EthReport = ReturnType<typeof analyzeEth> | { status: 'error' | 'skipped'; message: string };
