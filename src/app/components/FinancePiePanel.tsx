"use client";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const EARTH_TONE_PIE_COLORS = [
  "#0f766e", // deep teal
  "#4d7c0f", // rich olive
  "#c2410f", // warm terracotta
  "#d97706", // golden amber
  "#10b981", // vibrant forest green
  "#b45309", // earthy brown-orange
  "#14b8a6", // sage teal
  "#b91c1c", // burnt sienna
  "#166534", // deep moss
  "#ca8a04", // warm ochre
] as const;

function distinctColorForIndex(i: number) {
  return EARTH_TONE_PIE_COLORS[i % EARTH_TONE_PIE_COLORS.length]!;
}

export type PieSliceConstituent = { symbol: string; marketValue: number };

export type PieBucket = {
  label: string;
  totalMarketValue: number;
  byAsset: Array<{
    key: string;
    marketValue: number;
    weight: number;
    constituents?: PieSliceConstituent[];
  }>;
};

export function FinancePiePanel({
  title,
  buckets,
  emptyMessage,
}: {
  title: string;
  buckets: PieBucket[];
  /** Shown when every slice is filtered out (e.g. all synthetic MV are zero). */
  emptyMessage?: string;
}) {
  const privacy = usePrivacy();
  const b = buckets[0];
  const rawAssets = b?.byAsset ?? [];
  const data = rawAssets
    .filter((x) => x.marketValue > 0)
    .sort((a, b2) => b2.marketValue - a.marketValue || a.key.localeCompare(b2.key));
  const total = b?.totalMarketValue ?? 0;

  return (
    <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm font-semibold">{title}</div>
        <div className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
          Total {formatUsd2(total, { mask: privacy.masked })}
        </div>
      </div>

      <div className="mt-4 min-h-[16rem] w-full min-w-0 overflow-visible">
        {data.length === 0 ? (
          <div className="flex h-full max-w-md flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">
            <span>{emptyMessage ?? "No data yet."}</span>
          </div>
        ) : (
          <>
            <div className="h-[min(28rem,55vw)] w-full min-h-[14rem] overflow-visible">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={120}
                minHeight={224}
                initialDimension={{ width: 400, height: 280 }}
              >
                <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as {
                        key?: string;
                        marketValue?: number;
                        constituents?: PieSliceConstituent[];
                      };
                      const mv = Number(row.marketValue);
                      if (!Number.isFinite(mv)) return null;
                      const pct = total ? mv / total : 0;
                      const label = row.key ?? "—";
                      const list = row.constituents?.filter((c) => c.marketValue > 0) ?? [];
                      return (
                        <div className="max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-md dark:border-white/20 dark:bg-zinc-900">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{label}</div>
                          <div className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {formatUsd2(mv, { mask: privacy.masked })} ({PCT2.format(pct * 100)}%)
                          </div>
                          {list.length ? (
                            <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto border-t border-zinc-200 pt-2 text-xs dark:border-white/20">
                              {list.map((c) => (
                                <li key={c.symbol} className="flex justify-between gap-4 tabular-nums">
                                  <span className="font-medium text-zinc-800 dark:text-zinc-200">{c.symbol}</span>
                                  <span className="text-zinc-600 dark:text-zinc-400">
                                    {formatUsd2(c.marketValue, { mask: privacy.masked })}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={data}
                    dataKey="marketValue"
                    nameKey="key"
                    stroke="none"
                    isAnimationActive={false}
                    innerRadius="34%"
                    outerRadius="72%"
                    paddingAngle={0.5}
                    label={false}
                  >
                    {data.map((entry, idx) => (
                      <Cell key={entry.key} fill={distinctColorForIndex(idx)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div
              className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-zinc-200/90 bg-zinc-50/80 px-2 py-2 dark:border-white/15 dark:bg-zinc-900/50"
              aria-label="Slice breakdown"
            >
              <ul className="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {data.map((slice, idx) => {
                  const mv = slice.marketValue;
                  const pct = total ? mv / total : 0;
                  return (
                    <li
                      key={slice.key}
                      className="flex min-w-0 items-baseline gap-2 rounded-md px-1 py-0.5 tabular-nums text-zinc-800 dark:text-zinc-200"
                    >
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: distinctColorForIndex(idx) }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-medium" title={slice.key}>
                        {slice.key}
                      </span>
                      <span className="shrink-0 text-zinc-600 dark:text-zinc-400">{PCT2.format(pct * 100)}%</span>
                      <span className="shrink-0 font-semibold text-zinc-900 dark:text-zinc-50">
                        {formatUsd2(mv, { mask: privacy.masked })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
