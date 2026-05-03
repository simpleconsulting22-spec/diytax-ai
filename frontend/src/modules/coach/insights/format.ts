// Tiny formatting helpers shared across insight generators.

export function fmtUsd(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs < 100) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}
