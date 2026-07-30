import Link from 'next/link';

export function Final() {
  return (
    <section id="final" className="landing-section landing-final">
      <div className="landing-section-inner">
        <h2>Ready to put your XRP to work?</h2>
        <p className="landing-lede">Connect the wallet you already use and start in under a minute.</p>
        <Link className="btn btn-primary" href="/app">
          Start earning
        </Link>
      </div>
    </section>
  );
}
