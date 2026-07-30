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
            <span className="landing-wallet-logo">
              <img src="/images/xaman.avif" alt="" width={20} height={20} />
            </span>
            Xaman
          </span>
          <span className="landing-wallet-chip">
            <span className="landing-wallet-logo">
              <img src="/images/dcent.svg" alt="" width={44} height={13} />
            </span>
            D&rsquo;CENT
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
