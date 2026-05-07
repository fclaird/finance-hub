const USD2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function maskUsd(): string {
  return "XXXXX";
}

export function formatUsd2(v: number | null | undefined, opts?: { mask?: boolean }): string {
  if (opts?.mask) return maskUsd();
  const n = typeof v === "number" ? v : v == null ? null : Number(v);
  if (n == null || !Number.isFinite(n)) return "-";
  return `$${USD2.format(n)}`;
}

export function formatUsdCompact(v: number | null | undefined, opts?: { mask?: boolean }): string {
  if (opts?.mask) return maskUsd();
  const n = typeof v === "number" ? v : v == null ? null : Number(v);
  if (n == null || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

