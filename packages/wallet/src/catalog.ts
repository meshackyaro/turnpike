export interface Service {
  id: string;
  /** Human-readable name. Becomes an ENS subname if that path ever opens up. */
  name: string;
  description: string;
  url: string;
  /** Query parameters the service accepts, described for the model. */
  params: Record<string, string>;
}

const HOST = process.env.TURNPIKE_HOST ?? "http://localhost:4021";

/**
 * The service catalog. This was going to be resolved from ENS text records;
 * ENSv2 writes turned out not to be reachable on Sepolia, so discovery reads
 * from here instead. The shape is unchanged — id, endpoint, params — so the
 * swap is a resolver call, not a redesign.
 */
export const CATALOG: Service[] = [
  {
    id: "forecast",
    name: "forecast.turnpike",
    description:
      "Live spot price and a forecast band, computed from the last 7 days of " +
      "hourly prices (CoinGecko). Returns spot; driftOverHorizon and " +
      "volatilityOverHorizon (both for the whole horizon, as log-returns); " +
      "hourlyVolatility (per hour); a 95% low/mid/high band; the sample count; " +
      "and asOf, the timestamp of the last price.",
    url: `${HOST}/forecast`,
    params: {
      symbol: "one of ETH, BTC, HBAR, SOL, AVAX, LINK",
      horizonHours: "optional horizon in hours, 1-720, default 24",
    },
  },
];

export function findService(id: string): Service | undefined {
  return CATALOG.find((s) => s.id === id);
}

export function buildUrl(service: Service, args: Record<string, unknown>): string {
  const url = new URL(service.url);
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}
