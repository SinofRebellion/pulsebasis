// Live end-to-end engine run in Node (same code the Web Worker runs). Usage: tsx test/live.ts <addr,...> [cacheFile]
import fs from 'node:fs';
import { MemoryKV } from '../src/engine/cache';
import { runAll } from '../src/engine/run';
import { logTuning } from '../src/engine/net';
if (process.env.FORCE_CAP) logTuning.forceCap = +process.env.FORCE_CAP;
if (process.env.NO_EXPLORER) logTuning.disableExplorer = true;

const addrs = (process.argv[2] || '').split(',').filter(Boolean);
const cf = process.argv[3] || '/tmp/pb-cache.json';
class FileKV extends MemoryKV { constructor() { super(); if (fs.existsSync(cf)) this.m = new Map(Object.entries(JSON.parse(fs.readFileSync(cf, 'utf8')))); } save() { fs.writeFileSync(cf, JSON.stringify(Object.fromEntries(this.m))); } }
const kv = new FileKV();
const t0 = Date.now(); let last = '';
const r = await runAll(addrs, kv, p => { const s = `${p.phase}: ${p.detail}`; if (s !== last) { last = s; console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', Math.round(p.pct) + '%', s); } });
kv.save();
const R = r.report;
console.log('TIME', r.ms, 'ms', 'requests', r.requests, r.timings);
console.log('TOTAL cost', R.tot.cost.toFixed(2), 'value', R.tot.value.toFixed(2), 'pl', R.tot.pl.toFixed(2));
for (const c of ['HEX', 'PLS', 'PLSX', 'INC', 'PRVX']) console.log(c, 'qty', R.percoin[c].qty.toFixed(3), 'cost', R.percoin[c].cost.toFixed(2), 'avg', R.percoin[c].avg.toPrecision(5), 'now', R.now[c].toPrecision(4));
console.log('HEX', { liquid: R.hex.liquid, staked: R.hex.staked, principal: R.hex.principal, accrued: R.hex.accrued, n: R.hex.n, tsh: R.hex.tshares, avg_ex: R.hex.avg_ex_accr, maturity: R.hex.maturity });
console.log('recon', R.accuracy.recon.map(x => `${x.label} ${x.ok ? 'OK' : 'XX'} rep=${x.replay.toFixed(3)} chain=${x.chain.toFixed(3)}`));
console.log('accuracy', R.accuracy.pctExact.toFixed(2), R.accuracy.sources, 'gaps', R.accuracy.gaps);
console.log('ramps', R.moneyIn.ramps.map((x: any) => `${x.name}: $${x.usd.toFixed(2)} (${x.share.toFixed(1)}%) n=${x.n} fee=$${x.fee.toFixed(2)}`));
console.log('fees', JSON.stringify(R.fees.gopulse), 'gas', R.fees.gasUsd.toFixed(2), 'poison', R.poison.length, 'stakeHist', R.stakeHist.ended, R.stakeHist.early, R.stakeHist.penalty_usd.toFixed(0), R.stakeHist.payout_usd.toFixed(0));
console.log('venues', JSON.stringify(R.venues));
fs.writeFileSync(process.argv[4] || '/tmp/pb-report.json', JSON.stringify(R));
