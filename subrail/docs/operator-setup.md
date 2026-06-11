# Operator setup: getting `GNOSIS_SAFE_ADDRESS` and `GNOSIS_OPERATOR_PRIVATE_KEY`

For an existing, KYC'd Gnosis Pay cardholder who signs in at app.gnosispay.com with a
self-custody wallet (MetaMask/Rabby/WalletConnect — the normal flow; there is no embedded
wallet). Researched 2026-06-11 against the official docs mirror (`github.com/gnosispay/docs`),
Gnosis Pay's `siwe-demo-app`, the community Go SDK, and help-center articles; steps marked
**UNVERIFIED** rely on UI labels that may drift.

**How it works:** the wallet you connected at signup is registered as both an
*authenticated wallet* (Sign-In Wallet) and the initial *Safe owner*. The API's SIWE check
(`/api/v1/auth/challenge`) is against **registered Sign-In Wallets in Gnosis Pay's
backend** — not a raw on-chain owner check. So the recommended path is: create a fresh,
dedicated EOA and register it as an additional Sign-In Wallet. **Never export your main
wallet's key.**

## Steps

1. **Prerequisites:** your usual login wallet; [Foundry](https://getfoundry.sh) (`cast`)
   or any offline key generator; `jq`.

2. **Create a dedicated EOA** (offline):
   ```bash
   cast wallet new
   ```
   Save the private key as `GNOSIS_OPERATOR_PRIVATE_KEY` in `subrail/app/.env.local`
   (gitignored). Note the address.

3. **Register it as a Sign-In Wallet** (documented; help article 39579339371284):
   app.gnosispay.com → log in with your usual wallet → **Account → Settings** →
   **Sign-In Wallets** → **Edit → Add address** → paste the new EOA → **Save**.
   *(Exact button labels UNVERIFIED.)*
   API alternative (docs: `account/update-authenticated-account.mdx`), with a JWT from
   your existing wallet:
   ```bash
   curl -X POST https://api.gnosispay.com/api/v1/eoa-accounts \
     -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
     -d '{"address":"0xNEW_EOA"}'
   # confirm: curl -H "Authorization: Bearer $JWT" https://api.gnosispay.com/api/v1/eoa-accounts
   ```

4. **Test the SIWE login with the new key** (format verified from `auth.mdx` +
   `siwe-demo-app`; nonce is plain text; address must be EIP-55 checksummed; fresh nonce
   per login; `localhost` is auto-whitelisted — avoid `127.0.0.1`):
   ```bash
   NONCE=$(curl -s https://api.gnosispay.com/api/v1/auth/nonce)
   NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   MSG="localhost:3000 wants you to sign in with your Ethereum account:
   0xYOUR_NEW_EOA

   Sign in with Ethereum to Gnosis Pay

   URI: https://api.gnosispay.com/
   Version: 1
   Chain ID: 100
   Nonce: ${NONCE}
   Issued At: ${NOW}"
   SIG=$(cast wallet sign --private-key $GNOSIS_OPERATOR_PRIVATE_KEY "$MSG")
   JWT=$(curl -s -X POST https://api.gnosispay.com/api/v1/auth/challenge \
     -H "Content-Type: application/json" \
     -d "$(jq -n --arg m "$MSG" --arg s "$SIG" '{message:$m,signature:$s,ttlInSeconds:86400}')" \
     | jq -r .token)
   ```
   The app does this for you at runtime — this manual test just proves the key works.

5. **Verify:** `curl -s https://api.gnosispay.com/api/v1/cards -H "Authorization: Bearer $JWT"`
   returns your card list. A **401 means the EOA isn't registered** — recheck step 3.

6. **Get `GNOSIS_SAFE_ADDRESS`** (any of):
   - `curl -s https://api.gnosispay.com/api/v1/safe-config -H "Authorization: Bearer $JWT"`
     → the `address` field;
   - in-app: the add-funds / account-details screen shows your Card Safe deposit address
     *(label UNVERIFIED)*;
   - gnosisscan.io: open one of your own top-ups — the EURe recipient is the Safe.

7. **Optional — only if the app must sign withdrawals/limit changes later:** also add the
   EOA as a **Safe Owner** (Account → Account details → Account Owners → Add address;
   or the documented API flow `GET /api/v1/owners/add/transaction-data` → sign EIP-712
   with a current owner → `POST /api/v1/owners`). Owner changes execute via the Delay
   module (~3 minutes; card restricted meanwhile). Do **not** attempt owner changes
   directly on the Safe on-chain — changes are routed through the Delay relay and the
   API flow is the only supported path. **Subrail does not need this today** — Sign-In
   Wallet status is enough for everything the app does (cards, transactions, balances).

## Safety

- A **Sign-In-only EOA** can: log in, read profile/balances/transactions/Safe config, and
  perform card actions under the JWT (create/freeze/unfreeze/report). It **cannot**
  approve on-chain transactions or withdrawals ("can view the account but cannot approve
  transactions" — help article 39579339371284).
- If you *also* make it a Safe Owner, it can sign gasless withdrawals of **all funds**
  (3-minute delay) and change owners. Treat it like a bank key.
- JWTs last 1–24 h (`ttlInSeconds`); the app re-authenticates automatically on expiry.
- Hygiene: key lives only in `.env.local` (`chmod 600`), never committed or logged.
  Rotate anytime: delete the Sign-In Wallet in Settings (or
  `DELETE /api/v1/eoa-accounts/{id}`) and register a new EOA.
