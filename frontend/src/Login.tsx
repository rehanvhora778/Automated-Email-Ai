import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from './supabaseClient';
import { startGoogleAuth } from './lib/googleAuth';
import { AuthShell, GoogleButton, OrDivider, authInputClass } from './components/auth/AuthShell';

/**
 * Sign-in screen. Two routes in: Google, or an existing email/password account.
 *
 * Google is listed first because it also grants Gmail access in the same
 * consent — a password account can sign in fine, but has to link Gmail
 * separately from Settings before the mail features do anything.
 *
 * On success App's onAuthStateChange picks up the session and replaces this
 * screen, so there is no callback to wire up here.
 */
export default function Login({ onSwitchToSignup }: { onSwitchToSignup: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = async () => {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    try {
      await startGoogleAuth();
    } catch {
      setGoogleLoading(false); // startGoogleAuth already surfaced the reason
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || googleLoading) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      toast.error('Enter your email and password.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    setLoading(false);

    if (error) {
      toast.error(
        /invalid login credentials/i.test(error.message)
          ? 'Incorrect email or password.'
          : error.message
      );
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="font-semibold text-brand-400 underline-offset-4 transition-colors hover:text-brand-300 hover:underline"
          >
            Create one
          </button>
        </>
      }
    >
      <div className="mt-7">
        <GoogleButton onClick={handleGoogle} loading={googleLoading} label="Continue with Google" />
      </div>

      <OrDivider />

      <form onSubmit={handleSubmit} className="space-y-3">
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
            placeholder="Password"
            autoComplete="current-password"
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
              <Loader2 size={17} className="animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign in <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
