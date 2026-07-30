const STEPS = [
  { mark: '1', title: 'Watches the market', body: 'Checks prices and conditions around the clock, not just when you remember to look.' },
  { mark: '2', title: 'Follows fixed rules', body: 'The same rules decide when to act — no panic, no guessing, no bad days.' },
  { mark: '3', title: 'Moves your money', body: 'Shifts your position back into its earning zone automatically when it needs to.' },
];

export function Solution() {
  return (
    <section id="solution" className="landing-section landing-solution">
      <div className="landing-section-inner landing-split reverse">
        <div className="landing-flow">
          {STEPS.map((step, index) => (
            <div key={step.mark}>
              <div className="landing-flow-step">
                <span className="landing-mark">{step.mark}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </div>
              {index < STEPS.length - 1 ? <div className="landing-flow-connector" /> : null}
            </div>
          ))}
        </div>

        <div className="landing-kicker">
          <p className="landing-eyebrow">How this fixes it</p>
          <h2>We taught the computer to make the calls.</h2>
          <p className="landing-lede">
            Instead of you watching charts all day, a set of rules does it for you &mdash; deciding when to move
            your money and how much risk to take. Same rules, every time, so the strategy is easy to trust and
            easy to test.
          </p>
        </div>
      </div>
    </section>
  );
}
