import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bike,
  Car,
  CheckCircle2,
  MapPin,
  MessageSquare,
  Mic,
  Navigation,
  ShieldCheck,
} from 'lucide-react';
import { ShineCabLogo } from './ShineCabLogo';

interface SplashAndOnboardingProps {
  onComplete: (target: 'get_started' | 'login') => void;
}

const AUTO_SCROLL_INTERVAL_MS = 3500;

const SLIDES = [
  {
    id: 'book',
    badge: 'Fast pickup across your city',
    title: 'Book Bike, Auto & Cab Easily.',
    description:
      'Pick your pickup and drop on the map to get instant distance-based fares across Bike, Auto, and Cab with zero surprises.',
    icon: MapPin,
    highlightCards: [
      { label: 'Bike', tag: 'Quick', icon: Bike },
      { label: 'Auto', tag: 'Daily', icon: Navigation },
      { label: 'Cab', tag: 'AC Ride', icon: Car },
    ],
  },
  {
    id: 'track',
    badge: 'Live GPS & Captain Chat',
    title: 'Track Your Driver Live on Map.',
    description:
      'Follow real-time driver GPS movement from pickup to drop, verify your 4-digit ride OTP, and chat or call your captain directly.',
    icon: Navigation,
    highlightCards: [
      { label: 'Live Map', tag: 'GPS ETA', icon: MapPin },
      { label: '4-Digit OTP', tag: 'Verified', icon: CheckCircle2 },
      { label: 'Driver Chat', tag: 'Call & Msg', icon: MessageSquare },
    ],
  },
  {
    id: 'safe',
    badge: '24×7 Safety & Shine AI',
    title: 'Travel Safely in Any Language.',
    description:
      'Every ride is backed by verified captains, live trip sharing, instant SOS alerts, and 1-second Shine voice support in Indian languages.',
    icon: ShieldCheck,
    highlightCards: [
      { label: 'SOS Shield', tag: '24×7 Ops', icon: ShieldCheck },
      { label: 'Shine Bot', tag: 'Voice AI', icon: Mic },
      { label: 'All Languages', tag: 'HI · EN +', icon: MessageSquare },
    ],
  },
];

export const SplashScreen: React.FC<{ onFinished: () => void }> = ({ onFinished }) => {
  useEffect(() => {
    const timer = setTimeout(onFinished, 1400);
    return () => clearTimeout(timer);
  }, [onFinished]);

  return (
    <div className="flex-1 bg-[#111111] text-white flex flex-col items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6">
        <ShineCabLogo variant="dark" size="xl" showWordmark={false} animated />
        <div className="text-center space-y-1.5">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
            SHINE <span className="text-[#FFC928]">CAB</span>
          </h1>
          <p className="text-sm text-neutral-400">Bike · Auto · Cab Mobility</p>
        </div>
        <div className="w-40 h-1 bg-neutral-800 rounded-full overflow-hidden">
          <div className="h-full bg-[#FFC928] w-2/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full" />
        </div>
      </div>
    </div>
  );
};

export const OnboardingScreen: React.FC<SplashAndOnboardingProps> = ({ onComplete }) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [userInteracting, setUserInteracting] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startScrollLeft: number;
  }>({ active: false, startX: 0, startScrollLeft: 0 });
  const resumeTimerRef = useRef<number | null>(null);

  const pauseTemporarily = useCallback(() => {
    setUserInteracting(true);
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setUserInteracting(false);
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  const scrollToSlide = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const el = scrollerRef.current;
    const bounded = ((index % SLIDES.length) + SLIDES.length) % SLIDES.length;
    setSlideIndex(bounded);
    if (el) {
      el.scrollTo({
        left: bounded * el.clientWidth,
        behavior,
      });
    }
  }, []);

  // Auto-scroll seamlessly across all 3 onboarding pages
  useEffect(() => {
    if (userInteracting) return;

    const timer = window.setInterval(() => {
      setSlideIndex((prev) => {
        const next = (prev + 1) % SLIDES.length;
        const el = scrollerRef.current;
        if (el) {
          el.scrollTo({
            left: next * el.clientWidth,
            behavior: 'smooth',
          });
        }
        return next;
      });
    }, AUTO_SCROLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [userInteracting]);

  const handleHorizontalScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const nextIdx = Math.round(el.scrollLeft / el.clientWidth);
    if (nextIdx >= 0 && nextIdx < SLIDES.length && nextIdx !== slideIndex) {
      setSlideIndex(nextIdx);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      pauseTemporarily();
      return;
    }
    const el = scrollerRef.current;
    if (!el) return;
    pauseTemporarily();
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startScrollLeft: el.scrollLeft,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    const el = scrollerRef.current;
    if (!el) return;
    const dx = e.clientX - dragStateRef.current.startX;
    el.scrollLeft = dragStateRef.current.startScrollLeft - dx;
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.active) return;
    dragStateRef.current.active = false;
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const dx = e.clientX - dragStateRef.current.startX;
    let target = Math.round(el.scrollLeft / el.clientWidth);
    if (Math.abs(dx) > 36) {
      target =
        dx < 0
          ? Math.min(SLIDES.length - 1, slideIndex + 1)
          : Math.max(0, slideIndex - 1);
    }
    scrollToSlide(target, 'smooth');
  };

  return (
    <div className="flex-1 min-h-0 bg-[#111111] text-white flex flex-col justify-between overflow-hidden">
      {/* Top Bar: Clean Brand Logo Only */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-2 shrink-0">
        <ShineCabLogo variant="dark" size="sm" />
        <span className="text-[11px] font-medium text-neutral-400">Swipe left or right</span>
      </div>

      {/* Full-Height Black Background Horizontal Carousel (Auto + Manual Swipe/Scroll) */}
      <div
        ref={scrollerRef}
        onScroll={handleHorizontalScroll}
        onTouchStart={pauseTemporarily}
        onWheel={pauseTemporarily}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        role="region"
        aria-label="Onboarding pages"
        className="flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory no-scrollbar touch-pan-x select-none cursor-grab active:cursor-grabbing"
      >
        {SLIDES.map((slide, idx) => {
          const SlideIcon = slide.icon;
          return (
            <div
              key={slide.id}
              className="w-full shrink-0 snap-center snap-always px-6 py-6 flex flex-col justify-center gap-6"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="w-14 h-14 rounded-2xl bg-[#FFC928] text-[#111111] flex items-center justify-center shrink-0 shadow-md">
                  <SlideIcon className="w-7 h-7" />
                </div>
                <span className="font-mono-num text-xs font-bold text-neutral-400">
                  0{idx + 1} / 0{SLIDES.length}
                </span>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-[#FFC928] tracking-wide uppercase">
                  {slide.badge}
                </p>
                <h2 className="font-display text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
                  {slide.title}
                </h2>
                <p className="text-sm text-neutral-300 leading-relaxed">{slide.description}</p>
              </div>

              {/* 3 Highlight Preview Cards */}
              <div className="grid grid-cols-3 gap-2.5 pt-2">
                {slide.highlightCards.map((item) => {
                  const CardIcon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="rounded-2xl bg-white/8 border border-white/10 p-3 flex flex-col gap-1.5"
                    >
                      <CardIcon className="w-4 h-4 text-[#FFC928]" />
                      <p className="text-xs font-bold text-white truncate">{item.label}</p>
                      <p className="text-[11px] text-neutral-400 font-mono-num truncate">
                        {item.tag}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Pagination Dots Strip (Black Background, No Arrow Button) */}
      <div className="px-6 pb-8 pt-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2">
          {SLIDES.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                pauseTemporarily();
                scrollToSlide(idx, 'smooth');
              }}
              aria-label={`Go to onboarding page ${idx + 1}`}
              className={`h-2 rounded-full transition-all cursor-pointer overflow-hidden ${
                idx === slideIndex
                  ? 'w-10 bg-neutral-700'
                  : 'w-2.5 bg-neutral-700 hover:bg-neutral-500'
              }`}
            >
              {idx === slideIndex && (
                <span className="block h-full w-full bg-[#FFC928] rounded-full" />
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onComplete('get_started')}
          className="min-h-[42px] px-5 rounded-full bg-[#FFC928] text-xs font-bold text-[#111111] hover:brightness-95 transition cursor-pointer whitespace-nowrap"
        >
          Skip
        </button>
      </div>
    </div>
  );
};
