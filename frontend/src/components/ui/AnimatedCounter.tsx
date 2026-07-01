import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

/** Smoothly counts up (or down) to `value` whenever it changes. */
export function AnimatedCounter({
  value,
  duration = 1.1,
}: {
  value: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    const controls = animate(prev.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration]);

  return <>{display.toLocaleString()}</>;
}
