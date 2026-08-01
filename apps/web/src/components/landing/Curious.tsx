const PROTOCOLS = [
  { title: 'Makes your XRP programmable', sub: 'FAssets' },
  { title: 'Lets your XRP wallet stay in control', sub: 'Smart Accounts' },
  { title: 'Manages the debt', sub: 'Lending & borrowing' },
  { title: 'Keeps your position balanced', sub: 'DEX & LP ranges' },
];

export function Curious() {
  return (
    <section id="curious" className="landing-section landing-curious">
      <div className="landing-section-inner">
        <div className="landing-kicker">
          <p className="landing-eyebrow">For the curious</p>
          <h2>One tap. Four tools working together.</h2>
          <p className="landing-lede">
            Behind that one tap, this connects several pieces of Flare&rsquo;s technology to do the work. You&rsquo;ll
            never have to touch any of it directly &mdash; here&rsquo;s what&rsquo;s actually happening.
          </p>
        </div>

        <div className="landing-protocol-grid">
          {PROTOCOLS.map((protocol) => (
            <div className="landing-protocol-card" key={protocol.sub}>
              <strong>{protocol.title}</strong>
              <span>{protocol.sub}</span>
            </div>
          ))}
        </div>

        <div className="landing-protocol-merge-arrow">&darr;</div>
        <div className="landing-protocol-vault">Your vault</div>
      </div>
    </section>
  );
}
