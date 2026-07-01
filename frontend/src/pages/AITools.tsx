import { type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Wand2, RefreshCw, SpellCheck, AlignLeft, Languages, Gauge, ShieldAlert,
  Fish, Type, Clock, Send, FileText, Users, Briefcase,
} from "lucide-react";
import type { ToolAction } from "../lib/types";
import { GlassCard } from "../components/ui/GlassCard";
import { SectionHeader } from "../components/ui/SectionHeader";
import { cn } from "../lib/cn";

interface Tool {
  key: ToolAction;
  label: string;
  desc: string;
  icon: ReactNode;
  accent: string;
}

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
    title: "Analyze & Protect",
    icon: <ShieldAlert size={16} />,
    tools: [
      { key: "tone_detection", label: "Tone Detection", desc: "How it reads", icon: <Gauge size={18} />, accent: "from-indigo-500/40 to-blue-500/30" },
      { key: "spam_detection", label: "Spam Detection", desc: "Junk or genuine?", icon: <ShieldAlert size={18} />, accent: "from-amber-500/40 to-orange-500/30" },
      { key: "phishing_detection", label: "Phishing Detection", desc: "Spot scams & red flags", icon: <Fish size={18} />, accent: "from-rose-500/40 to-red-500/30" },
    ],
  },
  {
    title: "Generate",
    icon: <Sparkles size={16} />,
    tools: [
      { key: "subject_generator", label: "Subject Generator", desc: "5 catchy subject lines", icon: <Type size={18} />, accent: "from-violet-500/40 to-purple-500/30" },
      { key: "follow_up", label: "Follow-up Generator", desc: "Polite, effective nudge", icon: <Clock size={18} />, accent: "from-amber-500/40 to-yellow-500/30" },
      { key: "cold_email", label: "Cold Email", desc: "Persuasive outreach", icon: <Send size={18} />, accent: "from-orange-500/40 to-red-500/30" },
      { key: "cover_letter", label: "Cover Letter", desc: "Tailored to your resume", icon: <FileText size={18} />, accent: "from-emerald-500/40 to-teal-500/30" },
      { key: "linkedin_outreach", label: "LinkedIn Outreach", desc: "Connection notes & InMail", icon: <Users size={18} />, accent: "from-sky-500/40 to-blue-500/30" },
      { key: "interview_email", label: "Interview Email", desc: "Schedule, confirm, thank", icon: <Briefcase size={18} />, accent: "from-cyan-500/40 to-teal-500/30" },
    ],
  },
];

export function AITools({ onOpenTool }: { onOpenTool: (action: ToolAction) => void }) {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          <Sparkles size={24} className="text-brand-400" /> AI Tools
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          A full suite of writing, analysis and generation tools — each streams its result live.
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
    </div>
  );
}
