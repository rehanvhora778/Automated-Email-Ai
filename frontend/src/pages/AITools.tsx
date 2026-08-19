import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Wand2, RefreshCw, SpellCheck, AlignLeft, Languages, Gauge,
  ShieldAlert, Fish, Cpu, Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ToolAction } from "../lib/types";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { classifyHealth } from "../lib/api";
import { cn } from "../lib/cn";

interface Tool {
  key: ToolAction;
  label: string;
  desc: string;
  icon: ReactNode;
  accent: string;
}

/** LLM-backed tools: a prompt goes to Mistral and the answer streams back. */
const CATEGORIES: { title: string; icon: ReactNode; tools: Tool[] }[] = [
  {
    title: "Write & Edit",
    icon: <Wand2 size={16} />,
    tools: [
      { key: "improve", label: "Improve Writing", desc: "Clarity, tone & impact", icon: <Wand2 size={18} />, accent: "from-fuchsia-500/40 to-violet-500/30" },
      { key: "rewrite", label: "Rewrite", desc: "Fresh phrasing, same meaning", icon: <RefreshCw size={18} />, accent: "from-teal-500/40 to-green-500/30" },
      { key: "grammar_fix", label: "Grammar Fix", desc: "Spelling & punctuation", icon: <SpellCheck size={18} />, accent: "from-emerald-500/40 to-teal-500/30" },
      { key: "summarize", label: "Summarize", desc: "TL;DR + key points", icon: <AlignLeft size={18} />, accent: "from-sky-500/40 to-cyan-500/30" },
      { key: "translate", label: "Translate", desc: "Any language", icon: <Languages size={18} />, accent: "from-rose-500/40 to-pink-500/30" },
    ],
  },
  {
    title: "Analyze",
    icon: <Gauge size={16} />,
    tools: [
      { key: "tone_detection", label: "Tone Detection", desc: "How it reads", icon: <Gauge size={18} />, accent: "from-indigo-500/40 to-blue-500/30" },
    ],
  },
];

/**
 * Threat detection is kept separate from the tools above because it works
 * differently: each of these runs a scikit-learn model trained on a labelled
 * corpus, in-process, with no API call. The LLM still writes the explanation,
 * but the verdict itself comes from a model with a measurable F1 score.
 */
const DETECTORS: (Tool & { metricsKey: "spam" | "phishing"; corpus: string })[] = [
  {
    key: "spam_detection",
    label: "Spam Detection",
    desc: "Junk or genuine?",
    icon: <ShieldAlert size={20} />,
    accent: "from-amber-500/40 to-orange-500/30",
    metricsKey: "spam",
    corpus: "SpamAssassin · 4,528 emails",
  },
  {
    key: "phishing_detection",
    label: "Phishing Detection",
    desc: "Spot scams & red flags",
    icon: <Fish size={20} />,
    accent: "from-rose-500/40 to-red-500/30",
    metricsKey: "phishing",
    corpus: "Nazario + SpamAssassin · 6,433 emails",
  },
];

export function AITools({ onOpenTool }: { onOpenTool: (action: ToolAction) => void }) {
  // Live model metrics, so the cards quote the real evaluation numbers rather
  // than hard-coded ones. Absent until someone runs the training scripts.
  const { data: health } = useQuery({
    queryKey: ["classify-health"],
    queryFn: classifyHealth,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <Sparkles size={24} className="text-brand-400" /> AI Tools
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Writing and analysis tools — each streams its result live.
        </p>
      </motion.div>

      {CATEGORIES.map((cat) => (
        <div key={cat.title}>
          <SectionHeader title={cat.title} icon={cat.icon} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {cat.tools.map((t, i) => (
              <GlassCard key={t.key} hover delay={i * 0.03} onClick={() => onOpenTool(t.key)} className="group p-4">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform group-hover:scale-110", t.accent)}>
                  {t.icon}
                </div>
                <p className="mt-3 text-sm font-semibold text-white">{t.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{t.desc}</p>
              </GlassCard>
            ))}
          </div>
        </div>
      ))}

      {/* --- Threat detection: trained models, not prompts --- */}
      <div className="pt-2">
        <div className="mb-4 border-t border-white/5 pt-8">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <Cpu size={18} className="text-emerald-400" /> Threat Detection
          </h2>
          <p className="mt-1.5 text-sm text-neutral-500">
            Powered by machine learning models trained on labelled email corpora — the
            verdict is computed locally in under a millisecond, then the AI explains it.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {DETECTORS.map((d, i) => {
            const m = health?.[d.metricsKey];
            const f1 = m?.test_metrics?.f1;
            return (
              <GlassCard
                key={d.key}
                hover
                delay={i * 0.05}
                onClick={() => onOpenTool(d.key)}
                className="group p-5"
              >
                <div className="flex items-start gap-4">
                  <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform group-hover:scale-110", d.accent)}>
                    {d.icon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-white">{d.label}</p>
                      {m?.available && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                          <Zap size={9} /> Model live
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">{d.desc}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                      {typeof f1 === "number" && (
                        <span className="font-mono font-semibold text-neutral-300">
                          {f1.toFixed(3)} F1
                        </span>
                      )}
                      <span className="text-neutral-600">{d.corpus}</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </div>
    </div>
  );
}
