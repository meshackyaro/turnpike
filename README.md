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

Day 1: proving one payment settles on Hedera testnet. Nothing else matters until
that works.

## Setup

```bash
pnpm install
cp .env.example .env    # fill in Hedera testnet credentials
```
