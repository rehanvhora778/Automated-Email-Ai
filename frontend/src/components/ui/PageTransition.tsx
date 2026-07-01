import { type ReactNode } from "react";
import { motion } from "framer-motion";

/** Wraps a page so it fades/slides in on mount and on view change. */
export function PageTransition({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
