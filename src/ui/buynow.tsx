import { useId, useState } from 'react';
import { simulate, parseUsd, FEES } from '../engine/sim';
import { usd, price, qtyFull, pct } from '../format';
import { CoinIcon } from './coin';

const plc = (v: number) => (v >= 0 ? 'pos' : 'neg');
const CHIPS = [100, 500, 1000];
const beTxt = (r: number) => (r > 0 ? `needs +${pct(r, 1, false)}` : `${pct(-r, 1, false)} above`);

function AmountInput({ amt, setAmt, fee, setFee, custom, setCustom, idp }: any) {
  return <>
    <label className="bn-label" htmlFor={idp + 'amt'}>Amount to buy (USD)</label>
    <div className="bn-amt"><span>$</span>
      <input id={idp + 'amt'} data-testid="bn-amount" type="text" inputMode="decimal" autoComplete="off" enterKeyHint="done" placeholder="e.g. 250" value={amt}
        onChange={e => setAmt(e.target.value.replace(/[^0-9.,]/g, ''))} aria-label="Amount to buy in US dollars" /></div>
    <div className="bn-chips">{CHIPS.map(c => <button type="button" key={c} className={parseUsd(amt) === c ? 'on' : ''} onClick={() => setAmt(String(c))}>${c.toLocaleString('en-US')}</button>)}</div>
    <div className="bn-fee"><label htmlFor={idp + 'fee'}>Fee</label>
      <select id={idp + 'fee'} data-testid="bn-fee" value={fee} onChange={e => setFee(e.target.value)}>{FEES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
      {fee === 'custom' && <input type="text" inputMode="decimal" data-testid="bn-fee-custom" aria-label="Custom fee percent" value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="%" />}
    </div>
  </>;
}
const feePctOf = (fee: string, custom: string) => (fee === 'custom' ? Math.min(50, parseFloat(custom) || 0) : FEES.find(f => f.id === fee)?.pct ?? 0);

/** Per-coin simulator, folded inside a coin card. */
export function BuyNow({ coin, qty, cost, now, freeQty = 0 }: { coin: string; qty: number; cost: number; now: number; freeQty?: number }) {
  const [open, setOpen] = useState(false); const [amt, setAmt] = useState(''); const [fee, setFee] = useState('none'); const [custom, setCustom] = useState(''); const idp = useId();
  const spend = parseUsd(amt); const S = simulate({ qty, cost, now, spend, feePct: feePctOf(fee, custom), freeQty });
  if (!now) return null;
  return <div className="bn" data-testid={'bn-' + coin}>
    <button type="button" className="bn-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} What if I buy {coin} now?</button>
    {open && <div className="bn-body">
      <AmountInput {...{ amt, setAmt, fee, setFee, custom, setCustom, idp }} />
      {spend > 0 ? <div className="bn-out" data-testid="bn-out" aria-live="polite">
        <p className="bn-got">You'd get about <b data-testid="bn-got">{qtyFull(S.got)} {coin}</b> at {price(now)}{S.fee > 0 ? ` (after ${usd(S.fee)} fee)` : ''}.</p>
        <div className="bn-grid">
          <div><span>Average cost</span><b><s>{price(S.avg)}</s> → <em data-testid="bn-newavg">{price(S.newAvg)}</em></b><small>{S.lowerPct >= 0 ? `${pct(S.lowerPct, 1, false)} lower` : `${pct(-S.lowerPct, 1, false)} higher`}</small></div>
          <div><span>Break-even</span><b><s>{beTxt(S.riseBefore)}</s> → <em data-testid="bn-be">{beTxt(S.riseAfter)}</em></b><small>How far {coin} must rise to cover your cost.</small></div>
          <div><span>Gain / loss today</span><b><s className={plc(S.plBefore)}>{usd(S.plBefore, { sign: true })}</s> → <em className={plc(S.plAfter)}>{usd(S.plAfter, { sign: true })}</em></b><small>Same right after buying{S.fee > 0 ? ', minus the fee' : ''}.</small></div>
          {freeQty > 0 && <div><span>Without stake interest</span><b><s>{price(S.avgEx)}</s> → <em data-testid="bn-newavg-ex">{price(S.newAvgEx)}</em></b><small>Average if the free interest weren't counted.</small></div>}
        </div>
      </div> : <p className="muted small">Type any amount to see your new average and break-even.</p>}
      <p className="bn-note">At today's price, ignoring slippage{fee === 'none' ? ' and fees' : ''}. Not advice.</p>
    </div>}
  </div>;
}

/** Overall simulator: put a dollar amount into one coin and see the effect on everything you hold. */
export function BuyNowOverall({ coins, tot }: { coins: { c: string; qty: number; cost: number; now: number }[]; tot: { cost: number; value: number } }) {
  const [coin, setCoin] = useState(coins[0]?.c ?? 'HEX'); const [amt, setAmt] = useState(''); const [fee, setFee] = useState('none'); const [custom, setCustom] = useState(''); const idp = useId();
  const x = coins.find(k => k.c === coin) ?? coins[0]; if (!x) return null;
  const spend = parseUsd(amt); const S = simulate({ qty: x.qty, cost: x.cost, now: x.now, spend, feePct: feePctOf(fee, custom) });
  const cA = tot.cost + spend, vA = tot.value + S.got * x.now;
  const beB = tot.value ? (tot.cost / tot.value - 1) * 100 : 0, beA = vA ? (cA / vA - 1) * 100 : 0;
  return <div className="card bn-overall" data-testid="bn-overall">
    <div className="card-title">What if I buy now?</div>
    <p className="muted small">Pick a coin and an amount to see how it changes your whole position, at today's price.</p>
    <div className="bn-coins" role="tablist">{coins.map(k => <button key={k.c} type="button" role="tab" aria-selected={k.c === coin} className={k.c === coin ? 'on' : ''} onClick={() => setCoin(k.c)}><CoinIcon coin={k.c} size={16} />{k.c}</button>)}</div>
    <AmountInput {...{ amt, setAmt, fee, setFee, custom, setCustom, idp }} />
    {spend > 0 ? <div className="bn-out" aria-live="polite">
      <p className="bn-got">{usd(spend)} buys about <b>{qtyFull(S.got)} {coin}</b> at {price(x.now)}{S.fee > 0 ? ` (after ${usd(S.fee)} fee)` : ''}.</p>
      <div className="bn-grid">
        <div><span>{coin} average cost</span><b><s>{price(S.avg)}</s> → <em>{price(S.newAvg)}</em></b><small>{S.lowerPct >= 0 ? `${pct(S.lowerPct, 1, false)} lower` : `${pct(-S.lowerPct, 1, false)} higher`}</small></div>
        <div><span>Overall break-even</span><b><s>{beTxt(beB)}</s> → <em data-testid="bn-overall-be">{beTxt(beA)}</em></b><small>How far prices must rise overall to cover everything you paid.</small></div>
        <div><span>Total cost</span><b><s>{usd(tot.cost, { cents: false })}</s> → <em>{usd(cA, { cents: false })}</em></b><small>Dollars in, including this buy.</small></div>
        <div><span>Gain / loss today</span><b><s className={plc(tot.value - tot.cost)}>{usd(tot.value - tot.cost, { sign: true, cents: false })}</s> → <em className={plc(vA - cA)}>{usd(vA - cA, { sign: true, cents: false })}</em></b><small>Unchanged by buying, except any fee.</small></div>
      </div>
    </div> : <p className="muted small">Type any amount to see the effect.</p>}
    <p className="bn-note">At today's price, ignoring slippage{fee === 'none' ? ' and fees' : ''}. Not advice.</p>
  </div>;
}
