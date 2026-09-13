/**
 * Live prices from CoinGecko's public API, hourly over the last seven days.
 * Chosen because it needs no key and is reachable where Coinbase, Kraken and
 * Binance's public endpoints were not.
 */
const SOURCE = "coingecko";

const COINS: Record<string, string> = {
  ETH: "ethereum",
  BTC: "bitcoin",
  HBAR: "hedera-hashgraph",
  SOL: "solana",
  AVAX: "avalanche-2",
  LINK: "chainlink",
};

export const SUPPORTED = Object.keys(COINS);

export class UnknownSymbolError extends Error {}
export class UpstreamError extends Error {}

export interface Forecast {
  symbol: string;
  spot: number;
  horizonHours: number;
  /** Expected log-return over the horizon. */
  drift: number;
  /** One standard deviation of log-return over the horizon. */
  volatility: number;
  /** 95% band under a lognormal assumption — a range, not a floor. */
  band: { low: number; mid: number; high: number };
  model: string;
  source: string;
  samples: number;
  asOf: string;
}

type Series = { prices: Array<[number, number]>; fetchedAt: number };

// The public API allows a handful of calls a minute. A paid endpoint that
// 429s under light demo traffic would be charging for failures, so prices are
// cached briefly and concurrent requests share one fetch.
const TTL_MS = 60_000;
const STALE_OK_MS = 15 * 60_000;
const cache = new Map<string, Series>();
const inflight = new Map<string, Promise<Series>>();

async function history(coin: string): Promise<Series> {
  const hit = cache.get(coin);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  const pending = inflight.get(coin);
  if (pending) return pending;

  const request = (async () => {
    const url =
      `https://api.coingecko.com/api/v3/coins/${coin}/market_chart` +
      `?vs_currency=usd&days=7`;
    let res: Response | undefined;
    let lastError: unknown;
    // Read-only, so retrying on any network error cannot double-charge anyone.
    for (let attempt = 0; attempt < 4 && !res; attempt++) {
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    if (!res) {
      throw new UpstreamError(
        `price feed unreachable: ${lastError instanceof Error ? lastError.message : lastError}`,
      );
    }
    if (!res.ok) throw new UpstreamError(`price feed returned HTTP ${res.status}`);

    const body = (await res.json()) as { prices?: Array<[number, number]> };
    if (!body.prices || body.prices.length < 24) {
      throw new UpstreamError("price feed returned too little history");
    }
    const series = { prices: body.prices, fetchedAt: Date.now() };
    cache.set(coin, series);
    return series;
  })();

  inflight.set(coin, request);
  try {
    return await request;
  } catch (error) {
    // Recent-but-stale beats a failure mid-demo. The response carries asOf, the
    // timestamp of the last price, so a consumer can see how old it is.
    const stale = cache.get(coin);
    if (stale && Date.now() - stale.fetchedAt < STALE_OK_MS) return stale;
    throw error;
  } finally {
    inflight.delete(coin);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function forecast(symbol: string, horizonHours = 24): Promise<Forecast> {
  const upper = symbol.toUpperCase();
  const coin = COINS[upper];
  if (!coin) {
    throw new UnknownSymbolError(
      `unsupported symbol ${upper}; supported: ${SUPPORTED.join(", ")}`,
    );
  }

  const { prices } = await history(coin);

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i][1] / prices[i - 1][1]));
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);

  const [lastTs, spot] = prices[prices.length - 1];
  const drift = mean * horizonHours;
  const spread = sigma * Math.sqrt(horizonHours);
  const mid = spot * Math.exp(drift);

  return {
    symbol: upper,
    spot: round(spot),
    horizonHours,
    drift: Number(drift.toFixed(6)),
    volatility: Number(spread.toFixed(6)),
    band: {
      low: round(mid * Math.exp(-1.96 * spread)),
      mid: round(mid),
      high: round(mid * Math.exp(1.96 * spread)),
    },
    model: "drift and volatility of hourly log-returns over 7 days, lognormal 95% band",
    source: SOURCE,
    samples: returns.length,
    asOf: new Date(lastTs).toISOString(),
  };
}
