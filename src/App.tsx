import { CoinIcon } from './ui/coin';
import { trackVisit, trackScan } from './telemetry';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Report } from './engine/analyze';
import { Position, CostSection, StakesSection, MoneySection, AccuracySection, SecuritySection } from './ui/sections';
import { QUOTES, TIPS } from './quotes';
import { short } from './format';
import { TipJar } from './ui/tip';
import { OtherChains } from './ui/otherchains';
import { checksumState } from './checksum';

type Wallet = { address: string; label: string };
type Prog = { phase: string; detail: string; pct: number };
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
const LS = 'pulsebasis:wallets';

export default function App() {
  const [wallets, setWallets] = useState<Wallet[]>(() => { try { const w = JSON.parse(localStorage.getItem(LS) || '[]'); return w.length ? w : [{ address: '', label: '' }]; } catch { return [{ address: '', label: '' }]; } });
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [prog, setProg] = useState<Prog>({ phase: '', detail: '', pct: 0 });
  const [steps, setSteps] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [runInfo, setRunInfo] = useState<{ ms: number; requests: number } | null>(null);
  const [err, setErr] = useState('');
  const [t0, setT0] = useState(0); const [, tick] = useState(0);
  const worker = useRef<Worker | null>(null);
  useEffect(() => { if (status !== 'running') return; const i = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(i); }, [status]);
  useEffect(() => { const w = wallets.filter(w => w.address || w.label); if (w.length) localStorage.setItem(LS, JSON.stringify(w)); else localStorage.removeItem(LS); }, [wallets]);

  const valid = wallets.filter(w => isAddr(w.address));
  const labels = useMemo(() => Object.fromEntries(valid.map((w, i) => [w.address.toLowerCase(), w.label || `Wallet ${i + 1}`])), [wallets]);
  const run = () => {
    if (!valid.length) return;
    worker.current?.terminate();
    const wk = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }); worker.current = wk;
    setStatus('running'); setErr(''); setReport(null); setSteps([]); setT0(Date.now()); setProg({ phase: 'Starting', detail: '', pct: 0 });
    wk.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { setProg(m); setSteps(s => s[s.length - 1] === m.phase ? s : [...s, m.phase]); }
      if (m.type === 'done') { trackScan(m.health); setReport(m.report); (window as any).__PB = { report: m.report, ms: m.ms, requests: m.requests, timings: m.timings }; setRunInfo({ ms: m.ms, requests: m.requests }); setStatus('done'); wk.terminate(); setTimeout(() => document.getElementById('position')?.scrollIntoView({ behavior: 'smooth' }), 80); }
      if (m.type === 'error') { trackScan(m.health); setErr(m.message); setStatus('error'); wk.terminate(); }
    };
    wk.onerror = e => { setErr(e.message || 'Worker failed'); setStatus('error'); };
    wk.postMessage({ type: 'run', addrs: valid.map(w => w.address.trim().toLowerCase()) });
  };
  const [cleared, setCleared] = useState('');
  const clearCache = () => {
    if (status === 'running') return;
    const wk = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const done = () => { wk.terminate(); try { localStorage.removeItem(LS); sessionStorage.clear(); } catch {}
      setWallets([{ address: '', label: '' }]); setReport(null); setRunInfo(null); setStatus('idle'); (window as any).__PB = undefined;
      setCleared('Done. Your saved addresses and results were deleted from this device.'); };
    wk.onmessage = done; wk.onerror = done; wk.postMessage({ type: 'clear' });
  };
  const setW = (i: number, p: Partial<Wallet>) => setWallets(ws => ws.map((w, k) => k === i ? { ...w, ...p } : w));
  const onPaste = (i: number, text: string) => {
    const found = text.match(/0x[0-9a-fA-F]{40}/g);
    if (found && found.length > 1) { setWallets(ws => { const rest = ws.filter((w, k) => k !== i && w.address); const have = new Set(rest.map(w => w.address.toLowerCase())); return [...rest, ...found.filter(a => !have.has(a.toLowerCase())).map(a => ({ address: a, label: '' }))]; }); return true; }
    return false;
  };
  const elapsed = status === 'running' ? Math.round((Date.now() - t0) / 1000) : 0;

  return (
    <div className="app">
      <div className="bg-orbs" aria-hidden><i className="o1" /><i className="o2" /><i className="o3" /></div>
      <header className="topbar">
        <a className="brand" href="#top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><Mark /><span>Pulse<b>Basis</b></span></a>
        <span className="top-note">Unofficial · runs in your browser</span>
      </header>
      {report && report.accuracy.txs > 0 && <nav className="secnav" aria-label="Sections">
        {[['position', 'Position'], ['cost', 'Cost'], ['stakes', 'Stakes'], ['money', 'Money in'], ['accuracy', 'Accuracy']].map(([id, l], i) =>
          <a key={id} href={'#' + id} onClick={e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }}><em>{i + 1}</em>{l}</a>)}
      </nav>}

      <section className={'hero' + (report ? ' hero-compact' : '')} id="top">
        <div className="hero-eyebrow"><span className="hero-coins">{['HEX', 'PLS', 'PLSX', 'INC', 'PRVX'].map(c => <CoinIcon key={c} coin={c} size={20} />)}</span> HEX · PLS · PLSX · INC · PRVX on PulseChain</div>
        <h1>What did your <span className="grad-hex">HEX</span> really cost?</h1>
        <p className="lede">Paste your wallets. PulseBasis replays every buy, swap, bridge and stake straight from the chain, prices each one at the exact block it happened, and shows your true average cost, break-even, stake interest and fees.</p>
        <QuoteTicker />
        <div className="card form-card">
          <div className="form-head"><b>Your wallets</b><span>Treated as one person. Moves between them aren't buys or sells.</span></div>
          {wallets.map((w, i) => {
            const bad = w.address.trim() && !isAddr(w.address);
            const ckBad = !bad && isAddr(w.address) && checksumState(w.address) === 'bad';
            return <div className={'wrow' + (ckBad ? ' has-warn' : '')} key={i}>
              <input className={'addr' + (bad ? ' bad' : '')} placeholder="0x… address" value={w.address} spellCheck={false} autoCapitalize="off" autoCorrect="off" inputMode="text"
                onChange={e => setW(i, { address: e.target.value.trim() })} onPaste={e => { if (onPaste(i, e.clipboardData.getData('text'))) e.preventDefault(); }} aria-label={`Wallet ${i + 1} address`} />
              <input className="label" placeholder={`Label (optional)`} value={w.label} onChange={e => setW(i, { label: e.target.value })} aria-label={`Wallet ${i + 1} label`} />
              <button className="icon-btn" onClick={() => setWallets(ws => ws.length > 1 ? ws.filter((_, k) => k !== i) : [{ address: '', label: '' }])} aria-label="Remove wallet">✕</button>
              {ckBad && <p className="addr-warn" role="alert" data-testid="checksum-warn">The capital letters in this address don't match its checksum, so a character may have been mistyped. Double-check it against your wallet app. You can still analyze it.</p>}
            </div>;
          })}
          <div className="form-actions">
            <button className="btn ghost" onClick={() => setWallets(ws => [...ws, { address: '', label: '' }])}>+ Add wallet</button>
            <button className="btn primary" disabled={!valid.length || status === 'running'} onClick={() => { setCleared(''); run(); }} data-testid="run">{status === 'running' ? 'Working…' : report ? 'Run again' : `Analyze ${valid.length || ''} wallet${valid.length === 1 ? '' : 's'}`}</button>
          </div>
          <p className="privacy"><Lock /> No wallet connection. Your addresses go only to the public blockchain servers that are read (PulseChain and Ethereum servers, their explorers and price lookups). They are never sent to or stored on our server; we only count anonymous visits and how long scans take.</p>
          <p className="privacy" data-testid="local-cache-note">To make rescans fast, your addresses and results are saved only on this device, in your browser's storage (localStorage and IndexedDB). <button type="button" className="linkbtn" data-testid="clear-data" onClick={clearCache} disabled={status === 'running'}>Clear my saved data</button></p>
          {cleared && <p className="privacy cleared" role="status" data-testid="cleared">{cleared}</p>}
        </div>
        <TipJar />
        {status === 'running' && <div className="card progress-card" data-testid="progress">
          <div className="prog-top"><b>{prog.phase}</b><span>{elapsed}s</span></div>
          <div className="bar"><i style={{ width: Math.max(3, prog.pct) + '%' }} /></div>
          <div className="prog-detail">{prog.detail}</div>
          <ol className="steps">{steps.map((s, i) => <li key={i} className={i === steps.length - 1 ? 'on' : 'done'}>{s}</li>)}</ol>
          <p className="muted small">First run downloads your full history and prices every block you traded in (about 1–3 minutes for hundreds of trades). Re-runs use your browser's cache and take seconds.</p>
        </div>}
        {status === 'error' && <div className="card error-card" data-testid="error"><b>We couldn't finish reading the chain this time.</b><p>The free public PulseChain servers are busy or limiting requests right now. Everything downloaded so far is saved in your browser, so the next try picks up where this one stopped.</p>
          <div className="form-actions"><button className="btn primary" onClick={run}>Try again</button></div>
          <details className="muted small"><summary>Technical details</summary>{err}</details></div>}
      </section>

      {report && report.accuracy.txs === 0 && <main className="report" data-testid="report-empty"><section className="sec" id="position"><div className="card story">
        <div className="card-title">No PulseChain activity found</div>
        <p>These wallets have no transactions on PulseChain since the May 2023 launch, and no HEX, PLS, PLSX, INC or PRVX right now. Double-check that you pasted the address you actually use on PulseChain (the same 0x address works on Ethereum, Base and others; we read PulseChain, plus HEX on Ethereum).</p>
      </div>{report.eth?.status === 'ok' && report.eth.any && <OtherChains r={report} />}</section></main>}
      {report && report.accuracy.txs > 0 && <main className="report" data-testid="report">
        <Position r={report} labels={labels} />
        <CostSection r={report} />
        <StakesSection r={report} labels={labels} />
        <MoneySection r={report} />
        {report.poison.length > 0 && <SecuritySection r={report} />}
        <AccuracySection r={report} runInfo={runInfo} wallets={valid.map(w => ({ address: w.address.toLowerCase(), label: labels[w.address.toLowerCase()] }))} onClear={clearCache} />
      </main>}

      <Footer />
    </div>
  );
}

function QuoteTicker() {
  const [i, setI] = useState(() => Math.floor(Date.now() / 86400e3) % QUOTES.length);
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % QUOTES.length), 9000); return () => clearInterval(t); }, []);
  const q = QUOTES[i]; const tip = TIPS[Math.floor(Date.now() / 86400e3) % TIPS.length];
  return <div className="quotes">
    <figure key={i} className="quote"><blockquote>“{q.text}”</blockquote><figcaption>— {q.who}, <a href={q.url} target="_blank" rel="noreferrer noopener">{q.src}</a></figcaption></figure>
    <div className="tip"><span>Tip of the day</span>{tip}</div>
  </div>;
}

function Footer() {
  return <footer className="footer">
    <div className="foot-grid">
      <div><div className="brand small"><Mark /><span>Pulse<b>Basis</b></span></div>
        <p>Free, client-side cost-basis analysis for Richard Heart ecosystem coins on PulseChain. Math only, not financial or tax advice.</p>
        <p className="credit" data-testid="credit">Idea &amp; creation by <a href="https://x.com/sinofrebellion" target="_blank" rel="noopener noreferrer">@sinofrebellion</a> · Launched Oct 10, 2026 · <a className="src-link" href="https://github.com/SinofRebellion/pulsebasis" target="_blank" rel="noopener noreferrer" data-testid="source-link">Source code</a></p>
        <p className="disclaimer"><b>Unofficial.</b> PulseBasis is an independent community tool. It is not affiliated with, endorsed by, or connected to Richard Heart, HEX, PulseChain, PulseX or any project named here.</p></div>
      <div><b>Data sources</b><ul><li>PulseChain archive RPC (rpc.pulsechain.com, rpc-pulsechain.g4mm4.io)</li><li>PulseChain explorer API (api.scan.pulsechain.com)</li><li>PulseX v1/v2 subgraphs (graph.pulsechain.com)</li><li>HEX contract (stakes, daily payouts)</li></ul></div>
      <div><b>Quote sources</b><ul>{[...new Map(QUOTES.map(q => [q.url, q])).values()].map(q => <li key={q.url}><a href={q.url} target="_blank" rel="noreferrer noopener">{q.src}</a></li>)}</ul><p className="muted small">Quotes are shown for culture and context only; no endorsement is implied.</p></div>
    </div>
  </footer>;
}
export function Mark() {
  return <svg className="mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden>
    <defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffdb01" /><stop offset=".35" stopColor="#ff8500" /><stop offset=".65" stopColor="#ff0f6f" /><stop offset="1" stopColor="#c000ff" /></linearGradient></defs>
    <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="none" stroke="url(#mk)" strokeWidth="2.6" strokeLinejoin="round" />
    <path d="M8 17h4l2-5 3.5 9 2.5-6h4" fill="none" stroke="url(#mk)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
const Lock = () => <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }}><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" /></svg>;
export { short };
