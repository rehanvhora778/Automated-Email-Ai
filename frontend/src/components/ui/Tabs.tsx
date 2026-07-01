import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

/** Segmented tab bar with an animated sliding indicator (Linear/Arc style). */
export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02] p-1",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {items.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
              isActive ? "text-white" : "text-neutral-400 hover:text-white"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.08] shadow-inner"
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {t.icon}
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    isActive ? "bg-brand-500/30 text-brand-200" : "bg-white/10 text-neutral-400"
                  )}
                >
                  {t.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
