import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, PenLine, Reply, Inbox, Languages, RefreshCw, Search,
} from "lucide-react";
import type { ToolAction } from "../../lib/types";
import { cn } from "../../lib/cn";

interface FabAction {
  label: string;
  icon: ReactNode;
  accent: string;
  run: () => void;
}

/** Bottom-right speed-dial that springs open into common actions. */
export function QuickActionFab({
  onCompose,
  onNavigate,
  onOpenTool,
  onOpenPalette,
}: {
  onCompose: () => void;
  onNavigate: (view: string) => void;
  onOpenTool: (action: ToolAction) => void;
  onOpenPalette: () => void;
}) {
  const [open, setOpen] = useState(false);

  const act = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  const actions: FabAction[] = [
    { label: "Search (⌘K)", icon: <Search size={18} />, accent: "from-slate-400 to-slate-500", run: act(onOpenPalette) },
    { label: "Rewrite", icon: <RefreshCw size={18} />, accent: "from-teal-500 to-green-500", run: act(() => onOpenTool("rewrite")) },
    { label: "Translate", icon: <Languages size={18} />, accent: "from-amber-500 to-orange-500", run: act(() => onOpenTool("translate")) },
    { label: "Summarize", icon: <Inbox size={18} />, accent: "from-sky-500 to-cyan-500", run: act(() => onNavigate("inbox")) },
    { label: "Smart Reply", icon: <Reply size={18} />, accent: "from-violet-500 to-purple-500", run: act(() => onNavigate("smartReply")) },
    { label: "Compose", icon: <PenLine size={18} />, accent: "from-indigo-500 to-blue-500", run: act(onCompose) },
  ];

  return (
    <div className="fixed bottom-6 right-6 z-[90] flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={{ visible: { transition: { staggerChildren: 0.035 } } }}
            className="flex flex-col items-end gap-3"
          >
            {actions.map((a) => (
              <motion.button
                key={a.label}
                variants={{
                  hidden: { opacity: 0, y: 12, scale: 0.8 },
                  visible: { opacity: 1, y: 0, scale: 1 },
                }}
                onClick={a.run}
                className="group flex items-center gap-3"
              >
                <span className="rounded-lg border border-white/10 bg-ink-900/90 px-2.5 py-1 text-xs font-medium text-neutral-200 opacity-0 shadow-card backdrop-blur transition-opacity group-hover:opacity-100">
                  {a.label}
                </span>
                <span
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform group-hover:scale-110",
                    a.accent
                  )}
                >
                  {a.icon}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.9 }}
        aria-label={open ? "Close quick actions" : "Open quick actions"}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow"
      >
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 22 }}>
          <Plus size={26} />
        </motion.span>
      </motion.button>
    </div>
  );
}
