import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

const LEVELS = [
  "bg-white/[0.04]",
  "bg-brand-500/25",
  "bg-brand-500/45",
  "bg-brand-500/70",
  "bg-brand-400",
];

const DAYS = ["", "M", "", "W", "", "F", ""];

/**
 * GitHub-style contribution grid. `weeks` is an array (columns) of 7-day
 * arrays (rows), each cell a 0-4 intensity level.
 */
export function ActivityHeatmap({
  weeks,
  className,
}: {
  weeks: number[][];
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      <div className="flex flex-col justify-between py-0.5 text-[9px] text-neutral-600">
        {DAYS.map((d, i) => (
          <span key={i} className="h-3 leading-3">{d}</span>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((level, di) => (
              <motion.span
                key={di}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: (wi * 7 + di) * 0.004, duration: 0.2 }}
                title={`${level * 3} emails`}
                className={cn("h-3 w-3 rounded-[3px]", LEVELS[Math.max(0, Math.min(4, level))])}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Legend row for the heatmap intensity scale. */
export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
      <span>Less</span>
      {LEVELS.map((c, i) => (
        <span key={i} className={cn("h-3 w-3 rounded-[3px]", c)} />
      ))}
      <span>More</span>
    </div>
  );
}
