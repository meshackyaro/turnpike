import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyPolicy, type SignedPolicy } from "@turnpike/wallet";
import type { RoutePolicy } from "@turnpike/wallet";

const SIGNED_POLICY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../custody/policy.signed.json",
);

export interface LoadedPolicy {
  policy: RoutePolicy;
  /** Device that authorised the caps, when one did. */
  signer?: string;
  source: "device" | "fallback";
}

const FALLBACK_CAPS: Record<string, string> = {
  "hedera:testnet|0.0.0": "5000000",
  "eip155:5042002|0x3600000000000000000000000000000000000000": "50000",
};

/**
 * Tricia will not spend under caps she could have written herself. If a
 * device-signed policy exists it must verify, and a failed verification is
 * fatal rather than a downgrade — silently falling back to defaults would
 * hand an attacker exactly the escalation the signature exists to prevent.
 */
export async function loadPolicy(preference: string[]): Promise<LoadedPolicy> {
  if (!existsSync(SIGNED_POLICY)) {
    return {
      policy: { preference, caps: FALLBACK_CAPS },
      source: "fallback",
    };
  }

  const signed = JSON.parse(readFileSync(SIGNED_POLICY, "utf8")) as SignedPolicy;
  const verdict = await verifyPolicy(signed, signed.signer);

  if (!verdict.ok) {
    throw new Error(
      `refusing to spend: signed policy failed verification — ${verdict.reason}`,
    );
  }

  return {
    policy: { preference, caps: verdict.policy.caps },
    signer: signed.signer,
    source: "device",
  };
}
