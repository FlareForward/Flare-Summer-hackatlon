'use client';

import { RangeGlyph } from './RangeGlyph';
import { useLandingVaultReadout } from './useLandingVaultReadout';

const QUESTIONS = [
  'Is my money still earning?',
  'Should I move it somewhere else?',
  'How much should I risk?',
  'Am I too early, or already too late?',
];

export function Problem() {
  const readout = useLandingVaultReadout();

  return (
    <section id="problem" className="landing-section landing-problem">
      <div className="landing-section-inner landing-split">
        <div className="landing-kicker">
          <p className="landing-eyebrow">The problem</p>
          <h2>Earning yield shouldn&rsquo;t feel like a part-time job.</h2>
          <p className="landing-lede">
            If you&rsquo;ve tried to make crypto grow, you know the drill: check the price, wonder if you should
            move your money, worry you waited too long, do it all again tomorrow. It&rsquo;s exhausting &mdash;
            and one bad guess can cost you.
          </p>
          <ul className="landing-questions">
            {QUESTIONS.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>

        <div className="landing-drift-card">
          <RangeGlyph variant={readout.inZone === false ? 'drifted' : 'centered'} />
          <p className="landing-caption">
            The shaded band is the zone where your money earns the most. Once it drifts out, it earns less &mdash;
            until someone (or something) moves it back.
          </p>
          <div className="landing-hud-rows">
            <div className="landing-hud-row">
              <span>Borrowed against your position</span>
              <span>{readout.borrowedLabel}</span>
            </div>
            <div className="landing-hud-row">
              <span>Loan-to-value (LTV)</span>
              <span>{readout.ltvLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
