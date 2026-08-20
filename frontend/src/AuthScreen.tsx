import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Login from './Login';
import Signup from './Signup';
import ForgotPassword from './ForgotPassword';
import { useRecoveryState } from './lib/recoverySession';

/**
 * Chooses between the sign-in and sign-up screens.
 *
 * The app has no router, so which screen shows is plain local state. Sign-in is
 * the default because returning users outnumber new ones; the two screens each
 * link to the other rather than sharing one toggling form, so each can ask for
 * exactly what it needs and say what that choice means.
 */
export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const recovery = useRecoveryState();

  // A followed reset link outranks whatever screen was showing: the session is
  // already live, so the only thing left to do is choose a new password.
  const effectiveMode = recovery.fromLink ? 'forgot' : mode;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={effectiveMode}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        {effectiveMode === 'signin' ? (
          <Login
            onSwitchToSignup={() => setMode('signup')}
            onForgotPassword={() => setMode('forgot')}
          />
        ) : effectiveMode === 'signup' ? (
          <Signup onSwitchToLogin={() => setMode('signin')} />
        ) : (
          <ForgotPassword
            onBackToLogin={() => setMode('signin')}
            startAtPassword={recovery.fromLink}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
