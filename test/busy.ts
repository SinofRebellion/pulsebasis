// Simulated busy servers: retries with backoff, rotation across every endpoint, and a friendly final error.
import { rpc, rpcBatch, getJSON, netTest, BusyError, BUSY_TEXT, isBusy, resetHealth } from '../src/engine/net';
import REG from '../src/engine/registry.json';
let bad = 0; const ok = (n: string, c: boolean, d = '') => { console.log(c ? 'PASS' : 'FAIL', n, d); if (!c) bad++; };
netTest.scale = 0.01;
const host = (u: string) => new URL(u).hostname;
const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const busyKinds = [() => json({ error: 'busy' }, 503), () => json({ error: 'rate' }, 429), () => json({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'RPC error: server too busy' } }), () => json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'too many requests, try again later' } })];

// 1. busy a few times, then answers: succeeds and visits more than one endpoint
{ resetHealth(); let n = 0; const seen = new Set<string>();
  netTest.fake = (u, init) => { seen.add(host(u)); if (n++ < 4) return busyKinds[n % busyKinds.length](); const b = JSON.parse(String(init?.body)); return json({ jsonrpc: '2.0', id: b.id, result: '0x10' }); };
  const r = await rpc('eth_getTransactionByHash', ['0x00']).catch(e => e);
  ok('recovers after busy answers', r === '0x10', String(r)); ok('rotates endpoints', seen.size >= 2, [...seen].join(','));
  ok('historical call stays on archive nodes', [...seen].every(h => REG.rpc.archive.map(host).includes(h))); }
// 2. latest-state call may use the extra public nodes
{ resetHealth(); let n = 0; const seen = new Set<string>();
  netTest.fake = (u, init) => { seen.add(host(u)); if (n++ < 6) return busyKinds[2](); const b = JSON.parse(String(init?.body)); return json({ jsonrpc: '2.0', id: b.id, result: '0x1' }); };
  const r = await rpc('eth_blockNumber', []).catch(e => e);
  ok('latest-state call recovers', r === '0x1'); ok('latest-state call reaches extra nodes', [...seen].some(h => ((REG.rpc as any).latestOnly as string[]).map(host).includes(h)), [...seen].join(',')); }
// 3. never recovers: friendly BusyError, no raw RPC text
{ resetHealth(); netTest.fake = () => busyKinds[2]();
  const t0 = Date.now(); const e: any = await rpc('eth_getTransactionByHash', ['0x00']).catch(x => x);
  ok('gives up with BusyError', e instanceof BusyError && e.message === BUSY_TEXT, String(e?.message)); ok('no raw text', !/RPC error|-32005|too busy/i.test(String(e?.message))); ok('gave up in reasonable time', Date.now() - t0 < 20000, (Date.now() - t0) + 'ms'); }
// 4. batch: busy then fine, and always busy -> BusyError
{ resetHealth(); let n = 0; netTest.fake = (u, init) => { if (n++ < 3) return busyKinds[0](); const b = JSON.parse(String(init?.body)); return json(b.map((x: any) => ({ jsonrpc: '2.0', id: x.id, result: 'ok' + x.id }))); };
  const r = await rpcBatch([['eth_getBlockByNumber', ['0x1', false]], ['eth_getBlockByNumber', ['0x2', false]]]).catch(e => e);
  ok('batch recovers', Array.isArray(r) && r[1] === 'ok1', JSON.stringify(r).slice(0, 80));
  resetHealth(); netTest.fake = () => busyKinds[1]();
  const e: any = await rpcBatch([['eth_getBlockByNumber', ['0x1', false]]]).catch(x => x); ok('batch gives up with BusyError', e instanceof BusyError); }
// 5. explorer / price API 429 then OK
{ resetHealth(); let n = 0; netTest.fake = () => n++ < 2 ? busyKinds[1]() : json({ ok: 1 });
  const r = await getJSON('https://coins.llama.fi/x').catch(e => e); ok('getJSON recovers from 429', r?.ok === 1);
  resetHealth(); netTest.fake = () => busyKinds[1](); const e: any = await getJSON('https://coins.llama.fi/x').catch(x => x); ok('getJSON gives up with BusyError', e instanceof BusyError); }
ok('isBusy classifies', isBusy({ message: 'HTTP 503' }) && isBusy({ code: -32005 }) && isBusy({ message: 'server too busy' }) && !isBusy({ message: 'execution reverted' }));
netTest.fake = null;
console.log(bad ? `${bad} FAILED` : 'ALL PASSED'); process.exit(bad ? 1 : 0);
