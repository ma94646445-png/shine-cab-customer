import React, { useEffect, useState } from 'react';
import { Phone, ShieldCheck, ArrowLeft, ArrowRight, AlertTriangle, RefreshCw, User, Mail } from 'lucide-react';
import { SupabaseClient } from '@supabase/supabase-js';
import { ShineCabLogo } from './ShineCabLogo';
import { AppConfig } from '../types/shinecab';

interface AuthScreenProps {
  config: AppConfig;
  supabase: SupabaseClient | null;
  initialMode?: 'login' | 'signup';
  onAuthenticated: () => void;
  onSkipToHome?: () => void;
  onReplayOnboarding?: () => void;
}

const COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+1', label: 'United States (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+65', label: 'Singapore (+65)' },
];

export const AuthScreen: React.FC<AuthScreenProps> = ({
  config,
  supabase,
  initialMode = 'login',
  onAuthenticated,
  onSkipToHome,
  onReplayOnboarding,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const t = setInterval(() => {
      setResendSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [resendSeconds]);

  const fullPhone = `${countryCode}${phoneNumber.replace(/\D/g, '')}`;
  const isServiceReady = Boolean(config.services.supabase && supabase);

  const switchMode = (nextMode: 'login' | 'signup') => {
    setMode(nextMode);
    setStep('phone');
    setOtp('');
    setError(null);
    setInfo(null);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!isServiceReady || !supabase) {
      setError('Service configuration required. Please contact support.');
      return;
    }

    if (mode === 'signup') {
      if (fullName.trim().length < 2) {
        setError('Please enter your full name to create an account.');
        return;
      }
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('Enter a valid email address or leave it blank.');
        return;
      }
    }

    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      setError('Enter a valid mobile number.');
      return;
    }

    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
        options:
          mode === 'signup'
            ? {
                shouldCreateUser: true,
                data: {
                  full_name: fullName.trim(),
                  ...(email.trim() ? { email: email.trim() } : {}),
                },
              }
            : undefined,
      });
      if (otpError) {
        setError(otpError.message || 'Unable to send OTP. Please verify your SMS provider.');
        return;
      }
      setStep('otp');
      setResendSeconds(30);
      setOtpExpiresAt(Date.now() + 5 * 60 * 1000);
      setInfo(`Verification code sent to ${fullPhone}.`);
    } catch {
      setError('Network error while requesting OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isServiceReady || !supabase) {
      setError('Service configuration required. Please contact support.');
      return;
    }

    if (otpExpiresAt && Date.now() > otpExpiresAt) {
      setError('This OTP has expired. Please request a new verification code.');
      return;
    }

    const cleanOtp = otp.trim();
    if (cleanOtp.length < 4) {
      setError('Enter the verification code sent to your mobile.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: fullPhone,
        token: cleanOtp,
        type: 'sms',
      });

      if (verifyError || !data.session) {
        setError(verifyError?.message || 'Invalid or expired OTP. Please try again.');
        return;
      }

      if (mode === 'signup' && fullName.trim()) {
        const uid = data.session.user.id;
        await supabase.from('users').upsert(
          {
            id: uid,
            phone: data.session.user.phone || fullPhone,
            full_name: fullName.trim(),
            email: email.trim() || data.session.user.email || null,
            role: 'customer',
          },
          { onConflict: 'id' }
        );
        await supabase.from('customers').upsert({ user_id: uid }, { onConflict: 'user_id' });
      }

      onAuthenticated();
    } catch {
      setError('Unable to verify OTP right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendSeconds > 0 || !supabase) return;
    setError(null);
    setLoading(true);
    try {
      const { error: resendErr } = await supabase.auth.signInWithOtp({
        phone: fullPhone,
        options:
          mode === 'signup'
            ? {
                shouldCreateUser: true,
                data: {
                  full_name: fullName.trim(),
                  ...(email.trim() ? { email: email.trim() } : {}),
                },
              }
            : undefined,
      });
      if (resendErr) {
        setError(resendErr.message);
        return;
      }
      setResendSeconds(30);
      setOtpExpiresAt(Date.now() + 5 * 60 * 1000);
      setInfo(`A new verification code has been sent to ${fullPhone}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 bg-[#111111] flex flex-col overflow-hidden">
      <div className="bg-[#111111] text-white px-5 pt-4 pb-7 flex flex-col gap-5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {onSkipToHome && (
              <button
                type="button"
                onClick={onSkipToHome}
                className="inline-flex items-center gap-1 min-h-[40px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition cursor-pointer shrink-0"
              >
                <span>Skip</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#FFC928]" />
              </button>
            )}
            <ShineCabLogo variant="dark" size="sm" />
          </div>
          {onReplayOnboarding && (
            <button
              type="button"
              onClick={onReplayOnboarding}
              className="text-xs text-neutral-400 hover:text-white min-h-[40px] px-2.5 cursor-pointer shrink-0"
            >
              Tour
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <h1 className="font-display text-xl font-bold text-white [text-wrap:balance]">
            Ride with verified captains across Bike, Auto & Cab.
          </h1>
          <p className="text-xs text-neutral-300 leading-relaxed">
            Real-time SMS OTP verification for secure booking & safety.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 -mt-3 rounded-t-3xl bg-white px-5 pt-5 pb-6 overflow-y-auto shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
        <div className="w-full space-y-5">
          {/* Login / Sign Up Switcher */}
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 rounded-2xl bg-[#F7F8FA] p-1 border border-neutral-200"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => switchMode('login')}
              className={`min-h-[44px] rounded-xl text-sm font-semibold transition cursor-pointer ${
                mode === 'login'
                  ? 'bg-[#111111] text-[#FFC928] shadow-sm'
                  : 'text-[#737373] hover:text-[#111111]'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => switchMode('signup')}
              className={`min-h-[44px] rounded-xl text-sm font-semibold transition cursor-pointer ${
                mode === 'signup'
                  ? 'bg-[#111111] text-[#FFC928] shadow-sm'
                  : 'text-[#737373] hover:text-[#111111]'
              }`}
            >
              Sign Up
            </button>
          </div>

          {!isServiceReady && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Service configuration required. Please contact support.</p>
                <p className="text-xs text-amber-900">
                  Supabase URL and Anon Key with an SMS OTP provider must be configured in backend environment variables before signing in.
                </p>
              </div>
            </div>
          )}

          {step === 'phone' ? (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <div className="space-y-1.5">
                <h2 className="font-display text-2xl font-bold text-[#111111]">
                  {mode === 'signup' ? 'Create your SHINE CAB account' : 'Sign in to SHINE CAB'}
                </h2>
                <p className="text-sm text-[#737373]">
                  {mode === 'signup'
                    ? 'Enter your details and verify your mobile number via SMS OTP.'
                    : 'Enter your mobile number to receive a one-time verification code.'}
                </p>
              </div>

              {mode === 'signup' && (
                <>
                  <div className="space-y-2">
                    <label htmlFor="signup-name-input" className="block text-xs font-semibold text-neutral-700">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="signup-name-input"
                        type="text"
                        autoComplete="name"
                        placeholder="Aarav Sharma"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="signup-email-input" className="block text-xs font-semibold text-neutral-700">
                      Email Address <span className="text-neutral-400 font-normal">(Optional)</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="signup-email-input"
                        type="email"
                        autoComplete="email"
                        placeholder="aarav@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label htmlFor="phone-input" className="block text-xs font-semibold text-neutral-700">
                  Mobile Number
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label="Country code"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="h-12 rounded-xl border border-neutral-300 bg-[#F7F8FA] px-3 text-sm font-medium text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <div className="relative flex-1">
                    <Phone className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="phone-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="9876543210"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-base font-mono-num text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-[#DC2626]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !isServiceReady}
                className="w-full min-h-[48px] rounded-2xl bg-[#FFC928] text-[#111111] font-semibold text-base hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {loading
                  ? 'Sending OTP...'
                  : mode === 'signup'
                    ? 'Sign Up with OTP'
                    : 'Send Verification OTP'}
              </button>

              <p className="text-center text-xs text-[#737373]">
                {mode === 'login' ? (
                  <>
                    New to SHINE CAB?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('signup')}
                      className="font-semibold text-[#111111] underline underline-offset-4 cursor-pointer py-1"
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="font-semibold text-[#111111] underline underline-offset-4 cursor-pointer py-1"
                    >
                      Login
                    </button>
                  </>
                )}
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-[#111111] min-h-[44px] cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Change number</span>
              </button>

              <div className="space-y-1.5">
                <h2 className="font-display text-2xl font-bold text-[#111111]">
                  {mode === 'signup' ? 'Verify & Complete Sign Up' : 'Verify OTP'}
                </h2>
                <p className="text-sm text-[#737373]">
                  Enter the SMS code sent to <span className="font-mono-num font-semibold text-[#111111]">{fullPhone}</span>
                </p>
              </div>

              {info && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-medium text-[#16A34A]">
                  {info}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="otp-input" className="block text-xs font-semibold text-neutral-700">
                  6-Digit OTP Code
                </label>
                <div className="relative">
                  <ShieldCheck className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="Enter OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-lg tracking-widest font-mono-num text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#FFC928]"
                  />
                </div>
              </div>

              {error && (
                <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-[#DC2626]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !isServiceReady}
                className="w-full min-h-[48px] rounded-2xl bg-[#111111] text-white font-semibold text-base hover:bg-neutral-800 disabled:opacity-50 transition cursor-pointer"
              >
                {loading
                  ? 'Verifying...'
                  : mode === 'signup'
                    ? 'Verify & Create Account'
                    : 'Verify & Continue'}
              </button>

              <div className="flex items-center justify-between text-xs text-[#737373]">
                <span>Did not receive the code?</span>
                <button
                  type="button"
                  disabled={resendSeconds > 0 || loading}
                  onClick={handleResend}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#111111] disabled:text-neutral-400 min-h-[44px] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend OTP'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

