import { motion } from "motion/react";
import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="px-1">
      <h2 className="text-[22px] font-semibold tracking-tight text-ink-1 sm:text-[26px]">{title}</h2>
      {children && <div className="mt-1.5 max-w-4xl text-[14px] leading-relaxed text-ink-2">{children}</div>}
    </motion.div>
  );
}
