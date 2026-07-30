export function Note() {
  return (
    <section id="note" className="landing-section landing-note">
      <div className="landing-section-inner">
        <div className="landing-note-card">
          <p className="landing-eyebrow">A quick heads-up</p>
          <p>
            This is an early, working demo &mdash; not a finished product. It&rsquo;s real and it&rsquo;s on-chain,
            but treat it like a first flight, not the final version.
          </p>
          <div className="landing-note-links">
            <a className="btn-text" href="https://youtu.be/RA7R3PjkLA0" target="_blank" rel="noreferrer">
              Demo video
            </a>
            <a className="btn-text" href="https://www.youtube.com/watch?v=epECZjT5so4" target="_blank" rel="noreferrer">
              Full presentation
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
