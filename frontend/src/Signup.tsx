import React, { useEffect, useState } from 'react';
import { User, Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, Check, ArrowLeft, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from './supabaseClient';
import { startGoogleAuth } from './lib/googleAuth';
import { AuthShell, GoogleButton, OrDivider, authInputClass } from './components/auth/AuthShell';
import { requestOtp, verifySignupCode, otpErrorMessage } from './lib/otpApi';
import { OtpInput } from './components/auth/OtpInput';

const MIN_PASSWORD = 6;
const OTP_LENGTH = 6;
// Supabase's OTP length is a project setting; accept whatever it issues so a
// project configured for 8 digits is not silently unenterable.
const MIN_OTP = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Account creation, in two steps: details, then an emailed one-time code.
 *
 * The code is issued and checked by our own backend rather than by Supabase.
 * Supabase's mailer sends a confirmation *link* unless the project's email
 * template is edited to include `{{ .Token }}`, and its code length is a
 * project setting the app cannot see — both are dashboard state that silently
 * broke these six boxes. `/api/v1/otp` owns the code, its expiry and its
 * attempt limits, and mails it over the deployment's SMTP.
 *
 * Supabase still owns the account: no user exists until the code checks out,
 * at which point the backend creates it pre-confirmed and the browser signs in
 * with the password the user just chose.
 *
 * Google sign-up skips this entirely: Google has already verified the address.
 */
type Step = 'details' | 'verify';

export default function Signup({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const [step, setStep] = useState<Step>('details');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Resend cooldown — Supabase rate-limits confirmation emails, so the button
  // stays disabled long enough that people do not burn their quota.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleGoogle = async () => {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    try {
      await startGoogleAuth();
    } catch {
      setGoogleLoading(false);
    }
  };

  const cleanEmail = email.trim().toLowerCase();

  const validate = () => {
    if (!fullName.trim()) {
      toast.error('Enter your full name.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error('Enter a valid email address.');
      return false;
    }
    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
      return false;
    }
    return true;
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || googleLoading || !validate()) return;

    setLoading(true);
    try {
      await requestOtp(cleanEmail, 'signup');
    } catch (err) {
      setLoading(false);
      toast.error(otpErrorMessage(err, 'Could not send the code. Try again.'));
      return;
    }
    setLoading(false);

    setStep('verify');
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success(`We sent a ${OTP_LENGTH}-digit code to ${cleanEmail}`);
  };

  const handleVerify = async (submitted?: string) => {
    const token = (submitted ?? code).trim();
    if (verifying || token.length < MIN_OTP) return;

    setVerifying(true);
    try {
      // Creates the account, pre-confirmed, only once the code is accepted.
      await verifySignupCode({
        email: cleanEmail,
        code: token,
        password,
        full_name: fullName.trim(),
      });
    } catch (err) {
      setVerifying(false);
      setCode('');
      toast.error(otpErrorMessage(err, 'That code is not right. Check it and try again.'));
      return;
    }

    // The account exists now, so sign in with the password just chosen. App's
    // onAuthStateChange sees the session and swaps this screen for the app.
    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    setVerifying(false);

    if (error) {
      // The code was right and the account was created — only the automatic
      // sign-in failed, so say that rather than blaming the code.
      toast.error('Account created, but signing in failed. Try signing in with your new password.');
      onSwitchToLogin();
      return;
    }
    // A session now exists; App's onAuthStateChange swaps this screen out.
    toast.success('Email verified. Welcome!');
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      await requestOtp(cleanEmail, 'signup');
    } catch (err) {
      toast.error(otpErrorMessage(err, 'Could not send a new code. Try again shortly.'));
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success('New code sent.');
  };

  // ---------- step 2: verify ----------
  if (step === 'verify') {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            We sent a {OTP_LENGTH}-digit code to{' '}
            <span className="font-semibold text-neutral-200">{cleanEmail}</span>. Enter it
            below to finish creating your account.
          </>
        }
        footer={
          <button
            type="button"
            onClick={() => {
              setStep('details');
              setCode('');
            }}
            className="inline-flex items-center gap-1.5 font-semibold text-neutral-400 transition-colors hover:text-white"
          >
            <ArrowLeft size={13} /> Use a different email
          </button>
        }
      >
        <div className="mt-7">
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={handleVerify}
            disabled={verifying}
            length={OTP_LENGTH}
          />
        </div>

        <button
          type="button"
          onClick={() => handleVerify()}
          disabled={verifying || code.length < MIN_OTP}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifying ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Verifying…
            </>
          ) : (
            <>
              <MailCheck size={16} /> Verify and continue
            </>
          )}
        </button>

        <div className="mt-4 text-center text-xs text-neutral-500">
          Didn&apos;t get it?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0}
            className="font-semibold text-brand-400 underline-offset-4 transition-colors hover:text-brand-300 hover:underline disabled:cursor-not-allowed disabled:text-neutral-600 disabled:no-underline"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
          </button>
          <p className="mt-2 text-[11px] text-neutral-600">
            Check your spam folder — confirmation mail often lands there.
          </p>
        </div>
      </AuthShell>
    );
  }

  // ---------- step 1: details ----------
  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up an inbox assistant that drafts, summarises and never sends without you."
      footer={
        <>
          Already have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="font-semibold text-brand-400 underline-offset-4 transition-colors hover:text-brand-300 hover:underline"
          >
            Sign in
          </button>
        </>
      }
    >
      <div className="mt-7">
        <GoogleButton onClick={handleGoogle} loading={googleLoading} label="Sign up with Google" />
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-neutral-500">
          <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
          Recommended — no code to enter, and the same step links your Gmail.
        </p>
      </div>

      <OrDivider />

      <form onSubmit={handleSendCode} className="space-y-3">
        <div className="relative">
          <User size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            autoComplete="name"
            className={authInputClass}
          />
        </div>

        <div className="relative">
          <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={authInputClass}
          />
        </div>

        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`Password (min. ${MIN_PASSWORD} characters)`}
            autoComplete="new-password"
            className={authInputClass}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            title={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 transition-colors hover:text-white"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <button
          type="submit"
          disabled={loading || googleLoading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Sending code…
            </>
          ) : (
            <>
              Send verification code <ArrowRight size={16} />
            </>
          )}
        </button>

        <p className="pt-1 text-[11px] leading-relaxed text-neutral-600">
          We&apos;ll email you a {OTP_LENGTH}-digit code to confirm your address. Gmail is not
          connected this way — link it from Settings whenever you want the inbox features.
        </p>
      </form>
    </AuthShell>
  );
}
