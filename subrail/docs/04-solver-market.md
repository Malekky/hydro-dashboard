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

## The capture layer (corrected)

zkp2p's extension is **not reusable here**: `peer.authenticate` is template-driven from
`api.zkp2p.xyz/providers/` and only captures Peer's configured payment platforms — it will
not capture claude.ai. And a capture layer is *unavoidable* for any live-session proof:
it's the component that sits in the solver's authenticated browser session, reads the order
response the page already fetched, and hands it to a prover (even the TEE path needs it —
zkp2p V3 captures via its extension, then attests).

**Decision: use Reclaim Protocol as the capture + zkTLS proof layer** (not a bespoke
extension we build/maintain). We author a **custom claude.ai provider** (which order/billing
request to capture, which fields to extract) and Reclaim's extension/app SDK generates a
zkTLS proof from the solver's own session, verified on Base inside our escrow.

Why zkTLS over zkEmail here: the proof binds to the **live TLS transcript of claude.ai's
server response** — it cannot be counterfeited, whereas a receipt email is solver-held
content that's easier to forge/spoof and whose DKIM domain/template is fragile. Email
verification stays a *possible later add*, not the trust root.

Capture caveat: claude.ai is Cloudflare-protected and the ToS bans *automated* access —
Reclaim captures **passively** (reads what the human's own session already loaded), and the
solver is a real person making a real purchase, which is the compliant shape; still requires
a hands-on test against live Cloudflare.

## Proof source: solver's purchase artifacts (best → fallback)

The solver, logged into their claude.ai account, proves the purchase via:

- **CHOSEN — zkTLS web-proof of the order page** (Reclaim provider for claude.ai →
  Settings/Billing / order-history endpoint). Proves *the solver's account made this gift,
  to this email, for this plan, just now*, bound to the live TLS transcript. Build a custom
  Reclaim provider (none exists yet); proof verified on Base in our escrow.
- *Deferred — zkEmail* of the purchaser's receipt: forgeable/spoofable relative to a live
  TLS proof and DKIM-template-fragile, so not the trust root. Possible later add.
- *Deferred — TEE attestation* (zkp2p V3 pattern): only if a claude.ai field we need can't
  be captured cleanly via Reclaim.

**v1 ships the Reclaim zkTLS verifier behind the `Verifier` interface**, with an optimistic
bond+window as a safety net during early operation.

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

- **User flow:** connect wallet → `open` an intent with plan + months + email (USDC must be
  in the wallet; **onramp is a later add — for now the user funds the wallet however they
  like**, Peer included once re-wired) → watch for fulfillment → receive the gift from
  Anthropic → (or `refund` after expiry).
- **Solver console** (generalizes the operator console): open-intents feed → "claim" →
  guided gift purchase on claude.ai → **capture proof via the Reclaim flow** → `fulfill` →
  escrow paid out. Your Gnosis Pay card is just how *you, a solver*, pay Anthropic.
- Geo-gate and reimbursement-on-timeout (escrow `refund`): reused. Onramp/rails router:
  deferred, slots back in on the user's funding step.

## Reclaim integration (verified API, 2026-06-12)

- **Stack:** `@reclaimprotocol/js-sdk` v5.2.0 (`ReclaimProofRequest.init(appId, appSecret,
  providerId)` → `triggerReclaimFlow()` → `startSession({onSuccess,onError})` →
  `transformForOnchain(proof)`). On-chain: `@reclaimprotocol/verifier-solidity-sdk`
  (`Reclaim.sol`) — our escrow calls `verifyProof(proof)`, then re-checks our business
  rules. **Not** zkFetch (that proves a *server's* request, not the solver's own session).
- **Capture mode:** human-in-browser (the solver drives their own claude.ai session); for
  the Cloudflare-protected SPA/XHR, the **browser-extension SDK** is the robust path.
- **Provider:** a CUSTOM HTTP provider (dev.reclaimprotocol.org) on claude.ai's order
  endpoint with `responseRedactions` (jsonPath) — **redact the gift code**, reveal
  recipient-hash/plan/months/order-id/timestamp. Yields `PROVIDER_ID` (+ `APP_ID`,
  `APP_SECRET`).
- **Binding (critical):** inject `addContext(intentId, {escrow, intentId})` → lands in
  `claimInfo.context`, covered by the claim identifier hash. On-chain, after
  `verifyProof`, **re-assert** context.intentId == arg and escrow == this, and record the
  order-id nullifier — `verifyProof` proves the transcript is authentic, NOT our rules.
- **Trust/perf:** proxy/attestor model (~2-4s proofs); witness set is substantially
  Reclaim-operated today — a disclosed trust assumption. Base verifier address surfaced as
  `0x8CDc031d5B7F148ab0435028B16c682c469CEfC3` — **verify against Addresses.sol before
  mainnet**.
- **Gotcha:** claude.ai exposes no documented order API; we capture an internal endpoint
  whose schema can drift — keep the field mapping isolated (`reclaim.ts parseProof`), anchor
  on stable scalars, expect to maintain the provider.

## Build order

1. Escrow contract + pure binding (`lib/solver/*`) — **done**.
2. Reclaim integration: custom claude.ai provider + client proof request +
   `ReclaimPurchaseVerifier` (maps a verified Reclaim proof → bound `GiftPurchaseAttestation`
   + on-chain calldata). Gated on the $20 artifact capture (which order endpoint/fields).
3. UI: user intent-open/refund flow + solver console (claim → Reclaim capture → fulfill).
4. Onramp re-wire on the user funding step (Peer).

## Risks (carried from research)

1. **Anthropic tightening the gift surface** (account-less purchase already removed; Persona
   ID checks; ToS bans scripted access) → solvers stay human-in-the-loop; design for solver
   account attrition; per-solver volume caps.
2. **Artifact fragility** (DKIM `d=` / order-page DOM can change without notice) → anchor
   proofs on stable fields, keep the optimistic fallback, refund-on-timeout always.
3. **Solver capital lockup + spread** (3–8% over face is defensible; zero chargeback risk
   since the solver pays Anthropic) → bond sizing and window length tune this.
