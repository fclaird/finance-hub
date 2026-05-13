/** Recharts pie + allocation charts share this palette (earth tones). */
export const EARTH_TONE_PIE_COLORS = [
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

/** Extra hues so many underlyings do not repeat until palette + extras are exhausted. */
const EXTENDED_PIE_COLORS = [
  ...EARTH_TONE_PIE_COLORS,
  "#7c3aed", // violet
  "#db2777", // pink
  "#2563eb", // blue
  "#0891b2", // cyan
  "#65a30d", // lime
  "#c026d3", // fuchsia
  "#ea580c", // orange
  "#4f46e5", // indigo
  "#0d9488", // teal 600
  "#a16207", // yellow-700
  "#be123c", // rose 700
  "#475569", // slate 600
] as const;

export function distinctColorForIndex(i: number): string {
  if (i < EXTENDED_PIE_COLORS.length) return EXTENDED_PIE_COLORS[i]!;
  // Golden-angle hues for any further series (still stable per index).
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue} 72% 56%)`;
}

/**
 * One color per unique symbol, stable order: alphabetically (case-insensitive), with `"Other"` last.
 * Reuses the earth-tone palette in order; only wraps after all palette slots are used.
 */
export function assignEarthToneColorsBySymbols(symbols: string[]): Map<string, string> {
  const uniq = [...new Set(symbols.map((s) => (s ?? "").trim()).filter(Boolean))];
  const rest = uniq.filter((s) => s !== "Other").sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const ordered = [...rest];
  if (uniq.includes("Other")) ordered.push("Other");
  const m = new Map<string, string>();
  ordered.forEach((sym, i) => m.set(sym, distinctColorForIndex(i)));
  return m;
}
