// Telemetry + owner dashboard test (production). Usage: node test/dash.mjs <baseUrl> <outDir>
import { chromium, devices } from 'playwright'; import fs from 'node:fs';
const BASE = (process.argv[2] || 'https://pulsebasis.netlify.app/').replace(/\/$/, ''); const OUT = process.argv[3] || 'test/out'; fs.mkdirSync(OUT, { recursive: true });
const KEY = fs.readFileSync('/home/box/.pulsebasis-stats-key', 'utf8').trim();
let bad = 0; const ok = (n, c, d = '') => { console.log(c ? 'PASS' : 'FAIL', n, d); if (!c) bad++; };
const b = await chromium.launch(); const errs = [];
// 1. app sends anonymous events (intercepted, never stored), with no addresses inside
{
  const ctx = await b.newContext({ ...devices['iPhone 15 Pro'] }); await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const p = await ctx.newPage(); const sent = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('**/api/ev', r => { sent.push(r.request().postData()); r.fulfill({ status: 204 }); });
  await p.goto(BASE + '/'); await p.getByLabel('Wallet 1 address').fill('0x7c3e91a4d2b05f8e6a19c0d7e2f4b8a1c5d39e60');
  await p.getByTestId('run').click(); await p.waitForFunction(() => window.__PB || document.querySelector('.error-card'), null, { timeout: 300e3 });
  await p.waitForTimeout(1000);
  const evs = sent.map(s => JSON.parse(s));
  ok('visit event sent', evs.some(e => e.k === 'visit'), JSON.stringify(evs[0]));
  const sc = evs.find(e => e.k === 'scan');
  ok('scan event sent with health info', sc && typeof sc.ms === 'number' && sc.ok === true && sc.hosts && 'retries' in sc, JSON.stringify(sc).slice(0, 300));
  ok('no address in any event', !sent.join('').toLowerCase().includes('7c3e91a4'));
  await ctx.close();
}
// 2. dashboard: real data, then mocked yellow/red days, iPhone
const mock = (level) => ({ asOf: Date.now(), selftests: 0, health: level === 'red' ? { level, title: 'Time to add backup servers', why: '45% of scans in the last 24 hours had to retry or failed. The free public servers can\'t keep up.', n: 40 } : { level, title: 'Getting busy', why: 'Scans are slower than usual: a typical scan took 210 seconds, normally about 115.', n: 40 },
  visits: { day: 312, week: 1840 }, scans: { day: 140, week: 760, finishedDay: 131, failedDay: 9, finishedWeek: 731, failedWeek: 29 }, typicalScanSec: 210, normalScanSec: 115, repeatScanShare: 38, walletsPerScan: 1.8, phoneShare: 71, rangeLimitScans: 12, rateLimitScans: 30,
  refs: [['x.com', 1210], ['Direct / unknown', 402], ['t.me', 120], ['youtube.com', 60]], perDay: Array.from({ length: 7 }, (_, i) => ({ day: new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10), visits: 150 + i * 40, scans: 70 + i * 15, failed: i })),
  servers: [{ host: 'rpc.pulsechain.com', name: 'PulseChain main server', status: 'busy', label: 'Slow at times' }, { host: 'api.scan.pulsechain.com', name: 'PulseChain explorer', status: level === 'red' ? 'bad' : 'ok', label: level === 'red' ? 'Failing often' : 'Working fine' }, { host: 'graph.pulsechain.com', name: 'PulseX price history', status: 'ok', label: 'Working fine' }] });
for (const mode of ['real', 'yellow', 'red']) {
  const ctx = await b.newContext({ ...devices['iPhone 15 Pro'] }); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(mode + ' ' + m.text()); });
  if (mode !== 'real') await p.route('**/api/stats**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock(mode)) }));
  await p.goto(`${BASE}/stats#k=${KEY}`); await p.getByTestId('health').waitFor({ timeout: 30000 });
  const lvl = await p.getByTestId('health').getAttribute('data-level');
  ok(`dashboard ${mode} shows health first`, mode === 'real' ? ['green', 'yellow', 'red'].includes(lvl) : lvl === mode, lvl);
  const txt = await p.locator('main').innerText();
  ok(`dashboard ${mode} has no jargon`, !/\b(RPC|p95|p50|latency|endpoint|429|eth_)/i.test(txt));
  ok(`dashboard ${mode} key removed from URL`, !p.url().includes(KEY));
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(`dashboard ${mode} fits iPhone`, sw[0] <= sw[1], JSON.stringify(sw));
  await p.screenshot({ path: `${OUT}/dashboard-${mode}-iphone.png`, fullPage: true }); await ctx.close();
}
{ const ctx = await b.newContext(); const p = await ctx.newPage(); await p.goto(`${BASE}/stats`); ok('dashboard locked without key', await p.getByLabel('Dashboard key').isVisible()); await ctx.close(); }
ok('zero console errors', errs.length === 0, errs.join(' | '));
await b.close(); console.log(bad ? `FAILED ${bad}` : 'ALL PASSED'); process.exit(bad ? 1 : 0);
