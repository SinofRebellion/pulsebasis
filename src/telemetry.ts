// Anonymous usage counts for the owner's dashboard. Never sends addresses, balances or results:
// only "a visit happened" (+ referring site, phone or not) and, per scan, how long it took and whether
// the public servers were busy. Skipped for automated browsers and when the visitor has Do Not Track on.
const off = () => typeof navigator === 'undefined' || (navigator as any).webdriver || navigator.doNotTrack === '1' || /^(localhost|127\.)/.test(location.hostname);
const mobile = () => /iphone|ipad|android|mobile/i.test(navigator.userAgent);
function send(body: Record<string, unknown>) {
  if (off()) return;
  try { fetch('/api/ev', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, m: mobile() }), keepalive: true }).catch(() => {}); } catch { /* never break the app */ }
}
export function trackVisit() {
  let ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch { }
  if (ref === location.hostname) ref = '';
  if (ref === 't.co') ref = 'x.com';
  send({ k: 'visit', ref });
}
export function trackScan(h: any) { if (h) send({ k: 'scan', ...h }); }
