// Writes dist/_headers for Netlify: real HTTP CSP (same as each page's meta CSP + frame-ancestors) and security headers.
import fs from 'node:fs';
const csp = f => fs.readFileSync(f, 'utf8').match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1] + "; object-src 'none'; frame-ancestors 'none'";
const common = ["X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer", "X-Frame-Options: DENY",
  "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()"];
const block = (paths, file) => paths.map(p => `${p}\n  Content-Security-Policy: ${csp(file)}\n` + common.map(h => '  ' + h).join('\n')).join('\n\n');
const out = [block(['/', '/index.html'], 'dist/index.html'), block(['/stats', '/stats.html', '/stats/'], 'dist/stats.html'),
  '/assets/*\n' + common.map(h => '  ' + h).join('\n') + '\n  Cache-Control: public, max-age=31536000, immutable'].join('\n\n') + '\n';
fs.writeFileSync('dist/_headers', out); console.log('wrote dist/_headers');
