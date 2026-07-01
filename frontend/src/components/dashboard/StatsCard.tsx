import { type ReactNode } from "react";
import { GlassCard } from "../ui/GlassCard";
import { AnimatedCounter } from "../ui/AnimatedCounter";
import { Skeleton } from "../ui/Skeleton";
import { cn } from "../../lib/cn";

export function StatsCard({
  icon,
  label,
  value,
  description,
  accent = "from-indigo-500/40 to-fuchsia-500/30",
  loading = false,
  delay = 0,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  description?: string;
  accent?: string;
  loading?: boolean;
  delay?: number;
  onClick?: () => void;
}) {
  return (
    <GlassCard hover={!!onClick} onClick={onClick} delay={delay} className="p-5 group">
      {/* accent glow that intensifies on hover */}
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-40",
          accent
        )}
      />
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg",
          accent
        )}
      >
        {icon}
      </div>
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className="text-3xl font-bold tracking-tight text-white tabular-nums">
            <AnimatedCounter value={value} />
          </div>
        )}
        <p className="mt-1 text-sm font-semibold text-neutral-200">{label}</p>
        {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
      </div>
    </GlassCard>
  );
}
