// Anonymous usage event sink. Stores no addresses, no IPs, no balances: only coarse, whitelisted fields.
import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { isLocalRef } from '../../src/stats/summarize';

const HOSTS = new Set(['rpc.pulsechain.com', 'rpc-pulsechain.g4mm4.io', 'pulsechain-rpc.publicnode.com', 'api.scan.pulsechain.com', 'graph.pulsechain.com', 'eth.blockscout.com', 'ethereum-rpc.publicnode.com', 'eth.drpc.org', 'eth-mainnet.public.blastapi.io', 'coins.llama.fi', 'api.routescan.io', 'rpc.pulsechainrpc.com', 'rpc.pulsechainstats.com']);
const int = (v: unknown, max: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
const REF = /^[a-z0-9.-]{1,60}$/;

export function clean(b: any) {
  if (b?.k === 'selftest') return { t: Date.now(), k: 'selftest' };  // deploy check, excluded from all numbers
  const e: any = { t: Date.now(), k: b?.k === 'scan' ? 'scan' : 'visit', m: !!b?.m };
  if (e.k === 'visit') { const r = String(b?.ref || '').toLowerCase(); e.ref = REF.test(r) && !isLocalRef(r) ? r : ''; return e; }
  e.ok = !!b?.ok; e.cached = !!b?.cached; e.ms = int(b?.ms, 3_600_000); e.att = int(b?.attempts, 10); e.w = int(b?.wallets, 50);
  e.req = int(b?.requests, 1e6); e.rt = int(b?.retries, 1e6); e.rl = int(b?.rateHits, 1e6); e.rg = int(b?.rangeHits, 1e6);
  e.h = {};
  for (const [h, v] of Object.entries<any>(b?.hosts || {})) if (HOSTS.has(h)) e.h[h] = [int(v?.n, 1e6), int(v?.fail, 1e6), int(v?.slow, 1e6)];
  return e;
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const txt = await req.text(); if (txt.length > 4000) return new Response('too big', { status: 413 });
  let b: any; try { b = JSON.parse(txt); } catch { return new Response('bad json', { status: 400 }); }
  const e = clean(b); const day = new Date(e.t).toISOString().slice(0, 10);
  await getStore('pb-events').setJSON(`${day}/${e.t}-${Math.random().toString(36).slice(2, 8)}`, e);
  return new Response(null, { status: 204 });
};
export const config: Config = { path: '/api/ev' };
