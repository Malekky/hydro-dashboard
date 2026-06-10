# 02 — Design: Subrail

**Working name:** Subrail — "subscribe to Claude from anywhere."
**One-liner:** A non-custodial app that turns local money into a running claude.ai subscription:
Peer (zkp2p) onramps fiat to USDC in the user's own wallet, and an x402/spend-permission renewal
agent keeps the subscription paid through the most reliable last leg for the user's country.

This design follows directly from the research verdicts in `01-research.md`. Every structural
choice below exists to satisfy one of three hard constraints:

- **C1 — Anthropic accepts only cards/app-store billing**; every crypto path is an indirection.
- **C2 — The app must never become the money transmitter**: no pooled custody, no "we take your
  USDC and pay your bill"; licensed merchants of record (MoR) sit on every regulated leg.
- **C3 — Purchases must be user-initiated, in the user's own name, for the user's own account**
  (the pattern Anthropic's ToS and 2026 enforcement leave alone).

---

## 1. Product shape

### What the user experiences

1. **Onboard** (~2 min): pick country + Claude plan → Subrail shows the *rail plan* (which
   onramp platform, which last leg, total monthly cost incl. all spreads/fees) → create a
   passkey smart wallet (no seed phrase).
2. **Fund** (~3 min): Peer onramp — user pays a maker on a platform they already use (Mercado
   Pago, Wise, Cash App, …); USDC lands in *their* wallet on Base.
3. **Authorize once**: grant the renewal agent a scoped spend permission — e.g. "≤ $25/month,
   only to these merchant addresses, revocable anytime."
4. **Stay subscribed**: the agent executes the last leg on schedule (gift-code delivery or
   app-store top-up), nudges the user for the one-tap redemption step when a leg requires it,
   and warns when the wallet needs topping up (deep-link back into the Peer flow).

### What Subrail actually is (and is not)

| Is | Is not |
|---|---|
| A **rails router**: country × plan → ranked viable paths with true cost | An exchange, wallet custodian, or money transmitter |
| A **non-custodial smart-wallet** front end (passkey, ERC-4337 on Base) | A reseller of Claude access (never touches Anthropic credentials) |
| A **renewal agent** holding a narrow, revocable spend permission | A card issuer (phase-2 cards are partner-issued, in the user's name) |
| A **compliance gate**: IP geo-fencing, disclosures, screening | Available in sanctioned or Anthropic-unsupported regions |

## 2. Architecture

```
┌─────────────────────────── Subrail PWA (Next.js) ───────────────────────────┐
│ Onboarding · Rail planner · Wallet (passkey/4337) · Subscription dashboard  │
└──────┬───────────────────────────┬──────────────────────────────┬───────────┘
       │                           │                              │
       ▼                           ▼                              ▼
┌─────────────┐          ┌──────────────────┐          ┌───────────────────────┐
│ ONRAMP      │          │ AUTHORIZATION    │          │ RENEWAL SERVICE       │
│ Peer/zkp2p  │          │ Coinbase Spend   │          │ (our backend agent)   │
│ adapter     │          │ Permission on    │          │ scheduler + leg       │
│  · desktop: │          │ user's smart     │◄─pull────│ executors; collects   │
│    headless │          │ wallet (monthly  │  exact   │ its own fee via x402  │
│    SDK + ext│          │ cap, allow-listed│  amount  │ (exact scheme, Base)  │
│  · mobile:  │          │ recipients,      │  at      └──────────┬────────────┘
│    Peer app │          │ revocable)       │  renewal            │ pays MoR
│    handoff →│          └──────────────────┘                     ▼ directly
│    RN SDK   │                                     ┌──────────────────────────┐
│    (v1.5)   │      USDC stays in the user's       │ LAST-LEG MERCHANTS (MoR) │
└─────────────┘      wallet until the moment of     │ A: Bitrefill API → Apple/│
                     purchase; transfers go         │    Play gift code → IAP  │
   USDC on Base ──►  user-wallet → merchant,        │ B: Claude gift code shop │
   (Peer settles     never through a Subrail        │    (operator entity,     │
    here natively)   omnibus balance                │    legal-gated)          │
                                                    │ C: Bridge/Rain/Kulipa    │
                                                    │    user-named virtual    │
                                                    │    card (phase 2)        │
                                                    └──────────────────────────┘
```

Key flow property (C2): at renewal time the spend permission lets the renewal service execute a
transfer **from the user's wallet directly to the merchant's deposit address** (e.g. a Bitrefill
invoice address). Subrail's service wallet receives only its own service fee (an ordinary x402
`exact` payment). User principal never transits Subrail.

## 3. The rails router (core IP)

Input: country, Claude plan, platform accounts the user has, device. Output: ranked `RailPlan`s.

| Example user | Onramp | Last leg | Notes |
|---|---|---|---|
| Argentina, Pro | Mercado Pago via Peer | **B**: Claude gift code (AR Apple gift-card availability unverified); **C** Bridge card (live in AR) phase 2 | Gnosis Pay also serves AR (consumer) |
| Nigeria, Pro | Wise/Revolut via Peer (where held); else external USDC | **B**: Claude gift code (no Apple gift cards in NG); **C** Kulipa card phase 2 | Apple route unavailable — B is primary |
| India, Pro | No Peer rail (no UPI) → external USDC / Wise | **A**: Apple IN gift card → Apple balance (the post-RBI standard) | Card route market-wide unavailable |
| US underbanked, Max | Venmo/Cash App via Peer | **A** or **B** | Best liquidity corridor |
| Brazil, Pro | Wise/Revolut (no native PIX on Peer) | **A**: Apple BR gift card; **C** Bridge (early 2026) | |

Routing rules encode the verified constraints: gift-code durations ≥3 months and renew only at
expiry (the #41499 stacking hazard); Apple region lock (card country == Apple ID country);
geo-fence (OFAC comprehensive + Anthropic-unsupported list) evaluated continuously, not just at
signup; RTPN ToS risk disclosure per platform (Wise/Revolut prohibitions surfaced verbatim).

## 4. Decisions and rationale

### D1 — Protocol: x402 + Coinbase Spend Permissions on Base now; MPP adapter later
Peer settles USDC **natively on Base**; choosing Tempo would force a bridge (and USDC on Tempo
is bridged USDC.e) for $20 payments. x402 is LF-governed with a live facilitator market on Base.
Recurring authorization uses Coinbase Spend Permissions (periodic cap, allow-listed recipients,
on-chain revocation) — the same primitive MPP offers natively; we hide both behind a
`PaymentRail` interface so the MPP implementation (mppx) is a phase-2 drop-in. If Stripe ever
fronts Anthropic with stablecoin subscriptions (its private preview is literally USDC on Base),
the same wallet + permission stack pays it directly — Subrail's terminal state is becoming a
thin wrapper over that, which is fine.

### D2 — Last legs ranked A → B → C
**A (app-store balance via Bitrefill MoR)** is primary where available: licensed MoR carries the
regulated activity, Apple/Google handle recurring billing flawlessly, zero BIN/decline risk, and
Anthropic is paid through a channel it fully supports. **B (official Claude gift codes)** covers
the app-store-gift-card deserts (most of Africa): Anthropic-sanctioned mechanism, recipient
needs no payment method; constrained by the no-stacking rule (≥3-month codes, renew at expiry)
and gated on legal review + Anthropic outreach because the operator entity buys codes
commercially. **C (user-named virtual cards via Bridge/Rain/Kulipa)** is phase 2: real APIs but
approval-gated programs, BIN-decline risk on recurring charges, and zero coverage in South Asia.

### D3 — Form factor: PWA + Peer-app handoff first, RN wrapper second
Verification refuted the pure-PWA onramp (desktop-extension-only web integration). v1: the PWA
runs everything *except* payment capture; on mobile the onramp hands off to Peer's native
app/App Clip (user onramps to their Subrail wallet address; we detect USDC arrival on Base and
resume), on desktop Chrome we run the full headless SDK + extension flow. v1.5: an Expo/RN shell
embeds `@zkp2p/zkp2p-react-native-sdk` for the seamless in-app capture. This keeps one
TypeScript codebase and ships the mobile-first experience without waiting on native review.

### D4 — Wallet: passkey ERC-4337 smart account (Base)
Target users have no seed-phrase tolerance. Passkey smart account (e.g. Coinbase Smart Wallet
SDK or ZeroDev) gives: social-recovery-free onboarding, sponsored gas (Peer already sponsors for
social-login users; we sponsor the rest via paymaster), and native Spend Permission support.
Self-custody is also the compliance load-bearing wall (C2): Subrail never controls funds.

### D5 — Compliance posture (day one, not later)
- **Geo-fence continuously** (Exodus/ShapeShift standard): block OFAC-comprehensive territories
  and Anthropic-unsupported countries at IP + heuristics, every session.
- **No custody, no credentials**: no Anthropic logins, no OAuth, no pooled USDC. The only thing
  Subrail's backend can do with user funds is the narrow permitted pull to allow-listed
  merchant addresses.
- **MoR discipline**: Bitrefill/Reloadly (and phase-2 card issuers) are the regulated
  counterparties. The Leg-B gift-code shop is the one place the operator entity itself sells a
  digital good for USDC — launch-gated on an MSB/CASP legal memo (closed-loop prepaid-access
  analysis, ≤$2k/day) and an outreach attempt to Anthropic.
- **Honest disclosures**: RTPN ToS risk (Wise/Revolut prohibitions), Peer's no-recourse model,
  Circle freeze risk, "Subrail is not affiliated with Anthropic."

### D6 — Unit economics sketch
Pro plan, Leg A: $20.00 face + ~0.5–1% Peer maker spread + Bitrefill markup (~0–2%, unverified)
+ Subrail fee (target $1.00–1.50/mo via x402) + sponsored gas (<$0.01 on Base) ≈ **$21.5–23.5/mo
all-in** — versus $30–40+/mo effective cost of the gray-market reseller/virtual-card status quo
with decline-fee roulette. Builder fees from Peer integration partially offset the sponsored gas
and facilitator costs.

## 5. Risk register (top items)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic objects to commercial gift-code purchasing (Leg B) | M | H | Legal memo + proactive Anthropic outreach before scale; Leg A primary wherever possible; per-user purchase pattern (one code per named recipient, user-initiated) |
| Gift redemption bugs (stacking/proration class) | M | M | ≥3-month codes; renew only at expiry boundary; redemption monitoring + support runbook; surface Anthropic support path to user |
| Peer liquidity thin in a corridor | M | M | Pre-quote maker depth; fallback to external-USDC deposit; multi-platform routing |
| RTPN bans a user/maker account | M | M (user trust) | Verbatim disclosure pre-onramp; platform ranking by enforcement history; never automate the user's fiat side |
| Apple balance fails to auto-renew Claude in a country | M | M | Pilot matrix per country before enabling; fallback to Leg B |
| Regulator deems Subrail a transmitter/CASP anyway (Samourai shadow) | L–M | H | Jurisdiction memo pre-launch; no custody/no pooled flows by construction; license or partner if counsel says so |
| Circle freezes user USDC | L | H (user) | Disclosure; minimal standing balances (fund ≈1 cycle ahead) |
| Stripe stablecoin subs reach Anthropic (obsolescence) | M (12–24mo) | Strategic | That's a win for users; Subrail's wallet+onramp+router remains the front end |

## 6. Phasing

- **M0 — Validation spikes (no product):** hand-driven pilots: (1) Bitrefill business API →
  Apple gift card → Apple balance → Claude iOS sub auto-renew, in BR/AR/IN/US; (2) buy + redeem
  3-month Claude gift codes incl. an expiry-boundary renewal; (3) Peer onramp e2e on desktop
  ext + Peer mobile app handoff; (4) legal memo (MSB/CASP + Leg B).
- **M1 — v1 PWA:** wallet + Peer handoff onramp + Leg A in app-store countries + manual-trigger
  renewals (user taps "renew now"; agent executes). Soft-launch corridors: AR, BR, US.
- **M2 — Autonomy:** spend permissions + scheduled renewals + balance forecasting/top-up nudges;
  Leg B behind legal gate (NG, KE, GH, EG, BD corridors).
- **M3 — v1.5 RN shell** (embedded Peer capture) + Bridge/Kulipa card pilot (Leg C) + MPP
  adapter + x402 Bazaar listing of the renewal service.

Success metrics: funded-wallet → active-subscription conversion; renewal success rate (target
>99% Leg A); all-in cost vs face price (≤+15%); zero compliance incidents; corridor liquidity
fill rate.
