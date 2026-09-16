import React from 'react';
import { ArrowRight } from 'lucide-react';
import { COPY } from '../content/copy';
import { StudentGapPosts } from './StudentGapPosts';

interface HeroBannerProps {
  onGetStarted?: () => void;
  onOpenHowItWorks?: () => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ onGetStarted, onOpenHowItWorks }) => {
  const handleGetStarted = () => {
    if (onGetStarted) {
      onGetStarted();
      return;
    }
    const dropzone =
      document.getElementById('responsive-choice-section') ||
      document.getElementById('responsive-section-intro') ||
      document.getElementById('responsive-add-title') ||
      document.getElementById('upload-dropzone') ||
      document.getElementById('step-add-courses-container');
    dropzone?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section
      className="w-full bg-paper border-b border-line px-5 sm:px-6"
      aria-labelledby="hero-title"
      id="homepage-hero-section"
    >
      <div className="max-w-6xl mx-auto px-0 py-6 sm:py-8 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 xl:gap-12 items-center">
          <div className="lg:col-span-7 xl:col-span-6">
            <h1
              id="hero-title"
              className="font-sans text-[1.85rem] sm:text-4xl lg:text-[2.65rem] xl:text-[3rem] font-extrabold text-ink tracking-[-0.035em] leading-[1.1] text-balance max-w-[20ch]"
            >
              {COPY.hero.title}
            </h1>

            <div className="mt-4 sm:mt-5 space-y-2 text-sm sm:text-base text-text-secondary leading-relaxed max-w-xl">
              <p>
                {COPY.hero.line1}
                <br />
                {COPY.hero.line2}
              </p>
              <p className="text-ink font-semibold">
                {COPY.hero.resolution}
              </p>
            </div>

            <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-md">
              <button
                type="button"
                id="hero-btn-primary"
                onClick={handleGetStarted}
                className="min-h-[52px] px-6 rounded-lg bg-ink text-white text-base font-bold inline-flex items-center justify-center gap-2 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition active:translate-y-px cursor-pointer shadow-2xs"
              >
                <span>{COPY.hero.primary}</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>

              {onOpenHowItWorks && (
                <button
                  type="button"
                  id="hero-btn-how-it-works"
                  onClick={onOpenHowItWorks}
                  aria-label="How it works"
                  className="min-h-[44px] px-4 rounded-lg text-ink font-semibold text-sm inline-flex items-center justify-center gap-1.5 hover:bg-mist/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition cursor-pointer hover:underline underline-offset-4"
                >
                  <span>{COPY.hero.guide || 'How it works'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 xl:col-span-6 mt-4 sm:mt-5 lg:mt-0 flex justify-center lg:justify-end w-full">
            <StudentGapPosts />
          </div>
        </div>
      </div>
    </section>
  );
};
