import { useEffect, useState } from 'react';
import type { summarize } from './summarize';
type S = ReturnType<typeof summarize>;
const LS = 'pb-owner-key';
const n = (x: number | null | undefined) => (x == null ? '–' : x.toLocaleString('en-US'));
const secs = (x: number | null | undefined) => (x == null ? '–' : x < 90 ? `${Math.round(x)} sec` : `${(x / 60).toFixed(1)} min`);
const ago = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function Big({ label, value, note, testid }: { label: string; value: string; note: string; testid?: string }) {
  return <div className="sd-num" data-testid={testid}><span className="sd-label">{label}</span><b>{value}</b><p>{note}</p></div>;
}

export function Dashboard() {
  const [key, setKey] = useState(() => new URLSearchParams(location.hash.slice(1)).get('k') || localStorage.getItem(LS) || '');
  const [draft, setDraft] = useState('');
  const [s, setS] = useState<S | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = async (k = key) => {
    if (!k) return; setBusy(true); setErr('');
    try {
      const r = await fetch('/api/stats?key=' + encodeURIComponent(k), { cache: 'no-store' });
      if (r.status === 401) { setErr('That key did not work.'); localStorage.removeItem(LS); setKey(''); return; }
      if (!r.ok) throw new Error(); setS(await r.json()); localStorage.setItem(LS, k);
      if (location.hash) history.replaceState(null, '', location.pathname);
    } catch { setErr("Couldn't load the numbers. Try again in a minute."); } finally { setBusy(false); }
  };
  useEffect(() => { load(); const i = setInterval(() => load(), 5 * 60e3); return () => clearInterval(i); }, [key]);

  if (!key) return <main className="sd"><h1>Owner dashboard</h1>
    <form className="card sd-key" onSubmit={e => { e.preventDefault(); setKey(draft.trim()); }}>
      <label htmlFor="k">Dashboard key</label><input id="k" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="off" />
      <button className="btn primary" type="submit">Open</button>{err && <p className="neg">{err}</p>}</form></main>;
  if (!s) return <main className="sd"><h1>Owner dashboard</h1><p className="muted">{err || 'Loading…'}</p></main>;

  const H = s.health; const maxDay = Math.max(1, ...s.perDay.map(d => Math.max(d.visits, d.scans)));
  return <main className="sd">
    <header className="sd-head"><h1>PulseBasis dashboard</h1><button className="sd-refresh" onClick={() => load()} disabled={busy}>{busy ? 'Updating…' : `Updated ${ago(s.asOf)} · Refresh`}</button></header>

    <section className={`card sd-health sd-${H.level}`} data-testid="health" data-level={H.level}>
      <span className="sd-light" aria-hidden="true" />
      <div><span className="sd-label">Server health</span><b>{H.title}</b><p>{H.why}</p>
        {H.level !== 'green' && <p className="sd-tip">{H.level === 'red' ? 'What to do: add a paid backup server or a shared cache so scans stop failing.' : 'What to do: nothing yet. If this stays yellow for a few days, plan a backup server.'}</p>}</div>
    </section>

    <div className="sd-grid">
      <Big testid="visits" label="Visitors today" value={n(s.visits.day)} note={`${n(s.visits.week)} in the last 7 days.`} />
      <Big testid="scans" label="Scans today" value={n(s.scans.day)} note={`${n(s.scans.week)} in the last 7 days.`} />
      <Big label="Scans that finished" value={n(s.scans.finishedDay)} note={`${n(s.scans.failedDay)} didn't finish today.`} />
      <Big label="Typical scan time" value={secs(s.typicalScanSec)} note={s.normalScanSec ? `Usually about ${secs(s.normalScanSec)}.` : 'For a first-time scan today.'} />
      <Big label="Repeat scans" value={`${s.repeatScanShare}%`} note="Re-runs that loaded from the visitor's saved data." />
      <Big label="Wallets per scan" value={s.walletsPerScan == null ? '–' : String(s.walletsPerScan)} note="How many addresses people paste on average." />
      <Big label="On a phone" value={`${s.phoneShare}%`} note="Share of visitors using a phone this week." />
      <Big label="Servers said “slow down”" value={n(s.rateLimitScans)} note="Scans today where a free server asked us to wait." />
    </div>

    <section className="card"><div className="card-title">Last 7 days</div><p className="muted small">Pink = visitors, purple = scans, red = scans that didn't finish. Number = scans that day.</p>
      <div className="sd-bars">{s.perDay.map(d => <div key={d.day} className="sd-day">
        <div className="sd-col"><i style={{ height: `${(d.visits / maxDay) * 100}%` }} className="v" /><i style={{ height: `${(d.scans / maxDay) * 100}%` }} className="s" /><i style={{ height: `${(d.failed / maxDay) * 100}%` }} className="f" /></div>
        <span>{new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' })}</span><em>{d.scans}</em></div>)}</div></section>

    <section className="card"><div className="card-title">The free servers we rely on</div><p className="muted small">How they behaved during today's scans.</p>
      <ul className="sd-list">{s.servers.length ? s.servers.map(x => <li key={x.host}><span className={`sd-dot dot-${x.status === 'bad' ? 'red' : x.status === 'busy' ? 'yellow' : 'green'}`} /><b>{x.name}</b><em>{x.label}</em></li>) : <li className="muted">No scans today yet.</li>}</ul></section>

    <section className="card"><div className="card-title">Where visitors come from</div><p className="muted small">Last 7 days.</p>
      <ul className="sd-list">{s.refs.length ? s.refs.map(([r, c]) => <li key={r}><b>{r}</b><em>{c}</em></li>) : <li className="muted">No visits yet.</li>}</ul></section>

    <p className="muted small sd-foot">Counts are anonymous: no addresses, balances or results are ever collected. “Today” means the last 24 hours.</p>
  </main>;
}
