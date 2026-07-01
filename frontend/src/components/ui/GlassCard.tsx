import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
  onClick?: () => void;
  delay?: number;
}

/** Glassmorphic surface with an animated entrance and a subtle top sheen. */
export function GlassCard({
  children,
  className,
  hover = false,
  glow = false,
  onClick,
  delay = 0,
}: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      onClick={onClick}
      className={cn(
        "relative rounded-3xl glass shadow-card overflow-hidden",
        hover && "glass-hover hover:-translate-y-1 cursor-pointer",
        glow && "shadow-glow",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {children}
    </motion.div>
  );
}
