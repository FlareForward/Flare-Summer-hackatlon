'use client';

import { RiskManagementGlyph } from './RiskManagementGlyph';
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
          <RiskManagementGlyph />
          <p className="landing-caption">
            Risk is managed continuously. The vault monitors the loan-to-value ratio and rebalances before it reaches
            the configured borrowing limit.
          </p>
          <div className="landing-hud-rows">
            <div className="landing-hud-row">
              <span>Borrowed against your position</span>
              <span>{readout.borrowedLabel}</span>
            </div>
            <div className="landing-hud-row">
              <span>Loan-to-value (LTV)</span>
              <span>{readout.ltvLabel} / {readout.maxLtvLabel} max</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
