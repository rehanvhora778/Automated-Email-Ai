import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { Reply, Clock, MessageSquare, Heart, ArrowUpRight } from "lucide-react";
import { cn } from "../../lib/cn";

const typeMeta: Record<string, { icon: ReactNode; color: string }> = {
  reply: { icon: <Reply size={16} />, color: "text-blue-400 bg-blue-500/10" },
  follow_up: { icon: <Clock size={16} />, color: "text-amber-400 bg-amber-500/10" },
  respond: { icon: <MessageSquare size={16} />, color: "text-violet-400 bg-violet-500/10" },
  thank_you: { icon: <Heart size={16} />, color: "text-rose-400 bg-rose-500/10" },
};

export function AISuggestionCard({
  title,
  type,
  onClick,
  delay = 0,
}: {
  title: string;
  type: string;
  onClick?: () => void;
  delay?: number;
}) {
  const meta = typeMeta[type] ?? typeMeta.respond;
  return (
    <motion.button
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.35 }}
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-left transition-all hover:border-white/15 hover:bg-white/[0.06]"
    >
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", meta.color)}>
        {meta.icon}
      </span>
      <span className="flex-1 truncate text-sm font-medium text-neutral-200">{title}</span>
      <ArrowUpRight
        size={16}
        className="shrink-0 text-neutral-600 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white"
      />
    </motion.button>
  );
}
