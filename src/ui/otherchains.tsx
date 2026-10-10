import type { Report } from '../engine/analyze';
import { usd, price, qtyFull, pct } from '../format';
import { CoinIcon } from './coin';

const plc = (v: number) => (v >= 0 ? 'pos' : 'neg');
type Row = { key: string; title: string; sub: string; qty: number; cost: number; avg: number; now: number; value: number; pl: number; plpct: number | null; rise: number | null; extra?: React.ReactNode; note?: string };

function ChainCard({ x }: { x: Row }) {
  return <div className="card coin oc-card" style={{ ['--c' as any]: '#5b8cff' }} data-testid={'oc-' + x.key}>
    <div className="coin-top"><CoinIcon coin="EHEX" size={28} /><b>{x.title}</b><span className="muted">{x.sub}</span></div>
    <div className="coin-amt">{qtyFull(x.qty)} <small>HEX</small></div>
    <div className="coin-val">{usd(x.value)} {x.cost > 0 && <span className={plc(x.pl)}>{usd(x.pl, { sign: true })} ({pct(x.plpct)})</span>}</div>
    <div className="coin-rows">
      <div><span>Average cost</span><b data-testid={'oc-avg-' + x.key}>{x.cost > 0 ? price(x.avg) : '$0 (free)'}</b></div>
      <div><span>Price today</span><b>{x.now ? price(x.now) : '–'}</b></div>
      <div><span>Break-even</span><b>{x.cost <= 0 || x.rise == null ? '–' : x.rise > 0 ? `needs ${pct(x.rise, 1, false)} rise` : `already ${pct(-x.rise, 1, false)} above`}</b></div>
      <div><span>Cost</span><b>{usd(x.cost)}</b></div>
    </div>
    {x.extra}
    {x.note && <p className="coin-explain">{x.note}</p>}
  </div>;
}

export function OtherChains({ r }: { r: Report }) {
  const E = r.ehex; const H = r.eth;
  const rows: Row[] = [];
  if (E && (E.qty > 1e-8 || E.cost > 0)) rows.push({ key: 'ehex', title: 'eHEX', sub: 'bridged to PulseChain', ...E, note: 'Ethereum HEX moved to PulseChain through the official bridge. It is its own coin there, separate from pHEX, priced from PulseX.' });
  const ok = H && H.status === 'ok';
  if (ok && H.any) rows.push({ key: 'eth', title: 'HEX on Ethereum', sub: 'original chain', qty: H.qty, cost: H.cost, avg: H.avg, now: H.now, value: H.value, pl: H.pl, plpct: H.plpct, rise: H.rise,
    extra: H.nStakes > 0 ? <div className="coin-rows oc-stakes">
      <div><span>Stakes</span><b>{H.nStakes} · {H.tshares.toFixed(2)} T-shares</b></div>
      <div><span>Staked</span><b>{qtyFull(H.staked)} HEX</b></div>
      <div><span>Interest so far</span><b>{qtyFull(H.accrued)} HEX</b></div>
      <div><span>Liquid</span><b>{qtyFull(H.liquid)} HEX</b></div>
    </div> : undefined,
    note: H.nStakes > 0 ? `Includes staked HEX and the interest it has earned, at $0 cost. Without the interest your average is ${price(H.avgExInterest)}.` : 'Ethereum HEX in these wallets, with what it cost at the time (stablecoins or ETH valued at that moment).' });
  const fork = ok && H.forkSnap && (H.forkSnap.liquid + H.forkSnap.staked) > 0.5 ? H.forkSnap : null;
  const cost = rows.reduce((s, x) => s + x.cost, 0), value = rows.reduce((s, x) => s + x.value, 0);
  return <div className="card oc" data-testid="otherchains">
    <div className="card-title">eHEX and HEX on Ethereum</div>
    <p className="muted small">Kept separate from your PulseChain totals above, so nothing is counted twice.</p>
    {H && H.status === 'error' && <p className="oc-msg" data-testid="oc-error">The public Ethereum servers were busy, so we couldn't read Ethereum this time. Your PulseChain numbers are not affected; run again later to add it.</p>}
    {!rows.length && (!H || H.status !== 'error') && <p className="oc-msg" data-testid="oc-none">No eHEX on PulseChain and no HEX on Ethereum in these wallets.</p>}
    {rows.length > 0 && <div className="coin-grid oc-grid">{rows.map(x => <ChainCard key={x.key} x={x} />)}</div>}
    {fork && <p className="oc-fork" data-testid="oc-fork">At the PulseChain fork (May 2023) these wallets held <b>{qtyFull(fork.liquid + fork.staked)} HEX on Ethereum</b> ({qtyFull(fork.liquid)} liquid, {qtyFull(fork.staked)} staked). PulseChain copied that as pHEX, which is counted above at $0 cost. The Ethereum original keeps its own cost here.</p>}
    {ok && H.short > 1 && <p className="muted small">{qtyFull(H.short)} Ethereum HEX left these wallets beyond what the explorer shows arriving (usually very old 2019–2020 claims), so it's counted at $0 cost.</p>}
    {rows.length > 0 && <p className="oc-total">Everything together (PulseChain coins + these): cost <b>{usd(r.tot.cost + cost, { cents: false })}</b>, worth <b>{usd(r.tot.value + value, { cents: false })}</b> today.</p>}
  </div>;
}
