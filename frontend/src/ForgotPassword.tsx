import React, { useEffect, useState } from 'react';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, MailCheck, KeyRound, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from './supabaseClient';
import { AuthShell, authInputClass } from './components/auth/AuthShell';
import { OtpInput } from './components/auth/OtpInput';
import { setRecovering } from './lib/recoverySession';

const MIN_PASSWORD = 6;
const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Password reset, in three steps: email, emailed code, new password.
 *
 * Built on Supabase's own recovery OTP, matching how Signup verifies an
 * address: `resetPasswordForEmail` mails the code, `verifyOtp({ type:
 * 'recovery' })` checks it and returns a session, and that session is what
 * authorises the `updateUser` call. No reset tokens of our own to store, expire
 * or leak.
 *
 * The session appearing at step 2 is the subtle part — see `recoverySession`
 * for why this screen has to hold the app's render gate open until step 3 has
 * actually saved the password.
 */
type Step = 'email' | 'code' | 'password';

export default function ForgotPassword({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [step, setStep] = useState<Step>('email');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const cleanEmail = email.trim().toLowerCase();

  // Supabase rate-limits recovery mail; the countdown keeps people from
  // burning the quota by hammering the button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Abandoning the flow half-way (browser back, a stray click on "Sign in")
  // must not leave the gate propped open forever.
  useEffect(() => () => setRecovering(false), []);

  const leave = () => {
    setRecovering(false);
    onBackToLogin();
  };

  // ---------- step 1: send the code ----------
  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (sending) return;

    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      toast.error('Enter the email address for your account.');
      return;
    }

    setSending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
    setSending(false);

    if (error) {
      toast.error(
        /rate|limit|security/i.test(error.message)
          ? 'Too many emails just now — wait a minute and try again.'
          : error.message
      );
      return;
    }

    // Deliberately not reporting whether the address has an account: that
    // answer would let anyone test which emails are registered here.
    setStep('code');
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success(`If ${cleanEmail} has an account, a ${OTP_LENGTH}-digit code is on its way.`);
  };

  // ---------- step 2: check the code ----------
  const handleVerify = async (submitted?: string) => {
    const token = (submitted ?? code).trim();
    if (verifying || token.length !== OTP_LENGTH) return;

    // Raise the flag *before* verifying: a correct code signs the user in, and
    // App would otherwise replace this screen with the dashboard right here.
    setRecovering(true);
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token,
      type: 'recovery',
    });
    setVerifying(false);

    if (error) {
      setRecovering(false);
      setCode('');
      toast.error(
        /expired/i.test(error.message)
          ? 'That code has expired — send a new one.'
          : 'That code is not right. Check it and try again.'
      );
      return;
    }

    setStep('password');
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
    if (error) {
      toast.error(
        /rate|limit|security/i.test(error.message)
          ? 'Too many emails just now — wait a minute and try again.'
          : error.message
      );
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success('New code sent.');
  };

  // ---------- step 3: save the new password ----------
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (password.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      toast.error('Both passwords must match.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      toast.error(
        /should be different|same as/i.test(error.message)
          ? 'That is already your password — pick a new one.'
          : error.message
      );
      return;
    }

    toast.success('Password updated. You are signed in.');
    // Lowering the flag hands control back to App, which now has a session and
    // drops straight into the app — no second sign-in needed.
    setRecovering(false);
  };

  // ===================== step 3 UI =====================
  if (step === 'password') {
    return (
      <AuthShell
        title="Set a new password"
        subtitle={
          <>
            Code confirmed for{' '}
            <span className="font-semibold text-neutral-200">{cleanEmail}</span>. Choose a
            new password and you&apos;ll be signed straight in.
          </>
        }
        footer={<span className="text-neutral-600">Almost done — this is the last step.</span>}
      >
        <form onSubmit={handleSave} className="mt-7 space-y-3">
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`New password (min ${MIN_PASSWORD} characters)`}
              autoComplete="new-password"
              autoFocus
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

          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className={authInputClass}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 size={17} className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Check size={16} /> Save password and continue
              </>
            )}
          </button>
        </form>
      </AuthShell>
    );
  }

  // ===================== step 2 UI =====================
  if (step === 'code') {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            We sent a {OTP_LENGTH}-digit code to{' '}
            <span className="font-semibold text-neutral-200">{cleanEmail}</span>. Enter it
            below to confirm it&apos;s you.
          </>
        }
        footer={
          <button
            type="button"
            onClick={() => {
              setStep('email');
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
          disabled={verifying || code.length !== OTP_LENGTH}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifying ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Checking…
            </>
          ) : (
            <>
              <MailCheck size={16} /> Verify code
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
            Check your spam folder — reset mail often lands there.
          </p>
        </div>
      </AuthShell>
    );
  }

  // ===================== step 1 UI =====================
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send a code to reset it."
      footer={
        <button
          type="button"
          onClick={leave}
          className="inline-flex items-center gap-1.5 font-semibold text-neutral-400 transition-colors hover:text-white"
        >
          <ArrowLeft size={13} /> Back to sign in
        </button>
      }
    >
      <form onSubmit={handleSend} className="mt-7 space-y-3">
        <div className="relative">
          <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            className={authInputClass}
          />
        </div>

        <button
          type="submit"
          disabled={sending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Sending…
            </>
          ) : (
            <>
              <KeyRound size={16} /> Send reset code <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-neutral-600">
        Signed up with Google? You can still set a password here — or just use
        &ldquo;Continue with Google&rdquo; on the sign-in screen.
      </p>
    </AuthShell>
  );
}
