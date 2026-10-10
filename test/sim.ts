import { simulate, parseUsd } from '../src/engine/sim';
let bad = 0; const ok = (n: string, c: boolean, d = '') => { console.log(c ? 'PASS' : 'FAIL', n, d); if (!c) bad++; };
const near = (a: number, b: number, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
ok('parse', parseUsd('$1,234.50') === 1234.5 && parseUsd('') === 0 && parseUsd('abc') === 0 && parseUsd('0.5') === 0.5);
// 1,000 coins cost $100 (avg 0.10), price now 0.05; buy $100 -> 2,000 coins
let s = simulate({ qty: 1000, cost: 100, now: 0.05, spend: 100 });
ok('coins received', near(s.got, 2000)); ok('new avg', near(s.newAvg, 200 / 3000)); ok('lower %', near(s.lowerPct, (1 - (200 / 3000) / 0.1) * 100));
ok('break-even before 100%', near(s.riseBefore, 100)); ok('break-even after', near(s.riseAfter, ((200 / 3000) / 0.05 - 1) * 100));
ok('P/L unchanged w/o fee', near(s.plBefore, -50) && near(s.plAfter, -50));
s = simulate({ qty: 1000, cost: 100, now: 0.05, spend: 100, feePct: 0.3 });
ok('fee reduces coins', near(s.got, 99.7 / 0.05) && near(s.fee, 0.3)); ok('P/L drops by fee', near(s.plAfter, -50.3));
s = simulate({ qty: 1100, cost: 100, now: 0.05, spend: 100, freeQty: 100 });
ok('ex-interest avg', near(s.avgEx, 0.1) && near(s.newAvgEx, 200 / 3000));
s = simulate({ qty: 0, cost: 0, now: 2, spend: 10 }); ok('from zero', near(s.newAvg, 2) && s.lowerPct === 0 && near(s.riseAfter, 0));
s = simulate({ qty: 10, cost: 10, now: 2, spend: 10 }); ok('price above avg raises avg', s.lowerPct < 0 && s.riseAfter < 0);
console.log(bad ? `FAILED ${bad}` : 'ALL PASSED'); process.exit(bad ? 1 : 0);
