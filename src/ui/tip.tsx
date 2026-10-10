import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

// EIP-55 checksummed. Verified at build time in test/e2e.mjs; never edit by hand.
export const TIP_ADDRESS = '0xd8559fea66826f34D594dF1e5dF6aB5E61835436';

function Qr({ text, size = 96 }: { text: string; size?: number }) {
  const cells = useMemo(() => { const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(); const out: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) out.push(`M${c} ${r}h1v1h-1z`); return { n, d: out.join('') }; }, [text]);
  const pad = 2;
  return <svg className="tip-qr" width={size} height={size} viewBox={`${-pad} ${-pad} ${cells.n + pad * 2} ${cells.n + pad * 2}`} role="img" aria-label="QR code of the tip address" shapeRendering="crispEdges">
    <rect x={-pad} y={-pad} width={cells.n + pad * 2} height={cells.n + pad * 2} fill="#fff" /><path d={cells.d} fill="#0b0814" />
  </svg>;
}

export function TipJar() {
  const [copied, setCopied] = useState(false); const [qr, setQr] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 561px)').matches);
  const copy = async () => {
    try { await navigator.clipboard.writeText(TIP_ADDRESS); }
    catch { const t = document.createElement('textarea'); t.value = TIP_ADDRESS; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 2200);
  };
  return <aside className="tipjar" aria-label="Support PulseBasis" data-testid="tipjar">
    <div className="tip-main">
      <div className="tip-text"><span className="tip-heart" aria-hidden>♥</span> <b>Found this useful?</b> Tips in PLS / HEX / PLSX keep it running.</div>
      <div className="tip-addr-row">
        <code className="tip-addr" data-testid="tip-address">{TIP_ADDRESS}</code>
        <div className="tip-btns">
          <button className={'btn tip-copy' + (copied ? ' done' : '')} onClick={copy} data-testid="tip-copy">{copied ? 'Copied ✓' : 'Copy'}</button>
          <button className="btn tip-qrbtn" onClick={() => setQr(q => !q)} aria-expanded={qr} data-testid="tip-qr-toggle">QR</button>
        </div>
      </div>
      <div className="tip-note">PulseChain address. Always copy it from here, never from your transaction history: lookalike addresses are used for address poisoning.</div>
    </div>
    {qr && <Qr text={TIP_ADDRESS} />}
  </aside>;
}
