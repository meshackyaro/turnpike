import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface Receipt {
  at: string;
  service: string;
  route: string;
  /** Atomic units on that route. */
  amount: string;
  asset: string;
  usd: number;
  reason: string;
  settlementRef?: string;
  /** Routes the seller offered that the policy never got to weigh. */
  skipped: string[];
}

const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.turnpike",
);
const LOG = resolve(ROOT, "receipts.jsonl");

/**
 * Append-only so a crashed run cannot rewrite history, and so the dashboard can
 * tail it without coordinating with whoever is spending.
 */
export function appendReceipt(receipt: Receipt): void {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  appendFileSync(LOG, `${JSON.stringify(receipt)}\n`);
}

export function readReceipts(): Receipt[] {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Receipt];
      } catch {
        return [];
      }
    });
}

export const RECEIPTS_LOG = LOG;
