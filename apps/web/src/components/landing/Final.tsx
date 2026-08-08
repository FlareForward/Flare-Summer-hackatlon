import Link from 'next/link';

export function Final() {
  return (
    <section id="final" className="landing-section landing-final">
      <div className="landing-section-inner">
        <h2>Ready to put your XRP to work?</h2>
        <p className="landing-lede">Connect the wallet you already use and choose a managed position or a fixed-term maturity.</p>
        <Link className="btn btn-primary" href="/app">
          Explore both yield paths
        </Link>
      </div>
    </section>
  );
}
