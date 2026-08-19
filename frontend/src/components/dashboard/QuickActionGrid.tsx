import { type ReactNode } from "react";
import {
  PenLine, Inbox, Reply, Languages, Wand2, RefreshCw,
} from "lucide-react";
import { GlassCard } from "../ui/GlassCard";
import { cn } from "../../lib/cn";

export type QuickActionKey =
  | "compose"
  | "summarize_inbox"
  | "generate_reply"
  | "translate"
  | "improve"
  | "rewrite";

interface Action {
  key: QuickActionKey;
  label: string;
  desc: string;
  icon: ReactNode;
  accent: string;
}

const ACTIONS: Action[] = [
  { key: "compose", label: "Compose Email", desc: "Start a fresh email", icon: <PenLine size={18} />, accent: "from-indigo-500/40 to-blue-500/30" },
  { key: "summarize_inbox", label: "Summarize Inbox", desc: "AI briefing of your mail", icon: <Inbox size={18} />, accent: "from-sky-500/40 to-cyan-500/30" },
  { key: "generate_reply", label: "Generate Reply", desc: "Six reply styles", icon: <Reply size={18} />, accent: "from-violet-500/40 to-purple-500/30" },
  { key: "translate", label: "Translate Email", desc: "Any language", icon: <Languages size={18} />, accent: "from-rose-500/40 to-pink-500/30" },
  { key: "improve", label: "Improve Writing", desc: "Clarity & tone", icon: <Wand2 size={18} />, accent: "from-fuchsia-500/40 to-violet-500/30" },
  { key: "rewrite", label: "Rewrite Email", desc: "Fresh phrasing", icon: <RefreshCw size={18} />, accent: "from-teal-500/40 to-green-500/30" },
];

export function QuickActionGrid({ onAction }: { onAction: (key: QuickActionKey) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {ACTIONS.map((a, i) => (
        <GlassCard
          key={a.key}
          hover
          delay={i * 0.04}
          onClick={() => onAction(a.key)}
          className="group p-4"
        >
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform group-hover:scale-110",
              a.accent
            )}
          >
            {a.icon}
          </div>
          <p className="mt-3 text-sm font-semibold text-white">{a.label}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{a.desc}</p>
        </GlassCard>
      ))}
    </div>
  );
}
