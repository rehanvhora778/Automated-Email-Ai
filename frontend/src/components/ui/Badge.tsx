import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-white/10 text-neutral-300 border-white/10",
  brand: "bg-brand-500/15 text-brand-200 border-brand-500/25",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  danger: "bg-rose-500/15 text-rose-300 border-rose-500/25",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/25",
};

/** Compact status pill. */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
