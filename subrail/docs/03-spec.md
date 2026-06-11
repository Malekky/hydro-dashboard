# 03 — Spec: Subrail v1

Implements `02-design.md`. Scope: M1 (v1 PWA) with M2 interfaces stubbed. The scaffold in
`subrail/app/` mirrors this spec 1:1 — file paths below refer to it.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js 15 (App Router, TypeScript, PWA manifest) | One codebase for mobile-first PWA + desktop; API routes colocate the backend |
| Chain | Base mainnet (8453); Base Sepolia for dev | Peer settlement chain; native USDC |
| Wallet | Coinbase Smart Wallet SDK (passkey ERC-4337) via wagmi/viem | Passkey UX, paymaster gas sponsorship, native Spend Permissions |
| Onramp | `@zkp2p/sdk` ≥0.5.0 (+ `/react`), `@zkp2p/contracts-v2` | Headless desktop flow; mobile handoff v1; RN SDK in v1.5 |
| Payments | x402 (`exact` scheme, Base USDC) for Subrail's service fee; amount-bounded USDC allowance management for the card leg; Coinbase Spend Permissions for fallback-leg pulls | See D1 |
| Payment legs | **Primary: Gnosis Pay gateway** (`gateway/*` — SIWE-authed operator API client, LI.FI funding route, friend ledger); fallbacks: Bitrefill Business API (app-store), operator gift-code service (`FEATURE_LEG_B`) | See D2/§3 of design |
| Persistence | Postgres (Neon/Supabase) + Drizzle ORM | Renewal jobs need durable state + locks |
| Jobs | Vercel Cron → `/api/renewals/tick` (idempotent); upgradeable to Temporal in M2 | Renewals are minute-granular, not ms |
| Telemetry | OpenTelemetry + PostHog (no PII beyond country) | |

Env (`.env.example`): `DATABASE_URL`, `BASE_RPC_URL`, `PAYMASTER_URL`, `SPENDER_PRIVATE_KEY`
(renewal service signer — KMS in prod), `GNOSIS_OPERATOR_PRIVATE_KEY`,
`GNOSIS_SAFE_ADDRESS`, `GNOSISPAY_SIWE_DOMAIN`, `BITREFILL_API_KEY`,
`X402_FACILITATOR_URL`, `GEOIP_DB_PATH`, `FEATURE_LEG_B=false`,
`FEATURE_AUTONOMOUS_RENEWALS=false`.

## 2. Repo layout (== scaffold)

```
subrail/app/
  src/
    app/                      # Next.js routes
      page.tsx                #   landing + country/plan picker
      onboarding/page.tsx     #   rail plan review → wallet creation
      dashboard/page.tsx      #   subscription status, balance, renewals
      api/quote/route.ts      #   POST RailQuoteRequest → RailPlan[]
      api/intents/route.ts    #   POST create FundingIntent / GET status
      api/renewals/tick/route.ts  # cron: due RenewalJobs → execute
      api/fee/route.ts        #   x402-gated fee endpoint (402 flow)
    lib/
      types.ts                # all shared domain types (zod schemas)
      rails/router.ts         # pure: RailQuoteRequest → RailPlan[]
      rails/coverage.ts       # country coverage matrix (data, with provenance comments)
      onramp/peer.ts          # PeerOnrampAdapter (desktop headless | mobile handoff)
      pay/spendPermissions.ts # grant/validate/execute pull (viem)
      pay/x402.ts             # minimal exact-scheme client+server helpers
      pay/mpp.ts              # PaymentRail adapter stub (phase 2)
      legs/types.ts           # LastLeg interface
      gateway/gnosisPay.ts    # PRIMARY: SIWE→JWT operator client (cards, transactions)
      gateway/funding.ts      # LI.FI route: friend's Base USDC → EURe in operator Safe
      gateway/ledger.ts       # pure friend ledger (contributions − attributed charges)
      legs/bitrefill.ts       # fallback 1: app-store gift cards (Bitrefill API)
      legs/claudeGift.ts      # fallback 2: official Claude gift codes (feature-flagged)
      renewal/scheduler.ts    # pure state machine: RenewalJob transitions
      compliance/geo.ts       # continuous geo-gate (OFAC + Anthropic lists)
    tests/                    # vitest: router, scheduler, geo
```

## 3. Domain model

```ts
// src/lib/types.ts (authoritative; excerpted)
type Country = ISO3166Alpha2;
type ClaudePlan = 'pro' | 'max5x' | 'max20x';
type LegKind = 'appstore_giftcard' | 'claude_gift_code' | 'gateway_card';
type OnrampMode = 'peer_desktop_ext' | 'peer_app_handoff' | 'external_deposit';

interface RailQuoteRequest { country: Country; plan: ClaudePlan;
  platforms: PeerPlatform[]; device: 'mobile' | 'desktop'; }

interface RailPlan {           // output of the router; immutable quote
  leg: LegKind; onramp: OnrampMode; peerPlatform?: PeerPlatform;
  cadence: { kind: 'apple_topup', period: 'monthly' }
         | { kind: 'gift_code', months: 3 | 6 | 12 }   // never 1 (stacking hazard)
         | { kind: 'card_recurring' };
  costs: { faceUsd: number; onrampSpreadBps: number; legFeeBps: number;
           subrailFeeUsd: number; estTotalMonthlyUsd: number };
  disclosures: DisclosureId[]; // e.g. 'wise_p2p_tos', 'peer_no_recourse', 'circle_freeze'
  blocked?: { reason: 'sanctions' | 'anthropic_unsupported' | 'no_viable_leg' };
}

interface FundingIntent {      // one onramp episode
  id: string; wallet: Address; mode: OnrampMode; quotedUsd: number;
  state: 'created' | 'awaiting_fiat' | 'attested' | 'settled' | 'expired' | 'failed';
  peerIntentHash?: Hex; settledTx?: Hex; }

interface SpendPermissionGrant { wallet: Address; spender: Address; // renewal signer
  token: Address /* USDC */; periodDays: 30; capUsd: number;
  allowedRecipients: Address[]; // merchant deposit addrs + Subrail fee addr ONLY
  sig: Hex; revokedAt?: Date; }

interface RenewalJob { id: string; subscriptionId: string; leg: LegKind;
  dueAt: Date;                 // gift codes: expiry boundary minus 24h, never earlier
  state: 'scheduled' | 'awaiting_funds' | 'executing' | 'awaiting_user_action'
       | 'confirmed' | 'failed' | 'cancelled';
  attempts: number; lastError?: string;
  pulledUsd?: number;          // pulled-but-undelivered → reimbursed on failure (D6)
  reimbursedTx?: Hex;
  artifact?: { kind: 'gift_code' | 'apple_code'; deliveredTo: string }; }
```

State machines (pure functions in `renewal/scheduler.ts`, unit-tested):
- **FundingIntent:** `created → awaiting_fiat → attested → settled`; timeouts → `expired`;
  attestation mismatch → `failed` (user-facing remediation copy per Peer's no-recourse model).
- **RenewalJob:** `scheduled → (balance check) → executing → [awaiting_user_action] →
  confirmed`. Card leg: `executing` = allowance raised, `confirmed` on settled-auth webhook
  (no user action). Fallback legs: `awaiting_user_action` = the user's one tap (redeem code /
  confirm Apple top-up); reminders at T+1d/3d; fails at T+7d. On any failure, the scheduler
  emits `mark_failed` with `reimburseUsd` = pulled-but-undelivered funds, returned to the
  user's onramp wallet (design D6). Max 3 execution attempts, exponential backoff,
  idempotency key = `jobId:attempt`.

## 4. Core flows (integration detail)

### 4.1 Onramp — `onramp/peer.ts`
- **Desktop:** `sdk.initiateOnramp()` per Peer's integrate-redirect-onramp guide: detect
  extension ≥0.6.0 → `peer.authenticate({ captureMode: 'buyerTee' })` → quote via maker depth →
  user pays fiat out-of-band → extension returns encrypted TEE session → `fulfillIntent()` →
  watch EscrowV2 for settlement to user wallet. Register Subrail's **builder fee** hook.
- **Mobile (v1):** show wallet address + QR + deep link into the Peer app with prefilled
  recipient; poll Base USDC `Transfer` logs to the wallet to auto-resume (`external_deposit`
  shares this detector).
- Per-corridor config (platform, currency, min/max) lives in `rails/coverage.ts` with
  provenance comments; refresh from `@zkp2p/contracts-v2` payment-method configs at build time.

### 4.2 Authorization — `pay/spendPermissions.ts`
Grant on wallet creation completion (M2; M1 ships manual renewals): monthly cap =
`estTotalMonthlyUsd × 1.15`, recipients = exactly the active leg's merchant deposit address
source + Subrail fee address. UI shows the grant in plain language + a working revoke button
(on-chain revocation, verified in e2e tests). The renewal signer is a dedicated key (KMS) that
can do nothing but execute permitted pulls.

### 4.3 Primary leg — `gateway/*` (Gnosis Pay gateway, permissionless tier)

Operator setup (once): normal Gnosis Pay signup/KYC → set `GNOSIS_OPERATOR_PRIVATE_KEY`
(an owner key, used only to sign SIWE logins) + `GNOSIS_SAFE_ADDRESS` → create one free
virtual card per friend (`POST /api/v1/cards/virtual`, 5-active cap) in `/operator` →
put each card on the friend's claude.ai account (PAN revealed in the Gnosis Pay app —
PSE display is partner-gated).

Friend contribution (per top-up): `/api/gateway/funding-quote` fetches the LI.FI route
Base USDC → Gnosis EURe with `toAddress` = the operator Safe; the friend's wallet approves
USDC (if required) and sends the route transaction. Deposits are plain ERC-20 transfers —
instant, no Delay-module interaction. EEA Safes spend EURe only; never deliver USDC.e.

Reconciliation (no webhooks on the permissionless tier): poll
`GET /api/v1/cards/transactions`; `ledger.isClaudeCharge` filters Anthropic merchants;
`computeStandings` nets contributions against charges (cardToken→friend mapping when
cards are per-friend, pro-rata otherwise) and reports months of runway per friend.

Operational rules: don't withdraw or change limits near billing dates (cards freeze ~3
minutes during Delay-relay operations); keep the Safe topped ahead of known billing dates;
declines surface in the transactions feed as `InsufficientFunds`.

M0 spikes: live SIWE auth against api.gnosispay.com with the operator key; one real LI.FI
contribution Base→Safe; one real claude.ai charge on a fresh virtual card; verify the
transactions endpoint shows it with usable merchant/amount fields.

### 4.4 Fallback 1 — `legs/bitrefill.ts`
Bitrefill Business API: maintain a small operator balance OR pay per-invoice; **preferred:
invoice flow where the user's wallet pays the invoice's USDC deposit address directly via the
spend-permission pull** (user → Bitrefill, no transit through Subrail). Product selection:
Apple gift card SKU matching the user's **Apple ID country** (asserted during onboarding,
re-confirmed before purchase); deliver code to user (in-app + email); `awaiting_user_action`
until user confirms redemption; Apple balance then auto-renews the IAP subscription.
Open item from research (§8.3): confirm Apple SKUs on our key tier with api@bitrefill.com;
Reloadly client behind the same `LastLeg` interface as fallback.

### 4.5 Fallback 2 — `legs/claudeGift.ts` (`FEATURE_LEG_B`, default off)
Operator entity purchases an official Claude gift (≥3 months) at claude.ai/gift for the user's
email, after collecting the equivalent USDC from the user's wallet (pull → operator's segregated
merchant account — this is the one leg where the operator is the MoR; launch-gated on the legal
memo). Scheduling rule enforced in the router AND the scheduler: next purchase due only at
current period expiry − 24h; never auto-redeem; user redeems at claude.ai/gift/redeem.
Runbook for redemption failures (#41499 class): pause corridor, manual support, refund path.

### 4.6 Fee — `pay/x402.ts`
`/api/fee` returns 402 with `exact`-scheme requirements (USDC Base, Subrail fee address); the
client wallet signs EIP-3009; facilitator settles. Doubles as our dogfooded x402 surface and
keeps fee collection auditable and separate from principal flows.

### 4.7 Compliance — `compliance/geo.ts`
Scope per design D5: geo-blocking + disclosures; everything else is carried by the regulated
stack (RTPNs on the fiat side, Gnosis Pay/Monavate KYC on the operator, Bitrefill as MoR).
Every session AND every state-mutating API call: GeoIP country →
`blockedCountries = OFAC_COMPREHENSIVE ∪ ANTHROPIC_UNSUPPORTED` → hard block + logged event.
VPN/proxy heuristic score → step-up friction. Disclosure acceptance (per `DisclosureId`)
recorded with timestamp pre-onramp. No PII beyond email + country lives in Subrail.

## 5. API surface (v1)

| Route | Method | Body → Response | Notes |
|---|---|---|---|
| `/api/quote` | POST | `RailQuoteRequest` → `RailPlan[]` | Pure router + live maker-depth check |
| `/api/intents` | POST/GET | create / poll `FundingIntent` | |
| `/api/subscriptions` | POST | `{ railPlanId, wallet, email, appleCountry? }` → subscription + first `RenewalJob` | |
| `/api/renewals/tick` | POST (cron) | → `{ executed, failed }` | Idempotent; row-locked |
| `/api/renewals/:id/confirm` | POST | user confirms redemption | → `confirmed` |
| `/api/fee` | GET | 402 → x402 settle → fee receipt | |
| `/api/permissions/revoke` | POST | relays on-chain revocation | Also works wallet-side |

## 6. Screens (mobile-first)

1. **Landing/picker** — country + plan → instant quote card ("Claude Pro in Argentina:
   ~$22.10/mo all-in via Mercado Pago"). Blocked countries get an honest dead-end screen.
2. **Rail plan review** — the chosen path drawn end-to-end, all fees itemized, disclosures
   inline (checkbox per `DisclosureId`).
3. **Wallet creation** — passkey ceremony; no seed phrase; recovery explainer.
4. **Funding** — mode-dependent: QR/deep link (mobile) or embedded headless flow (desktop ext);
   live status from the FundingIntent poller.
5. **Authorize** (M2) — spend permission in plain language; revoke always visible.
6. **Dashboard** — subscription state, next renewal, wallet balance vs next-cycle need,
   action-required banner (`awaiting_user_action`), history.

## 7. Testing & acceptance

- **Unit (vitest):** router (card-leg-first ranking, coverage matrix × blocked × cadence
  rules — incl. "never 1-month gift codes", "no card issuer → fallback"); scheduler
  transitions (idempotent tick, backoff, expiry-boundary rule, reimbursement emission); geo
  gate.
- **Integration:** live SIWE auth against api.gnosispay.com (operator key); LI.FI quote
  fetch for Base USDC → Gnosis EURe; x402 402→settle against CDP facilitator sandbox;
  Bitrefill sandbox/test products.
- **E2E pilots (M0, manual — these gate the build):** one real friend contribution
  (Peer onramp → LI.FI route → EURe lands in the Safe); one real claude.ai charge on a
  fresh virtual card, visible via the transactions endpoint; Peer desktop + app-handoff
  onramps at $25 and $120 tickets; Apple-balance auto-renew pilot (fallback 1).
- **Acceptance for M1 launch:** a friend completes picker → wallet → Peer funding →
  contribution in <30 min with ≤2 support touches; the operator console shows the
  contribution-funded Safe, per-friend cards, and detected Claude charges; a failed leg
  reimburses USDC to the friend's wallet in <1h; blocked-country access is impossible by
  IP and by declared country; disclosures (incl. gateway_operator) recorded.

## 8. Deferred (M2/M3 hooks present in code)

MPP adapter (`pay/mpp.ts` implements `PaymentRail`); Rain/Kulipa issuer adapters behind `LastLeg`;
RN/Expo shell with `@zkp2p/zkp2p-react-native-sdk`; autonomous renewals flag; corridor
liquidity telemetry; x402 Bazaar listing; Anthropic partnership track (the Leg-B legal memo and
outreach are M0 tasks, not code).
