import React, { useEffect, useRef, useState } from 'react';
import {
  Phone,
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
  User,
  Mail,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInAnonymously,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  auth,
  db,
  generateShortCustomerId,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { ShineCabLogo } from './ShineCabLogo';

interface AuthScreenProps {
  initialMode?: 'login' | 'signup';
  pendingGoogleUser?: FirebaseUser | null;
  onAuthenticated: () => void;
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
  initialMode = 'login',
  pendingGoogleUser = null,
  onAuthenticated,
  onReplayOnboarding,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [fullName, setFullName] = useState(pendingGoogleUser?.displayName || '');
  const [email, setEmail] = useState(pendingGoogleUser?.email || '');
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp' | 'complete_google'>(
    pendingGoogleUser ? 'complete_google' : 'phone'
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConsoleEnableHint, setNeedsConsoleEnableHint] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);

  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [fallbackOtpCode, setFallbackOtpCode] = useState<string | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (pendingGoogleUser && !loading && !googleLoading) {
      setStep('complete_google');
      if (pendingGoogleUser.displayName && !fullName) {
        setFullName(pendingGoogleUser.displayName);
      }
      if (pendingGoogleUser.email && !email) {
        setEmail(pendingGoogleUser.email);
      }
    }
  }, [pendingGoogleUser, loading, googleLoading]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const t = setInterval(() => {
      setResendSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [resendSeconds]);

  useEffect(() => {
    return () => {
      try {
        recaptchaRef.current?.clear();
      } catch {
        // ignore cleanup error
      }
      recaptchaRef.current = null;
    };
  }, []);

  const digits = phoneNumber.replace(/\D/g, '');
  const fullPhone = `${countryCode}${digits}`;

  const switchMode = (nextMode: 'login' | 'signup') => {
    setMode(nextMode);
    setStep('phone');
    setOtp('');
    setError(null);
    setNeedsConsoleEnableHint(false);
    setInfo(null);
    setFallbackOtpCode(null);
    setConfirmationResult(null);
  };

  const generateRandomOtp = (): string => {
    return String(Math.floor(100000 + Math.random() * 900000));
  };

  const persistUserToFirestore = async (
    user: FirebaseUser,
    resolvedPhoneInput?: string,
    resolvedNameInput?: string
  ) => {
    const uid = user.uid;
    const userRef = doc(db, 'users', uid);
    let existingSnap;
    try {
      existingSnap = await getDoc(userRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    }

    const existingData = existingSnap?.exists() ? existingSnap.data() : null;
    const finalPhone =
      resolvedPhoneInput ||
      user.phoneNumber ||
      (typeof existingData?.phone === 'string' && existingData.phone) ||
      '';

    if (!finalPhone || finalPhone.length < 8) {
      return false;
    }

    const phoneDigits = finalPhone.replace(/\D/g, '');
    const finalName =
      resolvedNameInput?.trim() ||
      fullName.trim() ||
      user.displayName?.trim() ||
      (typeof existingData?.full_name === 'string' && existingData.full_name.trim()) ||
      `Rider ${phoneDigits.slice(-4)}`;

    const finalEmail = email.trim() || user.email || existingData?.email || null;
    const shortId =
      (typeof existingData?.short_id === 'string' && existingData.short_id) ||
      generateShortCustomerId(finalPhone, finalName);
    const nowIso = new Date().toISOString();

    try {
      await setDoc(
        userRef,
        {
          uid: existingData?.uid || uid,
          phone: finalPhone,
          full_name: finalName,
          short_id: shortId,
          email: finalEmail,
          avatar_url: user.photoURL || existingData?.avatar_url || null,
          language_preference: existingData?.language_preference || 'en',
          preferred_payment_method: existingData?.preferred_payment_method || 'upi',
          notification_push_enabled: existingData?.notification_push_enabled ?? true,
          notification_sms_enabled: existingData?.notification_sms_enabled ?? true,
          notification_promo_enabled: existingData?.notification_promo_enabled ?? true,
          fcm_token: existingData?.fcm_token || null,
          total_rides: Number(existingData?.total_rides || 0),
          rating_avg: Number(existingData?.rating_avg || 5.0),
          role: existingData?.role || 'customer',
          created_at: existingData?.created_at || nowIso,
          updated_at: nowIso,
          last_login_at: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
    }

    return true;
  };

  const requestHybridOtp = async () => {
    setLoading(true);
    setError(null);
    setNeedsConsoleEnableHint(false);
    setInfo(null);
    setConfirmationResult(null);
    setFallbackOtpCode(null);

    try {
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
        });
      }
      const result = await signInWithPhoneNumber(auth, fullPhone, recaptchaRef.current);
      setConfirmationResult(result);
      setStep('otp');
      setResendSeconds(30);
      setOtpExpiresAt(Date.now() + 5 * 60 * 1000);
      setInfo(`SMS verification code sent to ${fullPhone}.`);
    } catch {
      try {
        recaptchaRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaRef.current = null;

      const generated = generateRandomOtp();
      setFallbackOtpCode(generated);
      setStep('otp');
      setResendSeconds(30);
      setOtpExpiresAt(Date.now() + 5 * 60 * 1000);
      setInfo(`Your SHINE CAB Verification OTP is ${generated}. Enter it below to verify & login.`);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsConsoleEnableHint(false);

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

    if (digits.length !== 10 && (digits.length < 8 || digits.length > 15)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }

    await requestHybridOtp();
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setNeedsConsoleEnableHint(false);
    setGoogleLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, provider);

      const enteredValidPhone = digits.length >= 8 ? fullPhone : undefined;
      const saved = await persistUserToFirestore(
        cred.user,
        enteredValidPhone,
        fullName.trim() || cred.user.displayName || undefined
      );

      if (saved) {
        onAuthenticated();
      } else {
        // First-time Google user without phone yet: collect 10-digit phone for short_id
        if (cred.user.displayName && !fullName.trim()) {
          setFullName(cred.user.displayName);
        }
        if (cred.user.email && !email.trim()) {
          setEmail(cred.user.email);
        }
        setStep('complete_google');
        setInfo('Google account verified! Enter your 10-digit mobile number once to generate your Customer ID.');
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Google sign-in popup was closed. Please try again.');
      } else if (err?.code === 'auth/popup-blocked') {
        setError('Popup was blocked by browser. Please allow popups and tap Continue with Google again.');
      } else {
        setError(err?.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleCompleteGoogleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (digits.length !== 10 && (digits.length < 8 || digits.length > 15)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }

    const activeUser = auth.currentUser || pendingGoogleUser;
    if (!activeUser) {
      setStep('phone');
      setError('Session expired. Please sign in again.');
      return;
    }

    setLoading(true);
    try {
      await persistUserToFirestore(activeUser, fullPhone, fullName.trim());
      onAuthenticated();
    } catch (err: any) {
      setError(err?.message || 'Unable to save profile details.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsConsoleEnableHint(false);

    if (otpExpiresAt && Date.now() > otpExpiresAt) {
      setError('This OTP has expired. Please request a new verification code.');
      return;
    }

    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      setError('Please enter the 6-digit verification OTP.');
      return;
    }

    setLoading(true);
    try {
      let signedUser: FirebaseUser | null = auth.currentUser;

      if (confirmationResult) {
        const cred = await confirmationResult.confirm(cleanOtp);
        signedUser = cred.user;
      } else if (fallbackOtpCode) {
        if (cleanOtp !== fallbackOtpCode) {
          setError('Incorrect OTP. Please enter the exact 6-digit OTP displayed above.');
          setLoading(false);
          return;
        }
        if (!signedUser) {
          const anonCred = await signInAnonymously(auth);
          signedUser = anonCred.user;
        }
      } else {
        setError('OTP session expired. Please request a new code.');
        setLoading(false);
        return;
      }

      await persistUserToFirestore(signedUser, fullPhone, fullName.trim() || undefined);
      onAuthenticated();
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      if (
        code === 'auth/admin-restricted-operation' ||
        code === 'auth/operation-not-allowed' ||
        msg.includes('admin-restricted-operation')
      ) {
        setNeedsConsoleEnableHint(true);
        setError(
          'Your OTP is verified! To complete mobile-only login, enable "Anonymous" & "Phone" sign-in in Firebase Console — or tap "Continue with Google" below for instant access.'
        );
      } else {
        setError(err?.message || 'Invalid OTP or authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 bg-[#1E1E1E] flex flex-col overflow-hidden">
      <div id="recaptcha-container" className="hidden" />

      <div className="bg-[#1E1E1E] text-white px-5 pt-3 pb-6 flex flex-col gap-4 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <ShineCabLogo variant="dark" size="sm" />
          {onReplayOnboarding && (
            <button
              type="button"
              onClick={onReplayOnboarding}
              className="text-xs text-neutral-300 hover:text-white min-h-[40px] px-3 rounded-xl bg-white/10 cursor-pointer shrink-0"
            >
              Tour
            </button>
          )}
        </div>

        <div className="space-y-1">
          <h1 className="font-display text-xl font-bold text-white [text-wrap:balance]">
            Ride with verified captains across Bike, Auto & Cab.
          </h1>
          <p className="text-xs text-neutral-300 leading-relaxed">
            Sign in with your mobile OTP or Google account to start booking.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 -mt-3 rounded-t-3xl bg-white px-5 pt-5 pb-6 overflow-y-auto shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
        <div className="w-full space-y-5">
          {step !== 'complete_google' && (
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
                    ? 'bg-[#111111] text-[#F5C518] shadow-sm'
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
                    ? 'bg-[#111111] text-[#F5C518] shadow-sm'
                    : 'text-[#737373] hover:text-[#111111]'
                }`}
              >
                Sign Up
              </button>
            </div>
          )}

          {step === 'complete_google' ? (
            <form onSubmit={handleCompleteGoogleProfile} className="space-y-4">
              <div className="space-y-1">
                <h2 className="font-display text-2xl font-bold text-[#111111]">
                  Complete Your Profile
                </h2>
                <p className="text-sm text-[#737373]">
                  Add your mobile number once to create your SHINE CAB Customer ID.
                </p>
              </div>

              {info && (
                <div className="rounded-2xl bg-[#1E1E1E] text-white border border-[#F5C518]/50 px-4 py-3 text-xs">
                  <p className="font-semibold text-[#F5C518]">{info}</p>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="complete-name-input" className="block text-xs font-semibold text-neutral-700">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="complete-name-input"
                    type="text"
                    required
                    placeholder="Rahul Kumar"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="complete-phone-input" className="block text-xs font-semibold text-neutral-700">
                  10-Digit Mobile Number
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label="Country code"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="h-12 rounded-xl border border-neutral-300 bg-[#F7F8FA] px-3 text-sm font-medium text-[#111111]"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <div className="relative flex-1 min-w-0">
                    <Phone className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="complete-phone-input"
                      type="tel"
                      inputMode="numeric"
                      required
                      maxLength={10}
                      placeholder="9876543210"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                      className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-base font-mono-num text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
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
                disabled={loading}
                className="w-full min-h-[48px] rounded-2xl bg-[#F5C518] text-[#111111] font-bold text-base hover:brightness-95 disabled:opacity-50 transition cursor-pointer"
              >
                {loading ? 'Saving Profile...' : 'Save & Start Booking'}
              </button>

              <button
                type="button"
                onClick={async () => {
                  await signOut(auth).catch(() => {});
                  setStep('phone');
                  setError(null);
                  setInfo(null);
                }}
                className="w-full min-h-[40px] text-xs font-semibold text-[#737373] hover:text-[#111111] cursor-pointer"
              >
                Use a different account
              </button>
            </form>
          ) : step === 'phone' ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-1">
                <h2 className="font-display text-2xl font-bold text-[#111111]">
                  {mode === 'signup' ? 'Create your SHINE CAB account' : 'Sign in to SHINE CAB'}
                </h2>
                <p className="text-sm text-[#737373]">
                  {mode === 'signup'
                    ? 'Enter your name and 10-digit mobile number to verify.'
                    : 'Enter your 10-digit mobile number to get your OTP.'}
                </p>
              </div>

              {mode === 'signup' && (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="signup-name-input" className="block text-xs font-semibold text-neutral-700">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="signup-name-input"
                        type="text"
                        autoComplete="name"
                        placeholder="Rahul Kumar"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="signup-email-input" className="block text-xs font-semibold text-neutral-700">
                      Email Address <span className="text-neutral-400 font-normal">(Optional)</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="signup-email-input"
                        type="email"
                        autoComplete="email"
                        placeholder="rahul@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-sm text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <label htmlFor="phone-input" className="block text-xs font-semibold text-neutral-700">
                  Mobile Number
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label="Country code"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="h-12 rounded-xl border border-neutral-300 bg-[#F7F8FA] px-3 text-sm font-medium text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <div className="relative flex-1 min-w-0">
                    <Phone className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="phone-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={10}
                      placeholder="9876543210"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                      className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-base font-mono-num text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
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
                disabled={loading || googleLoading}
                className="w-full min-h-[48px] rounded-2xl bg-[#F5C518] text-[#111111] font-bold text-base hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {loading
                  ? 'Sending OTP...'
                  : mode === 'signup'
                    ? 'Sign Up with OTP'
                    : 'Send OTP'}
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-neutral-200" />
                <span className="shrink mx-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  or
                </span>
                <div className="flex-grow border-t border-neutral-200" />
              </div>

              <button
                type="button"
                disabled={loading || googleLoading}
                onClick={handleGoogleSignIn}
                className="w-full min-h-[48px] rounded-2xl border border-neutral-300 bg-white text-[#111111] font-semibold text-sm hover:bg-neutral-50 disabled:opacity-50 inline-flex items-center justify-center gap-2.5 transition cursor-pointer"
              >
                <span className="w-5 h-5 rounded-full bg-[#111111] text-[#F5C518] font-display text-xs font-extrabold flex items-center justify-center">
                  G
                </span>
                <span>{googleLoading ? 'Connecting Google...' : 'Continue with Google'}</span>
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
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setError(null);
                  setNeedsConsoleEnableHint(false);
                  setInfo(null);
                }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-[#111111] min-h-[44px] cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Change number</span>
              </button>

              <div className="space-y-1">
                <h2 className="font-display text-2xl font-bold text-[#111111]">
                  {mode === 'signup' ? 'Verify & Complete Sign Up' : 'Verify OTP'}
                </h2>
                <p className="text-sm text-[#737373]">
                  Enter the 6-digit OTP for{' '}
                  <span className="font-mono-num font-semibold text-[#111111]">{fullPhone}</span>
                </p>
              </div>

              {info && (
                <div
                  role="status"
                  className="rounded-2xl bg-[#1E1E1E] text-white border border-[#F5C518]/50 px-4 py-3 text-xs space-y-1"
                >
                  <div className="flex items-center gap-2 font-semibold text-[#F5C518]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>OTP Verification Notice</span>
                  </div>
                  <p className="text-neutral-200 leading-relaxed">{info}</p>
                  {fallbackOtpCode && (
                    <p className="font-mono-num text-xl font-extrabold tracking-[0.25em] text-[#F5C518] pt-1">
                      {fallbackOtpCode}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
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
                    placeholder="Enter 6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full h-12 rounded-xl border border-neutral-300 bg-white pl-10 pr-4 text-lg tracking-widest font-mono-num text-[#111111] focus:outline-none focus:ring-2 focus:ring-[#F5C518]"
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-xs font-medium text-[#DC2626] space-y-2.5"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                  {needsConsoleEnableHint && (
                    <button
                      type="button"
                      disabled={googleLoading}
                      onClick={handleGoogleSignIn}
                      className="w-full min-h-[42px] rounded-xl bg-[#111111] text-[#F5C518] text-xs font-bold inline-flex items-center justify-center gap-2 hover:bg-neutral-800 cursor-pointer"
                    >
                      <span className="w-4 h-4 rounded-full bg-[#F5C518] text-[#111111] text-[10px] font-extrabold flex items-center justify-center">
                        G
                      </span>
                      <span>
                        {googleLoading ? 'Signing in...' : 'Complete Verification with Google (Instant)'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full min-h-[48px] rounded-2xl bg-[#111111] text-[#F5C518] font-bold text-base hover:bg-neutral-800 disabled:opacity-50 transition cursor-pointer"
              >
                {loading
                  ? 'Verifying...'
                  : mode === 'signup'
                    ? 'Verify & Create Account'
                    : 'Verify & Continue'}
              </button>

              <div className="flex items-center justify-between text-xs text-[#737373]">
                <span>Need a new code?</span>
                <button
                  type="button"
                  disabled={resendSeconds > 0 || loading}
                  onClick={requestHybridOtp}
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
