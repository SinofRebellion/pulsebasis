// Owner dashboard data: aggregates of the anonymous events. Needs ?key=<PB_STATS_KEY>.
import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { summarize } from '../../src/stats/summarize';

export default async (req: Request) => {
  const key = new URL(req.url).searchParams.get('key') || '';
  const want = (globalThis as any).Netlify?.env?.get?.('PB_STATS_KEY') ?? process.env.PB_STATS_KEY;
  if (!want || key !== want) return new Response(JSON.stringify({ error: 'locked' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const store = getStore('pb-events'); const now = Date.now(); const events: any[] = [];
  for (let d = 0; d < 8; d++) {
    const day = new Date(now - d * 86400e3).toISOString().slice(0, 10);
    const { blobs } = await store.list({ prefix: day + '/' });
    const got = await Promise.all(blobs.slice(-4000).map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
    for (const e of got) if (e) events.push(e);
  }
  return new Response(JSON.stringify(summarize(events, now)), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
export const config: Config = { path: '/api/stats' };
