"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";

export function Drift({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end 35%"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [36, -12]);

  return (
    <motion.div ref={ref} className={className ? `drift ${className}` : "drift"} style={{ y }}>
      {children}
    </motion.div>
  );
}
