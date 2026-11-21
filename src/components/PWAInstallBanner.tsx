import React, { useState } from 'react';
import { Download, WifiOff, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-[#111111] text-white font-semibold hover:bg-neutral-800 transition-colors min-h-[44px] whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm w-full'
        }`}
      >
        <Download className="w-4 h-4 text-[#FFC928]" />
        <span>Install SHINE CAB App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white text-[#111111] font-semibold hover:bg-neutral-50 transition-colors min-h-[44px] whitespace-nowrap shrink-0 cursor-pointer ${
            compact ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm w-full'
          }`}
        >
          <Share className="w-4 h-4" />
          <span>Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full rounded-t-3xl bg-white p-5 pb-safe shadow-2xl border-t border-neutral-200">
              <div className="w-10 h-1 rounded-full bg-neutral-300 mx-auto mb-3" />
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-base font-bold text-[#111111]">
                  Install SHINE CAB on iOS
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-500 hover:bg-neutral-100 cursor-pointer"
                  aria-label="Close guide"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="space-y-2.5 text-xs text-neutral-700 list-decimal list-inside">
                <li>
                  Tap the <strong>Share</strong> icon in your Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong>Add</strong> to launch SHINE CAB full screen.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[46px] rounded-2xl bg-[#FFC928] text-[#111111] font-bold text-xs hover:brightness-95 cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="bg-[#111111] text-[#FFC928] px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 border-b border-neutral-800"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>You are offline. Cached screens are available; live booking requires an internet connection.</span>
    </div>
  );
};
