import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh w-full bg-[#111216] flex items-center justify-center p-4">
          <div className="w-full max-w-[380px] rounded-3xl bg-[#111111] border border-neutral-800 text-white p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-[#FFC928] text-[#111111] font-display font-extrabold text-xl flex items-center justify-center mx-auto">
              SC
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-bold">Something went wrong</h1>
              <p className="text-xs text-neutral-400">
                SHINE CAB encountered an unexpected screen error. Tap below to reload cleanly.
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[46px] rounded-2xl bg-[#FFC928] text-[#111111] font-bold text-xs cursor-pointer hover:brightness-95"
            >
              Reload SHINE CAB
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Google Maps Platform quota & auth failure listener
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origError = console.error;
console.error = (...args: unknown[]) => {
  origError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
