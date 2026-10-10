// Validates the adaptive getLogs splitter against a single wide call. npx tsx test/logs.ts
import { getLogsAll, logTuning } from '../src/engine/net';
import REG from '../src/engine/registry.json';
const f = { address: REG.contracts.HEX, topics: ['0x14872dc760f33532684e68e1b6d5fd3f71ba7b07dee76bdb2b084f28b74233ef', '0x0000000000000000000000003e3ecc7b9a463dcaa9d7539e29a076da2293c974'] };
const A = 9041184, B = A + 400_000;
const ref = await getLogsAll(f, A, B); console.log('wide/explorer', ref.length);
const key = (l: any) => l.transactionHash + l.logIndex;
// 1) every RPC forced to a 1000-block cap, explorer off, wide off -> pure adaptive splitting
Object.assign(logTuning, { forceCap: 1000, disableExplorer: true });
let t = Date.now(); const a1 = await getLogsAll(f, A, B, (d, n) => { if (d % 50000 < 1000) process.stdout.write(`\r${d}/${n}`); });
console.log('\nforced-1000 adaptive', a1.length, (Date.now() - t) / 1000 + 's', 'same set:', a1.length === ref.length && a1.every(l => new Set(ref.map(key)).has(key(l))));
// 2) real capped endpoint only (g4mm4 caps at 1000 today), no simulation
Object.assign(logTuning, { forceCap: 0 }); (REG.rpc as any).logs = ['https://rpc-pulsechain.g4mm4.io']; (REG.rpc as any).logsChunked = ['https://rpc-pulsechain.g4mm4.io']; (REG.rpc as any).archive = ['https://rpc-pulsechain.g4mm4.io'];
t = Date.now(); const a2 = await getLogsAll(f, A, B);
console.log('real g4mm4-only adaptive', a2.length, (Date.now() - t) / 1000 + 's', 'same set:', a2.length === ref.length && a2.every(l => new Set(ref.map(key)).has(key(l))));
