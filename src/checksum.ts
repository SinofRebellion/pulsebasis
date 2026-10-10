import { keccak_256 } from '@noble/hashes/sha3.js';
/** EIP-55 checksum form of a 0x address. */
export function toChecksum(a: string): string {
  const lo = a.trim().slice(2).toLowerCase(); const h = keccak_256(new TextEncoder().encode(lo));
  return '0x' + [...lo].map((ch, i) => ((h[i >> 1] >> (i % 2 ? 0 : 4)) & 15) >= 8 ? ch.toUpperCase() : ch).join('');
}
/** 'ok' for all-lower / all-upper / correct mixed case; 'bad' for mixed case that fails EIP-55. */
export function checksumState(a: string): 'ok' | 'bad' {
  const b = a.trim().slice(2); if (b === b.toLowerCase() || b === b.toUpperCase()) return 'ok';
  return toChecksum(a) === '0x' + b ? 'ok' : 'bad';
}
