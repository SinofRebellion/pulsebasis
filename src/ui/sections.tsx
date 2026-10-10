import { useState } from 'react';
import type { Report } from '../engine/analyze';
import { CoinIcon } from './coin';
import { OtherChains } from './otherchains';
import { BuyNow, BuyNowOverall } from './buynow';
import { usd, price, qty, qtyFull, pct, short, isoDate, monthFmt, dateFmt, COIN_COLORS, COIN_NAMES } from '../format';
import { Donut, BuyChart, Bars, AreaChart } from './charts';

const COINS = ['HEX', 'PLS', 'PLSX', 'INC', 'PRVX'];
const SCAN = 'https://scan.pulsechain.com';
const SACNF = 'Sacrifice coins: cost not found';
const INCOME_LABEL: Record<string, string> = { 'free/dust received': 'Small unsolicited transfers (dust)', 'HEX stake interest': 'HEX stake interest from ended stakes' };
const VENUE_LABEL: Record<string, string> = { 'PulseX / other DEX': 'Other DEX or router', Other: 'Other contracts' };
const plc = (n: number) => (n >= 0 ? 'pos' : 'neg');

function Sec({ id, n, title, sub, children }: { id: string; n: number; title: string; sub: string; children: React.ReactNode }) {
  return <section className="sec" id={id}>
    <div className="sec-head"><span className="sec-n">{n}</span><div><h2>{title}</h2><p>{sub}</p></div></div>
    {children}
  </section>;
}
function Kpi({ label, value, sub, tone, test }: { label: string; value: React.ReactNode; sub: React.ReactNode; tone?: string; test?: string }) {
  return <div className={'kpi ' + (tone || '')}><div className="kpi-l">{label}</div><div className="kpi-v" data-testid={test}>{value}</div><div className="kpi-s">{sub}</div></div>;
}
const Badge = ({ kind, children }: { kind: string; children: React.ReactNode }) => <span className={'badge b-' + kind}>{children}</span>;

// ---------------------------------------------------------------- 1. Position
export function Position({ r, labels }: { r: Report; labels: Record<string, string> }) {
  const T = r.tot; const X = r.hex;
  const down = T.pl < 0; const beAll = T.value ? (T.cost / T.value - 1) * 100 : 0;
  const order = [...COINS].sort((a, b) => r.percoin[b].value - r.percoin[a].value);
  const empty = T.cost === 0 && T.value === 0;
  return <Sec id="position" n={1} title="Your position" sub={`What you hold right now across ${Object.keys(labels).length} wallet${Object.keys(labels).length === 1 ? '' : 's'}, at live PulseX prices (block ${r.block.toLocaleString()}, ${dateFmt(r.asOf)}).`}>
    {empty ? <div className="card story"><p>No HEX, PLS, PLSX, INC or PRVX found in these wallets. If that's unexpected, double-check the addresses.</p></div> :
      <div className="card story glow">
        <p className="story-line">Your coins cost you <b data-testid="total-cost">{usd(T.cost, { cents: false })}</b> and are worth <b>{usd(T.value, { cents: false })}</b> today. That's {down ? 'a loss' : 'a gain'} of <b className={plc(T.pl)}>{usd(Math.abs(T.pl), { cents: false })} ({pct(Math.abs(T.plpct), 1, false)})</b> on paper{down ? <>; prices need to rise about <b>{pct(beAll, 0, false)}</b> overall for you to break even.</> : '.'}</p>
        <div className="kpis k4">
          <Kpi label="Value today" value={usd(T.value)} sub="What everything you hold is worth at today's price, including staked HEX and the interest it has earned." />
          <Kpi label="Cost of what you hold" value={usd(T.cost)} sub="The dollars it took to get the coins you still hold (average-cost method)." />
          <Kpi label="Unrealized gain / loss" value={usd(T.pl, { sign: true })} tone={plc(T.pl)} sub={`Value today minus cost, ${pct(T.plpct)}. Nothing is sold, so it's on paper.`} />
          <Kpi label="Free HEX from stakes" value={qtyFull(X.accrued) + ' HEX'} sub={`Interest your stakes have earned so far, counted at $0 cost. Worth ${usd(X.interest_value)} today.`} tone="hex" />
        </div>
      </div>}
    <div className="coin-grid">
      {order.map(c => {
        const p = r.percoin[c]; if (p.qty <= 0 && p.cost <= 0) return null;
        return <div className="card coin" key={c} style={{ ['--c' as any]: COIN_COLORS[c] }} data-testid={'coin-' + c}>
          <div className="coin-top"><CoinIcon coin={c} size={28} /><b>{c}</b>{COIN_NAMES[c] && <span className="muted">{COIN_NAMES[c]}</span>}<span className="share">{p.share.toFixed(1)}%</span></div>
          <div className="coin-amt">{qtyFull(p.qty)} <small>{c}</small></div>
          <div className="coin-val">{usd(p.value)} <span className={plc(p.pl)}>{usd(p.pl, { sign: true })} ({pct(p.plpct)})</span></div>
          <div className="coin-rows">
            <div><span>Average cost</span><b data-testid={'avg-' + c}>{price(p.avg)}</b></div>
            <div><span>Price today</span><b>{price(p.now)}</b></div>
            <div><span>Break-even</span><b>{p.rise > 0 ? `needs ${pct(p.rise, 1, false)} rise` : `already ${pct(-p.rise, 1, false)} above`}</b></div>
            <div><span>Cost</span><b>{usd(p.cost)}</b></div>
          </div>
          {c === 'HEX' && <div className="hex-split">
            <SplitBar parts={[{ v: X.liquid, c: '#ffb020', l: 'Liquid' }, { v: X.principal, c: '#ff3d9a', l: 'Staked principal' }, { v: X.accrued, c: '#a259ff', l: 'Interest so far' }]} />
            <div className="split-legend"><span><i style={{ background: '#ffb020' }} />Liquid {qtyFull(X.liquid)}</span><span><i style={{ background: '#ff3d9a' }} />Staked {qtyFull(X.principal)}</span><span><i style={{ background: '#a259ff' }} />Interest {qtyFull(X.accrued)}</span></div>
          </div>}
          <p className="coin-explain">{c === 'HEX' ? `Average cost includes the free interest. Without it: ${price(X.avg_ex_accr)}.` : p.rise > 0 ? `${c} has to reach ${price(p.avg)} for these coins to be worth what they cost.` : `Above your average cost: every ${c} is worth more than you paid on average.`}</p>
          {(r.sacrifice?.nfHeld?.[c] ?? 0) > 0 && <p className="coin-sacnf" data-testid={'coin-sacnf-' + c}>Includes {qtyFull(r.sacrifice!.nfHeld[c])} {c} from a sacrifice: cost not found (enter it below)</p>}
          <BuyNow coin={c} qty={p.qty} cost={p.cost} now={p.now} freeQty={c === 'HEX' ? X.accrued : 0} />
        </div>;
      })}
      <div className="card alloc">
        <div className="card-title">Where your value sits</div>
        <Donut items={order.map(c => ({ label: c, value: r.percoin[c].value, color: COIN_COLORS[c] }))} center={<><b>{usd(T.value, { cents: false })}</b><span>value today</span></>} />
        <ul className="legend">{order.map(c => <li key={c}><i style={{ background: COIN_COLORS[c] }} /><CoinIcon coin={c} size={18} />{c}<b>{r.percoin[c].share.toFixed(1)}%</b></li>)}</ul>
      </div>
    </div>
    {!empty && <BuyNowOverall coins={order.filter(c => r.percoin[c].now > 0).map(c => ({ c, qty: r.percoin[c].qty, cost: r.percoin[c].cost, now: r.percoin[c].now }))} tot={T} />}
    <OtherChains r={r} />
  </Sec>;
}
function SplitBar({ parts }: { parts: { v: number; c: string; l: string }[] }) {
  const t = parts.reduce((s, p) => s + p.v, 0) || 1;
  return <div className="splitbar">{parts.map((p, i) => <i key={i} title={p.l} style={{ width: (p.v / t * 100) + '%', background: p.c }} />)}</div>;
}

// ---------------------------------------------------------------- 2. Cost
export function CostSection({ r }: { r: Report }) {
  const avail = COINS.filter(c => r.buys[c].length || r.percoin[c].qty > 0);
  const [coin, setCoin] = useState(avail[0] ?? 'HEX');
  const p = r.percoin[coin]; const ev = r.effective[coin];
  return <Sec id="cost" n={2} title="What it cost" sub="How your average cost was built, buy by buy. Every buy is priced at the exact block it happened.">
    <div className="seg" role="tablist">{avail.map(c => <button key={c} role="tab" aria-selected={c === coin} className={c === coin ? 'on' : ''} style={{ ['--c' as any]: COIN_COLORS[c] }} onClick={() => setCoin(c)}><CoinIcon coin={c} size={16} />{c}</button>)}</div>
    <div className="card">
      <div className="kpis k4">
        <Kpi label={`${coin} average cost`} value={price(p.avg)} sub={coin === 'HEX' ? `Includes free stake interest. Without it: ${price(r.hex.avg_ex_accr)}.` : 'Cost of what you hold ÷ amount you hold.'} />
        <Kpi label="Price today" value={price(p.now)} sub={p.rise > 0 ? `Needs a ${pct(p.rise, 1, false)} rise to reach your average.` : `${pct(-p.rise, 1, false)} above your average.`} tone={p.rise > 0 ? 'neg' : 'pos'} />
        <Kpi label="Paid vs market" value={ev.prem == null ? '—' : pct(ev.prem, 2)} sub={ev.prem == null ? 'No priced buys still held.' : `Your average price paid per coin (${price(ev.avg_paid)}) vs the market price at the same blocks (${price(ev.avg_mkt)}). Fees and slippage show up here.`} />
        <Kpi label="Buys still held" value={ev.n.toLocaleString()} sub={ev.first ? `Since ${isoDate(ev.first)}. Faded dots below were later sold or spent.` : '—'} />
      </div>
      <BuyChart key={coin} coin={coin} buys={r.buys[coin]} series={r.series[coin]} avg={p.avg} now={p.now} color={COIN_COLORS[coin]} />
      <p className="explain">Why can my average differ from the dots? When you swap one coin for another, the cost of what you gave up carries over to what you got. So your average cost reflects your original dollars, not just the last swap price.</p>
    </div>
    <div className="two">
      <LotList title="Best buys still held" sub="Bought cheapest compared with today's price" rows={r.best} />
      <LotList title="Worst buys still held" sub="Bought most expensive compared with today's price" rows={r.worst} />
    </div>
  </Sec>;
}
function LotList({ title, sub, rows }: { title: string; sub: string; rows: Report['best'] }) {
  return <div className="card"><div className="card-title">{title}</div><p className="muted small">{sub}</p>
    <ul className="lots">{rows.filter(x => x.held * x.ppc * x.mult >= 1).slice(0, 5).map((x, i) => <li key={i}><span className="coin-chip" style={{ ['--c' as any]: COIN_COLORS[x.coin] }}><CoinIcon coin={x.coin} size={14} />{x.coin}</span>
      <div><b>{isoDate(x.date)}</b><span>{qty(x.held)} held · paid {price(x.ppc)}</span></div>
      <em className={x.mult >= 1 ? 'pos' : 'neg'}>{x.mult >= 1 ? `${x.mult.toFixed(2)}×` : pct((x.mult - 1) * 100, 0)}</em></li>)}
      {!rows.length && <li className="muted">No priced buys still held.</li>}</ul></div>;
}

// ---------------------------------------------------------------- 3. Stakes
export function StakesSection({ r, labels }: { r: Report; labels: Record<string, string> }) {
  const X = r.hex; const SH = r.stakeHist; const [open, setOpen] = useState(false);
  const byYear = new Map<string, { p: number; a: number; f: number; n: number }>();
  for (const s of r.stakes) { const y = s.end_date.slice(0, 4); const v = byYear.get(y) ?? { p: 0, a: 0, f: 0, n: 0 }; v.p += s.principal; v.a += s.accrued; v.f += s.future; v.n++; byYear.set(y, v); }
  const rows = [...byYear.entries()].sort().map(([y, v]) => ({ label: "'" + y.slice(2), parts: [{ v: v.p, color: '#ff3d9a', name: 'Principal' }, { v: v.a, color: '#a259ff', name: 'Interest so far' }, { v: v.f, color: 'rgba(24,212,255,.55)', name: 'Est. future interest' }] }));
  const ratio = SH.payout_usd > 0 ? SH.penalty_usd / SH.payout_usd : 0;
  if (!X.n && !SH.ended) return <Sec id="stakes" n={3} title="Stakes & interest" sub="HEX stakes found in these wallets."><div className="card"><p>No HEX stakes found. HEX you stake earns interest that counts at $0 cost and lowers your average.</p></div></Sec>;
  return <Sec id="stakes" n={3} title="Stakes & interest" sub="Read straight from the HEX contract: each stake's principal, T-shares and the interest it has earned day by day.">
    <div className="card glow-hex">
      <div className="kpis k3">
        <Kpi label="Active stakes" value={<span data-testid="stake-count">{X.n}</span>} sub={<><b data-testid="tshares">{X.tshares.toFixed(2)}</b> T-shares, your seat in HEX's daily payout.</>} />
        <Kpi label="HEX in stakes today" value={qtyFull(X.stake_now) + ' HEX'} sub={`${qtyFull(X.principal)} principal you put in + ${qtyFull(X.accrued)} interest earned so far. Worth ${usd(X.stake_now * r.now.HEX)}.`} tone="hex" />
        <Kpi label="Estimated at maturity" value={qtyFull(X.maturity) + ' HEX'} sub={`Estimate, if HEX's last-30-day payout rate holds until each stake ends. Not a promise. ${usd(X.maturity_value_now)} at today's price.`} />
      </div>
      <div className="offset">
        <div className="offset-title">How much stake interest lowers your average</div>
        <div className="offset-bars">
          <div><span>Without interest</span><b>{price(X.avg_ex_accr)}</b><i style={{ width: '100%' }} /></div>
          <div><span>With {qtyFull(X.accrued)} free HEX</span><b className="pos">{price(X.avg_incl)}</b><i className="hexg" style={{ width: (X.avg_ex_accr ? X.avg_incl / X.avg_ex_accr * 100 : 100) + '%' }} /></div>
        </div>
        <p className="explain">Interest earned so far cut your HEX average cost by <b>{pct(r.avgOffsetPct, 1, false)}</b>, worth <b>{usd(X.interest_value)}</b> today. {r.paidInterest > 0 ? <>Stakes you already ended paid out another {qtyFull(r.paidInterest)} HEX of interest, which is already inside your liquid HEX and its average.</> : null} Every day your stakes run, this gap grows.</p>
      </div>
    </div>
    <div className="two">
      <div className="card"><div className="card-title">When your stakes end</div><p className="muted small">HEX per end year: principal, interest so far, and estimated interest still to come.</p>
        <Bars rows={rows} />
        <div className="split-legend"><span><i style={{ background: '#ff3d9a' }} />Principal</span><span><i style={{ background: '#a259ff' }} />Interest so far</span><span><i style={{ background: 'rgba(24,212,255,.55)' }} />Est. future (estimate)</span></div>
      </div>
      {SH.ended > 0 && <div className="card"><div className="card-title">Lesson from past stakes</div>
        <p className="muted small">{SH.ended} stakes ended since PulseChain launched: {SH.full} ran full term, {SH.early} ended early, {SH.cancel} cancelled before they started.</p>
        <div className="vs">
          <div className="neg"><span>Lost to early-end penalties</span><b>{qtyFull(SH.penalty)} HEX</b><em>{usd(SH.penalty_usd, { cents: false })} at the time</em></div>
          <div className="pos"><span>Interest those stakes paid</span><b>{qtyFull(SH.payout)} HEX</b><em>{usd(SH.payout_usd, { cents: false })} at the time</em></div>
        </div>
        {ratio > 1 && <p className="explain">Penalties cost <b>{ratio.toFixed(1)}×</b> what staking paid. Letting active stakes reach their end date is the cheapest way to grow your HEX.</p>}
      </div>}
    </div>
    {X.n > 0 && <div className="card">
      <button className="disclosure" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? '▾' : '▸'} All {X.n} active stakes</button>
      {open && <div className="table-wrap"><table className="tbl stake-tbl">
        <thead><tr><th>Ends</th><th>Principal</th><th>Interest so far</th><th>T-shares</th><th>Served</th><th>Est. at end</th><th>Wallet</th></tr></thead>
        <tbody>{r.stakes.map(s => <tr key={s.id}><td>{isoDate(s.end_date)}</td><td>{qtyFull(s.principal)}</td><td>{qtyFull(s.accrued)}</td><td>{s.tshares.toFixed(3)}</td>
          <td><div className="served"><i style={{ width: s.servedPct * 100 + '%' }} /></div>{Math.round(s.servedPct * 100)}%</td><td>{qtyFull(s.principal + s.accrued + s.future)}</td><td>{labels[s.wallet] ?? short(s.wallet)}</td></tr>)}</tbody>
      </table></div>}
    </div>}
  </Sec>;
}

// ---------------------------------------------------------------- 4. Money in
export function MoneySection({ r }: { r: Report }) {
  const M = r.moneyIn; const F = r.fees;
  const ramps = M.ramps.filter((x: any) => x.n > 0);
  const venues = Object.entries(r.venues).sort((a, b) => b[1].usd - a[1].usd);
  const vTot = venues.reduce((s, [, v]) => s + v.usd, 0) || 1;
  const gpPct = F.gopulse.vol ? F.gopulse.usd / F.gopulse.vol * 100 : 0;
  const cum = fillMonths(r.cumulative, r.asOf);
  const rampFees = M.ramps.filter((x: any) => x.fee > 0.005 || (x.feeOutEst ?? 0) > 0.005);
  return <Sec id="money" n={4} title="How you got in, and what it cost in fees" sub="Every dollar that arrived from outside your wallets, grouped by the on-ramp or bridge it came through.">
    <div className="card">
      <div className="kpis k3">
        <Kpi label="Money in (all time)" value={usd(M.total)} sub={`${M.n} arrivals from bridges, exchanges, services and other wallets, at market value when they arrived.`} />
        <Kpi label="Money out (all time)" value={usd(r.moneyOutTotal)} sub="Coins you sent out of your wallets (sales, bridges back out, transfers), at market value then." />
        <Kpi label="Fees you can see on-chain" value={usd(r.feesTotal)} sub="Aggregator fees, published ramp fees and gas. Off-chain markups aren't included." tone="neg" />
      </div>
      <p className="explain">Money in is bigger than the cost of what you hold ({usd(r.tot.cost, { cents: false })}) because it also counts dollars that went into coins you later sold, swapped away or sent out. The cost of what you hold is the part of your money still in your wallets.</p>
    </div>
    <div className="card">
      <div className="card-title">On-ramps and bridges</div>
      <ul className="ramps">{ramps.map((x: any) => <li key={x.id}>
        <div className="ramp-top"><b>{x.name}</b><span className="ramp-usd">{usd(x.usd, { cents: false })}</span></div>
        <div className="rampbar"><i style={{ width: Math.max(1.5, x.share) + '%', background: x.color }} /></div>
        <div className="ramp-meta"><span><b>{x.share.toFixed(1)}%</b> of money in</span><span>{x.n} arrivals</span><span>Fees: {x.fee + (x.feeOutEst ?? 0) > 0.005 ? <b>{usd(x.fee + (x.feeOutEst ?? 0))}</b> : null} {x.feeText === '—' ? 'none visible' : x.feeText}</span>
          <Badge kind={x.accuracy}>{x.accuracy === 'exact' ? 'Value: exact' : x.accuracy === 'high' ? 'Value: high accuracy' : 'Value: estimate'}</Badge>
          {x.id === 'other' ? null : x.verified === true ? <Badge kind="ok">Address verified</Badge> : x.verified === 'observed' ? <Badge kind="info">Address seen on-chain</Badge> : x.verified === 'heuristic' ? <Badge kind="info">Detected by pattern</Badge> : <Badge kind="warn">Unverified</Badge>}</div>
      </li>)}{!ramps.length && <li className="muted">No outside arrivals found.</li>}</ul>
      <p className="muted small">Every arrival is caught from the chain no matter where it came from. Known ramps only add a label, fee and better valuation. Anything else is still counted at market value as "Other / unknown sender".</p>
    </div>
    <div className="two">
      <div className="card"><div className="card-title">Fees</div>
        <ul className="fee-list">
          {F.gopulse.n > 0 && <li><span>GoPulse fees <small>measured on-chain across {F.gopulse.n} swaps, {gpPct.toFixed(2)}% of {usd(F.gopulse.vol, { cents: false })} swapped</small></span><b>{usd(F.gopulse.usd)}</b></li>}
          {rampFees.map((x: any) => <li key={x.id}><span>{x.name} <small>{x.feeText}{x.feeOutEst ? ` (incl. ~${usd(x.feeOutEst)} estimated on ${usd(x.outUsd, { cents: false })} sent out)` : ''}</small></span><b>{usd(x.fee + (x.feeOutEst ?? 0))}</b></li>)}
          <li><span>Gas <small>{qty(F.gasPls)} PLS over {F.gasN} transactions, at the price each time</small></span><b>{usd(F.gasUsd)}</b></li>
          <li className="total"><span>Total visible fees</span><b>{usd(r.feesTotal)}</b></li>
        </ul>
        <p className="muted small">PulseX's 0.29% pool fee is inside the swap price, so it shows up in "Paid vs market" rather than here. Swap services and exchanges charge their spread off-chain, which no one can see on-chain.</p>
      </div>
      <div className="card"><div className="card-title">Where your buys happened</div><p className="muted small">Dollar value of every coin-for-coin buy, by app or router.</p>
        <ul className="venues">{venues.map(([k, v]) => <li key={k}><span>{VENUE_LABEL[k] ?? k}</span><div className="rampbar"><i style={{ width: v.usd / vTot * 100 + '%' }} /></div><b>{usd(v.usd, { cents: false })}</b><small>{v.n} buy{v.n === 1 ? '' : 's'}</small></li>)}</ul>
      </div>
    </div>
    {cum.length > 1 && <div className="card"><div className="card-title">Money in and out over time</div><p className="muted small">Running totals by month, through today.</p>
      <AreaChart points={cum.map(c => ({ label: monthFmt(c.m), t: 0 }))} series={[{ name: 'In', color: '#ff3d9a', values: cum.map(c => c.cumIn) }, { name: 'Out', color: '#18d4ff', values: cum.map(c => c.cumOut) }]} />
      <div className="split-legend"><span><i style={{ background: '#ff3d9a' }} />Money in</span><span><i style={{ background: '#18d4ff' }} />Money out</span></div>
    </div>}
    {Object.keys(r.incomeBy).some(k => k !== SACNF) && <div className="card"><div className="card-title">Free coins (counted at $0 cost)</div>
      <ul className="fee-list">{Object.entries(r.incomeBy).filter(([k]) => k !== SACNF).map(([k, v]) => <li key={k}><span>{INCOME_LABEL[k] ?? k} <small>{Object.entries(v.q).map(([a, q]) => `${qty(q)} ${a}`).join(', ')}</small></span><b>{usd(v.usd)}</b></li>)}</ul>
      <p className="muted small">Value shown is what they were worth when received. Coins that arrive for free come in at $0 cost, which lowers the average cost of that coin.</p></div>}
  </Sec>;
}

function fillMonths(c: Report['cumulative'], asOf: number) {
  if (!c.length) return c;
  const out: Report['cumulative'] = []; const by = new Map(c.map(x => [x.m, x]));
  let [y, m] = c[0].m.split('-').map(Number); const end = new Date(asOf * 1000); const ey = end.getUTCFullYear(), em = end.getUTCMonth() + 1;
  let last = c[0];
  while (y < ey || (y === ey && m <= em)) { const k = `${y}-${String(m).padStart(2, '0')}`; last = by.get(k) ?? { ...last, m: k }; out.push(last); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

// ---------------------------------------------------------------- Security
export function SecuritySection({ r }: { r: Report }) {
  const P = r.poison;
  return <section className="sec" id="security"><div className="card warn-card">
    <div className="card-title">⚠ Address-poisoning attempts detected</div>
    <p>{P.length} transfer{P.length === 1 ? '' : 's'} involved lookalike addresses or fake zero-value transfers that imitate your own wallets or the addresses you send to. Scammers hope you'll copy the wrong address from your history.</p>
    <ul className="poison">{P.slice(0, 6).map((x, i) => <li key={i}><code>{short(x.from === x.mimics ? x.to : x.from)}</code> imitates <code>{short(x.mimics)}</code> · {x.token} · {x.ts ? dateFmt(x.ts) : ''} <a href={`${SCAN}/tx/${x.tx}`} target="_blank" rel="noreferrer noopener">view</a></li>)}</ul>
    <p className="muted small">Never copy an address from your transaction history. Use saved contacts, check every character, and send a tiny test first.</p>
  </div></section>;
}

// ---------------------------------------------------------------- 5. Accuracy
export function AccuracySection({ r, runInfo, wallets, onClear }: { r: Report; runInfo: { ms: number; requests: number } | null; wallets: { address: string; label: string }[]; onClear: () => void }) {
  const A = r.accuracy;
  const csv = () => {
    const cols = ['date', 'coin', 'amount', 'held', 'held_staked', 'cost_usd', 'held_cost_usd', 'paid_per_coin', 'market_per_coin', 'price_source', 'route', 'method', 'paid_with', 'wallet', 'block', 'tx'];
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.join(','), ...r.lots.map((l: any) => cols.map(c => esc(l[c])).join(','))];
    lines.push('', `# HEX stake interest earned so far (inside active stakes, $0 cost),${r.hex.accrued.toFixed(4)} HEX`);
    const b = new Blob([lines.join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `pulsebasis-lots-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  return <Sec id="accuracy" n={5} title="How accurate is this?" sub="Checks you can verify yourself, and everything we couldn't see.">
    <div className="card">
      <div className="kpis k3">
        <Kpi label="Priced at the exact moment" value={pct(A.pctExact, 1, false)} sub={`${A.exactN.toLocaleString()} of ${A.nAcq.toLocaleString()} buys used the pool price at that exact block or a stablecoin amount (${pct(A.usdPctExact, 1, false)} by dollars).`} tone="pos" />
        <Kpi label="Balances reconciled" value={<span data-testid="recon-status">{A.allOk ? '✓ All match' : 'Check gaps'}</span>} sub="We replayed every transaction and compared the ending balance of each coin with what's on-chain right now." tone={A.allOk ? 'pos' : 'neg'} />
        <Kpi label="Transactions replayed" value={A.txs.toLocaleString()} sub={runInfo ? `Done in ${(runInfo.ms / 1000).toFixed(1)}s with ${runInfo.requests.toLocaleString()} requests. Re-runs use your browser cache.` : ''} />
      </div>
      <div className="table-wrap"><table className="tbl recon" data-testid="recon">
        <thead><tr><th>Coin</th><th>Replayed</th><th>On-chain now</th><th>Difference</th><th></th></tr></thead>
        <tbody>{A.recon.map((x, i) => <tr key={i} className={x.ok ? 'ok' : 'bad'}><td>{x.label}</td><td>{qtyFull(x.replay)}</td><td>{qtyFull(x.chain)}</td><td>{Math.abs(x.diff) < 0.5 ? '0' : qty(x.diff)}{x.usd >= 0.01 ? ` (${usd(x.usd)})` : ''}</td><td>{x.ok ? <span className="check">✓</span> : <span className="cross">!</span>}</td></tr>)}</tbody>
      </table></div>
      <p className="muted small">Staked principal is compared with the HEX contract's own stake list. Tiny differences (under a few dollars) come from dust and rounding.</p>
    </div>
    <div className="two">
      <div className="card"><div className="card-title">Known gaps</div>
        <ul className="gaps">{A.gaps.map((g, i) => <li key={i} className={g.level}>{g.text}</li>)}{!A.gaps.length && <li>None found.</li>}</ul></div>
      <div className="card"><div className="card-title">How it's calculated</div>
        <ul className="method">
          <li><b>Every transaction</b> in your wallets is read from PulseChain: native PLS, internal transfers, token transfers and HEX stake events.</li>
          <li><b>Exact-block prices</b> come from PulseX v1/v2 pool reserves right before your transaction, priced in dollars through the deepest stablecoin pools. Thin pools fall back to that day's price.</li>
          <li><b>Average cost:</b> each coin has one cost pool. Selling or sending takes cost out proportionally; swapping carries the cost into the coin you receive.</li>
          <li><b>Free coins</b> (stake interest, farm rewards, bonuses, fork copies) are added at $0, which lowers your average.</li>
          <li><b>Sacrifice coins</b> (PLS, PLSX and PRVX credited for a sacrifice) carry what you sacrificed, valued in dollars on the day you sent it. If we can't find it and you don't enter it, they show as <i>cost not found</i>.</li>
          <li><b>Stakes:</b> staking moves HEX and its cost into the stake; ending returns principal plus interest with the same cost.</li>
        </ul></div>
    </div>
    <div className="card actions-card">
      <div className="card-title">Take it with you</div>
      <div className="btns"><button className="btn primary" onClick={csv} data-testid="csv">Download lots (CSV)</button><button className="btn ghost" onClick={() => window.print()}>Print / save as PDF</button><button className="btn ghost" onClick={onClear}>Clear my saved data</button></div>
      <p className="muted small">Wallets analyzed: {wallets.map(w => `${w.label} (${short(w.address)})`).join(', ')}</p>
    </div>
  </Sec>;
}
