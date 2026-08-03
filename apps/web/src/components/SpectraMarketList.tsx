import type { SpectraMarket } from '@/lib/spectra/markets';

type Props = {
  markets: SpectraMarket[];
  selectedPool?: string;
  onSelect: (market: SpectraMarket) => void;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatApy(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatMaturity(maturityTs: number) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(maturityTs * 1000));
}

function daysToMaturity(maturityTs: number) {
  return Math.max(0, Math.ceil((maturityTs * 1000 - Date.now()) / 86_400_000));
}

function formatRoi(impliedApy: number, maturityTs: number) {
  const roi = (impliedApy * daysToMaturity(maturityTs)) / 365;
  return `${roi.toFixed(2)}%`;
}

export function SpectraMarketList({ markets, selectedPool, onSelect }: Props) {
  if (markets.length === 0) {
    return (
      <div className="spectra-empty">
        <strong>No eligible Spectra PT pools found.</strong>
        <p>Only active Flare pools with at least $100,000 liquidity are shown.</p>
      </div>
    );
  }

  return (
    <div className="spectra-market-list" aria-label="Eligible Spectra PT markets">
      {markets.map((market) => (
        <button
          type="button"
          key={`${market.pool}-${market.pt}`}
          className={selectedPool === market.pool ? 'spectra-market-card selected' : 'spectra-market-card'}
          onClick={() => onSelect(market)}
        >
          <div className="spectra-market-main">
            <div>
              <span className="position-label">Principal token</span>
              <strong>{market.symbol}</strong>
              <p>{market.name}</p>
            </div>
            <div className="spectra-market-actions">
              <span>Buy</span>
              <span>Sell</span>
            </div>
          </div>
          <div className="protocol-facts compact-facts">
            <div><span>Liquidity</span><strong>{formatUsd(market.liquidityUsd)}</strong></div>
            <div><span>Maturity</span><strong>{formatMaturity(market.maturityTs)}</strong></div>
            <div><span>ROI</span><strong>{formatRoi(market.impliedApy, market.maturityTs)}</strong></div>
            <div><span>Implied APY</span><strong>{formatApy(market.impliedApy)}</strong></div>
          </div>
        </button>
      ))}
    </div>
  );
}
