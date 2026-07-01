import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "glass" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  primary: "bg-white text-black hover:bg-neutral-200 shadow-lg",
  ghost: "text-neutral-300 hover:text-white hover:bg-white/5",
  glass: "glass glass-hover text-white",
  danger: "bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/20",
};

export function Button({ children, variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
