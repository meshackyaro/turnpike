import { hashMessage, recoverAddress, type Hex } from "viem";

export interface SpendPolicy {
  version: 1;
  /** The agent's hot address — the key that lives in the process. */
  agent: string;
  /** Hard per-call ceiling in atomic units, keyed `network|asset`. */
  caps: Record<string, string>;
  issuedAt: number;
  expiresAt: number;
}

export interface SignedPolicy {
  policy: SpendPolicy;
  signature: Hex;
  /** Address of the signer that authorised it — the device. */
  signer: string;
}

/**
 * Canonical form is what gets signed. Key order is fixed so that a policy
 * re-serialized by the agent hashes identically — otherwise verification would
 * fail on formatting rather than on tampering, and the demo would lie.
 */
export function canonicalize(policy: SpendPolicy): string {
  const caps = Object.keys(policy.caps)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = policy.caps[k];
      return acc;
    }, {});

  return JSON.stringify({
    version: policy.version,
    agent: policy.agent.toLowerCase(),
    caps,
    issuedAt: policy.issuedAt,
    expiresAt: policy.expiresAt,
  });
}

export type PolicyVerdict =
  | { ok: true; policy: SpendPolicy }
  | { ok: false; reason: string };

/**
 * The agent runs this before spending anything. It proves the policy in hand is
 * the one the device signed — not one the process edited afterwards.
 */
export async function verifyPolicy(
  signed: SignedPolicy,
  expectedSigner: string,
): Promise<PolicyVerdict> {
  const message = canonicalize(signed.policy);

  let recovered: string;
  try {
    recovered = await recoverAddress({
      hash: hashMessage(message),
      signature: signed.signature,
    });
  } catch (error) {
    return {
      ok: false,
      reason: `signature malformed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
    return {
      ok: false,
      reason: `signed by ${recovered}, not the device ${expectedSigner} — policy was altered after signing`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > signed.policy.expiresAt) {
    return { ok: false, reason: `policy expired at ${signed.policy.expiresAt}` };
  }

  return { ok: true, policy: signed.policy };
}
