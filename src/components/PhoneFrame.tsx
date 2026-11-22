import React, { useEffect, useState } from 'react';
import { Wifi, BatteryCharging, Signal } from 'lucide-react';

interface PhoneFrameProps {
  children: React.ReactNode;
  darkScreen?: boolean;
  topBarDark?: boolean;
  bottomBarDark?: boolean;
}

/**
 * Unified Android Phone Screen Layout:
 * - On real Android mobile viewports (< 450px): fills 100% width x 100dvh cleanly with
 *   native safe-area top & bottom spacing (below status bar, above nav buttons).
 * - On wider viewports (>= 450px): renders every page inside a centered Android smartphone
 *   shell (404px wide, rounded bezel, punch-hole camera + status bar, bottom gesture bar).
 * - Uses `[transform:translateZ(0)]` across all sizes so `fixed` bottom sheets/modals
 *   stay locked cleanly inside the Android phone screen.
 */
export const PhoneFrame: React.FC<PhoneFrameProps> = ({
  children,
  darkScreen = false,
  topBarDark,
  bottomBarDark,
}) => {
  const isTopDark = topBarDark ?? darkScreen;
  const isBottomDark = bottomBarDark ?? darkScreen;

  const [nowLabel, setNowLabel] = useState(() =>
    new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowLabel(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      );
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`min-h-dvh w-full overflow-x-hidden ${
        darkScreen || isTopDark ? 'bg-[#1E1E1E]' : 'bg-[#F7F8FA]'
      } min-[450px]:bg-[#0B0C10] min-[450px]:flex min-[450px]:items-center min-[450px]:justify-center min-[450px]:p-3`}
    >
      <div
        className={`w-full h-dvh min-[450px]:w-[404px] min-[450px]:max-w-full min-[450px]:h-[min(856px,calc(100dvh-1.5rem))] min-[450px]:rounded-[38px] min-[450px]:border-[6px] min-[450px]:border-[#262830] min-[450px]:shadow-[0_24px_72px_rgba(0,0,0,0.65)] [transform:translateZ(0)] overflow-hidden relative flex flex-col pt-[max(env(safe-area-inset-top),28px)] pb-[max(env(safe-area-inset-bottom),12px)] min-[450px]:pt-0 min-[450px]:pb-0 ${
          darkScreen ? 'bg-[#1E1E1E] text-white' : isTopDark ? 'bg-[#1E1E1E] text-[#111111]' : 'bg-[#F7F8FA] text-[#111111]'
        }`}
      >
        {/* Android Status Bar & Punch-Hole Camera (shown on desktop/tablet preview frame) */}
        <div
          aria-hidden="true"
          className={`hidden min-[450px]:flex h-8 px-5 items-center justify-between text-[11px] font-mono-num font-semibold shrink-0 relative select-none ${
            isTopDark ? 'bg-[#1E1E1E] text-neutral-200' : 'bg-white text-[#111111]'
          }`}
        >
          <span>{nowLabel}</span>
          <span className="w-3.5 h-3.5 rounded-full bg-[#111111] border border-neutral-700 absolute left-1/2 -translate-x-1/2 top-2 shadow-inner" />
          <div className="flex items-center gap-1.5">
            <Signal className="w-3 h-3" />
            <Wifi className="w-3 h-3" />
            <BatteryCharging className="w-3.5 h-3.5" />
          </div>
        </div>

        <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden relative">
          {children}
        </div>

        {/* Android Bottom Gesture Navigation Bar (shown on desktop/tablet preview frame) */}
        <div
          aria-hidden="true"
          className={`hidden min-[450px]:flex h-4 items-center justify-center shrink-0 select-none ${
            isBottomDark ? 'bg-[#1E1E1E]' : 'bg-white'
          }`}
        >
          <span
            className={`w-28 h-1 rounded-full ${
              isBottomDark ? 'bg-neutral-600' : 'bg-neutral-300'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
