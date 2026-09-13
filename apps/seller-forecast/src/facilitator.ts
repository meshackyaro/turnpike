import { HTTPFacilitatorClient } from "@x402/core/server";

type Args<K extends "verify" | "settle"> = Parameters<HTTPFacilitatorClient[K]>;

/**
 * Error codes that mean the connection never opened, so the request cannot have
 * reached the facilitator. Anything else — a reset or a timeout mid-response —
 * may have landed.
 */
const NEVER_SENT = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT", // raised by connect(); undici reports response timeouts separately
]);

function codes(error: unknown): string[] {
  const found: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth++) {
    const e = current as { code?: string; cause?: unknown };
    if (typeof e.code === "string") found.push(e.code);
    current = e.cause;
  }
  return found;
}

const isNetwork = (error: unknown) =>
  error instanceof TypeError || codes(error).length > 0 ||
  /fetch failed|timed? ?out|ECONN|socket/i.test(String((error as Error)?.message));

const neverSent = (error: unknown) => codes(error).some((c) => NEVER_SENT.has(c));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The path to the public facilitator times out intermittently — roughly one
 * call in six during testing — and every one of those surfaced to the buyer as
 * a failed payment. Verify and capability lookups are read-only and retry on any
 * network error.
 *
 * Settle is not read-only: it submits a signed transfer. If a first attempt
 * reached the facilitator but the response was lost, resubmitting would at best
 * be rejected as a duplicate and at worst report failure for a payment that
 * went through. So settle retries only when the connection provably never
 * opened.
 */
export class RetryingFacilitatorClient extends HTTPFacilitatorClient {
  constructor(
    config: ConstructorParameters<typeof HTTPFacilitatorClient>[0],
    private readonly attempts = 6,
  ) {
    super(config);
  }

  private async withRetry<T>(
    label: string,
    call: () => Promise<T>,
    retryable: (error: unknown) => boolean,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.attempts; i++) {
      try {
        return await call();
      } catch (error) {
        lastError = error;
        if (!retryable(error) || i === this.attempts - 1) break;
        const wait = 300 * 2 ** i;
        console.warn(
          `[facilitator] ${label} attempt ${i + 1} failed (${codes(error).join(",") || (error as Error).message}); retrying in ${wait}ms`,
        );
        await sleep(wait);
      }
    }
    throw lastError;
  }

  override verify(...args: Args<"verify">) {
    return this.withRetry("verify", () => super.verify(...args), isNetwork);
  }

  override settle(...args: Args<"settle">) {
    return this.withRetry("settle", () => super.settle(...args), neverSent);
  }

  override getSupported() {
    return this.withRetry("supported", () => super.getSupported(), isNetwork);
  }
}
