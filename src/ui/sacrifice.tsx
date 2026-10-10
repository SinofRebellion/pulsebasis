import { useEffect, useState } from 'react';
import type { Report } from '../engine/analyze';
import { SAC_LIST, SAC_COINS, type SacCoin } from '../engine/sacrifice';
import { usd, qtyFull, price } from '../format';
import { CoinIcon } from './coin';

const day = (ts: number) => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const amt = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });

/** Sacrifice coins: what the PulseChain, PulseX and ProveX sacrifices cost, and which coins carry that cost. */
export function SacrificeSection({ r, manual, onApply, busy }: { r: Report; manual: Record<string, number>; onApply: (m: Record<string, number>) => void; busy: boolean }) {
  const S = r.sacrifice;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(SAC_COINS.map(c => [c, manual[c] ? String(manual[c]) : ''])));
  useEffect(() => { setDraft(Object.fromEntries(SAC_COINS.map(c => [c, manual[c] ? String(manual[c]) : '']))); }, [manual]);
  if (!S) return null;
  const rows = SAC_LIST.map(s => ({ s, c: s.coin, recv: S.recv[s.coin], found: S.found[s.coin], man: S.manual[s.coin], txs: S.txs.filter(t => t.coin === s.coin) }));
  const any = rows.some(x => x.recv.q > 0 || x.found > 0 || x.man > 0);
  const parsed = Object.fromEntries(SAC_COINS.map(c => [c, Math.max(0, parseFloat(String(draft[c] || '').replace(/[$,\s]/g, '')) || 0)]));
  const changed = SAC_COINS.some(c => (parsed[c] || 0) !== (manual[c] || 0));
  return <section className="sec" id="sacrifice"><div className="card sac" data-testid="sacrifice">
    <div className="card-title">Sacrifice coins</div>
    <p className="muted small">PLS, PLSX and PRVX were handed out to people who sacrificed in 2021–2022 (PulseChain, PulseX) and 2025–2026 (ProveX). Those coins aren't free: they carry what was sacrificed, in dollars on the day it was sent. We look for sacrifices these wallets sent on Ethereum.</p>
    {S.status === 'error' && <p className="oc-msg" data-testid="sac-error">The Ethereum explorer was busy, so we couldn't look up sacrifices this time. You can still enter them below.</p>}
    {!any && S.status === 'ok' && <p className="oc-msg" data-testid="sac-none">No sacrifices from these wallets and no sacrifice coins in them.</p>}
    {any && <div className="sac-grid">{rows.filter(x => x.recv.q > 0 || x.found > 0 || x.man > 0).map(x => {
      const cost = x.found + x.man; const nf = x.recv.q > 0 && !(cost > 0);
      return <div className={'sac-row' + (nf ? ' nf' : '')} key={x.c} data-testid={'sac-' + x.c}>
        <div className="sac-h"><CoinIcon coin={x.c} size={22} /><b>{x.s.name}</b><span className="muted small">{day(Date.parse(x.s.from) / 1000)} – {day(Date.parse(x.s.to) / 1000)}</span></div>
        <div className="coin-rows">
          <div><span>Coins received</span><b>{x.recv.q > 0 ? `${qtyFull(x.recv.q)} ${x.c}` : 'none in these wallets'}</b></div>
          <div><span>Sacrificed (found on Ethereum)</span><b data-testid={'sac-found-' + x.c}>{x.found > 0 ? usd(x.found) : '—'}</b></div>
          {x.man > 0 && <div><span>You entered</span><b>{usd(x.man)}</b></div>}
          <div><span>Cost per {x.c}</span><b>{x.recv.q > 0 && cost > 0 ? price(cost / x.recv.q) : '—'}</b></div>
        </div>
        {nf && <p className="sac-nf" data-testid={'sac-nf-' + x.c}>Sacrifice coins: cost not found (enter it below). Until then they count at $0, which makes your average look lower than it really is.</p>}
        {!nf && cost > 0 && x.recv.q > 0 && <p className="muted small">That cost is now part of your {x.c} cost. If some of these coins were sold or moved out, their share of the cost left with them.</p>}
        {cost > 0 && !(x.recv.q > 0) && <p className="muted small">We didn't find {x.c} from this sacrifice in these wallets (it may have gone to another address), so this cost isn't added to anything.</p>}
        {x.txs.length > 0 && <details className="sac-tx"><summary>{x.txs.length} sacrifice transaction{x.txs.length === 1 ? '' : 's'}</summary><ul>{x.txs.map(t =>
          <li key={t.tx + t.token}><a href={'https://etherscan.io/tx/' + t.tx} target="_blank" rel="noopener noreferrer">{day(t.ts)}</a> <span>{amt(t.amount)} {t.sym}</span> <b>{t.usd != null ? usd(t.usd) : 'no price'}</b></li>)}</ul></details>}
      </div>;
    })}</div>}
    {S.unpriced > 0 && <p className="muted small">{S.unpriced} sacrificed token transfer{S.unpriced === 1 ? '' : 's'} had no dollar price for that day and {S.unpriced === 1 ? 'is' : 'are'} not counted. Add them below if you know the value.</p>}
    <form className="sac-form" data-testid="sac-form" onSubmit={e => { e.preventDefault(); if (!busy) onApply(parsed); }}>
      <div className="sac-form-h"><b>Sacrificed from another wallet or an exchange?</b><span>If you sacrificed from a wallet you didn't paste above (or from an exchange), type how many dollars you sacrificed. We'll add it to what your coins cost.</span></div>
      <div className="sac-inputs">{SAC_COINS.map(c => <label key={c}><span><CoinIcon coin={c} size={16} /> {c === 'PLS' ? 'PulseChain sacrifice (PLS)' : c === 'PLSX' ? 'PulseX sacrifice (PLSX)' : 'ProveX sacrifice (PRVX)'}</span>
        <div className="bn-amt"><span>$</span><input type="text" inputMode="decimal" autoComplete="off" placeholder="0" data-testid={'sac-in-' + c} aria-label={`Extra dollars sacrificed for ${c}`} value={draft[c] ?? ''} onChange={e => setDraft(d => ({ ...d, [c]: e.target.value.replace(/[^0-9.,]/g, '') }))} /></div></label>)}</div>
      <div className="form-actions"><button className="btn primary" type="submit" disabled={busy || !changed} data-testid="sac-apply">{busy ? 'Updating…' : 'Update my numbers'}</button>
        {Object.keys(manual).length > 0 && <button type="button" className="btn ghost" disabled={busy} onClick={() => onApply({})}>Remove what I entered</button>}</div>
      <p className="muted small sac-saved">Saved only on this device.</p>
    </form>
    <p className="muted small">Sacrifices we read: Ethereum sends to the official addresses (PulseChain {short(SAC_LIST[0].address)}, PulseX {short(SAC_LIST[1].address)}, ProveX {short(SAC_LIST[2].address)}). Sacrifices on other networks (BNB Chain, Polygon and others), through a swap contract, or from another wallet aren't found automatically: enter those above.</p>
  </div></section>;
}
const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
