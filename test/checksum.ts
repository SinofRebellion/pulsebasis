import { toChecksum, checksumState } from '../src/checksum';
let bad = 0; const ok = (n: string, c: boolean) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) bad++; };
// EIP-55 spec vectors
for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb', '0xd8559fea66826f34D594dF1e5dF6aB5E61835436']) ok('vector ' + a, toChecksum(a.toLowerCase()) === a && checksumState(a) === 'ok');
ok('all lower ok', checksumState('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed') === 'ok');
ok('all upper ok', checksumState('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED') === 'ok');
ok('bad mixed warns', checksumState('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD') === 'bad');
console.log(bad ? 'FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
