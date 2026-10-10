// Official coin logos, self-hosted from the PulseX token image set (tokens.app.pulsex.com/images/tokens/<address>.png).
const SRC: Record<string, string> = { HEX: 'hex', PHEX: 'hex', EHEX: 'ehex', PLS: 'pls', WPLS: 'pls', PLSX: 'plsx', INC: 'inc', PRVX: 'prvx' };
export const hasLogo = (c: string) => c.toUpperCase() in SRC;
export function CoinIcon({ coin, size = 20, className = '' }: { coin: string; size?: number; className?: string }) {
  const k = SRC[coin.toUpperCase()];
  if (!k) return <span className={'coin-dot ' + className} style={{ width: size * 0.5, height: size * 0.5 }} />;
  return <img className={'coin-ico ' + className} src={`${import.meta.env.BASE_URL}coins/${k}.png`} width={size} height={size} alt="" aria-hidden="true" decoding="async" loading="lazy" draggable={false} />;
}
