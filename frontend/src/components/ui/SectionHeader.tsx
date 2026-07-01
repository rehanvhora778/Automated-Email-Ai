import { type ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl glass text-brand-400">
            {icon}
          </div>
        )}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-300">{title}</h2>
          {subtitle && <p className="text-xs text-neutral-600 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
