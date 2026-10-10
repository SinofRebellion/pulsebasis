import { orderEps } from '../src/engine/net';
import REG from '../src/engine/registry.json';
const o = orderEps(REG.rpc.archive); console.log(o); const ok = o[o.length - 1].includes('g4mm4') && o[0] === 'https://rpc.pulsechain.com';
console.log(ok ? 'ALL PASSED' : 'FAILED'); process.exit(ok ? 0 : 1);
