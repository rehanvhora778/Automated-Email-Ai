import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

/** Animated progress bar with a gradient fill and optional label row. */
export function ProgressBar({
  value,
  max = 100,
  label,
  hint,
  accent = "from-brand-500 to-fuchsia-500",
  delay = 0,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  hint?: string;
  accent?: string;
  delay?: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("w-full", className)}>
      {(label || hint) && (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          {label && <span className="font-medium text-neutral-300">{label}</span>}
          {hint && <span className="tabular-nums text-neutral-500">{hint}</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, delay, ease: "easeOut" }}
          className={cn("h-full rounded-full bg-gradient-to-r", accent)}
        />
      </div>
    </div>
  );
}
