import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ChevronRight, Mail, X } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * Shown immediately before handing the browser to Google to link a mailbox.
 *
 * Google labels every app requesting Gmail scopes "unverified" until it has
 * passed review, and presents the user with a red warning screen whose only way
 * forward is a collapsed "Advanced" link and a button that says the word
 * "unsafe". People reasonably read that as the app being broken or malicious
 * and stop there — which is the single biggest thing standing between a visitor
 * and the features that need a mailbox.
 *
 * The warning cannot be removed from this side; only Google's verification
 * process clears it. What can be removed is the surprise. Telling the user what
 * they are about to see, why it says that, and which words to click turns a
 * dead end into a step. The mock below deliberately mirrors Google's own
 * wording and layout so the real screen is recognised rather than feared.
 */
export function GmailConsentNotice({
  open,
  onContinue,
  onCancel,
}: {
  open: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 20 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gmail-notice-title"
            className="relative w-full max-w-lg rounded-[2.5rem] border border-white/10 bg-[#111] p-8 shadow-2xl"
          >
            <button
              onClick={onCancel}
              aria-label="Close"
              className="absolute right-6 top-6 text-neutral-600 transition-colors hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
              <ShieldCheck size={24} />
            </div>

            <h2 id="gmail-notice-title" className="mb-2 text-xl font-bold tracking-tight text-white">
              Google will show a warning. That&apos;s expected.
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-neutral-400">
              This app is pending Google&apos;s review, so Google flags it as unverified whenever it
              asks for mailbox access. Nothing is wrong — you just have to click past one screen.
            </p>

            {/* A deliberately close mock of Google's screen, so it is recognised on sight. */}
            <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/5 px-5 py-4">
                <p className="text-sm font-semibold text-white">Google hasn&apos;t verified this app</p>
                <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                  You may be at risk of exposing sensitive data to an untrusted site…
                </p>
              </div>
              <div className="space-y-2 px-5 py-4">
                <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
                  <ChevronRight size={14} className="text-amber-400" />
                  <span className="text-xs font-semibold text-amber-200">Advanced</span>
                  <span className="ml-auto text-[11px] text-amber-200/70">← click this first</span>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
                  <ChevronRight size={14} className="text-amber-400" />
                  <span className="text-xs font-semibold text-amber-200">
                    Go to Automated Email AI (unsafe)
                  </span>
                  <span className="ml-auto text-[11px] text-amber-200/70">← then this</span>
                </div>
              </div>
            </div>

            <p className="mb-6 text-xs leading-relaxed text-neutral-500">
              Your mailbox is used only to summarise, draft and organise mail inside this app. Email
              is never sold, never used to train a model, and nothing is sent without you pressing
              send. Details in the{' '}
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-300 underline underline-offset-2 hover:text-white"
              >
                privacy policy
              </a>
              . You can revoke access any time at{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-300 underline underline-offset-2 hover:text-white"
              >
                Google account permissions
              </a>
              .
            </p>

            <div className="space-y-3">
              <Button onClick={onContinue} className="w-full py-3.5">
                <Mail size={17} /> Continue to Google
              </Button>
              <button
                onClick={onCancel}
                className="w-full pt-1 text-xs font-medium uppercase tracking-widest text-neutral-600 transition-colors hover:text-neutral-400"
              >
                Not now
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
