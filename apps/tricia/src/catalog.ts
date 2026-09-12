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
      "24-hour drift and volatility band for a market symbol. Returns a " +
      "low/mid/high price band and the volatility estimate behind it.",
    url: `${HOST}/forecast`,
    params: {
      symbol: "ticker, 1-10 letters, e.g. ETH",
      horizonHours: "optional forecast horizon in hours, 1-720, default 24",
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
