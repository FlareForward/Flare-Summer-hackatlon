import '../landing.css';
import { ScrollRail } from '@/components/landing/ScrollRail';
import { Hero } from '@/components/landing/Hero';
import { Problem } from '@/components/landing/Problem';
import { Solution } from '@/components/landing/Solution';
import { Start } from '@/components/landing/Start';
import { Curious } from '@/components/landing/Curious';
import { Why } from '@/components/landing/Why';
import { Note } from '@/components/landing/Note';
import { Final } from '@/components/landing/Final';
import { LandingVaultReadoutProvider } from '@/components/landing/useLandingVaultReadout';

export default function LandingPage() {
  return (
    <LandingVaultReadoutProvider>
      <div className="landing-page">
        <ScrollRail />
        <div className="landing-body">
        <Hero />
        <Problem />
        <Solution />
        <Start />
        <Curious />
        <Why />
        <Note />
        <Final />
        <footer className="landing-footer">
          <span>Flare Vault Gateway &middot; hackathon demo</span>
          <span>Built on Flare</span>
        </footer>
        </div>
      </div>
    </LandingVaultReadoutProvider>
  );
}
