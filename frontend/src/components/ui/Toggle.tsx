import { motion } from "framer-motion";
import { cn } from "../../lib/cn";

/** Accessible on/off switch with a spring-animated knob. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
        checked ? "border-brand-500/40 bg-brand-500/70" : "border-white/10 bg-white/[0.06]"
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 34 }}
        className={cn(
          "ml-0.5 h-5 w-5 rounded-full bg-white shadow-md",
          checked && "ml-auto mr-0.5"
        )}
      />
    </button>
  );
}
