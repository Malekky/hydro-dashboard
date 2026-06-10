# Subrail

**Subscribe to Claude from anywhere — no international card needed.**

People in much of the world have local money (Mercado Pago, Wise, Cash App, mobile money) but
no card that clears claude.ai's Stripe checkout. Subrail bundles two pieces of programmable
payments infrastructure into one app:

1. **Peer (zkp2p)** — a trustless P2P onramp: the user pays a maker on a payment network they
   already use and receives USDC in **their own** passkey smart wallet on Base.
2. **An agentic payment protocol** (x402 + spend permissions on Base; Tempo MPP as a phase-2
   adapter) — a capped, revocable authorization that lets Subrail's renewal agent keep the
   subscription paid through the most reliable **last leg** for the user's country:
   - **Leg A:** USDC → Bitrefill (merchant of record) → Apple/Google gift card → app-store
     balance → Claude in-app subscription auto-renews.
   - **Leg B:** USDC → official Claude gift-subscription code (claude.ai/gift) → user redeems.
   - **Leg C (phase 2):** user-named virtual card via Bridge/Rain/Kulipa → Stripe checkout.

Non-custodial by construction: user principal moves wallet → merchant directly and never
transits Subrail. Sanctioned and Claude-unsupported regions are geo-blocked continuously.

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

Prototype/spec stage. The four M0 validation spikes in `docs/02-design.md §6` gate any real
build: Apple-balance auto-renew pilots, gift-code expiry-boundary renewal test, Peer onramp
e2e, and the money-transmission legal memo.

Subrail is not affiliated with Anthropic.
