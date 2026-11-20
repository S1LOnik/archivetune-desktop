import { useEffect, useState, type RefObject } from 'react';
import { ArrowUp } from 'lucide-react';
import { useInterfaceMotionReduced } from '../lib/useInterfaceMotion';

export default function HomeSectionNav({ introRef, sections }: {
  introRef: RefObject<HTMLDivElement>;
  sections: { id: string; label: string }[];
}) {
  const [docked, setDocked] = useState(false);
  const reducedMotion = useInterfaceMotionReduced();

  useEffect(() => {
    const intro = introRef.current;
    const scrollport = intro?.closest('main');
    if (!intro || !scrollport) return;

    const observer = new IntersectionObserver(([entry]) => {
      const introAboveViewport = entry.rootBounds && entry.boundingClientRect.bottom <= entry.rootBounds.top;
      setDocked(!entry.isIntersecting && Boolean(introAboveViewport));
    }, { root: scrollport });
    observer.observe(intro);
    return () => observer.disconnect();
  }, [introRef]);

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
  };

  const backToTop = () => {
    document.getElementById('home-title')?.focus({ preventScroll: true });
    introRef.current?.closest('main')?.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
  };

  return (
    <nav
      className="home-section-nav"
      data-docked={docked}
      aria-label="Разделы главной"
      onKeyDown={(event) => {
        if (event.code === 'Space') event.stopPropagation();
      }}
    >
      <div className="home-section-nav-links">
        {sections.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => scrollToSection(id)}>
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="home-section-nav-top"
        onClick={backToTop}
        title="В начало главной"
        aria-label="В начало главной"
      >
        <ArrowUp size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
