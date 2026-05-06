"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/connections", label: "Connections" },
  { href: "/positions", label: "Positions" },
  { href: "/allocation", label: "Allocation" },
  { href: "/performance", label: "Performance" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white/70 p-4 backdrop-blur dark:border-white/10 dark:bg-black/40 md:block">
      <div className="px-2 py-2">
        <div className="text-sm font-semibold tracking-tight">Finance Hub</div>
        <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">Local-first</div>
      </div>
      <nav className="mt-3 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-400">
        Tip: use <span className="font-medium">Demo mode</span> on Connections to explore without linking accounts.
      </div>
    </aside>
  );
}

