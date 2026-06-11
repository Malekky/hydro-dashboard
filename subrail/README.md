# Subrail

**Subscribe to Claude from anywhere — no international card needed.**

People in much of the world have local money (Mercado Pago, Wise, Cash App, mobile money) but
no card that clears claude.ai's Stripe checkout. Subrail bundles two pieces of programmable
payments infrastructure into one app:

1. **Peer (zkp2p)** — the way to acquire stables: the user pays a maker on a payment network
   they already use and receives USDC in **their own** passkey smart wallet on Base. (Any
   other USDC deposit works too — USDC is simply the instrument their local currency can't be.)
2. **The gateway** — the operator's own Gnosis Pay account, integrated via the
   **permissionless tier** (SIWE → JWT, no partnership, no API key):
   - Friends' Base USDC routes in one LI.FI transaction to **EURe in the operator's
     Gnosis Pay Safe** (deposits are plain ERC-20 transfers — instant, permissionless).
   - The operator's free **virtual cards** (one per friend, 5-card account cap) sit on the
     friends' claude.ai accounts as ordinary Visa card-on-file; EUR→USD at Visa wholesale
     FX, 0% Gnosis Pay fee.
   - Reconciliation by polling `GET /api/v1/cards/transactions`; the friend ledger
     (contributions − attributed Claude charges) is pure, tested code.
   - **Fallbacks:** Bitrefill → Apple/Google gift card → app-store balance; official
     Claude gift codes (claude.ai/gift).

This automates an existing friends arrangement (the operator already pays their subs) —
Gnosis Pay's card is personal-use-only by ToS, so it stays a friends circle, not a public
product. Subrail enforces geo-blocking for sanctioned and Claude-unsupported regions;
failed cycles reimburse USDC to the friend's wallet.

## This directory

| Path | What |
|---|---|
| `docs/01-research.md` | Research report: ~200 verified claims across Peer, x402, Tempo MPP, the USDC→Claude last leg, compliance, prior art — with an adversarial verification pass and per-path feasibility verdicts |
| `docs/02-design.md` | Design proposal: architecture, rails router, protocol decision (x402 vs MPP), risk register, phasing |
| `docs/03-spec.md` | Build spec for v1: stack, domain model, state machines, API, integration detail, acceptance criteria |
| `app/` | MVP app (Next.js 15 + TypeScript, Base mainnet): real integrations — Coinbase Smart Wallet (passkey), `@zkp2p/sdk` taker flow (quote → signalIntent → Buyer-TEE capture → fulfillIntent), Bridge card-issuing REST client, USDC allowance approval — plus the tested pure core (rails router, renewal scheduler, geo gate). Steps requiring partner credentials (`BRIDGE_API_KEY`, Peer curator key) render explicit configuration-required states until keys exist |

## Scaffold quickstart

```bash
cd app
pnpm install   # or npm install
pnpm test      # vitest: router, scheduler, geo gate
pnpm dev       # landing + POST /api/quote
```

Try a quote:

```bash
curl -s localhost:3000/api/quote -X POST -H 'content-type: application/json' \
  -d '{"country":"AR","plan":"pro","platforms":["mercado_pago"],"device":"mobile"}'
```

## Status

Prototype/spec stage. The M0 validation spikes in `docs/02-design.md §8` gate any real
build — first among them the Bridge card pilot: a live Claude Pro subscription paid through
the JIT allowance choreography for 3 cycles, plus Base-support confirmation from Bridge.

Subrail is not affiliated with Anthropic.
