// Browser test: every PulseChain server answers "busy" -> friendly card with Resume, never raw server text.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:4173/';
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
await p.route(/rpc|scan\.pulsechain|graph\.pulsechain|publicnode|routescan|blockscout|llama/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'RPC error: server too busy' } }) }));
await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE);
await p.getByLabel('Wallet 1 address').fill('0x000000000000000000000000000000000000dEaD');
await p.getByTestId('run').click();
await p.waitForSelector('[data-testid=error]', { timeout: 15 * 60e3 });
const txt = await p.locator('[data-testid=error]').innerText();
const page = await p.locator('body').innerText();
let bad = 0; const ok = (n, c, d = '') => { console.log(c ? 'PASS' : 'FAIL', n, d); if (!c) bad++; };
ok('friendly busy title', /servers are busy/i.test(txt), txt.slice(0, 160));
ok('progress is saved + resume', /progress is saved/i.test(txt) && await p.getByTestId('resume').count() === 1);
ok('no raw RPC text anywhere', !/RPC error|-32005|too busy|HTTP \d{3}/i.test(page));
await b.close(); console.log(bad ? 'FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
