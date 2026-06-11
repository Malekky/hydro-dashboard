# 02 — Design: Subrail

**Working name:** Subrail — "subscribe to Claude from anywhere."
**One-liner:** A non-custodial app that turns local money into a running claude.ai subscription:
Peer (zkp2p) onramps fiat to USDC in the user's own wallet — USDC being the spendable
instrument their local currency can't be — and an agentic renewal service keeps the
subscription paid, primarily by interacting with Stripe directly through a just-in-time
USDC-funded card, with composable fallbacks.

Framing decisions (product owner direction, 2026-06):

- **The onramp leg is simply how the user acquires stables.** Local currency can't pay
  Anthropic; USDC can be made to. Peer is the preferred acquisition method (P2P, ~2 min,
  builder fees), but any USDC arriving in the user's wallet works (`external_deposit`).
  Everything after the wallet is rail-agnostic.
- **Compliance is carried by the regulated stack, not the app.** Every fiat touchpoint runs
  through a compliant RTPN (Venmo/Wise/Mercado Pago… on the Peer side) and every card/KYC
  touchpoint through a regulated issuer (Bridge/Kulipa). Subrail's own obligations reduce to
  **geo-blocking** (OFAC-comprehensive + Anthropic-unsupported countries, enforced
  continuously by IP) and honest disclosures. Residual risk analysis is preserved in
  `01-research.md §5` for reference, not as a product gate.
- **If a cycle fails, the user is made whole in USDC**: any funds pulled for a cycle that
  didn't deliver value are reimbursed to the same wallet the Peer onramp settled into
  (the primary leg never needs this — funds move only at successful card authorization).

---

## 1. Product shape

### What the user experiences

1. **Onboard** (~2 min): pick country + Claude plan → Subrail shows the *rail plan* (how to
   get USDC, which payment leg, total monthly cost) → create a passkey smart wallet.
2. **Get USDC** (~3 min): Peer onramp — pay a maker on a platform they already use (Mercado
   Pago, Wise, Cash App…); USDC lands in *their* wallet on Base. Or deposit USDC from
   anywhere else — the app doesn't care where stables come from.
3. **Set up the payment leg** (once): primary — pass issuer KYC, get a virtual Visa in their
   own name, grant the amount-bounded USDC allowance, enter the card at claude.ai checkout.
4. **Stay subscribed**: before each billing date the agent tops the allowance to exactly one
   cycle; Anthropic's recurring Stripe charge pulls USDC from the wallet at authorization;
   the allowance drops back toward zero. Top-up nudges deep-link back into the Peer flow.

## 2. Architecture

```
┌─────────────────────────── Subrail PWA (Next.js) ───────────────────────────┐
│ Onboarding · Rail planner · Wallet (passkey/4337) · Subscription dashboard  │
└──────┬───────────────────────────┬──────────────────────────────┬───────────┘
       │                           │                              │
       ▼                           ▼                              ▼
┌─────────────┐          ┌──────────────────┐          ┌───────────────────────┐
│ STABLES     │          │ AUTHORIZATION    │          │ RENEWAL SERVICE       │
│ ACQUISITION │          │ amount-bounded   │          │ scheduler + leg       │
│ Peer/zkp2p  │          │ USDC allowance   │          │ executors; collects   │
│ (preferred) │          │ from the user's  │◄─manage──│ its own fee via x402  │
│ or any USDC │          │ smart wallet     │  window  │ (exact scheme, Base)  │
│ deposit     │          │ (per cycle,      │          └──────────┬────────────┘
└─────────────┘          │ revocable)       │                     │
                         └────────┬─────────┘                     │
   USDC on Base                   │ JIT pull at card              │ fallbacks
   in the USER's wallet           ▼ authorization                 ▼
                    ┌──────────────────────────────┐   ┌──────────────────────┐
                    │ PRIMARY: USDC → STRIPE       │   │ FALLBACKS            │
                    │ Bridge (Stripe Issuing) JIT  │   │ 1. Bitrefill →       │
                    │ Visa debit in the user's     │   │    Apple/Play gift   │
                    │ name → ordinary card-on-file │   │    card → IAP        │
                    │ at claude.ai checkout →      │   │ 2. official Claude   │
                    │ Anthropic's recurring charge │   │    gift code         │
                    │ settles from the wallet      │   │    (claude.ai/gift)  │
                    └──────────────────────────────┘   └──────────────────────┘
```

Key flow property: USDC sits in the user's wallet until the instant of value transfer —
card authorization (primary) or merchant invoice payment (fallbacks). Subrail's service
wallet receives only its own fee (an ordinary x402 `exact` payment).

## 3. The primary leg: USDC → Stripe via JIT card

This is the composability bet, confirmed by the mechanics research (01-research.md §4.5):

- **Instrument:** Bridge (a Stripe company) stablecoin-backed virtual Visa via Stripe
  Issuing, **non-custodial funding mode** — the card is issued in the user's name after
  Bridge KYC, and is funded by an **amount-bounded ERC-20 approval** from the user's own
  wallet to a developer-scoped Bridge delegate address. No prepaid float; Bridge pulls USDC
  **at authorization**.
- **Why it satisfies "interact with Stripe composably":** to claude.ai's Stripe Billing this
  is an ordinary Visa debit card-on-file; merchant-initiated recurring charges are normally
  SCA-exempt, so renewal succeeds iff allowance + balance cover the charge at the auth
  instant — which is exactly the variable the agent controls.
- **The renewal choreography (the agent's whole job):**
  `T−24h` raise allowance to face × 1.03 → billing date: Anthropic charges, Bridge pulls
  USDC → settle webhook confirms → after the Stripe Smart-Retries window, lower allowance
  toward zero. Card and allowance ≈ $0 between cycles: minimal fraud/freeze surface.
- **Failure handling:** declines inside the retry window are recoverable (hold the
  allowance open, alert the user, top up balance); a terminal decline triggers fallback
  selection. **No reimbursement is ever needed on this leg** — funds only move on success.
- **Runner-up issuer:** Rain (Agent Control Layer: merchant allowlists, amount/frequency
  caps, agent-issued cards) — better controls, enterprise-gated; adapter slot behind the
  same `LastLeg` interface. Kulipa covers Nigeria.
- **Known unknowns (M0 spikes):** Bridge program approval; explicit Base support for
  Bridge's card contract (Solana confirmed; "EVM where deployed"); measured MIT decline
  behavior on a live Claude subscription — no public data exists, so we generate it.

## 4. Rails router

Input: country, plan, the user's platforms, device. Output: ranked `RailPlan`s.
Ranking: **card leg first wherever an issuer covers the country**, then app-store, then
gift code; ties by all-in cost.

| Example user | Stables acquisition | Payment leg |
|---|---|---|
| US underbanked, Max | Venmo/Cash App via Peer | **Card (Bridge)** |
| Argentina, Pro | Mercado Pago via Peer | **Card (Bridge — AR live since launch)** |
| Nigeria, Pro | external USDC / Wise where held | **Card (Kulipa)**; gift code fallback |
| Brazil, Pro | Wise/Revolut via Peer | App-store (Apple BR gift card) until Bridge BR opens |
| India, Pro | external USDC / Wise | App-store (Apple IN + balance — the post-RBI standard); no card issuer serves IN |

Routing rules still encode the verified hard constraints: gift codes ≥3 months and renewed
only at expiry (stacking hazard, anthropics/claude-code#41499); Apple region lock; the
geo-block list; per-platform disclosure strings.

## 5. Decisions

- **D1 — Protocol: x402 + allowance management on Base now; Tempo MPP adapter later.**
  Peer settles USDC natively on Base; the card delegate allowance and the x402 fee payment
  live on the same chain. MPP remains the phase-2 adapter (`PaymentRail` interface).
- **D2 — Legs: card primary; app-store and gift code as fallbacks** (§3, §4). Fallbacks are
  also the bootstrap path while Bridge program approval is pending.
- **D3 — Form factor:** PWA + Peer-app handoff on mobile (extension-free mobile web onramp
  doesn't exist); desktop Chrome gets the full headless extension flow; Expo/RN shell with
  Peer's RN SDK in v1.5.
- **D4 — Wallet:** passkey ERC-4337 smart account on Base; self-custody is what keeps
  Subrail a software orchestrator rather than a financial intermediary.
- **D5 — Compliance scope:** geo-blocking (continuous, IP-based) + disclosures + delegated
  KYC (RTPNs on fiat, issuer on cards). Reference analysis: 01-research.md §5.
- **D6 — Reimbursement policy:** any pulled-but-undelivered USDC returns to the user's
  onramp wallet automatically on cycle failure (scheduler emits `mark_failed` with
  `reimburseUsd`); delivered artifacts (a gift code in hand) are not reimbursable.

## 6. Unit economics (Pro, card leg)

$20.00 face + ~1% Peer maker spread (acquisition) + ~1% issuer/leg fee (placeholder until
Bridge pricing is verified) + $1.50 Subrail fee + sponsored gas (<$0.01) ≈ **$21.9/mo
all-in** — vs $30–40+ effective on gray-market resellers/cards with decline roulette.
Peer builder fees partially offset paymaster + facilitator costs.

## 7. Risk register (operational)

| Risk | Mitigation |
|---|---|
| MIT auth fires outside the allowance window (Stripe Smart Retries timing) | Open window T−24h, hold through retry window; auth webhooks tighten the billing-date estimate each cycle; alert + fallback on terminal decline |
| Bridge doesn't enumerate Base / program approval slow | Kulipa/Rain adapters behind `LastLeg`; fallback legs carry launch corridors meanwhile |
| Wallet underfunded at renewal | T−72h balance forecast → top-up nudge deep-linking into Peer flow |
| Gift-code redemption bugs (stacking/proration class) | ≥3-month codes; renew at expiry boundary only; support runbook |
| Peer corridor liquidity thin | Pre-quote maker depth; `external_deposit` always available |
| RTPN account friction for users/makers | Disclosure strings per platform; never automate the user's fiat side |
| Geo-block evasion | Continuous IP checks on every session + mutating call; VPN heuristics step-up |

## 8. Phasing

- **M0 — spikes:** (1) **Bridge card pilot**: issue a test card, put it on a real Claude
  Pro subscription, measure MIT auth behavior across 3 cycles incl. one deliberate
  allowance-miss + recovery; (2) confirm Base support with Bridge; (3) Peer onramp e2e
  (desktop ext + app handoff); (4) Apple-balance auto-renew pilots (BR/IN/US) for fallback 1.
- **M1 — v1:** wallet + Peer/deposit acquisition + card leg in Bridge-covered corridors
  (US/AR/MX/CO/PE/CL/EC) + manual-trigger renewals + reimbursement path live.
- **M2 — autonomy:** allowance choreography on schedule, balance forecasting, fallback legs
  active (app-store; gift code behind `FEATURE_LEG_B`), Kulipa corridor (NG).
- **M3 — v1.5:** RN shell (embedded Peer capture), Rain adapter (agent-scoped cards), MPP
  adapter, x402 Bazaar listing.

Success metrics: renewal success rate on the card leg (target >98% with retry recovery);
funded-wallet → active-subscription conversion; all-in cost ≤ face +15%; reimbursement
latency <1h on failed cycles.
