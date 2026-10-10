import { chromium } from 'playwright'; import path from 'node:path';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto('file://' + path.resolve('tools/og.html')); await p.waitForTimeout(300);
await p.screenshot({ path: 'public/og-image.png' }); await b.close();
