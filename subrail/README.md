# Subrail

**Subscribe to Claude from anywhere — no international card needed.**

People in much of the world have local money (Mercado Pago, Wise, Cash App, mobile money) but
no card that clears claude.ai's Stripe checkout. Subrail bundles two pieces of programmable
payments infrastructure into one app:

1. **Peer (zkp2p)** — the way to acquire stables: the user pays a maker on a payment network
   they already use and receives USDC in **their own** passkey smart wallet on Base. (Any
   other USDC deposit works too — USDC is simply the instrument their local currency can't be.)
2. **An agentic renewal service** that interacts with Stripe composably:
   - **Primary — USDC → Stripe directly:** a JIT-funded virtual Visa in the user's name
     (Bridge via Stripe Issuing): the wallet grants an amount-bounded USDC allowance, the
     card pulls funds **at authorization**, and claude.ai's recurring Stripe charge just
     works against an ordinary card-on-file. Allowance ≈ $0 between cycles.
   - **Fallback 1:** USDC → Bitrefill (merchant of record) → Apple/Google gift card →
     app-store balance → Claude in-app subscription auto-renews.
   - **Fallback 2:** USDC → official Claude gift-subscription code (claude.ai/gift).

Non-custodial by construction: user principal moves wallet → merchant directly and never
transits Subrail; failed cycles reimburse USDC back to the user's onramp wallet. Compliance
is carried by the regulated stack (RTPNs, issuers, MoRs); Subrail enforces geo-blocking for
sanctioned and Claude-unsupported regions.

## This directory

| Path | What |
|---|---|
| `docs/01-research.md` | Research report: ~200 verified claims across Peer, x402, Tempo MPP, the USDC→Claude last leg, compliance, prior art — with an adversarial verification pass and per-path feasibility verdicts |
| `docs/02-design.md` | Design proposal: architecture, rails router, protocol decision (x402 vs MPP), risk register, phasing |
| `docs/03-spec.md` | Build spec for v1: stack, domain model, state machines, API, integration detail, acceptance criteria |
| `app/` | Prototype scaffold (Next.js 15 + TypeScript): the pure core is real and tested (rails router, renewal scheduler, geo gate); integration adapters are typed stubs with TODOs that mirror the spec |

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
