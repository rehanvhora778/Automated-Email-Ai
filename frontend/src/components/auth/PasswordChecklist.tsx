import { Check, X } from "lucide-react";
import { PASSWORD_RULES, passwordScore } from "../../lib/passwordPolicy";
import { cn } from "../../lib/cn";

/**
 * Live view of which password requirements are met.
 *
 * Shown while typing rather than as an error after submitting: a list of rules
 * you can watch yourself satisfy is far less irritating than guessing at what
 * "invalid password" meant. Stays hidden until the field has something in it,
 * so an untouched form is not covered in red crosses.
 */
export function PasswordChecklist({ value, className }: { value: string; className?: string }) {
  if (!value) return null;

  const score = passwordScore(value);
  const total = PASSWORD_RULES.length;
  const tone =
    score === total ? "bg-emerald-400" : score >= total - 2 ? "bg-amber-400" : "bg-rose-400";

  return (
    <div className={cn("space-y-2", className)}>
      {/* Strength bar — one segment per rule, so it maps to the list below. */}
      <div className="flex gap-1" aria-hidden="true">
        {PASSWORD_RULES.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < score ? tone : "bg-white/10"
            )}
          />
        ))}
      </div>

      <ul className="grid gap-1 sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li
              key={rule.label}
              className={cn(
                "flex items-center gap-1.5 text-[11px] transition-colors",
                ok ? "text-emerald-400" : "text-neutral-500"
              )}
            >
              {ok ? <Check size={12} className="shrink-0" /> : <X size={12} className="shrink-0" />}
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
