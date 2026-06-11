# 01 — Research: Paying for claude.ai with limited banking access

**Date:** 2026-06-10
**Method:** Deep-research fan-out (12 parallel research agents across 5 angles), followed by an
adversarial verification pass on the four design-determining claims. ~200 sourced claims were
collected; this document is the synthesis. Confidence markers: **[H]** high, **[M]** medium,
**[L]** low/unconfirmed. Many official sites (anthropic.com, support.claude.com, stripe.com,
coinbase.com, tempo.xyz) block automated fetching; where noted, claims rest on search-index
excerpts corroborated across 2+ independent sources, or on first-party GitHub/npm artifacts
(which fetch reliably and anchor the technical claims).

---

## 0. Executive summary & feasibility verdicts

The goal — onramp local fiat to USDC via Peer (zkp2p) and have an agentic payment protocol keep a
claude.ai subscription paid — is **feasible today**, but only with a specific shape:

1. **Anthropic accepts no crypto in any form** [H]. Consumer Pro/Max billing is cards-only via
   Stripe; cryptocurrency and prepaid gift cards are explicitly unsupported for API billing, and
   PayPal/Venmo are rejected at consumer checkout. Every crypto→Claude path is therefore an
   *indirection*, and the design question is which indirection is reliable and defensible.
2. **The strongest last leg is not a virtual card.** Two legs dominate:
   - **Official Claude gift subscriptions** (claude.ai/gift, launched Dec 2025): codes for
     Pro/Max × 1/3/6/12 months, redeemable by a recipient who needs **no payment method** [H].
   - **App-store balance**: Claude Pro is purchasable via Apple/Google in-app purchase [H];
     Apple gift cards are purchasable with USDC at Bitrefill (which has a **programmatic API**)
     [H]; Apple Account balance pays auto-renewing subscriptions in most countries [H], and in
     India it is effectively the *recommended* method (post-RBI e-mandate rules) [H].
   - Per-user **USDC-funded virtual cards** are real (Bridge/Rain/Kulipa B2B APIs) but
     BIN-decline risk against Stripe recurring billing is documented and unguaranteed [M];
     this is a phase-2 leg, never the foundation.
3. **Peer is genuinely integrable** — headless SDK, `fulfillIntent()`, builder fees — **but the
   web integration requires the desktop Chrome extension; a pure mobile-web/PWA onramp flow is
   not possible today** (verified adversarially; the deprecated redirect surface was also
   extension-based). Mobile = Peer's React Native SDK (WebView intercept + witness attestation)
   or a handoff to Peer's own iOS/Android apps [H].
4. **Protocol verdict: x402 (on Base) over Tempo MPP for v1**, because Peer settles USDC on Base
   and the renewal engine needs no bridge; MPP is technically superior for native subscriptions
   (protocol-level periodic spending caps) and ships as an adapter in phase 2. Both are open and
   production-real as of mid-2026 [H].
5. **Compliance is the design**, not a checkbox: FinCEN treats "accept user crypto, pay their
   fiat bill" as money transmission with no exemption [H]; the Samourai sentences (Nov 2025)
   killed "non-custodial = safe" for flow *coordinators* [H]; OFAC's Exodus/ShapeShift
   settlements make IP geo-blocking mandatory even for pure software [H]; Wise/Revolut ToS
   explicitly prohibit P2P-crypto flows on the fiat side [H]. The viable posture: non-custodial
   orchestration, user-initiated purchases in the user's own name, licensed merchants of record
   (Bitrefill et al.) on every leg that touches regulated activity, geo-fencing from day one.

### Feasibility verdict per path

| # | Path | Verdict | Why |
|---|------|---------|-----|
| A | USDC → Bitrefill API → Apple/Play gift card → app-store balance → Claude IAP | **Feasible now; primary** | Licensed MoR, no card/BIN risk, Apple handles recurring; region-locked to app-store gift-card countries |
| B | USDC → operator purchases official Claude gift code → user redeems | **Feasible; constrained** | Anthropic-sanctioned gifting; but no documented gift *queueing*, sequential redemption bug destroyed value (see §4.2), operator carries reseller + MSB analysis |
| C | USDC → user-named virtual card (Bridge/Rain/Kulipa) → Stripe checkout | **Phase 2** | Real B2B APIs; LatAm live, Africa partial, India/Pakistan/Bangladesh: no provider; BIN declines documented |
| D | USDC → x402 reseller → Claude *API* access | Works, **out of scope** | Buys API inference (OpenRouter ~5% crypto fee), not a claude.ai subscription |
| E | Anthropic accepts stablecoins directly | **Not available** | No first-party acceptance through June 2026; Stripe stablecoin subscriptions exist in private preview (USDC on Base) — the watch-item that would obsolete this app |

---

## 1. The problem and the real target user

- claude.ai is available in ~175 supported countries [M] but consumer billing accepts **only
  credit/debit cards** (verbatim, Paid Plan Billing FAQs via mirror: *"We only accept credit or
  debit cards for Pro or Max plan payments"*) [H]. Decline causes documented by Anthropic's own
  help center: unsupported billing country, prepaid-class cards, AVS mismatch, IP-vs-billing
  mismatch, failed 3DS [M-H].
- Demand is proven and already monetized badly: Bitnob and Grey (Africa) officially blog "how to
  pay for ChatGPT Plus" with their virtual USD cards [H]; a long tail of Nigerian providers
  publishes the same guides; the recurring pain point is **"card declined at checkout"** [H].
- **Correction to the framing:** the realistic v1 user is not the fully unbanked. Peer's rails
  (§2) require an account on one of 14 payment platforms (Venmo, Cash App, Zelle, PayPal,
  Revolut, Wise, Monzo, N26, Mercado Pago, Alipay, Chime, Luxon). The target user **has local
  money and an RTPN account but no internationally accepted card** — e.g. LatAm via Mercado
  Pago, Europe-adjacent via Wise/Revolut multi-currency, US underbanked via Cash App/Venmo.
  Native UPI/PIX are **not** supported by Peer today [M]; India is reached via the app-store
  leg, not the onramp (an Indian user needs an existing USDC source or a Wise account).
- Pricing to cover: Pro $20/mo, Max $100/$200/mo; annual Pro exists (~$17/mo equivalent) [H].

## 2. Peer.xyz (zkp2p) — the onramp

Source of truth: `github.com/zkp2p/docs` (live docs source, updated 2026-06-10) and
`zkp2p-contracts` (updated 2026-06-09), read directly.

- **Branding:** ZKP2P rebranded to **Peer** (announced June 5, 2025); protocol layer keeps the
  "ZKP2P" name. Site peer.xyz; docs at docs.peer.xyz / docs.zkp2p.xyz [H].
- **Settlement:** escrow contracts deployed **only on Base mainnet** (EscrowV2
  `0x7777…00Ef`, OrchestratorV2 `0x8888…b888`); **USDC on Base is the settlement asset**.
  "20+ chains" marketing is app-layer post-settlement bridging [H].
- **Rails:** 14 platforms (above), ~35 fiat currencies via multi-currency platforms [M].
- **Trust model (important correction):** V3 moved from on-chain zkTLS verification to **TEE
  attestation** — payment evidence validated in AWS Nitro Enclaves, returned as an EIP-712
  `PaymentAttestation` checked on-chain, with nullifiers; the attestation infra is currently
  **operated solely by the team**; roadmap is vendor-agnostic (Primus, TLSNotary, Phala, ZKEmail)
  [H]. Maker/taker escrow-intent model; no KYC by default (optional maker-side "gating
  service"); **no dispute mediation**; fiat-reversal risk is documented and borne by makers [H].
- **Economics:** no fixed platform fee; maker spreads ~0.5–1% (to ~3%); **builder fees** for
  integrators via post-settlement hooks; gas sponsored for social-login users; e2e onramp
  averages ~2–2.5 minutes [M].
- **Developer surface:** `@zkp2p/sdk` 0.5.0 (+ `/react` hooks), `@zkp2p/contracts-v2` (ABIs,
  payment-method configs), GraphQL indexer, `zkp2p-skills` (AI-agent skills for the protocol,
  Feb 2026) [H].
- **⚠ The mobile constraint (adversarially verified):** the third-party integration guide is
  explicitly *"for desktop web apps"* and requires the **Peer Chrome extension ≥0.6.0**
  (`peer.authenticate()`, `captureMode: 'buyerTee'` — the extension captures and encrypts the
  payment session). Pre-0.6.0 redirect-style integrations are hard-deprecated. **There is no
  extension-free mobile-web path.** Mobile options: (a) `@zkp2p/zkp2p-react-native-sdk` v0.4.1
  (in-app WebView intercept via `@zkp2p/react-native-webview-intercept` + Reclaim witness SDK —
  native code only), or (b) handoff to Peer's own iOS/Android apps (App Store id 6749191100;
  Play `com.zkp2p.mobile.dev`; iOS App Clip for proof generation) [H].
- **Status signals:** grant-funded (EF PSE; no VC round confirmable) [M]; Sherlock audit contest
  ($67k pool) exists, results not readable [M]; no exploit found; Trustpilot complaints match
  the no-recourse model (PayPal F&F requests, Telegram support) [M]; self-reported volume
  "$1M+ monthly" at V3 launch [M].

## 3. Agentic payment protocols: x402 vs Tempo MPP

### 3.1 x402

- Created by Coinbase (May 2025); **v2 Dec 11, 2025** (CAIP-2 multi-chain, sessions, discovery);
  governance moved to the **x402 Foundation under the Linux Foundation (April 2, 2026)** with
  ~22 charter members incl. Google, Microsoft, AWS, Visa, Mastercard, Amex, Stripe, Cloudflare,
  Shopify, Circle, Solana Foundation [H]. Anthropic was an x402 *launch collaborator* (MCP
  integration) — this is protocol collaboration, **not** Anthropic accepting crypto [H].
- Mechanics: HTTP 402 → signed payment payload (`PAYMENT-SIGNATURE`) → facilitator verifies and
  settles. EVM "exact" scheme = EIP-3009 `transferWithAuthorization` (facilitator pays gas,
  cannot alter amount/destination); Permit2 fallback; Solana SPL supported [H — specs read
  directly from `github.com/x402-foundation/x402`].
- Scheme families in the spec repo today: `exact`, `upto`, **`auth-capture`** (explicitly
  "subscription or session billing with periodic captures against a single authorization"),
  `batch-settlement` [H]. Cloudflare's "deferred" scheme: proposed Sept 2025, **not** in the
  spec tree today — status unresolved [L].
- Recurring reality check: core x402 is per-request push pay [H]. Standing authorizations live
  in adjacent rails — **Coinbase Spend Permissions** (Base) and ERC-7715 — which ecosystem
  writeups combine with x402 for agent subscriptions; they are not part of the x402 spec [H].
- Facilitators: Coinbase CDP ($0.001/settlement after 1k free/mo, since Jan 2026; Base, Polygon,
  Arbitrum, World, Solana) [H]; on Solana, Dexter/PayAI dominate [M].
- Adoption: 100M+ cumulative transactions in ~6 months, average payment ~$0.20; volume volatile
  (one >90% weekly collapse early 2026); "$600M annualized" headlines are unreliable
  extrapolations vs ~$41–50M cumulative on Dune [M]. AWS AgentCore Payments, Vercel `x402-mcp`,
  Google AP2's crypto rail (`a2a-x402`) are real integrations [H].

### 3.2 Tempo + Machine Payments Protocol (MPP)

- Stripe/Paradigm L1; public testnet Dec 9, 2025; **mainnet March 18, 2026**; open to any
  developer (public RPCs, Reth-based EVM, Foundry/Hardhat unchanged); validator set permissioned
  (Visa, Stripe, Zodia first external validators) with a permissionless roadmap [H].
  $500M Series A at ~$5B (Oct 2025); no native token as of June 2026 [H/M].
- Stablecoin gas with an enshrined fee AMM; native tx type 0x76: **protocol-level scheduled
  transactions, batching, fee sponsorship, passkey auth**; **access keys with periodic spending
  limits** (e.g. $50/week, auto-resetting, revocable) — i.e. **subscriptions are a protocol
  primitive** [H/M].
- **MPP** (Stripe + Tempo, launched with mainnet): open, **payment-method-agnostic** HTTP-402
  standard; **Sessions** = pre-authorized spending limit + off-chain signed vouchers, ~2 on-chain
  txs per session; CC0 specs (`tempoxyz/mpp-specs`, core submitted to IETF), public SDKs
  (`mppx` on npm v0.6.31, `mpp-rs`); Visa wrote the card-payments spec; Lightspark extended MPP
  to Lightning [H — verified via npm/GitHub artifacts].
- Watch-outs: **native Circle USDC not confirmed on Tempo** (bridged USDC.e via Stargate;
  pathUSD is the root quote token) [M]; traction modest (~3.9M txns / ~177k addresses in 2
  months) [M]; Stripe's stablecoin *subscription billing* (Oct 2025, USDC on Base/Polygon,
  private preview) does not run on Tempo yet [M].

### 3.3 Comparison for this product

| Dimension | x402 (Base) | Tempo MPP |
|---|---|---|
| Chain where Peer delivers USDC | **Same chain (Base)** — no bridge | Requires Base→Tempo bridge (Stargate USDC.e) |
| Recurring primitive | Adjacent (Spend Permissions / ERC-7715) + `auth-capture` scheme (new) | **Protocol-native** (access keys w/ periodic caps; scheduled txs) |
| Governance/maturity | LF foundation, 100M+ txns, facilitator market | 3 months post-mainnet, Stripe/Visa gravity |
| Native USDC | **Yes** (Circle, Base) | Not confirmed (USDC.e) |
| Fiat-rail extensibility | Via AP2/Visa-Mastercard adjacency | **Designed in** (method-agnostic; Visa card spec) |

**Verdict:** x402 + Coinbase Spend Permissions on Base for v1 (funds never leave the chain Peer
settles on); MPP behind an adapter interface for phase 2 — it is the better long-term
subscription substrate and the likeliest rail if Stripe ever fronts Anthropic stablecoin billing.

## 4. The last leg: turning USDC into a paid claude.ai subscription

### 4.1 Anthropic's posture [H]

- No crypto acceptance in any form (consumer, API, or via partner). API billing help article
  lists "Not currently supported: PayPal, Wire transfer…, Cryptocurrency, **Prepaid gift
  cards**." Consumer checkout: cards only, billed via Stripe (Stripe's own Anthropic case study
  confirms Billing/Checkout/Link usage).
- ~175 supported countries; sanctioned regions excluded; Sept 2025 policy bars entities >50%
  owned from unsupported regions; VPN evasion can mean termination [H/M].
- ToS: account/credential sharing prohibited; generic "resell the Services" prohibition; **no
  clause prohibits a third party from paying for a user's own subscription** (the payments
  clause only requires authorization to use the payment method), and gift subscriptions are
  Anthropic's own sanctioned third-party-payment mechanism [H — verified against the Oct 2025
  ToS via Open Terms Archive; a Jan 31, 2026 revision could not be fetched, flagged].
- **Enforcement trend (verified):** Feb 2026 "Authentication and credential use" policy bans
  consumer-OAuth use in third-party tools (server-side blocking since Jan 9, 2026); **April 4,
  2026**: third-party harnesses (OpenClaw et al.) cut off from drawing on Pro/Max subscription
  limits. Both target *capacity consumption via credentials* — **not** payment intermediaries,
  not gift codes. (Cited Register URLs in initial research were garbled; correct articles:
  `theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/` and
  `theregister.com/2026/04/06/anthropic_closes_door_on_subscription/`.) [H]

### 4.2 Official Claude gift subscriptions (Leg B) [H, verified]

- Launched Dec 16, 2025. Pro/Max 5x/Max 20x × 1/3/6/12 months (Pro: $20/$60/$120/$216).
  Purchased at claude.ai/gift by **anyone** ("you don't need to have a Claude account") with a
  normal Stripe card checkout; delivered as email or shareable link; redeemed at
  claude.ai/gift/redeem; expires 365 days after purchase; **recipient needs no payment method**.
- Documented interaction rules: free user → upgraded; web Pro + Pro gift → **subscription
  extended by gift duration**; Pro + Max gift → temporary upgrade, remainder to account credit;
  Max + lower gift → account credit; iOS/Play subscribers must wait out the mobile sub.
- **⚠ The stacking hazard (verified adversarially):** the only documented rule is *"It's not
  possible to redeem multiple gifts at one time or stack redemptions."* There is **no queueing
  mechanism**. Real-world bug (anthropics/claude-code#41499, Mar 2026): 14 sequentially redeemed
  Max codes each *cancelled* the prior gift period via Stripe proration (gifts are 100%-off
  coupons), destroying $1,400 of value; closed unresolved. Related reliability issues: #48231,
  #48516, #52073, #54151, #66259. **Design rule: prefer 3/6/12-month codes, renew only at the
  expiry boundary, never redeem early.**
- No stated limit on codes per purchaser (one buyer bought 14×$200) [M]; no gift-specific
  resale clause, but the generic anti-resale clause gives Anthropic discretion — a commercial
  gift-code shop is a gray zone requiring legal review and Anthropic outreach [M].

### 4.3 App-store balance route (Leg A) [H]

- Claude Pro is an in-app purchase on iOS and Android (official help articles); app-store subs
  are billed/cancelled through Apple/Google; known entitlement-sync friction with claude.ai
  accounts and Claude Code (#34049) [H/M].
- Apple gift cards are sold for crypto (incl. USDC) by **Bitrefill** and Coinsbee; strictly
  region-locked (card country must equal Apple ID country) [H]. Apple Account balance is charged
  first for most subscriptions; documented exceptions exist per country — per-SKU behavior for
  Claude must be pilot-tested [M]. **India:** Apple stopped card-based subscriptions after RBI
  e-mandate rules and steers users to Apple balance — this route is the *house-recommended* path
  there [H]. Google Play: UPI Autopay mandates in India; whether Play balance funds auto-renew
  subs in India is unconfirmed [L].
- **Bitrefill API (verified):** docs.bitrefill.com — "programmatically purchase gift cards…
  pay with crypto or balance (BTC, Lightning, ETH, USDC, USDT, or account balance)." Personal
  API = self-serve token; Business API (full catalog, bulk) = approval via api@bitrefill.com.
  Whether Apple SKUs are exposed to Personal keys is undocumented — confirm with Bitrefill [M].
  Reloadly is a crypto-fundable (BTC/ETH/USDT/USDC, ~$100 min top-up) backup with a real
  gift-card API [H]. Coinsbee has **no** official API (third-party scrapers only) [M].
- **⚠ Apple's gift card T&Cs say "not for resale"** — distribution must go through the licensed
  reseller (Bitrefill as MoR delivering to the end user), not through our re-sale of cards [H].
- Coverage limit: Apple/Play gift cards exist only in app-store gift-card countries (US, UK, EU,
  BR, TR, IN, …). Most of Africa lacks them — Leg A does not serve Lagos; Leg B/C must [M].

### 4.4 Virtual cards (Leg C, phase 2)

- **Consumer card apps** (KAST, RedotPay, Cypher, Gnosis Pay, EtherFi, Holyheld): fragmented
  coverage, no self-serve issuing APIs, India/Pakistan locked out almost everywhere; Gnosis Pay
  has the only real partner/white-label API but is EEA/UK/BR/AR [M]. **Pay with Moon — the
  best-known "pay Claude with crypto" card — was shut down by its issuer ~Nov 2025 with user
  funds stuck** [H]: the cautionary tale for no-KYC card models.
- **B2B issuing APIs:** **Bridge (Stripe-owned) + Visa** — single API, Bridge runs KYC, virtual
  Visa from USDC, live in 18 countries (LatAm-led, Mar 2026), targeting 100+ incl. Africa by
  end-2026; approval-gated [H/M]. **Rain** — Visa principal member, $338M raised, single-use
  agent-issuable cards with spend scopes, enterprise MSA only [H/M]. **Kulipa** — only confirmed
  **Nigeria** issuance today (120k+ cards; Flutterwave) [M]. **India/Pakistan/Bangladesh: no
  provider, market-wide** [H].
- Cards issued to the **end user (consumer program, per-user KYC)** are mandatory: Stripe
  Issuing-class *commercial* card terms prohibit personal/household use (an operator card paying
  consumer subs violates program terms), and Stripe also restricts crypto businesses without
  approval [H].
- Even then: Anthropic's Stripe setup declines prepaid-class BINs; "works with Claude" claims
  all come from card vendors; recurring (MIT) clearance on stablecoin cards is undocumented by
  every provider — pilot-test, never assume [M].

### 4.5 USDC → Stripe directly: JIT-funded card mechanics (follow-up research, 2026-06-11)

Focused question: how can self-custodied USDC on Base pay a Stripe **card** checkout at a
merchant that has NOT opted into Stripe's stablecoin products? Findings, ranked by
composability:

1. **Bridge (Stripe-owned) stablecoin-backed cards via Stripe Issuing — the verdict** [H]:
   non-custodial funding mode pulls USDC from the user's own wallet **at card authorization**
   ("just-in-time"), against a prior **amount-bounded ERC-20 approval** to a developer-scoped
   Bridge delegate address. No prepaid float; the allowance can sit ≈$0 between cycles and be
   raised to exactly one cycle before the merchant's billing date. Public self-serve docs
   (standard Stripe Issuing objects + Bridge endpoints); Privy/third-party wallets supported;
   the card is a real Visa debit that Stripe Billing treats as ordinary card-on-file.
   Solana program confirmed; EVM "where the Bridge contract is deployed" — **Base not
   explicitly enumerated** [M], verify with Bridge.
2. **Rain** [M-H]: hold-at-auth against on-chain balances, USDC settlement with Visa, and an
   **Agent Control Layer** (MCC/merchant allowlists, amount/frequency caps, agent-issued
   cards, expiry) — the richest spending-control API found, but enterprise-gated (MSA).
3. **Kulipa** [M]: true JIT — moves funds to escrow *inside* the auth window, session-key
   clearing (Argent cosigner model); B2B for wallet companies, not self-serve.
4. **Immersve** [H mechanics]: deposit/escrow model (not wallet-pull at auth); open docs and
   contracts; live on Polygon/Algorand, Base unconfirmed.
5. **MetaMask Card (Baanx)** [H]: self-custodial JIT with on-chain spending-cap allowance,
   **Base supported**, auth verified <5s, explicitly marketed for subscriptions — proof the
   model handles recurring charges, but consumer-only (no third-party API).
6. **Holyheld BRRR API** [M]: agent-driven exact-amount top-up via bearer-token API —
   fastest hack, but prepaid and EUR-denominated.
7. **Agentic card credentials (Visa Intelligent Commerce / Mastercard Agent Pay)** [H
   existence / L access]: tokenize an *existing* card for an agent with spend controls;
   restricted pilot access; they delegate credentials, they don't create a stablecoin
   funding instrument — a crypto-funded card still sits underneath.
8. **Stripe payer-side (Link / Onramp / Pay-with-Crypto)** [H]: no path without merchant
   opt-in — confirmed dead end.

Recurring-charge reality: MIT/off-session charges are normally SCA/3DS-exempt; success is
purely a function of the issuer approving the auth with allowance+balance in place at that
instant [H]. **No public data exists on MIT decline rates for JIT crypto-funded cards** —
the key evidence gap; generate it with a live pilot. Top risk of the Bridge primitive: the
timing coupling between the allowance window and Stripe's Smart-Retries schedule.

### 4.6 Gnosis Pay permissionless integration (follow-up research, 2026-06-11)

Bridge's program is sales-gated with no self-serve signup, so the design pivoted to a
**gateway model**: friends fund the operator's own Gnosis Pay account, whose card pays
their subscriptions. Findings (docs read verbatim from the `github.com/gnosispay/docs`
mirror of docs.gnosispay.com):

- **Permissionless tier is real** [H]: *"no need to contact us or go through an approval
  process… authenticate with our APIs using SIWE to receive a JWT."* No API key, contract,
  or revenue share. Excluded from the tier: webhooks, PAN display (Partner Secure Element),
  branded programs. SIWE domain: localhost auto-allowed; hosted domains self-register free
  at partners.gnosispay.com.
- **API surface (api.gnosispay.com, SIWE→JWT as the account owner)** [H]: nonce/challenge
  auth; `GET /api/v1/cards`; **`POST /api/v1/cards/virtual` — free, instant**;
  freeze/unfreeze; `GET /api/v1/cards/transactions` (merchant, billing amount/currency,
  status, clearedAt — sufficient to reconcile Claude charges by polling); balances; Safe
  config; gasless withdrawals + daily-limit updates via EIP-712 (3-minute Delay relay).
- **Card cap: max 5 active cards per account** [H] (docs updated Nov 2025; older sources
  say 10) → one virtual card per friend works for ≤4-5 friends, then shared cards with
  merchant+amount attribution.
- **Funding is permissionless** [H/M]: deposits are plain ERC-20 transfers to the Safe —
  any address, instant, no Delay-module involvement (delay governs outgoing only). Gnosis
  Pay docs themselves recommend LI.FI/Bungee/deBridge/CoW for cross-chain top-ups. **An
  EEA/UK Safe spends EURe only** (UK: GBPe; USDC.e only in "select regions like Brazil")
  — so the route is Base USDC → Gnosis Chain EURe in one aggregator transaction, recipient
  = the Safe.
- **FX**: 0% Gnosis Pay FX fee; EUR card → USD merchant at Visa wholesale (~0.2–0.4%
  spread) [M]. Limits ~€8k/day, €5k/tx, ~€20k/mo [M].
- **Risks** [H]: (1) personal-use-only ToS — "business or commercial usage is not
  supported"; acceptable for a genuine friends circle, not a public product; (2) the
  June 1, 2026 Delay-module exploit (~$265k, 100% reimbursed, Safes replaced by ~June 7;
  the zodiac-core fix had sat unreleased since Feb) — platform risk is real; (3) cards
  freeze ~3 minutes around withdrawals/limit changes — a charge landing in that window
  declines.

## 5. Compliance: what shapes the architecture

- **Money transmission [H]:** FinCEN FIN-2019-G001 + FIN-2014-R012 — accepting a user's CVC and
  paying their fiat bill is money transmission; the payment-processor exemption is unavailable on
  crypto rails. Non-custodial *software* is exempt under the four-factor "total independent
  control" test — but **Samourai** (guilty pleas Jul 2025; 4–5-year sentences Nov 2025) shows
  DOJ charges §1960 against non-custodial *coordinators* regardless. Sling Money (non-custodial)
  chose to register as an MSB + MiCA CASP + FCA — market evidence of where the line is drawn in
  practice. **Catena Labs is pursuing licenses for agentic payments** — same conclusion.
- **MiCA [H]:** "fully decentralised" exemption is narrow (EBA/ESMA Jan 2025); frontend
  operators with fees/control look like CASPs; fiat→stablecoin dealing against inventory is
  squarely licensable; onramp *widgets/aggregators* are an unaddressed gray zone.
- **Sanctions [H]:** OFAC settlements vs Exodus ($3.1M, Dec 2025) and ShapeShift ($750k, Sept
  2025): non-custodial software is within reach; the expected control is **continuous IP
  geo-blocking**, not onboarding-only. Comprehensive programs: Cuba, Iran, DPRK, Crimea/DNR/LNR
  (Syria's comprehensive program revoked Jul 2025; targeted designations remain). Circle can
  freeze USDC — a user-funds tail risk. GENIUS Act (Jul 2025) regulates issuers and protects
  self-custody but creates no exemption for payment apps.
- **Fiat-rail ToS [H]:** Wise prohibits even *sending money to individuals to buy crypto*
  (buyer side!); Revolut bans third-party crypto transactions; Venmo bans commercial use of
  personal accounts. Peer's own docs tell users to respect platform ToS. Enforcement is opaque,
  falls mostly on makers, but must be disclosed to users; no zkp2p-specific ban wave found [M].
- **The five landmines** (from the compliance synthesis): (1) the bill-pay leg, not the onramp
  widget, is the transmission trap; (2) Samourai killed "non-custodial = safe" for
  coordinators; (3) fiat rails can cut users off at any time; (4) Anthropic blocks workarounds
  at the Stripe layer and enforces ToS abruptly (1-day notice in April 2026); (5) the "limited
  banking" framing overlaps sanctioned populations — geo-fence from day one.

## 6. Prior art

- **Whitespace confirmed:** no product autonomously pays a user's consumer SaaS/AI subscription
  end-to-end with stablecoins [M]. Closest: Nevermined (x402 subscription settlement; x402→card
  via Visa Intelligent Commerce), Skyfire (KYA + USDC wallets), Payman (agentic banking),
  Catena (licensed AI-native FI). Card networks: Mastercard Agent Pay, Visa Intelligent
  Commerce (Anthropic is a named LLM-side partner of the latter) [M-H].
- **The graveyard teaches the failure modes:** Union54 (2022, chargeback fraud, BIN killed);
  the Apr–May 2023 Mastercard crackdown (most Nigerian USD cards suspended); Payday acquired
  for a reported $1; Yellow Card exited retail (Jan 2026) for B2B; punitive decline fees
  ($1/decline; card deletion after 3–4 declines) because empty-card option-checking generates
  scheme penalties [H]. A prepaid-in-full, no-card-in-user-hands design avoids the entire class.
- Survivors who pivoted to our architecture: Chipper Cash rebuilt its card program **on
  Bridge** [M]; Bitnob/Grey monetize the exact "pay for AI from Africa" demand today [H].

## 7. Verification-pass corrections (what changed after fan-out)

1. **PWA-only onramp refuted** — Peer third-party web integration is desktop-Chrome-extension
   only; mobile requires the RN SDK or handoff to Peer's apps (§2).
2. **Gift stacking is hazardous** — no queueing; sequential redemption cancelled prior periods
   (#41499). Renew at expiry; prefer longer durations (§4.2).
3. **Feb/Apr 2026 Anthropic enforcement** identified precisely: credential/capacity abuse, not
   payment intermediaries; both Register URLs in initial findings were wrong (§4.1).
4. **Bitrefill API confirmed** (personal + business tiers, USDC-fundable); Coinsbee has no API;
   **Reloadly is crypto-fundable** (initial premise wrong) (§4.3).
5. **Tempo/MPP openness confirmed** (mainnet permissionless for deployers; `mppx`/`mpp-rs`
   public; validator set permissioned) (§3.2).

## 8. Open questions (carry into design/spec)

1. Will Anthropic tolerate a commercial gift-code purchasing service? (No clause prohibits;
   generic anti-resale clause gives discretion. Action: legal review + direct Anthropic
   partnership outreach before scaling Leg B.)
2. Does Apple Account balance auto-pay the Claude iOS subscription in every target country?
   (Documented exceptions exist. Action: per-country pilot matrix.)
3. Are Apple SKUs available via Bitrefill *Personal* API keys, or Business only? (Action: ask
   api@bitrefill.com; Business account likely needed anyway.)
4. Bridge's live cardholder-country list mid-2026 (the "18 countries" set) and whether
   stablecoin-funded cards clear Stripe MIT recurring charges. (Action: Bridge sandbox pilot.)
5. The Jan 31, 2026 consumer ToS revision (unfetchable) — any gift/resale changes?
6. Peer protocol limits (per-tx caps exist; numbers unpublished) and maker liquidity depth per
   corridor at $20–200 ticket sizes.
7. MSB/CASP analysis for the chosen operator jurisdiction (memo required before launch).
