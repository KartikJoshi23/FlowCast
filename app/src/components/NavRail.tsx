import { motion } from "motion/react";
import { ROUTES } from "../app/routes";
import { IconDrop } from "./icons";

/** Left navigation (icon rail on small screens, labelled rail on large screens). */
export function NavRail({ active }: { active: string }) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="glass glass-strong sticky top-3 z-20 flex h-auto flex-row items-center gap-1 overflow-x-auto p-2 [scrollbar-width:thin] [scrollbar-color:rgba(150,200,255,0.15)_transparent] lg:h-[calc(100vh-1.5rem)] lg:w-60 lg:flex-col lg:items-stretch lg:overflow-visible lg:p-3"
    >
      <a href="#/" className="mr-2 flex shrink-0 items-center gap-2.5 rounded-xl px-2 py-1.5 lg:mb-4 lg:mr-0 lg:px-2.5 lg:py-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-b from-accent/30 to-m-naive/30 text-accent ring-1 ring-accent/30">
          <IconDrop size={18} />
        </span>
        <span className="hidden lg:block">
          <span className="block text-[15px] font-semibold tracking-tight text-ink-1">FlowCast</span>
          <span className="block text-[11.5px] text-ink-3">Flavored-water demand</span>
        </span>
      </a>
      {ROUTES.map((route) => {
        const isActive = route.id === active;
        return (
          <a
            key={route.id}
            href={`#/${route.id}`}
            aria-current={isActive ? "page" : undefined}
            title={route.label}
            className={`relative flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
              isActive ? "text-ink-1" : "text-ink-3 hover:bg-white/5 hover:text-ink-2"
            }`}
          >
            {isActive && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-xl bg-accent/12 ring-1 ring-accent/25"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{route.icon}</span>
            <span className="relative hidden lg:inline">{route.label}</span>
          </a>
        );
      })}
      <div className="mt-auto hidden px-2.5 pt-4 text-[11px] leading-relaxed text-ink-3 lg:block">
        AI in Operations · MAIB
        <br />
        Data: Kaggle FMCG 2022–2024 (CC0, synthetic)
      </div>
    </nav>
  );
}
