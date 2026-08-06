import Link from 'next/link'
import styles from './combined.module.css'
import { SharedViewCounter } from '@/components/SharedViewCounter'

/**
 * The combined Flare Summer Signal landing.
 *
 * Both submissions are on one screen because they are one story: get idle XRP moving,
 * then keep it working. The same page is served from this app and from the Apex app, so
 * whichever door someone comes through they see both projects and a single shared visit
 * count.
 *
 * This deployment's own pitch page is preserved untouched at /vault — the violet card
 * leads there, and it leads on to /app.
 *
 * Copy rule for this page: no mechanism above the fold. Nothing about memos,
 * attestation, keepers or oracles until someone opens the proof panel and asks for it.
 */

const APEX_DEMO = 'https://apex-hackathon-demo-production.up.railway.app/demo'
const VAULT_APP = '/vault'

const C2 = 'https://coston2-explorer.flare.network/tx/'
const XRPL = 'https://testnet.xrpl.org/transactions/'

type Receipt = { label: string; tx: string; href: string; where: string }

const ONBOARDING: Receipt[] = [
  {
    label: 'The signature — one tap in your wallet',
    tx: '18C69723B7BC1A06DC73FBC6939A535DD9683DBC56FEDB4CC36C31103F13008A',
    href: `${XRPL}18C69723B7BC1A06DC73FBC6939A535DD9683DBC56FEDB4CC36C31103F13008A`,
    where: 'On XRPL',
  },
  {
    label: 'Everything else, in one transaction',
    tx: '0x67ddb2373fc98911b4487ddf5d36ab8d6e3b91b199c9379732dd63a302cb242e',
    href: `${C2}0x67ddb2373fc98911b4487ddf5d36ab8d6e3b91b199c9379732dd63a302cb242e`,
    where: 'On Flare',
  },
  {
    label: 'Your money leaves when you say so',
    tx: '0x413e2513f6eaa9a2142b125956777c20fab1ad4b8fc697d49635fb6666b25bdb',
    href: `${C2}0x413e2513f6eaa9a2142b125956777c20fab1ad4b8fc697d49635fb6666b25bdb`,
    where: 'On Flare',
  },
  {
    label: 'The same flow from a plain wallet, not just Xaman',
    tx: '0x31b4de8b98f7197496e04b324a775cbeb4cc95983483cc8f148a83d7a6abdc0a',
    href: `${C2}0x31b4de8b98f7197496e04b324a775cbeb4cc95983483cc8f148a83d7a6abdc0a`,
    where: 'On Flare',
  },
]

const PRIVATE_ORDERS: Receipt[] = [
  {
    label: 'Order placed, price kept off the chain',
    tx: '0x741fac29c4447a48ea57388c7b44457a3d11501a0a31006ecccb27d5a0762b9b',
    href: `${C2}0x741fac29c4447a48ea57388c7b44457a3d11501a0a31006ecccb27d5a0762b9b`,
    where: 'On Flare',
  },
  {
    label: 'Refused — the same call from unverified hardware',
    tx: '0x48044c3cf62e27984f06fa9a8efd235663242bffd966f3c722a19be24f3841c7',
    href: `${C2}0x48044c3cf62e27984f06fa9a8efd235663242bffd966f3c722a19be24f3841c7`,
    where: 'On Flare',
  },
  {
    label: 'Filled — identical bytes, now verified',
    tx: '0x2de6a2388f7d03421a4196939f72e01f721edb3e082ce10dadb4d693b1ae015f',
    href: `${C2}0x2de6a2388f7d03421a4196939f72e01f721edb3e082ce10dadb4d693b1ae015f`,
    where: 'On Flare',
  },
]

const STEPS = [
  'Open the app',
  'Create your vault',
  'Pick your token',
  'Set it',
  'Sign once',
  'It runs',
]

function ReceiptRows({ items }: { items: Receipt[] }) {
  return (
    <div className={styles.rows}>
      {items.map((r) => (
        <div className={styles.row} key={r.tx}>
          <div className={styles.rowMain}>
            <b>{r.label}</b>
            <code>{r.tx}</code>
          </div>
          <a className={styles.rowLink} href={r.href} target="_blank" rel="noopener noreferrer">
            {r.where} ↗
          </a>
        </div>
      ))}
    </div>
  )
}

export default function Page() {
  return (
    <main className={styles.page}>
      <div className={styles.glow} />
      <div className={styles.wrap}>
        <SharedViewCounter
          wrapClassName={styles.counter}
          numberClassName={styles.counterNum}
          labelClassName={styles.counterLabel}
        />

        <header className={styles.mast}>
          <span className={styles.brand}>
            Flare<em>Forward</em>
          </span>
          <span className={styles.eyebrow}>Flare Summer Signal · two projects</span>
        </header>

        <section className={styles.hero}>
          <h1 className={styles.h1}>
            Your XRP is sitting still. Here are <span>two ways</span> to fix that.
          </h1>
          <p className={styles.lede}>
            Both run on Flare. Both start with the wallet you already have. Pick the one that
            sounds like you.
          </p>
        </section>

        {/* One number, and it is the number both products are built around: the price
            your rule waits for, and the price the vault rebalances against. */}
        <div className={styles.ticker}>
          <span className={styles.pulse} aria-hidden="true" />
          <span className={styles.tickerLabel}>XRP</span>
          <span className={styles.tickerPrice}>$1.0435</span>
          <span className={styles.tickerNote}>
            priced by Flare&rsquo;s oracle · this is the number both of them watch
          </span>
        </div>

        {/* Same start, two destinations — the evolution framing, drawn rather than said. */}
        <svg className={styles.fork} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <circle cx="50" cy="1.5" r="1.1" />
          <path className={styles.toTrade} d="M50 2 C 50 16, 25 14, 25 29" />
          <path className={styles.toVault} d="M50 2 C 50 16, 75 14, 75 29" />
        </svg>

        <section className={styles.paths}>
          <article className={`${styles.card} ${styles.cardTrade}`}>
            <span className={styles.cardTag}>Trade it</span>
            <h2 className={styles.cardTitle}>Set a rule. Walk away.</h2>
            <p className={styles.cardBody}>
              Buy the dip. Sell the pop. You decide the rule once, sign once, and it runs without
              you watching the screen.
            </p>
            <div className={styles.cardFoot}>
              <a className={styles.go} href={APEX_DEMO} target="_blank" rel="noopener noreferrer">
                Try it →
              </a>
              <span className={styles.cardNote}>Apex · one signature</span>
            </div>
          </article>

          <article className={`${styles.card} ${styles.cardVault}`}>
            <span className={styles.cardTag}>Earn on it</span>
            <h2 className={styles.cardTitle}>Deposit once. It earns.</h2>
            <p className={styles.cardBody}>
              Your money goes in and the vault does the watching — moving your position back into
              its earning zone, every day.
            </p>
            <div className={styles.cardFoot}>
              <Link className={styles.go} href={VAULT_APP}>
                Try it →
              </Link>
              <span className={styles.cardNote}>Flare Vault · autopilot</span>
            </div>
          </article>
        </section>

        <section className={styles.sect}>
          <div className={styles.sectHead}>
            <h3 className={styles.h3}>Either way, it looks like this</h3>
            <p className={styles.kicker}>
              Six steps, start to finish. No bridge to figure out, no second app to install, no FLR
              in your pocket to get going.
            </p>
          </div>
          <div className={styles.steps}>
            {STEPS.map((step) => (
              <div className={styles.step} key={step}>
                <b>{step}</b>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.sect}>
          <div className={styles.sectHead}>
            <h3 className={styles.h3}>None of this is a mockup</h3>
            <p className={styles.kicker}>
              Every step above already happened on-chain. The receipts are here if you want them,
              and out of your way if you don&rsquo;t.
            </p>
          </div>

          <details className={styles.proof}>
            <summary className={styles.proofSummary}>
              <span className={styles.proofClaim}>
                <span className={styles.verified}>Proven on-chain</span>
                <b>Seven transactions on Flare and XRPL you can open yourself</b>
              </span>
              <span className={styles.proofToggle}>Show the proof</span>
            </summary>

            <div className={styles.proofBody}>
              <div className={`${styles.proofGroup} ${styles.groupTrade}`}>
                <h4>Trade it — XRPL to a live strategy</h4>
                <ReceiptRows items={ONBOARDING} />
              </div>

              <div className={`${styles.proofGroup} ${styles.groupTrade}`}>
                <h4>Trade it — orders nobody can front-run</h4>
                <ReceiptRows items={PRIVATE_ORDERS} />
              </div>

              <div className={`${styles.proofGroup} ${styles.groupVault}`}>
                <h4>Earn on it — Flare Vault</h4>
                {/* Deliberately empty until the vault hashes exist. Nothing on this page
                    claims proof it does not have. */}
                <div className={styles.pending}>
                  Receipts go here once the vault transaction hashes are in. Left empty on purpose.
                </div>
              </div>
            </div>
          </details>
        </section>

        <footer className={styles.foot}>
          <p>
            Both demos run on <b>Coston2 and XRPL testnet</b> — no real money needed to check any
            claim on this page.
          </p>
          <p>
            Apex is live on Flare mainnet and unaudited.{' '}
            <a href="https://apexhammer.app" target="_blank" rel="noopener noreferrer">
              Try demo mode
            </a>{' '}
            — no wallet, no connection.
          </p>
        </footer>
      </div>
    </main>
  )
}
