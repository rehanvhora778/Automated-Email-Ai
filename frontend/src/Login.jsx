import React, { useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Zap, Mail, Lock, User, Eye, EyeOff, Loader2, ArrowRight, Sparkles } from 'lucide-react';
import { supabase } from './supabaseClient';

const API_URL = 'http://localhost:8000';

// A single, focused auth screen with two clear modes: Sign In / Create Account.
// On success, App's onAuthStateChange listener picks up the session and swaps
// this screen for the app — no callbacks needed here.
export default function Login() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === 'signup';

  const validate = () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      toast.error('Please enter your email and password.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error('Please enter a valid email address.');
      return false;
    }
    if (isSignup && password.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return false;
    }
    return true;
  };

  const friendlyError = (err) => {
    const raw = err?.response?.data?.detail || err?.message || 'Something went wrong. Please try again.';
    if (/invalid login credentials/i.test(raw)) return 'Incorrect email or password.';
    if (/already registered|already been registered|exists/i.test(raw))
      return 'An account with this email already exists. Try signing in.';
    return raw;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !validate()) return;

    const cleanEmail = email.trim();
    setLoading(true);
    try {
      if (isSignup) {
        // 1) Create the (pre-confirmed) account via the backend admin API.
        await axios.post(`${API_URL}/api/v1/auth/signup`, {
          email: cleanEmail,
          password,
          full_name: name.trim() || cleanEmail.split('@')[0],
        });
        // 2) Sign them straight in — no extra step for the user.
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        toast.success('Welcome! Your account is ready.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        toast.success('Signed in successfully.');
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    if (next === mode || loading) return;
    setMode(next);
    setShowPassword(false);
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-6 text-white font-sans">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#111] p-10 rounded-[2.5rem] border border-white/5 shadow-2xl w-full max-w-md"
      >
        {/* Logo & Header */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-black shadow-xl shadow-white/10">
            <Zap size={32} fill="black" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-center mb-2 tracking-tight">Smart Email Agent</h1>
        <p className="text-center text-neutral-500 mb-8 text-sm font-medium">
          {isSignup ? 'Create an account to get started' : 'Sign in to your assistant'}
        </p>

        {/* Mode switch (segmented control) */}
        <div className="grid grid-cols-2 p-1 bg-white/5 border border-white/10 rounded-2xl mb-6">
          {['signin', 'signup'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className="relative py-2.5 rounded-xl text-sm font-bold"
            >
              {mode === m && (
                <motion.div
                  layoutId="authTabPill"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  className="absolute inset-0 bg-white rounded-xl shadow"
                />
              )}
              <span
                className={`relative z-10 transition-colors ${
                  mode === m ? 'text-black' : 'text-neutral-400 hover:text-white'
                }`}
              >
                {m === 'signin' ? 'Sign In' : 'Create Account'}
              </span>
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name — only for sign up */}
          <AnimatePresence initial={false}>
            {isSignup && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                  <input
                    className="w-full p-4 pl-12 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 focus:border-white/20 transition-all text-white placeholder:text-neutral-600"
                    placeholder="Full name (optional)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Email */}
          <div className="relative">
            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
            <input
              className="w-full p-4 pl-12 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 focus:border-white/20 transition-all text-white placeholder:text-neutral-600"
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <input
                className="w-full p-4 pl-12 pr-12 bg-white/5 border border-white/10 rounded-2xl outline-none focus:bg-white/10 focus:border-white/20 transition-all text-white placeholder:text-neutral-600"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-neutral-500 hover:text-white transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {isSignup && (
              <p className="text-[11px] text-neutral-600 mt-2 ml-1">Use at least 6 characters.</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-neutral-200 p-4 rounded-2xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-60 disabled:active:scale-100"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {isSignup ? 'Creating account…' : 'Signing in…'}
              </>
            ) : (
              <>
                {isSignup ? 'Create Account' : 'Sign In'}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {/* Footer note */}
        <div className="mt-8 pt-6 border-t border-white/5">
          <div className="flex items-start gap-3 bg-blue-500/[0.07] p-4 rounded-2xl border border-blue-500/10">
            <Sparkles size={18} className="text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[12px] leading-relaxed text-neutral-400">
              {isSignup ? (
                <>You&apos;ll be signed in automatically once your account is created. Link your Gmail afterward to unlock the full assistant.</>
              ) : (
                <>New here? Switch to <span className="text-white font-semibold">Create Account</span> — setup takes seconds.</>
              )}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
