import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2 } from "lucide-react";

/**
 * Shared chrome for the sign-in and sign-up screens.
 *
 * Both pages are deliberately separate components — they ask for different
 * things and say different things — but they share the card, the branding and
 * the Google button so the two never drift apart visually.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 p-4">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-brand-500/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 shadow-card backdrop-blur-xl sm:p-9"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <Zap size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-white">Smart Email Agent</h1>
            <p className="text-xs text-neutral-500">AI assistant for your inbox</p>
          </div>
        </div>

        <h2 className="mt-7 text-2xl font-bold tracking-tight text-white">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">{subtitle}</p>

        {children}

        <div className="mt-6 border-t border-white/5 pt-5 text-center text-xs text-neutral-500">
          {footer}
        </div>
      </motion.div>
    </div>
  );
}

/** "Continue with Google" — identical on both screens. */
export function GoogleButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-neutral-900 shadow-xl transition-all hover:bg-neutral-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <>
          <Loader2 size={18} className="animate-spin" />
          Redirecting to Google…
        </>
      ) : (
        <>
          <GoogleMark />
          {label}
        </>
      )}
    </button>
  );
}

/** A labelled "or" rule between the Google button and the form. */
export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-white/10" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">or</span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

/** Shared input styling so both forms match. */
export const authInputClass =
  "w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-white/25";

/** Google's four-colour mark, inlined so the button works offline. */
export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
