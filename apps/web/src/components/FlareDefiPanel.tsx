import { useEffect, useState } from 'react';
import { SpectraMarketList } from '@/components/SpectraMarketList';
import { SpectraTradePanel } from '@/components/SpectraTradePanel';
import type { SpectraMarket } from '@/lib/spectra/markets';

export function FlareDefiPanel() {
  const [markets, setMarkets] = useState<SpectraMarket[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<SpectraMarket | undefined>();
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [marketError, setMarketError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadMarkets() {
      setLoadingMarkets(true);
      setMarketError('');
      try {
        const response = await fetch('/api/spectra/markets', { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(data?.markets)) {
          throw new Error(data?.error || 'Unable to load Spectra markets.');
        }
        if (cancelled) return;
        setMarkets(data.markets);
        setSelectedMarket((current) => current ?? data.markets[0]);
      } catch (error) {
        if (cancelled) return;
        setMarketError(error instanceof Error ? error.message : 'Unable to load Spectra markets.');
        setMarkets([]);
        setSelectedMarket(undefined);
      } finally {
        if (!cancelled) setLoadingMarkets(false);
      }
    }

    void loadMarkets();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <section className="hero defi-hero">
        <div>
          <p className="eyebrow">Flare DeFi</p>
          <h2>Use established Flare protocols directly.</h2>
          <p className="hero-description">
            Discover opportunities and authorize each action from your Smart Account. Your funds interact directly with protocols already live on Flare&mdash;not with one of our experimental vaults.
          </p>
        </div>
        <div className="hero-stats">
          <div><span>Custody</span><strong>Your account</strong></div>
          <div><span>Execution</span><strong>User directed</strong></div>
          <div><span>Automation</span><strong>None</strong></div>
        </div>
      </section>

      <aside className="product-notice defi-notice" aria-label="Direct protocol access information">
        <strong>Direct protocol interaction</strong>
        <span>Listed protocols are live on Flare and have published audits. Those audits apply to the respective protocol contracts, not to this interface or your transaction choices.</span>
      </aside>

      <section className="strategy-panel panel defi-marketplace">
        <div className="section-heading">
          <div><p className="eyebrow">Protocol marketplace</p><h2>Choose what you want to do</h2></div>
          <p>No keepers, bots, automatic entries, or automatic exits.</p>
        </div>

        <article className="protocol-card" aria-labelledby="spectra-marketplace-title">
          <div className="protocol-card-main">
            <div className="protocol-monogram" aria-hidden="true">S</div>
            <div>
              <div className="pill-row">
                <span className="pill protocol-pill">Live on Flare</span>
                <span className="pill muted-pill">Audited protocol</span>
                <span className="pill muted-pill">User directed</span>
              </div>
              <h3 id="spectra-marketplace-title">Spectra PT marketplace</h3>
              <p>Buy or sell Principal Tokens through eligible Spectra pools. You choose the market and amount, review a fresh on-chain quote, and approve every transaction.</p>
            </div>
            <div className="protocol-status"><span>Access model</span><strong>Direct</strong></div>
          </div>
          <div className="protocol-facts" aria-label="Spectra marketplace safeguards">
            <div><span>Market filter</span><strong>$100k+ liquidity</strong></div>
            <div><span>Pool usage</span><strong>Maximum 1%</strong></div>
            <div><span>Price impact</span><strong>Maximum 0.50%</strong></div>
            <div><span>Authorization</span><strong>XRPL signature</strong></div>
          </div>
          <div className="protocol-card-footer">
            <p>PT trading only. No LP management, automated trading, or YT trading.</p>
            <span className="availability-chip">Marketplace active</span>
          </div>
        </article>
      </section>

      <section className="strategy-panel panel spectra-marketplace-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Spectra markets</p>
            <h2>Principal Token marketplace</h2>
          </div>
          <p>Only active Flare pools with at least $100,000 liquidity are displayed.</p>
        </div>
        {loadingMarkets ? <p className="status-line">Loading eligible Spectra pools...</p> : null}
        {marketError ? <p className="status-line warning">{marketError}</p> : null}
        <SpectraMarketList markets={markets} selectedPool={selectedMarket?.pool} onSelect={setSelectedMarket} />
      </section>

      <SpectraTradePanel market={selectedMarket} />
    </>
  );
}
