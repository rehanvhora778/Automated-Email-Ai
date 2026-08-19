import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert, ShieldX, Cpu, Zap } from "lucide-react";
import type { MlVerdict } from "../../lib/types";
import { cn } from "../../lib/cn";

/**
 * The verdict from a locally trained classifier, shown above the streaming LLM
 * explanation.
 *
 * This lands in about a millisecond because it is a scikit-learn model running
 * in-process rather than an API round trip, so it is on screen well before the
 * first token of prose arrives. The two are complementary: the model gives a
 * fast, deterministic, measurable answer; the LLM explains it in words.
 */

type Tone = "danger" | "warn" | "safe";

const TONES: Record<Tone, { ring: string; text: string; chip: string; Icon: typeof ShieldCheck }> = {
  danger: {
    ring: "border-rose-500/30 bg-rose-500/[0.07]",
    text: "text-rose-300",
    chip: "bg-rose-500/15 text-rose-200",
    Icon: ShieldX,
  },
  warn: {
    ring: "border-amber-500/30 bg-amber-500/[0.07]",
    text: "text-amber-300",
    chip: "bg-amber-500/15 text-amber-200",
    Icon: ShieldAlert,
  },
  safe: {
    ring: "border-emerald-500/30 bg-emerald-500/[0.07]",
    text: "text-emerald-300",
    chip: "bg-emerald-500/15 text-emerald-200",
    Icon: ShieldCheck,
  },
};

/** "Spam" / "Phishing" are dangerous, "Suspicious" is a warning, the rest are safe. */
function toneFor(verdict: string): Tone {
  const v = verdict.toLowerCase();
  if (v === "spam" || v === "phishing") return "danger";
  if (v === "suspicious") return "warn";
  return "safe";
}

export function MlVerdictCard({ verdict }: { verdict: MlVerdict }) {
  const tone = TONES[toneFor(verdict.verdict)];
  const { Icon } = tone;

  // Show the probability of the flagged class when the model exposes it, so the
  // bar always means "how spammy / how phishy", not "how sure of the label".
  const risk =
    verdict.spam_probability ?? verdict.phishing_probability ?? verdict.confidence;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("mb-5 rounded-3xl border p-5", tone.ring)}
    >
      <div className="flex items-start gap-4">
        <div className={cn("mt-0.5 shrink-0", tone.text)}>
          <Icon size={26} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn("text-lg font-bold leading-none", tone.text)}>
              {verdict.verdict}
            </span>
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", tone.chip)}>
              {verdict.confidence.toFixed(1)}% confident
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-neutral-400">
              <Zap size={11} />
              {verdict.latency_ms < 1
                ? `${verdict.latency_ms.toFixed(2)} ms`
                : `${verdict.latency_ms.toFixed(0)} ms`}
            </span>
          </div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(Math.max(risk, 0), 100)}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn(
                "h-full rounded-full",
                toneFor(verdict.verdict) === "danger"
                  ? "bg-rose-400"
                  : toneFor(verdict.verdict) === "warn"
                  ? "bg-amber-400"
                  : "bg-emerald-400"
              )}
            />
          </div>

          {verdict.signals.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Signals
              </span>
              {verdict.signals.slice(0, 6).map((s) => (
                <span
                  key={s}
                  className="rounded-lg bg-white/5 px-2 py-0.5 font-mono text-[11px] text-neutral-300"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-neutral-500">
            <Cpu size={11} className="shrink-0" />
            <span className="truncate">{verdict.model}</span>
          </p>
        </div>
      </div>
    </motion.div>
  );
}
