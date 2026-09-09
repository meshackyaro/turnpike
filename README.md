# Turnpike

A toll road for AI agents. Sellers put a price on an endpoint; buyer agents pay
per call and settle on whichever route is cheaper — without ever holding their
own keys.

Built for ETHOnline 2026.

## The idea

An x402 `402 Payment Required` response carries an **`accepts` array**, not a
single payment demand. A seller can therefore advertise two settlement routes in
one response and let the buyer choose:

```jsonc
{
  "x402Version": 1,
  "accepts": [
    { "scheme": "exact", "network": "hedera:testnet", "asset": "0.0.0",  "amount": "1200000", "payTo": "0.0.4417",
      "extra": { "feePayer": "0.0.9911" } },   // facilitator pays gas
    { "scheme": "exact", "network": "eip155:…",     "asset": "0x…",     "amount": "4000",    "payTo": "0xA1c3…" }
  ]
}
```

That turns four sponsor integrations into one mechanism: **one wallet, one spend
policy, route selected at request time.**

Under Hedera's `exact` scheme the buyer signs a `TransferTransaction` whose
transaction ID belongs to the facilitator and hands it over *unsubmitted*. The
facilitator adds its signature and pays the network fee — so **the buyer agent
never needs an HBAR balance for gas.**

## Layout

```
apps/
  seller-forecast/   a real paid service behind the x402 paywall
  buyer/             the payment client — catches 402, picks a route, settles
```

`tricia/` (the orchestrator agent) and the dashboard land once the payment path
is proven.

## Status

**Day 1 complete — a payment settles on Hedera testnet.**

```
$ pnpm seller          # terminal 1
$ pnpm buy             # terminal 2

402 — 1 route(s) offered:
  hedera:testnet  0.012 HBAR -> 0.0.10438909
    gas sponsored by facilitator 0.0.9185802

paying…

HTTP 200 — settled
  tx  0.0.9185802@1788968443.229829086
```

On-chain, that transaction moves:

| account | | net |
|---|---|---|
| `0.0.10438985` | buyer | **−0.01200000 HBAR** |
| `0.0.10438909` | seller | **+0.01200000 HBAR** |
| `0.0.9185802` | facilitator | −0.00255176 HBAR (network fee) |

The buyer paid the price and **no gas**. That is the fee-payer model working,
not just described.

Next: a second route on Arc, and the selector that chooses between them.

<details>
<summary>The 402 the seller returns</summary>

Verified against the default facilitator, which advertises `hedera:testnet` and
needs no API key:

```jsonc
// PAYMENT-REQUIRED header, base64-decoded. Note extra.feePayer: the
// facilitator injected it, so the buyer needs no HBAR for gas.
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact", "network": "hedera:testnet",
    "amount": "1200000", "asset": "0.0.0", "payTo": "0.0.12345",
    "maxTimeoutSeconds": 60,
    "extra": { "feePayer": "0.0.9185802" }
  }]
}
```

</details>

## Things that cost time, so they don't cost it twice

- Payment requirements arrive in the **`PAYMENT-REQUIRED` response header**
  (base64 JSON), not the 402 body — the body is `{}` by default. The paid
  request sends `PAYMENT-SIGNATURE` (v2; `X-PAYMENT` is v1).
- The resource server needs a registered scheme (`@x402/hedera/exact/server`)
  **and** a facilitator. With only the facilitator it can price a route but
  cannot build requirements, and protected routes return 500.
- `handlePaymentRequired()` only runs registered hooks and returns `null` when
  none produce headers. Creating a payment directly is
  `createPaymentPayload()` then `encodePaymentSignatureHeader()`.
- **Client spend controls are on by default** and permit only recognized
  default assets, which excludes native HBAR. Allowlist it explicitly with an
  atomic per-payment cap — this is also where the spend policy will live.
- `dotenv/config` resolves against the process cwd, so in a monorepo each app
  must load the workspace-root `.env` by explicit path.
- Use **ECDSA** Hedera accounts and reference them by `0.0.x` ID, never the
  `0x…` EVM alias — the scheme's `aliasPolicy` defaults to `reject`.

## Setup

```bash
pnpm install
cp .env.example .env    # facilitator URL is pre-filled; add Hedera credentials
pnpm seller
```

Get a funded Hedera testnet account at [portal.hedera.com](https://portal.hedera.com).
