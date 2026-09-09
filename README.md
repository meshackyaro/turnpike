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

Day 1. The seller returns a real `402` on Hedera testnet — verified against the
default facilitator, which advertises `hedera:testnet` and needs no API key:

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

Next: the buyer client signs against that and closes the loop.

## Notes for the buyer implementation

- Payment requirements arrive in the **`PAYMENT-REQUIRED` response header**
  (base64 JSON), not the 402 body — the body is `{}` by default.
- The resource server must register the scheme
  (`@x402/hedera/exact/server`) *and* point at a facilitator. With only the
  facilitator it can price a route but cannot build requirements, and protected
  routes return 500.

## Setup

```bash
pnpm install
cp .env.example .env    # facilitator URL is pre-filled; add Hedera credentials
pnpm seller
```

Get a funded Hedera testnet account at [portal.hedera.com](https://portal.hedera.com).
