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
| Payments | x402 (`exact` scheme, Base USDC) for Subrail's service fee; Coinbase Spend Permissions for renewal pulls | See D1 |
| Last legs | Bitrefill Business API (Leg A); operator gift-code service (Leg B, feature-flagged off until legal gate clears) | See D2 |
| Persistence | Postgres (Neon/Supabase) + Drizzle ORM | Renewal jobs need durable state + locks |
| Jobs | Vercel Cron → `/api/renewals/tick` (idempotent); upgradeable to Temporal in M2 | Renewals are minute-granular, not ms |
| Telemetry | OpenTelemetry + PostHog (no PII beyond country) | |

Env (`.env.example`): `DATABASE_URL`, `BASE_RPC_URL`, `PAYMASTER_URL`, `SPENDER_PRIVATE_KEY`
(renewal service signer — KMS in prod), `BITREFILL_API_KEY`, `X402_FACILITATOR_URL`,
`GEOIP_DB_PATH`, `FEATURE_LEG_B=false`, `FEATURE_AUTONOMOUS_RENEWALS=false`.

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
      legs/bitrefill.ts       # Leg A executor (Bitrefill Business API client)
      legs/claudeGift.ts      # Leg B executor (feature-flagged)
      renewal/scheduler.ts    # pure state machine: RenewalJob transitions
      compliance/geo.ts       # continuous geo-gate (OFAC + Anthropic lists)
    tests/                    # vitest: router, scheduler, geo
```

## 3. Domain model

```ts
// src/lib/types.ts (authoritative; excerpted)
type Country = ISO3166Alpha2;
type ClaudePlan = 'pro' | 'max5x' | 'max20x';
type LegKind = 'appstore_giftcard' | 'claude_gift_code' | 'virtual_card';
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
  artifact?: { kind: 'gift_code' | 'apple_code'; deliveredTo: string }; }
```

State machines (pure functions in `renewal/scheduler.ts`, unit-tested):
- **FundingIntent:** `created → awaiting_fiat → attested → settled`; timeouts → `expired`;
  attestation mismatch → `failed` (user-facing remediation copy per Peer's no-recourse model).
- **RenewalJob:** `scheduled → (balance check) → executing → awaiting_user_action →
  confirmed`. `awaiting_funds` emits a top-up nudge with a prefilled FundingIntent.
  `awaiting_user_action` = the user's one tap (redeem code / confirm Apple top-up); reminders at
  T+1d/3d; job fails (and pull is refunded where possible) at T+7d. Max 3 execution attempts,
  exponential backoff, idempotency key = `jobId:attempt`.

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

### 4.3 Leg A — `legs/bitrefill.ts`
Bitrefill Business API: maintain a small operator balance OR pay per-invoice; **preferred:
invoice flow where the user's wallet pays the invoice's USDC deposit address directly via the
spend-permission pull** (user → Bitrefill, no transit through Subrail). Product selection:
Apple gift card SKU matching the user's **Apple ID country** (asserted during onboarding,
re-confirmed before purchase); deliver code to user (in-app + email); `awaiting_user_action`
until user confirms redemption; Apple balance then auto-renews the IAP subscription.
Open item from research (§8.3): confirm Apple SKUs on our key tier with api@bitrefill.com;
Reloadly client behind the same `LastLeg` interface as fallback.

### 4.4 Leg B — `legs/claudeGift.ts` (`FEATURE_LEG_B`, default off)
Operator entity purchases an official Claude gift (≥3 months) at claude.ai/gift for the user's
email, after collecting the equivalent USDC from the user's wallet (pull → operator's segregated
merchant account — this is the one leg where the operator is the MoR; launch-gated on the legal
memo). Scheduling rule enforced in the router AND the scheduler: next purchase due only at
current period expiry − 24h; never auto-redeem; user redeems at claude.ai/gift/redeem.
Runbook for redemption failures (#41499 class): pause corridor, manual support, refund path.

### 4.5 Fee — `pay/x402.ts`
`/api/fee` returns 402 with `exact`-scheme requirements (USDC Base, Subrail fee address); the
client wallet signs EIP-3009; facilitator settles. Doubles as our dogfooded x402 surface and
keeps fee collection auditable and separate from principal flows.

### 4.6 Compliance — `compliance/geo.ts`
Every session AND every state-mutating API call: GeoIP country →
`blockedCountries = OFAC_COMPREHENSIVE ∪ ANTHROPIC_UNSUPPORTED` → hard block + logged event
(Exodus-standard continuous enforcement). VPN/proxy heuristic score → step-up friction.
Disclosure acceptance (per `DisclosureId`) recorded with timestamp pre-onramp. No PII storage
beyond email + country; card legs (M3) delegate KYC entirely to the issuer.

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

- **Unit (vitest):** router (coverage matrix × blocked × cadence rules — incl. "never 1-month
  gift codes", "Apple country mismatch → no Leg A"); scheduler transitions (idempotent tick,
  backoff, expiry-boundary rule); geo gate.
- **Integration:** Base Sepolia: spend-permission grant → pull → revoke; x402 402→settle
  against CDP facilitator sandbox; Bitrefill sandbox/test products.
- **E2E pilots (M0, manual — these gate the build):** AR/BR/IN/US Apple-balance auto-renew of
  Claude iOS sub; 3-month gift code redeem + expiry-boundary renewal on a real account; Peer
  desktop + app-handoff onramps at $25 and $120 tickets.
- **Acceptance for M1 launch:** a new user in BR completes picker → wallet → Peer funding →
  Leg A purchase → active Claude Pro in <30 min with ≤2 support touches; renewal succeeds on
  manual trigger; revocation works; blocked-country access is impossible by IP and by declared
  country; all four disclosures shown and recorded.

## 8. Deferred (M2/M3 hooks present in code)

MPP adapter (`pay/mpp.ts` implements `PaymentRail`); Leg C issuer clients behind `LastLeg`;
RN/Expo shell with `@zkp2p/zkp2p-react-native-sdk`; autonomous renewals flag; corridor
liquidity telemetry; x402 Bazaar listing; Anthropic partnership track (the Leg-B legal memo and
outreach are M0 tasks, not code).
