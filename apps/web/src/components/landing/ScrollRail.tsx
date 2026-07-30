'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const SECTIONS = [
  { id: 'hero', label: 'Start' },
  { id: 'problem', label: 'Problem' },
  { id: 'solution', label: 'Fix' },
  { id: 'start', label: 'Get in' },
  { id: 'curious', label: 'Details' },
  { id: 'why', label: 'Why' },
  { id: 'note', label: 'Note' },
];

export function ScrollRail() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [stickyVisible, setStickyVisible] = useState(false);
  const ticking = useRef(false);

  useEffect(() => {
    function update() {
      ticking.current = false;
      const mid = window.scrollY + window.innerHeight * 0.4;
      let next = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.offsetTop <= mid) next = section.id;
      }
      setActiveId(next);

      const hero = document.getElementById('hero');
      setStickyVisible(Boolean(hero) && window.scrollY > (hero?.offsetHeight ?? 0) * 0.7);
    }

    function onScroll() {
      if (!ticking.current) {
        ticking.current = true;
        window.requestAnimationFrame(update);
      }
    }

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <nav className="landing-rail" aria-label="Page sections">
        <div className="landing-rail-track">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`landing-rail-node ${activeId === section.id ? 'active' : ''}`}
              onClick={() => scrollToSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      <div className={`landing-stickybar ${stickyVisible ? 'visible' : ''}`}>
        <a className="landing-wordmark" href="#hero">
          <span className="landing-wordmark-mark">F</span>
          Flare Vault
        </a>
        <Link className="btn btn-primary btn-sm" href="/app">
          Start earning
        </Link>
      </div>
    </>
  );
}
