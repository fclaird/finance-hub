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

export function FinancePiePanel({ title, buckets }: { title: string; buckets: PieBucket[] }) {
  const privacy = usePrivacy();
  const b = buckets[0];
  const data = (b?.byAsset ?? [])
    .filter((x) => x.marketValue > 0)
    .sort((a, b2) => b2.marketValue - a.marketValue || a.key.localeCompare(b2.key));
  const total = b?.totalMarketValue ?? 0;

  const labelLayout = (() => {
    const usedLeft: number[] = [];
    const usedRight: number[] = [];
    const minGap = 22;
    const placed = new Map<number, { x: number; y: number; x0: number; y0: number; x1: number; y1: number }>();
    const RAD = Math.PI / 180;

    function clamp(n: number, lo: number, hi: number) {
      return Math.min(hi, Math.max(lo, n));
    }

    function placeY(desiredY: number, used: number[]) {
      const sorted = used.slice().sort((a, b) => a - b);
      let i = 0;
      while (i < sorted.length && sorted[i]! < desiredY) i++;
      let y = desiredY;
      const above = i > 0 ? sorted[i - 1]! : null;
      const below = i < sorted.length ? sorted[i]! : null;
      if (above != null && y - above < minGap) y = above + minGap;
      if (below != null && below - y < minGap) y = below - minGap;
      if (above != null && y - above < minGap) y = above + minGap;
      used.push(y);
      return y;
    }

    function getPlacement(p: {
      index?: number;
      cx?: number;
      cy?: number;
      outerRadius?: number;
      midAngle?: number;
      viewBox?: { x?: number; y?: number; width?: number; height?: number };
    }) {
      const index = p.index ?? 0;
      const cx = p.cx ?? 0;
      const cy = p.cy ?? 0;
      const outerRadius = p.outerRadius ?? 0;
      const midAngle = p.midAngle ?? 0;
      const existing = placed.get(index);
      if (existing) return existing;

      const rightSide = Math.cos(-midAngle * RAD) >= 0;
      const used = rightSide ? usedRight : usedLeft;

      const x0 = cx + outerRadius * Math.cos(-midAngle * RAD);
      const y0 = cy + outerRadius * Math.sin(-midAngle * RAD);
      const x1 = cx + (outerRadius + 18) * Math.cos(-midAngle * RAD);
      const y1 = cy + (outerRadius + 18) * Math.sin(-midAngle * RAD);

      const vb = p.viewBox ?? {};
      const vbX = typeof vb.x === "number" ? vb.x : 0;
      const vbY = typeof vb.y === "number" ? vb.y : 0;
      const vbW = typeof vb.width === "number" ? vb.width : cx * 2 || 0;
      const vbH = typeof vb.height === "number" ? vb.height : cy * 2 || 0;
      const padX = 8;
      const padY = 8;
      const xMin = vbX + padX;
      const xMax = vbX + vbW - padX;
      const yMin = vbY + padY;
      const yMax = vbY + vbH - padY;

      const colOffset = vbW && vbW < 520 ? 48 : 78;
      const xColRaw = rightSide ? cx + outerRadius + colOffset : cx - outerRadius - colOffset;
      const xCol = clamp(xColRaw, xMin, xMax);

      const desiredY = clamp(y1, yMin, yMax);
      const yPlaced = clamp(placeY(desiredY, used), yMin, yMax);

      const out = { x: xCol, y: yPlaced, x0, y0, x1, y1 };
      placed.set(index, out);
      return out;
    }

    const label = (props: unknown) => {
      const p = props as {
        cx?: number;
        percent?: number;
        name?: string;
        index?: number;
        cy?: number;
        outerRadius?: number;
        midAngle?: number;
        viewBox?: { x?: number; y?: number; width?: number; height?: number };
      };
      if ((p.percent ?? 0) < 0.008) return null;
      const pos = getPlacement(p);
      const cx = p.cx ?? 0;
      const textAnchor = pos.x >= cx ? "start" : "end";
      const pct = `${((p.percent ?? 0) * 100).toFixed(1)}%`;
      return (
        <text
          x={pos.x}
          y={pos.y}
          textAnchor={textAnchor}
          dominantBaseline="central"
          className="fill-zinc-700 text-lg font-semibold dark:fill-zinc-200"
        >
          {p.name ?? "—"} {pct}
        </text>
      );
    };

    const labelLine = (props: unknown) => {
      const p = props as {
        percent?: number;
        index?: number;
        cx?: number;
        cy?: number;
        outerRadius?: number;
        midAngle?: number;
        viewBox?: { x?: number; y?: number; width?: number; height?: number };
      };
      if ((p.percent ?? 0) < 0.008) return <path d="" fill="none" stroke="none" />;
      const pos = getPlacement(p);
      const d = `M ${pos.x0.toFixed(2)} ${pos.y0.toFixed(2)} L ${pos.x1.toFixed(2)} ${pos.y1.toFixed(2)} L ${pos.x.toFixed(2)} ${pos.y.toFixed(2)}`;
      return <path d={d} fill="none" stroke="#a1a1aa" strokeWidth={1.5} />;
    };

    return { label, labelLine };
  })();

  return (
    <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{formatUsd2(total, { mask: privacy.masked })}</div>
      </div>

      <div className="mt-4 h-[36rem] w-full min-h-[24rem] min-w-0">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600 dark:text-zinc-400">
            No data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
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
                              <span className="text-zinc-600 dark:text-zinc-400">{formatUsd2(c.marketValue, { mask: privacy.masked })}</span>
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
                innerRadius={84}
                outerRadius={255}
                paddingAngle={0.5}
                labelLine={labelLayout.labelLine}
                label={labelLayout.label}
              >
                {data.map((entry, idx) => (
                  <Cell key={entry.key} fill={distinctColorForIndex(idx)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
