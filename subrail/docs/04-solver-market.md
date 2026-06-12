# 04 — Solver market (Peer-isomorphic): the composable core

**Status:** design (supersedes the Gnosis Pay gateway as the *core*; the operator card
becomes one solver's instrument, not shared plumbing). Research basis: `01-research.md
§4.6` (Gnosis), the solver-market research pass (2026-06-12), and the verified Peer/zkp2p
mechanics in `01-research.md §2`.

## The idea

A two-sided intent marketplace, structurally identical to zkp2p — only the proven action
changes (a *gift purchase* instead of a *fiat payment*):

- **Supply (user):** locks `USDC + payload{plan, months, recipientEmail}` in an escrow
  intent on Base.
- **Demand (solver):** buys an official Claude gift for that email at claude.ai/gift with
  their own paid account + card, then **generates a zk/TEE proof — from their own
  authenticated claude.ai session — that this specific purchase happened**, and submits it
  to unlock the escrowed USDC (face + spread).

## Why proof must be solver-side (the load-bearing decision)

Recipient-side proof is broken: the buyer who locked USDC can simply **refuse to generate
the proof after receiving the gift**, keeping both the sub and (via timeout refund) their
money. Whoever can *withhold* the proof to their own benefit must not be the prover.

So the prover is the **solver**, exactly as in zkp2p the prover is the taker who sent
fiat: the party that has *already parted with value* (bought the gift) and is owed the
escrow. Their incentive is to prove; the counterparty cannot grief them by silence. The
escrow releases to the solver **on valid proof**, and refunds the user **on timeout** if no
solver fulfills. Neither side can strand the other.

## Trust model = zkp2p, re-pointed

| zkp2p (fiat onramp) | This market (Claude gift) |
|---|---|
| Maker locks USDC liquidity | User locks USDC + email payload (the "order") |
| Taker pays fiat off-platform (Venmo/Wise) | Solver buys a Claude gift for the email at claude.ai/gift |
| Taker proves the fiat payment from their authenticated session (Buyer-TEE / zkTLS / zkEmail) | Solver proves the gift purchase from their authenticated claude.ai session |
| `UnifiedPaymentVerifierV2` checks an EIP-712 attestation; escrow releases to maker's payee | Verifier checks the gift-purchase attestation; escrow releases to solver |
| Nullifier prevents proof reuse | Nullifier on the claude.ai order id prevents reuse |

The same machinery Peer ships — the **Buyer-TEE extension capture** (`peer.authenticate`,
"log into the provider, extract the session payload, attest it in a TEE") — is exactly the
artifact extractor this needs, aimed at claude.ai's billing/orders surface rather than a
payment app. That is why this is "Peer-like": not analogy, the same software shape.

## What the proof must bind (anti-cheat)

A solver proof is only worth the escrow if it cryptographically binds the purchase to
*this* intent. The attested claude.ai order data must establish, in one proof:

1. **Recipient = intent.recipientEmail** — the gift was sent to the email the user locked
   (reveal `hash(recipientEmail)`, compared on-chain to the intent's committed hash; raw
   email is encrypted to the matched solver off-chain, never on-chain).
2. **Plan + duration ≥ intent.plan/months** — solver can't fulfill a $20 Pro gift against a
   $100 Max intent.
3. **Freshness** — the order timestamp is after the intent was opened (no replaying an old
   personal gift), and the **order id is the nullifier** (each real purchase unlocks at
   most one escrow).
4. **Issuer authenticity** — the data is genuinely from claude.ai (TLS session binding /
   DKIM on the order-confirmation email), not solver-fabricated.

Binding (1)+(2)+(3)+(4) is what makes refusing-to-deliver and self-dealing both
unprofitable: the only way to a valid proof is an actual gift to the actual email.

## Proof source: solver's purchase artifacts (best → fallback)

The solver, logged into their claude.ai account, can prove the purchase from any of:

- **A) zkTLS web-proof of the order/receipt page** (Reclaim/Primus provider for
  claude.ai → Settings/Billing or the gift confirmation page). Proves *the solver's
  account made this gift, to this email, for this plan, just now*. Strongest binding to the
  solver; Cloudflare matters little since a real human drives the session. Build a custom
  provider (no claude.ai provider exists yet).
- **B) zkEmail of the solver's "your gift was sent" confirmation** (Anthropic emails the
  *purchaser* a receipt). DKIM-signed; selective-disclose plan + recipient-hash, hide the
  code. Non-interactive, replayable on Base.
- **C) TEE attestation** (the zkp2p V3 pattern): our TEE validates the solver's captured
  session and emits an EIP-712 attestation a Base verifier consumes. Ships fastest;
  centralization we disclose; the migration target is A/B.

**v1 ships C (TEE capture, Peer-style) behind a `Verifier` interface**, with an optimistic
bond+window as the safety net while the attester is single-operator; A (zkTLS) is the
decentralization upgrade once a claude.ai provider is built and the real artifacts are
captured.

## The two $20 unknowns to resolve before circuit/provider work

1. **Capture a real solver-side artifact:** buy one Pro 1-month gift, save (a) the raw
   purchase-confirmation `.eml` (sender domain + DKIM `d=` + body template) and (b) the
   logged-in order/billing page DOM/TLS transcript. These define the zkEmail blueprint and
   the zkTLS provider.
2. **Confirm the order page/email exposes recipient + plan + order-id** (what we bind to)
   and that the **code itself can stay hidden** in the proof.

## Settlement: contracts (fork Peer's pattern, don't plug in)

zkp2p's verifier registry is multisig-permissioned (can't add a custom platform), so we
**fork the open-source Base-native escrow pattern**:

- `GiftIntentEscrow` (Base, USDC): `open(planId, months, recipientEmailHash, expiry)`
  locks the user's USDC; `fulfill(intentId, attestation)` checks the bound attestation via
  the `Verifier` and releases to the solver; `refund(intentId)` after expiry returns USDC
  to the user. Order-id nullifier mapping prevents proof reuse.
- `Verifier` interface: `tee` (v1, EIP-712 from our attester) | `zktls` (Reclaim/Primus) |
  `zkemail` (Groth16 verifier + DKIM registry). Swappable; intents pin which they accept.
- Optimistic mode (flag): solver posts a bond ≥ ticket; `fulfill` is provisional for a
  challenge window; user (or anyone) can challenge with counter-evidence → bond slashed.
  Cheap safety net while the attester is centralized.

## App surface (reuses what's built)

- **User flow** (today's onboarding, minus the card step): onramp via Peer → `open` an
  intent with plan + email → watch for fulfillment → receive the gift from Anthropic.
- **Solver console** (replaces/*generalizes* the operator console): open intents feed →
  "claim" → guided gift purchase on claude.ai → capture proof (extension/TEE, Peer-style) →
  `fulfill` → escrow paid out. Your Gnosis Pay card is just how *you, a solver*, pay
  Anthropic — no longer shared infrastructure.
- Geo-gate, rails router (now routing only the onramp), reimbursement-on-timeout: reused.

## Risks (carried from research)

1. **Anthropic tightening the gift surface** (account-less purchase already removed; Persona
   ID checks; ToS bans scripted access) → solvers stay human-in-the-loop; design for solver
   account attrition; per-solver volume caps.
2. **Artifact fragility** (DKIM `d=` / order-page DOM can change without notice) → anchor
   proofs on stable fields, keep the optimistic fallback, refund-on-timeout always.
3. **Solver capital lockup + spread** (3–8% over face is defensible; zero chargeback risk
   since the solver pays Anthropic) → bond sizing and window length tune this.
