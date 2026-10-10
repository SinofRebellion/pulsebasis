// The GitHub copy of this repo stores binary files (logos, share image, OpenTimestamps proof) as base64 text
// under binary/. This restores them byte-for-byte (checked by SHA-256). Runs automatically before dev/build.
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path';
const man = JSON.parse(fs.readFileSync('binary/manifest.json', 'utf8'));
for (const [file, m] of Object.entries(man)) {
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  if (fs.existsSync(file) && sha(fs.readFileSync(file)) === m.sha256) continue;
  const buf = Buffer.from(fs.readFileSync(m.b64, 'utf8'), 'base64');
  if (sha(buf) !== m.sha256) throw new Error(`checksum mismatch for ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); console.log('restored', file);
}
