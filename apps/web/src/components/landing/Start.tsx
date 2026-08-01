import Link from 'next/link';

export function Start() {
  return (
    <section id="start" className="landing-section landing-start">
      <div className="landing-section-inner landing-kicker">
        <p className="landing-eyebrow">Getting started</p>
        <h2>Use the wallet you already have.</h2>
        <p className="landing-lede">
          No new app to learn, no new password to remember. Connect a wallet many XRP holders already carry, and
          you&rsquo;re in with one tap.
        </p>
        <div className="landing-wallet-row">
          <span className="landing-wallet-chip">
            <a
              className="landing-wallet-logo"
              href="http://xaman.app/"
              target="_blank"
              rel="noreferrer"
              aria-label="Visit Xaman"
            >
              <img src="/images/xaman.avif" alt="" width={24} height={24} />
            </a>
            Xaman
          </span>
          <span className="landing-wallet-chip">
            <a
              className="landing-wallet-logo"
              href="https://www.dcentwallet.com/"
              target="_blank"
              rel="noreferrer"
              aria-label="Visit D'CENT Wallet"
            >
              <img src="/images/dcent.svg" alt="" width={40} height={12} />
            </a>
            D&rsquo;CENT
          </span>
          <span className="landing-wallet-chip">
            <a
              className="landing-wallet-logo"
              href="https://bifrostwallet.com/"
              target="_blank"
              rel="noreferrer"
              aria-label="Visit Bifrost Wallet"
            >
              {/* White-only wordmark: inverted so it reads on the light logo tile. */}
              <img className="invert-mark" src="/images/bifrost.png" alt="" width={40} height={8} />
            </a>
            Bifrost
          </span>
        </div>
        <div className="landing-start-cta">
          <Link className="btn btn-primary" href="/app">
            Connect &amp; start earning
          </Link>
        </div>
      </div>
    </section>
  );
}
