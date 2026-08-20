import React, { useEffect, useState } from 'react';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, ArrowLeft, MailCheck, KeyRound, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from './supabaseClient';
import { AuthShell, authInputClass } from './components/auth/AuthShell';
import { OtpInput } from './components/auth/OtpInput';
import { setRecovering } from './lib/recoverySession';
import { requestOtp, verifyRecoveryCode, otpErrorMessage } from './lib/otpApi';
import { PasswordChecklist } from './components/auth/PasswordChecklist';
import { passwordIsValid } from './lib/passwordPolicy';

const OTP_LENGTH = 6;
// Supabase's OTP length is a project setting; accept whatever it issues so a
// project configured for 8 digits is not silently unenterable.
const MIN_OTP = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Password reset, in three steps: email, emailed code, new password.
 *
 * The code comes from our own backend rather than Supabase's mailer, for the
 * reasons in `otpApi` — chiefly that Supabase sends a *link* unless the
 * project's template is edited. The code and the new password are submitted
 * together at step 3, so a valid code is never spent before there is something
 * to spend it on, and a rejected one drops the user back to step 2.
 *
 * `startAtPassword` handles the other way in: a Supabase reset link that
 * predates this change still lands in the app with a live recovery session, so
 * that case skips to step 3 and saves through the session instead. See
 * `recoverySession` for why the app's render gate has to stay open for it.
 */
type Step = 'email' | 'code' | 'password';

export default function ForgotPassword({
  onBackToLogin,
  startAtPassword = false,
}: {
  onBackToLogin: () => void;
  /** Set when the user arrived by clicking the emailed reset link, which has
   *  already proved ownership of the address — only the password is left. */
  startAtPassword?: boolean;
}) {
  const [step, setStep] = useState<Step>(startAtPassword ? 'password' : 'email');

  const [email, setEmail] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const cleanEmail = email.trim().toLowerCase();
  // Arriving by link means no address was typed — read it off the session.
  const shownEmail = cleanEmail || linkEmail;

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

  // `useState` only reads its initial value on mount, so a screen that is
  // already open when the recovery link resolves would sit on the email step
  // forever. Move it explicitly whenever the flag turns on.
  useEffect(() => {
    if (startAtPassword) setStep('password');
  }, [startAtPassword]);

  // The link path never asked for an address, so take it from the session the
  // link established — purely so the screen can name the account being changed.
  useEffect(() => {
    if (!startAtPassword) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setLinkEmail(data.user.email);
    });
  }, [startAtPassword]);

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
    try {
      await requestOtp(cleanEmail, 'recovery');
    } catch (err) {
      setSending(false);
      toast.error(otpErrorMessage(err, 'Could not send the code. Try again.'));
      return;
    }
    setSending(false);

    // Deliberately not reporting whether the address has an account: that
    // answer would let anyone test which emails are registered here.
    setStep('code');
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success(`If ${cleanEmail} has an account, a ${OTP_LENGTH}-digit code is on its way.`);
  };

  // ---------- step 2: check the code ----------
  const handleVerify = (submitted?: string) => {
    const token = (submitted ?? code).trim();
    if (token.length < MIN_OTP) return;

    // Nothing is checked here. The code and the new password are sent together
    // in one call, so a valid code is never spent before there is something to
    // spend it on — and a wrong one sends the user back to this step.
    setStep('password');
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      await requestOtp(cleanEmail, 'recovery');
    } catch (err) {
      toast.error(otpErrorMessage(err, 'Could not send a new code. Try again shortly.'));
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success('New code sent.');
  };

  // ---------- step 3: save the new password ----------
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!passwordIsValid(password)) {
      toast.error('Your password does not meet all the requirements listed.');
      return;
    }
    if (password !== confirm) {
      toast.error('Both passwords must match.');
      return;
    }

    setSaving(true);

    // Two ways to be standing here. Following an older Supabase reset link
    // already established a session, so the password changes through it. The
    // code path has no session: the backend checks the code and sets the
    // password, then we sign in with it.
    if (startAtPassword) {
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
      setRecovering(false);
      return;
    }

    try {
      await verifyRecoveryCode({ email: cleanEmail, code, password });
    } catch (err) {
      setSaving(false);
      const message = otpErrorMessage(err, 'Could not reset the password. Try again.');
      toast.error(message);
      // A rejected code belongs back on the code step, with the boxes cleared.
      if (/code/i.test(message)) {
        setCode('');
        setStep('code');
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    setSaving(false);

    if (error) {
      toast.success('Password updated — sign in with your new password.');
      leave();
      return;
    }

    toast.success('Password updated. You are signed in.');
    setRecovering(false);
  };

  // ===================== step 3 UI =====================
  if (step === 'password') {
    return (
      <AuthShell
        title="Set a new password"
        subtitle={
          <>
            {startAtPassword ? 'Reset link confirmed' : 'Code confirmed'} for{' '}
            <span className="font-semibold text-neutral-200">{shownEmail || 'your account'}</span>.
            Choose a new password and you&apos;ll be signed straight in.
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
              placeholder="New password"
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

          <PasswordChecklist value={password} />

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
            length={OTP_LENGTH}
          />
        </div>

        <button
          type="button"
          onClick={() => handleVerify()}
          disabled={code.length < MIN_OTP}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-6 py-3.5 text-sm font-bold text-white shadow-glow transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MailCheck size={16} /> Continue
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
