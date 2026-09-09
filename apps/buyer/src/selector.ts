import type { PaymentRequirements } from "@x402/core/types";

export interface RoutePolicy {
  /** Networks this buyer can actually sign for, best first. */
  preference: string[];
  /** Hard per-call ceiling in the asset's atomic units, keyed `network|asset`. */
  caps: Record<string, string>;
}

export interface RouteChoice {
  chosen: PaymentRequirements;
  reason: string;
  rejected: Array<{ requirement: PaymentRequirements; reason: string }>;
}

const capKey = (r: PaymentRequirements) => `${r.network}|${r.asset}`;

/**
 * Picks a route by policy, and explains itself. The explanation is not
 * decoration: "why did it choose that chain" is the question this project
 * exists to answer, so the reason travels with the choice.
 */
export function chooseRoute(
  policy: RoutePolicy,
  offered: PaymentRequirements[],
): RouteChoice {
  const rejected: RouteChoice["rejected"] = [];
  const viable: Array<{ requirement: PaymentRequirements; rank: number }> = [];

  for (const requirement of offered) {
    const rank = policy.preference.indexOf(requirement.network);
    if (rank === -1) {
      rejected.push({ requirement, reason: "no signer for this network" });
      continue;
    }

    const cap = policy.caps[capKey(requirement)];
    if (cap === undefined) {
      rejected.push({ requirement, reason: "asset not on the allowlist" });
      continue;
    }
    if (BigInt(requirement.amount) > BigInt(cap)) {
      rejected.push({
        requirement,
        reason: `over cap (${requirement.amount} > ${cap})`,
      });
      continue;
    }

    viable.push({ requirement, rank });
  }

  if (viable.length === 0) {
    const detail = rejected.map((r) => `${r.requirement.network}: ${r.reason}`);
    throw new Error(`no route passed policy — ${detail.join("; ")}`);
  }

  viable.sort((a, b) => a.rank - b.rank);
  const winner = viable[0].requirement;

  const runnersUp = viable.slice(1).map((v) => v.requirement.network);
  const reason = runnersUp.length
    ? `preferred over ${runnersUp.join(", ")}`
    : "only route passing policy";

  return { chosen: winner, reason, rejected };
}
