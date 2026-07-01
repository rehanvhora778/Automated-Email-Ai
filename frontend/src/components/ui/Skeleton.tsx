import { cn } from "../../lib/cn";

/** Shimmering placeholder block shown while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}
