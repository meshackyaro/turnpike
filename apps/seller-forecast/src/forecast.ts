export interface Forecast {
  symbol: string;
  horizonHours: number;
  drift: number;
  volatility: number;
  band: { low: number; mid: number; high: number };
  generatedAt: string;
}

/**
 * Deterministic series so the same symbol yields the same forecast across calls —
 * a paid endpoint that returned noise would make settlement bugs impossible to spot.
 */
function series(symbol: string, points: number): number[] {
  let seed = 0;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;

  const out: number[] = [];
  let price = 100 + (seed % 400);
  for (let i = 0; i < points; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    price *= 1 + ((seed % 2000) / 1e5 - 0.01);
    out.push(price);
  }
  return out;
}

export function forecast(symbol: string, horizonHours = 24): Forecast {
  const prices = series(symbol, 168);

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);

  const last = prices[prices.length - 1];
  const drift = mean * horizonHours;
  const spread = sigma * Math.sqrt(horizonHours);
  const mid = last * Math.exp(drift);

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    symbol: symbol.toUpperCase(),
    horizonHours,
    drift: Number(drift.toFixed(6)),
    volatility: Number(spread.toFixed(6)),
    band: {
      low: round(mid * Math.exp(-1.96 * spread)),
      mid: round(mid),
      high: round(mid * Math.exp(1.96 * spread)),
    },
    generatedAt: new Date().toISOString(),
  };
}
