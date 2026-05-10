"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SVGProps } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type PieLabelRenderProps } from "recharts";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RAD = Math.PI / 180;

/** Match Recharts `polarToCartesian` (angle in degrees, 0° = 3 o'clock). */
function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  return {
    x: cx + Math.cos(-RAD * angleDeg) * radius,
    y: cy + Math.sin(-RAD * angleDeg) * radius,
  };
}

/**
 * Mid-angle per slice (same order as `data`).
 * Mirrors Recharts defaults startAngle 0, endAngle 360, and padding between sectors.
 */
function approximateMidAngles(values: number[], paddingDeg = 0.5): number[] {
  const startAngle = 0;
  const endAngle = 360;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0) return values.map(() => startAngle);
  const n = values.length;
  const totalPad = paddingDeg * n;
  const available = endAngle - startAngle - totalPad;
  let cursor = startAngle + paddingDeg / 2;
  const mids: number[] = [];
  for (const v of values) {
    const span = (v / sum) * available;
    mids.push(cursor + span / 2);
    cursor += span + paddingDeg;
  }
  return mids;
}

/** +1 if label should extend toward +X, -1 toward −X (split left/right sides of pie). */
function lateralSign(midDeg: number): 1 | -1 {
  return Math.cos(-RAD * midDeg) >= 0 ? 1 : -1;
}

/**
 * Estimate chart center and outer radius using the **same** pixel width/height Recharts uses
 * inside ResponsiveContainer (must match margins on PieChart).
 */
function estimatePieLayout(
  chartW: number,
  chartH: number,
  margin: { top: number; right: number; bottom: number; left: number },
  outerFrac: number,
) {
  const innerW = Math.max(0, chartW - margin.left - margin.right);
  const innerH = Math.max(0, chartH - margin.top - margin.bottom);
  const maxRadius = Math.min(innerW, innerH) / 2;
  const cx = margin.left + innerW / 2;
  const cy = margin.top + innerH / 2;
  const outerRadius = maxRadius * outerFrac;
  return { cx, cy, outerRadius, chartW, chartH };
}

/** Vertical band for labels (same math as fitElbowText). */
function labelYBand(chartH: number, labelFontPx: number) {
  const pad = Math.max(6, labelFontPx * 0.35);
  return { minY: pad + labelFontPx * 0.55, maxY: chartH - pad - labelFontPx * 0.55 };
}

/** Keep elbow + label text inside the SVG (ResponsiveContainer coordinate system). */
function fitElbowText(
  chartW: number,
  chartH: number,
  labelFontPx: number,
  maxTextReservePx: number,
  elbowIn: { x: number; y: number },
  sign: 1 | -1,
  textPad: number,
  pivotX: number,
): { elbow: { x: number; y: number }; lx: number; ly: number } {
  const { minY, maxY } = labelYBand(chartH, labelFontPx);
  const pad = Math.max(6, labelFontPx * 0.35);
  const minX = pad;
  const maxX = chartW - pad;
  const maxLx = maxX - maxTextReservePx;
  const minLx = minX + maxTextReservePx;

  const ey = Math.max(minY, Math.min(maxY, elbowIn.y));

  let ex: number;
  let lx: number;
  if (sign > 0) {
    ex = Math.max(elbowIn.x, pivotX);
    lx = ex + textPad;
    if (lx > maxLx) {
      lx = maxLx;
      ex = lx - textPad;
      if (ex < pivotX) {
        ex = pivotX;
        lx = ex + textPad;
      }
    }
  } else {
    ex = Math.min(elbowIn.x, pivotX);
    lx = ex - textPad;
    if (lx < minLx) {
      lx = minLx;
      ex = lx + textPad;
      if (ex > pivotX) {
        ex = pivotX;
        lx = ex - textPad;
      }
    }
  }

  const ly = Math.max(minY, Math.min(maxY, ey));
  return { elbow: { x: ex, y: ly }, lx, ly };
}

/** Enforce minimum vertical gap between adjacent label Y positions without stretching to fill the band. */
function packLabelsVertical(py: number[], minY: number, maxY: number, gap: number): number[] {
  const m = py.length;
  if (m === 0) return [];
  const y = py.map((p) => Math.max(minY, Math.min(maxY, p)));
  for (let iter = 0; iter < m + 4; iter++) {
    for (let i = 1; i < m; i++) {
      if (y[i]! < y[i - 1]! + gap) y[i] = y[i - 1]! + gap;
    }
    if (y[m - 1]! <= maxY) {
      for (let i = m - 2; i >= 0; i--) {
        if (y[i]! > y[i + 1]! - gap) y[i] = y[i + 1]! - gap;
      }
      break;
    }
    const overflow = y[m - 1]! - maxY;
    for (let i = 0; i < m; i++) y[i]! -= overflow;
    for (let i = m - 2; i >= 0; i--) {
      if (y[i]! > y[i + 1]! - gap) y[i] = y[i + 1]! - gap;
    }
    if (y[0]! >= minY) continue;
    const under = minY - y[0]!;
    for (let i = 0; i < m; i++) y[i]! += under;
  }
  return y;
}

/**
 * Per-side Y layout: keep labels near their slice (minimal shift), only separate when closer than `labelGapPx`.
 * Horizontal arm stagger is only added when packing compresses a side vertically (many labels, tight band).
 */
function computeLabelSpread(
  midAngles: number[],
  cx: number,
  cy: number,
  rKnee: number,
  minY: number,
  maxY: number,
  labelGapPx: number,
  staggerArmPx: number,
): { yShift: number[]; extraArmPx: number[] } {
  const n = midAngles.length;
  const yShift = new Array(n).fill(0);
  const extraArmPx = new Array(n).fill(0);

  for (const side of [1, -1] as const) {
    const items = midAngles
      .map((mid, i) => ({
        i,
        mid,
        py: polarToCartesian(cx, cy, rKnee, mid).y,
      }))
      .filter((t) => lateralSign(t.mid) === side)
      .sort((a, b) => a.py - b.py);

    const m = items.length;
    if (m === 0) continue;

    if (m === 1) {
      const t = items[0]!;
      const clamped = Math.max(minY, Math.min(maxY, t.py));
      yShift[t.i] = clamped - t.py;
      continue;
    }

    const pySorted = items.map((t) => t.py);
    const packed = packLabelsVertical(pySorted, minY, maxY, labelGapPx);
    items.forEach((t, rank) => {
      yShift[t.i] = packed[rank]! - t.py;
    });

    const naturalSpan = pySorted[m - 1]! - pySorted[0]!;
    const packedSpan = packed[m - 1]! - packed[0]!;
    const compressed =
      naturalSpan > labelGapPx * 2 && packedSpan < naturalSpan * 0.72 && m >= 4;
    if (compressed) {
      items.forEach((t, rank) => {
        extraArmPx[t.i] = (rank % 3) * staggerArmPx;
      });
    }
  }

  return { yShift, extraArmPx };
}

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

function useCompactPieLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return compact;
}

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
  const compact = useCompactPieLayout();
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [measuredChart, setMeasuredChart] = useState<{ w: number; h: number } | null>(null);
  const b = buckets[0];
  const rawAssets = b?.byAsset ?? [];
  const data = rawAssets
    .filter((x) => x.marketValue > 0)
    .sort((a, b2) => b2.marketValue - a.marketValue || a.key.localeCompare(b2.key));

  useLayoutEffect(() => {
    if (data.length === 0) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      if (w > 0 && h > 0) setMeasuredChart({ w: Math.round(w), h: Math.round(h) });
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.length, compact]);
  const total = b?.totalMarketValue ?? 0;

  const labelFontPx = compact ? 11 : 24;
  const textPad = compact ? 6 : 10;
  /** Radial segment from slice rim to pivot — keep short unless packing forces horizontal stagger. */
  const radialToPivot = compact ? 28 : 44;
  /** Horizontal arm from pivot toward label (baseline; stagger adds more only when vertically compressed). */
  const horizontalArm = compact ? 28 : 44;
  /** Extra horizontal arm when many same-side labels are packed tighter than their natural angular spread. */
  const staggerArmPx = compact ? 12 : 18;
  /** Reserve horizontal space for longest label + staggered arms (approximate). */
  const maxTextReservePx = compact ? 112 : 330;

  const pieMargin = useMemo(
    () =>
      compact
        ? { top: 52, right: 68, bottom: 52, left: 68 }
        : { top: 80, right: 112, bottom: 80, left: 112 },
    [compact],
  );
  const innerR = compact ? "28%" : "34%";
  const outerR = compact ? "82%" : "66%";

  const midAngles = useMemo(() => approximateMidAngles(data.map((d) => d.marketValue), 0.5), [data]);
  const outerFrac = compact ? 0.82 : 0.66;
  const defaultDims = compact ? { w: 360, h: 320 } : { w: 800, h: 560 };
  const chartW = measuredChart?.w ?? defaultDims.w;
  const chartH = measuredChart?.h ?? defaultDims.h;
  const { cx: estCx, cy: estCy, outerRadius: estOuterR } = useMemo(
    () => estimatePieLayout(chartW, chartH, pieMargin, outerFrac),
    [chartW, chartH, pieMargin, outerFrac],
  );
  const { minY: labelMinY, maxY: labelMaxY } = useMemo(() => labelYBand(chartH, labelFontPx), [chartH, labelFontPx]);
  const labelGapPx = Math.max(12, labelFontPx * 1.12);
  const { yShift: labelYShifts, extraArmPx } = useMemo(() => {
    const rKnee = estOuterR + radialToPivot;
    return computeLabelSpread(
      midAngles,
      estCx,
      estCy,
      rKnee,
      labelMinY,
      labelMaxY,
      labelGapPx,
      staggerArmPx,
    );
  }, [
    midAngles,
    estCx,
    estCy,
    estOuterR,
    radialToPivot,
    labelMinY,
    labelMaxY,
    labelGapPx,
    staggerArmPx,
  ]);

  return (
    <div className="w-full min-w-0 rounded-xl border border-zinc-300 p-3 sm:p-4 dark:border-white/20">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="min-w-0 text-sm font-semibold">{title}</div>
        <div className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
          Total {formatUsd2(total, { mask: privacy.masked })}
        </div>
      </div>

      <div className={"mt-3 w-full min-w-0 overflow-x-auto sm:mt-4 " + (compact ? "min-h-[18rem]" : "min-h-[32rem]")}>
        {data.length === 0 ? (
          <div className="flex h-full max-w-md flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">
            <span>{emptyMessage ?? "No data yet."}</span>
          </div>
        ) : (
          <>
            <div
              ref={chartWrapRef}
              className={
                compact
                  ? "h-[min(22rem,70vh)] w-full min-h-[16rem] overflow-visible"
                  : "h-[min(56rem,110vw)] w-full min-h-[28rem] overflow-visible"
              }
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={100}
                minHeight={compact ? 240 : 448}
                initialDimension={{ width: compact ? 360 : 800, height: compact ? 320 : 560 }}
              >
                <PieChart margin={pieMargin}>
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
                    innerRadius={innerR}
                    outerRadius={outerR}
                    paddingAngle={0.5}
                    labelLine={(
                      lineProps: SVGProps<SVGPathElement> & {
                        points?: Array<{ x: number; y: number }>;
                        cx?: number;
                        cy?: number;
                        outerRadius?: number;
                        midAngle?: number;
                        index?: number;
                      },
                    ) => {
                      const pts = lineProps.points;
                      const cx = Number(lineProps.cx);
                      const cy = Number(lineProps.cy);
                      const outerR = Number(lineProps.outerRadius);
                      const mid = lineProps.midAngle;
                      const idx = lineProps.index ?? 0;
                      if (!pts?.[0] || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(outerR) || mid == null || !Number.isFinite(mid)) {
                        return <g />;
                      }
                      const p0 = pts[0];
                      const pivot = polarToCartesian(cx, cy, outerR + radialToPivot, mid);
                      const sign = lateralSign(mid);
                      const yShift = labelYShifts[idx] ?? 0;
                      const arm = horizontalArm + (extraArmPx[idx] ?? 0);
                      const elbowRaw = { x: pivot.x + sign * arm, y: pivot.y + yShift };
                      const { elbow } = fitElbowText(
                        chartW,
                        chartH,
                        labelFontPx,
                        maxTextReservePx,
                        elbowRaw,
                        sign,
                        textPad,
                        pivot.x,
                      );
                      const stroke = typeof lineProps.stroke === "string" ? lineProps.stroke : "#71717a";
                      return (
                        <path
                          d={`M${p0.x},${p0.y}L${pivot.x},${pivot.y}L${elbow.x},${elbow.y}`}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={1.5}
                          strokeLinejoin="round"
                          className="recharts-pie-label-line"
                        />
                      );
                    }}
                    label={(props: PieLabelRenderProps) => {
                      const p = typeof props.percent === "number" && Number.isFinite(props.percent) ? props.percent : 0;
                      if (p <= 0) {
                        return null;
                      }
                      const { cx, cy, outerRadius, midAngle, name, index } = props;
                      const cxN = Number(cx);
                      const cyN = Number(cy);
                      const outerR = Number(outerRadius);
                      const mid = midAngle;
                      const idx = typeof index === "number" ? index : 0;
                      if (!Number.isFinite(cxN) || !Number.isFinite(cyN) || !Number.isFinite(outerR) || mid == null || !Number.isFinite(mid)) {
                        return null;
                      }
                      const sign = lateralSign(mid);
                      const yShift = labelYShifts[idx] ?? 0;
                      const pivot = polarToCartesian(cxN, cyN, outerR + radialToPivot, mid);
                      const arm = horizontalArm + (extraArmPx[idx] ?? 0);
                      const elbowRaw = { x: pivot.x + sign * arm, y: pivot.y + yShift };
                      const fit = fitElbowText(
                        chartW,
                        chartH,
                        labelFontPx,
                        maxTextReservePx,
                        elbowRaw,
                        sign,
                        textPad,
                        pivot.x,
                      );
                      const { lx, ly } = fit;
                      const anchor: "start" | "end" = sign > 0 ? "start" : "end";
                      const raw = String(name ?? "").trim();
                      const maxLen = compact ? 12 : 22;
                      const short = raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
                      return (
                        <text
                          x={lx}
                          y={ly}
                          textAnchor={anchor}
                          dominantBaseline="central"
                          fill="currentColor"
                          className="text-zinc-800 dark:text-zinc-200"
                          style={{ fontSize: labelFontPx, fontWeight: 600 }}
                        >
                          {compact ? `${PCT2.format(p * 100)}%` : `${short} ${PCT2.format(p * 100)}%`}
                        </text>
                      );
                    }}
                  >
                    {data.map((entry, idx) => (
                      <Cell key={entry.key} fill={distinctColorForIndex(idx)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
