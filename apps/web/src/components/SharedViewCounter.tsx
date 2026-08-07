'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Public visit counter, shared with the Apex hackathon app.
 *
 * Both landing pages show the same running total, so the count lives in one place —
 * the Apex deployment's Postgres — and this app reads it cross-origin. That endpoint
 * allowlists this origin explicitly.
 *
 * Counts a VISIT, not a page load: the session flag means moving between the two
 * projects, or refreshing, does not inflate the number. If the counter is unreachable
 * this renders nothing rather than a zero — an empty slot is honest, a wrong number
 * is not.
 */

const COUNTER_API = 'https://apex-hackathon-demo-production.up.railway.app/api/views';
const SESSION_KEY = 'apex-visit-counted';

function alreadyCounted(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markCounted() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* worst case this visitor is counted again next load */
  }
}

export function SharedViewCounter({
  wrapClassName,
  numberClassName,
  labelClassName,
}: {
  wrapClassName?: string;
  numberClassName?: string;
  labelClassName?: string;
}) {
  const [views, setViews] = useState<number | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const isNewVisit = !alreadyCounted();
    const request = isNewVisit
      ? fetch(COUNTER_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: 'vault-landing' }),
        })
      : fetch(COUNTER_API);

    request
      .then((r) => r.json())
      .then((d) => {
        if (typeof d?.views !== 'number') return;
        setViews(d.views);
        if (isNewVisit) markCounted();
      })
      .catch(() => {
        /* counter must never break the page */
      });
  }, []);

  if (views === null) return null;

  return (
    <div className={wrapClassName}>
      <span className={numberClassName}>{views.toLocaleString('en-US')}</span>
      <span className={labelClassName}>{views === 1 ? 'visit' : 'visits'}</span>
    </div>
  );
}
