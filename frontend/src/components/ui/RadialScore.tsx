import { useId } from "react";
import { motion } from "framer-motion";
import { AnimatedCounter } from "./AnimatedCounter";

/** Circular gradient progress ring with an animated centre value. */
export function RadialScore({
  value,
  size = 148,
  stroke = 12,
  label,
  suffix,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  suffix?: string;
}) {
  const gradId = useId().replace(/:/g, "");
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.3, ease: "easeOut" }}
        />
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="flex items-baseline text-4xl font-bold tabular-nums text-white">
          <AnimatedCounter value={pct} />
          {suffix && <span className="ml-0.5 text-lg text-neutral-400">{suffix}</span>}
        </span>
        {label && (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
